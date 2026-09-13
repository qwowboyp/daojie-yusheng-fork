import type { PoolClient } from 'pg';
import { SHENXING_COOLDOWN_BUFF_ID, SHENXING_COOLDOWN_SOURCE_SKILL_ID } from '@mud/shared';

const PLAYER_MAP_UNLOCK_TABLE = 'player_map_unlock';
const PLAYER_WORLD_ANCHOR_TABLE = 'player_world_anchor';
const PLAYER_POSITION_CHECKPOINT_TABLE = 'player_position_checkpoint';
const PLAYER_PERSISTENT_BUFF_STATE_TABLE = 'player_persistent_buff_state';
const PLAYER_RECOVERY_WATERMARK_TABLE = 'player_recovery_watermark';

interface RespawnPointSnapshot {
  templateId: string;
  instanceId: string | null;
  x: number;
  y: number;
}

interface PlayerPlacementSnapshot {
  templateId: string;
  instanceId: string;
  x: number;
  y: number;
  facing: number;
}

interface PersistentCooldownBuffSnapshot {
  buffId: string;
  sourceSkillId: string;
  realmLv: number;
  remainingTicks: number;
  duration: number;
  stacks: 1;
  maxStacks: 1;
  rawPayload: Record<string, unknown>;
}

export type DurablePlayerItemUseSourceMutation =
  | {
      kind: 'player_item_use';
      action: 'unlock_maps';
      playerId: string;
      expectedUnlockedMapIds: string[];
      unlockMapIds: string[];
    }
  | {
      kind: 'player_item_use';
      action: 'bind_respawn';
      playerId: string;
      expectedRespawn: RespawnPointSnapshot;
      nextRespawn: RespawnPointSnapshot;
    }
  | {
      kind: 'player_item_use';
      action: 'shenxing_travel';
      playerId: string;
      expectedPlacement: PlayerPlacementSnapshot;
      nextPlacement: PlayerPlacementSnapshot;
      cooldownBuff: PersistentCooldownBuffSnapshot;
    };

export function normalizeDurablePlayerItemUseSourceMutation(
  value: unknown,
): DurablePlayerItemUseSourceMutation | null {
  if (!isRecord(value) || value.kind !== 'player_item_use') {
    return null;
  }
  const playerId = normalizeRequiredString(value.playerId);
  if (!playerId) {
    return null;
  }
  if (value.action === 'unlock_maps') {
    const expectedUnlockedMapIds = normalizeStringSet(value.expectedUnlockedMapIds);
    const unlockMapIds = normalizeStringSet(value.unlockMapIds);
    if (
      unlockMapIds.length === 0
      || unlockMapIds.some((mapId) => expectedUnlockedMapIds.includes(mapId))
    ) {
      return null;
    }
    return {
      kind: 'player_item_use',
      action: 'unlock_maps',
      playerId,
      expectedUnlockedMapIds,
      unlockMapIds,
    };
  }
  if (value.action === 'bind_respawn') {
    const expectedRespawn = normalizeRespawnPoint(value.expectedRespawn);
    const nextRespawn = normalizeRespawnPoint(value.nextRespawn);
    if (!expectedRespawn || !nextRespawn || isSameRespawnPoint(expectedRespawn, nextRespawn)) {
      return null;
    }
    return {
      kind: 'player_item_use',
      action: 'bind_respawn',
      playerId,
      expectedRespawn,
      nextRespawn,
    };
  }
  if (value.action === 'shenxing_travel') {
    const expectedPlacement = normalizePlacement(value.expectedPlacement);
    const nextPlacement = normalizePlacement(value.nextPlacement);
    const cooldownBuff = normalizeCooldownBuff(value.cooldownBuff);
    if (!expectedPlacement || !nextPlacement || !cooldownBuff || isSamePlacement(expectedPlacement, nextPlacement)) {
      return null;
    }
    return {
      kind: 'player_item_use',
      action: 'shenxing_travel',
      playerId,
      expectedPlacement,
      nextPlacement,
      cooldownBuff,
    };
  }
  return null;
}

