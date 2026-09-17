/**
 * 產出可審計、永不執行的 recovery SQL。不連庫、不跑 SQL。
 */
import fs from 'node:fs';
import {
  BACKUP_IDENTITY,
  COVERAGE_GAP_NOTE,
  TARGET_BUILDING_IDS,
  TARGET_INSTANCE_ID,
  TARGET_OWNER_SECT_ID,
} from './sect-building-recovery-constants';
import type { CopyRow } from './sect-building-recovery-copy-parser';
import { renderPreflightSql, renderVerifySql } from './sect-building-recovery-emit-sql-checks';
import { sha256Utf8 } from './sect-building-recovery-hash';
import type { RecoveryPlan } from './sect-building-recovery-plan';
import { pgSqlLiteral } from './sect-building-recovery-sql-literal';

export const STATE_INSERT_COLUMNS = [
  'instance_id', 'building_id', 'def_id', 'x', 'y', 'rotation',
  'owner_player_id', 'owner_sect_id', 'room_id', 'hp', 'max_hp', 'state',
  'created_at_tick', 'updated_at_tick', 'revision', 'payload', 'updated_at',
] as const;

export const CELL_INSERT_COLUMNS = [
  'instance_id', 'building_id', 'tile_index', 'x', 'y', 'tile_type',
  'previous_tile_type', 'previous_terrain_type', 'previous_surface_type',
  'previous_structure_type', 'previous_interactable_kinds',
  'blocks_move', 'blocks_sight', 'updated_at',
] as const;

export type EmitSqlAuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'emit_authorization_mismatch'; readonly message: string };

export function authorizeEmitSql(input: {
  readonly authorization: string;
  readonly manifestSha256: string;
}): EmitSqlAuthResult {
  if (input.authorization !== '' && input.authorization === input.manifestSha256) {
    return { ok: true };
  }
  return {
    ok: false,
    code: 'emit_authorization_mismatch',
    message: 'emit authorization token must equal this plan manifestSha256; dry-run first then copy the printed hash',
  };
}

function idListSql(): string {
  return TARGET_BUILDING_IDS.map((id) => pgSqlLiteral(id)).join(', ');
}

function coordListSql(rows: readonly CopyRow[]): string {
  return rows.map((row) => `(${pgSqlLiteral(row.x)}, ${pgSqlLiteral(row.y)})`).join(', ');
}

function valuesSql(row: CopyRow, columns: readonly string[]): string {
  return `(${columns.map((column) => pgSqlLiteral(row[column])).join(', ')})`;
}

export function emitSectBuildingRecoverySql(plan: RecoveryPlan): string {
  const instanceSql = pgSqlLiteral(TARGET_INSTANCE_ID);
  const ownerSql = pgSqlLiteral(TARGET_OWNER_SECT_ID);
  const idsSql = idListSql();
  const stateValues = plan.buildings.map((row) => valuesSql(row, STATE_INSERT_COLUMNS)).join(',\n');
  const cellValues = plan.cells.map((row) => valuesSql(row, CELL_INSERT_COLUMNS)).join(',\n');
  return [
    `-- sect-building-recovery emit-apply-sql; CLI does not execute this file`,
    `-- dumpIdentity=${BACKUP_IDENTITY}`,
    `-- dumpSha256=${plan.dumpSha256}`,
    `-- sourceSqlSha256=${plan.sourceSqlSha256}`,
    `-- currentStateFileSha256=${plan.currentState.fileSha256}`,
    `-- currentStateDataSha256=${plan.currentState.dataSha256}`,
    `-- manifestSha256=${plan.manifestSha256}`,
    `-- ${COVERAGE_GAP_NOTE}`,
    `BEGIN ISOLATION LEVEL SERIALIZABLE;`,
    `SET LOCAL lock_timeout = '5s';`,
    `SET LOCAL statement_timeout = '30s';`,
    `LOCK TABLE instance_building_state, instance_building_cell, instance_building_storage_item IN SHARE ROW EXCLUSIVE MODE;`,
    renderPreflightSql({
      instanceSql,
      ownerSql,
      idsSql,
      stateCoords: coordListSql(plan.buildings),
      cellCoords: coordListSql(plan.cells),
    }),
    `INSERT INTO instance_building_state (${STATE_INSERT_COLUMNS.join(', ')})`,
    `VALUES`,
    `${stateValues};`,
    `INSERT INTO instance_building_cell (${CELL_INSERT_COLUMNS.join(', ')})`,
    `VALUES`,
    `${cellValues};`,
    renderVerifySql({
      instanceSql,
      idsSql,
      buildings: plan.buildings,
      cells: plan.cells,
      stateColumns: STATE_INSERT_COLUMNS,
      cellColumns: CELL_INSERT_COLUMNS,
    }),
    `COMMIT;`,
    '',
  ].join('\n');
}

export function writeEmittedRecoverySql(plan: RecoveryPlan, outputPath: string): { readonly sqlSha256: string } {
  const sql = emitSectBuildingRecoverySql(plan);
  fs.writeFileSync(outputPath, sql, 'utf8');
  return { sqlSha256: sha256Utf8(sql) };
}
