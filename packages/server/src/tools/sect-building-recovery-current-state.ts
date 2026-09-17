/**
 * Current-state receipt 邊界解析。schema 見 CURRENT_STATE_RECEIPT_SCHEMA_DOC。
 */
import { TARGET_INSTANCE_ID } from './sect-building-recovery-constants';
import { isRecord, sha256Canonical, sha256Utf8 } from './sect-building-recovery-hash';

export const CURRENT_STATE_KIND = 'sect-building-recovery-current-state' as const;
export const CURRENT_STATE_SCHEMA_VERSION = 1 as const;
export const CURRENT_STATE_SOURCE = 'gm-readonly-sql' as const;
export const CURRENT_STATE_MIN_QUERIED_AT = '2026-09-17T12:59:12.374Z';

const QUERIED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export type CurrentCellSnapshot = {
  readonly instanceId: string;
  readonly buildingId: string;
  readonly tileIndex: number;
  readonly x: number;
  readonly y: number;
};

export type BoundCurrentState = {
  readonly schemaVersion: 1;
  readonly kind: typeof CURRENT_STATE_KIND;
  readonly instanceId: string;
  readonly queriedAt: string;
  readonly source: typeof CURRENT_STATE_SOURCE;
  readonly stateBuildingIds: readonly string[];
  readonly cells: readonly CurrentCellSnapshot[];
  readonly storageItemIds: readonly string[];
  readonly dataSha256: string;
  readonly fileSha256: string;
};

export type CurrentStateErrorCode =
  | 'current_state_missing'
  | 'current_state_malformed'
  | 'current_state_instance_mismatch'
  | 'current_state_stale'
  | 'current_state_checksum_mismatch';

export type CurrentStateParseResult =
  | { readonly ok: true; readonly current: BoundCurrentState }
  | { readonly ok: false; readonly error: { readonly code: CurrentStateErrorCode; readonly message: string } };

export const CURRENT_STATE_RECEIPT_SCHEMA_DOC = [
  'Current-state receipt JSON schema:',
  '{',
  '  "schemaVersion": 1,',
  `  "kind": "${CURRENT_STATE_KIND}",`,
  `  "instanceId": "${TARGET_INSTANCE_ID}",`,
  `  "queriedAt": "${CURRENT_STATE_MIN_QUERIED_AT}",`,
  `  "source": "${CURRENT_STATE_SOURCE}",`,
  '  "stateBuildingIds": [],',
  '  "cells": [],',
  '  "storageItemIds": [],',
  '  "dataSha256": "<sha256 canonical {instanceId,stateBuildingIds,cells,storageItemIds}>"',
  '}',
  `queriedAt >= ${CURRENT_STATE_MIN_QUERIED_AT}. --current-state-sha256 hashes UTF-8 file bytes.`,
].join('\n');

export function currentStateDataDigest(input: {
  readonly instanceId: string;
  readonly stateBuildingIds: readonly string[];
  readonly cells: readonly CurrentCellSnapshot[];
  readonly storageItemIds: readonly string[];
}): unknown {
  return {
    instanceId: input.instanceId,
    stateBuildingIds: input.stateBuildingIds,
    cells: input.cells,
    storageItemIds: input.storageItemIds,
  };
}

export function hashCurrentStateData(input: {
  readonly instanceId: string;
  readonly stateBuildingIds: readonly string[];
  readonly cells: readonly CurrentCellSnapshot[];
  readonly storageItemIds: readonly string[];
}): string {
  return sha256Canonical(currentStateDataDigest(input));
}

export function serializeCurrentStateReceipt(current: Omit<BoundCurrentState, 'fileSha256'>): string {
  return `${JSON.stringify({
    schemaVersion: current.schemaVersion,
    kind: current.kind,
    instanceId: current.instanceId,
    queriedAt: current.queriedAt,
    source: current.source,
    stateBuildingIds: current.stateBuildingIds,
    cells: current.cells,
    storageItemIds: current.storageItemIds,
    dataSha256: current.dataSha256,
  }, null, 2)}\n`;
}

export function bindCurrentState(input: {
  readonly instanceId?: string;
  readonly queriedAt?: string;
  readonly stateBuildingIds?: readonly string[];
  readonly cells?: readonly CurrentCellSnapshot[];
  readonly storageItemIds?: readonly string[];
} = {}): BoundCurrentState {
  const instanceId = input.instanceId ?? TARGET_INSTANCE_ID;
  const queriedAt = input.queriedAt ?? CURRENT_STATE_MIN_QUERIED_AT;
  const stateBuildingIds = input.stateBuildingIds ?? [];
  const cells = input.cells ?? [];
  const storageItemIds = input.storageItemIds ?? [];
  const dataSha256 = hashCurrentStateData({
    instanceId,
    stateBuildingIds,
    cells,
    storageItemIds,
  });
  const current: Omit<BoundCurrentState, 'fileSha256'> = {
    schemaVersion: 1,
    kind: CURRENT_STATE_KIND,
    instanceId,
    queriedAt,
    source: CURRENT_STATE_SOURCE,
    stateBuildingIds,
    cells,
    storageItemIds,
    dataSha256,
  };
  return {
    ...current,
    fileSha256: sha256Utf8(serializeCurrentStateReceipt(current)),
  };
}

