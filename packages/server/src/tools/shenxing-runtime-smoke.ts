import assert from 'node:assert/strict';
import {
  S2C,
  SHENXING_PILL_TIERS,
  SHENXING_USE_BEHAVIOR,
} from '@mud/shared';
import { MapInstanceRuntime } from '../runtime/instance/map-instance.runtime';
import { WorldRuntimeUseItemService } from '../runtime/world/world-runtime-use-item.service';

const PLAYER_ID = 'player:shenxing-smoke';
const ITEM_INSTANCE_ID = 'item-instance:shenxing-smoke';
const SOURCE_MAP_ID = 'source_town';
const TARGET_MAP_ID = 'foundation_wild';

function createHarness(options: {
  realmLv?: number;
  itemTierIndex?: number;
  cooldownRemainingTicks?: number;
  durableFailure?: boolean;
  durableUnknown?: boolean;
  transferFailure?: boolean;
} = {}) {
  const emitted: Array<[string, Record<string, unknown>]> = [];
  const transfers: Array<Record<string, unknown>> = [];
  const durableInputs: Array<Record<string, any>> = [];
  let disconnected = false;
  let purged = false;
  let sourceAttached = true;
  let sourceReserved = false;
  let targetReserved = false;
  let heldDuringDurable = false;
  const tier = SHENXING_PILL_TIERS[options.itemTierIndex ?? 0];
  const item = {
    itemId: tier.itemId,
    itemInstanceId: ITEM_INSTANCE_ID,
    name: '測試神行丹',
    type: 'consumable',
    count: 2,
    level: tier.minRealmLv,
    useBehavior: SHENXING_USE_BEHAVIOR,
  };
  const player = {
    playerId: PLAYER_ID,
    sessionId: 'session:shenxing-smoke',
    templateId: SOURCE_MAP_ID,
    instanceId: 'public:source_town',
    x: 3,
    y: 4,
    facing: 2,
    realm: { realmLv: options.realmLv ?? 31 },
    inventory: { items: [item] },
    worldPreference: { linePreset: 'peaceful' },
  };
  const templates = [
    { id: SOURCE_MAP_ID, name: '來源城鎮', mapLv: 31, routeDomain: 'system', shenxingCategory: 'town' },
    { id: TARGET_MAP_ID, name: '築基荒野', mapLv: 42, routeDomain: 'system', shenxingCategory: 'wild' },
    { id: 'golden_core_wild', name: '金丹荒野', mapLv: 43, routeDomain: 'system', shenxingCategory: 'wild' },
    { id: 'private_map', name: '私人洞府', mapLv: 1, routeDomain: 'personal', shenxingCategory: 'town' },
    { id: 'test_map', name: '測試地圖', mapLv: 1, routeDomain: 'system' },
  ];
  const templateRepository = {
    listBootstrapTemplates: () => templates,
    has: (mapId: string) => templates.some((entry) => entry.id === mapId),
    getOrThrow: (mapId: string) => templates.find((entry) => entry.id === mapId),
  };
  const playerRuntimeService = {
    playerDomainPersistenceService: {
      isEnabled: () => true,
      loadPlayerPresence: async () => ({ runtimeOwnerId: 'node:smoke', sessionEpoch: 1 }),
      savePlayerPresence: async () => undefined,
    },
    peekInventoryItemByInstanceId: (_playerId: string, instanceId: string) =>
      player.inventory.items.find((entry) => entry.itemInstanceId === instanceId) ?? null,
    getPlayerOrThrow: () => player,
    getPlayer: () => player,
    getConsumableItemCooldownRemainingTicks: () => options.cooldownRemainingTicks ?? 0,
    buildConsumableCooldownBuffSnapshot: () => ({
      buffId: 'system.consumable_cooldown.shenxing',
      sourceSkillId: 'system:consumable-cooldown:shenxing',
      realmLv: 1,
      remainingTicks: tier.cooldownTicks + 1,
      duration: tier.cooldownTicks,
      stacks: 1,
      maxStacks: 1,
      rawPayload: {
        buffId: 'system.consumable_cooldown.shenxing',
        sourceSkillId: 'system:consumable-cooldown:shenxing',
      },
    }),
    runExclusiveAssetMutation: async (_playerIds: string[], action: () => unknown) => await action(),
    getSessionFence: () => ({ runtimeOwnerId: 'node:smoke', sessionEpoch: 1 }),
    describePersistencePresence: () => ({
      runtimeOwnerId: 'node:smoke',
      sessionEpoch: 1,
      online: true,
      inWorld: true,
    }),
    replaceInventoryItems: (_playerId: string, nextItems: typeof player.inventory.items) => {
      player.inventory.items = nextItems;
    },
    markConsumableItemCooldown: () => undefined,
  };
  let committedInput: Record<string, any> | null = null;
  const durableOperationService = {
    isEnabled: () => true,
    getOperationStatus: async (operationId: string) =>
      committedInput?.operationId === operationId ? 'committed' as const : null,
    getOperationReplay: async () => ({
      operation: committedInput ? { payload_jsonb: committedInput } : null,
    }),
    grantInventoryItems: async (input: Record<string, any>) => {
      durableInputs.push(input);
      heldDuringDurable = !sourceAttached;
      if (options.durableFailure) throw new Error('smoke_durable_failure');
      if (options.durableUnknown) {
        const error = new Error('durable_operation_commit_outcome_unknown:smoke');
        error.name = 'DurableOperationCommitOutcomeUnknownError';
        throw error;
      }
      committedInput = input;
      return { ok: true };
    },
  };
  const sourceInstance = {
    meta: { instanceId: 'public:source_town' },
    template: { id: SOURCE_MAP_ID },
    reserveShenxingSpawnPoint: () => {
      sourceReserved = true;
      return { x: 3, y: 4 };
    },
    releaseShenxingSpawnPoint: () => {
      sourceReserved = false;
    },
    disconnectPlayer: () => {
      if (!sourceAttached) return false;
      sourceAttached = false;
      return true;
    },
    connectPlayer: () => {
      sourceAttached = true;
      return { x: 3, y: 4, facing: 2 };
    },
    setPlayerMoveSpeed: () => undefined,
  };
  const targetInstance = {
    meta: { instanceId: 'public:foundation_wild' },
    template: { id: TARGET_MAP_ID },
    reserveShenxingSpawnPoint: () => {
      targetReserved = true;
      return { x: 8, y: 9 };
    },
    releaseShenxingSpawnPoint: () => {
      targetReserved = false;
    },
  };
  const deps = {
    durableOperationService,
    worldSessionService: {
      getSocketByPlayerId: () => ({
        emit: (event: string, payload: Record<string, unknown>) => emitted.push([event, payload]),
        disconnect: () => {
          disconnected = true;
        },
      }),
    },
    worldRuntimePlayerSessionService: {
      removePlayer: () => {
        purged = true;
        sourceAttached = false;
        disconnected = true;
        return true;
      },
    },
    getPlayerLocationOrThrow: () => ({ instanceId: sourceInstance.meta.instanceId, sessionId: player.sessionId }),
    getInstanceRuntime: (instanceId: string) =>
      instanceId === sourceInstance.meta.instanceId ? sourceInstance : targetInstance,
    getOrCreateDefaultLineInstance: (mapId: string) => mapId === TARGET_MAP_ID ? targetInstance : null,
    instanceReadyForPlayerAttach: () => ({ ok: true }),
    worldRuntimeTransferService: {
      applyTransfer: (transfer: Record<string, unknown>) => {
        transfers.push(transfer);
        if (options.transferFailure) return { ok: false, reason: 'placement_unavailable' };
        player.templateId = TARGET_MAP_ID;
        player.instanceId = targetInstance.meta.instanceId;
        player.x = 8;
        player.y = 9;
        return { ok: true, instanceId: targetInstance.meta.instanceId, templateId: TARGET_MAP_ID, x: 8, y: 9, facing: 2 };
      },
    },
    worldRuntimeNavigationService: { handleTransfer: () => undefined },
    clearPendingCommand: () => undefined,
    refreshQuestStates: () => undefined,
  };
  const service = new WorldRuntimeUseItemService(
    { normalizeItem: (entry: unknown) => entry },
    templateRepository,
    playerRuntimeService,
  );
  return {
    service,
    deps,
    emitted,
    transfers,
    durableInputs,
    player,
    tier,
    isDisconnected: () => disconnected,
    isPurged: () => purged,
    isSourceAttached: () => sourceAttached,
    wasHeldDuringDurable: () => heldDuringDurable,
    hasLeakedReservation: () => sourceReserved || targetReserved,
  };
}

