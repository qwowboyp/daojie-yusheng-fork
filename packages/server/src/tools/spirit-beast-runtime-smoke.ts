// @ts-nocheck
/** 用途：靈獸掉蛋去重入口、恢復、最強閒獸派工、1Hz 進度與地圖投影冒煙驗證。 */
import assert from 'node:assert/strict';
import { SPIRIT_BEAST_CATALOG } from '@mud/shared';
import { MapTemplateRepository } from '../runtime/map/map-template.repository';
import { MapInstanceRuntime } from '../runtime/instance/map-instance.runtime';
import { compileBuildingDefinitions } from '../runtime/building/building-content.repository';
import { SpiritBeastRuntimeService } from '../runtime/spirit-beast/spirit-beast-runtime.service';
import { handleBuildPlaceIntent } from '../runtime/world/world-runtime-building.service';
import { WorldRuntimePlayerCombatService } from '../runtime/world/combat/world-runtime-player-combat.service';

async function main(): Promise<void> {
  const miningSpecies = SPIRIT_BEAST_CATALOG
    .filter((entry) => entry.masteries.some((mastery) => mastery.skill === 'mining'))
    .sort((a, b) => b.masteries.find((item) => item.skill === 'mining').level - a.masteries.find((item) => item.skill === 'mining').level);
  assert.ok(miningSpecies.length >= 2);
  const order = workOrder('00000000-0000-4000-8000-000000000101');
  const strong = beast('00000000-0000-4000-8000-000000000201', miningSpecies[0].id, 2);
  const weak = beast('00000000-0000-4000-8000-000000000202', miningSpecies[miningSpecies.length - 1].id, 3);
  const hatch = {
    hatchId: '00000000-0000-4000-8000-000000000301', ownerPlayerId: 'player:1',
    eggId: '00000000-0000-4000-8000-000000000302', buildingInstanceId: 'sect:instance:1', buildingId: 'incubator:1',
    incubatorElement: 'metal', eggElement: 'wood', eggStar: 2, resultSpeciesId: miningSpecies[0].id,
    resultGrade: miningSpecies[0].grade, resultCombatPower: 150, totalTicks: 2, remainingTicks: 1,
    status: 'incubating', pendingBeastId: '00000000-0000-4000-8000-000000000303', revision: 1,
  };
  const reserved: string[] = [];
  const constructionEnsures: Array<Record<string, unknown>> = [];
  let constructionOrder: ReturnType<typeof workOrder> | null = null;
  const awardedSources = new Set<string>();
  const persistence = {
    isEnabled: () => true,
    loadRecoveryState: async () => ({ hatches: [hatch], beasts: [strong, weak], workOrders: [order], crops: [] }),
    flushProgress: async () => undefined,
    reserveWorkOrder: async (input) => {
      reserved.push(input.beastId);
      const selectedOrder = constructionOrder?.orderId === input.orderId ? constructionOrder : order;
      const selectedBeast = service['activeBeasts'].get(input.beastId);
      return { order: { ...selectedOrder, status: 'running', workerKind: 'spirit_beast', workerId: input.beastId,
          jobRunId: input.jobRunId, revision: selectedOrder.revision + 1 },
        beast: { ...selectedBeast, state: 'working', activeJobId: selectedOrder.orderId,
          revision: Math.max(1, Number(selectedBeast?.revision) || 1) + 1 } };
    },
    ensureConstructionWorkOrder: async (input) => {
      constructionEnsures.push(input);
      if (!constructionOrder) constructionOrder = { ...workOrder('00000000-0000-4000-8000-000000000104'),
        ownerPlayerId: input.ownerPlayerId, sectId: input.sectId, instanceId: input.instanceId,
        buildingId: input.buildingId, skill: 'building', action: 'construct',
        payload: { x: input.x, y: input.y, buildWorkTotal: input.totalWork },
        totalTicks: input.totalWork, remainingTicks: input.totalWork };
      return constructionOrder;
    },
    awardEgg: async (input) => {
      const awarded = !awardedSources.has(input.sourceRef); awardedSources.add(input.sourceRef);
      return { awarded, egg: { eggId: '00000000-0000-4000-8000-000000000401', ownerPlayerId: input.ownerPlayerId,
        element: input.element, star: input.star, state: 'warehouse', hatchId: null, sourceRef: input.sourceRef, revision: 1 } };
    },
    listPlayerEggs: async () => [], listPlayerBeasts: async () => [], listPlayerHatches: async () => [], listFacilityStorage: async () => [],
  };
  const playerRuntime = { getPlayer: () => ({
    inventory: { items: [{ itemId: 'black_iron_chunk', name: '玄鐵礦塊', type: 'material', count: 2 }] },
    plantingSkill: { level: 2, exp: 3, expToNext: 60 },
  }), playerProgressionService: null };
  const content = { getItemName: (itemId: string) => itemId === 'black_iron_chunk' ? '玄鐵礦塊' : itemId };
  const craft = { forgingCatalog: [{ recipeId: 'forge:1', outputItemId: 'sword:1', outputName: '測試劍',
    outputLevel: 2, baseBrewTicks: 12, ingredients: [{ itemId: 'black_iron_chunk', name: '玄鐵礦塊', count: 2 }] }], alchemyCatalog: [] };
  const flush = { flushPlayerDomains: async () => true };
  const service = new SpiritBeastRuntimeService(persistence as never, playerRuntime as never, flush as never, content as never, craft as never);
  service.onModuleInit();
  const panel = await service.getPanel('player:1', { sectId: 'sect:1', sectInstanceId: 'sect:instance:1', buildings: [], canManage: true });
  assert.equal(panel.craftOptions[0]?.recipeId, 'forge:1');
  assert.equal(panel.inventory[0]?.type, 'material');
  assert.equal(panel.plantingSkill?.level, 2);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(reserved[0], strong.beastId, '應優先派同技藝等級最高的閒獸');

  service.advanceTicks(1);
  assert.equal(service['hatches'].get(hatch.hatchId).status, 'ready');
  const projections = service.listMapProjections('sect:instance:1');
  assert.equal(projections.length, 2);
  assert.equal(projections.find((entry) => entry.instanceId === strong.beastId)?.state, 'working');

  const moveOrder = { ...workOrder('00000000-0000-4000-8000-000000000102'), status: 'running',
    workerKind: 'spirit_beast', workerId: weak.beastId, jobRunId: 'move:1', revision: 2 };
  weak.state = 'working'; weak.activeJobId = moveOrder.orderId;
  service['workOrders'].set(moveOrder.orderId, moveOrder);
  service['activeBeasts'].set(weak.beastId, weak);
  service['startWorkerLifecycle'](weak.beastId, moveOrder, false);
  const occupancy = new Int32Array(15); occupancy.fill(-1); occupancy[2] = 99;
  const map = { template: { width: 5, height: 3 }, occupancy,
    tilePlane: { getCellCapacity: () => 15, getX: (index: number) => index % 5, getY: (index: number) => Math.trunc(index / 5) },
    isInBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < 5 && y < 3,
    toTileIndex: (x: number, y: number) => y * 5 + x,
    isCellIndexWalkable: () => true };
  service.advanceTicks(1, () => map);
  assert.equal(weak.x, strong.x, '靈獸尋路必須忽略其他獸與玩家 occupancy，允許同格穿透');

  service['randomSample'] = () => 0;
  const combat = Object.create(WorldRuntimePlayerCombatService.prototype);
  combat.spiritBeastRuntimeService = service;
  combat.handlePlayerMonsterKillSynchronously = () => undefined;
  await combat.handlePlayerMonsterKill({ meta: { instanceId: 'sect:instance:1' }, tick: 9 },
    { runtimeId: 'monster:runtime:death-hook', tier: 'boss' }, 'player:1', {});
  assert.equal(awardedSources.has('spirit-egg:sect:instance:1:monster:runtime:death-hook:9'), true,
    '靈蛋必須由實際 monster death hook 送入權威掉落入口');
  const first = await service.recordEligibleMonsterDeath({ sourceRef: 'spirit-egg:instance:monster:10', ownerPlayerId: 'player:1', boss: false });
  const replay = await service.recordEligibleMonsterDeath({ sourceRef: 'spirit-egg:instance:monster:10', ownerPlayerId: 'player:1', boss: false });
  assert.equal(first.dropped, true);
  assert.equal(replay.dropped, false, '同一死亡身份不得重複產蛋');
  const unknown = await service.executeCommand('player:1', { action: 'unknown', requestId: 'unknown:1' } as never,
    { sectId: 'sect:1', sectInstanceId: 'sect:instance:1', buildings: [], canManage: true });
  assert.equal(unknown.ok, false, '未知 command action 必須 fail closed');

  const mineBuilding = { id: 'mine:projection:1', defId: 'sect_iron_mine', x: 1, y: 1, state: 'active', revision: 1 };
  const mineContext = { sectId: 'sect:1', sectInstanceId: 'sect:instance:1', buildings: [mineBuilding], canManage: true };
  assert.equal(service['buildFacilities']('player:1', mineContext, [], [])[0]?.enabled, false,
    '啟用礦場必須由現存 repeat 工單投影，活建築本身不等於已啟用');
  const repeatMineOrder = { ...workOrder('00000000-0000-4000-8000-000000000103'),
    buildingId: mineBuilding.id, payload: { x: 1, y: 1, repeat: true } };
  service['workOrders'].set(repeatMineOrder.orderId, repeatMineOrder);
  assert.equal(service['buildFacilities']('player:1', mineContext, [], [])[0]?.enabled, true);
  repeatMineOrder.status = 'cancelled';
  assert.equal(service['buildFacilities']('player:1', mineContext, [], [])[0]?.enabled, false);

  const cropBase = { cropId: 'crop:projection:1', ownerPlayerId: 'player:1', sectId: 'sect:1', instanceId: 'sect:instance:1',
    buildingId: 'field:1', seedItemId: 'spirit_seed.metal', outputItemId: 'black_iron_chunk', repeatEnabled: false,
    growthTotalTicks: 3600, growthRemainingTicks: 3600, wateringMask: 0, revision: 1 };
  assert.equal(service['buildCropView']({ ...cropBase, status: 'planned' }).state, 'planned');
  assert.equal(service['buildCropView']({ ...cropBase, status: 'growing', growthRemainingTicks: 2000 }).state, 'needs_water');
  assert.equal(service['buildCropView']({ ...cropBase, status: 'mature', growthRemainingTicks: 0, wateringMask: 1 }).state, 'needs_water');
  assert.equal(service['buildCropView']({ ...cropBase, status: 'mature', growthRemainingTicks: 0, wateringMask: 2 }).state, 'mature');

  const buildingSpecies = SPIRIT_BEAST_CATALOG.find((entry) => entry.masteries.some((mastery) => mastery.skill === 'building'));
  assert.ok(buildingSpecies);
  const builder = beast('00000000-0000-4000-8000-000000000203', buildingSpecies.id, 1);
  service['trackActiveBeast'](builder);
  const templateRepository = new MapTemplateRepository();
  templateRepository.registerRuntimeMapTemplate({ id: 'spirit_beast_construction_event_smoke', name: '靈獸營造事件煙測',
    width: 7, height: 7, routeDomain: 'system', tiles: Array.from({ length: 7 }, () => '.......'),
    spawnPoint: { x: 6, y: 6 }, portals: [], npcs: [], monsters: [], safeZones: [], landmarks: [], containers: [], auras: [] });
  const constructionInstance = new MapInstanceRuntime({ instanceId: 'sect:instance:1',
    template: templateRepository.getOrThrow('spirit_beast_construction_event_smoke'), monsterSpawns: [], kind: 'sect',
    persistent: true, createdAt: Date.now(), displayName: '靈獸營造事件煙測', linePreset: 'peaceful', lineIndex: 1,
    instanceOrigin: 'smoke', defaultEntry: false, canDamageTile: true, ownerSectId: 'sect:1' });
  constructionInstance.configureBuildingRuntime(compileBuildingDefinitions([{ id: 'smoke_spirit_construction', name: '測試營造',
    placement: { layer: 'structure', footprint: [{ dx: 0, dy: 0 }] }, topology: { blocksMove: true } }]), []);
  const buildingRuntime = { tick: 20, buildingOperationResultsByKey: new Map(), buildingOperationAuditLog: [],
    spiritBeastRuntimeService: service, logger: { warn(message: string) { throw new Error(message); } },
    getPlayerLocationOrThrow: () => ({ instanceId: 'sect:instance:1' }),
    getInstanceRuntimeOrThrow: () => constructionInstance,
    playerRuntimeService: { getPlayer: () => ({ playerId: 'player:1', sectId: 'sect:1', inventory: { items: [] },
      buildingSkill: { level: 1 } }) },
    worldRuntimeSectService: { findSectByInstanceId: () => ({ sectId: 'sect:1' }),
      resolveSectInstancePermission: () => true } };
  const placed = handleBuildPlaceIntent(buildingRuntime, 'player:1', { requestId: '00000000-0000-4000-8000-000000000501',
    defId: 'smoke_spirit_construction', x: 2, y: 2, buildStrength: 3 });
  assert.equal(placed.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(constructionEnsures.length, 1, '真放置後不開面板也必須登記營造工單');
  assert.equal(service['workOrders'].get(constructionOrder?.orderId)?.workerId, builder.beastId,
    '新工程必須可由同圖閒置靈獸透過共用 scheduler 取得');
  const placementReplay = handleBuildPlaceIntent(buildingRuntime, 'player:1', { requestId: '00000000-0000-4000-8000-000000000501',
    defId: 'smoke_spirit_construction', x: 2, y: 2, buildStrength: 3 });
  assert.equal(placementReplay.duplicate, true);
  assert.equal(constructionEnsures.length, 1, '放置命令重放不得重建營造工單');

  console.log(JSON.stringify({ ok: true, case: 'spirit-beast-runtime', strongestWorker: reserved[0], hatchReady: true,
    dedupe: true, deathHook: true, projections: projections.length, passThroughOccupancy: true,
    mineEnabledProjection: true, cropStates: true, constructionPlacementEvent: true }, null, 2));
}

function beast(beastId: string, speciesId: string, x: number) {
  const species = SPIRIT_BEAST_CATALOG.find((entry) => entry.id === speciesId);
  return { beastId, ownerPlayerId: 'player:1', speciesId, grade: species.grade, element: species.element, star: 1,
    baseCombatPower: species.baseCombatPowerMin, skillLevels: Object.fromEntries(species.masteries.map((entry) => [entry.skill, entry.level])),
    speedBonusPercent: 0, state: 'summoned', sectId: 'sect:1', instanceId: 'sect:instance:1', x, y: 0,
    facing: 'down', activeJobId: null, favorite: false, revision: 1 };
}

function workOrder(orderId: string) {
  return { orderId, ownerPlayerId: 'player:1', sectId: 'sect:1', instanceId: 'sect:instance:1', buildingId: 'mine:1',
    skill: 'mining', action: 'mine_iron', payload: { x: 0, y: 0 }, priority: 10, status: 'queued', workerKind: null,
    workerId: null, jobRunId: null, totalTicks: 120, remainingTicks: 120, retryAfterTick: 0, revision: 1, createdAtMs: 1 };
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
