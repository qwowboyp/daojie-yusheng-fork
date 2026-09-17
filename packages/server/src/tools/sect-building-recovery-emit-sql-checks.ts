/**
 * Fail-closed preflight / 全欄位 verify SQL 片段。此檔不連庫、不執行。
 */
import { TARGET_TILE_INDEXES } from './sect-building-recovery-constants';
import type { CopyRow } from './sect-building-recovery-copy-parser';
import { pgSqlLiteral } from './sect-building-recovery-sql-literal';

function raiseIfExists(conditionSql: string, message: string): string {
  return [
    `  IF EXISTS (`,
    conditionSql,
    `  ) THEN`,
    `    RAISE EXCEPTION ${pgSqlLiteral(message)};`,
    `  END IF;`,
  ].join('\n');
}

function rowMatchesSql(table: string, columns: readonly string[], row: CopyRow): string {
  const colList = columns.join(', ');
  const litList = columns.map((column) => pgSqlLiteral(row[column])).join(', ');
  const buildingId = pgSqlLiteral(row.building_id);
  return [
    `  IF NOT EXISTS (`,
    `    SELECT 1 FROM ${table}`,
    `    WHERE (${colList}) IS NOT DISTINCT FROM (${litList})`,
    `  ) THEN`,
    `    RAISE EXCEPTION 'post-insert row mismatch in ${table} %', ${buildingId};`,
    `  END IF;`,
  ].join('\n');
}

export function renderPreflightSql(input: {
  readonly instanceSql: string;
  readonly ownerSql: string;
  readonly idsSql: string;
  readonly stateCoords: string;
  readonly cellCoords: string;
}): string {
  const { instanceSql, ownerSql, idsSql, stateCoords, cellCoords } = input;
  const tileIndexes = TARGET_TILE_INDEXES.join(', ');
  return [
    `DO $sect_recovery_preflight$`,
    `DECLARE`,
    `  catalog_locked integer;`,
    `  sect_locked integer;`,
    `BEGIN`,
    `  SELECT 1 INTO catalog_locked`,
    `  FROM instance_catalog`,
    `  WHERE instance_id = ${instanceSql}`,
    `    AND instance_type = 'sect'`,
    `    AND persistent_policy = 'persistent'`,
    `    AND owner_sect_id = ${ownerSql}`,
    `    AND status = 'active'`,
    `    AND destroy_at IS NULL`,
    `  FOR UPDATE;`,
    `  IF catalog_locked IS NULL THEN`,
    `    RAISE EXCEPTION 'instance_catalog row missing or identity mismatch';`,
    `  END IF;`,
    `  SELECT 1 INTO sect_locked`,
    `  FROM server_sect`,
    `  WHERE sect_id = ${ownerSql}`,
    `    AND sect_instance_id = ${instanceSql}`,
    `    AND status = 'active'`,
    `  FOR UPDATE;`,
    `  IF sect_locked IS NULL THEN`,
    `    RAISE EXCEPTION 'server_sect row missing or identity mismatch';`,
    `  END IF;`,
    `  IF NOT EXISTS (`,
    `    SELECT 1 FROM instance_building_state`,
    `    WHERE instance_id = ${instanceSql} AND owner_sect_id = ${ownerSql}`,
    `  ) THEN`,
    `    RAISE EXCEPTION 'no remaining building row for target instance/owner';`,
    `  END IF;`,
    raiseIfExists(
      `    SELECT 1 FROM instance_building_state\n    WHERE instance_id = ${instanceSql} AND building_id IN (${idsSql})`,
      'target building ids already present in instance_building_state',
    ),
    raiseIfExists(
      `    SELECT 1 FROM instance_building_cell\n    WHERE instance_id = ${instanceSql} AND building_id IN (${idsSql})`,
      'target building ids already present in instance_building_cell',
    ),
    raiseIfExists(
      `    SELECT 1 FROM instance_building_storage_item\n    WHERE instance_id = ${instanceSql} AND building_id IN (${idsSql})`,
      'target building ids already present in instance_building_storage_item',
    ),
    raiseIfExists(
      `    SELECT 1 FROM instance_building_state\n    WHERE instance_id = ${instanceSql} AND (x, y) IN (${stateCoords})`,
      'target coordinates occupied in instance_building_state',
    ),
    raiseIfExists(
      `    SELECT 1 FROM instance_building_cell\n    WHERE instance_id = ${instanceSql} AND (x, y) IN (${cellCoords})`,
      'target coordinates occupied in instance_building_cell',
    ),
    raiseIfExists(
      `    SELECT 1 FROM instance_building_cell\n    WHERE instance_id = ${instanceSql} AND tile_index IN (${tileIndexes})`,
      'target tile_index occupied in instance_building_cell',
    ),
    `END`,
    `$sect_recovery_preflight$;`,
  ].join('\n');
}

export function renderVerifySql(input: {
  readonly instanceSql: string;
  readonly idsSql: string;
  readonly buildings: readonly CopyRow[];
  readonly cells: readonly CopyRow[];
  readonly stateColumns: readonly string[];
  readonly cellColumns: readonly string[];
}): string {
  const { instanceSql, idsSql, buildings, cells, stateColumns, cellColumns } = input;
  return [
    `DO $sect_recovery_verify$`,
    `DECLARE`,
    `  state_count integer;`,
    `  cell_count integer;`,
    `  storage_count integer;`,
    `BEGIN`,
    `  SELECT COUNT(*) INTO state_count FROM instance_building_state`,
    `    WHERE instance_id = ${instanceSql} AND building_id IN (${idsSql});`,
    `  IF state_count <> 8 THEN`,
    `    RAISE EXCEPTION 'post-insert state count % <> 8', state_count;`,
    `  END IF;`,
    `  SELECT COUNT(*) INTO cell_count FROM instance_building_cell`,
    `    WHERE instance_id = ${instanceSql} AND building_id IN (${idsSql});`,
    `  IF cell_count <> 8 THEN`,
    `    RAISE EXCEPTION 'post-insert cell count % <> 8', cell_count;`,
    `  END IF;`,
    `  SELECT COUNT(*) INTO storage_count FROM instance_building_storage_item`,
    `    WHERE instance_id = ${instanceSql} AND building_id IN (${idsSql});`,
    `  IF storage_count <> 0 THEN`,
    `    RAISE EXCEPTION 'post-insert storage count % <> 0', storage_count;`,
    `  END IF;`,
    ...buildings.map((row) => rowMatchesSql('instance_building_state', stateColumns, row)),
    ...cells.map((row) => rowMatchesSql('instance_building_cell', cellColumns, row)),
    `END`,
    `$sect_recovery_verify$;`,
  ].join('\n');
}