function testRealSpawnReservation(): void {
  const width = 5;
  const height = 5;
  const cellCount = width * height;
  const instance = new MapInstanceRuntime({
    instanceId: 'instance:shenxing-reservation-smoke',
    template: {
      id: 'shenxing_reservation_smoke',
      mapId: 'shenxing_reservation_smoke',
      name: '神行預留 Smoke',
      width,
      height,
      terrainRows: Array.from({ length: height }, () => '.'.repeat(width)),
      walkableMask: Uint8Array.from({ length: cellCount }, () => 1),
      blocksSightMask: Uint8Array.from({ length: cellCount }, () => 0),
      portalIndexByTile: Int32Array.from({ length: cellCount }, () => -1),
      safeZoneMask: Uint8Array.from({ length: cellCount }, () => 0),
      baseAuraByTile: Int32Array.from({ length: cellCount }, () => 0),
      baseTileResourceEntries: [],
      npcs: [],
      landmarks: [],
      containers: [],
      safeZones: [],
      portals: [],
      spawnX: 2,
      spawnY: 2,
      source: {},
    },
    monsterSpawns: [],
    kind: 'public',
    persistent: false,
    createdAt: Date.now(),
    displayName: '神行預留 Smoke',
    linePreset: 'peaceful',
    lineIndex: 1,
    instanceOrigin: 'smoke',
    defaultEntry: true,
    supportsPvp: false,
    canDamageTile: false,
  });
  const heldPlayerId = 'player:shenxing-held';
  const held = instance.connectPlayer({
    playerId: heldPlayerId,
    sessionId: 'session:shenxing-held',
    preferredX: 2,
    preferredY: 2,
  });
  assert.deepEqual(instance.reserveShenxingSpawnPoint(heldPlayerId, held.x, held.y), { x: 2, y: 2 });
  assert.equal(instance.disconnectPlayer(heldPlayerId), true);
  const other = instance.connectPlayer({
    playerId: 'player:shenxing-other',
    sessionId: 'session:shenxing-other',
    preferredX: 2,
    preferredY: 2,
  });
  assert.notDeepEqual({ x: other.x, y: other.y }, { x: 2, y: 2 }, '預留格不可被其他玩家佔用');
  instance.releaseShenxingSpawnPoint(heldPlayerId);
  const restored = instance.connectPlayer({
    playerId: heldPlayerId,
    sessionId: 'session:shenxing-held',
    preferredX: 2,
    preferredY: 2,
  });
  assert.deepEqual({ x: restored.x, y: restored.y }, { x: 2, y: 2 }, '釋放預留後原玩家必須能精確恢復');
}

