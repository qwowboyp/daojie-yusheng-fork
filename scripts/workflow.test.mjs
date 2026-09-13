import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, planChecks, scopedFiles, runStep } from './workflow.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-contract-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('workflow-contract-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const rel of ['packages/client/src/ui/button.ts', 'packages/client/src/styles/tokens.css', 'packages/shared/src/protocol.ts']) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export const value = 1;\n');
  }
  return dir;
}

test('local UI plan uses only specified files and deduplicates proof names', (t) => {
  const dir = fixture(t);
  const options = parseArgs(['plan', '--tier', 'ui-small', '--proof', 'game-workspace', 'proof:game-workspace', '--files', 'packages/client/src/ui/button.ts']);
  const plan = planChecks(options, { 'proof:game-workspace': 'node proof.mjs' }, dir);
  assert.deepEqual(plan.steps.map((s) => s.label), ['traditional:changed', 'client:typecheck', 'proof:game-workspace']);
  assert.equal(plan.releaseAccepted, false);
  assert.deepEqual(plan.steps[0].args, ['scripts/check-traditional.mjs', 'packages/client/src/ui/button.ts']);
});

test('shared and global CSS cannot use the small UI gate', (t) => {
  const dir = fixture(t);
  for (const file of ['packages/shared/src/protocol.ts', 'packages/client/src/styles/tokens.css']) {
    assert.throws(() => planChecks({ tier: 'ui-small', files: [file], proofs: ['game-workspace'] }, { 'proof:game-workspace': 'node proof.mjs' }, dir), /全域或非局部/);
  }
});

test('invalid or injected arguments fail before execution', (t) => {
  const dir = fixture(t);
  assert.throws(() => parseArgs(['check', '--surface']), /需要值/);
  assert.throws(() => scopedFiles(['../outside.ts'], dir), /專案內/);
  assert.throws(() => planChecks({ tier: 'ui-small', files: ['packages/client/src/ui/button.ts'], proofs: ['x & echo bad'] }, {}, dir), /沒有這個 proof/);
  assert.throws(() => planChecks({ tier: '', files: [], proofs: [] }, {}, dir), /明確指定/);
});

test('fixture-only surfaces cannot silently claim a complete panel check', (t) => {
  const dir = fixture(t);
  assert.throws(() => planChecks({ tier: 'ui-small', files: ['packages/client/src/ui/button.ts'], surface: 'hud', proofs: [] }, { 'proof:hud-layout': 'node fixture.mjs' }, dir), /未實例化完整 HUD/);
});

test('runner preserves failure exit status and full log', async (t) => {
  const dir = fixture(t);
  const log = path.join(dir, 'failure.log');
  const result = await runStep({ label: 'fixture', command: 'node', args: ['-e', 'console.error("expected diagnostic"); process.exit(7)'] }, log, { cwd: dir });
  assert.equal(result.code, 7);
  assert.match(fs.readFileSync(log, 'utf8'), /expected diagnostic/);
});

test('runner bounds a hanging command and records timeout', async (t) => {
  const dir = fixture(t);
  const result = await runStep({ label: 'fixture', command: 'node', args: ['-e', 'setInterval(() => {}, 1000)'] }, path.join(dir, 'timeout.log'), { cwd: dir, timeoutMs: 300 });
  assert.equal(result.code, 124);
  assert.equal(result.timedOut, true);
  assert.ok(result.seconds < 10);
});
