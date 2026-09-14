/** 新建測試 DB 在 smoke 啟動前需有租約及宗門表；直接使用正式 schema 初始化。 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const raw = process.env.SERVER_DATABASE_URL || process.env.DATABASE_URL;
let url;
try { url = new URL(raw); } catch { throw new Error('需要有效的本機測試資料庫連線'); }
if (!['postgres:', 'postgresql:'].includes(url.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  || !/^\/(?:spirit_beast|smoke|test)[a-z0-9_-]*$/i.test(url.pathname)) {
  throw new Error('只允許本機且名稱以 spirit_beast、smoke 或 test 開頭的專用資料庫');
}
const { Pool } = require('pg');
const { InstanceCatalogService } = require(fileURLToPath(new URL('../packages/server/dist/persistence/instance-catalog.service.js', import.meta.url)));
const { ensureSectTable } = require(fileURLToPath(new URL('../packages/server/dist/persistence/sect-durable-persistence.js', import.meta.url)));
const pool = new Pool({ connectionString: raw, max: 2 });
const catalog = new InstanceCatalogService({ getPool: () => pool });
try {
  await catalog.onModuleInit();
  if (!catalog.isEnabled()) throw new Error('實例目錄初始化失敗');
  await ensureSectTable(pool);
  const result = await pool.query("SELECT to_regclass('instance_catalog') AS catalog, to_regclass('server_sect') AS sect");
  if (!result.rows[0]?.catalog || !result.rows[0]?.sect) throw new Error('共用資料表回讀驗證失敗');
  console.log('SPIRIT_BEAST_TEST_DB_SCHEMA:PASS instance_catalog + server_sect');
} finally {
  await catalog.onModuleDestroy();
  await pool.end();
}
