/**
 * 系统邮件简体 → 台湾繁体 一键兼容转换。
 *
 * 范围：只处理 player_mail 中 sender_type = 'system' 的行，转换列仅 title / body / sender_label；
 * 其它 sender_type（unknown / 玩家来源等）逐行跳过并做字节级 hash 前后比对验证（byte-identical）。
 * 不触碰 player_mail_attachment（仅 itemId/count）、metadata_jsonb、skill-snapshot 表。
 * 这是 GM 手动一次性运维入口，不在 tick 热路径。
 *
 * 转换算法：两段式 —— 先词级（VOCABULARY_CN_TO_TW 最长匹配：服务器→伺服器 等 17 词），
 * 再字级（opencc-js Converter({from:'cn',to:'tw'}) 收尾），转换前对台湾标准保护词
 * （濃郁 / 馥郁 / 岩）做哨兵掩码，避免 opencc 非幂等误转。
 *
 * apply 流程：建备份表（player_mail_pre_tw_backup，已存在则跳过不重建）→ 对 JS 检测到
 * 简体内容的系统邮件逐行 UPDATE（CAS 防漂移）→ 跳过行回读字节级 hash 验证 →
 * 回读残余简体系统邮件数（与转换相同的 JS 检测口径）→ 写固定转换标记
 * （gm_audit_log 审计 + player_mail_conversion_meta 标记表）。
 * 二次执行：JS 检测不到任何可转换行 → convertedRows=0、备份表不重建、不重复写标记，幂等。
 */
import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { Converter } from 'opencc-js';

import { DatabasePoolProvider } from '../../../../persistence/database-pool.provider';
import { GmAuditLogPersistenceService } from '../../../../persistence/gm-audit-log-persistence.service';
import type {
  GmCompatConversionRunOptions,
  GmCompatConversionRunResult,
  GmCompatConversionSample,
} from '../../types';
import {
  applyVocabulary,
  maskProtected,
} from './tw-vocabulary';

export const MAIL_SNAPSHOT_TRADITIONALIZE_CONVERSION_ID = 'mail_snapshot_traditionalize';

const PLAYER_MAIL_TABLE = 'player_mail';
const PLAYER_MAIL_PRE_TW_BACKUP_TABLE = 'player_mail_pre_tw_backup';
const PLAYER_MAIL_CONVERSION_META_TABLE = 'player_mail_conversion_meta';
const SYSTEM_SENDER_TYPE = 'system';
const SAMPLE_LIMIT = 10;

/** 固定转换标记表（防止二次执行误重建备份表 / 重复转换）。 */
const PLAYER_MAIL_CONVERSION_META_TABLE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ${PLAYER_MAIL_CONVERSION_META_TABLE} (
    conversion_key varchar(80) PRIMARY KEY,
    batch_id varchar(80) NOT NULL,
    converted_at timestamptz NOT NULL,
    converted_rows bigint NOT NULL,
    skipped_rows bigint NOT NULL,
    residual_simplified_rows bigint NOT NULL DEFAULT 0,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
  )
