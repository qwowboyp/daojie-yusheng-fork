import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyChangedPaths } from './manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wrapperPath = path.join(repoRoot, 'scripts', 'client-release', 'deploy.ps1');
const legacyPath = path.join(repoRoot, '.claude', 'skills', 'daojie-deploy', 'scripts', 'deploy.ps1');
const canonicalEntrypoint = 'scripts/client-release/deploy.ps1';
const skillDeployScript = '.claude/skills/daojie-deploy/scripts/deploy.ps1';
const skillDoc = '.claude/skills/daojie-deploy/SKILL.md';
const knownHostsStub = path.join(repoRoot, '.gitignore');
const forbiddenOrdinaryTokens = Object.freeze([
  'daojie-src.tar.gz',
  'lxc-deploy.sh',
  'winscp',
  'sftp://',
  'Read-PveEnv',
  'pve.env',
]);

function readScript(filePath) {
  return fs.readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n');
}

function combinedOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function parsePlan(stdout) {
  const text = String(stdout ?? '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  assert.ok(start >= 0 && end > start, `DryRun stdout is not plan JSON: ${text.slice(0, 400)}`);
  return JSON.parse(text.slice(start, end + 1));
}

function proofList(plan) {
  return [plan.proofs].flat().filter((value) => typeof value === 'string' && value.length > 0);
}

function runPwsh(scriptPath, args) {
  return spawnSync('pwsh', ['-NoProfile', '-File', scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

function assertOrdinaryPlan(plan, mode) {
  assert.equal(plan.ok, true);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.mode, mode);
  assert.equal(plan.entrypoint, canonicalEntrypoint);
  assert.equal(plan.automaticFallback, false);
  assert.equal(plan.envRead, false);
  assert.equal(plan.sourceArchive, false);
  assert.equal(plan.sftpFullRepo, false);
  assert.equal(plan.dockerBuild, false);
  assert.equal(plan.containerRecreate, false);
  assert.notEqual(plan.mode, 'recovery-source-build');
  const blob = JSON.stringify(plan);
  for (const token of forbiddenOrdinaryTokens) {
    assert.equal(blob.includes(token), false, token);
  }
}

function testClassifierExceptions() {
  const tooling = classifyChangedPaths([skillDeployScript]);
  assert.equal(tooling.classification, 'client');
  assert.equal(tooling.eligible, true);
  assert.deepEqual(tooling.blockedPaths, []);

  const docsOnly = classifyChangedPaths([skillDoc]);
  assert.equal(docsOnly.classification, 'assets');
  assert.equal(docsOnly.eligible, true);
  assert.deepEqual(docsOnly.blockedPaths, []);

  assert.equal(classifyChangedPaths(['.claude/skills/daojie-deploy/README.md']).classification, 'full');
  assert.equal(classifyChangedPaths(['.claude/skills/daojie-deploy/scripts/other.ps1']).classification, 'full');
  assert.equal(classifyChangedPaths(['.claude/skills/other/deploy.ps1']).classification, 'full');
  assert.equal(classifyChangedPaths(['.claude/SKILL.md']).classification, 'full');

  const mixedClient = classifyChangedPaths(['packages/client/src/main.ts', skillDeployScript, skillDoc]);
  assert.equal(mixedClient.classification, 'client');
  assert.equal(mixedClient.eligible, true);

  const mixedFull = classifyChangedPaths(['packages/server/src/index.ts', skillDeployScript]);
  assert.equal(mixedFull.classification, 'full');
  assert.equal(mixedFull.eligible, false);
}

function testWrapperSource(wrapper) {
  assert.match(wrapper, /\[ValidateSet\('publish', 'bootstrap', 'recovery-source-build'\)\]/);
  assert.match(wrapper, /\[string\]\$Mode = 'publish'/);
  assert.match(wrapper, /missing-proof/);
  assert.match(wrapper, /missing-known-hosts/);
  assert.match(wrapper, /missing-bootstrap-identities/);
  assert.match(wrapper, /skip-verify-rejected/);
  assert.match(wrapper, /bootstrap-required/);
  assert.doesNotMatch(wrapper, /Read-PveEnv/);
  assert.match(wrapper, /AllowClientSourceBuildRecovery/);
  const recoveryIdx = wrapper.indexOf("$Mode -eq 'recovery-source-build'");
  const allowIdx = wrapper.indexOf('AllowClientSourceBuildRecovery');
  assert.ok(recoveryIdx >= 0 && allowIdx > recoveryIdx, 'recovery authorization must stay inside recovery-source-build');
  assert.equal((wrapper.match(/AllowClientSourceBuildRecovery/g) ?? []).length, 1);
  assert.doesNotMatch(wrapper, /git archive/);
}

function testLegacyRouterSource(legacy) {
  const interceptIdx = legacy.indexOf(canonicalEntrypoint.replaceAll('/', '\\')) >= 0
    ? legacy.indexOf(canonicalEntrypoint.replaceAll('/', '\\'))
    : legacy.indexOf(canonicalEntrypoint);
  const envIdx = legacy.indexOf('Read-PveEnv');
  const archiveIdx = legacy.indexOf('git archive', envIdx);
  assert.ok(interceptIdx >= 0, 'legacy client path must call canonical wrapper');
  assert.ok(envIdx >= 0 && archiveIdx >= 0, 'server/both must keep legacy env/archive');
  assert.ok(interceptIdx < envIdx, 'client intercept must run before env loading');
  assert.ok(envIdx < archiveIdx, 'legacy archive must remain after env loading');
  assert.match(legacy, /\$Target -eq 'client'/);
  assert.match(legacy, /AllowClientSourceBuildRecovery/);
  assert.match(legacy, /\[ValidateSet\('server', 'client', 'both'\)\]/);
  const clientGateStart = legacy.indexOf("if ($Target -eq 'client' -and -not $AllowClientSourceBuildRecovery)");
  assert.ok(clientGateStart >= 0 && clientGateStart < envIdx, 'client gate must precede env loading');
  const clientGate = legacy.slice(clientGateStart, envIdx);
  assert.match(clientGate, /AllowClientSourceBuildRecovery/);
  assert.doesNotMatch(clientGate, /git archive/);
  const afterIntercept = legacy.slice(envIdx);
  assert.match(afterIntercept, /git archive/);
  assert.match(afterIntercept, /docker build/);
  assert.doesNotMatch(afterIntercept, /scripts\\client-release\\deploy\.ps1/);
}

function testHotDryRuns() {
  const missingProof = runPwsh(wrapperPath, ['-DryRun', '-KnownHosts', knownHostsStub]);
  assert.notEqual(missingProof.status, 0);
  assert.match(combinedOutput(missingProof), /missing-proof/);

  const missingHosts = runPwsh(wrapperPath, ['-DryRun', '-Proof', 'release-contracts']);
  assert.notEqual(missingHosts.status, 0);
  assert.match(combinedOutput(missingHosts), /missing-known-hosts/);

  const skipVerify = runPwsh(wrapperPath, [
    '-DryRun', '-Proof', 'release-contracts', '-KnownHosts', knownHostsStub, '-SkipVerify',
  ]);
  assert.notEqual(skipVerify.status, 0);
  assert.match(combinedOutput(skipVerify), /skip-verify-rejected/);

  const missingBootstrap = runPwsh(wrapperPath, [
    '-Mode', 'bootstrap', '-DryRun', '-Proof', 'release-contracts', '-KnownHosts', knownHostsStub,
  ]);
  assert.notEqual(missingBootstrap.status, 0);
  assert.match(combinedOutput(missingBootstrap), /missing-bootstrap-identities/);

  const shortAdopt = runPwsh(wrapperPath, [
    '-Mode', 'bootstrap', '-DryRun', '-Proof', 'release-contracts', '-KnownHosts', knownHostsStub,
    '-AdoptCommit', 'abc', '-ExpectedImage', `sha256:${'a'.repeat(64)}`,
  ]);
  assert.notEqual(shortAdopt.status, 0);
  assert.match(combinedOutput(shortAdopt), /missing-bootstrap-identities/);

  const badImage = runPwsh(wrapperPath, [
    '-Mode', 'bootstrap', '-DryRun', '-Proof', 'release-contracts', '-KnownHosts', knownHostsStub,
    '-AdoptCommit', 'a'.repeat(40), '-ExpectedImage', 'sha256:not-a-digest',
  ]);
  assert.notEqual(badImage.status, 0);
  assert.match(combinedOutput(badImage), /missing-bootstrap-identities/);

  const uniqueOutput = path.join('.runtime', 'releases', `entrypoint-dryrun-${process.pid}-${Date.now()}`);
  const uniqueAbs = path.join(repoRoot, uniqueOutput);
  const tarPath = path.join(repoRoot, 'daojie-src.tar.gz');
  const tarBefore = fs.existsSync(tarPath);
  const publish = runPwsh(wrapperPath, [
    '-DryRun', '-Proof', 'release-contracts', '-KnownHosts', knownHostsStub, '-Output', uniqueOutput,
  ]);
  assert.equal(publish.status, 0, combinedOutput(publish));
  assert.equal(fs.existsSync(uniqueAbs), false, 'DryRun must not create output directories');
  assert.equal(fs.existsSync(tarPath), tarBefore, 'DryRun must not create source archive');
  const publishPlan = parsePlan(publish.stdout);
  assertOrdinaryPlan(publishPlan, 'publish');
  assert.deepEqual(proofList(publishPlan), ['release-contracts']);
  assert.equal(publishPlan.baseFrom, 'preflight.liveCommit');
  assert.ok(Array.isArray(publishPlan.phases));
  assert.deepEqual(publishPlan.phases, ['preflight', 'plan', 'prepare', 'remote-plan', 'remote-publish']);
  assert.match(String(publishPlan.resolvedRef ?? ''), /^[a-f0-9]{40}$/);
  assert.equal(combinedOutput(publish).includes('LXC_SSH_PASSWORD'), false);

  const bootstrap = runPwsh(wrapperPath, [
    '-Mode', 'bootstrap', '-DryRun', '-Proof', 'release-contracts', '-KnownHosts', knownHostsStub,
    '-AdoptCommit', 'b'.repeat(40), '-ExpectedImage', `sha256:${'c'.repeat(64)}`,
  ]);
  assert.equal(bootstrap.status, 0, combinedOutput(bootstrap));
  const bootstrapPlan = parsePlan(bootstrap.stdout);
  assertOrdinaryPlan(bootstrapPlan, 'bootstrap');
  assert.equal(bootstrapPlan.base, 'b'.repeat(40));
  assert.equal(bootstrapPlan.expectedImage.startsWith('sha256:'), true);
  assert.deepEqual(bootstrapPlan.phases, ['plan', 'prepare', 'remote-plan', 'remote-bootstrap']);

  const recovery = runPwsh(wrapperPath, ['-Mode', 'recovery-source-build', '-DryRun']);
  assert.equal(recovery.status, 0, combinedOutput(recovery));
  const recoveryPlan = parsePlan(recovery.stdout);
  assert.equal(recoveryPlan.mode, 'recovery-source-build');
  assert.equal(recoveryPlan.automaticFallback, false);
  assert.equal(recoveryPlan.envRead, false);
  assert.equal(recoveryPlan.authorized, true);
  assert.ok(recoveryPlan.phases.includes('legacy-source-archive'));
}

function testLegacyClientDryRun() {
  const uniqueOutput = path.join('.runtime', 'releases', `legacy-client-dryrun-${process.pid}-${Date.now()}`);
  const uniqueAbs = path.join(repoRoot, uniqueOutput);
  const tarPath = path.join(repoRoot, 'daojie-src.tar.gz');
  const tarBefore = fs.existsSync(tarPath);
  const missingProof = runPwsh(legacyPath, ['-Target', 'client', '-DryRun']);
  assert.notEqual(missingProof.status, 0);
  assert.match(combinedOutput(missingProof), /missing-proof/);
  assert.equal(fs.existsSync(tarPath), tarBefore);

  const routed = runPwsh(legacyPath, [
    '-Target', 'client', '-DryRun', '-Proof', 'release-contracts', '-KnownHosts', knownHostsStub,
    '-Output', uniqueOutput,
  ]);
  assert.equal(routed.status, 0, combinedOutput(routed));
  assert.equal(fs.existsSync(uniqueAbs), false);
  assert.equal(fs.existsSync(tarPath), tarBefore);
  const plan = parsePlan(routed.stdout);
  assertOrdinaryPlan(plan, 'publish');
  assert.equal(plan.entrypoint, canonicalEntrypoint);
}

function testNoSilentSourceBuild() {
  const wrapper = readScript(wrapperPath);
  const legacy = readScript(legacyPath);
  assert.doesNotMatch(wrapper, /\$Mode = 'recovery-source-build'/);
  assert.match(legacy, /if \(\$Target -eq 'client' -and -not \$AllowClientSourceBuildRecovery\)/);
  assert.doesNotMatch(legacy, /\$AllowClientSourceBuildRecovery = \$true/);
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  assert.ok(index >= 0 && index + 1 < args.length, `missing ${flag}`);
  return args[index + 1];
}

function readCallLog(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function writeNativeShims(shimDir, realNode, shimJs) {
  if (process.platform === 'win32') {
    const body = (kind) => `@echo off\r\n"${realNode}" "${shimJs}" ${kind} %*\r\nexit /b %ERRORLEVEL%\r\n`;
    fs.writeFileSync(path.join(shimDir, 'python.cmd'), body('python'));
    fs.writeFileSync(path.join(shimDir, 'python.bat'), body('python'));
    fs.writeFileSync(path.join(shimDir, 'node.cmd'), body('node'));
    fs.writeFileSync(path.join(shimDir, 'node.bat'), body('node'));
    return;
  }
  const body = (kind) => `#!/bin/sh\nexec "${realNode}" "${shimJs}" ${kind} "$@"\n`;
  for (const name of ['python', 'node']) {
    const file = path.join(shimDir, name);
    fs.writeFileSync(file, body(name));
    fs.chmodSync(file, 0o755);
  }
}

function testFakeNativeRealPath() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daojie-deploy-shim-'));
  const liveCommit = 'd'.repeat(40);
  const currentArtifact = 'cas-current-deadbeef';
  const adoptCommit = 'e'.repeat(40);
  const expectedImage = `sha256:${'f'.repeat(64)}`;
  const artifactDir = path.join(tempRoot, 'bundle');
  const logFile = path.join(tempRoot, 'calls.jsonl');
  const relativeKnownHosts = '.gitignore';
  const resolvedKnownHosts = path.join(repoRoot, relativeKnownHosts);
  const resolvedEnvFile = path.join(repoRoot, relativeKnownHosts);
  const uniqueOutput = path.join('.runtime', 'releases', `fake-native-${process.pid}-${Date.now()}`);
  const uniqueAbs = path.join(repoRoot, uniqueOutput);
  const shimJs = path.join(tempRoot, 'shim.mjs');
  fs.writeFileSync(shimJs, `import fs from 'node:fs';
const kind = process.argv[2];
const args = process.argv.slice(3);
fs.appendFileSync(process.env.DAOJIE_SHIM_LOG, JSON.stringify({ kind, args }) + '\\n');
const scenario = process.env.DAOJIE_SHIM_SCENARIO || 'ok';
const has = (name) => args.some((value) => String(value).replaceAll('\\\\', '/').endsWith(name));
if (has('preflight.py')) {
  if (scenario === 'missing-current') {
    process.stdout.write(JSON.stringify({ ready: false, mutated: false, error: 'No such file: /opt/daojie/client-site/current' }) + '\\n');
    process.exit(1);
  }
  if (scenario === 'auth-failed') {
    process.stdout.write(JSON.stringify({ ready: false, mutated: false, error: 'Authentication failed' }) + '\\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    ready: true, mutated: false,
    liveCommit: process.env.DAOJIE_SHIM_LIVE,
    currentArtifact: process.env.DAOJIE_SHIM_CURRENT,
  }) + '\\n');
  process.exit(0);
}
if (has('plan.mjs')) {
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
  process.exit(0);
}
if (has('prepare.mjs')) {
  process.stdout.write('proof chromium log line\\nbuilding client bundle\\n');
  process.stdout.write(JSON.stringify({ artifactDir: process.env.DAOJIE_SHIM_ARTIFACT, ok: true }, null, 2) + '\\n');
  process.exit(0);
}
if (has('remote_publish.py')) {
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
  process.exit(0);
}
process.stderr.write('unexpected shim invocation\\n');
process.exit(2);
`);
  writeNativeShims(tempRoot, process.execPath, shimJs);

  function runReal(args, scenario) {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    return spawnSync('pwsh', ['-NoProfile', '-File', wrapperPath, ...args], {
      cwd: tempRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${tempRoot}${path.delimiter}${process.env.PATH}`,
        DAOJIE_SHIM_LOG: logFile,
        DAOJIE_SHIM_SCENARIO: scenario,
        DAOJIE_SHIM_LIVE: liveCommit,
        DAOJIE_SHIM_CURRENT: currentArtifact,
        DAOJIE_SHIM_ARTIFACT: artifactDir,
      },
    });
  }

  const sharedArgs = [
    '-RepoRoot', repoRoot,
    '-Proof', 'release-contracts',
    '-KnownHosts', relativeKnownHosts,
    '-EnvFile', relativeKnownHosts,
    '-Output', uniqueOutput,
  ];

  try {
    const publish = runReal(sharedArgs, 'ok');
    assert.equal(publish.status, 0, combinedOutput(publish));
    assert.equal(fs.existsSync(uniqueAbs), false, 'real-path fake must not create .runtime output');
    const publishCalls = readCallLog(logFile);
    assert.equal(publishCalls.some((call) => call.args.some((value) => String(value).includes('AllowClientSourceBuildRecovery'))), false);
    assert.equal(publishCalls.some((call) => call.args.some((value) => String(value).replaceAll('\\', '/').includes('.claude/skills/daojie-deploy/scripts/deploy.ps1'))), false);
    const preflight = publishCalls.find((call) => call.args.some((value) => String(value).replaceAll('\\', '/').endsWith('preflight.py')));
    const plan = publishCalls.find((call) => call.args.some((value) => String(value).replaceAll('\\', '/').endsWith('plan.mjs')));
    const prepare = publishCalls.find((call) => call.args.some((value) => String(value).replaceAll('\\', '/').endsWith('prepare.mjs')));
    const remoteCalls = publishCalls.filter((call) => call.args.some((value) => String(value).replaceAll('\\', '/').endsWith('remote_publish.py')));
    assert.ok(preflight && plan && prepare, 'publish must call preflight/plan/prepare');
    assert.equal(remoteCalls.length, 2);
    assert.ok(samePath(argValue(preflight.args, '--checkout'), repoRoot));
    assert.ok(samePath(argValue(preflight.args, '--known-hosts'), resolvedKnownHosts));
    assert.ok(samePath(argValue(preflight.args, '--env-file'), resolvedEnvFile));
    assert.equal(argValue(plan.args, '--base'), liveCommit);
    assert.equal(argValue(plan.args, '--ref'), 'HEAD');
    assert.equal(argValue(plan.args, '--proof'), 'release-contracts');
    assert.equal(argValue(prepare.args, '--base'), liveCommit);
    assert.equal(argValue(prepare.args, '--ref'), 'HEAD');
    assert.equal(argValue(prepare.args, '--proof'), 'release-contracts');
    assert.ok(samePath(argValue(prepare.args, '--output'), uniqueAbs));
    const remotePlan = remoteCalls.find((call) => argValue(call.args, '--mode') === 'plan');
    const remotePublish = remoteCalls.find((call) => argValue(call.args, '--mode') === 'publish');
    assert.ok(remotePlan && remotePublish);
    assert.ok(samePath(argValue(remotePublish.args, '--bundle'), artifactDir));
    assert.equal(argValue(remotePublish.args, '--expected-current'), currentArtifact);
    assert.ok(remotePublish.args.includes('--execute'));
    assert.equal(remotePublish.args.includes('--adopt-commit'), false);
    assert.ok(samePath(argValue(remotePublish.args, '--known-hosts'), resolvedKnownHosts));
    assert.ok(samePath(argValue(remotePublish.args, '--env-file'), resolvedEnvFile));
    assert.equal(combinedOutput(publish).includes('LXC_SSH_PASSWORD'), false);

    const bootstrap = runReal([
      '-Mode', 'bootstrap',
      ...sharedArgs,
      '-AdoptCommit', adoptCommit,
      '-ExpectedImage', expectedImage,
    ], 'ok');
    assert.equal(bootstrap.status, 0, combinedOutput(bootstrap));
    const bootstrapCalls = readCallLog(logFile);
    assert.equal(bootstrapCalls.some((call) => call.args.some((value) => String(value).replaceAll('\\', '/').endsWith('preflight.py'))), false);
    assert.equal(bootstrapCalls.some((call) => call.args.some((value) => String(value).includes('AllowClientSourceBuildRecovery'))), false);
    const bootPlan = bootstrapCalls.find((call) => call.args.some((value) => String(value).replaceAll('\\', '/').endsWith('plan.mjs')));
    const bootPrepare = bootstrapCalls.find((call) => call.args.some((value) => String(value).replaceAll('\\', '/').endsWith('prepare.mjs')));
    const bootRemote = bootstrapCalls.filter((call) => call.args.some((value) => String(value).replaceAll('\\', '/').endsWith('remote_publish.py')));
    assert.equal(argValue(bootPlan.args, '--base'), adoptCommit);
    assert.equal(argValue(bootPrepare.args, '--base'), adoptCommit);
    const bootExecute = bootRemote.find((call) => argValue(call.args, '--mode') === 'bootstrap');
    assert.ok(bootExecute);
    assert.equal(argValue(bootExecute.args, '--adopt-commit'), adoptCommit);
    assert.equal(argValue(bootExecute.args, '--expected-image'), expectedImage);
    assert.ok(bootExecute.args.includes('--execute'));
    assert.equal(bootExecute.args.includes('--expected-current'), false);

    const missing = runReal(sharedArgs, 'missing-current');
    assert.notEqual(missing.status, 0);
    assert.match(combinedOutput(missing), /bootstrap-required/);
    assert.match(combinedOutput(missing), /no automatic fallback to recovery-source-build/);

    const auth = runReal(sharedArgs, 'auth-failed');
    assert.notEqual(auth.status, 0);
    assert.match(combinedOutput(auth), /preflight-failed/);
    assert.doesNotMatch(combinedOutput(auth), /bootstrap-required/);
    assert.equal(fs.existsSync(uniqueAbs), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

testClassifierExceptions();
assert.equal(fs.existsSync(wrapperPath), true, 'canonical wrapper missing');
const wrapper = readScript(wrapperPath);
const legacy = readScript(legacyPath);
testWrapperSource(wrapper);
testLegacyRouterSource(legacy);
testNoSilentSourceBuild();
testHotDryRuns();
testLegacyClientDryRun();
testFakeNativeRealPath();
process.stdout.write('client deploy entrypoint contracts passed\n');
