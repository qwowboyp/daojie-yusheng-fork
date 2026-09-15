import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cleanupCandidate,
  normalizeProof,
  runCommand,
  sanitizeLogLabel,
  validateCandidateProofPath,
} from './scoped-source-verification.mjs';

test('proof command label containing repository slashes writes one flat log file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daojie-scoped-command-'));
  try {
    const candidate = path.join(root, 'candidate');
    const output = path.join(root, 'output');
    fs.mkdirSync(path.join(candidate, 'scripts'), { recursive: true });
    fs.mkdirSync(output);
    const proof = 'scripts/prove-spirit-beast-redesign.mjs';
    fs.writeFileSync(path.join(candidate, ...proof.split('/')), "process.stdout.write('proof ok\\n');\n");
    const label = `proof:script:${proof}`;
    const record = runCommand(candidate, output, { label, executable: 'node', argv: [proof] });
    assert.equal(record.exitCode, 0);
    const logs = fs.readdirSync(output);
    assert.equal(logs.length, 1);
    assert.equal(logs[0], `${sanitizeLogLabel(label)}.log`);
    assert.equal(logs[0].includes('/'), false);
    assert.equal(logs[0].includes('\\'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('proof lexical path rejects dot segments and candidate realpath rejects an escaping junction', (context) => {
  assert.throws(() => normalizeProof('scripts/../scripts/prove-valid.mjs'), /允許範圍/u);
  assert.throws(() => normalizeProof('scripts/./prove-valid.mjs'), /允許範圍/u);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daojie-scoped-realpath-'));
  try {
    const candidate = path.join(root, 'candidate');
    const external = path.join(root, 'external');
    fs.mkdirSync(path.join(candidate, 'scripts'), { recursive: true });
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, 'prove-escape.mjs'), 'export {};\n');
    try {
      fs.symlinkSync(external, path.join(candidate, 'scripts', 'linked'), 'junction');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        context.skip(`junction unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.throws(
      () => validateCandidateProofPath(candidate, 'scripts/linked/prove-escape.mjs'),
      /跳出候選 archive/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('candidate cleanup failure is returned as a warning instead of throwing', () => {
  const original = fs.rmSync;
  fs.rmSync = () => {
    const error = new Error('locked');
    error.code = 'EBUSY';
    throw error;
  };
  try {
    assert.deepEqual(cleanupCandidate('unused'), {
      ok: false,
      warning: 'candidate cleanup failed (EBUSY); manual cleanup required',
    });
  } finally {
    fs.rmSync = original;
  }
});
