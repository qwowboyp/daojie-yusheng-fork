import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TextDecoder } from 'node:util';

export const CLIENT_RELEASE_SCHEMA_VERSION = 1;

const DOCUMENT_PREFIX = 'docs/';
const ROOT_RELEASE_DOCUMENTS = new Set(['AGENTS.md']);
const CLIENT_PREFIX = 'packages/client/';
const CLIENT_ASSET_PREFIX = 'packages/client/public/';
const CLIENT_RELEASE_SCRIPT_PREFIX = 'scripts/client-release/';
const FULL_RELEASE_PREFIXES = ['packages/server/', 'packages/shared/'];
const ROOT_FULL_RELEASE_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
]);
const EXPECTED_NGINX_TEMPLATES = new Set([
  'nginx/default.conf.template',
  'nginx/nginx.conf.template',
]);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeArchivePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('封包路徑不可為空');
  }
  if (value.includes('\\')) {
    throw new Error(`封包路徑必須使用 / 分隔：${value}`);
  }
  const normalized = value;
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`封包路徑不得是絕對路徑：${value}`);
  }
  if (normalized.split('/').includes('..')) {
    throw new Error(`封包路徑不得跳出根目錄：${value}`);
  }
  if (normalized.includes('\0') || normalized.split('/').some((segment) => !segment || segment === '.' || segment.includes(':'))) {
    throw new Error(`封包路徑無效：${value}`);
  }
  return normalized;
}

export function classifyChangedPaths(paths) {
  const normalized = [...new Set(paths.map(normalizeArchivePath))].sort(compareArchivePaths);
  const materialPaths = normalized.filter((file) => !isReleaseDocumentationPath(file));
  const unsupported = materialPaths.filter((file) =>
    FULL_RELEASE_PREFIXES.some((prefix) => file.startsWith(prefix))
    || ROOT_FULL_RELEASE_FILES.has(file)
    || (!file.startsWith(CLIENT_PREFIX) && !file.startsWith(CLIENT_RELEASE_SCRIPT_PREFIX)));

  if (unsupported.length > 0) {
    return { classification: 'full', eligible: false, paths: normalized, blockedPaths: unsupported };
  }
  if (materialPaths.every(isStaticClientAssetPath)) {
    return { classification: 'assets', eligible: true, paths: normalized, blockedPaths: [] };
  }
  return { classification: 'client', eligible: true, paths: normalized, blockedPaths: [] };
}

function isReleaseDocumentationPath(file) {
  return file.startsWith(DOCUMENT_PREFIX) || ROOT_RELEASE_DOCUMENTS.has(file);
}

function isStaticClientAssetPath(file) {
  if (!file.startsWith(CLIENT_ASSET_PREFIX)) return false;
  const relative = file.slice(CLIENT_ASSET_PREFIX.length).toLowerCase();
  return relative.endsWith('/manifest.json')
    || /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?|ttf|otf|mp3|ogg|wav|m4a|aac|flac)$/u.test(relative);
}

export function runGit(repoRoot, args) {
  return runGitBuffer(repoRoot, args).toString('utf8').trim();
}

function runGitBuffer(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'buffer', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    const stdout = result.stdout.toString('utf8').trim();
    throw new Error(`git ${args.join(' ')} 失敗：${stderr || stdout}`);
  }
  return result.stdout;
}

export function parseGitPathList(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0) throw new Error('git 路徑輸出缺少 NUL 結尾');
  let decoded;
  try { decoded = utf8Decoder.decode(bytes.subarray(0, -1)); } catch { throw new Error('git 路徑不是有效 UTF-8'); }
  return decoded.split('\0').map(normalizeArchivePath);
}

