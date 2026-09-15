import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const SCOPED_VERIFICATION_COMMAND = 'client-release scoped verification';
export const ALL_CLIENT_TESTS_COMMAND = 'client-release all-client-tests verification';

const SAFE_SCRIPT_PATH = /^(?:scripts|packages\/client\/scripts)\/(?:[a-z0-9._-]+\/)*(?:check|prove|verify|test)[a-z0-9._-]*\.(?:c?js|mjs|py)$/u;
const SAFE_PROOF_ID = /^(?:(?:root|client):)?(?:proof:)?[a-z0-9][a-z0-9:-]*$/u;
const INTERNAL_PROOFS = Object.freeze({
  'release-contracts': {
    kind: 'script',
    path: 'scripts/client-release/prove-release-contracts.mjs',
  },
});

export const REQUIRED_BUILD_COMMANDS = Object.freeze([
  command('build:shared-typescript', 'pnpm', ['--dir', 'packages/shared', 'exec', 'tsc']),
  command('generate:editor-catalog', 'pnpm', ['--dir', 'packages/client', 'run', 'generate:editor-catalog']),
  command('generate:item-sources', 'pnpm', ['--dir', 'packages/client', 'run', 'generate:item-sources']),
  command('generate:building-catalog', 'pnpm', ['--dir', 'packages/client', 'run', 'generate:building-catalog']),
  command('generate:i18n', 'pnpm', ['--dir', 'packages/client', 'run', 'generate:i18n']),
  command('check:client-types', 'pnpm', ['--dir', 'packages/client', 'exec', 'tsc', '--noEmit']),
  command('build:vite', 'pnpm', ['--dir', 'packages/client', 'exec', 'vite', 'build']),
]);

function command(label, executable, argv) {
  return Object.freeze({ label, executable, argv: Object.freeze([...argv]), cwd: '.' });
}

function readPackageScripts(repoRoot, relativeDir) {
  const manifestPath = path.join(repoRoot, relativeDir, 'package.json');
  const payload = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return payload.scripts && typeof payload.scripts === 'object' ? payload.scripts : {};
}

function assertSafeScript(repoRoot, inputPath) {
  if (typeof inputPath !== 'string' || inputPath.includes('\\') || inputPath.includes('\0')) {
    throw new Error(`proof script 路徑無效：${inputPath}`);
  }
  const normalized = path.posix.normalize(inputPath.replace(/^\.\//u, ''));
  if (normalized !== inputPath.replace(/^\.\//u, '') || !SAFE_SCRIPT_PATH.test(normalized)) {
    throw new Error(`proof script 不在允許的 repo 白名單：${inputPath}`);
  }
  const absolute = path.resolve(repoRoot, ...normalized.split('/'));
  const relative = path.relative(repoRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`proof script 必須位於 repo 內：${inputPath}`);
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`proof script 必須是一般檔案：${inputPath}`);
  const realRepoRoot = fs.realpathSync.native(repoRoot);
  const realScript = fs.realpathSync.native(absolute);
  const realRelative = path.relative(realRepoRoot, realScript);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`proof script 實際路徑必須位於 repo 內：${inputPath}`);
  }
  return normalized;
}

function registeredProof(repoRoot, input, packageScripts) {
  const internal = INTERNAL_PROOFS[input];
  if (internal) {
    const scriptPath = assertSafeScript(repoRoot, internal.path);
    return {
      selected: { input, kind: 'registered', id: input, path: scriptPath },
      command: scriptCommand(`proof:${input}`, scriptPath),
    };
  }

  if (!SAFE_PROOF_ID.test(input)) throw new Error(`proof 選擇不是安全 id 或 repo script path：${input}`);
  let scope = null;
  let proofName = input;
  const scopeMatch = /^(root|client):(.*)$/u.exec(proofName);
  if (scopeMatch) {
    [, scope, proofName] = scopeMatch;
  }
  if (proofName.startsWith('proof:')) proofName = proofName.slice('proof:'.length);
  if (!proofName || proofName.includes(':')) throw new Error(`proof id 無效：${input}`);
  const scriptName = `proof:${proofName}`;
  const candidates = [
    { scope: 'root', dir: '.', scripts: packageScripts.root },
    { scope: 'client', dir: 'packages/client', scripts: packageScripts.client },
  ].filter((candidate) => (!scope || candidate.scope === scope) && typeof candidate.scripts[scriptName] === 'string');
  if (candidates.length === 0) throw new Error(`未知 proof：${input}；請指定已登錄 proof id 或白名單 script path`);
  if (candidates.length > 1) throw new Error(`proof id 有多個登錄位置：${input}；請用 root: 或 client: 明確指定`);
  const candidate = candidates[0];
  return {
    selected: { input, kind: 'registered', id: proofName, package: candidate.scope, script: scriptName },
    command: command(`proof:${candidate.scope}:${proofName}`, 'pnpm', ['--dir', candidate.dir, 'run', scriptName]),
  };
}

