/**
 * 從 COPY SQL 選出目標實例的八棟建築，校驗契約並計算確定性 hash。
 */
import {
  BACKUP_IDENTITY,
  BACKUP_SHA256,
  COVERAGE_GAP_NOTE,
  COVERAGE_GAP_TOKEN,
  EXPECTED_DEF_BY_BUILDING_ID,
  TARGET_BUILDING_IDS,
  TARGET_INSTANCE_ID,
  TARGET_OWNER_SECT_ID,
} from './sect-building-recovery-constants';
import type { BoundCurrentState } from './sect-building-recovery-current-state';
import { parsePgRestoreCopySql, type CopyRow } from './sect-building-recovery-copy-parser';
import { isRecord, sha256Canonical, sha256Utf8 } from './sect-building-recovery-hash';

export type RecoveryErrorCode =
  | 'missing_state_rows'
  | 'extra_state_rows'
  | 'duplicate_state_rows'
  | 'missing_cell_rows'
  | 'extra_cell_rows'
  | 'duplicate_cell_rows'
  | 'def_mismatch'
  | 'parent_instance_mismatch'
  | 'checksum_mismatch'
  | 'target_storage_present'
  | 'current_state_missing'
  | 'current_state_malformed'
  | 'current_state_instance_mismatch'
  | 'current_state_stale'
  | 'current_state_checksum_mismatch'
  | 'current_state_buildings_present'
  | 'current_state_cells_present'
  | 'current_state_storage_present';

export type RecoveryError = {
  readonly code: RecoveryErrorCode;
  readonly message: string;
};

export type RecoveryBuildingRow = CopyRow & {
  readonly buildingId: string;
  readonly instanceId: string;
  readonly defId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly rowSha256: string;
};

export type ManifestSemantics = {
  readonly mode: 'dry-run';
  readonly dumpIdentity: string;
  readonly dumpSha256: string;
  readonly sourceSqlSha256: string;
  readonly coverageGapToken: string;
  readonly coverageGapNote: string;
  readonly instanceId: string;
  readonly buildingIds: readonly string[];
  readonly currentState: BoundCurrentState;
  readonly buildings: readonly RecoveryBuildingRow[];
  readonly cells: readonly CopyRow[];
  readonly storageItems: readonly CopyRow[];
};

export type RecoveryPlan = ManifestSemantics & {
  readonly manifestSha256: string;
};

export type RecoveryPlanResult =
  | { readonly ok: true; readonly plan: RecoveryPlan }
  | { readonly ok: false; readonly error: RecoveryError };

const TARGET_ID_SET: ReadonlySet<string> = new Set(TARGET_BUILDING_IDS);

function fail(code: RecoveryErrorCode, message: string): RecoveryPlanResult {
  return { ok: false, error: { code, message } };
}

function asString(row: CopyRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function isTargetBuildingId(buildingId: string): boolean {
  return TARGET_ID_SET.has(buildingId);
}

function countByBuildingId(rows: readonly CopyRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const buildingId = asString(row, 'building_id');
    counts.set(buildingId, (counts.get(buildingId) ?? 0) + 1);
  }
  return counts;
}

export function recoveryManifestSemantics(plan: ManifestSemantics): ManifestSemantics {
  return {
    mode: plan.mode,
    dumpIdentity: plan.dumpIdentity,
    dumpSha256: plan.dumpSha256,
    sourceSqlSha256: plan.sourceSqlSha256,
    coverageGapToken: plan.coverageGapToken,
    coverageGapNote: plan.coverageGapNote,
    instanceId: plan.instanceId,
    buildingIds: plan.buildingIds,
    currentState: plan.currentState,
    buildings: plan.buildings,
    cells: plan.cells,
    storageItems: plan.storageItems,
  };
}