export function resolveGitCommit(repoRoot, ref) {
  if (typeof ref !== 'string' || !ref || ref.includes('\0')) throw new Error('Git ref 不可為空或包含 NUL');
  const commit = runGit(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Git ref 未解析為完整 SHA-1 commit：${ref}`);
  return commit;
}

export function collectPlan(repoRoot, { base, ref = 'HEAD' }) {
  if (!base) throw new Error('必須指定 --base <commit-ish>，用以判定本次發布範圍');
  const commit = resolveGitCommit(repoRoot, ref);
  const headCommit = resolveGitCommit(repoRoot, 'HEAD');
  if (commit !== headCommit) {
    throw new Error('--ref 必須解析為目前 HEAD；請在該 commit 的乾淨 checkout 執行');
  }
  const baseCommit = resolveGitCommit(repoRoot, base);
  const mergeBase = runGit(repoRoot, ['merge-base', baseCommit, commit]);
  if (mergeBase !== baseCommit) {
    throw new Error('--base 必須是目前 HEAD 的祖先 commit');
  }
  const changedPaths = parseGitPathList(runGitBuffer(repoRoot, [
    'diff', '--name-only', '--no-renames', '-z', '--diff-filter=ACDMRTUXB', `${baseCommit}..${commit}`,
  ]));
  if (changedPaths.length === 0) throw new Error('--base 與目前 HEAD 之間沒有可發布差異');
  if (changedPaths.every(isReleaseDocumentationPath)) {
    throw new Error('--base 與目前 HEAD 之間只有文件差異，沒有 client 產物可發布');
  }
  return { baseCommit, commit, ...classifyChangedPaths(changedPaths) };
}

export function readWorktreeState(repoRoot) {
  return {
    headCommit: resolveGitCommit(repoRoot, 'HEAD'),
    porcelain: runGitBuffer(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).toString('hex'),
  };
}

export function assertCleanWorktree(state) {
  if (state.porcelain) {
    throw new Error('工作目錄不是乾淨 Git checkout；請改在乾淨 worktree 準備產物');
  }
}

export function assertStableWorktree(before, after) {
  if (before.headCommit !== after.headCommit || before.porcelain !== after.porcelain) {
    throw new Error('驗證前後 Git tracked 資料或 HEAD 已漂移；拒絕封裝產物');
  }
}

async function collectFiles(root, relative = '') {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => compareArchivePaths(left.name, right.name))) {
    const nested = relative ? `${relative}/${entry.name}` : entry.name;
    const safeRelative = normalizeArchivePath(nested);
    const absolute = path.join(root, ...safeRelative.split('/'));
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`產物不得包含符號連結：${safeRelative}`);
    if (stat.isDirectory()) {
      files.push(...await collectFiles(root, safeRelative));
    } else if (stat.isFile()) {
      files.push({ path: safeRelative, absolute, bytes: stat.size });
    } else {
      throw new Error(`產物包含不支援的檔案類型：${safeRelative}`);
    }
  }
  return files;
}

export async function collectDirectoryManifest(root, archivePrefix) {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`產物目錄無效：${root}`);
  const files = await collectFiles(root);
  return Promise.all(files.map(async (file) => ({
    path: normalizeArchivePath(`${archivePrefix}/${file.path}`),
    bytes: file.bytes,
    sha256: sha256(await fs.readFile(file.absolute)),
  })));
}

export async function hashFile(absolutePath, archivePath) {
  const stat = await fs.lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`檔案無效或為符號連結：${absolutePath}`);
  return { path: normalizeArchivePath(archivePath), bytes: stat.size, sha256: sha256(await fs.readFile(absolutePath)) };
}

export function parseVersionJson(source) {
  let parsed;
  try { parsed = JSON.parse(source); } catch { throw new Error('dist/version.json 不是有效 JSON'); }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.buildId !== 'string' || typeof parsed.builtAt !== 'string') {
    throw new Error('dist/version.json 缺少 buildId 或 builtAt');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(parsed.buildId)) {
    throw new Error('dist/version.json 的 buildId 不是安全的檔名片段');
  }
  const builtAt = new Date(parsed.builtAt);
  if (Number.isNaN(builtAt.valueOf()) || builtAt.toISOString() !== parsed.builtAt) {
    throw new Error('dist/version.json 的 builtAt 必須是標準 UTC ISO 時間');
  }
  return { buildId: parsed.buildId, builtAt: parsed.builtAt };
}

export function buildDelta(files, baseline) {
  const currentFiles = [...files].sort(compareManifestEntries);
  if (!baseline) return { mode: 'full', changed: currentFiles.map((file) => file.path), removed: [] };
  const previousFiles = Array.isArray(baseline.files) ? baseline.files : [];
  const previous = new Map(previousFiles.map((file) => [file.path, file]));
  const current = new Map(currentFiles.map((file) => [file.path, file]));
  return {
    mode: 'delta',
    changed: currentFiles.filter((file) => {
      const old = previous.get(file.path);
      return !old || old.sha256 !== file.sha256 || old.bytes !== file.bytes;
    }).map((file) => file.path),
    removed: [...previous.keys()].filter((file) => !current.has(file)).sort(compareArchivePaths),
  };
}

export async function readBaselineManifest(manifestPath) {
  const source = await fs.readFile(manifestPath, 'utf8');
  let parsed;
  try { parsed = JSON.parse(source); } catch { throw new Error(`baseline manifest 不是有效 JSON：${manifestPath}`); }
  validateReceipt(parsed, 'baseline manifest');
  return parsed;
}

export function buildReceipt({ plan, files, distFiles, nginxFiles, version, verification, delta }) {
  const sortedFiles = [...files].sort(compareManifestEntries);
  if (plan?.eligible !== true || (plan.classification !== 'client' && plan.classification !== 'assets')) {
    throw new Error('receipt 只能由 eligible client/assets plan 建立');
  }
  if (verification?.command !== 'pnpm verify:client' || verification?.exitCode !== 0) {
    throw new Error('receipt 必須記錄本次成功完成的 pnpm verify:client');
  }
  const receipt = {
    schemaVersion: CLIENT_RELEASE_SCHEMA_VERSION,
    kind: 'daojie-client-release',
    commit: plan.commit,
    baseCommit: plan.baseCommit,
    artifactVersion: `client-${plan.commit.slice(0, 12)}-${version.buildId}`,
    classification: plan.classification,
    verification,
    verificationPassed: verification.exitCode === 0,
    verificationSkipped: false,
    buildId: version.buildId,
    version,
    dist: { files: [...distFiles].sort(compareManifestEntries) },
    nginx: { files: [...nginxFiles].sort(compareManifestEntries) },
    nginxTemplates: [...nginxFiles].sort(compareManifestEntries),
    files: sortedFiles,
    delta,
  };
  validateReceipt(receipt, 'receipt');
  return receipt;
}

export function assertBaselineMatchesPlan(baseline, plan) {
  if (baseline && baseline.commit !== plan.baseCommit) {
    throw new Error(`baseline commit ${baseline.commit} 與 --base ${plan.baseCommit} 不一致`);
  }
}

function validateReceipt(receipt, label) {
  if (!receipt || receipt.schemaVersion !== CLIENT_RELEASE_SCHEMA_VERSION || receipt.kind !== 'daojie-client-release') {
    throw new Error(`${label} schema 或 kind 無效`);
  }
  if (!/^[a-f0-9]{40}$/.test(receipt.commit ?? '') || !/^[a-f0-9]{40}$/.test(receipt.baseCommit ?? '')) {
    throw new Error(`${label} commit 資訊無效`);
  }
  const version = parseVersionJson(JSON.stringify(receipt.version ?? {}));
  if (receipt.buildId !== version.buildId) throw new Error(`${label} buildId 與 version.buildId 不一致`);
  const expectedArtifactVersion = `client-${receipt.commit.slice(0, 12)}-${version.buildId}`;
  if (receipt.artifactVersion !== expectedArtifactVersion) throw new Error(`${label} artifactVersion 與 commit/buildId 不一致`);
  if (receipt.verificationPassed !== true || receipt.verificationSkipped !== false
    || receipt.verification?.command !== 'pnpm verify:client' || receipt.verification?.exitCode !== 0) {
    throw new Error(`${label} 缺少成功的 pnpm verify:client 證據`);
  }
  const startedAt = new Date(receipt.verification.startedAt);
  const completedAt = new Date(receipt.verification.completedAt);
  if (Number.isNaN(startedAt.valueOf()) || Number.isNaN(completedAt.valueOf())
    || startedAt.toISOString() !== receipt.verification.startedAt
    || completedAt.toISOString() !== receipt.verification.completedAt
    || startedAt > completedAt) {
    throw new Error(`${label} verify:client 時間證據無效`);
  }
  const distFiles = validateFileList(receipt.dist?.files, `${label} dist`, 'dist/');
  const nginxFiles = validateFileList(receipt.nginx?.files, `${label} nginx`, 'nginx/');
  const nginxTemplates = validateFileList(receipt.nginxTemplates, `${label} nginxTemplates`, 'nginx/');
  const files = validateFileList(receipt.files, `${label} files`);
  if (JSON.stringify(nginxTemplates) !== JSON.stringify(nginxFiles)
    || nginxFiles.length !== EXPECTED_NGINX_TEMPLATES.size
    || nginxFiles.some((file) => !EXPECTED_NGINX_TEMPLATES.has(file.path))) {
    throw new Error(`${label} nginxTemplates 必須等於固定兩份 nginx 檔案`);
  }
  const expectedFiles = [...distFiles, ...nginxFiles].sort(compareManifestEntries);
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${label} files 必須完整等於 dist 與 nginx 清單聯集`);
  }
  const versionFile = files.find((file) => file.path === 'dist/version.json');
  if (!versionFile || receipt.version?.manifestPath !== versionFile.path || receipt.version?.sha256 !== versionFile.sha256) {
    throw new Error(`${label} version.json 雜湊未綁定 files 清單`);
  }
}

