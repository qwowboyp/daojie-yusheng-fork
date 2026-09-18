// Contract test for the daojie-deploy legacy router.
//
// The legacy `server` / `both` / default paths previously ran a full git
// archive -> Docker build -> /opt/daojie/lxc-deploy.sh pipeline. Production
// incidents proved that path unsafe: it recreated daojie-client without the
// hot-static bind mount (`src=/opt/daojie/client-site,dst=/srv/daojie-client,
// readonly`) and dropped `/` to 404 until the mount was restored.
//
// New contract:
//   - `-Target client` still routes to scripts/client-release/deploy.ps1
//     (canonical hot-static wrapper) before any credential or archive work.
//   - `-Target server`, `-Target both`, and the default target (`both`) fail
//     closed IMMEDIATELY with stable ASCII error token
//     `unsafe-legacy-deploy-disabled` BEFORE any env load, source archive,
//     WinSCP, Docker build, lxc-deploy.sh, or remote side effect.
//   - Recovery flags (`-Mode`, `-AllowClientSourceBuildRecovery`) cannot
//     re-enable the legacy server/both path; the canonical client wrapper
//     remains the only supported way to release the client.
//
// The legacy env/archive/lxc-deploy.sh blocks remain in the source only as
// historical reference / never-reached plan output.
//
// Run: node --test .claude/skills/daojie-deploy/scripts/deploy.contract.test.mjs
// Set DEPLOY_PS1 to assert against a different copy of the script (used for the red baseline).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = process.env.DEPLOY_PS1 || join(here, 'deploy.ps1');
const repoRoot = resolve(here, '..', '..', '..', '..');
const tarPath = join(repoRoot, 'daojie-src.tar.gz');

const raw = readFileSync(scriptPath, 'utf8');
// normalize EOL so assertions are independent of the CRLF/LF mix
const lines = raw.replace(/\r\n/g, '\n').split('\n');

const idx = (re) => lines.findIndex((l) => re.test(l));

const CLIENT_RUN =
  'docker run -d --name daojie-client --restart unless-stopped --network daojie_net -p 11921:80 daojie-client:lxc';

const GUARD_TOKEN = 'unsafe-legacy-deploy-disabled';

