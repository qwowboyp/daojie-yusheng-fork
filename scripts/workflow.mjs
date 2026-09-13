#!/usr/bin/env node
/** Small-task navigation and focused local checks. Release gates remain separate. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const surfaces = {
  navigation: { files: ['src/react-ui/shell/WorkspaceNavigation.tsx', 'src/main-app-runtime-context.ts', 'src/ui/side-panel.ts'], proofs: ['game-workspace', 'social-navigation'] },
  hud: { files: ['src/ui/hud.ts', 'src/ui/desktop-window.ts'], proofs: ['hud-layout'], explicitProof: true, note: 'hud-layout 是 desktop-window fixture，未實例化完整 HUD；依本次行為補真實面板驗證並明確 --proof' },
  craft: { files: ['src/ui/craft-realm-tabs.ts', 'src/ui/craft-workbench-modal.ts'], proofs: ['craft-workspace'] },
  inventory: { files: ['src/react-ui/panels/inventory/InventoryPanel.tsx', 'src/ui/panels/inventory-item-action-dialog-state.ts'], proofs: ['item-card-constellation-layout', 'inventory-action-dialog-lifecycle'], explicitProof: true, note: '現有候選僅涵蓋 fixture/對話框狀態，不保證完整背包掛載；依本次行為明確 --proof' },
  mail: { files: ['src/react-ui/shell/WorkspaceNavigation.tsx', 'src/ui/mail-panel.ts'], proofs: ['social-navigation', 'mail-mobile-scroll'] },
  building: { files: ['src/main-building-fengshui-state-source.ts'], proofs: ['building-workspace', 'building-material-candidates'] },
  'combat-log': { files: ['src/ui/chat.ts', 'src/ui/chat-scope-continuity.ts'], proofs: ['combat-log-presentation', 'combat-log-continuity'] },
  map: { files: ['src/game-map/interaction/interaction-controller.ts', 'src/game-map/runtime/map-runtime.ts', 'src/main-map-interaction-bindings.ts'], proofs: ['map-pinch-zoom', 'map-render-lifecycle'] },
  'item-sources': { files: ['src/ui/item-source-navigation.ts', 'src/content/item-source-navigation.ts'], proofs: ['item-source-catalog', 'item-sources-panel'] },
};

function git(args, cwd = root) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
}

export function parseArgs(args) {
  const result = { action: args[0] || 'context', surface: '', files: [], proofs: [], tier: '' };
  for (let i = 1; i < args.length; i += 1) {
    const key = args[i];
    if (['--surface', '--tier'].includes(key)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${key} 需要值`);
      result[key.slice(2)] = args[++i];
    } else if (key === '--files' || key === '--proof') {
      const values = [];
      while (args[i + 1] && !args[i + 1].startsWith('--')) values.push(args[++i]);
      if (!values.length) throw new Error(`${key} 需要至少一個值`);
      result[key === '--files' ? 'files' : 'proofs'].push(...values);
    } else throw new Error(`未知參數：${key}`);
  }
  if (!['context', 'plan', 'check'].includes(result.action)) throw new Error('動作為 context、plan 或 check');
  if (result.surface && !surfaces[result.surface]) throw new Error(`surface 可用：${Object.keys(surfaces).join(', ')}`);
  if (result.tier && result.tier !== 'ui-small') throw new Error('本工具的本地驗證 tier 僅接受 ui-small；其他範圍請用既有 verify 門禁');
  return result;
}

export function scopedFiles(files, cwd = root) {
  return [...new Set(files.map((file) => {
    const full = path.resolve(cwd, file);
    const rel = path.relative(cwd, full).replaceAll('\\', '/');
    if (!rel || rel.startsWith('../') || path.isAbsolute(rel) || rel.startsWith('-')) throw new Error(`路徑不在專案內：${file}`);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`需要存在的檔案：${rel}`);
    const realRel = path.relative(fs.realpathSync(cwd), fs.realpathSync(full));
    if (realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) throw new Error(`檔案連結超出專案：${rel}`);
    return rel;
  }))];
}

export function planChecks(options, scripts, cwd = root) {
  const files = scopedFiles(options.files, cwd);
  if (options.tier !== 'ui-small' || !files.length) throw new Error('精準驗證需明確指定 --tier ui-small 與 --files 本次完整修改範圍');
  const allowed = /^packages\/client\/(src\/(?:ui\/|react-ui\/|styles\/|constants\/ui\/)|scripts\/prove-)/;
  const broad = /\/(?:tokens|base|global|reset)\.css$|\/react-ui\/(?:bridge|stores)\//;
  if (files.some((file) => !allowed.test(file) || broad.test(file))) {
    throw new Error('包含全域或非局部 UI 檔案，請用 pnpm verify:client；shared/server/DB 變更依 AGENTS.md 分級');
  }
  if (!options.proofs.length && surfaces[options.surface]?.explicitProof) throw new Error(surfaces[options.surface].note);
  const requested = options.proofs.length ? options.proofs : surfaces[options.surface]?.proofs || [];
  if (!requested.length) throw new Error('指定 --surface 或 --proof 對應現有 proof');
  const proofs = [...new Set(requested.map((name) => name.startsWith('proof:') ? name : `proof:${name}`))];
  for (const name of proofs) {
    if (!/^proof:[a-z0-9-]+$/.test(name) || typeof scripts[name] !== 'string') throw new Error(`目前 client 沒有這個 proof：${name}`);
  }
  const steps = [];
  const textFiles = files.filter((file) => /\.(?:ts|tsx|js|mjs|json|csv)$/.test(file));
  if (textFiles.length) steps.push({ label: 'traditional:changed', command: 'node', args: ['scripts/check-traditional.mjs', ...textFiles] });
  steps.push({ label: 'client:typecheck', command: 'pnpm', args: ['--filter', '@mud/client', 'exec', 'tsc', '--noEmit'] });
  for (const name of proofs) steps.push({ label: name, command: 'pnpm', args: ['--filter', '@mud/client', 'run', name] });
  return { scope: 'local-ui-only', files, steps, releaseAccepted: false };
}

function context(options, scripts) {
  const entries = git(['status', '--porcelain=v1', '-z', '--untracked-files=normal']).split('\0').filter(Boolean);
  const files = scopedFiles(options.files);
  const selected = options.surface ? surfaces[options.surface] : null;
  const candidates = (selected?.files || []).map((file) => `packages/client/${file}`);
  const rules = new Set(['AGENTS.md']);
  for (const file of files.length ? files : candidates) {
    let dir = path.dirname(file);
    while (dir !== '.') {
      if (fs.existsSync(path.join(root, dir, 'AGENTS.md'))) rules.add(`${dir}/AGENTS.md`);
      dir = path.dirname(dir);
    }
  }
  return {
    root, head: git(['rev-parse', '--short', 'HEAD']).trim(), branch: git(['branch', '--show-current']).trim(),
    status: { entries: entries.filter((e) => /^[ MADRCU?!]{2} /.test(e)).length, selected: files.length ? git(['status', '--short', '--', ...files]).trim().split('\n').filter(Boolean) : [], note: '本次檔案以外的變更不自動納入提交或驗證範圍' },
    rules: [...rules], codegraph: fs.existsSync(path.join(root, '.codegraph')),
    surface: options.surface || null, availableSurfaces: selected ? undefined : Object.keys(surfaces),
    entryFiles: candidates.filter((file) => fs.existsSync(path.join(root, file))),
    missingHints: candidates.filter((file) => !fs.existsSync(path.join(root, file))),
    coverageNote: selected?.note || '候選 proof 是定位起點，仍須確認本次行為、實際綁定與多端覆蓋',
    proofCandidates: (selected?.proofs || []).map((name) => ({ name: `proof:${name}`, exists: Object.hasOwn(scripts, `proof:${name}`) })),
    verification: '局部 UI：check --tier ui-small --surface <名稱> --files <完整範圍>；其他：既有 verify 門禁；發布先確認現行工具，已有 prepare 門禁不重跑',
  };
}

function fingerprint(plan, scripts) {
  // Records evidence; deliberately does not act as an automatic test cache.
  const hash = createHash('sha256').update(JSON.stringify({ steps: plan.steps, scripts, node: process.version }));
  for (const file of plan.files) hash.update(file).update(fs.readFileSync(path.join(root, file)));
  return hash.digest('hex');
}

export async function runStep(step, logPath, { cwd = root, timeoutMs = 180_000 } = {}) {
  const fd = fs.openSync(logPath, 'wx');
  const started = Date.now();
  try {
    const windowsPnpm = step.command === 'pnpm' && process.platform === 'win32';
    if (windowsPnpm && step.args.some((arg) => !/^[a-zA-Z0-9_@:/.-]+$/.test(arg))) throw new Error('pnpm 參數含非預期字元');
    const command = step.command === 'node' ? process.execPath : windowsPnpm ? (process.env.ComSpec || 'cmd.exe') : 'pnpm';
    const args = windowsPnpm ? ['/d', '/s', '/c', `pnpm ${step.args.join(' ')}`] : step.args;
    const child = spawn(command, args, {
      cwd, windowsHide: true,
      // Only fixed flags/validated proof names reach cmd; user file paths use Node's argument array.
      shell: false,
      stdio: ['ignore', fd, fd],
    });
    let timedOut = false;
    const stop = () => {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform === 'win32') {
        // Kill only this command's process tree, including its own test browsers.
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { child.kill(); }
      } else child.kill('SIGTERM');
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    let code;
    try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (status, signal) => resolve(status ?? (signal ? 130 : 1))); }); }
    finally { clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    return { label: step.label, code: timedOut ? 124 : code, timedOut, seconds: +((Date.now() - started) / 1000).toFixed(2), logPath };
  } finally { fs.closeSync(fd); }
}

async function check(plan, scripts) {
  if (!fs.existsSync(path.join(root, 'node_modules'))) throw new Error('缺少 node_modules，先執行 pnpm install --frozen-lockfile');
  if (!fs.existsSync(path.join(root, 'packages/shared/dist/index.js'))) throw new Error('缺少 shared 產物，先執行 pnpm build:shared');
  const base = path.join(root, '.codex/tmp/workflow');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'run-'));
  const receipt = { ...plan, inputFingerprint: fingerprint(plan, scripts), startedAt: new Date().toISOString(), head: git(['rev-parse', 'HEAD']).trim(), results: [], status: 'running' };
  const receiptPath = path.join(dir, 'receipt.json');
  const save = () => fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  save();
  for (const step of plan.steps) {
    console.log(`RUN ${step.label}`);
    let result;
    try { result = await runStep(step, path.join(dir, `${receipt.results.length + 1}.log`)); }
    catch (error) { receipt.status = 'error'; receipt.error = error.message; save(); throw error; }
    receipt.results.push(result);
    console.log(`${result.code === 0 ? 'PASS' : 'FAIL'} ${result.label} ${result.seconds}s`);
    if (result.code !== 0) {
      receipt.status = 'failed'; save();
      const tail = fs.readFileSync(result.logPath, 'utf8').split(/\r?\n/).slice(-35).join('\n');
      console.error(tail.slice(-6000));
      console.log(`RECEIPT ${receiptPath}`);
      return result.code;
    }
    save();
  }
  receipt.status = 'passed'; receipt.completedAt = new Date().toISOString(); save();
  console.log(`LOCAL_UI_CHECK:PASS checks=${receipt.results.length} seconds=${receipt.results.reduce((total, item) => total + item.seconds, 0).toFixed(2)}`);
  console.log(`RECEIPT ${receiptPath}`);
  return 0;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('node scripts/workflow.mjs context --surface navigation --files <檔案...>\nnode scripts/workflow.mjs plan|check --tier ui-small --surface navigation --files <檔案...>\n--proof <已存在的 proof 名稱...> 可覆寫 surface 預設。只做本地驗證，不提交、不發布、不跳過正式門禁。');
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'packages/client/package.json'), 'utf8')).scripts;
  if (options.action === 'context') console.log(JSON.stringify(context(options, scripts), null, 2));
  else {
    const plan = planChecks(options, scripts);
    if (options.action === 'plan') console.log(JSON.stringify(plan, null, 2));
    else process.exitCode = await check(plan, scripts);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`WORKFLOW: ${error.message}`); process.exitCode = 1; });
}