function validateFileList(value, label, requiredPrefix = null) {
  if (!Array.isArray(value)) throw new Error(`${label} 缺少檔案陣列`);
  const files = value.map((file) => {
    const archivePath = normalizeArchivePath(file?.path);
    if (requiredPrefix && !archivePath.startsWith(requiredPrefix)) throw new Error(`${label} 路徑範圍無效：${archivePath}`);
    if (!Number.isSafeInteger(file?.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file?.sha256 ?? '')) {
      throw new Error(`${label} 檔案記錄無效：${archivePath}`);
    }
    return { path: archivePath, bytes: file.bytes, sha256: file.sha256 };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error(`${label} 不可含重複路徑`);
  const sorted = [...files].sort(compareManifestEntries);
  if (files.some((file, index) => file.path !== sorted[index].path)) throw new Error(`${label} 必須依路徑排序`);
  return files;
}

function compareManifestEntries(left, right) {
  return compareArchivePaths(left.path, right.path);
}

function compareArchivePaths(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export async function assertAllowedOutput(repoRoot, output) {
  const resolvedRepo = await fs.realpath(repoRoot);
  const resolvedOutput = path.resolve(output);
  await assertNoSymlinkPath(resolvedOutput);
  const relative = path.relative(resolvedRepo, resolvedOutput);
  const isInsideRepo = relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  if (isInsideRepo) {
    const ignored = spawnSync('git', ['check-ignore', '-q', '--', resolvedOutput], { cwd: resolvedRepo, shell: false });
    if (ignored.status !== 0) throw new Error('輸出目錄位於 repo 內時，必須被 .gitignore 忽略');
  }
  return resolvedOutput;
}

async function assertNoSymlinkPath(absolutePath) {
  const parsed = path.parse(absolutePath);
  let current = parsed.root;
  for (const segment of absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`輸出路徑不得經過符號連結：${current}`);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}