export async function persistDurablePlayerItemUseSourceMutation(
  client: PoolClient,
  mutation: DurablePlayerItemUseSourceMutation,
  persistenceVersion: number,
): Promise<void> {
  if (mutation.action === 'unlock_maps') {
    await persistMapUnlockMutation(client, mutation, persistenceVersion);
    return;
  }
  if (mutation.action === 'shenxing_travel') {
    await persistShenxingTravelMutation(client, mutation, persistenceVersion);
    return;
  }
  await persistRespawnBindMutation(client, mutation, persistenceVersion);
}

async function persistShenxingTravelMutation(
  client: PoolClient,
  mutation: Extract<DurablePlayerItemUseSourceMutation, { action: 'shenxing_travel' }>,
  persistenceVersion: number,
): Promise<void> {
  const checkpoint = await client.query<{
    instance_id?: unknown;
    x?: unknown;
    y?: unknown;
    facing?: unknown;
  }>(
    `SELECT instance_id, x, y, facing
       FROM ${PLAYER_POSITION_CHECKPOINT_TABLE}
      WHERE player_id = $1
      FOR UPDATE`,
    [mutation.playerId],
  );
  const currentPlacement = normalizePlacement({
    templateId: mutation.expectedPlacement.templateId,
    instanceId: checkpoint.rows[0]?.instance_id,
    x: checkpoint.rows[0]?.x,
    y: checkpoint.rows[0]?.y,
    facing: checkpoint.rows[0]?.facing,
  });
  // 同一 session fence 下，普通移動可能尚未把座標 checkpoint 刷盤；跨圖實例不可漂移。
  if (!currentPlacement || currentPlacement.instanceId !== mutation.expectedPlacement.instanceId) {
    throw new Error('player_shenxing_placement_snapshot_changed');
  }
  const updatedCheckpoint = await client.query(
    `UPDATE ${PLAYER_POSITION_CHECKPOINT_TABLE}
        SET instance_id = $2,
            x = $3,
            y = $4,
            facing = $5,
            checkpoint_kind = 'shenxing',
            updated_at = now()
      WHERE player_id = $1`,
    [
      mutation.playerId,
      mutation.nextPlacement.instanceId,
      mutation.nextPlacement.x,
      mutation.nextPlacement.y,
      mutation.nextPlacement.facing,
    ],
  );
  if ((updatedCheckpoint.rowCount ?? 0) !== 1) {
    throw new Error('player_position_checkpoint_missing');
  }
  const updatedAnchor = await client.query(
    `UPDATE ${PLAYER_WORLD_ANCHOR_TABLE}
        SET last_safe_template_id = $2,
            last_safe_instance_id = $3,
            last_safe_x = $4,
            last_safe_y = $5,
            last_transfer_at = $6,
            updated_at = now()
      WHERE player_id = $1`,
    [
      mutation.playerId,
      mutation.nextPlacement.templateId,
      mutation.nextPlacement.instanceId,
      mutation.nextPlacement.x,
      mutation.nextPlacement.y,
      persistenceVersion,
    ],
  );
  if ((updatedAnchor.rowCount ?? 0) !== 1) {
    throw new Error('player_world_anchor_missing');
  }
  const cooldown = mutation.cooldownBuff;
  await client.query(
    `INSERT INTO ${PLAYER_PERSISTENT_BUFF_STATE_TABLE}(
       player_id, buff_id, source_skill_id, source_caster_id, realm_lv,
       remaining_ticks, duration, stacks, max_stacks, sustain_ticks_elapsed,
       raw_payload, updated_at
     ) VALUES ($1, $2, $3, NULL, $4, $5, $6, 1, 1, NULL, $7::jsonb, now())
     ON CONFLICT (player_id, buff_id, source_skill_id)
     DO UPDATE SET
       source_caster_id = NULL,
       realm_lv = EXCLUDED.realm_lv,
       remaining_ticks = EXCLUDED.remaining_ticks,
       duration = EXCLUDED.duration,
       stacks = 1,
       max_stacks = 1,
       sustain_ticks_elapsed = NULL,
       raw_payload = EXCLUDED.raw_payload,
       updated_at = now()`,
    [
      mutation.playerId,
      cooldown.buffId,
      cooldown.sourceSkillId,
      cooldown.realmLv,
      cooldown.remainingTicks,
      cooldown.duration,
      JSON.stringify(cooldown.rawPayload),
    ],
  );
  await upsertShenxingWatermarks(client, mutation.playerId, persistenceVersion);
}

