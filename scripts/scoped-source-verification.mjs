/** 從 canonical git archive 執行協調發布所需的精準 source 驗證並簽發報告。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIND = 'daojie-scoped-source-verification';
const COMMAND = 'node scripts/scoped-source-verification.mjs';
const HEX40 = /^[a-f0-9]{40}$/u;
const SAFE_PROOF = /^(?:scripts|packages\/client\/scripts)\/(?:[a-z0-9._-]+\/)*(?:check|prove|verify|test)[a-z0-9._-]*\.(?:c?js|mjs|py)$/u;
const REQUIRED_COMMANDS = [
  { label: 'setup:dependencies', executable: 'pnpm', argv: ['install', '--frozen-lockfile'] },
  { label: 'check:shared-types', executable: 'pnpm', argv: ['--dir', 'packages/shared', 'exec', 'tsc'] },
  { label: 'check:server-types', executable: 'pnpm', argv: ['--dir', 'packages/server', 'exec', 'tsc', '-p', 'tsconfig.json', '--pretty', 'false'] },
];
let activeCandidate = null;

function parseArgs(argv) {
  const options = { base: null, commit: 'HEAD', output: null, proofs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--base') options.base = argv[++index];
    else if (value === '--commit') options.commit = argv[++index];
    else if (value === '--output') options.output = argv[++index];
    else if (value === '--proof') options.proofs.push(argv[++index]);
    else throw new Error(`未知參數：${value}`);
  }
  if (!options.base || !options.commit || !options.output || options.proofs.length === 0
    || [options.base, options.commit, options.output, ...options.proofs].some((value) => !value || value.startsWith('--'))) {
    throw new Error('用法：node scripts/scoped-source-verification.mjs --base <commit> --commit <commit> --output <dir> --proof <script>...');
  }
  return options;
}

function runGit(args, { encoding = 'utf8' } = {}) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} 失敗：${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function resolveCommit(value) {
  const commit = runGit(['rev-parse', '--verify', `${value}^{commit}`]).trim();
  if (!HEX40.test(commit)) throw new Error(`commit 無效：${value}`);
  return commit;
}

export function normalizeProof(input) {
  if (typeof input !== 'string' || !input || input.includes('\\') || input.includes('\0')) {
    throw new Error(`proof 不在允許範圍：${input}`);
  }
  const segments = input.split('/');
  const normalized = path.posix.normalize(input);
  if (normalized !== input || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || !SAFE_PROOF.test(input)) {
    throw new Error(`proof 不在允許範圍：${input}`);
  }
  return input;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function sanitizeLogLabel(label) {
  const readable = label.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 96) || 'command';
  const identity = crypto.createHash('sha256').update(label).digest('hex').slice(0, 12);
  return `${readable}-${identity}`;
}

export function validateCandidateProofPath(candidate, proof) {
  const normalized = normalizeProof(proof);
  const candidateReal = fs.realpathSync(candidate);
  const proofPath = path.join(candidate, ...normalized.split('/'));
  const stat = fs.lstatSync(proofPath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`proof 不是候選內的一般檔案：${proof}`);
  const proofReal = fs.realpathSync(proofPath);
  const relative = path.relative(candidateReal, proofReal);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`proof 實際路徑跳出候選 archive：${proof}`);
  }
  return normalized;
}

export function runCommand(candidate, output, command) {
  const startedAt = new Date().toISOString();
  const logPath = path.join(output, `${sanitizeLogLabel(command.label)}.log`);
  const log = fs.openSync(logPath, 'wx');
  let result;
  try {
    const executable = process.platform === 'win32' && command.executable === 'pnpm'
      ? (process.env.ComSpec || 'cmd.exe') : command.executable;
    const argv = process.platform === 'win32' && command.executable === 'pnpm'
      ? ['/d', '/s', '/c', 'pnpm.cmd', ...command.argv] : command.argv;
    result = spawnSync(executable, argv, {
      cwd: candidate,
      env: { ...process.env, SERVER_SKIP_LOCAL_ENV_AUTOLOAD: '1' },
      stdio: ['ignore', log, log],
      shell: false,
      windowsHide: true,
    });
  } finally {
    fs.closeSync(log);
  }
  if (result.error) throw result.error;
  const record = { ...command, cwd: '.', exitCode: result.status, startedAt, completedAt: new Date().toISOString() };
  process.stdout.write(`${JSON.stringify(record)}\n`);
  if (result.status !== 0) {
    const tail = fs.readFileSync(logPath, 'utf8').split(/\r?\n/u).slice(-20).join('\n');
    throw new Error(`${command.label} 未通過（exit ${result.status}）：\n${tail}`);
  }
  return record;
}

export function cleanupCandidate(candidate) {
  try {
    fs.rmSync(candidate, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
    return { ok: false, warning: `candidate cleanup failed (${code}); manual cleanup required` };
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseCommit = resolveCommit(options.base);
  const commit = resolveCommit(options.commit);
  const proofs = [...new Set(options.proofs.map(normalizeProof))];
  const output = path.resolve(options.output);
  if (!output.startsWith(`${path.join(repoRoot, '.runtime', 'releases')}${path.sep}`)) {
    throw new Error('--output 必須位於 .runtime/releases/ 內');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output, { recursive: false });
  const archive = path.join(output, 'source.tar');
  runGit(['archive', '--format=tar', '--output', archive, commit]);
  const changed = runGit(['diff', '--name-only', '-z', baseCommit, commit, '--'], { encoding: 'buffer' });
  const paths = changed.toString('utf8').split('\0').filter(Boolean).sort();
  if (paths.length === 0 || paths.some((item) => item.includes('\\') || item.split('/').includes('..'))) {
    throw new Error('base..commit 沒有可發布差異，或包含不安全路徑');
  }
  const candidate = path.join(output, '.candidate');
  fs.mkdirSync(candidate);
  activeCandidate = candidate;
  const extract = spawnSync('tar', ['-xf', archive, '-C', candidate], { cwd: repoRoot, encoding: 'utf8', shell: false });
  if (extract.error) throw extract.error;
  if (extract.status !== 0) throw new Error(`canonical archive 解開失敗：${extract.stderr.trim()}`);
  for (const proof of proofs) validateCandidateProofPath(candidate, proof);

  const startedAt = new Date().toISOString();
  const selectedProofs = proofs.map((proof) => ({ input: proof, kind: 'script', path: proof }));
  const commands = [
    ...REQUIRED_COMMANDS,
    ...proofs.map((proof) => ({
      label: `proof:script:${proof}`,
      executable: proof.endsWith('.py') ? 'python' : 'node',
      argv: proof.endsWith('.py') ? ['-B', '-X', 'utf8', proof] : [proof],
    })),
  ].map((command) => runCommand(candidate, output, command));
  const cleanup = cleanupCandidate(candidate);
  activeCandidate = null;
  const report = {
    schemaVersion: 1,
    kind: KIND,
    commit,
    baseCommit,
    command: COMMAND,
    exitCode: 0,
    startedAt,
    completedAt: new Date().toISOString(),
    changeScope: { baseCommit, commit, paths },
    selectedProofs,
    commands,
    sourceArchive: { path: 'source.tar', bytes: fs.statSync(archive).size, sha256: sha256File(archive) },
    cleanup,
  };
  fs.writeFileSync(path.join(output, 'scoped-verification.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ok: true, report: path.join(output, 'scoped-verification.json'), commit, baseCommit, paths: paths.length, proofs, cleanup })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    const original = error instanceof Error ? error.message : String(error);
    const cleanup = activeCandidate ? cleanupCandidate(activeCandidate) : { ok: true };
    activeCandidate = null;
    process.stderr.write(`${original}\n`);
    if (!cleanup.ok) process.stderr.write(`${cleanup.warning}\n`);
    process.exitCode = 1;
  }
}
