/**
 * 用途：驗證啟動恢復遇到「已持久化但建築定義缺失（unknown_def）」時必須失敗關閉。
 *
 * 回歸背景：舊版啟動自檢會把 unknown_def 建築從執行態剔除，再把剪除後的快照寫回
 * instance_building_state，等同刪除玩家資料。本煙測鎖定新契約：
 *   - 任何 unknown_def 必須在任何持久化寫入／佔格釋放前中止啟動，拋出精確致命錯誤；
 *   - 合法保護點位剪除（定義存在）仍保留既有寫回行為。
 *
 * 兩條啟動恢復入口都必須成立：instance-lease hydratePersistentInstanceSnapshot
 * 與 lifecycle restorePublicInstancePersistence，後者更要壓在寶庫返還、密室釋放、
 * 運行態水合、持久化寫回與 runtime tile 替換之前。
 *
 * 驗證入口（standalone）：node dist/tools/building-unknown-def-startup-fail-closed-smoke.js
 */

import assert from 'node:assert/strict';
import { getDefaultBuildingRuntime } from '../runtime/building/building-default-content';
import { MapInstanceRuntime } from '../runtime/instance/map-instance.runtime';
import { MapTemplateRepository } from '../runtime/map/map-template.repository';
import { hydratePersistentInstanceSnapshot } from '../runtime/world/world-runtime-instance-lease.helpers';
import { WorldRuntimeLifecycleService } from '../runtime/world/world-runtime-lifecycle.service';
import { installSmokeTimeout } from './smoke-timeout';

installSmokeTimeout(__filename);

const INSTANCE_ID = 'public:building_unknown_def_fail_closed_smoke';
const PROTECTED_INSTANCE_ID = 'public:building_known_protected_prune_smoke';
const LIFECYCLE_INSTANCE_ID = 'public:building_unknown_def_lifecycle_smoke';

/** 持久化建築快照的形狀（只描述本煙測會讀寫的欄位）。 */
interface PersistedBuildingState {
  buildings: Array<Record<string, unknown>>;
  rooms: unknown[];
  roomCells: unknown[];
  fengShui: unknown[];
}

/** 寫回閘門收到的建築快照；只斷言 buildings 內容。 */
interface SavedBuildingState {
  buildings: Array<Record<string, unknown>>;
}

/** 記錄持久化副作用，證明失敗關閉時零寫入。 */
interface SmokeRecorder {
  savedStates: Array<[string, SavedBuildingState]>;
  replacedCells: Array<[string, unknown[]]>;
  loggedErrors: string[];
}

/** lifecycle 路徑專用：額外記錄寶庫返還、密室釋放與運行態水合的副作用計數。 */
interface LifecycleRecorder extends SmokeRecorder {
  vaultRecoveryCalls: number;
  timeChamberReleaseCalls: number;
  hydratedBuildingStates: number;
}

async function main() {
  await assertUnknownDefAbortsBeforeAnyPersistence();
  await assertKnownProtectedPlacementStillPersists();
  await assertLifecyclePathUnknownDefAbortsBeforeAnySideEffect();
  console.log(JSON.stringify({
    ok: true,
    case: 'building-unknown-def-startup-fail-closed',
    proves: 'instance-lease 與 lifecycle 兩條啟動恢復入口都在任何寫入、佔格釋放、寶庫返還、密室釋放與運行態水合前失敗關閉；合法保護點位剪除仍寫回',
  }, null, 2));
}

