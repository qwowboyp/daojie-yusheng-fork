import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertAllowedOutput,
  assertCleanWorktree,
  assertStableWorktree,
  buildDelta,
  buildReceipt,
  classifyChangedPaths,
  collectDirectoryManifest,
  normalizeArchivePath,
  parseGitPathList,
  parseVersionJson,
  readCoordinatedVerificationReport,
  readFullVerificationReport,
  resolveGitCommit,
  readBaselineManifest,
  sha256,
} from './manifest.mjs';
import { assertReleaseMode, parseArgs as parsePrepareArgs } from './prepare.mjs';
import { parseArgs as parsePlanArgs } from './plan.mjs';
import {
  REQUIRED_BUILD_COMMANDS,
  SCOPED_VERIFICATION_COMMAND,
  resolveVerificationPlan,
} from './verification.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function testConservativeClassification() {
  assert.deepEqual(classifyChangedPaths(['packages/client/public/assets/map.webp', 'docs/runbook.md']).classification, 'assets');
  assert.deepEqual(classifyChangedPaths(['packages/client/public/assets/map.webp', 'AGENTS.md']).classification, 'assets');
  assert.deepEqual(classifyChangedPaths(['packages/client/public/main.js']).classification, 'client');
  assert.deepEqual(classifyChangedPaths(['packages/client/src/main.ts']).classification, 'client');
  assert.deepEqual(classifyChangedPaths(['scripts/client-release/prepare.mjs']).classification, 'client');
  assert.deepEqual(classifyChangedPaths(['.claude/skills/daojie-deploy/scripts/deploy.ps1']).classification, 'client');
  assert.deepEqual(classifyChangedPaths(['.claude/skills/daojie-deploy/SKILL.md']).classification, 'assets');
  assert.deepEqual(classifyChangedPaths(['.claude/skills/daojie-deploy/scripts/other.ps1']).classification, 'full');
  assert.deepEqual(classifyChangedPaths(['.runtime/releases/deploy-optimization/scripts/client-release/prepare.mjs']).classification, 'full');
  const full = classifyChangedPaths(['packages/server/data/content/items.json']);
  assert.equal(full.classification, 'full');
  assert.equal(full.eligible, false);
  assert.deepEqual(classifyChangedPaths(['scripts/unknown-release.mjs']).classification, 'full');
  assert.deepEqual(classifyChangedPaths(['pnpm-lock.yaml']).classification, 'full');
}

function testPureSafetyAndDrift() {
  assert.equal(normalizeArchivePath('dist/assets/main.js'), 'dist/assets/main.js');
  assert.throws(() => normalizeArchivePath('../secret'), /不得跳出根目錄/);
  assert.throws(() => normalizeArchivePath('dist/../secret'), /不得跳出根目錄/);
  assert.throws(() => normalizeArchivePath('C:/secret'), /絕對路徑/);
  assert.throws(() => normalizeArchivePath('dist\\secret'), /必須使用/);
  assert.deepEqual(
    parseGitPathList(Buffer.from('packages/client/line\nbreak.ts\0scripts/client-release/prepare.mjs\0')),
    ['packages/client/line\nbreak.ts', 'scripts/client-release/prepare.mjs'],
  );
  assert.throws(() => parseGitPathList(Buffer.from('packages/client/main.ts')), /NUL/);
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.deepEqual(parseVersionJson('{"buildId":"abc","builtAt":"2026-09-12T00:00:00.000Z"}'), {
    buildId: 'abc', builtAt: '2026-09-12T00:00:00.000Z',
  });
  assert.throws(() => parseVersionJson('{}'), /缺少/);
  assert.throws(() => parseVersionJson('{"buildId":"../../escape","builtAt":"2026-09-12T00:00:00.000Z"}'), /安全/);
  assert.throws(() => parseVersionJson('{"buildId":"abc","builtAt":"2026-09-12"}'), /標準/);
  assert.doesNotThrow(() => assertCleanWorktree({ porcelain: '' }));
  assert.throws(() => assertCleanWorktree({ porcelain: 'dirty' }), /乾淨/);
  assert.doesNotThrow(() => assertStableWorktree({ headCommit: 'a', porcelain: '' }, { headCommit: 'a', porcelain: '' }));
  assert.throws(() => assertStableWorktree({ headCommit: 'a', porcelain: '' }, { headCommit: 'b', porcelain: '' }), /漂移/);
  assert.throws(() => assertStableWorktree({ headCommit: 'a', porcelain: '' }, { headCommit: 'a', porcelain: ' M x' }), /漂移/);
}

