// Contract test for the daojie-deploy client-only target.
//
// Bug it guards: deploy.ps1 built only the selected image(s) but always ran
// /opt/daojie/lxc-deploy.sh, which recreates all four containers. A `-Target client` deploy
// therefore restarted daojie-server on its stale image and wiped persisted buildings.
//
// Contract: `-Target client` recreates ONLY daojie-client and never invokes lxc-deploy.sh;
// `server`/`both` keep the explicit full-deploy path; `-DryRun` performs no remote work and
// prints a target-specific plan.
//
// Run: node --test .claude/skills/daojie-deploy/scripts/deploy.contract.test.mjs
// Set DEPLOY_PS1 to assert against a different copy of the script (used for the red baseline).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = process.env.DEPLOY_PS1 || join(here, 'deploy.ps1');

const raw = readFileSync(scriptPath, 'utf8');
// normalize EOL so assertions are independent of the CRLF/LF mix
const lines = raw.replace(/\r\n/g, '\n').split('\n');

const idx = (re) => lines.findIndex((l) => re.test(l));

const CLIENT_RUN =
  'docker run -d --name daojie-client --restart unless-stopped --network daojie_net -p 11921:80 daojie-client:lxc';

// the plan section and the recreate section both open with `if ($ClientOnlyTarget) {`;
// anchor the branch under test to the step-3 recreate marker.
const step3 = idx(/^# -- step 3: recreate containers/);
const clientStart = lines.findIndex((l, i) => i > step3 && l === 'if ($ClientOnlyTarget) {');
const splitIdx = lines.findIndex((l, i) => i > clientStart && l === '} else {');
const step3b = idx(/^# -- step 3b:/);

const clientBranch = clientStart === -1 ? '' : lines.slice(clientStart, splitIdx).join('\n');
const elseBranch = splitIdx === -1 ? '' : lines.slice(splitIdx, step3b).join('\n');

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

test('server/both path keeps the explicit lxc-deploy.sh full build', () => {
  assert.match(elseBranch, /bash \/opt\/daojie\/lxc-deploy\.sh/);
  assert.match(elseBranch, /DEPLOY_DONE/);
});

test('protected containers are declared and client id change is asserted', () => {
  assert.match(raw, /\$ProtectedContainers = @\('daojie-server', 'daojie-postgres', 'daojie-redis'\)/);
  assert.match(clientBranch, /\$clientAfter -eq \$clientBefore/);
});

test('-DryRun exits before any remote operation', () => {
  const dryRun = idx(/^if \(\$DryRun\) \{/) + 1;
  const firstRemote = idx(/^\s*Invoke-WinSCP -ScriptPath/) + 1;
  assert.ok(dryRun > 0, '-DryRun exit not found');
  assert.ok(firstRemote > 0, 'no Invoke-WinSCP call site found');
  assert.ok(
    dryRun < firstRemote,
    `-DryRun at line ${dryRun} does not precede first remote call at line ${firstRemote}`,
  );
});

test('plan output names which containers will be recreated', () => {
  const planStart = idx(/\[plan\] target=/);
  const dryRun = idx(/^if \(\$DryRun\) \{/);
  const plan = lines.slice(planStart, dryRun).join('\n');
  assert.match(plan, /recreate scope: daojie-client only/);
  assert.match(plan, /daojie-server, daojie-postgres, daojie-redis untouched/);
  assert.ok(plan.includes(CLIENT_RUN), 'plan does not show the client run command');
  assert.match(
    plan,
    /bash \/opt\/daojie\/lxc-deploy\.sh \(recreates daojie-server, daojie-client, daojie-postgres, daojie-redis\)/,
  );
});

test('deploy script parses without PowerShell syntax errors', () => {
  const ps = `$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile(${JSON.stringify(
    scriptPath,
  )},[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{$_.Message};exit 1}`;
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  assert.equal(r.status, 0, `pwsh parse failed: ${r.error?.message ?? ''}\n${r.stdout}\n${r.stderr}`);
});
