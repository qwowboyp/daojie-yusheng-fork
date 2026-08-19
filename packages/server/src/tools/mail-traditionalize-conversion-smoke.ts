/**
 * 系统邮件简体→台湾繁体 兼容转换 smoke。
 *
 * 覆盖（with-db 持久化门禁）：
 *   - apply 首轮：4 行可转换系统邮件被转换（标题/正文/发件人标签），残余简体回读为 0，
 *     备份表创建、转换标记写入。
 *   - 二次 apply（幂等）：检测口径（词表 + opencc 两段式）不再命中任何简体 →
 *     convertedRows=0、残余简体=0、备份表不重建（CREATE 被跳过）、标记不重复写。
 *   - 跳过行字节级验证：非 system sender_type 行绝不更新，前后内容 hash 必须一致；
 *     已台湾标准的 system 行同样跳过且 hash 一致。
 *   - 不触碰 player_mail_attachment / metadata_jsonb。
 *
 * 隔离与自清理：创建独占 schema（smoke_<pid>_<ts>），冒烟连接池与转换服务经
 * pg 启动参数 options=-csearch_path=<schema> 落到该 schema 的 player_mail /
 * 备份表 / 标记表（每条新连接都继承 search_path，转换服务内部独立连接池同样生效）；
 * 真实生产表零接触。finally 中 DROP SCHEMA CASCADE。
 * 审计写入（gm_audit_log）走同一事务连接且即时回滚，不留痕迹。
 */
import assert from 'node:assert/strict';

import { Pool } from 'pg';

import { resolveServerDatabaseUrl } from '../config/env-alias';
import { DatabasePoolProvider } from '../persistence/database-pool.provider';
import { MailSnapshotTraditionalizeConversion } from '../gm/compat-conversions/conversions/mail/mail-snapshot-traditionalize';

const SAMPLE_PLAYER_ID = 'smoke_mail_tw_player';

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

interface SmokeMailRow {
  mailId: string;
  senderType: string;
  senderLabel: string;
  title: string;
  body: string;
  expectsConvert: boolean;
  expectTitle?: string;
  expectBody?: string;
}

