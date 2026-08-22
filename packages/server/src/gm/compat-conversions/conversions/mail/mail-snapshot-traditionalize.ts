/**
 * 系统邮件简体 → 台湾繁体 一键兼容转换。
 *
 * 范围：同时处理 player_mail 与 player_mail_archive 中 sender_type = 'system' 的行，
 * 转换列仅 title / body / sender_label；其它 sender_type（unknown / 玩家来源等）
 * 逐行跳过并做字节级 hash 前后比对验证（byte-identical）。
 * 不触碰 player_mail_attachment(_archive)（仅 itemId/count）、metadata_jsonb、skill-snapshot 表。
 * 这是 GM 手动一次性运维入口，不在 tick 热路径。
 *
 * 转换算法：两段式 —— 先词级（VOCABULARY_CN_TO_TW 最长匹配：服务器→伺服器 等 17 词），
 * 再字级（opencc-js Converter({from:'cn',to:'tw'}) 收尾），转换前对台湾标准保护词
 * （濃郁 / 馥郁 / 岩）做哨兵掩码，避免 opencc 非幂等误转。两张表共用同一套检测与转换口径。
 *
 * apply 流程（单事务覆盖两张表，全有或全无）：每表建独立备份表
 * （player_mail_pre_tw_backup / player_mail_archive_pre_tw_backup，已存在则跳过不重建）→
 * 对 JS 检测到简体内容的系统邮件逐行 UPDATE（CAS 防漂移：任一行漂移即抛出）→
 * 跳过行回读字节级 hash 验证（任一失败即抛出）→ 回读残余简体系统邮件数
 * （与转换相同的 JS 检测口径，> 0 即抛出）。任何一处抛出都让外层 catch 回滚整个事务：
 * 两张表的数据、备份表与转换标记全部不落库，结果以 ok:false 返回。
 * 每表写固定转换标记（gm_audit_log 审计 + player_mail_conversion_meta 标记表，
 * conversion_key = <conversion_id>:<table>），仅在两表全部成功后随 COMMIT 一并落库。
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

const PLAYER_MAIL_CONVERSION_META_TABLE = 'player_mail_conversion_meta';
const SYSTEM_SENDER_TYPE = 'system';
const SAMPLE_LIMIT = 10;

/**
 * 参与转换的邮件表描述符：player_mail 与 player_mail_archive 走同一套管线，
 * 仅表名 / 备份表名 / 时间戳列不同（archive 表只有 archived_at，没有 updated_at）。
 */
interface MailTableDescriptor {
  tableName: string;
  backupTable: string;
  /** 该表是否有 updated_at 列（UPDATE 时是否同步刷新；archive 表不得触碰时间戳列）。 */
  hasUpdatedAtColumn: boolean;
}

const MAIL_TABLE_DESCRIPTORS: readonly MailTableDescriptor[] = [
  // 在线信箱表（player_mail.updated_at 由 UPDATE 刷新）
  { tableName: 'player_mail', backupTable: 'player_mail_pre_tw_backup', hasUpdatedAtColumn: true },
  // 归档信箱表（player_mail_archive 只有 archived_at，UPDATE 不触碰任何时间戳列）
  {
    tableName: 'player_mail_archive',
    backupTable: 'player_mail_archive_pre_tw_backup',
    hasUpdatedAtColumn: false,
  },
];

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

/** 单张表的转换明细（结果负载里的逐表 breakdown）。 */
export interface MailSnapshotTraditionalizeTableResult {
  tableName: string;
  backupTable: string;
  backupTableCreated: boolean;
  matchedRows: number;
  convertedRows: number;
  skippedRows: number;
  residualSimplifiedRows: number;
}

export interface MailSnapshotTraditionalizeRunResult extends Omit<GmCompatConversionRunResult, 'ok'> {
  /** dry-run 与成功 apply 恒为 true；apply 失败（整体回滚两表）时为 false。 */
  ok: boolean;
  batchId: string | null;
  /** 两张表的逐表明细（player_mail / player_mail_archive）。 */
  tables: MailSnapshotTraditionalizeTableResult[];
  /** 全部表残余简体系统邮件总数（逐表之和）。 */
  residualSimplifiedRows: number;
}