// Source landmarks (line indices are 0-based; .trimEnd() so indented matches work).
const findTrimmed = (re) => lines.findIndex((l) => re.test(l.trimEnd()));
const clientRouterIdx = findTrimmed(/^if \(\$Target -eq 'client' -and -not \$AllowClientSourceBuildRecovery\) \{$/);
const guardIdx = findTrimmed(/^if \(\$Target -ne 'client'\) \{$/);
const guardTokenIdx = idx(/unsafe-legacy-deploy-disabled/);
const pveEnvIdx = idx(/Read-PveEnv -Path/);
const archiveIdx = idx(/^git -C \$RepoRoot archive/);
const winScpIdx = idx(/Invoke-WinSCP -ScriptPath/);
// Look for the first executable reference, not the comment mentions.
const lxcExecIdx = idx(/bash \/opt\/daojie\/lxc-deploy\.sh/);

// Step-3 branch landmarks (client-only recreate vs lxc-deploy.sh)
const step3 = idx(/^# -- step 3: recreate containers/);
const clientStart = lines.findIndex((l, i) => i > step3 && l === 'if ($ClientOnlyTarget) {');
const splitIdx = lines.findIndex((l, i) => i > clientStart && l === '} else {');
const step3b = idx(/^# -- step 3b:/);
const clientBranch = clientStart === -1 ? '' : lines.slice(clientStart, splitIdx).join('\n');
const elseBranch = splitIdx === -1 ? '' : lines.slice(splitIdx, step3b).join('\n');

// -- File-source guard assertions (red/green before behavior tests) ---------

test('client router and fail-closed guard are both present in source', () => {
  assert.ok(clientRouterIdx > -1, 'client router block not found');
  assert.ok(guardIdx > -1, `guard if-line not found`);
  assert.ok(guardTokenIdx > -1, `guard token '${GUARD_TOKEN}' not found`);
});

test('guard sits after client router but before every legacy execution step', () => {
  assert.ok(guardIdx > clientRouterIdx, 'guard must follow client router');
  assert.ok(pveEnvIdx > guardIdx, 'guard must precede Read-PveEnv');
  assert.ok(archiveIdx > guardIdx, 'guard must precede git archive');
  assert.ok(winScpIdx > guardIdx, 'guard must precede first WinSCP call');
  assert.ok(lxcExecIdx > guardIdx, 'guard must precede first lxc-deploy.sh execution');
});

test('guard rejects every non-client target; recovery flags cannot bypass', () => {
  // Guard body must check only the target and emit a nonzero exit; it must
  // NOT consult Mode or AllowClientSourceBuildRecovery in the bypass sense.
  const guardSlice = lines.slice(guardIdx, guardIdx + 4).join('\n');
  assert.match(guardSlice, new RegExp(GUARD_TOKEN));
  assert.match(guardSlice, /\$Target -ne 'client'/);
  assert.match(guardSlice, /exit \d+/);
  assert.doesNotMatch(guardSlice, /Mode/);
  assert.doesNotMatch(guardSlice, /AllowClientSourceBuildRecovery/);
});

test('guard message names both the canonical client release and coordinated server release', () => {
  assert.match(raw, /scripts\/coordinated-server-release\.py/);
  assert.match(raw, /scripts\/client-release\/deploy\.ps1/);
});

test('client target still routes to canonical wrapper before guard', () => {
  const clientRouterEnd = lines.findIndex(
    (l, i) => i > clientRouterIdx && /^\s*exit \$LASTEXITCODE\s*$/.test(l),
  );
  assert.ok(clientRouterEnd > clientRouterIdx, 'client router exit not found');
  assert.ok(
    clientRouterEnd < guardIdx,
    `client router exit at line ${clientRouterEnd + 1} must precede guard at line ${guardIdx + 1}`,
  );
  assert.match(raw, /scripts\\client-release\\deploy\.ps1/);
});

// -- Client branch: structural contract (unchanged from prior contract) -----

test('client target exists as a distinct branch', () => {
  assert.ok(clientStart > -1, 'if ($ClientOnlyTarget) branch not found');
  assert.ok(splitIdx > clientStart, 'client branch is not split by `} else {`');
  assert.ok(step3b > splitIdx, 'could not locate step 3b boundary');
});

test('client branch recreates only daojie-client', () => {
  assert.match(clientBranch, /docker rm -f daojie-client/);
  assert.ok(clientBranch.includes(CLIENT_RUN), 'missing exact daojie-client run command');
  assert.match(clientBranch, /Wait-WebReady/);
  assert.match(clientBranch, /foreach \(\$name in \$ProtectedContainers\)/);
  assert.match(clientBranch, /protected container changed during client-only deploy/);
  // Historical context preserved: lxc-deploy.sh still appears in source
  // (as unreachable plan output), but MUST NOT appear in the client branch.
  assert.doesNotMatch(clientBranch, /bash \/opt\/daojie\/lxc-deploy\.sh/);
  assert.doesNotMatch(clientBranch, /DEPLOY_DONE/);
});

test('client branch never mutates server/postgres/redis', () => {
  const mutating = clientBranch.match(/docker (?:rm|run|restart|stop|start|kill|rmi)[^\n]*/g) || [];
  for (const cmd of mutating) {
    assert.doesNotMatch(
      cmd,
      /daojie-(?:server|postgres|redis)/,
      `client branch mutates a protected container: ${cmd}`,
    );
  }
});

test('protected containers are declared and client id change is asserted', () => {
  assert.match(raw, /\$ProtectedContainers = @\('daojie-server', 'daojie-postgres', 'daojie-redis'\)/);
  assert.match(clientBranch, /\$clientAfter -eq \$clientBefore/);
});

test('legacy lxc-deploy.sh references are preserved in source for historical context', () => {
  // Legacy source still mentions lxc-deploy.sh, Read-PveEnv, git archive,
  // Invoke-WinSCP, and the else-branch full-deploy block — preserved only as
  // unreachable historical reference. The guard short-circuits before any of
  // this can execute for server/both/default.
  assert.match(raw, /bash \/opt\/daojie\/lxc-deploy\.sh/);
  assert.match(raw, /DEPLOY_DONE/);
  assert.match(raw, /git -C \$RepoRoot archive/);
  assert.match(raw, /Invoke-WinSCP/);
  assert.match(elseBranch, /bash \/opt\/daojie\/lxc-deploy\.sh/);
  assert.match(elseBranch, /DEPLOY_DONE/);
  assert.ok(guardIdx < pveEnvIdx, 'guard must precede the legacy env load');
  assert.ok(guardIdx < archiveIdx, 'guard must precede the legacy archive step');
});

// -- Behavior tests: spawn the script and assert the guard fires -----------

function runLegacy(extraArgs) {
  return spawnSync('pwsh', ['-NoProfile', '-File', scriptPath, ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
});

}

function combinedOutput(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function assertFailClosed(result, label) {
  assert.notEqual(result.status, 0, `${label}: expected nonzero exit, got 0`);
  const blob = combinedOutput(result);
  assert.match(blob, new RegExp(GUARD_TOKEN), `${label}: guard token missing in output`);
  // Legacy path markers must NOT appear.
  assert.doesNotMatch(blob, /tarball:/, `${label}: must not reach tarball creation`);
  assert.doesNotMatch(blob, /remote build chain/, `${label}: must not reach docker build`);
  assert.doesNotMatch(blob, /sftp:\/\//, `${label}: must not reach SFTP/WinSCP`);
  assert.doesNotMatch(blob, /DEPLOY_DONE/, `${label}: must not reach lxc-deploy.sh`);
  // Credentials must NOT be read or echoed.
  assert.doesNotMatch(blob, /LXC_SSH_PASSWORD/, `${label}: must not echo credentials`);
}

function tarMtime() {
  return existsSync(tarPath) ? statSync(tarPath).mtimeMs : null;
}

test('behavior: -Target server fails closed and does not create tarball', () => {
  const before = tarMtime();
  const r = runLegacy(['-Target', 'server']);
  assertFailClosed(r, '-Target server');
  const after = tarMtime();
  assert.equal(after, before, 'daojie-src.tar.gz mtime changed; guard must prevent archive creation');
});

test('behavior: -Target server -DryRun fails closed', () => {
  const before = tarMtime();
  const r = runLegacy(['-Target', 'server', '-DryRun']);
  assertFailClosed(r, '-Target server -DryRun');
  const after = tarMtime();
  assert.equal(after, before, 'DryRun must not create daojie-src.tar.gz');
});

test('behavior: -Target both fails closed', () => {
  const before = tarMtime();
  const r = runLegacy(['-Target', 'both']);
  assertFailClosed(r, '-Target both');
  const after = tarMtime();
  assert.equal(after, before, 'daojie-src.tar.gz mtime changed; guard must prevent archive creation');
});

test('behavior: -Target both -DryRun fails closed', () => {
  const before = tarMtime();
  const r = runLegacy(['-Target', 'both', '-DryRun']);
  assertFailClosed(r, '-Target both -DryRun');
  const after = tarMtime();
  assert.equal(after, before, 'DryRun must not create daojie-src.tar.gz');
});

test('behavior: default target fails closed', () => {
  const before = tarMtime();
  const r = runLegacy([]);
  assertFailClosed(r, 'default target');
  const after = tarMtime();
  assert.equal(after, before, 'daojie-src.tar.gz mtime changed; guard must prevent archive creation');
});

test('behavior: default target with -DryRun fails closed', () => {
  const before = tarMtime();
  const r = runLegacy(['-DryRun']);
  assertFailClosed(r, 'default target -DryRun');
  const after = tarMtime();
  assert.equal(after, before, 'DryRun must not create daojie-src.tar.gz');
});

test('behavior: recovery flags cannot bypass server/both guard', () => {
  // Even when explicitly authorized, the guard must reject server/both.
  const r1 = runLegacy(['-Target', 'server', '-AllowClientSourceBuildRecovery']);
  assertFailClosed(r1, 'server + AllowClientSourceBuildRecovery');
  const r2 = runLegacy(['-Target', 'both', '-Mode', 'recovery-source-build']);
  assertFailClosed(r2, 'both + Mode recovery-source-build');
});

// -- PowerShell parser sanity (unchanged) -----------------------------------

test('deploy script parses without PowerShell syntax errors', () => {
  const ps = `$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile(${JSON.stringify(
    scriptPath,
  )},[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{$_.Message};exit 1}`;
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  assert.equal(r.status, 0, `pwsh parse failed: ${r.error?.message ?? ''}\n${r.stdout}\n${r.stderr}`);
});
