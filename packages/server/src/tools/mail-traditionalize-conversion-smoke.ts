/**
 * 系统邮件简体→台湾繁体 兼容转换 smoke。
 *
 * 覆盖（with-db 持久化门禁）：
 *   - apply 首轮：player_mail 2 行 + player_mail_archive 1 行可转换系统邮件被转换
 *     （标题/正文/发件人标签），两表残余简体回读为 0，两张备份表创建、逐表转换标记写入。
 *   - 二次 apply（幂等）：检测口径（词表 + opencc 两段式）不再命中任何简体 →
 *     convertedRows=0、残余简体=0、备份表不重建（CREATE 被跳过）、标记不重复写。
 *   - 跳过行字节级验证：非 system sender_type 行绝不更新，前后内容 hash 必须一致；
 *     已台湾标准的 system 行同样跳过且 hash 一致（active 与 archive 两表都覆盖）。
 *   - archive 表时间戳列不被触碰：player_mail_archive 只有 archived_at（无 updated_at），
 *     转换前后 archived_at 必须完全一致。
 *   - CAS 漂移全有或全无：构造「分类命中但 UPDATE 谓词失配」的行（sender_label 置空串，
 *     扫描期归一化为 null 与存储值 '' 在 IS NOT DISTINCT FROM 下失配 → 命中 0 行）→
 *     apply 必须整体回滚：两张表数据保持简体原状、备份表与标记表不残留（事务内 CREATE
 *     一并回滚）、结果 ok:false；解除投毒后干净重跑完整成功。
 *   - 残余简体 > 0 抛出路径未在 smoke 构造：残余检测与分类/转换共用同一 JS 口径，
 *     成功 UPDATE 写入的值即转换器输出，仅当出现保护词表之外的新 opencc 非幂等对才会
 *     触发，无法廉价确定性构造；该路径与 CAS 漂移共用同一外层 throw→rollback 机制。
 *   - 不触碰 player_mail_attachment(_archive) / metadata_jsonb。
 *
 * 隔离与自清理：创建独占 schema（smoke_<pid>_<ts>），冒烟连接池与转换服务经
 * pg 启动参数 options=-csearch_path=<schema> 落到该 schema 的 player_mail /
 * player_mail_archive / 备份表 / 标记表（每条新连接都继承 search_path，
 * 转换服务内部独立连接池同样生效）；真实生产表零接触。finally 中 DROP SCHEMA CASCADE。
 * 审计写入（gm_audit_log）走同一事务连接且即时回滚，不留痕迹。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Pool } from 'pg';

import { resolveServerDatabaseUrl } from '../config/env-alias';
import { DatabasePoolProvider } from '../persistence/database-pool.provider';
import { MailSnapshotTraditionalizeConversion } from '../gm/compat-conversions/conversions/mail/mail-snapshot-traditionalize';

const SAMPLE_PLAYER_ID = 'smoke_mail_tw_player';

type SmokeMailTable = 'player_mail' | 'player_mail_archive';

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

interface SmokeMailRow {
  table: SmokeMailTable;
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
          answers: 'with-db 下验证 GM 系统邮件繁体化转换：双表（player_mail + player_mail_archive）首轮转换 3 行 + 二次幂等 0 行 + 跳过行字节级不变',
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

    // 独占 schema 内建最小 player_mail / player_mail_archive 表（与生产 DDL 同形；
    // sender_type 默认 'system'；archive 表只有 archived_at、没有 updated_at）
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
    await pool.query(`
      CREATE TABLE ${quoteIdentifier(schemaName)}.player_mail_archive (
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
        archived_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const now = Date.now();
    const testRows: SmokeMailRow[] = [
      // ---- player_mail（在线信箱表）----
      // 可转换系统邮件：词级命中（服务器→伺服器）+ 字级收尾（仅→隻）
      {
        table: 'player_mail',
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
        table: 'player_mail',
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
        table: 'player_mail',
        mailId: 'smoke:mail:sys:3',
        senderType: 'system',
        senderLabel: '系統通知',
        title: '歡迎登入',
        body: '歡迎使用伺服器，請註冊帳號後登入。',
        expectsConvert: false,
      },
      // 非 system 来源：跳过（byte-identical，绝不更新）
      {
        table: 'player_mail',
        mailId: 'smoke:mail:user:1',
        senderType: 'player',
        senderLabel: '好友',
        title: '一起打服务器吗？',
        body: '这里有一个新的服务器，欢迎来玩。',
        expectsConvert: false,
      },
      // ---- player_mail_archive（归档信箱表）----
      // 可转换系统邮件：词级命中（服务器→伺服器）
      {
        table: 'player_mail_archive',
        mailId: 'smoke:mail:arch:sys:1',
        senderType: 'system',
        senderLabel: '服务器系统',
        title: '历史邮件归档通知',
        body: '您的邮件已归档，请查收附件。',
        expectsConvert: true,
        expectTitle: '歷史郵件歸檔通知',
        expectBody: '您的郵件已歸檔，請查收附件。',
      },
      // 已台湾标准的系统邮件：跳过（byte-identical）
      {
        table: 'player_mail_archive',
        mailId: 'smoke:mail:arch:sys:2',
        senderType: 'system',
        senderLabel: '系統通知',
        title: '每日簽到獎勵',
        body: '恭喜獲得獎勵，請查收。',
        expectsConvert: false,
      },
      // 非 system 来源：跳过（byte-identical，绝不更新）
      {
        table: 'player_mail_archive',
        mailId: 'smoke:mail:arch:user:1',
        senderType: 'player',
        senderLabel: '好友',
        title: '一起打服务器吗？',
        body: '这里有一个新的服务器，欢迎来玩。',
        expectsConvert: false,
      },
    ];

    for (const row of testRows) {
      // player_mail 只有 updated_at；player_mail_archive 只有 archived_at（与生产 DDL 同形）
      const timestampColumn = row.table === 'player_mail' ? 'updated_at' : 'archived_at';
      await pool.query(
        `INSERT INTO ${quoteIdentifier(schemaName)}.${row.table}(
          mail_id, player_id, sender_type, sender_label, mail_type, title, body,
          source_type, metadata_jsonb, mail_version, created_at, ${timestampColumn}
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

    // 跳过行字节级基线 hash（title/body/sender_label 拼接；两表的跳过行都记录）
    const hashOf = (title: unknown, body: unknown, senderLabel: unknown): string =>
      createHash('sha256')
        .update(`${senderLabel ?? ''}\u0000${title ?? ''}\u0000${body ?? ''}`)
        .digest('hex');
    const skipRowBaseline = new Map<string, string>();
    for (const row of testRows.filter((entry) => !entry.expectsConvert)) {
      const result = await pool.query(
        `SELECT title, body, sender_label FROM ${quoteIdentifier(schemaName)}.${row.table} WHERE mail_id = $1`,
        [row.mailId],
      );
      const hit = result.rows[0];
      skipRowBaseline.set(row.mailId, hashOf(hit.title, hit.body, hit.sender_label));
    }

    // archive 行转换前 archived_at 基线（UPDATE 不得触碰时间戳列）
    const archivedAtBaseline = new Map<string, string>();
    for (const row of testRows.filter((entry) => entry.table === 'player_mail_archive')) {
      const result = await pool.query(
        `SELECT archived_at FROM ${quoteIdentifier(schemaName)}.player_mail_archive WHERE mail_id = $1`,
        [row.mailId],
      );
      archivedAtBaseline.set(row.mailId, (result.rows[0].archived_at as Date).toISOString());
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

      // dry-run 预检：只报数不改库
      const dryRun = await conversion.run({ mode: 'dry-run' });
      assert.equal(dryRun.ok, true);
      assert.equal(dryRun.matchedRows, 7, 'dry-run 应扫描到双表共 7 行');
      assert.equal(dryRun.convertedRows, 3, 'dry-run 应报出 3 行可转换');
      assert.equal(dryRun.tables.length, 2, 'dry-run 应给出双表 breakdown');
      const dryMailTable = dryRun.tables.find((table) => table.tableName === 'player_mail');
      const dryArchiveTable = dryRun.tables.find((table) => table.tableName === 'player_mail_archive');
      assert.ok(dryMailTable && dryArchiveTable, 'dry-run breakdown 应含两张表');
      assert.equal(dryArchiveTable.convertedRows, 1, 'dry-run 应报出 archive 表 1 行可转换');

      // ---- CAS 漂移案例：分类命中但 UPDATE 谓词失配 → 整体抛出回滚（全有或全无）----
      // 确定性构造（无并发时序依赖）：把 sys:1 的 sender_label 置为空串。
      // 扫描期 normalizeNullableString('') 归一化为 null 参与 CAS 快照，
      // UPDATE 谓词 sender_label IS NOT DISTINCT FROM NULL 对存储值 '' 判 false
      // → 命中 0 行 → 抛出 player_mail_convert_row_drift，外层回滚整个事务。
      await pool.query(
        `UPDATE ${quoteIdentifier(schemaName)}.player_mail SET sender_label = '' WHERE mail_id = $1`,
        ['smoke:mail:sys:1'],
      );
      const driftRun = await conversion.run({ mode: 'apply' });
      assert.equal(driftRun.ok, false, 'CAS 漂移必须以 ok:false 返回');
      assert.equal(driftRun.matchedRows, 7, '失败批次仍应报告扫描命中数');
      assert.equal(driftRun.convertedRows, 0, 'CAS 漂移后不得报告任何已转换行');
      assert.equal(driftRun.batchId, null, '失败批次不得生成 batchId');
      assert.equal(driftRun.tables.length, 0, '失败批次不得产出逐表 breakdown（抛出点之前的表也不返回）');
      assert.ok(
        driftRun.errors.some((entry) => entry.includes('player_mail_convert_row_drift:smoke:mail:sys:1')),
        `错误应含 CAS 漂移明细，实际：${JSON.stringify(driftRun.errors)}`,
      );

      // 回滚断言：两张表全部保持转换前简体原状（player_mail 已开始的更新也必须回退）
      for (const row of testRows.filter((entry) => entry.expectsConvert)) {
        const result = await pool.query(
          `SELECT title, body FROM ${quoteIdentifier(schemaName)}.${row.table} WHERE mail_id = $1`,
          [row.mailId],
        );
        assert.equal(result.rows[0].title, row.title, `${row.table}:${row.mailId} 回滚后 title 应保持简体原状`);
        assert.equal(result.rows[0].body, row.body, `${row.table}:${row.mailId} 回滚后 body 应保持简体原状`);
      }

      // 回滚断言：备份表与标记表都不得残留（事务内 CREATE TABLE 随 ROLLBACK 一并消失）
      for (const tableName of [
        'player_mail_pre_tw_backup',
        'player_mail_archive_pre_tw_backup',
        'player_mail_conversion_meta',
      ]) {
        const reg = await pool.query('SELECT to_regclass($1::text) AS reg', [`${schemaName}.${tableName}`]);
        assert.equal(reg.rows[0].reg, null, `${tableName} 不得在失败事务后残留`);
      }

      // 解除投毒后干净重跑：同一批数据完整转换成功（全有或全无的可恢复性）
      await pool.query(
        `UPDATE ${quoteIdentifier(schemaName)}.player_mail SET sender_label = $2 WHERE mail_id = $1`,
        ['smoke:mail:sys:1', '服务器系统'],
      );

      // 第一轮 apply
      const firstRun = await conversion.run({ mode: 'apply' });
      assert.equal(firstRun.ok, true);
      assert.equal(firstRun.matchedRows, 7, '首轮应扫描到双表共 7 行');
      assert.equal(firstRun.convertedRows, 3, '首轮应转换 3 行系统邮件（active 2 + archive 1）');
      assert.equal(firstRun.skippedRows, 4, '首轮应跳过 4 行（已台湾标准 2 + 非 system 2）');
      assert.equal(firstRun.failedRows, 0, '首轮不应有失败');
      assert.equal(firstRun.residualSimplifiedRows, 0, '首轮转换后残余简体系统邮件应为 0');
      assert.ok(firstRun.batchId, '首轮应生成 batchId');

      // 逐表 breakdown 断言
      assert.equal(firstRun.tables.length, 2, '结果应含双表 breakdown');
      const mailTableResult = firstRun.tables.find((table) => table.tableName === 'player_mail');
      const archiveTableResult = firstRun.tables.find((table) => table.tableName === 'player_mail_archive');
      assert.ok(mailTableResult && archiveTableResult, 'breakdown 应含两张表');
      assert.equal(mailTableResult.backupTable, 'player_mail_pre_tw_backup');
      assert.equal(mailTableResult.backupTableCreated, true, 'player_mail 备份表应新建');
      assert.equal(mailTableResult.matchedRows, 4);
      assert.equal(mailTableResult.convertedRows, 2);
      assert.equal(mailTableResult.skippedRows, 2);
      assert.equal(archiveTableResult.backupTable, 'player_mail_archive_pre_tw_backup');
      assert.equal(archiveTableResult.backupTableCreated, true, 'archive 备份表应独立新建');
      assert.equal(archiveTableResult.matchedRows, 3);
      assert.equal(archiveTableResult.convertedRows, 1);
      assert.equal(archiveTableResult.skippedRows, 2);

      // 转换结果断言（title/body/sender_label 全部转换；两表分别回读）
      for (const row of testRows.filter((entry) => entry.expectsConvert)) {
        const result = await pool.query(
          `SELECT title, body, sender_label FROM ${quoteIdentifier(schemaName)}.${row.table} WHERE mail_id = $1`,
          [row.mailId],
        );
        const hit = result.rows[0];
        assert.equal(hit.title, row.expectTitle, `${row.table}:${row.mailId} title 未转换`);
        assert.equal(hit.body, row.expectBody, `${row.table}:${row.mailId} body 未转换`);
        assert.equal(
          (hit.sender_label as string).includes('系統') || (hit.sender_label as string).includes('伺服器'),
          true,
          `${row.table}:${row.mailId} sender_label 未转换`,
        );
      }

      // 跳过行字节级验证（回读 hash 与基线一致；两表覆盖）
      for (const row of testRows.filter((entry) => !entry.expectsConvert)) {
        const result = await pool.query(
          `SELECT title, body, sender_label FROM ${quoteIdentifier(schemaName)}.${row.table} WHERE mail_id = $1`,
          [row.mailId],
        );
        const hit = result.rows[0];
        const afterHash = hashOf(hit.title, hit.body, hit.sender_label);
        assert.equal(
          afterHash,
          skipRowBaseline.get(row.mailId),
          `${row.table}:${row.mailId} 跳过行被改动（应字节级不变）`,
        );
      }

      // archive 表时间戳列不被触碰（无 updated_at 列，archived_at 必须原样）
      for (const [mailId, before] of archivedAtBaseline) {
        const result = await pool.query(
          `SELECT archived_at FROM ${quoteIdentifier(schemaName)}.player_mail_archive WHERE mail_id = $1`,
          [mailId],
        );
        assert.equal(
          (result.rows[0].archived_at as Date).toISOString(),
          before,
          `${mailId} archived_at 被改动（archive 表时间戳列不得触碰）`,
        );
      }

      // 两张备份表存在且包含各自转换前数据
      const activeBackupCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(schemaName)}.player_mail_pre_tw_backup`,
      );
      assert.equal(activeBackupCount.rows[0].count, 4, 'player_mail 备份表应包含全部 4 行转换前数据');
      const archiveBackupCount = await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(schemaName)}.player_mail_archive_pre_tw_backup`,
      );
      assert.equal(archiveBackupCount.rows[0].count, 3, 'archive 备份表应包含全部 3 行转换前数据');

      // 标记表写入：每表一条（conversion_key = <conversion_id>:<table>）
      const marker = await pool.query(
        `SELECT conversion_key, batch_id, converted_rows, skipped_rows, residual_simplified_rows
           FROM ${quoteIdentifier(schemaName)}.player_mail_conversion_meta
          ORDER BY conversion_key ASC`,
      );
      assert.equal(marker.rowCount, 2, '标记表应有 2 条逐表转换标记');
      const markerByKey = new Map(marker.rows.map((row) => [row.conversion_key as string, row]));
      const activeMarker = markerByKey.get('mail_snapshot_traditionalize:player_mail');
      const archiveMarker = markerByKey.get('mail_snapshot_traditionalize:player_mail_archive');
      assert.ok(activeMarker && archiveMarker, '两条逐表标记 key 应齐全');
      assert.equal(Number(activeMarker.converted_rows), 2, 'player_mail 标记 converted_rows 应为 2');
      assert.equal(Number(archiveMarker.converted_rows), 1, 'archive 标记 converted_rows 应为 1');
      assert.equal(Number(activeMarker.residual_simplified_rows), 0, 'player_mail 标记 residual 应为 0');
      assert.equal(Number(archiveMarker.residual_simplified_rows), 0, 'archive 标记 residual 应为 0');
      assert.equal(activeMarker.batch_id, archiveMarker.batch_id, '同一次 apply 两表应共用同一 batchId');

      // 第二轮回读：幂等 —— convertedRows=0、残余=0、备份表不重建、标记不重复写
      const secondRun = await conversion.run({ mode: 'apply' });
      assert.equal(secondRun.ok, true);
      assert.equal(secondRun.matchedRows, 7, '二轮仍应扫描到双表共 7 行');
      assert.equal(secondRun.convertedRows, 0, '二轮幂等：不应再转换任何行');
      assert.equal(secondRun.skippedRows, 7, '二轮全部行都应跳过');
      assert.equal(secondRun.failedRows, 0, '二轮不应有失败');
      assert.equal(secondRun.residualSimplifiedRows, 0, '二轮残余简体仍为 0');
      assert.equal(secondRun.tables.length, 2, '二轮仍应返回双表 breakdown');
      for (const table of secondRun.tables) {
        assert.equal(table.backupTableCreated, false, `二轮幂等：${table.tableName} 备份表不得重建`);
      }

      const markerAfter = await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(schemaName)}.player_mail_conversion_meta`,
      );
      assert.equal(markerAfter.rows[0].count, 2, '二轮幂等：标记不应重复写（仍 2 条）');

      // 未触碰附件表/元数据列（本次 smoke 未建附件表即证明未触碰；metadata_jsonb 保持原值）
      for (const [table, mailId] of [
        ['player_mail', 'smoke:mail:sys:1'],
        ['player_mail_archive', 'smoke:mail:arch:sys:1'],
      ] as const) {
        const metadataCheck = await pool.query(
          `SELECT metadata_jsonb FROM ${quoteIdentifier(schemaName)}.${table} WHERE mail_id = $1`,
          [mailId],
        );
        // pg 对 jsonb 列返回解析后的对象
        assert.equal(JSON.stringify(metadataCheck.rows[0].metadata_jsonb), '{}', `${table} metadata_jsonb 不得被改动`);
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            schemaName,
            dryRun: {
              matchedRows: dryRun.matchedRows,
              convertedRows: dryRun.convertedRows,
              tables: dryRun.tables.map((table) => ({
                tableName: table.tableName,
                matchedRows: table.matchedRows,
                convertedRows: table.convertedRows,
              })),
            },
            driftCase: {
              ok: driftRun.ok,
              convertedRows: driftRun.convertedRows,
              errors: driftRun.errors,
              rollbackVerified: true,
            },
            firstRun: {
              matchedRows: firstRun.matchedRows,
              convertedRows: firstRun.convertedRows,
              skippedRows: firstRun.skippedRows,
              residualSimplifiedRows: firstRun.residualSimplifiedRows,
              tables: firstRun.tables.map((table) => ({
                tableName: table.tableName,
                backupTable: table.backupTable,
                backupTableCreated: table.backupTableCreated,
                convertedRows: table.convertedRows,
              })),
            },
            secondRun: {
              matchedRows: secondRun.matchedRows,
              convertedRows: secondRun.convertedRows,
              skippedRows: secondRun.skippedRows,
              residualSimplifiedRows: secondRun.residualSimplifiedRows,
              backupTablesRecreated: secondRun.tables.filter((table) => table.backupTableCreated).length,
            },
            answers: '双表（player_mail + player_mail_archive）系统邮件（sender_type=system）首轮两段式转换 3 行（词级+字级）、跳过行字节级不变、archive 时间戳列不被触碰、二次执行幂等 0 转换且备份表不重建；CAS 漂移（分类命中但 UPDATE 谓词失配）整体回滚 ok:false 且备份/标记零残留、解除投毒后重跑成功；非 system 来源行绝不更新',
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