async function testManifestAndDelta() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daojie-client-release-'));
  try {
    await fs.mkdir(path.join(tempRoot, 'assets'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'index.html'), '<main>道劫</main>', 'utf8');
    await fs.writeFile(path.join(tempRoot, 'assets', 'main.js'), 'export {}', 'utf8');
    const files = await collectDirectoryManifest(tempRoot, 'dist');
    assert.deepEqual(files.map((file) => file.path), ['dist/assets/main.js', 'dist/index.html']);
    const baseline = { files: [files[0], { path: 'dist/removed.js', bytes: 1, sha256: '0'.repeat(64) }] };
    assert.deepEqual(buildDelta(files, baseline), { mode: 'delta', changed: ['dist/index.html'], removed: ['dist/removed.js'] });
    assert.deepEqual(buildDelta(files, null), { mode: 'full', changed: ['dist/assets/main.js', 'dist/index.html'], removed: [] });

    const linkPath = path.join(tempRoot, 'unsafe-link');
    try {
      await fs.symlink(path.join(tempRoot, 'index.html'), linkPath);
      await assert.rejects(() => collectDirectoryManifest(tempRoot, 'dist'), /符號連結/);
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function testReceiptAndOutputBoundary() {
  const versionFile = { path: 'dist/version.json', bytes: 2, sha256: '1'.repeat(64) };
  const distFiles = [versionFile, { path: 'dist/index.html', bytes: 3, sha256: '2'.repeat(64) }];
  const nginxFiles = [
    { path: 'nginx/default.conf.template', bytes: 4, sha256: '3'.repeat(64) },
    { path: 'nginx/nginx.conf.template', bytes: 5, sha256: '4'.repeat(64) },
  ];
  const files = [...distFiles, ...nginxFiles];
  const plan = {
    commit: 'a'.repeat(40), baseCommit: 'b'.repeat(40), classification: 'client', eligible: true,
  };
  const verification = {
    command: 'pnpm verify:client', exitCode: 0,
    startedAt: '2026-09-12T00:00:00.000Z', completedAt: '2026-09-12T00:01:00.000Z',
  };
  const receipt = buildReceipt({
    plan,
    files,
    distFiles,
    nginxFiles,
    version: {
      buildId: 'abc123', builtAt: '2026-09-12T00:00:30.000Z',
      manifestPath: versionFile.path, sha256: versionFile.sha256,
    },
    verification,
    delta: { mode: 'full', changed: files.map((file) => file.path), removed: [] },
  });
  assert.equal(receipt.verificationSkipped, false);
  assert.throws(() => buildReceipt({
    plan, files, distFiles, nginxFiles, version: receipt.version,
    verification: { ...verification, command: 'pnpm build:client' }, delta: receipt.delta,
  }), /mode\/command/);

  const verificationPlan = resolveVerificationPlan(repoRoot, { proofs: ['release-contracts'] });
  const scopedVerification = {
    mode: 'scoped',
    command: SCOPED_VERIFICATION_COMMAND,
    selectedProofs: verificationPlan.selectedProofs,
    commands: verificationPlan.commands.map((item) => ({
      ...item,
      argv: [...item.argv],
      exitCode: 0,
      startedAt: '2026-09-12T00:00:00.000Z',
      completedAt: '2026-09-12T00:01:00.000Z',
    })),
    exitCode: 0,
    startedAt: '2026-09-12T00:00:00.000Z',
    completedAt: '2026-09-12T00:01:00.000Z',
  };
  const scopedReceipt = buildReceipt({
    plan: { ...plan, paths: ['scripts/client-release/prepare.mjs'] },
    files,
    distFiles,
    nginxFiles,
    version: receipt.version,
    verification: scopedVerification,
    delta: receipt.delta,
  });
  assert.equal(scopedReceipt.verification.mode, 'scoped');
  assert.deepEqual(scopedReceipt.changeScope.paths, ['scripts/client-release/prepare.mjs']);
  assert.throws(() => buildReceipt({
    plan: { ...plan, paths: [] }, files, distFiles, nginxFiles, version: receipt.version,
    verification: scopedVerification, delta: receipt.delta,
  }), /changeScope/);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daojie-client-receipt-'));
  try {
    const baselinePath = path.join(tempRoot, 'receipt.json');
    await fs.writeFile(baselinePath, JSON.stringify(receipt), 'utf8');
    assert.deepEqual(await readBaselineManifest(baselinePath), receipt);
    await fs.writeFile(baselinePath, JSON.stringify(scopedReceipt), 'utf8');
    assert.deepEqual(await readBaselineManifest(baselinePath), scopedReceipt);
    for (const [mutate, expected] of [
      [(value) => { value.verification.mode = 'unknown'; }, /mode\/command/],
      [(value) => { value.verification.selectedProofs = []; }, /selectedProofs/],
      [(value) => { value.verification.commands.at(-1).exitCode = 1; }, /command 結果/],
      [(value) => { delete value.verification.commands[0].startedAt; }, /UTC ISO/],
    ]) {
      const invalid = structuredClone(scopedReceipt);
      mutate(invalid);
      await fs.writeFile(baselinePath, JSON.stringify(invalid), 'utf8');
      await assert.rejects(() => readBaselineManifest(baselinePath), expected);
    }
    await fs.writeFile(baselinePath, JSON.stringify({ ...receipt, files: receipt.files.slice(1) }), 'utf8');
    await assert.rejects(() => readBaselineManifest(baselinePath), /完整等於/);

    const symlinkPath = path.join(tempRoot, 'linked-output');
    try {
      const targetPath = path.join(tempRoot, 'target');
      await fs.mkdir(targetPath);
      await fs.symlink(targetPath, symlinkPath, 'junction');
      await assert.rejects(() => assertAllowedOutput(repoRoot, symlinkPath), /符號連結/);
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  await assert.rejects(
    () => assertAllowedOutput(repoRoot, path.join(repoRoot, '..not-ignored-client-release')),
    /必須被 .gitignore 忽略/,
  );
}

async function testVerificationSelectionContract() {
  assert.throws(() => resolveVerificationPlan(repoRoot), /至少指定一個 --proof/);
  assert.throws(
    () => resolveVerificationPlan(repoRoot, { proofs: ['building-workspace'], allClientTests: true }),
    /不可同時使用/,
  );
  assert.throws(() => resolveVerificationPlan(repoRoot, { proofs: ['missing-proof'] }), /未知 proof/);
  assert.throws(
    () => resolveVerificationPlan(repoRoot, { proofs: ['scripts/client-release/prepare.mjs;whoami'] }),
    /白名單/,
  );
  assert.throws(
    () => resolveVerificationPlan(repoRoot, { proofs: ['packages/server/src/index.ts'] }),
    /白名單/,
  );

  const selected = resolveVerificationPlan(repoRoot, {
    proofs: ['release-contracts', 'building-workspace', 'packages/client/scripts/prove-spirit-beast-map-browser.mjs'],
  });
  assert.equal(selected.mode, 'scoped');
  assert.deepEqual(selected.commands.slice(0, REQUIRED_BUILD_COMMANDS.length), [...REQUIRED_BUILD_COMMANDS]);
  assert.equal(selected.selectedProofs[0].id, 'release-contracts');
  assert.equal(selected.selectedProofs[1].id, 'building-workspace');
  assert.equal(selected.selectedProofs[2].path, 'packages/client/scripts/prove-spirit-beast-map-browser.mjs');
  assert.equal(selected.commands.at(-1).executable, 'node');

  const preview = resolveVerificationPlan(repoRoot, { requireSelection: false });
  assert.equal(preview.mode, null);
  assert.equal(preview.prepareRequiresExplicitSelection, true);
  assert.throws(
    () => parsePrepareArgs(['--base', 'HEAD~1', '--output', 'out']),
    /至少指定一個 --proof/,
  );
  const prepareOptions = parsePrepareArgs([
    '--base', 'HEAD~1', '--output', 'out', '--proof', 'release-contracts',
    '--coordinated-full', '--full-verification', 'report.json',
  ]);
  assert.deepEqual(prepareOptions.proofs, ['release-contracts']);
  assert.equal(prepareOptions.fullVerification, 'report.json');
  const scopedPrepareOptions = parsePrepareArgs([
    '--base', 'HEAD~1', '--output', 'out', '--proof', 'release-contracts',
    '--coordinated-full', '--scoped-verification', 'scoped.json',
  ]);
  assert.equal(scopedPrepareOptions.scopedVerification, 'scoped.json');
  assert.throws(() => parsePrepareArgs([
    '--base', 'HEAD~1', '--output', 'out', '--proof', 'release-contracts', '--coordinated-full',
    '--full-verification', 'full.json', '--scoped-verification', 'scoped.json',
  ]), /必須且只能/);
  assert.deepEqual(parsePlanArgs(['--base', 'HEAD~1', '--proof', 'release-contracts']).proofs, ['release-contracts']);

  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'daojie-proof-realpath-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'daojie-proof-external-'));
  try {
    await fs.mkdir(path.join(tempRepo, 'packages', 'client'), { recursive: true });
    await fs.mkdir(path.join(tempRepo, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(tempRepo, 'package.json'), '{"scripts":{}}', 'utf8');
    await fs.writeFile(path.join(tempRepo, 'packages', 'client', 'package.json'), '{"scripts":{}}', 'utf8');
    await fs.writeFile(path.join(external, 'prove-escape.mjs'), 'export {};', 'utf8');
    try {
      await fs.symlink(external, path.join(tempRepo, 'scripts', 'linked'), 'junction');
      assert.throws(
        () => resolveVerificationPlan(tempRepo, { proofs: ['scripts/linked/prove-escape.mjs'] }),
        /實際路徑必須位於 repo 內/,
      );
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    }
  } finally {
    await fs.rm(tempRepo, { recursive: true, force: true });
    await fs.rm(external, { recursive: true, force: true });
  }
}

async function testCoordinatedFullVerification() {
  assert.throws(
    () => parsePrepareArgs(['--base', 'HEAD~1', '--output', 'out', '--coordinated-full']),
    /必須且只能/,
  );
  const fullPlan = {
    commit: resolveGitCommit(repoRoot, 'HEAD'),
    baseCommit: 'b'.repeat(40),
    classification: 'full',
    eligible: false,
    paths: ['packages/server/example.ts'],
    blockedPaths: ['packages/server/example.ts'],
  };
  assert.throws(() => assertReleaseMode(fullPlan, { coordinatedFull: false }), /缺少 coordinated full 證據/);
  assert.throws(() => assertReleaseMode(fullPlan, { coordinatedFull: false }), /缺少 coordinated full 證據/);
  const receiptArgs = {
    plan: fullPlan,
    files: [],
    distFiles: [],
    nginxFiles: [],
    version: {
      buildId: 'fullproof',
      builtAt: '2026-09-13T00:00:30.000Z',
      manifestPath: 'dist/version.json',
      sha256: '1'.repeat(64),
    },
    verification: {
      command: 'pnpm verify:client',
      exitCode: 0,
      startedAt: '2026-09-13T00:00:00.000Z',
      completedAt: '2026-09-13T00:01:00.000Z',
    },
    delta: { mode: 'full', changed: [], removed: [] },
  };
  assert.throws(() => buildReceipt(receiptArgs), /完整證據/);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daojie-full-verification-'));
  try {
    const archivePath = path.join(tempRoot, 'source.tar');
    const archiveResult = spawnSync('git', ['archive', '--format=tar', '--output', archivePath, fullPlan.commit], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
    });
    assert.equal(archiveResult.status, 0, archiveResult.stderr || archiveResult.stdout);
    const archiveBytes = await fs.readFile(archivePath);
    const baseReport = {
      schemaVersion: 1,
      kind: 'daojie-full-release-verification',
      commit: fullPlan.commit,
      command: 'pnpm verify:release:full',
      exitCode: 0,
      startedAt: '2026-09-13T00:00:00.000Z',
      completedAt: '2026-09-13T00:10:00.000Z',
      sourceArchive: { path: 'source.tar', bytes: archiveBytes.byteLength, sha256: sha256(archiveBytes) },
      gates: [
        { label: 'with-db', exitCode: 0 },
        { label: 'gm-database-backup-persistence', exitCode: 0 },
        { label: 'shadow', exitCode: 0 },
        { label: 'gm', exitCode: 0 },
      ],
    };
    const reportPath = path.join(tempRoot, 'report.json');
    const verifyReport = async (report) => {
      await fs.writeFile(reportPath, `${JSON.stringify(report)}\n`, 'utf8');
      return readFullVerificationReport(repoRoot, reportPath, fullPlan.commit);
    };
    await assert.rejects(() => verifyReport({ ...baseReport, commit: 'a'.repeat(40) }), /commit 必須等於/);
    await assert.rejects(() => verifyReport({ ...baseReport, exitCode: 1 }), /成功的 pnpm verify:release:full/);
    await assert.rejects(() => verifyReport({ ...baseReport, gates: baseReport.gates.slice(0, -1) }), /gate 清單不完整/);
    await assert.rejects(() => verifyReport({
      ...baseReport,
      sourceArchive: { ...baseReport.sourceArchive, sha256: 'f'.repeat(64) },
    }), /與實際檔案不一致/);
    const fullVerification = await verifyReport(baseReport);
    assert.equal(fullVerification.commit, fullPlan.commit);
    assert.equal(fullVerification.report.sha256.length, 64);
    const versionFile = { path: 'dist/version.json', bytes: 2, sha256: '1'.repeat(64) };
    const nginxFiles = [
      { path: 'nginx/default.conf.template', bytes: 3, sha256: '2'.repeat(64) },
      { path: 'nginx/nginx.conf.template', bytes: 4, sha256: '3'.repeat(64) },
    ];
    const fullReceipt = buildReceipt({
      ...receiptArgs,
      files: [versionFile, ...nginxFiles],
      distFiles: [versionFile],
      nginxFiles,
      fullVerification,
    });
    assert.equal(fullReceipt.classification, 'full');
    assert.equal(fullReceipt.coordinatedFull.serverCommit, fullPlan.commit);

    const scopedPaths = fullPlan.paths;
    const scopedReport = {
      schemaVersion: 1,
      kind: 'daojie-scoped-source-verification',
      commit: fullPlan.commit,
      baseCommit: fullPlan.baseCommit,
      command: 'node scripts/scoped-source-verification.mjs',
      exitCode: 0,
      startedAt: '2026-09-13T00:00:00.000Z',
      completedAt: '2026-09-13T00:10:00.000Z',
      changeScope: { baseCommit: fullPlan.baseCommit, commit: fullPlan.commit, paths: scopedPaths },
      selectedProofs: [{ input: 'scripts/prove-spirit-beast-redesign.mjs', kind: 'script', path: 'scripts/prove-spirit-beast-redesign.mjs' }],
      commands: [
        ['setup:dependencies', 'pnpm', ['install', '--frozen-lockfile']],
        ['check:shared-types', 'pnpm', ['--dir', 'packages/shared', 'exec', 'tsc']],
        ['check:server-types', 'pnpm', ['--dir', 'packages/server', 'exec', 'tsc', '-p', 'tsconfig.json', '--pretty', 'false']],
        ['proof:script:scripts/prove-spirit-beast-redesign.mjs', 'node', ['scripts/prove-spirit-beast-redesign.mjs']],
      ].map(([label, executable, argv]) => ({ label, executable, argv, cwd: '.', exitCode: 0,
        startedAt: '2026-09-13T00:00:01.000Z', completedAt: '2026-09-13T00:09:59.000Z' })),
      sourceArchive: baseReport.sourceArchive,
    };
    await fs.writeFile(reportPath, `${JSON.stringify(scopedReport)}\n`, 'utf8');
    const scopedVerification = await readCoordinatedVerificationReport(
      repoRoot, reportPath, fullPlan.commit, fullPlan.baseCommit, scopedPaths,
    );
    assert.equal(scopedVerification.kind, 'daojie-scoped-source-verification');
    assert.equal(scopedVerification.report.sha256.length, 64);
    const commandTime = {
      cwd: '.', exitCode: 0,
      startedAt: '2026-09-13T00:00:01.000Z', completedAt: '2026-09-13T00:09:59.000Z',
    };
    const scopedReceipt = buildReceipt({
      ...receiptArgs,
      files: [versionFile, ...nginxFiles],
      distFiles: [versionFile],
      nginxFiles,
      verification: {
        mode: 'scoped', command: SCOPED_VERIFICATION_COMMAND,
        selectedProofs: [{ input: 'release-contracts', kind: 'script', path: 'scripts/client-release/prove-release-contracts.mjs' }],
        commands: [
          ...REQUIRED_BUILD_COMMANDS.map((command) => ({ ...command, argv: [...command.argv], ...commandTime })),
          { label: 'proof:script:scripts/client-release/prove-release-contracts.mjs', executable: 'node',
            argv: ['scripts/client-release/prove-release-contracts.mjs'], ...commandTime },
        ],
        exitCode: 0, startedAt: '2026-09-13T00:00:00.000Z', completedAt: '2026-09-13T00:10:00.000Z',
      },
      coordinatedVerification: scopedVerification,
    });
    assert.equal(scopedReceipt.coordinatedFull.scopedVerification.kind, 'daojie-scoped-source-verification');
    await assert.rejects(
      () => readCoordinatedVerificationReport(repoRoot, reportPath, fullPlan.commit, fullPlan.baseCommit, ['other.ts']),
      /完整 changeScope 不一致/,
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function testI18nGeneratorNormalizesCheckoutLineEndings() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'daojie-i18n-newlines-'));
  try {
    const clientRoot = path.join(tempRoot, 'client');
    const generatorPath = path.join(clientRoot, 'scripts', 'generate-i18n.mjs');
    const csvPath = path.join(clientRoot, 'src', 'content', 'i18n', 'zh-TW.csv');
    const outputPath = path.join(clientRoot, 'src', 'constants', 'ui', 'i18n.generated.ts');
    await fs.mkdir(path.dirname(generatorPath), { recursive: true });
    await fs.mkdir(path.dirname(csvPath), { recursive: true });
    await fs.copyFile(path.join(repoRoot, 'packages', 'client', 'scripts', 'generate-i18n.mjs'), generatorPath);
    const csvLf = 'key,category,zh-TW,note\nnotice.test,general,"第一行\n第二行",多行\n';
    const generate = async (csv) => {
      await fs.writeFile(csvPath, csv, 'utf8');
      const result = spawnSync(process.execPath, [generatorPath], { cwd: tempRoot, encoding: 'utf8', shell: false });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return fs.readFile(outputPath, 'utf8');
    };
    const lfOutput = await generate(csvLf);
    const crlfOutput = await generate(csvLf.replaceAll('\n', '\r\n'));
    assert.equal(crlfOutput, lfOutput, 'LF/CRLF checkout 必須生成完全相同的語言包');
    assert.equal(crlfOutput.includes('\\r'), false, '多行文案不得殘留 escaped \\r');
    assert.match(crlfOutput, /第一行\\n第二行/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function testDockerfileToolchainCacheBoundary() {
  const dockerfile = await fs.readFile(path.join(repoRoot, 'packages', 'client', 'Dockerfile'), 'utf8');
  const toolchainMatch = /^FROM\s+node:20-alpine\s+AS\s+toolchain\s*$/mi.exec(dockerfile);
  assert.ok(toolchainMatch, 'client Dockerfile 必須先建立 FROM node:20-alpine AS toolchain 工具層');
  const builderMatch = /^FROM\s+toolchain\s+AS\s+builder\s*$/mi.exec(dockerfile);
  assert.ok(builderMatch, 'client Dockerfile 的 builder 必須 FROM toolchain');
  assert.ok(builderMatch.index > toolchainMatch.index, 'toolchain 必須先於 builder');
  const toolchainBlock = dockerfile.slice(toolchainMatch.index, builderMatch.index);
  assert.match(toolchainBlock, /apk\s+add\s+--no-cache[\s\S]*\bchromium\b/, 'toolchain 必須安裝 chromium');
  assert.doesNotMatch(toolchainBlock, /^\s*COPY\s+/mi, 'toolchain 不得 COPY 專案檔案，避免 package.json 失效工具快取');
  const firstCopy = /^\s*COPY\s+/mi.exec(dockerfile);
  assert.ok(firstCopy && firstCopy.index > builderMatch.index, '第一個 COPY 必須位於 FROM toolchain AS builder 之後');
  const beforeBuilder = dockerfile.slice(0, builderMatch.index);
  assert.doesNotMatch(beforeBuilder, /packages\/client\/package\.json/, 'package.json 不得成為工具層輸入');
}

testConservativeClassification();
testPureSafetyAndDrift();
await testVerificationSelectionContract();
await testManifestAndDelta();
await testReceiptAndOutputBoundary();
await testCoordinatedFullVerification();
await testI18nGeneratorNormalizesCheckoutLineEndings();
await testDockerfileToolchainCacheBoundary();
process.stdout.write('client release helper checks passed\n');
