import { Pool } from 'pg';
import {
  SHENXING_COOLDOWN_BUFF_ID,
  SHENXING_COOLDOWN_SOURCE_SKILL_ID,
  SHENXING_PILL_TIERS,
} from '@mud/shared';

import { resolveServerDatabaseUrl } from '../config/env-alias';
import { DatabasePoolProvider } from '../persistence/database-pool.provider';
import { DurableOperationService } from '../persistence/durable-operation.service';
import { PlayerDomainPersistenceService } from '../persistence/player-domain-persistence.service';
import { buildSnapshot } from './player-domain-persistence-smoke-support/fixtures';
import { installSmokeTimeout } from './smoke-timeout';

installSmokeTimeout(__filename);

const databaseUrl = resolveServerDatabaseUrl();

async function main(): Promise<void> {
  if (!databaseUrl.trim()) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'SERVER_DATABASE_URL/DATABASE_URL missing',
      answers: 'with-db 下驗證地圖解鎖、復活點綁定與神行傳送會把來源狀態、背包、位置、共享冷卻、watermark、outbox 和雙資產審計放進同一事務。',
      excludes: '当前无数据库，不证明真实事务、CAS 回滚或幂等重放。',
    }, null, 2));
    return;
  }

  const now = Date.now();
  const playerId = `itemuse_${now.toString(36)}`;
  const runtimeOwnerId = `runtime:${playerId}:1`;
  const mapOperationId = `op:${playerId}:map-unlock`;
  const respawnOperationId = `op:${playerId}:respawn-bind`;
  const shenxingOperationId = `op:${playerId}:shenxing`;
  const mapItemInstanceId = '00000000-0000-4000-8000-000000000051';
  const respawnItemInstanceId = '00000000-0000-4000-8000-000000000052';
  const shenxingItemInstanceId = '00000000-0000-4000-8000-000000000053';
  const provider = new DatabasePoolProvider();
  const durable = new DurableOperationService({ getNodeId: () => 'node:player-item-use-smoke' } as never, provider);
  const playerPersistence = new PlayerDomainPersistenceService(null, provider, null);
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await durable.onModuleInit();
    await playerPersistence.onModuleInit();
    await cleanup(pool, playerId);
    await playerPersistence.savePlayerPresence(playerId, {
      online: true,
      inWorld: true,
      runtimeOwnerId,
      sessionEpoch: 7,
      lastHeartbeatAt: now,
      offlineSinceAt: null,
      versionSeed: now,
    });
    const snapshot = buildSnapshot(now + 1);
    snapshot.respawn = {
      templateId: 'yunlai_town',
      instanceId: 'public:yunlai_town',
      x: 32,
      y: 5,
      facing: snapshot.placement.facing,
    };
    snapshot.unlockedMapIds = ['yunlai_town'];
    snapshot.inventory = {
      revision: 1,
      capacity: 20,
      items: [
        { itemId: 'map_scroll', count: 1, itemInstanceId: mapItemInstanceId },
        { itemId: 'respawn_stone', count: 1, itemInstanceId: respawnItemInstanceId },
        { itemId: SHENXING_PILL_TIERS[0].itemId, count: 1, itemInstanceId: shenxingItemInstanceId },
      ],
      lockedItems: [],
    };
    await playerPersistence.savePlayerSnapshotProjectionDomains(
      playerId,
      snapshot,
      ['world_anchor', 'position_checkpoint', 'buff', 'map_unlock', 'inventory'],
      {
        allowInventoryEmptyOverwrite: true,
        expectedRuntimeOwnerId: runtimeOwnerId,
        expectedSessionEpoch: 7,
        expectedProjectionVersion: now + 1,
      },
    );

    let unsafeEmptyOverwriteRejected = false;
    try {
      await durable.grantInventoryItems({
        operationId: `${mapOperationId}:unsafe-empty`,
        playerId,
        expectedRuntimeOwnerId: runtimeOwnerId,
        expectedSessionEpoch: 7,
        sourceType: 'item_map_unlock',
        sourceRefId: mapItemInstanceId,
        inventoryAction: 'remove',
        grantedItems: [durableInventoryItem('map_scroll', mapItemInstanceId)],
        nextInventoryItems: [],
        sourceMutation: {
          kind: 'player_item_use',
          action: 'unlock_maps',
          playerId,
          expectedUnlockedMapIds: ['yunlai_town'],
          unlockMapIds: ['cloud_peak'],
        },
      });
    } catch (error) {
      unsafeEmptyOverwriteRejected = error instanceof Error
        && error.message.includes('player_item_use_empty_inventory_snapshot_changed');
    }
    if (!unsafeEmptyOverwriteRejected) {
      throw new Error('expected unsafe empty inventory overwrite rejection');
    }
    await assertInventory(pool, playerId, ['map_scroll', 'respawn_stone', SHENXING_PILL_TIERS[0].itemId]);

    const respawnInventory = [
      durableInventoryItem('respawn_stone', respawnItemInstanceId),
      durableInventoryItem(SHENXING_PILL_TIERS[0].itemId, shenxingItemInstanceId),
    ];
    const mapResult = await durable.grantInventoryItems({
      operationId: mapOperationId,
      playerId,
      expectedRuntimeOwnerId: runtimeOwnerId,
      expectedSessionEpoch: 7,
      sourceType: 'item_map_unlock',
      sourceRefId: mapItemInstanceId,
      inventoryAction: 'remove',
      grantedItems: [durableInventoryItem('map_scroll', mapItemInstanceId)],
      nextInventoryItems: respawnInventory,
      sourceMutation: {
        kind: 'player_item_use',
        action: 'unlock_maps',
        playerId,
        expectedUnlockedMapIds: ['yunlai_town'],
        unlockMapIds: ['bamboo_forest'],
      },
    });
    const mapReplay = await durable.grantInventoryItems({
      operationId: mapOperationId,
      playerId,
      expectedRuntimeOwnerId: runtimeOwnerId,
      expectedSessionEpoch: 7,
      sourceType: 'item_map_unlock',
      sourceRefId: mapItemInstanceId,
      inventoryAction: 'remove',
      grantedItems: [durableInventoryItem('map_scroll', mapItemInstanceId)],
      nextInventoryItems: respawnInventory,
      sourceMutation: {
        kind: 'player_item_use',
        action: 'unlock_maps',
        playerId,
        expectedUnlockedMapIds: ['yunlai_town'],
        unlockMapIds: ['bamboo_forest'],
      },
    });
    if (!mapResult.ok || mapResult.alreadyCommitted || !mapReplay.alreadyCommitted) {
      throw new Error(`unexpected map unlock durable replay: ${JSON.stringify({ mapResult, mapReplay })}`);
    }

    let staleMapRejected = false;
    try {
      await durable.grantInventoryItems({
        operationId: `${mapOperationId}:stale`,
        playerId,
        expectedRuntimeOwnerId: runtimeOwnerId,
        expectedSessionEpoch: 7,
        sourceType: 'item_map_unlock',
        sourceRefId: respawnItemInstanceId,
        inventoryAction: 'remove',
        grantedItems: [durableInventoryItem('respawn_stone', respawnItemInstanceId)],
        nextInventoryItems: [durableInventoryItem(SHENXING_PILL_TIERS[0].itemId, shenxingItemInstanceId)],
        sourceMutation: {
          kind: 'player_item_use',
          action: 'unlock_maps',
          playerId,
          expectedUnlockedMapIds: ['yunlai_town'],
          unlockMapIds: ['cloud_peak'],
        },
      });
    } catch (error) {
      staleMapRejected = error instanceof Error && error.message.includes('player_map_unlock_snapshot_changed');
    }
    if (!staleMapRejected) {
      throw new Error('expected stale map unlock snapshot rejection');
    }
    await assertInventory(pool, playerId, ['respawn_stone', SHENXING_PILL_TIERS[0].itemId]);

    const expectedRespawn = {
      templateId: 'yunlai_town',
      instanceId: 'public:yunlai_town',
      x: 32,
      y: 5,
    };
    const nextRespawn = {
      templateId: 'qizhen_crossing',
      instanceId: 'public:qizhen_crossing',
      x: 29,
      y: 15,
    };
    const respawnResult = await durable.grantInventoryItems({
      operationId: respawnOperationId,
      playerId,
      expectedRuntimeOwnerId: runtimeOwnerId,
      expectedSessionEpoch: 7,
      sourceType: 'item_respawn_bind',
      sourceRefId: respawnItemInstanceId,
      inventoryAction: 'remove',
      grantedItems: [durableInventoryItem('respawn_stone', respawnItemInstanceId)],
      nextInventoryItems: [durableInventoryItem(SHENXING_PILL_TIERS[0].itemId, shenxingItemInstanceId)],
      sourceMutation: {
        kind: 'player_item_use',
        action: 'bind_respawn',
        playerId,
        expectedRespawn,
        nextRespawn,
      },
    });
    if (!respawnResult.ok || respawnResult.alreadyCommitted) {
      throw new Error(`unexpected respawn bind result: ${JSON.stringify(respawnResult)}`);
    }
    await assertInventory(pool, playerId, [SHENXING_PILL_TIERS[0].itemId]);

    const shenxingTier = SHENXING_PILL_TIERS[0];
    const shenxingMutation = {
      kind: 'player_item_use' as const,
      action: 'shenxing_travel' as const,
      playerId,
      expectedPlacement: { ...snapshot.placement },
      nextPlacement: {
        templateId: 'bamboo_forest',
        instanceId: 'public:bamboo_forest',
        x: 7,
        y: 9,
        facing: snapshot.placement.facing,
      },
      cooldownBuff: {
        buffId: SHENXING_COOLDOWN_BUFF_ID,
        sourceSkillId: SHENXING_COOLDOWN_SOURCE_SKILL_ID,
        realmLv: 1,
        remainingTicks: shenxingTier.cooldownTicks + 1,
        duration: shenxingTier.cooldownTicks,
        stacks: 1 as const,
        maxStacks: 1 as const,
        rawPayload: {
          buffId: SHENXING_COOLDOWN_BUFF_ID,
          sourceSkillId: SHENXING_COOLDOWN_SOURCE_SKILL_ID,
          realmLv: 1,
          remainingTicks: shenxingTier.cooldownTicks + 1,
          duration: shenxingTier.cooldownTicks,
          stacks: 1,
          maxStacks: 1,
          cooldownExpiresAtMs: now + shenxingTier.cooldownTicks * 1000,
        },
      },
    };
    const shenxingInput = {
      operationId: shenxingOperationId,
      playerId,
      expectedRuntimeOwnerId: runtimeOwnerId,
      expectedSessionEpoch: 7,
      sourceType: 'item_shenxing_travel',
      sourceRefId: `${shenxingTier.itemId}:${shenxingItemInstanceId}`,
      inventoryAction: 'remove' as const,
      grantedItems: [durableInventoryItem(shenxingTier.itemId, shenxingItemInstanceId)],
      nextInventoryItems: [],
      sourceMutation: shenxingMutation,
    };
    let stalePlacementRejected = false;
    try {
      await durable.grantInventoryItems({
        ...shenxingInput,
        operationId: `${shenxingOperationId}:stale`,
        sourceMutation: {
          ...shenxingMutation,
          expectedPlacement: { ...snapshot.placement, x: snapshot.placement.x + 1 },
        },
      });
    } catch (error) {
      stalePlacementRejected = error instanceof Error
        && error.message.includes('player_shenxing_placement_snapshot_changed');
    }
    if (!stalePlacementRejected) {
      throw new Error('expected stale shenxing placement rejection');
    }
    await assertInventory(pool, playerId, [SHENXING_PILL_TIERS[0].itemId]);
    const rejectedCooldown = await queryRows(pool,
      'SELECT buff_id FROM player_persistent_buff_state WHERE player_id = $1 AND buff_id = $2',
      [playerId, SHENXING_COOLDOWN_BUFF_ID]);
    if (rejectedCooldown.length !== 0) {
      throw new Error('rejected shenxing placement must not persist a cooldown');
    }
    const shenxingResult = await durable.grantInventoryItems(shenxingInput);
    const shenxingReplay = await durable.grantInventoryItems(shenxingInput);
    if (!shenxingResult.ok || shenxingResult.alreadyCommitted || !shenxingReplay.alreadyCommitted) {
      throw new Error(`unexpected shenxing durable replay: ${JSON.stringify({ shenxingResult, shenxingReplay })}`);
    }
    await assertInventory(pool, playerId, []);

    const mapRows = await queryRows(pool, 'SELECT map_id FROM player_map_unlock WHERE player_id = $1 ORDER BY map_id ASC', [playerId]);
    const anchor = (await queryRows(
      pool,
      `SELECT respawn_template_id, respawn_instance_id, respawn_x, respawn_y,
              last_safe_template_id, last_safe_instance_id, last_safe_x, last_safe_y
         FROM player_world_anchor WHERE player_id = $1`,
      [playerId],
    ))[0];
    const watermark = (await queryRows(
      pool,
      'SELECT inventory_version, map_unlock_version, anchor_version, position_checkpoint_version, buff_version FROM player_recovery_watermark WHERE player_id = $1',
      [playerId],
    ))[0];
    const checkpoint = (await queryRows(
      pool,
      'SELECT instance_id, x, y, facing, checkpoint_kind FROM player_position_checkpoint WHERE player_id = $1',
      [playerId],
    ))[0];
    const cooldownBuff = (await queryRows(
      pool,
      `SELECT buff_id, source_skill_id, remaining_ticks, duration, stacks, max_stacks, raw_payload
         FROM player_persistent_buff_state
        WHERE player_id = $1 AND buff_id = $2`,
      [playerId, SHENXING_COOLDOWN_BUFF_ID],
    ))[0];
    const auditRows = await queryRows(
      pool,
      'SELECT operation_id, asset_type FROM asset_audit_log WHERE player_id = $1 ORDER BY operation_id, asset_type',
      [playerId],
    );
    if (JSON.stringify(mapRows.map((row) => row.map_id)) !== JSON.stringify(['bamboo_forest', 'yunlai_town'])) {
      throw new Error(`unexpected map unlock rows: ${JSON.stringify(mapRows)}`);
    }
    if (
      anchor?.respawn_template_id !== nextRespawn.templateId
      || anchor?.respawn_instance_id !== nextRespawn.instanceId
      || Number(anchor?.respawn_x) !== nextRespawn.x
      || Number(anchor?.respawn_y) !== nextRespawn.y
      || anchor?.last_safe_template_id !== shenxingMutation.nextPlacement.templateId
      || anchor?.last_safe_instance_id !== shenxingMutation.nextPlacement.instanceId
      || Number(anchor?.last_safe_x) !== shenxingMutation.nextPlacement.x
      || Number(anchor?.last_safe_y) !== shenxingMutation.nextPlacement.y
    ) {
      throw new Error(`unexpected respawn anchor row: ${JSON.stringify(anchor)}`);
    }
    if (
      checkpoint?.instance_id !== shenxingMutation.nextPlacement.instanceId
      || Number(checkpoint?.x) !== shenxingMutation.nextPlacement.x
      || Number(checkpoint?.y) !== shenxingMutation.nextPlacement.y
      || Number(checkpoint?.facing) !== shenxingMutation.nextPlacement.facing
      || checkpoint?.checkpoint_kind !== 'shenxing'
    ) {
      throw new Error(`unexpected shenxing checkpoint row: ${JSON.stringify(checkpoint)}`);
    }
    if (
      cooldownBuff?.buff_id !== SHENXING_COOLDOWN_BUFF_ID
      || cooldownBuff?.source_skill_id !== SHENXING_COOLDOWN_SOURCE_SKILL_ID
      || Number(cooldownBuff?.remaining_ticks) !== shenxingTier.cooldownTicks + 1
      || Number(cooldownBuff?.duration) !== shenxingTier.cooldownTicks
      || Number(cooldownBuff?.stacks) !== 1
      || Number(cooldownBuff?.max_stacks) !== 1
      || Number(cooldownBuff?.raw_payload?.cooldownExpiresAtMs) !== now + shenxingTier.cooldownTicks * 1000
    ) {
      throw new Error(`unexpected shenxing cooldown row: ${JSON.stringify(cooldownBuff)}`);
    }
    const outboxRows = await queryRows(pool,
      'SELECT operation_id FROM outbox_event WHERE partition_key = $1 ORDER BY operation_id', [playerId]);
    if (
      Number(watermark?.inventory_version) <= 0
      || Number(watermark?.map_unlock_version) <= 0
      || Number(watermark?.anchor_version) <= 0
      || Number(watermark?.position_checkpoint_version) <= 0
      || Number(watermark?.buff_version) <= 0
      || auditRows.filter((row) => row.asset_type === 'inventory').length !== 3
      || auditRows.filter((row) => row.asset_type === 'player_item_use').length !== 3
      || outboxRows.length !== 3
    ) {
      throw new Error(`unexpected durable item-use metadata: watermark=${JSON.stringify(watermark)} audit=${JSON.stringify(auditRows)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      case: 'player-item-use-durable',
      answers: '真实 PostgreSQL 已证明地图解锁、复活点绑定与神行传送会把来源 CAS、背包、位置、last-safe、共享冷却、watermark、outbox 和双资产审计同事务提交；精确重放不重复。',
      excludes: '不证明客户端网络断线、真实 tick 并发或功法书重复残卷产品语义。',
      mapResult,
      mapReplay,
      respawnResult,
      shenxingResult,
      shenxingReplay,
    }, null, 2));
  } finally {
    await cleanup(pool, playerId).catch(() => undefined);
    await playerPersistence.onModuleDestroy().catch(() => undefined);
    await durable.onModuleDestroy().catch(() => undefined);
    await provider.onModuleDestroy().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

function durableInventoryItem(itemId: string, itemInstanceId: string) {
  return { itemId, count: 1, itemInstanceId, rawPayload: {} };
}

async function assertInventory(pool: Pool, playerId: string, expectedItemIds: string[]): Promise<void> {
  const rows = await queryRows(
    pool,
    'SELECT item_id FROM player_inventory_item WHERE player_id = $1 ORDER BY slot_index ASC',
    [playerId],
  );
  const actual = rows.map((row) => String(row.item_id));
  if (JSON.stringify(actual) !== JSON.stringify(expectedItemIds)) {
    throw new Error(`unexpected player inventory: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expectedItemIds)}`);
  }
}

async function cleanup(pool: Pool, playerId: string): Promise<void> {
  await pool.query('DELETE FROM durable_operation_log WHERE player_id = $1', [playerId]).catch(() => undefined);
  await pool.query('DELETE FROM outbox_event WHERE partition_key = $1', [playerId]).catch(() => undefined);
  await pool.query('DELETE FROM asset_audit_log WHERE player_id = $1', [playerId]).catch(() => undefined);
  await pool.query('DELETE FROM player_inventory_item WHERE player_id = $1', [playerId]).catch(() => undefined);
  await pool.query('DELETE FROM player_map_unlock WHERE player_id = $1', [playerId]).catch(() => undefined);
  await pool.query('DELETE FROM player_world_anchor WHERE player_id = $1', [playerId]).catch(() => undefined);
  await pool.query('DELETE FROM player_position_checkpoint WHERE player_id = $1', [playerId]).catch(() => undefined);
  await pool.query('DELETE FROM player_persistent_buff_state WHERE player_id = $1', [playerId]).catch(() => undefined);
  await pool.query('DELETE FROM player_recovery_watermark WHERE player_id = $1', [playerId]).catch(() => undefined);
  await pool.query('DELETE FROM player_presence WHERE player_id = $1', [playerId]).catch(() => undefined);
}

async function queryRows(pool: Pool, sql: string, params: readonly unknown[]) {
  const result = await pool.query(sql, [...params]);
  return Array.isArray(result.rows) ? result.rows : [];
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