async function persistMapUnlockMutation(
  client: PoolClient,
  mutation: Extract<DurablePlayerItemUseSourceMutation, { action: 'unlock_maps' }>,
  persistenceVersion: number,
): Promise<void> {
  const current = await client.query<{ map_id?: unknown }>(
    `SELECT map_id
       FROM ${PLAYER_MAP_UNLOCK_TABLE}
      WHERE player_id = $1
      ORDER BY map_id ASC
      FOR UPDATE`,
    [mutation.playerId],
  );
  const currentMapIds = normalizeStringSet(current.rows.map((row) => row.map_id));
  if (!isSameStringList(currentMapIds, mutation.expectedUnlockedMapIds)) {
    throw new Error('player_map_unlock_snapshot_changed');
  }
  await client.query(
    `INSERT INTO ${PLAYER_MAP_UNLOCK_TABLE}(player_id, map_id, unlocked_at, updated_at)
     SELECT $1, map_id, $3, now()
       FROM unnest($2::varchar[]) AS map_id
     ON CONFLICT (player_id, map_id) DO NOTHING`,
    [mutation.playerId, mutation.unlockMapIds, persistenceVersion],
  );
  await upsertPlayerItemUseWatermark(client, mutation.playerId, 'map_unlock_version', persistenceVersion);
}

async function persistRespawnBindMutation(
  client: PoolClient,
  mutation: Extract<DurablePlayerItemUseSourceMutation, { action: 'bind_respawn' }>,
  persistenceVersion: number,
): Promise<void> {
  const current = await client.query<{
    respawn_template_id?: unknown;
    respawn_instance_id?: unknown;
    respawn_x?: unknown;
    respawn_y?: unknown;
  }>(
    `SELECT respawn_template_id, respawn_instance_id, respawn_x, respawn_y
       FROM ${PLAYER_WORLD_ANCHOR_TABLE}
      WHERE player_id = $1
      FOR UPDATE`,
    [mutation.playerId],
  );
  const currentRespawn = normalizeRespawnPoint({
    templateId: current.rows[0]?.respawn_template_id,
    instanceId: current.rows[0]?.respawn_instance_id,
    x: current.rows[0]?.respawn_x,
    y: current.rows[0]?.respawn_y,
  });
  if (!currentRespawn || !isSameRespawnPoint(currentRespawn, mutation.expectedRespawn)) {
    throw new Error('player_respawn_snapshot_changed');
  }
  const updated = await client.query(
    `UPDATE ${PLAYER_WORLD_ANCHOR_TABLE}
        SET respawn_template_id = $2,
            respawn_instance_id = $3,
            respawn_x = $4,
            respawn_y = $5,
            updated_at = now()
      WHERE player_id = $1`,
    [
      mutation.playerId,
      mutation.nextRespawn.templateId,
      mutation.nextRespawn.instanceId,
      mutation.nextRespawn.x,
      mutation.nextRespawn.y,
    ],
  );
  if ((updated.rowCount ?? 0) !== 1) {
    throw new Error('player_world_anchor_missing');
  }
  await upsertPlayerItemUseWatermark(client, mutation.playerId, 'anchor_version', persistenceVersion);
}

async function upsertPlayerItemUseWatermark(
  client: PoolClient,
  playerId: string,
  column: 'map_unlock_version' | 'anchor_version',
  persistenceVersion: number,
): Promise<void> {
  await client.query(
    `INSERT INTO ${PLAYER_RECOVERY_WATERMARK_TABLE}(player_id, ${column}, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (player_id)
     DO UPDATE SET
       ${column} = GREATEST(${PLAYER_RECOVERY_WATERMARK_TABLE}.${column}, EXCLUDED.${column}),
       updated_at = now()`,
    [playerId, persistenceVersion],
  );
}

