/**
 * 用途：宗門八棟建築本地 recovery dry-run / manifest 契約驗證。不連正式服、不寫庫。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BACKUP_IDENTITY,
  BACKUP_SHA256,
  COVERAGE_GAP_TOKEN,
  SOURCE_SQL_SHA256,
  TARGET_BUILDING_IDS,
  TARGET_INSTANCE_ID,
} from './sect-building-recovery-constants';
import { runSectBuildingRecoveryCli } from './sect-building-recovery-manifest';
import { bindCurrentState, type BoundCurrentState } from './sect-building-recovery-current-state';
import {
  buildSectBuildingRecoveryPlan,
  type RecoveryErrorCode,
} from './sect-building-recovery-plan';
import {
  buildSectBuildingRecoveryManifest,
  renderSectBuildingRecoveryReport,
} from './sect-building-recovery-report';
import {
  DEF_IDS,
  EMPTY_CURRENT,
  cellLine,
  copySql,
  eightBuildingSql,
  extractionPath,
  stateLine,
  storageLine,
  currentStateCliArgs,
} from './sect-building-recovery-smoke-sql';

function assertRejected(sqlText: string, current: BoundCurrentState, code: RecoveryErrorCode): void {
  const result = buildSectBuildingRecoveryPlan({
    sqlText,
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current,
  });
  assert.equal(result.ok, false, `expected ${code}`);
  if (!result.ok) {
    assert.equal(result.error.code, code);
  }
}

function proveHappyPathSelectsExactEight(): void {
  const sqlText = eightBuildingSql();
  const first = buildSectBuildingRecoveryPlan({
    sqlText,
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current: EMPTY_CURRENT,
  });
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  assert.equal(first.plan.mode, 'dry-run');
  assert.equal(first.plan.dumpIdentity, BACKUP_IDENTITY);
  assert.equal(first.plan.dumpSha256, BACKUP_SHA256);
  assert.equal(first.plan.coverageGapToken, COVERAGE_GAP_TOKEN);
  assert.equal(first.plan.instanceId, TARGET_INSTANCE_ID);
  assert.deepEqual(first.plan.buildings.map((row) => row.buildingId), TARGET_BUILDING_IDS);
  assert.equal(first.plan.buildings.length, 8);
  assert.equal(first.plan.cells.length, 8);
  assert.equal(first.plan.storageItems.length, 0);
  for (const building of first.plan.buildings) {
    assert.equal(building.instanceId, TARGET_INSTANCE_ID);
    assert.equal(typeof building.payload, 'object');
    assert.equal(building.payload.instanceId, TARGET_INSTANCE_ID);
    assert.match(building.rowSha256, /^[0-9a-f]{64}$/);
  }
  assert.match(first.plan.manifestSha256, /^[0-9a-f]{64}$/);
  const second = buildSectBuildingRecoveryPlan({
    sqlText,
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current: EMPTY_CURRENT,
  });
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.plan.manifestSha256, first.plan.manifestSha256);
  }
}

function proveRejectsMissingExtraDuplicateAndMismatches(): void {
  const missing = eightBuildingSql().replace(
    'build:1789433848348:yga6o9mjo4a\tsect_spirit_field',
    'build:missing:id\tsect_spirit_field',
  );
  assertRejected(missing, EMPTY_CURRENT, 'missing_state_rows');
  const dupSql = copySql(
    TARGET_BUILDING_IDS.map((id, index) => cellLine(id, 100 + index, index, 0)),
    [
      ...TARGET_BUILDING_IDS.map((id, index) => stateLine(id, DEF_IDS[index] ?? '', index, 0)),
      stateLine(TARGET_BUILDING_IDS[0], 'spirit_incubator_metal', 2, 6),
    ],
  );
  assertRejected(dupSql, EMPTY_CURRENT, 'duplicate_state_rows');
  assertRejected(eightBuildingSql(), bindCurrentState({
    stateBuildingIds: [TARGET_BUILDING_IDS[0]],
  }), 'current_state_buildings_present');
  assertRejected(eightBuildingSql(), bindCurrentState({
    stateBuildingIds: [...TARGET_BUILDING_IDS],
  }), 'current_state_buildings_present');
  assertRejected(
    eightBuildingSql().replace('spirit_incubator_metal', 'stone_wall'),
    EMPTY_CURRENT,
    'def_mismatch',
  );
  assertRejected(
    eightBuildingSql().replaceAll(TARGET_INSTANCE_ID, 'sect:other:main'),
    EMPTY_CURRENT,
    'parent_instance_mismatch',
  );
  assertRejected(eightBuildingSql(), bindCurrentState({
    cells: [{ instanceId: TARGET_INSTANCE_ID, buildingId: 'build:other', tileIndex: 151, x: 2, y: 6 }],
  }), 'current_state_cells_present');
  const checksum = buildSectBuildingRecoveryPlan({
    sqlText: eightBuildingSql(),
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: '0'.repeat(64),
    current: EMPTY_CURRENT,
  });
  assert.equal(checksum.ok, false);
  if (!checksum.ok) {
    assert.equal(checksum.error.code, 'checksum_mismatch');
  }
  assertRejected(
    copySql(
      TARGET_BUILDING_IDS.map((id, index) => cellLine(id, 100 + index, index, 0)),
      TARGET_BUILDING_IDS.map((id, index) => stateLine(id, DEF_IDS[index] ?? '', index, 0)),
      [storageLine('build:1789433747949:rxekjwt5zi')],
    ),
    EMPTY_CURRENT,
    'target_storage_present',
  );
}

function proveReportAndManifestTokens(): void {
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
  const report = renderSectBuildingRecoveryReport(result.plan);
  assert.match(report, new RegExp(BACKUP_IDENTITY));
  assert.match(report, new RegExp(COVERAGE_GAP_TOKEN));
  assert.match(report, /dry-run/);
  const manifest = buildSectBuildingRecoveryManifest(result.plan);
  assert.equal(manifest.dumpIdentity, BACKUP_IDENTITY);
  assert.equal(manifest.dumpSha256, BACKUP_SHA256);
  assert.equal(manifest.mode, 'dry-run');
  assert.equal(manifest.coverageGapToken, COVERAGE_GAP_TOKEN);
  assert.deepEqual(manifest.buildingIds, TARGET_BUILDING_IDS);
  assert.equal(manifest.cells.length, 8);
  assert.equal(manifest.storageItems.length, 0);
  assert.equal(manifest.currentState.fileSha256, EMPTY_CURRENT.fileSha256);
  assert.equal(manifest.currentState.dataSha256, EMPTY_CURRENT.dataSha256);
  assert.equal(manifest.manifestSha256, result.plan.manifestSha256);
  assert.match(report, new RegExp(EMPTY_CURRENT.fileSha256));
  assert.match(report, new RegExp(EMPTY_CURRENT.dataSha256));
}

function proveMutatedSqlFailsChecksumAndEmitsNoManifest(): void {
  const sourcePath = extractionPath();
  assert.equal(fs.existsSync(sourcePath), true);
  const original = fs.readFileSync(sourcePath, 'utf8');
  const mutatedSql = `${original} `;
  const mutatedPath = path.join(os.tmpdir(), `sect-building-recovery-mutated-${String(process.pid)}.sql`);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sect-building-recovery-out-'));
  fs.writeFileSync(mutatedPath, mutatedSql, 'utf8');
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    const planResult = buildSectBuildingRecoveryPlan({
      sqlText: mutatedSql,
      sourceSqlSha256: SOURCE_SQL_SHA256,
      dumpIdentity: BACKUP_IDENTITY,
      dumpSha256: BACKUP_SHA256,
      current: EMPTY_CURRENT,
    });
    assert.equal(planResult.ok, false);
    if (!planResult.ok) {
      assert.equal(planResult.error.code, 'checksum_mismatch');
    }
    const receiptPath = path.join(outDir, 'current-state.json');
    const exitCode = runSectBuildingRecoveryCli(
      ['--sql', mutatedPath, '--out-dir', outDir, ...currentStateCliArgs(receiptPath)],
      {
        stdout: { write(chunk: string) { stdout.push(chunk); } },
        stderr: { write(chunk: string) { stderr.push(chunk); } },
      },
    );
    assert.equal(exitCode, 2);
    assert.match(stderr.join(''), /checksum_mismatch/);
    assert.equal(fs.existsSync(path.join(outDir, 'sect-building-recovery-manifest.json')), false);
    assert.equal(fs.existsSync(path.join(outDir, 'sect-building-recovery-report.txt')), false);
    assert.equal(stdout.join('').includes('manifestSha256='), false);
  } finally {
    fs.rmSync(mutatedPath, { force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function proveRealExtractionIfPresent(): { skipped: boolean; manifestSha256?: string } {
  const sourcePath = extractionPath();
  if (!fs.existsSync(sourcePath)) {
    return { skipped: true };
  }
  const sqlText = fs.readFileSync(sourcePath, 'utf8');
  const sha = createHash('sha256').update(sqlText, 'utf8').digest('hex');
  assert.equal(sha, SOURCE_SQL_SHA256);
  const result = buildSectBuildingRecoveryPlan({
    sqlText,
    sourceSqlSha256: SOURCE_SQL_SHA256,
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current: EMPTY_CURRENT,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return { skipped: false };
  }
  assert.deepEqual(result.plan.buildings.map((row) => row.buildingId), TARGET_BUILDING_IDS);
  assert.equal(result.plan.cells.length, 8);
  assert.equal(result.plan.storageItems.length, 0);
  const stdout: string[] = [];
  const receiptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sect-building-recovery-current-'));
  const receiptPath = path.join(receiptDir, 'current-state.json');
  const exitCode = runSectBuildingRecoveryCli(
    ['--sql', sourcePath, ...currentStateCliArgs(receiptPath)],
    {
      stdout: { write(chunk: string) { stdout.push(chunk); } },
      stderr: { write() { return undefined; } },
    },
  );
  fs.rmSync(receiptDir, { recursive: true, force: true });
  assert.equal(exitCode, 0);
  assert.match(stdout.join(''), /sourceSqlVerified=true/);
  assert.match(stdout.join(''), /currentStateFileSha256=/);
  const applyDenied = runSectBuildingRecoveryCli(['--apply'], {
    stdout: { write() { return undefined; } },
    stderr: { write() { return undefined; } },
  });
  assert.equal(applyDenied, 2);
  return { skipped: false, manifestSha256: result.plan.manifestSha256 };
}

function main(): void {
  proveHappyPathSelectsExactEight();
  proveRejectsMissingExtraDuplicateAndMismatches();
  proveReportAndManifestTokens();
  proveMutatedSqlFailsChecksumAndEmitsNoManifest();
  const extraction = proveRealExtractionIfPresent();
  console.log(JSON.stringify({
    ok: true,
    case: 'sect-building-recovery-manifest',
    extraction,
    note: 'dry-run only; apply module removed; backup cannot capture 11:00-11:48 UTC',
  }, null, 2));
}

main();