interface MailCandidateRow {
  tableName: string;
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
  tableName: string;
  mailId: string;
  title: string | null;
  body: string | null;
  senderLabel: string | null;
  convertedTitle: string | null;
  convertedBody: string | null;
  convertedSenderLabel: string | null;
}

interface SkipRow {
  tableName: string;
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
  tables: [],
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

    // 预扫描两张表（dry-run 与 apply 共用同一 JS 检测口径）
    const rowsByTable = new Map<string, MailCandidateRow[]>();
    for (const descriptor of MAIL_TABLE_DESCRIPTORS) {
      rowsByTable.set(descriptor.tableName, await this.loadMailRows(pool, descriptor));
    }
    this.populateScanResult(result, rowsByTable);

    if (options.mode === 'dry-run') {
      // dry-run 同样给出逐表 breakdown（backupTableCreated / residual 仅在 apply 阶段有意义）
      for (const descriptor of MAIL_TABLE_DESCRIPTORS) {
        const rows = rowsByTable.get(descriptor.tableName) ?? [];
        result.tables.push({
          tableName: descriptor.tableName,
          backupTable: descriptor.backupTable,
          backupTableCreated: false,
          matchedRows: rows.length,
          convertedRows: rows.filter((row) => row.can_convert).length,
          skippedRows: rows.filter((row) => !row.can_convert).length,
          residualSimplifiedRows: 0,
        });
      }
      await this.recordAudit(result, options);
      return result;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 逐表执行同一套转换管线（备份 → CAS 更新 → 跳过行验证 → 残余回读）
      for (const descriptor of MAIL_TABLE_DESCRIPTORS) {
        result.tables.push(
          await this.convertSingleTable(client, descriptor, rowsByTable.get(descriptor.tableName) ?? [], result),
        );
      }
      result.residualSimplifiedRows = result.tables.reduce(
        (sum, table) => sum + table.residualSimplifiedRows,
        0,
      );
      // 聚合实际转换数（扫描期是预估，CAS 漂移会让实际数低于预估）
      result.convertedRows = result.tables.reduce((sum, table) => sum + table.convertedRows, 0);
      result.verifiedRows = result.convertedRows;
      result.appliedAt = new Date().toISOString();
      result.batchId = createBatchId(result.appliedAt);

      // 固定转换标记：每表一条（conversion_key = <conversion_id>:<table>），防二次执行重复建备份表
      await client.query(PLAYER_MAIL_CONVERSION_META_TABLE_SCHEMA);
      for (const table of result.tables) {
        await this.writeConversionMarker(client, table, result);
      }

      await client.query('COMMIT');
    } catch (error) {
      // 全有或全无：任一表 CAS 漂移 / 跳过行验证失败 / 残余简体 > 0 抛出后，
      // 整体回滚两张表（数据、备份表、转换标记全部不落库），结果以 ok:false 返回。
      await client.query('ROLLBACK').catch(() => undefined);
      result.ok = false;
      result.convertedRows = 0;
      result.failedRows = Math.max(result.failedRows, 1);
      result.errors.push(error instanceof Error ? error.message : String(error));
      this.logger.error(`系统邮件繁体化转换失败并已回滚：${result.errors[result.errors.length - 1]}`);
      await this.recordAudit(result, options);
      return result;
    } finally {
      client.release();
    }