/** 未知定義 + 同實例內合法保護點位：整實例失敗關閉，不得只寫回部分剪除結果。 */
async function assertUnknownDefAbortsBeforeAnyPersistence() {
  const instance = createInstance(INSTANCE_ID);
  const unknownTileIndex = instance.toTileIndex(3, 3);
  const unknownPreviousTileType = instance.tilePlane.getTileType(unknownTileIndex);
  const protectedTileIndex = instance.toTileIndex(1, 1);
  const protectedPreviousTileType = instance.tilePlane.getTileType(protectedTileIndex);
  instance.getPortalAtTile = (x: number, y: number) => (x === 1 && y === 1 ? { id: 'portal:blocked', x, y } : null);

  const persistedState = {
    buildings: [
      {
        id: 'building:known:protected',
        defId: 'stone_wall',
        x: 1,
        y: 1,
        state: 'active',
        hp: 100,
        maxHp: 100,
        cells: [{ tileIndex: protectedTileIndex, x: 1, y: 1, previousTileType: protectedPreviousTileType }],
      },
      {
        id: 'building:missing:def',
        defId: 'removed_building_def',
        x: 3,
        y: 3,
        state: 'active',
        hp: 1,
        maxHp: 1,
        cells: [{ tileIndex: unknownTileIndex, x: 3, y: 3, previousTileType: unknownPreviousTileType }],
      },
    ],
    rooms: [],
    roomCells: [],
    fengShui: [],
  };
  const savedStates: Array<[string, SavedBuildingState]> = [];
  const replacedCells: Array<[string, unknown[]]> = [];
  const loggedErrors: string[] = [];
  const runtime = createRuntime(instance, persistedState, { savedStates, replacedCells, loggedErrors });

  await assert.rejects(
    () => hydratePersistentInstanceSnapshot(runtime, INSTANCE_ID, instance),
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /startup_building_unknown_def_fail_closed/, '錯誤必須帶可 grep 的錯誤碼');
      assert.ok(message.includes(INSTANCE_ID), '錯誤必須帶 instanceId');
      assert.match(message, /buildings=1/, '錯誤必須帶未知定義建築數');
      assert.match(message, /defs=1/, '錯誤必須帶未知定義種類數');
      assert.ok(message.includes('removed_building_def'), '錯誤必須帶缺失的 defId');
      return true;
    },
  );

  assert.deepEqual(savedStates, [], 'unknown_def 必須在任何 saveBuildingRoomFengShuiState 之前中止');
  assert.deepEqual(replacedCells, [], 'unknown_def 必須在任何 replaceRuntimeTileCells 之前中止');
  assert.ok(
    loggedErrors.some((entry) => entry.includes('startup_building_unknown_def_fail_closed')),
    '必須寫一筆可讓運維定位的 error 日誌',
  );
  assert.equal(persistedState.buildings.length, 2, '原始持久化輸入必須保持不動');
  assert.equal(persistedState.buildings[1].cells.length, 1, '未知定義建築的佔格資料必須保持不動');
  assert.equal(instance.buildingById.size, 0, '失敗關閉時不得水合任何建築');
  assert.equal(instance.tilePlane.getTileType(unknownTileIndex), unknownPreviousTileType, '不得釋放未知定義建築佔格');
  assert.equal(instance.tilePlane.getTileType(protectedTileIndex), protectedPreviousTileType, '不得釋放保護點位建築佔格');
}

/** 僅有合法保護點位違規（定義存在）時，維持既有「剪除並寫回」行為。 */
async function assertKnownProtectedPlacementStillPersists() {
  const instance = createInstance(PROTECTED_INSTANCE_ID);
  const protectedTileIndex = instance.toTileIndex(1, 1);
  const protectedPreviousTileType = instance.tilePlane.getTileType(protectedTileIndex);
  instance.getPortalAtTile = (x: number, y: number) => (x === 1 && y === 1 ? { id: 'portal:blocked', x, y } : null);

  const persistedState = {
    buildings: [
      {
        id: 'building:known:protected',
        defId: 'stone_wall',
        x: 1,
        y: 1,
        state: 'active',
        hp: 100,
        maxHp: 100,
        cells: [{ tileIndex: protectedTileIndex, x: 1, y: 1, previousTileType: protectedPreviousTileType }],
      },
    ],
    rooms: [],
    roomCells: [],
    fengShui: [],
  };
  const savedStates: Array<[string, SavedBuildingState]> = [];
  const replacedCells: Array<[string, unknown[]]> = [];
  const loggedErrors: string[] = [];
  const runtime = createRuntime(instance, persistedState, { savedStates, replacedCells, loggedErrors });

  await hydratePersistentInstanceSnapshot(runtime, PROTECTED_INSTANCE_ID, instance);

  assert.equal(savedStates.length, 1, '合法保護點位剪除仍必須寫回建築快照');
  assert.equal(savedStates[0][0], PROTECTED_INSTANCE_ID);
  assert.equal(
    savedStates[0][1].buildings.some((entry) => entry.defId === 'stone_wall'),
    false,
    '寫回的剪除快照不得含被剔除的保護點位建築',
  );
  assert.equal(replacedCells.length, 1, '恢復佔格後仍必須寫回 runtime tile cells');
  assert.deepEqual(loggedErrors, [], '合法剪除不得觸發致命 error 日誌');
  assert.equal(instance.buildingById.has('building:known:protected'), false);
  assert.equal(instance.tilePlane.getTileType(protectedTileIndex), protectedPreviousTileType);
}

