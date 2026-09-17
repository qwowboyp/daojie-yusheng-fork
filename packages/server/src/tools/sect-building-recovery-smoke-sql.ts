/**
 * Recovery smoke 用的 COPY SQL fixture。非正式資料、不連庫。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TARGET_INSTANCE_ID } from './sect-building-recovery-constants';
import {
  bindCurrentState,
  serializeCurrentStateReceipt,
  type BoundCurrentState,
} from './sect-building-recovery-current-state';

export const EMPTY_CURRENT = bindCurrentState();

export function writeCurrentStateFile(filePath: string, current: BoundCurrentState = EMPTY_CURRENT): BoundCurrentState {
  fs.writeFileSync(filePath, serializeCurrentStateReceipt(current), 'utf8');
  return current;
}

export function currentStateCliArgs(
  receiptPath: string,
  current: BoundCurrentState = EMPTY_CURRENT,
): readonly string[] {
  writeCurrentStateFile(receiptPath, current);
  return ['--current-state', receiptPath, '--current-state-sha256', current.fileSha256];
}

export const DEF_IDS = [
  'spirit_incubator_metal',
  'spirit_incubator_wood',
  'spirit_incubator_water',
  'spirit_incubator_fire',
  'spirit_incubator_earth',
  'sect_iron_mine',
  'sect_spirit_stone_mine',
  'sect_spirit_field',
] as const;

export function cellLine(buildingId: string, tileIndex: number, x: number, y: number): string {
  return `${TARGET_INSTANCE_ID}\t${buildingId}\t${tileIndex}\t${x}\t${y}\tfloor\t\\N\t\\N\t\\N\t\\N\t{}\tf\tf\t2026-09-15 04:07:39.95537+00`;
}

export function stateLine(buildingId: string, defId: string, x: number, y: number): string {
  const payload = `{"cells": [{"x": ${String(x)}, "y": ${String(y)}, "tileType": "floor"}], "instanceId": "${TARGET_INSTANCE_ID}"}`;
  return `${TARGET_INSTANCE_ID}\t${buildingId}\t${defId}\t${x}\t${y}\t0\tp_968e1246-d327-4ea4-8624-2111214cede1\tsect:p_968e1246-d327-4ea4-8624-2111214cede1:mthy0v4f\t\\N\t100\t100\tactive\t1\t1\t1\t${payload}\t2026-09-15 04:07:39.95537+00`;
}

export function storageLine(buildingId: string): string {
  return `storage:test:1\t${TARGET_INSTANCE_ID}\t${buildingId}\t0\tspirit_stone\t1\t0\t{}\t\\N\t\\N\t2026-09-15 04:07:39.95537+00`;
}

export function copySql(
  cells: readonly string[],
  states: readonly string[],
  storage: readonly string[] = [],
): string {
  return [
    'COPY public.instance_building_cell (instance_id, building_id, tile_index, x, y, tile_type, previous_tile_type, previous_terrain_type, previous_surface_type, previous_structure_type, previous_interactable_kinds, blocks_move, blocks_sight, updated_at) FROM stdin;',
    ...cells,
    '\\.',
    'COPY public.instance_building_state (instance_id, building_id, def_id, x, y, rotation, owner_player_id, owner_sect_id, room_id, hp, max_hp, state, created_at_tick, updated_at_tick, revision, payload, updated_at) FROM stdin;',
    ...states,
    '\\.',
    'COPY public.instance_building_storage_item (storage_item_id, instance_id, building_id, slot_index, item_id, count, enhance_level, raw_payload, owner_player_id, building_name, updated_at) FROM stdin;',
    ...storage,
    '\\.',
  ].join('\n');
}

export function eightBuildingSql(): string {
  const defs: ReadonlyArray<readonly [string, string, number, number, number]> = [
    ['build:1789433747949:rxekjwt5zi', 'spirit_incubator_metal', 2, 6, 151],
    ['build:1789433754648:bo9whuvdl47', 'spirit_incubator_wood', 1, 6, 150],
    ['build:1789433758532:6f5crr2kk02', 'spirit_incubator_water', 0, 6, 149],
    ['build:1789433763533:4ze284h93ny', 'spirit_incubator_fire', 2, 7, 165],
    ['build:1789433766948:fh7b8bxgb8', 'spirit_incubator_earth', 1, 7, 164],
    ['build:1789433789848:dzd2v1phqdi', 'sect_iron_mine', 3, 3, 110],
    ['build:1789433810098:7sqjsgyt6g5', 'sect_spirit_stone_mine', 2, 3, 109],
    ['build:1789433848348:yga6o9mjo4a', 'sect_spirit_field', 3, 2, 96],
  ];
  return copySql(
    defs.map(([id, , x, y, tileIndex]) => cellLine(id, tileIndex, x, y)),
    defs.map(([id, defId, x, y]) => stateLine(id, defId, x, y)),
  );
}

export function extractionPath(): string {
  return process.env.SECT_BUILDING_RECOVERY_SQL
    || path.join(os.tmpdir(), 'opencode', 'sect-recovery', 'building-recovery-source.sql');
}
