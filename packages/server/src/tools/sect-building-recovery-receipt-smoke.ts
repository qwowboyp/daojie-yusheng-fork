/**
 * Current-state receipt 與 manifest 語意 hash 契約。不連正式服、不寫庫。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BACKUP_IDENTITY,
  BACKUP_SHA256,
  TARGET_INSTANCE_ID,
} from './sect-building-recovery-constants';
import {
  CURRENT_STATE_RECEIPT_SCHEMA_DOC,
  bindCurrentState,
} from './sect-building-recovery-current-state';
import { sha256Bytes, sha256Canonical } from './sect-building-recovery-hash';
import { runSectBuildingRecoveryCli } from './sect-building-recovery-manifest';
import {
  buildSectBuildingRecoveryPlan,
  recoveryManifestSemantics,
} from './sect-building-recovery-plan';
import {
  EMPTY_CURRENT,
  currentStateCliArgs,
  eightBuildingSql,
  extractionPath,
  writeCurrentStateFile,
} from './sect-building-recovery-smoke-sql';

function captureCli(args: readonly string[]): { exitCode: number; stderr: string; stdout: string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = runSectBuildingRecoveryCli(args, {
    stdout: { write(chunk: string) { stdout.push(chunk); } },
    stderr: { write(chunk: string) { stderr.push(chunk); } },
  });
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') };
}

function withTempDir(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sect-building-recovery-receipt-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function proveSchemaDoc(): void {
  assert.match(CURRENT_STATE_RECEIPT_SCHEMA_DOC, /schemaVersion/);
  assert.match(CURRENT_STATE_RECEIPT_SCHEMA_DOC, /gm-readonly-sql/);
  assert.match(CURRENT_STATE_RECEIPT_SCHEMA_DOC, new RegExp(TARGET_INSTANCE_ID));
}

function proveCliMissingReceipt(): void {
  const captured = captureCli(['--sql', extractionPath()]);
  assert.equal(captured.exitCode, 2);
  assert.match(captured.stderr, /current_state_missing/);
}

function provePlanRequiresCurrent(): void {
  const result = buildSectBuildingRecoveryPlan({
    sqlText: eightBuildingSql(),
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'current_state_missing');
  }
}

function proveCliMalformedReceipt(): void {
  withTempDir((dir) => {
    const receiptPath = path.join(dir, 'current-state.json');
    fs.writeFileSync(receiptPath, '{not-json', 'utf8');
    const claimed = sha256Bytes(fs.readFileSync(receiptPath));
    const captured = captureCli([
      '--sql', extractionPath(),
      '--current-state', receiptPath,
      '--current-state-sha256', claimed,
    ]);
    assert.equal(captured.exitCode, 2);
    assert.match(captured.stderr, /current_state_malformed/);
  });
}

function proveCliWrongInstance(): void {
  withTempDir((dir) => {
    const current = bindCurrentState({ instanceId: 'sect:other:main' });
    const receiptPath = path.join(dir, 'current-state.json');
    const captured = captureCli([
      '--sql', extractionPath(),
      ...currentStateCliArgs(receiptPath, current),
    ]);
    assert.equal(captured.exitCode, 2);
    assert.match(captured.stderr, /current_state_instance_mismatch/);
  });
}

function proveCliStaleReceipt(): void {
  withTempDir((dir) => {
    const current = bindCurrentState({ queriedAt: '2026-09-17T12:00:00.000Z' });
    const receiptPath = path.join(dir, 'current-state.json');
    const captured = captureCli([
      '--sql', extractionPath(),
      ...currentStateCliArgs(receiptPath, current),
    ]);
    assert.equal(captured.exitCode, 2);
    assert.match(captured.stderr, /current_state_stale/);
  });
}

function proveCliClaimedChecksumMismatch(): void {
  withTempDir((dir) => {
    const receiptPath = path.join(dir, 'current-state.json');
    writeCurrentStateFile(receiptPath);
    const captured = captureCli([
      '--sql', extractionPath(),
      '--current-state', receiptPath,
      '--current-state-sha256', '0'.repeat(64),
    ]);
    assert.equal(captured.exitCode, 2);
    assert.match(captured.stderr, /current_state_checksum_mismatch/);
  });
}

function proveCliChangedReceiptByte(): void {
  withTempDir((dir) => {
    const receiptPath = path.join(dir, 'current-state.json');
    writeCurrentStateFile(receiptPath);
    fs.appendFileSync(receiptPath, ' ');
    const captured = captureCli([
      '--sql', extractionPath(),
      '--current-state', receiptPath,
      '--current-state-sha256', EMPTY_CURRENT.fileSha256,
    ]);
    assert.equal(captured.exitCode, 2);
    assert.match(captured.stderr, /current_state_checksum_mismatch/);
  });
}

function proveNonEmptyCurrentCollectionsFailClosed(): void {
  const occupiedState = buildSectBuildingRecoveryPlan({
    sqlText: eightBuildingSql(),
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current: bindCurrentState({
      stateBuildingIds: ['build:1789433747949:rxekjwt5zi'],
    }),
  });
  assert.equal(occupiedState.ok, false);
  if (!occupiedState.ok) {
    assert.equal(occupiedState.error.code, 'current_state_buildings_present');
  }

  const residualSameBuildingCell = buildSectBuildingRecoveryPlan({
    sqlText: eightBuildingSql(),
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current: bindCurrentState({
      cells: [{
        instanceId: TARGET_INSTANCE_ID,
        buildingId: 'build:1789433747949:rxekjwt5zi',
        tileIndex: 151,
        x: 2,
        y: 6,
      }],
    }),
  });
  assert.equal(residualSameBuildingCell.ok, false);
  if (!residualSameBuildingCell.ok) {
    assert.equal(residualSameBuildingCell.error.code, 'current_state_cells_present');
  }

  const occupiedStorage = buildSectBuildingRecoveryPlan({
    sqlText: eightBuildingSql(),
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current: bindCurrentState({
      storageItemIds: ['storage:test:1'],
    }),
  });
  assert.equal(occupiedStorage.ok, false);
  if (!occupiedStorage.ok) {
    assert.equal(occupiedStorage.error.code, 'current_state_storage_present');
  }
}

function proveSemanticManifestMutationChangesHash(): void {
  const result = buildSectBuildingRecoveryPlan({
    sqlText: eightBuildingSql(),
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current: EMPTY_CURRENT,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const semantics = recoveryManifestSemantics(result.plan);
  assert.equal(result.plan.manifestSha256, sha256Canonical(semantics));
  assert.notEqual(sha256Canonical(semantics), sha256Canonical({
    ...semantics,
    coverageGapToken: 'tampered',
  }));
  assert.notEqual(sha256Canonical(semantics), sha256Canonical({
    ...semantics,
    buildingIds: [...semantics.buildingIds, 'build:extra'],
  }));
  const later = bindCurrentState({ queriedAt: '2026-09-17T13:00:00.000Z' });
  const laterPlan = buildSectBuildingRecoveryPlan({
    sqlText: eightBuildingSql(),
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current: later,
  });
  assert.equal(laterPlan.ok, true);
  if (!laterPlan.ok) {
    return;
  }
  assert.notEqual(laterPlan.plan.manifestSha256, result.plan.manifestSha256);
}

function main(): void {
  proveSchemaDoc();
  proveCliMissingReceipt();
  provePlanRequiresCurrent();
  proveCliMalformedReceipt();
  proveCliWrongInstance();
  proveCliStaleReceipt();
  proveCliClaimedChecksumMismatch();
  proveCliChangedReceiptByte();
  proveNonEmptyCurrentCollectionsFailClosed();
  proveSemanticManifestMutationChangesHash();
  console.log(JSON.stringify({
    ok: true,
    case: 'sect-building-recovery-receipt',
    note: 'receipt required; backup cannot capture 11:00-11:48 UTC',
  }));
}

main();