/**
 * lifecycle 路徑（restorePublicInstancePersistence）：unknown_def 必須比寶庫返還、
 * 密室釋放、運行態水合、持久化寫回與 runtime tile 替換都更早失敗關閉。
 *
 * 持久化輸入刻意放入「定義存在的寶庫與密室，且都落在保護點位」：若閘門順序被改成
 * 先返還／先釋放，對應計數會立刻非零，回歸即被鎖住。
 */
async function assertLifecyclePathUnknownDefAbortsBeforeAnySideEffect() {
  const instance = createInstance(LIFECYCLE_INSTANCE_ID);
  const recorder: LifecycleRecorder = {
    savedStates: [],
    replacedCells: [],
    loggedErrors: [],
    vaultRecoveryCalls: 0,
    timeChamberReleaseCalls: 0,
    hydratedBuildingStates: 0,
  };
  const hydrateBuildingRoomFengShuiState = instance.hydrateBuildingRoomFengShuiState;
  instance.hydrateBuildingRoomFengShuiState = (state, options = {}) => {
    recorder.hydratedBuildingStates += 1;
    return hydrateBuildingRoomFengShuiState.call(instance, state, options);
  };

  const unknownTileIndex = instance.toTileIndex(3, 3);
  const unknownPreviousTileType = instance.tilePlane.getTileType(unknownTileIndex);
  const vaultTileIndex = instance.toTileIndex(1, 1);
  const vaultPreviousTileType = instance.tilePlane.getTileType(vaultTileIndex);
  const chamberTileIndex = instance.toTileIndex(2, 2);
  const chamberPreviousTileType = instance.tilePlane.getTileType(chamberTileIndex);
  instance.getPortalAtTile = (x: number, y: number) => (
    (x === 1 && y === 1) || (x === 2 && y === 2)
      ? { id: `portal:lifecycle:${x}:${y}`, x, y }
      : null
  );

  const persistedState: PersistedBuildingState = {
    buildings: [
      {
        id: 'building:lifecycle:vault',
        defId: 'treasure_vault',
        x: 1,
        y: 1,
        state: 'active',
        hp: 160,
        maxHp: 160,
        ownerPlayerId: 'player:lifecycle:owner',
        cells: [{ tileIndex: vaultTileIndex, x: 1, y: 1, previousTileType: vaultPreviousTileType }],
      },
      {
        id: 'building:lifecycle:chamber',
        defId: 'time_chamber',
        x: 2,
        y: 2,
        state: 'active',
        hp: 180,
        maxHp: 180,
        cells: [{ tileIndex: chamberTileIndex, x: 2, y: 2, previousTileType: chamberPreviousTileType }],
      },
      {
        id: 'building:lifecycle:missing',
        defId: 'removed_building_def',
        x: 3,
        y: 3,
        state: 'active',
        hp: 1,
        maxHp: 1,
        cells: [{ tileIndex: unknownTileIndex, x: 3, y: 3, previousTileType: unknownPreviousTileType }],
      },
    ],
    rooms: [],
    roomCells: [],
    fengShui: [],
  };
  const deps = createLifecycleRuntime(instance, persistedState, recorder);

  // 先確認寶庫與密室確實落在可剪除的保護點位：若閘門順序被改壞，對應計數必然非零，
  // 這幾條斷言排除「計數因為清單本來就是空的而永遠為 0」的假陽性。
  const prunableVaults = instance.listPrunableVaultBuildings(persistedState);
  const prunableChambers = instance.listPrunableTimeChamberBuildings(persistedState);
  assert.equal(prunableVaults.length, 1, '寶庫必須確實可被剪除，返還計數才有回歸意義');
  assert.equal(prunableVaults[0].id, 'building:lifecycle:vault');
  assert.equal(prunableChambers.length, 1, '密室必須確實可被剪除，釋放計數才有回歸意義');
  assert.equal(prunableChambers[0].id, 'building:lifecycle:chamber');

  await assert.rejects(
    () => new WorldRuntimeLifecycleService().restorePublicInstancePersistence(deps),
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /startup_building_unknown_def_fail_closed/, 'lifecycle 路徑錯誤必須帶可 grep 的錯誤碼');
      assert.ok(message.includes(LIFECYCLE_INSTANCE_ID), 'lifecycle 路徑錯誤必須帶 instanceId');
      assert.match(message, /buildings=1/, 'lifecycle 路徑錯誤必須帶未知定義建築數');
      assert.match(message, /defs=1/, 'lifecycle 路徑錯誤必須帶未知定義種類數');
      assert.ok(message.includes('removed_building_def'), 'lifecycle 路徑錯誤必須帶缺失的 defId');
      return true;
    },
  );

  assert.equal(recorder.vaultRecoveryCalls, 0, '未知定義必須在寶庫庫存返還之前中止');
  assert.equal(recorder.timeChamberReleaseCalls, 0, '未知定義必須在密室獨立實例釋放之前中止');
  assert.equal(recorder.hydratedBuildingStates, 0, '未知定義必須在建築運行態水合之前中止');
  assert.deepEqual(recorder.savedStates, [], '未知定義必須在任何 saveBuildingRoomFengShuiState 之前中止');
  assert.deepEqual(recorder.replacedCells, [], '未知定義必須在任何 replaceRuntimeTileCells 之前中止');
  assert.ok(
    recorder.loggedErrors.some((entry) => entry.includes('startup_building_unknown_def_fail_closed')),
    'lifecycle 路徑必須寫一筆可讓運維定位的 error 日誌',
  );
  assert.equal(instance.buildingById.size, 0, 'lifecycle 路徑失敗關閉時不得水合任何建築');
  assert.equal(persistedState.buildings.length, 3, 'lifecycle 路徑不得改動原始持久化輸入');
  assert.equal(instance.tilePlane.getTileType(unknownTileIndex), unknownPreviousTileType, '不得釋放未知定義建築佔格');
  assert.equal(instance.tilePlane.getTileType(vaultTileIndex), vaultPreviousTileType, '不得釋放寶庫佔格');
  assert.equal(instance.tilePlane.getTileType(chamberTileIndex), chamberPreviousTileType, '不得釋放密室佔格');
}