async function upsertShenxingWatermarks(
  client: PoolClient,
  playerId: string,
  persistenceVersion: number,
): Promise<void> {
  await client.query(
    `INSERT INTO ${PLAYER_RECOVERY_WATERMARK_TABLE}(
       player_id, anchor_version, position_checkpoint_version, buff_version, updated_at
     ) VALUES ($1, $2, $2, $2, now())
     ON CONFLICT (player_id)
     DO UPDATE SET
       anchor_version = GREATEST(${PLAYER_RECOVERY_WATERMARK_TABLE}.anchor_version, EXCLUDED.anchor_version),
       position_checkpoint_version = GREATEST(${PLAYER_RECOVERY_WATERMARK_TABLE}.position_checkpoint_version, EXCLUDED.position_checkpoint_version),
       buff_version = GREATEST(${PLAYER_RECOVERY_WATERMARK_TABLE}.buff_version, EXCLUDED.buff_version),
       updated_at = now()`,
    [playerId, persistenceVersion],
  );
}

function normalizeRespawnPoint(value: unknown): RespawnPointSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const templateId = normalizeRequiredString(value.templateId);
  const instanceId = normalizeOptionalString(value.instanceId);
  const x = normalizeInteger(value.x);
  const y = normalizeInteger(value.y);
  return !templateId || x === null || y === null ? null : { templateId, instanceId, x, y };
}

function normalizePlacement(value: unknown): PlayerPlacementSnapshot | null {
  if (!isRecord(value)) return null;
  const templateId = normalizeRequiredString(value.templateId);
  const instanceId = normalizeRequiredString(value.instanceId);
  const x = normalizeInteger(value.x);
  const y = normalizeInteger(value.y);
  const facing = normalizeInteger(value.facing);
  return !templateId || !instanceId || x === null || y === null || facing === null
    ? null
    : { templateId, instanceId, x, y, facing };
}

function normalizeCooldownBuff(value: unknown): PersistentCooldownBuffSnapshot | null {
  if (!isRecord(value)) return null;
  const buffId = normalizeRequiredString(value.buffId);
  const sourceSkillId = normalizeRequiredString(value.sourceSkillId);
  const realmLv = normalizeInteger(value.realmLv);
  const remainingTicks = normalizeInteger(value.remainingTicks);
  const duration = normalizeInteger(value.duration);
  if (buffId !== SHENXING_COOLDOWN_BUFF_ID || sourceSkillId !== SHENXING_COOLDOWN_SOURCE_SKILL_ID
    || realmLv === null || realmLv < 1 || duration === null || duration < 1
    || remainingTicks === null || remainingTicks !== duration + 1) {
    return null;
  }
  const rawPayload = isRecord(value.rawPayload) ? { ...value.rawPayload } : null;
  if (!rawPayload || rawPayload.buffId !== buffId || rawPayload.sourceSkillId !== sourceSkillId) {
    return null;
  }
  return { buffId, sourceSkillId, realmLv, remainingTicks, duration, stacks: 1, maxStacks: 1, rawPayload };
}

function isSamePlacement(left: PlayerPlacementSnapshot, right: PlayerPlacementSnapshot): boolean {
  return left.templateId === right.templateId
    && left.instanceId === right.instanceId
    && left.x === right.x
    && left.y === right.y
    && left.facing === right.facing;
}

function isSameRespawnPoint(left: RespawnPointSnapshot, right: RespawnPointSnapshot): boolean {
  return left.templateId === right.templateId
    && left.instanceId === right.instanceId
    && left.x === right.x
    && left.y === right.y;
}

function normalizeStringSet(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((entry) => normalizeRequiredString(entry)).filter(Boolean))).sort();
}

function isSameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function normalizeRequiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value: unknown): string | null {
  return normalizeRequiredString(value) || null;
}

function normalizeInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