`;

export interface MailSnapshotTraditionalizeRunResult extends GmCompatConversionRunResult {
  batchId: string | null;
  backupTable: string;
  backupTableCreated: boolean;
  residualSimplifiedRows: number;
}

interface MailCandidateRow {
  mail_id: string;
  sender_type: string;
  sender_label: string | null;
  title: string | null;
  body: string | null;
  content_hash: string;
  is_system: boolean;
  can_convert: boolean;
  convert_reason: string;
  converted_title: string | null;
  converted_body: string | null;
  converted_sender_label: string | null;
}

interface PendingConvertRow {
  mailId: string;
  title: string | null;
  body: string | null;
  senderLabel: string | null;
  convertedTitle: string | null;
  convertedBody: string | null;
  convertedSenderLabel: string | null;
}

interface SkipRow {
  mailId: string;
  contentHashBefore: string;
  contentHashAfter: string;
}

const createEmptyResult = (
  mode: GmCompatConversionRunOptions['mode'],
): MailSnapshotTraditionalizeRunResult => ({
  ok: true,
  conversionId: MAIL_SNAPSHOT_TRADITIONALIZE_CONVERSION_ID,
  mode,
  matchedRows: 0,
  convertedRows: 0,
  skippedRows: 0,
  failedRows: 0,
  verifiedRows: 0,
  samples: [],
  errors: [],
  batchId: null,
  backupTable: PLAYER_MAIL_PRE_TW_BACKUP_TABLE,
  backupTableCreated: false,
  residualSimplifiedRows: 0,
});

/** 字级转换器（词级替换后收尾用）。 */
const cn2twConverter = Converter({ from: 'cn', to: 'tw' });

/**
 * 两段式转换单段文本：先掩码保护台湾标准词 → 词级最长匹配 → 字级收尾 → 还原保护词。
 */
export function convertTextToTraditional(text: string): string {
  const { text: masked, restore } = maskProtected(text);
  const { text: vocabularyApplied } = applyVocabulary(masked);
  const charLevel = cn2twConverter(vocabularyApplied);
  return restore(charLevel);
}

/**
 * 检测文本是否含简体（需要转换）。
 * 与 apply 的转换 / 残余检测共用同一口径：两段式转换结果与原文不同即视为简体。
 */
export function hasSimplifiedContent(text: string | null): boolean {
  if (!text) {
    return false;
  }
  return convertTextToTraditional(text) !== text;
}

/** 内容 hash（title/body/sender_label 拼接），用于跳过行的字节级前后比对。 */
function contentHash(title: string | null, body: string | null, senderLabel: string | null): string {
  return createHash('sha256')
    .update(`${senderLabel ?? ''}\u0000${title ?? ''}\u0000${body ?? ''}`)
    .digest('hex');
}

@Injectable()
export class MailSnapshotTraditionalizeConversion {
  private readonly logger = new Logger(MailSnapshotTraditionalizeConversion.name);

  constructor(
    @Inject(DatabasePoolProvider)
    private readonly databasePoolProvider: DatabasePoolProvider,
    @Optional()
    @Inject(GmAuditLogPersistenceService)
    private readonly gmAuditLogPersistenceService: GmAuditLogPersistenceService | null = null,
  ) {}

  async run(options: GmCompatConversionRunOptions): Promise<MailSnapshotTraditionalizeRunResult> {
    const pool = this.databasePoolProvider.getPool('gm-compat-mail-snapshot-traditionalize');
    if (!pool) {
      throw new ServiceUnavailableException('database_unavailable');
    }
    const result = createEmptyResult(options.mode);
    const rows = await this.loadMailRows(pool);
    this.populateScanResult(result, rows);

    if (options.mode === 'dry-run') {
      await this.recordAudit(result, options);
      return result;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      result.backupTableCreated = await this.ensureBackupTable(client);

      const pending: PendingConvertRow[] = [];
      const skipped: SkipRow[] = [];
      for (const row of rows) {
        if (!row.is_system) {
          // 非系统来源行：绝不更新，记录前后字节 hash 用于回读验证
          skipped.push({
            mailId: row.mail_id,
            contentHashBefore: row.content_hash,
            contentHashAfter: row.content_hash,
          });
          continue;
        }
        if (!row.can_convert) {
          // 系统行但已是台湾标准（无简体）：跳过，前后 hash 必须一致
          skipped.push({
            mailId: row.mail_id,
            contentHashBefore: row.content_hash,
            contentHashAfter: row.content_hash,
          });
          continue;
        }
        pending.push({
          mailId: row.mail_id,
          title: row.title,
          body: row.body,
          senderLabel: row.sender_label,
          convertedTitle: row.converted_title,
          convertedBody: row.converted_body,
          convertedSenderLabel: row.converted_sender_label,
        });
      }

      // 逐行 CAS 更新（WHERE 携带原文快照，漂移即失败回滚全部）
      let convertedCount = 0;
      for (const entry of pending) {
        const updated = await this.updateSystemMailRow(client, entry);
        if ((updated.rowCount ?? 0) !== 1) {
          result.failedRows += 1;
          result.errors.push(`mail_convert_row_drift:${entry.mailId}`);
          continue;
        }
        convertedCount += 1;
      }

      // 跳过行回读字节级验证（byte-identical：非 system 行 + 已台湾标准行）
      const skipVerifyFailed = await this.verifySkippedRows(client, skipped, result);
      result.failedRows += skipVerifyFailed;
      if (skipVerifyFailed > 0) {
        result.errors.push(`mail_skip_rows_not_byte_identical:${skipVerifyFailed}`);
      }

      result.convertedRows = convertedCount;
      result.verifiedRows = convertedCount;
      result.appliedAt = new Date().toISOString();
      result.batchId = createBatchId(result.appliedAt);

      // 回读验证：残余简体系统邮件必须为 0（与转换相同的 JS 检测口径）
      result.residualSimplifiedRows = await this.countResidualSimplifiedRows(client);
      if (result.residualSimplifiedRows > 0) {
        result.failedRows += result.residualSimplifiedRows;
        result.errors.push(`mail_residual_simplified_rows:${result.residualSimplifiedRows}`);
      }

      // 固定转换标记：防二次执行重复建备份表 / 重复转换
      await this.writeConversionMarker(client, result);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      result.convertedRows = 0;
      result.failedRows = Math.max(result.failedRows, 1);
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.logger.error(`系统邮件繁体化转换失败并已回滚：${result.errors[result.errors.length - 1]}`);
      await this.recordAudit(result, options);
      return result;
    } finally {
      client.release();
    }

    this.logger.log(
      `系统邮件繁体化完成：命中 ${result.matchedRows}，转换 ${result.convertedRows}，`
      + `跳过 ${result.skippedRows}，验证 ${result.verifiedRows}，残余简体 ${result.residualSimplifiedRows}，`
      + `备份表 ${result.backupTableCreated ? '新建' : '已存在（跳过重建）'}`,
    );
    await this.recordAudit(result, options);
    return result;
  }

  /** 装载全部邮件行：system 行做简体检测；非 system 行标记跳过（字节级验证）。 */
  private async loadMailRows(pool: Pool): Promise<MailCandidateRow[]> {
    const result = await pool.query(
      `SELECT mail_id,
              sender_type,
              sender_label,
              title,
              body
         FROM ${PLAYER_MAIL_TABLE}
        ORDER BY mail_id ASC`,
    );
    return result.rows.map((row) => {
      const mailId = normalizeRequiredString(row.mail_id);
      const senderType = normalizeRequiredString(row.sender_type);
      const title = normalizeNullableString(row.title);
      const body = normalizeNullableString(row.body);
      const senderLabel = normalizeNullableString(row.sender_label);
      const isSystem = senderType === SYSTEM_SENDER_TYPE;
      const hasSimplified = isSystem
        && (hasSimplifiedContent(title)
          || hasSimplifiedContent(body)
          || hasSimplifiedContent(senderLabel));
      // null 保持 null（CAS 用 IS NOT DISTINCT FROM 比对，避免把 NULL 写成空串产生漂移）
      const convertedTitle = isSystem && title != null ? convertTextToTraditional(title) : null;
      const convertedBody = isSystem && body != null ? convertTextToTraditional(body) : null;
      const convertedSenderLabel = isSystem && senderLabel != null
        ? convertTextToTraditional(senderLabel)
        : null;
      return {
        mail_id: mailId,
        sender_type: senderType,
        sender_label: senderLabel,
        title,
        body,
        content_hash: contentHash(title, body, senderLabel),
        is_system: isSystem,
        can_convert: isSystem && hasSimplified,
        convert_reason: !isSystem
          ? 'non_system_sender'
          : hasSimplified
            ? 'contains_simplified'
            : 'already_traditional',
        converted_title: convertedTitle,
        converted_body: convertedBody,
        converted_sender_label: convertedSenderLabel,
      };
    });
  }

  private populateScanResult(
    result: MailSnapshotTraditionalizeRunResult,
    rows: MailCandidateRow[],
  ): void {
    result.matchedRows = rows.length;
    result.skippedRows = rows.filter((row) => !row.can_convert).length;
    result.convertedRows = rows.filter((row) => row.can_convert).length;
    for (const row of rows) {
      if (!row.can_convert || result.samples.length >= SAMPLE_LIMIT) {
        continue;
      }
      result.samples.push({
        id: row.mail_id,
        name: row.sender_label ?? '',
        status: row.convert_reason,
        before: {
          title: row.title ?? '',
          body: row.body ?? '',
          senderLabel: row.sender_label ?? '',
        },
        after: {
          title: row.converted_title ?? '',
          body: row.converted_body ?? '',
          senderLabel: row.converted_sender_label ?? '',
        },
      } satisfies GmCompatConversionSample);
    }
  }

  private async ensureBackupTable(client: PoolClient): Promise<boolean> {
    const existing = await client.query(
      'SELECT to_regclass($1::text) AS reg',
      [PLAYER_MAIL_PRE_TW_BACKUP_TABLE],
    );
    if (existing.rows[0]?.reg != null) {
      return false;
    }
    await client.query(
      `CREATE TABLE ${PLAYER_MAIL_PRE_TW_BACKUP_TABLE} AS SELECT * FROM ${PLAYER_MAIL_TABLE}`,
    );
    return true;
  }

  private async updateSystemMailRow(
    client: PoolClient,
    entry: PendingConvertRow,
  ): Promise<{ rowCount: number | null }> {
    return client.query(
      `UPDATE ${PLAYER_MAIL_TABLE}
          SET title = $2,
              body = $3,
              sender_label = $4,
              updated_at = NOW()
        WHERE mail_id = $1
          AND sender_type = $5
          AND title IS NOT DISTINCT FROM $6
          AND body IS NOT DISTINCT FROM $7
          AND sender_label IS NOT DISTINCT FROM $8`,
      [
        entry.mailId,
        entry.convertedTitle,
        entry.convertedBody,
        entry.convertedSenderLabel,
        SYSTEM_SENDER_TYPE,
        entry.title,
        entry.body,
        entry.senderLabel,
      ],
    );
  }

  private async verifySkippedRows(
    client: PoolClient,
    skipped: SkipRow[],
    result: MailSnapshotTraditionalizeRunResult,
  ): Promise<number> {
    if (skipped.length === 0) {
      return 0;
    }
    const rows = await client.query(
      `SELECT mail_id,
              sender_type,
              sender_label,
              title,
              body
         FROM ${PLAYER_MAIL_TABLE}
        WHERE mail_id = ANY($1::varchar[])
        ORDER BY mail_id ASC`,
      [skipped.map((entry) => entry.mailId)],
    );
    const rowByMailId = new Map(
      rows.rows.map((row) => [normalizeRequiredString(row.mail_id), row]),
    );
    let failed = 0;
    for (const entry of skipped) {
      const row = rowByMailId.get(entry.mailId);
      const afterHash = row
        ? contentHash(
          normalizeNullableString(row.title),
          normalizeNullableString(row.body),
          normalizeNullableString(row.sender_label),
        )
        : '';
      if (!row || afterHash !== entry.contentHashAfter) {
        failed += 1;
        result.errors.push(`mail_skip_verify_failed:${entry.mailId}`);
      }
    }
    return failed;
  }

  private async countResidualSimplifiedRows(client: PoolClient): Promise<number> {
    const result = await client.query(
      `SELECT mail_id,
              sender_label,
              title,
              body
         FROM ${PLAYER_MAIL_TABLE}
        WHERE sender_type = $1
        ORDER BY mail_id ASC`,
      [SYSTEM_SENDER_TYPE],
    );
    let residual = 0;
    for (const row of result.rows) {
      if (
        hasSimplifiedContent(normalizeNullableString(row.title))
        || hasSimplifiedContent(normalizeNullableString(row.body))
        || hasSimplifiedContent(normalizeNullableString(row.sender_label))
      ) {
        residual += 1;
      }
    }
    return residual;
  }

  private async writeConversionMarker(
    client: PoolClient,
    result: MailSnapshotTraditionalizeRunResult,
  ): Promise<void> {
    await client.query(PLAYER_MAIL_CONVERSION_META_TABLE_SCHEMA);
    await client.query(
      `INSERT INTO ${PLAYER_MAIL_CONVERSION_META_TABLE}(
        conversion_key,
        batch_id,
        converted_at,
        converted_rows,
        skipped_rows,
        residual_simplified_rows,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (conversion_key) DO UPDATE
        SET converted_rows = EXCLUDED.converted_rows,
            skipped_rows = EXCLUDED.skipped_rows,
            residual_simplified_rows = EXCLUDED.residual_simplified_rows,
            payload = EXCLUDED.payload`,
      [
        MAIL_SNAPSHOT_TRADITIONALIZE_CONVERSION_ID,
        result.batchId,
        result.appliedAt,
        result.convertedRows,
        result.skippedRows,
        result.residualSimplifiedRows,
        JSON.stringify({
          mode: result.mode,
          backupTable: result.backupTable,
          backupTableCreated: result.backupTableCreated,
          errors: result.errors.slice(0, 20),
        }),
      ],
    );
  }

  private async recordAudit(
    result: MailSnapshotTraditionalizeRunResult,
    options: GmCompatConversionRunOptions,
  ): Promise<void> {
    if (!this.gmAuditLogPersistenceService) {
      return;
    }
    try {
      await this.gmAuditLogPersistenceService.recordEntry({
        op: `gm.compat.${MAIL_SNAPSHOT_TRADITIONALIZE_CONVERSION_ID}.${options.mode}`,
        targetType: 'compat_conversion',
        targetId: MAIL_SNAPSHOT_TRADITIONALIZE_CONVERSION_ID,
        actor: options.actor ?? { tokenRev: null, ip: null, userAgent: null, receivedAt: Date.now() },
        before: { mode: options.mode, scope: 'sender_type=system', columns: ['title', 'body', 'sender_label'] },
        after: {
          matchedRows: result.matchedRows,
          convertedRows: result.convertedRows,
          skippedRows: result.skippedRows,
          failedRows: result.failedRows,
          verifiedRows: result.verifiedRows,
          residualSimplifiedRows: result.residualSimplifiedRows,
          backupTableCreated: result.backupTableCreated,
          batchId: result.batchId,
        },
        delta: {
          sampleIds: result.samples.map((sample) => sample.id),
          errors: result.errors.slice(0, 20),
        },
        success: result.failedRows === 0,
        errorMessage: result.failedRows === 0 ? null : result.errors.slice(0, 3).join('; '),
      });
    } catch (error) {
      this.logger.warn(`系统邮件繁体化审计写入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function createBatchId(appliedAt: string): string {
  const compactTime = appliedAt.replace(/\D/g, '').slice(0, 14);
  return `mail-tw-${compactTime}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRequiredString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

function normalizeSafeInteger(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}