function createInstance(instanceId: string): MapInstanceRuntime {
  const { catalog, rules } = getDefaultBuildingRuntime();
  const templateRepository = new MapTemplateRepository();
  templateRepository.registerRuntimeMapTemplate({
    id: instanceId,
    name: '建築未知定義啟動煙測模板',
    width: 7,
    height: 7,
    routeDomain: 'system',
    tiles: [
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
    ],
    spawnPoint: { x: 3, y: 3 },
    portals: [],
    npcs: [],
    monsters: [],
    safeZones: [],
    landmarks: [],
    containers: [],
    auras: [],
  });
  const instance = new MapInstanceRuntime({
    instanceId,
    template: templateRepository.getOrThrow(instanceId),
    monsterSpawns: [],
    kind: 'public',
    persistent: true,
    createdAt: Date.now(),
    displayName: '建築未知定義啟動煙測',
    linePreset: 'smoke',
    lineIndex: 1,
    instanceOrigin: 'smoke',
    defaultEntry: true,
    canDamageTile: true,
  });
  instance.configureBuildingRuntime(catalog, rules);
  return instance;
}

function createRuntime(instance: MapInstanceRuntime, buildingState: PersistedBuildingState, recorder: SmokeRecorder) {
  const { savedStates, replacedCells, loggedErrors } = recorder;
  return {
    instanceDomainPersistenceService: {
      isEnabled: () => true,
      async loadRuntimeTileCells() { return []; },
      async loadTileResourceDiffs() { return []; },
      async loadTileDamageStates() { return []; },
      async loadTemporaryTileStates() { return []; },
      async loadGroundItems() { return []; },
      async loadContainerStates() { return []; },
      async loadMonsterRuntimeStates() { return []; },
      async loadOverlayChunks() { return []; },
      async loadBuildingRoomFengShuiState() { return buildingState; },
      async loadInstanceCheckpoint() { return null; },
      async saveBuildingRoomFengShuiState(instanceId: string, state: SavedBuildingState) { savedStates.push([instanceId, state]); },
      async replaceRuntimeTileCells(instanceId: string, entries: unknown[]) { replacedCells.push([instanceId, entries]); },
    },
    worldRuntimeLootContainerService: {
      hydrateContainerStates() {},
    },
    worldRuntimeFormationService: null,
    getInstanceRuntime(requestedId: string) { return requestedId === instance.meta.instanceId ? instance : null; },
    logger: {
      log() {},
      debug() {},
      warn() {},
      error(message: unknown) { loggedErrors.push(String(message)); },
    },
  };
}

