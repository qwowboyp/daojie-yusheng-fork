/** 靈獸整合驗證：單次編譯、精準案例、可重用收據；不取代正式發布門禁。 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const permitted = new Set(['--browser', '--with-db', '--force', '--formal', '--formal-server', '--help']);
if ([...args].some((arg) => !permitted.has(arg))) throw new Error('未知選項；使用 --help 查看用法');
if (args.has('--help')) {
  console.log('--formal：定向 --with-db 驗證通過後，依序跑既有 quick、building、with-db 正式門禁（包含 client 與 protocol）。');
  console.log('--formal-server：只跑 server with-db 與 protocol；quick、building、client 須另引用未受變更影響的有效驗證。');
  console.log('node scripts/verify-spirit-beasts.mjs [--browser] [--with-db] [--force]\n預設：內容 + shared/server 編譯 + 契約/runtime/工位案例。相同來源且上次成功時重用編譯。\n--browser：另跑地圖及React面板真瀏覽器proof。\n--with-db：只接受獨立本機測試DB；環境檔由 SPIRIT_BEAST_TEST_ENV 指定。\n--force：重新編譯。完整日誌與收據在 .runtime/reports/spirit-beasts-verification/。');
  process.exit(0);
}
const reportDir = path.join(root, '.runtime/reports/spirit-beasts-verification');
fs.mkdirSync(reportDir, { recursive: true });
const env = { ...process.env, SERVER_SKIP_LOCAL_ENV_AUTOLOAD: '1' };
const secrets = [];
if (args.has('--with-db')) {
  const envPath = process.env.SPIRIT_BEAST_TEST_ENV;
  if (envPath) {
    for (const line of fs.readFileSync(path.resolve(envPath), 'utf8').split(/\r?\n/)) {
      const match = /^(SERVER_DATABASE_URL|DATABASE_URL|SERVER_DATABASE_POOLER_URL|DATABASE_POOLER_URL)=(.*)$/.exec(line.trim());
      if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
  const raw = env.SERVER_DATABASE_URL || env.DATABASE_URL;
  if (!raw) throw new Error('--with-db 需要 SPIRIT_BEAST_TEST_ENV 或測試 DATABASE_URL');
  let database;
  try { database = new URL(raw); }
  catch { throw new Error('測試資料庫連線格式無效'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
    || !/^\/(?:spirit_beast|smoke|test)[a-z0-9_-]*$/i.test(database.pathname)) {
    throw new Error('靈獸定向驗證只接受本機且名稱以 spirit_beast、smoke 或 test 開頭的專用資料庫');
  }
  secrets.push(raw, decodeURIComponent(database.password));
  // 專用 DB 的獨立刷盤／HTTP smoke 也需要明確測試身份；憑證只存於本次程序。
  const gmPassword = randomBytes(24).toString('hex');
  secrets.push(gmPassword);
  env.SERVER_RUNTIME_ENV = 'test';
  env.SERVER_GM_PASSWORD = gmPassword;
  env.GM_PASSWORD = gmPassword;
  env.SERVER_DATABASE_URL = raw;
  env.DATABASE_URL = raw;
  // 專用測試資料庫不可繼承外部 pooler 連線。
  env.SERVER_DATABASE_POOLER_URL = raw;
  env.DATABASE_POOLER_URL = raw;
} else {
  for (const key of ['DATABASE_URL', 'SERVER_DATABASE_URL', 'DATABASE_POOLER_URL', 'SERVER_DATABASE_POOLER_URL']) env[key] = '';
}
function sanitize(text) {
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database-url]');
}
const results = [];
async function run(label, command, commandArgs, { pnpm = false } = {}) {
  const start = performance.now();
  const logPath = path.join(reportDir, `${label}.log`);
  const log = fs.createWriteStream(logPath);
  const child = pnpm && process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `pnpm ${commandArgs.join(' ')}`], { cwd: root, env, windowsHide: true })
    : spawn(command, commandArgs, { cwd: root, env, windowsHide: true });
  fs.writeFileSync(path.join(reportDir, 'active-process.json'), JSON.stringify({ pid: child.pid, label, cwd: root,
    startedAt: new Date().toISOString() }, null, 2) + '\n');
  let pending = '';
  const write = (chunk) => {
    pending += chunk.toString();
    const newline = pending.lastIndexOf('\n');
    if (newline >= 0) { log.write(sanitize(pending.slice(0, newline + 1))); pending = pending.slice(newline + 1); }
  };
  child.stdout.on('data', write); child.stderr.on('data', write);
  const pulse = setInterval(() => console.log(`[${label}] 執行中 ${Math.round((performance.now() - start) / 1000)} 秒`), 45000);
  let exitCode;
  try { exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
  finally {
    clearInterval(pulse); if (pending) log.write(sanitize(pending)); await new Promise((resolve) => log.end(resolve));
    fs.writeFileSync(path.join(reportDir, 'active-process.json'), JSON.stringify({ pid: child.pid, label, exited: true }) + '\n');
  }
  const record = { label, exitCode, elapsedMs: Math.round(performance.now() - start), log: path.relative(root, logPath) };
  results.push(record); console.log(JSON.stringify(record));
  if (exitCode !== 0) {
    console.error(fs.readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-18).join('\n'));
    throw new Error(`${label} 未通過，詳見日誌`);
  }
}
function fingerprint(paths = null) {
  const hash = createHash('sha256');
  function visit(relative) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    if (fs.statSync(absolute).isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) visit(`${relative}/${entry}`);
    } else { hash.update(relative); hash.update(fs.readFileSync(absolute)); }
  }
  for (const relative of paths ?? ['packages/shared/src', 'packages/shared/scripts', 'packages/shared/tsconfig.json',
    'packages/server/src', 'packages/server/data/content', 'packages/server/tsconfig.json',
    'packages/server/package.json', 'packages/shared/package.json', 'pnpm-lock.yaml', 'scripts/sync-tutorial-mechanics.mjs']) visit(relative);
  hash.update(process.version); return hash.digest('hex');
}
const receiptPath = path.join(reportDir, 'build-receipt.json');
const artifactPaths = ['packages/shared/dist', 'packages/server/dist'];
async function main() {
  if (args.has('--formal') || args.has('--formal-server')) {
    if (!args.has('--with-db')) throw new Error('正式驗證需要 --with-db，使用相同的本機測試資料庫限制');
    let buildReceipt;
    try { buildReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch { buildReceipt = null; }
    let focusedResult;
    try { focusedResult = JSON.parse(fs.readFileSync(path.join(reportDir, 'result.json'), 'utf8')); } catch { focusedResult = null; }
    if (focusedResult?.ok !== true || focusedResult?.database !== true
      || buildReceipt?.sourceHash !== fingerprint() || buildReceipt?.artifactHash !== fingerprint(artifactPaths)) {
      throw new Error('先執行一般靈獸驗證，確認目前來源與編譯產物一致後再跑 --formal');
    }
    await run('database-bootstrap', process.execPath, ['scripts/prepare-spirit-beast-test-db.mjs']);
    if (!args.has('--formal-server')) {
      await run('verify-quick', 'pnpm', ['verify:quick'], { pnpm: true });
      await run('verify-building', 'pnpm', ['verify:building'], { pnpm: true });
    }
    if (args.has('--formal-server')) {
      await run('verify-server-with-db', 'pnpm', ['--filter', '@mud/server', 'verify:release:with-db'], { pnpm: true });
      await run('audit-protocol-with-db', 'pnpm', ['--filter', '@mud/server', 'audit:protocol:compiled:with-db'], { pnpm: true });
    } else {
      await run('verify-with-db', 'pnpm', ['verify:release:with-db', '--serial'], { pnpm: true });
    }
    return;
  }
  await run('content', process.execPath, ['scripts/generate-spirit-beast-content.mjs']);
  const sourceHash = fingerprint();
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch { receipt = null; }
  const requiredOutputs = ['packages/shared/dist/index.js', ...['contract', 'runtime', 'facility-pipeline'].map((name) => `packages/server/dist/tools/spirit-beast-${name}-smoke.js`)];
  if (!args.has('--force') && receipt?.sourceHash === sourceHash && receipt?.artifactHash === fingerprint(artifactPaths)
    && requiredOutputs.every((file) => fs.existsSync(path.join(root, file)))) {
    console.log(JSON.stringify({ label: 'build', reused: true, sourceHash }));
  } else {
    await run('shared-build', 'pnpm', ['build:shared'], { pnpm: true });
    await run('server-compile', 'pnpm', ['--dir', 'packages/server', 'exec', 'tsc'], { pnpm: true });
    if (fingerprint() !== sourceHash) throw new Error('編譯期間來源有變動，本次不簽發可重用編譯收據');
    fs.writeFileSync(receiptPath, JSON.stringify({ sourceHash, artifactHash: fingerprint(artifactPaths), builtAt: new Date().toISOString() }, null, 2) + '\n');
  }
  for (const name of ['contract', 'runtime', 'facility-pipeline']) {
    await run(name, process.execPath, [`packages/server/dist/tools/spirit-beast-${name}-smoke.js`]);
  }
  if (args.has('--with-db')) {
    for (const name of ['persistence', 'production-assets']) await run(name, process.execPath, [`packages/server/dist/tools/spirit-beast-${name}-smoke.js`]);
  }
  if (args.has('--browser')) {
    await run('client-types', 'pnpm', ['--dir', 'packages/client', 'exec', 'tsc', '--noEmit'], { pnpm: true });
    for (const [name, file] of [['map-store', 'prove-spirit-beast-map.mjs'], ['map-browser', 'prove-spirit-beast-map-browser.mjs'], ['panel-browser', 'prove-spirit-beast-panel.mjs']]) {
      await run(name, process.execPath, [`packages/client/scripts/${file}`]);
    }
  }
}
let ok = false;
try { await main(); ok = true; }
catch (error) { console.error(sanitize(error instanceof Error ? error.message : String(error))); process.exitCode = 1; }
finally {
  const resultFile = args.has('--formal-server') ? 'result-formal-server.json' : args.has('--formal') ? 'result-formal.json' : 'result.json';
  fs.writeFileSync(path.join(reportDir, resultFile), JSON.stringify({ ok, runAt: new Date().toISOString(),
    browser: args.has('--browser'), database: args.has('--with-db'), results }, null, 2) + '\n');
}