function failParse(code: CurrentStateErrorCode, message: string): CurrentStateParseResult {
  return { ok: false, error: { code, message } };
}

function parseStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return undefined;
  }
  return value;
}

function parseCell(value: unknown): CurrentCellSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.instanceId !== 'string' || typeof value.buildingId !== 'string') {
    return undefined;
  }
  if (typeof value.tileIndex !== 'number' || !Number.isInteger(value.tileIndex)) {
    return undefined;
  }
  if (typeof value.x !== 'number' || !Number.isInteger(value.x)) {
    return undefined;
  }
  if (typeof value.y !== 'number' || !Number.isInteger(value.y)) {
    return undefined;
  }
  return {
    instanceId: value.instanceId,
    buildingId: value.buildingId,
    tileIndex: value.tileIndex,
    x: value.x,
    y: value.y,
  };
}

function parseCells(value: unknown): readonly CurrentCellSnapshot[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const cells: CurrentCellSnapshot[] = [];
  for (const item of value) {
    const cell = parseCell(item);
    if (!cell) {
      return undefined;
    }
    cells.push(cell);
  }
  return cells;
}

function parseQueriedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !QUERIED_AT_RE.test(value)) {
    return undefined;
  }
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) {
    return undefined;
  }
  return value;
}

export function parseCurrentStateReceipt(rawText: string, expectedFileSha256: string): CurrentStateParseResult {
  const fileSha256 = sha256Utf8(rawText);
  if (fileSha256 !== expectedFileSha256) {
    return failParse('current_state_checksum_mismatch', 'current-state file SHA-256 does not match --current-state-sha256');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return failParse('current_state_malformed', 'current-state JSON is not parseable');
  }
  if (!isRecord(parsed)) {
    return failParse('current_state_malformed', 'current-state JSON must be an object');
  }
  if (parsed.schemaVersion !== CURRENT_STATE_SCHEMA_VERSION || parsed.kind !== CURRENT_STATE_KIND) {
    return failParse('current_state_malformed', 'current-state schemaVersion/kind is not supported');
  }
  if (parsed.source !== CURRENT_STATE_SOURCE) {
    return failParse('current_state_malformed', 'current-state source must be gm-readonly-sql');
  }
  if (typeof parsed.instanceId !== 'string') {
    return failParse('current_state_malformed', 'current-state instanceId must be a string');
  }
  if (parsed.instanceId !== TARGET_INSTANCE_ID) {
    return failParse('current_state_instance_mismatch', 'current-state instanceId is not the recovery target');
  }
  const queriedAt = parseQueriedAt(parsed.queriedAt);
  if (!queriedAt) {
    return failParse('current_state_malformed', 'current-state queriedAt must be RFC3339 UTC');
  }
  if (Date.parse(queriedAt) < Date.parse(CURRENT_STATE_MIN_QUERIED_AT)) {
    return failParse('current_state_stale', `current-state queriedAt is older than ${CURRENT_STATE_MIN_QUERIED_AT}`);
  }
  const stateBuildingIds = parseStringArray(parsed.stateBuildingIds);
  const storageItemIds = parseStringArray(parsed.storageItemIds);
  const cells = parseCells(parsed.cells);
  if (!stateBuildingIds || !storageItemIds || !cells) {
    return failParse('current_state_malformed', 'current-state arrays do not match schema');
  }
  if (typeof parsed.dataSha256 !== 'string') {
    return failParse('current_state_malformed', 'current-state dataSha256 must be a string');
  }
  const dataSha256 = hashCurrentStateData({
    instanceId: parsed.instanceId,
    stateBuildingIds,
    cells,
    storageItemIds,
  });
  if (dataSha256 !== parsed.dataSha256) {
    return failParse('current_state_checksum_mismatch', 'current-state dataSha256 does not match canonical data');
  }
  return {
    ok: true,
    current: {
      schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
      kind: CURRENT_STATE_KIND,
      instanceId: parsed.instanceId,
      queriedAt,
      source: CURRENT_STATE_SOURCE,
      stateBuildingIds,
      cells,
      storageItemIds,
      dataSha256,
      fileSha256,
    },
  };
}
