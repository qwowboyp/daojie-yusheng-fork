import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertAllowedOutput,
  assertBaselineMatchesPlan,
  assertCleanWorktree,
  assertStableWorktree,
  buildDelta,
  buildReceipt,
  collectDirectoryManifest,
  collectPlan,
  hashFile,
  parseVersionJson,
  readBaselineManifest,
  readWorktreeState,
} from './manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const options = { base: null, ref: 'HEAD', output: null, baselineManifest: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--base') options.base = readOptionValue(argv, ++index, value);
    else if (value === '--ref') options.ref = readOptionValue(argv, ++index, value);
    else if (value === '--output') options.output = readOptionValue(argv, ++index, value);
    else if (value === '--baseline-manifest') options.baselineManifest = readOptionValue(argv, ++index, value);
    else throw new Error(`未知參數：${value}`);
  }
  if (!options.base || !options.output || !options.ref) {
    throw new Error('用法：node prepare.mjs --base <commit-ish> --output <repo外或忽略目錄> [--ref HEAD] [--baseline-manifest <path>]');
  }
  return options;
}

function readOptionValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} 缺少值`);
  return value;
}

function runVerification() {
  const startedAt = new Date().toISOString();
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'pnpm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm.cmd verify:client']
    : ['verify:client'];
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm verify:client 失敗，exit=${result.status ?? 1}`);
  return { command: 'pnpm verify:client', exitCode: 0, startedAt, completedAt: new Date().toISOString() };
}

async function copyFile(source, destination) {
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`封包來源必須是一般檔案：${source}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function stageArchive(stagingDir) {
  const clientRoot = path.join(repoRoot, 'packages', 'client');
  await copyTree(path.join(clientRoot, 'dist'), path.join(stagingDir, 'dist'));
  await copyFile(path.join(clientRoot, 'nginx', 'nginx.conf.template'), path.join(stagingDir, 'nginx', 'nginx.conf.template'));
  await copyFile(path.join(clientRoot, 'nginx', 'default.conf.template'), path.join(stagingDir, 'nginx', 'default.conf.template'));
}

async function copyTree(source, destination) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`產物不得包含符號連結：${source}`);
  if (!stat.isDirectory()) throw new Error(`產物目錄不存在：${source}`);
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const entryStat = await fs.lstat(from);
    if (entryStat.isSymbolicLink()) throw new Error(`產物不得包含符號連結：${from}`);
    if (entryStat.isDirectory()) await copyTree(from, to);
    else if (entryStat.isFile()) await copyFile(from, to);
    else throw new Error(`產物包含不支援的檔案類型：${from}`);
  }
}

function createTar(stagingDir, archivePath) {
  const result = spawnSync('tar', ['-cf', archivePath, '-C', stagingDir, 'dist', 'nginx', 'receipt.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar 封裝失敗：${result.stderr.trim() || result.stdout.trim()}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const before = readWorktreeState(repoRoot);
  assertCleanWorktree(before);
  const plan = collectPlan(repoRoot, options);
  if (!plan.eligible) throw new Error(`本次差異屬於 full 發布，拒絕 client artifact：${plan.blockedPaths.join(', ')}`);
  let outputRoot = await assertAllowedOutput(repoRoot, options.output);
  const baseline = options.baselineManifest ? await readBaselineManifest(path.resolve(options.baselineManifest)) : null;
  assertBaselineMatchesPlan(baseline, plan);

  const verification = runVerification();
  const afterVerification = readWorktreeState(repoRoot);
  assertStableWorktree(before, afterVerification);

  await fs.mkdir(outputRoot, { recursive: true });
  outputRoot = await assertAllowedOutput(repoRoot, outputRoot);
  const pendingDir = await fs.mkdtemp(path.join(outputRoot, '.client-release-pending-'));
  let promoted = false;
  try {
    const stagingDir = path.join(pendingDir, '.staging');
    await stageArchive(stagingDir);
    const distFiles = await collectDirectoryManifest(path.join(stagingDir, 'dist'), 'dist');
    const nginxFiles = await Promise.all([
      hashFile(path.join(stagingDir, 'nginx', 'nginx.conf.template'), 'nginx/nginx.conf.template'),
      hashFile(path.join(stagingDir, 'nginx', 'default.conf.template'), 'nginx/default.conf.template'),
    ]);
    const versionPath = path.join(stagingDir, 'dist', 'version.json');
    const versionSource = await fs.readFile(versionPath);
    const version = parseVersionJson(versionSource.toString('utf8'));
    const builtAtMs = Date.parse(version.builtAt);
    if (builtAtMs < Date.parse(verification.startedAt) || builtAtMs > Date.parse(verification.completedAt)) {
      throw new Error('dist/version.json 不是本次 pnpm verify:client 產生的版本');
    }
    const versionFile = distFiles.find((file) => file.path === 'dist/version.json');
    if (!versionFile) throw new Error('dist 產物缺少 version.json');
    const files = [...distFiles, ...nginxFiles];
    const receipt = buildReceipt({
      plan,
      files,
      distFiles,
      nginxFiles,
      version: { ...version, manifestPath: versionFile.path, sha256: versionFile.sha256 },
      verification,
      delta: buildDelta(files, baseline),
    });
    const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
    const candidateDir = path.join(outputRoot, receipt.artifactVersion);
    await assertPathDoesNotExist(candidateDir);
    await fs.writeFile(path.join(stagingDir, 'receipt.json'), receiptText, 'utf8');
    await fs.writeFile(path.join(pendingDir, 'receipt.json'), receiptText, 'utf8');
    const archiveName = `${receipt.artifactVersion}.tar`;
    const archivePath = path.join(pendingDir, archiveName);
    createTar(stagingDir, archivePath);
    const archive = await hashFile(archivePath, archiveName);
    const envelope = {
      schemaVersion: receipt.schemaVersion,
      kind: 'daojie-client-release-envelope',
      artifactVersion: receipt.artifactVersion,
      receipt: await hashFile(path.join(pendingDir, 'receipt.json'), 'receipt.json'),
      archive,
    };
    await fs.writeFile(path.join(pendingDir, 'bundle-envelope.json'), `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    await fs.rm(stagingDir, { recursive: true, force: true });
    const afterPackage = readWorktreeState(repoRoot);
    assertStableWorktree(before, afterPackage);
    await assertPathDoesNotExist(candidateDir);
    await fs.rename(pendingDir, candidateDir);
    promoted = true;
    process.stdout.write(`${JSON.stringify({ artifactDir: candidateDir, artifactVersion: receipt.artifactVersion, classification: plan.classification }, null, 2)}\n`);
  } finally {
    if (!promoted) await fs.rm(pendingDir, { recursive: true, force: true });
  }
}

async function assertPathDoesNotExist(candidateDir) {
  try {
    await fs.lstat(candidateDir);
    throw new Error(`候選輸出已存在，拒絕覆寫：${candidateDir}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