    const tablesSummary = result.tables
      .map((table) => `${table.tableName}(转换 ${table.convertedRows}/跳过 ${table.skippedRows})`)
      .join('，');
    this.logger.log(
      `系统邮件繁体化完成：命中 ${result.matchedRows}，转换 ${result.convertedRows}，`
      + `跳过 ${result.skippedRows}，验证 ${result.verifiedRows}，残余简体 ${result.residualSimplifiedRows}，`
      + `明细 ${tablesSummary}`,
    );
    await this.recordAudit(result, options);
    return result;
  }

  /**
   * 单表转换管线：建备份表 → 分类（待转/跳过）→ 逐行 CAS 更新 → 跳过行字节级回读验证 →
   * 残余简体回读计数。全有或全无：CAS 漂移、跳过行验证失败、残余简体 > 0 任一发生即抛出，
   * 由外层 run() 统一回滚整个事务（两张表一起回退），绝不部分提交。
   */
  private async convertSingleTable(
    client: PoolClient,
    descriptor: MailTableDescriptor,
    rows: MailCandidateRow[],
    result: MailSnapshotTraditionalizeRunResult,
  ): Promise<MailSnapshotTraditionalizeTableResult> {
    const tableResult: MailSnapshotTraditionalizeTableResult = {
      tableName: descriptor.tableName,
      backupTable: descriptor.backupTable,
      backupTableCreated: false,
      matchedRows: rows.length,
      convertedRows: 0,
      skippedRows: rows.filter((row) => !row.can_convert).length,
      residualSimplifiedRows: 0,
    };
    tableResult.backupTableCreated = await this.ensureBackupTable(client, descriptor);

    const pending: PendingConvertRow[] = [];
    const skipped: SkipRow[] = [];
    for (const row of rows) {
      if (!row.is_system) {
        // 非系统来源行：绝不更新，记录前后字节 hash 用于回读验证
        skipped.push({
          tableName: descriptor.tableName,
          mailId: row.mail_id,
          contentHashBefore: row.content_hash,
          contentHashAfter: row.content_hash,
        });
        continue;
      }
      if (!row.can_convert) {
        // 系统行但已是台湾标准（无简体）：跳过，前后 hash 必须一致
        skipped.push({
          tableName: descriptor.tableName,
          mailId: row.mail_id,
          contentHashBefore: row.content_hash,
          contentHashAfter: row.content_hash,
        });
        continue;
      }
      pending.push({
        tableName: descriptor.tableName,
        mailId: row.mail_id,
        title: row.title,
        body: row.body,
        senderLabel: row.sender_label,
        convertedTitle: row.converted_title,
        convertedBody: row.converted_body,
        convertedSenderLabel: row.converted_sender_label,
      });
    }

    // 逐行 CAS 更新（WHERE 携带原文快照）。任一行漂移（更新命中 0 行）即抛出：
    // 行内容在扫描后被并发改动，继续转换会造成部分提交，必须整体回滚。
    let convertedCount = 0;
    for (const entry of pending) {
      const updated = await this.updateSystemMailRow(client, descriptor, entry);
      if ((updated.rowCount ?? 0) !== 1) {
        throw new Error(
          `${descriptor.tableName}_convert_row_drift:${entry.mailId}`
          + '（CAS 防漂移：行内容与扫描快照不一致，UPDATE 命中 0 行，本次转换整体回滚）',
        );
      }
      convertedCount += 1;
    }
    tableResult.convertedRows = convertedCount;

    // 跳过行回读字节级验证（byte-identical：非 system 行 + 已台湾标准行）
    await this.verifySkippedRows(client, descriptor, skipped);

    // 回读验证：该表残余简体系统邮件必须为 0（与转换相同的 JS 检测口径）
    tableResult.residualSimplifiedRows = await this.countResidualSimplifiedRows(client, descriptor);
    if (tableResult.residualSimplifiedRows > 0) {
      throw new Error(
        `${descriptor.tableName}_residual_simplified_rows:${tableResult.residualSimplifiedRows}`
        + '（转换后仍检测到简体系统邮件，违反转换后不变量，本次转换整体回滚）',
      );
    }

    return tableResult;
  }

  /** 装载单表全部邮件行：system 行做简体检测；非 system 行标记跳过（字节级验证）。 */
  private async loadMailRows(pool: Pool, descriptor: MailTableDescriptor): Promise<MailCandidateRow[]> {
    const result = await pool.query(
      `SELECT mail_id,
              sender_type,
              sender_label,
              title,
              body
         FROM ${descriptor.tableName}
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
        tableName: descriptor.tableName,
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
    rowsByTable: Map<string, MailCandidateRow[]>,
  ): void {
    for (const rows of rowsByTable.values()) {
      result.matchedRows += rows.length;
      result.skippedRows += rows.filter((row) => !row.can_convert).length;
      result.convertedRows += rows.filter((row) => row.can_convert).length;
      for (const row of rows) {
        if (!row.can_convert || result.samples.length >= SAMPLE_LIMIT) {
          continue;
        }
        result.samples.push({
          id: `${row.tableName}:${row.mail_id}`,
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
  }

  private async ensureBackupTable(
    client: PoolClient,
    descriptor: MailTableDescriptor,
  ): Promise<boolean> {
    const existing = await client.query(
      'SELECT to_regclass($1::text) AS reg',
      [descriptor.backupTable],
    );
    if (existing.rows[0]?.reg != null) {
      return false;
    }
    await client.query(
      `CREATE TABLE ${descriptor.backupTable} AS SELECT * FROM ${descriptor.tableName}`,
    );
    return true;
  }

  private async updateSystemMailRow(
    client: PoolClient,
    descriptor: MailTableDescriptor,
    entry: PendingConvertRow,
  ): Promise<{ rowCount: number | null }> {
    // archive 表没有 updated_at 列（只有 archived_at），UPDATE 不得触碰时间戳列
    const updatedAtClause = descriptor.hasUpdatedAtColumn ? ',\n              updated_at = NOW()' : '';
    return client.query(
      `UPDATE ${descriptor.tableName}
          SET title = $2,
              body = $3,
              sender_label = $4${updatedAtClause}
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

  /** 跳过行字节级回读验证：任一行缺失或 hash 不一致即抛出（整体回滚）。 */
  private async verifySkippedRows(
    client: PoolClient,
    descriptor: MailTableDescriptor,
    skipped: SkipRow[],
  ): Promise<void> {
    if (skipped.length === 0) {
      return;
    }
    const rows = await client.query(
      `SELECT mail_id,
              sender_type,
              sender_label,
              title,
              body
         FROM ${descriptor.tableName}
        WHERE mail_id = ANY($1::varchar[])
        ORDER BY mail_id ASC`,
      [skipped.map((entry) => entry.mailId)],
    );
    const rowByMailId = new Map(
      rows.rows.map((row) => [normalizeRequiredString(row.mail_id), row]),
    );
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
        throw new Error(
          `${descriptor.tableName}_skip_verify_failed:${entry.mailId}`
          + '（跳过行字节级验证失败：内容在扫描后被并发改动或行已消失，本次转换整体回滚）',
        );
      }
    }
  }

  private async countResidualSimplifiedRows(
    client: PoolClient,
    descriptor: MailTableDescriptor,
  ): Promise<number> {
    const result = await client.query(
      `SELECT mail_id,
              sender_label,
              title,
              body
         FROM ${descriptor.tableName}
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
    table: MailSnapshotTraditionalizeTableResult,
    result: MailSnapshotTraditionalizeRunResult,
  ): Promise<void> {
    // conversion_key 按表区分：<conversion_id>:<table>
    const conversionKey = `${MAIL_SNAPSHOT_TRADITIONALIZE_CONVERSION_ID}:${table.tableName}`;
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
        SET batch_id = EXCLUDED.batch_id,
            converted_at = EXCLUDED.converted_at,
            converted_rows = EXCLUDED.converted_rows,
            skipped_rows = EXCLUDED.skipped_rows,
            residual_simplified_rows = EXCLUDED.residual_simplified_rows,
            payload = EXCLUDED.payload`,
      [
        conversionKey,
        result.batchId,
        result.appliedAt,
        table.convertedRows,
        table.skippedRows,
        table.residualSimplifiedRows,
        JSON.stringify({
          mode: result.mode,
          tableName: table.tableName,
          backupTable: table.backupTable,
          backupTableCreated: table.backupTableCreated,
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
        before: {
          mode: options.mode,
          scope: "sender_type='system' tables=player_mail+player_mail_archive",
          columns: ['title', 'body', 'sender_label'],
        },
        after: {
          matchedRows: result.matchedRows,
          convertedRows: result.convertedRows,
          skippedRows: result.skippedRows,
          failedRows: result.failedRows,
          verifiedRows: result.verifiedRows,
          residualSimplifiedRows: result.residualSimplifiedRows,
          tables: result.tables.map((table) => ({
            tableName: table.tableName,
            backupTable: table.backupTable,
            backupTableCreated: table.backupTableCreated,
            matchedRows: table.matchedRows,
            convertedRows: table.convertedRows,
            skippedRows: table.skippedRows,
            residualSimplifiedRows: table.residualSimplifiedRows,
          })),
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