function scriptCommand(label, scriptPath) {
  const extension = path.posix.extname(scriptPath);
  const executable = extension === '.py' ? 'python' : 'node';
  return command(label, executable, extension === '.py' ? ['-B', '-X', 'utf8', scriptPath] : [scriptPath]);
}

function resolveProof(repoRoot, input, packageScripts) {
  if (typeof input !== 'string' || !input) throw new Error('--proof 缺少值');
  if (input.includes('/') || input.includes('\\') || /\.(?:c?js|mjs|py)$/u.test(input)) {
    const scriptPath = assertSafeScript(repoRoot, input);
    return {
      selected: { input, kind: 'script', path: scriptPath },
      command: scriptCommand(`proof:script:${scriptPath}`, scriptPath),
    };
  }
  return registeredProof(repoRoot, input, packageScripts);
}

function allClientProofs(repoRoot, packageScripts) {
  const selected = [];
  const commands = [command('check:traditional-client-scope', 'node', ['scripts/check-traditional.mjs', '--scope'])];
  for (const input of ['root:gm-login-autofill', 'root:technique-preview']) {
    const resolved = registeredProof(repoRoot, input, packageScripts);
    selected.push(resolved.selected);
    commands.push(resolved.command);
  }
  for (const scriptName of Object.keys(packageScripts.client).filter((name) => name.startsWith('proof:')).sort()) {
    const resolved = registeredProof(repoRoot, `client:${scriptName}`, packageScripts);
    selected.push(resolved.selected);
    commands.push(resolved.command);
  }
  return { selected, commands };
}

export function resolveVerificationPlan(repoRoot, { proofs = [], allClientTests = false, requireSelection = true } = {}) {
  if (!Array.isArray(proofs)) throw new Error('proofs 必須是陣列');
  if (allClientTests && proofs.length > 0) throw new Error('--all-client-tests 與 --proof 不可同時使用');
  if (!allClientTests && proofs.length === 0) {
    if (requireSelection) throw new Error('必須至少指定一個 --proof，或明確使用 --all-client-tests');
    return { mode: null, selectedProofs: [], commands: [], prepareRequiresExplicitSelection: true };
  }
  const packageScripts = {
    root: readPackageScripts(repoRoot, '.'),
    client: readPackageScripts(repoRoot, 'packages/client'),
  };
  const resolved = allClientTests
    ? allClientProofs(repoRoot, packageScripts)
    : proofs.map((input) => resolveProof(repoRoot, input, packageScripts)).reduce((result, item) => {
      result.selected.push(item.selected);
      result.commands.push(item.command);
      return result;
    }, { selected: [], commands: [] });
  const seen = new Set();
  const proofCommands = resolved.commands.filter((item) => {
    const identity = `${item.executable}\0${item.argv.join('\0')}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return {
    mode: allClientTests ? 'all-client-tests' : 'scoped',
    selectedProofs: resolved.selected,
    commands: [...REQUIRED_BUILD_COMMANDS, ...proofCommands],
    prepareRequiresExplicitSelection: false,
  };
}

function spawnPortable(spec, repoRoot) {
  if (process.platform === 'win32' && spec.executable === 'pnpm') {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd', ...spec.argv], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });
  }
  return spawnSync(spec.executable, spec.argv, { cwd: repoRoot, stdio: 'inherit', shell: false });
}

export function runVerification(repoRoot, selection) {
  if (!selection?.mode || !Array.isArray(selection.commands) || selection.commands.length === 0) {
    throw new Error('verification selection 無效');
  }
  const startedAt = new Date().toISOString();
  const results = [];
  for (const spec of selection.commands) {
    const commandStartedAt = new Date().toISOString();
    const result = spawnPortable(spec, repoRoot);
    const completedAt = new Date().toISOString();
    if (result.error) throw result.error;
    const exitCode = result.status ?? 1;
    if (exitCode !== 0) throw new Error(`${spec.label} 失敗，exit=${exitCode}`);
    results.push({
      label: spec.label,
      executable: spec.executable,
      argv: [...spec.argv],
      cwd: spec.cwd,
      exitCode,
      startedAt: commandStartedAt,
      completedAt,
    });
  }
  return {
    mode: selection.mode,
    command: selection.mode === 'scoped' ? SCOPED_VERIFICATION_COMMAND : ALL_CLIENT_TESTS_COMMAND,
    selectedProofs: selection.selectedProofs,
    commands: results,
    exitCode: 0,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
