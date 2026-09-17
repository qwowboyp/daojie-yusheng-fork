/**
 * Offline --emit-apply-sql 契約。只產 SQL 檔，不連庫、不執行。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BACKUP_IDENTITY,
  BACKUP_SHA256,
  COVERAGE_GAP_TOKEN,
  SOURCE_SQL_SHA256,
  TARGET_BUILDING_IDS,
} from './sect-building-recovery-constants';
import { bindCurrentState, type BoundCurrentState } from './sect-building-recovery-current-state';
import { emitSectBuildingRecoverySql } from './sect-building-recovery-emit-sql';
import { runSectBuildingRecoveryCli } from './sect-building-recovery-manifest';
import { buildSectBuildingRecoveryPlan } from './sect-building-recovery-plan';
import { pgSqlLiteral } from './sect-building-recovery-sql-literal';
import {
  EMPTY_CURRENT,
  currentStateCliArgs,
  eightBuildingSql,
  extractionPath,
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sect-building-recovery-emit-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function proveEmitSqlRequiresAuthorization(): void {
  withTempDir((dir) => {
    const sqlOut = path.join(dir, 'recovery-apply.sql');
    const receiptPath = path.join(dir, 'current-state.json');
    const captured = captureCli([
      '--sql', extractionPath(),
      ...currentStateCliArgs(receiptPath),
      '--emit-apply-sql', sqlOut,
    ]);
    assert.equal(captured.exitCode, 2);
    assert.match(captured.stderr, /emit_authorization_mismatch/);
    assert.equal(fs.existsSync(sqlOut), false);
  });
}

function proveEmitSqlRejectsWrongAuthorization(): void {
  withTempDir((dir) => {
    const sqlOut = path.join(dir, 'recovery-apply.sql');
    const receiptPath = path.join(dir, 'current-state.json');
    const captured = captureCli([
      '--sql', extractionPath(),
      ...currentStateCliArgs(receiptPath),
      '--emit-apply-sql', sqlOut,
      '--emit-authorization', '0'.repeat(64),
    ]);
    assert.equal(captured.exitCode, 2);
    assert.match(captured.stderr, /emit_authorization_mismatch/);
    assert.equal(fs.existsSync(sqlOut), false);
  });
}

function provePgSqlLiteralEscapes(): void {
  assert.equal(pgSqlLiteral(null), 'NULL');
  assert.equal(pgSqlLiteral("O'Brien"), "'O''Brien'");
  assert.equal(pgSqlLiteral('a\\b'), "E'a\\\\b'");
  assert.equal(pgSqlLiteral({ k: "v'1" }), `'{"k":"v''1"}'::jsonb`);
  assert.equal(pgSqlLiteral([]), 'ARRAY[]::text[]');
  assert.equal(pgSqlLiteral(['a', 'b']), "ARRAY['a', 'b']::text[]");
  assert.equal(pgSqlLiteral(true), 'TRUE');
  assert.equal(pgSqlLiteral(false), 'FALSE');
}

function fixturePlanSql(): string {
  const planned = buildSectBuildingRecoveryPlan({
    sqlText: eightBuildingSql(),
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current: EMPTY_CURRENT,
  });
  if (planned.ok === false) {
    throw new Error(planned.error.message);
  }
  return emitSectBuildingRecoverySql(planned.plan);
}

function proveOracleGapsRequireAuthoritativeParentsTileIndexAndFullRows(): void {
  const sql = fixturePlanSql();
  assert.match(sql, /FROM instance_catalog[\s\S]*FOR UPDATE/);
  assert.match(sql, /instance_type = 'sect'/);
  assert.match(sql, /persistent_policy = 'persistent'/);
  assert.match(sql, /FROM server_sect[\s\S]*FOR UPDATE/);
  assert.match(sql, /sect_instance_id = /);
  assert.match(sql, /tile_index IN \(151, 150, 149, 165, 164, 110, 109, 96\)/);
  assert.match(sql, /IS NOT DISTINCT FROM/);
  assert.match(sql, /\(instance_id, building_id, def_id, x, y, rotation, owner_player_id, owner_sect_id, room_id, hp, max_hp, state, created_at_tick, updated_at_tick, revision, payload, updated_at\)/);
  assert.match(sql, /\(instance_id, building_id, tile_index, x, y, tile_type, previous_tile_type, previous_terrain_type, previous_surface_type, previous_structure_type, previous_interactable_kinds, blocks_move, blocks_sight, updated_at\)/);
}

function proveEmittedSqlShapeFromFixturePlan(): void {
  const sql = fixturePlanSql();
  assert.match(sql, /BEGIN ISOLATION LEVEL SERIALIZABLE;/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /SET LOCAL statement_timeout = '30s';/);
  assert.match(sql, /LOCK TABLE instance_building_state, instance_building_cell, instance_building_storage_item IN SHARE ROW EXCLUSIVE MODE;/);
  assert.match(sql, /INSERT INTO instance_building_state \(/);
  assert.match(sql, /INSERT INTO instance_building_cell \(/);
  assert.equal(/INSERT INTO instance_building_storage_item/i.test(sql), false);
  assert.equal(/ON CONFLICT/i.test(sql), false);
  assert.equal(/(?<!FOR )\bUPDATE\b/i.test(sql), false);
  assert.equal(/\bDELETE\b/i.test(sql), false);
  assert.equal(/\bTRUNCATE\b/i.test(sql), false);
  assert.match(sql, /state_count <> 8/);
  assert.match(sql, /cell_count <> 8/);
  assert.match(sql, /storage_count <> 0/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, new RegExp(BACKUP_IDENTITY));
  assert.match(sql, new RegExp(COVERAGE_GAP_TOKEN === 'cannot_capture_1100_to_1148_utc' ? '11:00 UTC' : COVERAGE_GAP_TOKEN));
  for (const buildingId of TARGET_BUILDING_IDS) {
    assert.match(sql, new RegExp(buildingId.replaceAll(':', '\\:')));
  }
}

function planForCurrent(current: BoundCurrentState) {
  const planned = buildSectBuildingRecoveryPlan({
    sqlText: fs.readFileSync(extractionPath(), 'utf8'),
    sourceSqlSha256: SOURCE_SQL_SHA256,
    dumpIdentity: BACKUP_IDENTITY,
    dumpSha256: BACKUP_SHA256,
    current,
  });
  if (planned.ok === false) {
    throw new Error(planned.error.message);
  }
  return planned.plan;
}

function sqlWithoutReceiptComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.startsWith('-- currentStateFileSha256=') && !line.startsWith('-- manifestSha256='))
    .join('\n');
}

function proveTwoReceiptsAuthorizeOnlyWithOwnManifest(): void {
  const earlier = bindCurrentState({ queriedAt: '2026-09-17T14:21:27.999Z' });
  const later = bindCurrentState({ queriedAt: '2026-09-17T14:30:00.000Z' });
  const earlierPlan = planForCurrent(earlier);
  const laterPlan = planForCurrent(later);
  assert.notEqual(earlierPlan.manifestSha256, laterPlan.manifestSha256);
  withTempDir((dir) => {
    const earlierOut = path.join(dir, 'earlier.sql');
    const laterOut = path.join(dir, 'later.sql');
    const crossOut = path.join(dir, 'cross.sql');
    const earlierOk = captureCli([
      '--sql', extractionPath(),
      ...currentStateCliArgs(path.join(dir, 'earlier.json'), earlier),
      '--emit-apply-sql', earlierOut,
      '--emit-authorization', earlierPlan.manifestSha256,
    ]);
    assert.equal(earlierOk.exitCode, 0);
    assert.equal(fs.existsSync(earlierOut), true);
    const laterOk = captureCli([
      '--sql', extractionPath(),
      ...currentStateCliArgs(path.join(dir, 'later.json'), later),
      '--emit-apply-sql', laterOut,
      '--emit-authorization', laterPlan.manifestSha256,
    ]);
    assert.equal(laterOk.exitCode, 0);
    assert.equal(fs.existsSync(laterOut), true);
    const cross = captureCli([
      '--sql', extractionPath(),
      ...currentStateCliArgs(path.join(dir, 'cross.json'), earlier),
      '--emit-apply-sql', crossOut,
      '--emit-authorization', laterPlan.manifestSha256,
    ]);
    assert.equal(cross.exitCode, 2);
    assert.match(cross.stderr, /emit_authorization_mismatch/);
    assert.equal(fs.existsSync(crossOut), false);
    assert.equal(
      sqlWithoutReceiptComments(fs.readFileSync(earlierOut, 'utf8')),
      sqlWithoutReceiptComments(fs.readFileSync(laterOut, 'utf8')),
    );
  });
}

function proveApplyFlagStillRefused(): void {
  const captured = captureCli(['--apply', '--emit-apply-sql', 'ignored.sql']);
  assert.equal(captured.exitCode, 2);
  assert.match(captured.stderr, /apply is not part of this dry-run tool/);
}

function main(): void {
  provePgSqlLiteralEscapes();
  proveOracleGapsRequireAuthoritativeParentsTileIndexAndFullRows();
  proveEmittedSqlShapeFromFixturePlan();
  proveEmitSqlRequiresAuthorization();
  proveEmitSqlRejectsWrongAuthorization();
  proveTwoReceiptsAuthorizeOnlyWithOwnManifest();
  proveApplyFlagStillRefused();
  console.log(JSON.stringify({
    ok: true,
    case: 'sect-building-recovery-emit-sql',
    note: 'emit-only; never execute; backup cannot capture 11:00-11:48 UTC',
  }));
}

main();