export function buildSectBuildingRecoveryPlan(input: {
  readonly sqlText: string;
  readonly sourceSqlSha256?: string;
  readonly dumpIdentity?: string;
  readonly dumpSha256?: string;
  readonly current?: BoundCurrentState;
}): RecoveryPlanResult {
  const dumpIdentity = input.dumpIdentity ?? BACKUP_IDENTITY;
  const dumpSha256 = input.dumpSha256 ?? BACKUP_SHA256;
  if (dumpIdentity !== BACKUP_IDENTITY || dumpSha256 !== BACKUP_SHA256) {
    return fail('checksum_mismatch', 'backup identity or dump SHA-256 does not match 20260917-110032-hourly-f42e62c0');
  }
  const current = input.current;
  if (!current) {
    return fail('current_state_missing', 'current-state receipt is required');
  }
  const sourceSqlSha256 = sha256Utf8(input.sqlText);
  if (input.sourceSqlSha256 && input.sourceSqlSha256 !== sourceSqlSha256) {
    return fail('checksum_mismatch', 'source SQL SHA-256 does not match sqlText');
  }

  const parsed = parsePgRestoreCopySql(input.sqlText);
  const targetStateAnyInstance = parsed.instance_building_state.filter((row) =>
    isTargetBuildingId(asString(row, 'building_id')),
  );
  if (targetStateAnyInstance.some((row) => asString(row, 'instance_id') !== TARGET_INSTANCE_ID)) {
    return fail('parent_instance_mismatch', 'target building rows are not on the required instance');
  }
  if (targetStateAnyInstance.some((row) => asString(row, 'owner_sect_id') !== TARGET_OWNER_SECT_ID)) {
    return fail('parent_instance_mismatch', 'target building owner_sect_id does not match');
  }

  const stateRows = targetStateAnyInstance.filter((row) => asString(row, 'instance_id') === TARGET_INSTANCE_ID);
  const stateCounts = countByBuildingId(stateRows);
  if ([...stateCounts.values()].some((count) => count > 1)) {
    return fail('duplicate_state_rows', 'duplicate instance_building_state rows for a target building_id');
  }
  const presentIds = TARGET_BUILDING_IDS.filter((id) => (stateCounts.get(id) ?? 0) === 1);
  if (presentIds.length !== TARGET_BUILDING_IDS.length) {
    return fail('missing_state_rows', 'COPY is missing one or more of the eight target state rows');
  }
  if (stateRows.length !== TARGET_BUILDING_IDS.length) {
    return fail('extra_state_rows', 'COPY has extra state rows beyond the eight target IDs');
  }

  for (const row of stateRows) {
    const buildingId = asString(row, 'building_id');
    const expectedDef = EXPECTED_DEF_BY_BUILDING_ID[buildingId];
    if (!expectedDef || asString(row, 'def_id') !== expectedDef) {
      return fail('def_mismatch', `def_id mismatch for ${buildingId}`);
    }
  }

  const cellRows = parsed.instance_building_cell.filter(
    (row) =>
      asString(row, 'instance_id') === TARGET_INSTANCE_ID && isTargetBuildingId(asString(row, 'building_id')),
  );
  const cellCounts = countByBuildingId(cellRows);
  if ([...cellCounts.values()].some((count) => count > 1)) {
    return fail('duplicate_cell_rows', 'duplicate instance_building_cell rows for a target building_id');
  }
  if (TARGET_BUILDING_IDS.some((id) => (cellCounts.get(id) ?? 0) === 0)) {
    return fail('missing_cell_rows', 'COPY is missing cell rows for one or more target buildings');
  }
  if (cellRows.length !== TARGET_BUILDING_IDS.length) {
    return fail('extra_cell_rows', 'COPY has extra cell rows for the eight target buildings');
  }

  const storageItems = parsed.instance_building_storage_item.filter(
    (row) =>
      asString(row, 'instance_id') === TARGET_INSTANCE_ID && isTargetBuildingId(asString(row, 'building_id')),
  );
  if (storageItems.length !== 0) {
    return fail('target_storage_present', 'target buildings must have 0 storage rows');
  }

  if (current.stateBuildingIds.length > 0) {
    return fail('current_state_buildings_present', 'current-state receipt still has building rows');
  }
  if (current.cells.length > 0) {
    return fail('current_state_cells_present', 'current-state receipt still has cell rows');
  }
  if (current.storageItemIds.length > 0) {
    return fail('current_state_storage_present', 'current-state receipt still has storage rows');
  }

  const buildingsById = new Map(stateRows.map((row) => [asString(row, 'building_id'), row]));
  const buildings: RecoveryBuildingRow[] = [];
  for (const buildingId of TARGET_BUILDING_IDS) {
    const row = buildingsById.get(buildingId);
    if (!row) {
      return fail('missing_state_rows', `COPY is missing state row ${buildingId}`);
    }
    const payloadObject = isRecord(row.payload) ? row.payload : {};
    buildings.push({
      ...row,
      buildingId,
      instanceId: TARGET_INSTANCE_ID,
      defId: asString(row, 'def_id'),
      payload: payloadObject,
      rowSha256: sha256Canonical(row),
    });
  }
  const orderedCells = [...cellRows].sort((left, right) =>
    asString(left, 'building_id').localeCompare(asString(right, 'building_id')),
  );
  const semantics = recoveryManifestSemantics({
    mode: 'dry-run',
    dumpIdentity,
    dumpSha256,
    sourceSqlSha256,
    coverageGapToken: COVERAGE_GAP_TOKEN,
    coverageGapNote: COVERAGE_GAP_NOTE,
    instanceId: TARGET_INSTANCE_ID,
    buildingIds: TARGET_BUILDING_IDS,
    currentState: current,
    buildings,
    cells: orderedCells,
    storageItems: [],
  });
  return {
    ok: true,
    plan: {
      ...semantics,
      manifestSha256: sha256Canonical(semantics),
    },
  };
}