/**
 * createLifecycleRuntime：lifecycle 路徑（restorePublicInstancePersistence）所需的 deps。
 *
 * 與 instance-lease 路徑不同，lifecycle 會先讀 recovery watermark 與 event/overlay，
 * 因此這裡把非本次斷言目標的 domain 讀取全部降級為空集合，讓焦點落在建築閘門順序。
 */
function createLifecycleRuntime(instance: MapInstanceRuntime, buildingState: PersistedBuildingState, recorder: LifecycleRecorder) {
  const { savedStates, replacedCells, loggedErrors } = recorder;
  return {
    instanceDomainPersistenceService: {
      isEnabled: () => true,
      async loadInstanceRecoveryWatermark() { return null; },
      async loadRuntimeTileCells() { return []; },
      async loadTileResourceDiffs() { return []; },
      async loadTileDamageStates() { return []; },
      async loadTemporaryTileStates() { return []; },
      async loadGroundItems() { return []; },
      async loadContainerStates() { return []; },
      async loadMonsterRuntimeStates() { return []; },
      async loadEventStates() { return []; },
      async loadOverlayChunks() { return []; },
      async loadBuildingRoomFengShuiState() { return buildingState; },
      async loadInstanceCheckpoint() { return null; },
      async saveBuildingRoomFengShuiState(instanceId: string, state: SavedBuildingState) { savedStates.push([instanceId, state]); },
      async replaceRuntimeTileCells(instanceId: string, entries: unknown[]) { replacedCells.push([instanceId, entries]); },
    },
    worldRuntimeLootContainerService: {
      hydrateContainerStates() {},
    },
    treasureVaultRuntimeService: {
      async recoverVaultItemsToOwnerMail() {
        recorder.vaultRecoveryCalls += 1;
        return { ok: true, itemCount: 0 };
      },
    },
    timeChamberRuntimeService: {
      async prepareDeconstruct() {
        recorder.timeChamberReleaseCalls += 1;
        return { ok: true };
      },
    },
    worldRuntimeFormationService: null,
    listInstanceEntries() { return [[instance.meta.instanceId, instance] as [string, MapInstanceRuntime]]; },
    logger: {
      log() {},
      debug() {},
      warn() {},
      error(message: unknown) { loggedErrors.push(String(message)); },
    },
  };
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