async function main() {
  testRealSpawnReservation();
  {
    const h = createHarness();
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, { requestId: 'request-selector-0001' });
    assert.equal(h.emitted.at(-1)?.[0], S2C.ShenxingDestinations);
    assert.deepEqual(
      (h.emitted.at(-1)?.[1].destinations as Array<{ mapId: string }>).map((entry) => entry.mapId),
      [TARGET_MAP_ID],
    );
    assert.equal(h.durableInputs.length, 0, '開啟或取消選單不可扣除道具');
    assert.equal(h.player.inventory.items[0]?.count, 2);
  }
  {
    const h = createHarness({ itemTierIndex: 1, realmLv: 42 });
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, {
      requestId: 'request-realm-0001',
      targetMapId: TARGET_MAP_ID,
    });
    assert.equal(h.emitted.at(-1)?.[1].code, 'realm_too_low');
    assert.equal(h.durableInputs.length, 0);
  }
  {
    const h = createHarness();
    h.player.inventory.items = [];
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, {
      requestId: 'request-missing-open-0001',
    });
    assert.equal(h.emitted.at(-1)?.[1].code, 'item_missing');
  }
  {
    const h = createHarness({ cooldownRemainingTicks: 7 });
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, {
      requestId: 'request-cooldown-0001',
      targetMapId: TARGET_MAP_ID,
    });
    assert.equal(h.emitted.at(-1)?.[1].code, 'cooldown_active');
    assert.equal(h.durableInputs.length, 0);
  }
  {
    const h = createHarness();
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, {
      requestId: 'request-malicious-0001',
      targetMapId: 'private_map',
    });
    assert.equal(h.emitted.at(-1)?.[1].code, 'destination_forbidden');
    assert.equal(h.transfers.length, 0);
  }
  {
    const h = createHarness();
    const request = { requestId: 'request-success-0001', targetMapId: TARGET_MAP_ID };
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, request);
    assert.equal(h.emitted.at(-1)?.[1].code, 'travel_succeeded');
    assert.equal(h.durableInputs.length, 1);
    assert.equal(h.player.inventory.items[0]?.count, 1);
    assert.equal(h.wasHeldDuringDurable(), true, 'durable await 期間玩家必須脫離來源 instance tick');
    assert.equal(h.hasLeakedReservation(), false, '成功後必須釋放來源與目標格預留');
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, request);
    assert.equal(h.emitted.at(-1)?.[1].code, 'travel_succeeded');
    assert.equal(h.durableInputs.length, 1, '相同 requestId 重送不可再次提交或扣藥');
  }
  {
    const h = createHarness();
    const request = { requestId: 'request-replay-recovery-0001', targetMapId: TARGET_MAP_ID };
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, request);
    h.player.templateId = SOURCE_MAP_ID;
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, request);
    assert.equal(h.emitted.at(-1)?.[1].code, 'asset_commit_unavailable');
    assert.equal(h.isPurged(), true, '已提交重送若運行態尚未水合到目標，必須清除 runtime 再從 DB 恢復');
    assert.equal(h.durableInputs.length, 1, '恢復前重送不可再次提交或扣藥');
  }
  {
    const h = createHarness({ durableFailure: true });
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, {
      requestId: 'request-failure-0001',
      targetMapId: TARGET_MAP_ID,
    });
    assert.equal(h.emitted.at(-1)?.[1].code, 'asset_commit_failed');
    assert.deepEqual(h.transfers, [], '資產提交失敗前不可改動權威世界位置');
    assert.equal(h.player.inventory.items[0]?.count, 2);
    assert.equal(h.isSourceAttached(), true, '已知提交失敗必須恢復來源原格掛接');
    assert.equal(h.hasLeakedReservation(), false, '失敗恢復後不得留下格位預留');
  }
  {
    const h = createHarness({ durableUnknown: true });
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, {
      requestId: 'request-unknown-0001',
      targetMapId: TARGET_MAP_ID,
    });
    assert.equal(h.emitted.at(-1)?.[1].code, 'asset_commit_unavailable');
    assert.equal(h.isDisconnected(), true, 'COMMIT 結果不確定時必須中止 session 等待 DB 恢復');
    assert.equal(h.isPurged(), true, 'COMMIT 結果不確定時必須清除舊 runtime，禁止快速重連沿用舊快照');
    assert.equal(h.isSourceAttached(), false, 'COMMIT 結果不確定時不可重新掛回來源世界');
    assert.equal(h.hasLeakedReservation(), false, 'COMMIT unknown 後不得留下格位預留');
  }
  {
    const h = createHarness({ transferFailure: true });
    await h.service.dispatchUseItem(PLAYER_ID, ITEM_INSTANCE_ID, h.deps, {
      requestId: 'request-rollback-failure-0001',
      targetMapId: TARGET_MAP_ID,
    });
    assert.equal(h.emitted.at(-1)?.[1].code, 'transfer_failed');
    assert.equal(h.isDisconnected(), true, '位置已提交但運行態掛接失敗時必須中止 session 從 DB 恢復');
    assert.equal(h.isPurged(), true, '位置提交後掛接失敗必須清除舊 runtime');
    assert.equal(h.hasLeakedReservation(), false, '提交後掛接失敗不得留下格位預留');
  }
  console.log(JSON.stringify({ ok: true, case: 'shenxing-runtime', cases: 11 }));
}

void main();