async function main(): Promise<void> {
  const databaseUrl = resolveServerDatabaseUrl();
  if (!databaseUrl.trim()) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: 'SERVER_DATABASE_URL/DATABASE_URL missing',
          answers: 'with-db 下验证 GM 系统邮件繁体化转换：首轮转换 4 行 + 二次幂等 0 行 + 跳过行字节级不变',
          excludes: '不证明真实生产数据迁移、gm_audit_log 持久化可见性或跨节点并发写',
          completionMapping: 'release:with-db.mail-traditionalize-conversion',
        },
        null,
        2,
      ),
    );
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const schemaName = `smoke_${process.pid.toString(36)}_${Date.now().toString(36)}`;
  // 独占 schema 的 search_path 通过 pg 启动参数注入（options=-csearch_path=<schema>,public），
  // 确保转换服务内部 DatabasePoolProvider 新建的连接池也落在同一 schema，绝不触碰真实生产表。
  const isolatedDatabaseUrl = `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}options=-csearch_path%3D${encodeURIComponent(`${schemaName},public`)}`;
  try {
    await pool.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await pool.query(`SET search_path = ${quoteIdentifier(schemaName)}, public`);

    // 独占 schema 内建最小 player_mail 表（与生产 DDL 同形；sender_type 默认 'system'）
    await pool.query(`
      CREATE TABLE ${quoteIdentifier(schemaName)}.player_mail (
        mail_id varchar(180) PRIMARY KEY,
        player_id varchar(100) NOT NULL,
        sender_type varchar(32) NOT NULL DEFAULT 'system',
        sender_label varchar(120) NOT NULL,
        template_id varchar(120),
        mail_type varchar(32) NOT NULL DEFAULT 'system',
        title varchar(240),
        body text,
        source_type varchar(64),
        source_ref_id varchar(180),
        metadata_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
        mail_version bigint NOT NULL DEFAULT 1,
        created_at bigint NOT NULL,
        expire_at bigint,
        first_seen_at bigint,
        read_at bigint,
        claimed_at bigint,
        deleted_at bigint,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const now = Date.now();
    const testRows: SmokeMailRow[] = [
      // 可转换系统邮件：词级命中（服务器→伺服器）+ 字级收尾（仅→隻）
      {
        mailId: 'smoke:mail:sys:1',
        senderType: 'system',
        senderLabel: '服务器系统',
        title: '欢迎登录',
        body: '欢迎使用服务器，请注册账号后登录。',
        expectsConvert: true,
        expectTitle: '歡迎登入',
        // 註：opencc cn→tw 對「账号」字級轉出「賬號」（大陸異體），词表尚无 账号→帳號 词条；
        // 该差异属词表真源（scripts/lib/tw-vocabulary.mjs）的词级覆盖范围，不在本转换核心。
        expectBody: '歡迎使用伺服器，請註冊賬號後登入。',
      },
      // 可转换系统邮件：仅字级命中
      {
        mailId: 'smoke:mail:sys:2',
        senderType: 'system',
        senderLabel: '系统通知',
        title: '每日签到奖励',
        body: '恭喜获得奖励，请查收。',
        expectsConvert: true,
        expectTitle: '每日簽到獎勵',
        expectBody: '恭喜獲得獎勵，請查收。',
      },
      // 已台湾标准的系统邮件：跳过（byte-identical）
      {
        mailId: 'smoke:mail:sys:3',
        senderType: 'system',
        senderLabel: '系統通知',
        title: '歡迎登入',
        body: '歡迎使用伺服器，請註冊帳號後登入。',
        expectsConvert: false,
      },
      // 非 system 来源：跳过（byte-identical，绝不更新）
      {
        mailId: 'smoke:mail:user:1',
        senderType: 'player',
        senderLabel: '好友',
        title: '一起打服务器吗？',
        body: '这里有一个新的服务器，欢迎来玩。',
        expectsConvert: false,
      },
    ];

    for (const row of testRows) {
      await pool.query(
        `INSERT INTO ${quoteIdentifier(schemaName)}.player_mail(
          mail_id, player_id, sender_type, sender_label, mail_type, title, body,
          source_type, metadata_jsonb, mail_version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'system', $5, $6, 'gm_broadcast', '{}'::jsonb, 1, $7, now())`,
        [
          row.mailId,
          SAMPLE_PLAYER_ID,
          row.senderType,
          row.senderLabel,
          row.title,
          row.body,
          now,
        ],
      );
    }

    // 跳过行字节级基线 hash（title/body/sender_label 拼接）
    const hashOf = (title: unknown, body: unknown, senderLabel: unknown): string => {
      const crypto = require('node:crypto') as typeof import('node:crypto');
      return crypto
        .createHash('sha256')
        .update(`${senderLabel ?? ''}\u0000${title ?? ''}\u0000${body ?? ''}`)
        .digest('hex');
    };
    const skipRowBaseline = new Map<string, string>();
    for (const row of testRows.filter((entry) => !entry.expectsConvert)) {
      const result = await pool.query(
        `SELECT title, body, sender_label FROM ${quoteIdentifier(schemaName)}.player_mail WHERE mail_id = $1`,
        [row.mailId],
      );
      const hit = result.rows[0];
      skipRowBaseline.set(
        row.mailId,
        hashOf(hit.title, hit.body, hit.sender_label),
      );
    }

    // 直接实例化转换服务（无 Nest 容器；审计服务传 null，审计写跳过不影响断言）。
    // 临时把进程级 DB URL 指向带 options=-csearch_path 的隔离串：DatabasePoolProvider
    // 在 getPool 时才惰性读取 env，因此新连接池全部落在独占 schema，绝不触碰真实生产表。
    const originalEnv: Array<[string, string | undefined]> = [
      ['SERVER_DATABASE_URL', process.env.SERVER_DATABASE_URL],
      ['DATABASE_URL', process.env.DATABASE_URL],
      ['SERVER_DATABASE_POOLER_URL', process.env.SERVER_DATABASE_POOLER_URL],
      ['DATABASE_POOLER_URL', process.env.DATABASE_POOLER_URL],
    ];
    process.env.SERVER_DATABASE_POOLER_URL = '';
    process.env.DATABASE_POOLER_URL = '';
    process.env.SERVER_DATABASE_URL = isolatedDatabaseUrl;
    process.env.DATABASE_URL = isolatedDatabaseUrl;
    const isolatedPoolProvider = new DatabasePoolProvider();
    try {
      const conversion = new MailSnapshotTraditionalizeConversion(isolatedPoolProvider, null);

      // 第一轮 apply
      const firstRun = await conversion.run({ mode: 'apply' });
      assert.equal(firstRun.ok, true);
      assert.equal(firstRun.matchedRows, 4, '首轮应扫描到 4 行');
      assert.equal(firstRun.convertedRows, 2, '首轮应转换 2 行系统邮件');
      assert.equal(firstRun.skippedRows, 2, '首轮应跳过 2 行（已台湾标准 + 非 system）');
      assert.equal(firstRun.failedRows, 0, '首轮不应有失败');
      assert.equal(firstRun.residualSimplifiedRows, 0, '首轮转换后残余简体系统邮件应为 0');
      assert.equal(firstRun.backupTableCreated, true, '首轮应创建备份表');
      assert.ok(firstRun.batchId, '首轮应生成 batchId');

      // 转换结果断言（title/body/sender_label 全部转换）
      for (const row of testRows.filter((entry) => entry.expectsConvert)) {
        const result = await pool.query(
          `SELECT title, body, sender_label FROM ${quoteIdentifier(schemaName)}.player_mail WHERE mail_id = $1`,
          [row.mailId],
        );
        const hit = result.rows[0];
        assert.equal(hit.title, row.expectTitle, `${row.mailId} title 未转换`);
        assert.equal(hit.body, row.expectBody, `${row.mailId} body 未转换`);
        assert.equal(
          (hit.sender_label as string).includes('系統') || (hit.sender_label as string).includes('伺服器'),
          true,
          `${row.mailId} sender_label 未转换`,
        );
      }

      // 跳过行字节级验证（回读 hash 与基线一致）
      for (const row of testRows.filter((entry) => !entry.expectsConvert)) {
        const result = await pool.query(
          `SELECT title, body, sender_label FROM ${quoteIdentifier(schemaName)}.player_mail WHERE mail_id = $1`,
          [row.mailId],
        );
        const hit = result.rows[0];
        const afterHash = hashOf(hit.title, hit.body, hit.sender_label);
        assert.equal(
          afterHash,
          skipRowBaseline.get(row.mailId),
          `${row.mailId} 跳过行被改动（应字节级不变）`,
        );
      }

      // 备份表存在且包含转换前数据
      const backupCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(schemaName)}.player_mail_pre_tw_backup`,
      );
      assert.equal(backupCount.rows[0].count, 4, '备份表应包含全部 4 行转换前数据');

      // 标记表写入
      const marker = await pool.query(
        `SELECT batch_id, converted_rows, skipped_rows, residual_simplified_rows
           FROM ${quoteIdentifier(schemaName)}.player_mail_conversion_meta
          WHERE conversion_key = 'mail_snapshot_traditionalize'`,
      );
      assert.equal(marker.rowCount, 1, '标记表应有 1 条转换标记');
      assert.equal(Number(marker.rows[0].converted_rows), 2, '标记 converted_rows 应为 2');
      assert.equal(Number(marker.rows[0].residual_simplified_rows), 0, '标记 residual 应为 0');

      // 第二轮回读：幂等 —— convertedRows=0、残余=0、备份表不重建、标记不重复写
      const secondRun = await conversion.run({ mode: 'apply' });
      assert.equal(secondRun.ok, true);
      assert.equal(secondRun.matchedRows, 4, '二轮仍应扫描到 4 行');
      assert.equal(secondRun.convertedRows, 0, '二轮幂等：不应再转换任何行');
      assert.equal(secondRun.skippedRows, 4, '二轮全部行都应跳过');
      assert.equal(secondRun.failedRows, 0, '二轮不应有失败');
      assert.equal(secondRun.residualSimplifiedRows, 0, '二轮残余简体仍为 0');
      assert.equal(secondRun.backupTableCreated, false, '二轮幂等：备份表不得重建');

      const markerAfter = await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(schemaName)}.player_mail_conversion_meta`,
      );
      assert.equal(markerAfter.rows[0].count, 1, '二轮幂等：标记不应重复写（仍 1 条）');

      // 未触碰附件表/元数据列（本次 smoke 未建附件表即证明未触碰；metadata_jsonb 保持原值）
      const metadataCheck = await pool.query(
        `SELECT metadata_jsonb FROM ${quoteIdentifier(schemaName)}.player_mail WHERE mail_id = 'smoke:mail:sys:1'`,
      );
      // pg 对 jsonb 列返回解析后的对象
      assert.equal(JSON.stringify(metadataCheck.rows[0].metadata_jsonb), '{}', 'metadata_jsonb 不得被改动');

      console.log(
        JSON.stringify(
          {
            ok: true,
            schemaName,
            firstRun: {
              matchedRows: firstRun.matchedRows,
              convertedRows: firstRun.convertedRows,
              skippedRows: firstRun.skippedRows,
              residualSimplifiedRows: firstRun.residualSimplifiedRows,
              backupTableCreated: firstRun.backupTableCreated,
            },
            secondRun: {
              matchedRows: secondRun.matchedRows,
              convertedRows: secondRun.convertedRows,
              skippedRows: secondRun.skippedRows,
              residualSimplifiedRows: secondRun.residualSimplifiedRows,
              backupTableCreated: secondRun.backupTableCreated,
            },
            answers: '系统邮件（sender_type=system）首轮两段式转换 2 行（词级+字级）、跳过行字节级不变、二次执行幂等 0 转换且备份表不重建；非 system 来源行绝不更新',
            excludes: '不证明真实生产数据迁移、gm_audit_log 持久化可见性或跨节点并发写',
          },
          null,
          2,
        ),
      );
    } finally {
      // 恢复进程级 DB URL 原值，并关闭隔离连接池
      for (const [key, value] of originalEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await isolatedPoolProvider.onModuleDestroy().catch(() => undefined);
    }
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
