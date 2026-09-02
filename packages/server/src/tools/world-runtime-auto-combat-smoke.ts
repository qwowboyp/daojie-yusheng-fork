import assert from 'node:assert/strict';

import { WorldRuntimeAutoCombatService } from '../runtime/world/combat/world-runtime-auto-combat.service';
import { WorldRuntimeThreatService } from '../runtime/world/combat/world-runtime-threat.service';
import { findPathToTargetWithinRangeOnMap } from '../runtime/world/world-runtime.path-planning.helpers';

function createPlayerRuntimeService(player: Record<string, unknown>, extraPlayers: Array<Record<string, unknown>> = []) {
  const log: unknown[][] = [];
  const players = new Map<string, Record<string, unknown>>([
    [String(player.playerId), player],
    ...extraPlayers.map((entry) => [String(entry.playerId), entry] as [string, Record<string, unknown>]),
  ]);
  return {
    log,
    getPlayer(playerId: string) {
      return players.get(playerId) ?? null;
    },
    clearRetaliatePlayerTargetIfExpired(playerId: string, currentTick: number) {
      log.push(['clearRetaliatePlayerTargetIfExpired', playerId, currentTick]);
      const current = players.get(playerId);
      const combat = current?.combat as { retaliatePlayerTargetId?: string | null; retaliatePlayerTargetLastAttackTick?: number | null } | undefined;
      if (!combat?.retaliatePlayerTargetId) {
        return current ?? null;
      }
      const lastAttackTick = typeof combat.retaliatePlayerTargetLastAttackTick === 'number'
        ? combat.retaliatePlayerTargetLastAttackTick
        : null;
      if (lastAttackTick === null || currentTick - lastAttackTick >= 1800) {
        combat.retaliatePlayerTargetId = null;
        combat.retaliatePlayerTargetLastAttackTick = null;
      }
      return current ?? null;
    },
    clearManualEngagePending(playerId: string) {
      log.push(['clearManualEngagePending', playerId]);
    },
    clearCombatTarget(playerId: string, tick: number) {
      log.push(['clearCombatTarget', playerId, tick]);
    },
    updateCombatSettings(playerId: string, input: Record<string, unknown>, tick: number) {
      log.push(['updateCombatSettings', playerId, input, tick]);
    },
    setCombatTarget(playerId: string, targetRef: string, locked: boolean, tick: number) {
      log.push(['setCombatTarget', playerId, targetRef, locked, tick]);
    },
    useItemByInstanceId(playerId: string, itemInstanceId: string) {
      log.push(['useItemByInstanceId', playerId, itemInstanceId]);
      const inventory = player.inventory as { items?: Array<{ itemInstanceId?: string; count?: number }> } | undefined;
      const item = inventory?.items?.find((entry) => entry.itemInstanceId === itemInstanceId);
      if (item && typeof item.count === 'number') {
        item.count -= 1;
      }
    },
  };
}

function createPathingInstance() {
  return {
    template: {
      width: 6,
      height: 4,
    },
    meta: {
      instanceId: 'public:test_map',
    },
    isPointInSafeZone() {
      return false;
    },
    isSafeZoneTile() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 6, height: 4 },
        visiblePlayers: [],
        localMonsters: [{
          runtimeId: 'monster:1',
          x: 4,
          y: 1,
          hp: 20,
        }],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster(runtimeId: string) {
      assert.equal(runtimeId, 'monster:1');
      return {
        runtimeId: 'monster:1',
        x: 4,
        y: 1,
        hp: 20,
        alive: true,
      };
    },
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 6 && y < 4;
    },
    toTileIndex(x: number, y: number) {
      return y * 6 + x;
    },
    isWalkable(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 6 && y < 4;
    },
    forEachPathingBlocker(_playerId: string, _callback: (x: number, y: number) => void) {},
    getTileTraversalCost() {
      return 1;
    },
  };
}

function createLongRangePathingInstance() {
  return {
    template: {
      width: 8,
      height: 4,
    },
    meta: {
      instanceId: 'public:test_map',
    },
    isPointInSafeZone() {
      return false;
    },
    isSafeZoneTile() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 8, height: 4 },
        visiblePlayers: [],
        localMonsters: [{
          runtimeId: 'monster:1',
          x: 5,
          y: 1,
          hp: 20,
        }],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster(runtimeId: string) {
      assert.equal(runtimeId, 'monster:1');
      return {
        runtimeId: 'monster:1',
        x: 5,
        y: 1,
        hp: 20,
        maxHp: 20,
        alive: true,
      };
    },
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 4;
    },
    toTileIndex(x: number, y: number) {
      return y * 8 + x;
    },
    isWalkable(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 4;
    },
    forEachPathingBlocker(_playerId: string, _callback: (x: number, y: number) => void) {},
    getTileTraversalCost() {
      return 1;
    },
  };
}

function createFarAndAdjacentMonsterInstance() {
  const monsters: Record<string, {
    runtimeId: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    alive: boolean;
  }> = {
    'monster:far': {
      runtimeId: 'monster:far',
      x: 5,
      y: 1,
      hp: 20,
      maxHp: 20,
      alive: true,
    },
    'monster:near': {
      runtimeId: 'monster:near',
      x: 2,
      y: 1,
      hp: 20,
      maxHp: 20,
      alive: true,
    },
  };
  return {
    template: {
      width: 8,
      height: 4,
    },
    meta: {
      instanceId: 'public:test_map',
    },
    isPointInSafeZone() {
      return false;
    },
    isSafeZoneTile() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 8, height: 4 },
        visiblePlayers: [],
        localMonsters: [{
          runtimeId: 'monster:far',
          x: 5,
          y: 1,
          hp: 20,
        }, {
          runtimeId: 'monster:near',
          x: 2,
          y: 1,
          hp: 20,
        }],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster(runtimeId: string) {
      return monsters[runtimeId] ?? null;
    },
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 4;
    },
    toTileIndex(x: number, y: number) {
      return y * 8 + x;
    },
    isWalkable(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 4;
    },
    forEachPathingBlocker(_playerId: string, _callback: (x: number, y: number) => void) {},
    getTileTraversalCost() {
      return 1;
    },
  };
}

function seedFarMonsterThreat(service: WorldRuntimeAutoCombatService, now: number): void {
  const threatService = service.worldRuntimeThreatService;
  threatService.addThreat(threatService.buildPlayerOwnerId('player:1'), 'monster:far', {
    baseThreat: 100000,
    distance: 4,
    extraAggroRate: 0,
    now,
  });
}

function createWidePathingInstance() {
  let boundsChecks = 0;
  const instance = {
    template: {
      width: 64,
      height: 8,
    },
    isInBounds(x: number, y: number) {
      boundsChecks += 1;
      return x >= 0 && y >= 0 && x < 64 && y < 8;
    },
    toTileIndex(x: number, y: number) {
      return y * 64 + x;
    },
    isWalkable(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 64 && y < 8;
    },
    forEachPathingBlocker(_playerId: string, _callback: (x: number, y: number) => void) {},
    getTileTraversalCost() {
      return 1;
    },
  };
  return {
    instance,
    getBoundsChecks() {
      return boundsChecks;
    },
  };
}

function createCachedChasePathingInstance() {
  const blocked = new Set<string>();
  const instance = {
    template: {
      width: 7,
      height: 3,
    },
    occupancy: new Uint32Array(21),
    npcIdByTile: new Map<number, string>(),
    monsterRuntimeIdByTile: new Map<number, string>(),
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 7 && y < 3;
    },
    toTileIndex(x: number, y: number) {
      return y * 7 + x;
    },
    isPlayerOverlapTile() {
      return false;
    },
    isDynamicallyBlockedTile(x: number, y: number) {
      return blocked.has(`${x},${y}`);
    },
    isWalkable(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 7 && y < 3 && !blocked.has(`${x},${y}`);
    },
    forEachPathingBlocker(_playerId: string, callback: (x: number, y: number) => void) {
      for (const key of blocked) {
        const [x, y] = key.split(',').map(Number);
        callback(x, y);
      }
    },
    getTileTraversalCost() {
      return 1;
    },
  };
  return {
    instance,
    block(x: number, y: number) {
      blocked.add(`${x},${y}`);
      instance.occupancy[instance.toTileIndex(x, y)] = 999;
    },
  };
}

function createStaticObstaclePathingInstance() {
  return {
    template: {
      width: 5,
      height: 3,
    },
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 5 && y < 3;
    },
    toTileIndex(x: number, y: number) {
      return y * 5 + x;
    },
    isDynamicallyBlockedTile() {
      return false;
    },
    isWalkable(x: number, y: number) {
      return y === 1 && x !== 2;
    },
    forEachPathingBlocker(_playerId: string, _callback: (x: number, y: number) => void) {},
    getTileTraversalCost() {
      return 1;
    },
    getStaticObstacleTraversalCost() {
      return 1;
    },
  };
}

function createAdjacentMonsterInstance() {
  return {
    meta: {
      instanceId: 'public:test_map',
    },
    isPointInSafeZone() {
      return false;
    },
    isSafeZoneTile() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [],
        localMonsters: [{
          runtimeId: 'monster:1',
          x: 2,
          y: 1,
          hp: 20,
        }],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster(runtimeId: string) {
      assert.equal(runtimeId, 'monster:1');
      return {
        runtimeId: 'monster:1',
        x: 2,
        y: 1,
        hp: 20,
        maxHp: 20,
        alive: true,
      };
    },
  };
}

function createAutoBattlePlayer() {
  return {
    playerId: 'player:1',
    sessionId: null,
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
        actionsPerTurn: 1,
      },
    },
    actions: { actions: [] },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      autoBattleTargetingMode: 'nearest',
      combatTargetId: null,
      combatTargetLocked: false,
      manualEngagePending: false,
      combatActionTick: 12,
      combatActionsUsedThisTick: 1,
    },
  };
}

function createMaterializeDeps(instance: Record<string, unknown>, enqueueLog: unknown[][], currentTick: number) {
  return {
    listConnectedPlayerIds() {
      return ['player:1'];
    },
    hasPendingCommand() {
      return false;
    },
    worldRuntimeNavigationService: {
      hasNavigationIntent() {
        return false;
      },
    },
    getPlayerLocation() {
      return {
        instanceId: 'public:test_map',
      };
    },
    getInstanceRuntime(instanceId: string) {
      assert.equal(instanceId, 'public:test_map');
      return instance;
    },
    enqueuePendingCommand(playerId: string, command: Record<string, unknown>) {
      enqueueLog.push([playerId, command]);
    },
    resolveCurrentTickForPlayerId() {
      return currentTick;
    },
    queuePlayerNotice() {},
  };
}

function createAutoUsePillDeps(log: unknown[][], hasPendingCommand = false) {
  return {
    listConnectedPlayerIds() {
      return ['player:1'];
    },
    hasPendingCommand() {
      return hasPendingCommand;
    },
    refreshQuestStates(playerId: string) {
      log.push(['refreshQuestStates', playerId]);
    },
    queuePlayerNotice(playerId: string, message: string, kind: string) {
      log.push(['queuePlayerNotice', playerId, message, kind]);
    },
  };
}

function createAutoUsePillPlayer(overrides: Record<string, unknown> = {}) {
  return {
    playerId: 'player:1',
    hp: 42,
    maxHp: 100,
    qi: 30,
    maxQi: 100,
    inventory: {
      items: [{
        itemId: 'pill.minor_heal',
        itemInstanceId: 'auto-pill-minor-heal',
        name: '回春散',
        count: 3,
        healPercent: 0.22,
      }],
    },
    buffs: {
      buffs: [],
    },
    combat: {
      autoUsePills: [{
        itemId: 'pill.minor_heal',
        conditions: [{ type: 'resource_ratio', resource: 'hp', op: 'lt', thresholdPct: 60 }],
      }],
    },
    ...overrides,
  };
}

function testAutoUsePillTriggersBeforeAutoCombatCommandMaterialization(): void {
  const player = createAutoUsePillPlayer();
  const playerRuntimeService = createPlayerRuntimeService(player);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);

  service.materializeAutoUsePills(createAutoUsePillDeps(playerRuntimeService.log) as never);

  assert.deepEqual(playerRuntimeService.log, [
    ['useItemByInstanceId', 'player:1', 'auto-pill-minor-heal'],
    ['refreshQuestStates', 'player:1'],
    ['queuePlayerNotice', 'player:1', '自動使用 回春散', 'success'],
  ]);
  assert.equal(((player.inventory as { items: Array<{ count: number }> }).items[0]?.count), 2);
}

function testAutoUsePillSkipsEmptyConditions(): void {
  const player = createAutoUsePillPlayer({
    combat: {
      autoUsePills: [{
        itemId: 'pill.minor_heal',
        conditions: [],
      }],
    },
  });
  const playerRuntimeService = createPlayerRuntimeService(player);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);

  service.materializeAutoUsePills(createAutoUsePillDeps(playerRuntimeService.log) as never);

  assert.deepEqual(playerRuntimeService.log, []);
}

function testAutoUsePillSkipsWhenManualCommandIsPending(): void {
  const player = createAutoUsePillPlayer();
  const playerRuntimeService = createPlayerRuntimeService(player);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);

  service.materializeAutoUsePills(createAutoUsePillDeps(playerRuntimeService.log, true) as never);

  assert.deepEqual(playerRuntimeService.log, []);
}

function testAutoUseBuffPillTriggersOnlyWhenBuffMissing(): void {
  const player = createAutoUsePillPlayer({
    inventory: {
      items: [{
        itemId: 'pill.crimson_bud_elixir',
        itemInstanceId: 'auto-pill-crimson-bud',
        name: '赤芽丹',
        count: 2,
        consumeBuffs: [{ buffId: 'item_buff.crimson_bud', name: '赤芽生锋', duration: 10 }],
      }],
    },
    buffs: {
      buffs: [{
        buffId: 'item_buff.crimson_bud',
        remainingTicks: 10,
        stacks: 1,
      }],
    },
    combat: {
      autoUsePills: [{
        itemId: 'pill.crimson_bud_elixir',
        conditions: [{ type: 'buff_missing' }],
      }],
    },
  });
  const playerRuntimeService = createPlayerRuntimeService(player);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);

  service.materializeAutoUsePills(createAutoUsePillDeps(playerRuntimeService.log) as never);
  assert.deepEqual(playerRuntimeService.log, []);

  (player.buffs as { buffs: Array<{ remainingTicks: number }> }).buffs[0]!.remainingTicks = 0;
  service.materializeAutoUsePills(createAutoUsePillDeps(playerRuntimeService.log) as never);

  assert.deepEqual(playerRuntimeService.log, [
    ['useItemByInstanceId', 'player:1', 'auto-pill-crimson-bud'],
    ['refreshQuestStates', 'player:1'],
    ['queuePlayerNotice', 'player:1', '自動使用 赤芽丹', 'success'],
  ]);
}

function testAutoCombatDoesNotEnqueueSpentActionCommand(): void {
  const player = createAutoBattlePlayer();
  const enqueueLog: unknown[][] = [];
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);

  service.materializeAutoCombatCommands(createMaterializeDeps(
    createAdjacentMonsterInstance(),
    enqueueLog,
    12,
  ) as never);

  assert.deepEqual(enqueueLog, []);

  player.combat.combatActionTick = 11;
  service.materializeAutoCombatCommands(createMaterializeDeps(
    createAdjacentMonsterInstance(),
    enqueueLog,
    12,
  ) as never);

  assert.equal(enqueueLog.length, 1);
  assert.equal((enqueueLog[0]?.[1] as { kind?: string })?.kind, 'basicAttack');
  assert.equal((enqueueLog[0]?.[1] as { targetMonsterId?: string })?.targetMonsterId, 'monster:1');
}

function testInstanceMaterializationIncludesOfflineMapResidents(): void {
  const player = createAutoBattlePlayer();
  player.combat.combatActionTick = 11;
  player.combat.combatActionsUsedThisTick = 0;
  const enqueueLog: unknown[][] = [];
  const instance = {
    ...createAdjacentMonsterInstance(),
    listPlayerIds() {
      return ['player:1'];
    },
  };
  const deps = {
    ...createMaterializeDeps(instance, enqueueLog, 12),
    listConnectedPlayerIds() {
      return [];
    },
    worldSessionService: {
      listInstancePlayerIds() {
        return [];
      },
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);

  service.materializeAutoCombatCommandsForInstance('public:test_map', deps as never);

  assert.equal(enqueueLog.length, 1, '斷線後仍駐留地圖的玩家必須在按實例調度中物化自動戰鬥命令');
  assert.equal((enqueueLog[0]?.[1] as { targetMonsterId?: string })?.targetMonsterId, 'monster:1');
}

function testMaterializeAutoCombatClearsExpiredRetaliatorBeforeEarlyExit(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    combat: {
      autoBattle: false,
      autoRetaliate: false,
      manualEngagePending: false,
      retaliatePlayerTargetId: 'attacker',
      retaliatePlayerTargetLastAttackTick: 10,
    },
  };
  const enqueueLog: unknown[][] = [];
  const playerRuntimeService = createPlayerRuntimeService(player);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);

  service.materializeAutoCombatCommands(createMaterializeDeps(
    createAdjacentMonsterInstance(),
    enqueueLog,
    1810,
  ) as never);

  assert.deepEqual(playerRuntimeService.log, [
    ['clearRetaliatePlayerTargetIfExpired', 'player:1', 1810],
  ]);
  assert.equal((player.combat as { retaliatePlayerTargetId?: string | null }).retaliatePlayerTargetId, null);
  assert.equal(enqueueLog.length, 0);
}

function testManualEngageFallsBackToMoveWhenOnlyRangedSkillIsOnCooldown(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 3,
        cooldownLeft: 5,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    combat: {
      autoBattle: false,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'monster:1',
      combatTargetLocked: false,
      manualEngagePending: true,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand(createPathingInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 12;
    },
    queuePlayerNotice() {},
  } as never);
  assert.deepEqual(command, {
    kind: 'move',
    direction: 2,
    continuous: true,
    maxSteps: 2,
    path: [{ x: 2, y: 1 }, { x: 3, y: 1 }],
    autoCombat: true,
  });
}

function testAutoBattleSkipsSkillWhenReadyTickIsStillFuture(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 3,
        cooldownLeft: 0,
        cooldownReadyTick: 20,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:ranged',
          cost: 0,
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'monster:1',
      combatTargetLocked: false,
      cooldownReadyTickBySkillId: {
        'skill:ranged': 20,
      },
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand(createAdjacentMonsterInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 12;
    },
    queuePlayerNotice() {},
  } as never);
  assert.deepEqual(command, {
    kind: 'basicAttack',
    targetPlayerId: null,
    targetMonsterId: 'monster:1',
    targetX: null,
    targetY: null,
    autoCombat: true,
  });
}

function testOutOfRangeSkillMovesToSkillMaxRangeImmediately(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 8,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 3,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:ranged',
          cost: 0,
        }],
      }],
    },
    combat: {
      autoBattle: false,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'monster:1',
      combatTargetLocked: false,
      manualEngagePending: true,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand(createLongRangePathingInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 13;
    },
    queuePlayerNotice() {},
  } as never);
  assert.deepEqual(command, {
    kind: 'move',
    direction: 2,
    continuous: true,
    maxSteps: 1,
    path: [{ x: 2, y: 1 }],
    autoCombat: true,
  });
}

function testInRangeButBlockedLineOfSightMovesToCastPosition(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 8,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 5,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:ranged',
          cost: 0,
          range: 5,
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'monster:1',
      combatTargetLocked: true,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand({
    template: { width: 8, height: 4 },
    meta: { instanceId: 'public:test_map' },
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 8, height: 4 },
        visiblePlayers: [],
        localMonsters: [{
          runtimeId: 'monster:1',
          x: 6,
          y: 1,
          hp: 20,
        }],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster() {
      return {
        runtimeId: 'monster:1',
        x: 6,
        y: 1,
        hp: 20,
        maxHp: 20,
        alive: true,
      };
    },
    canSeeTileFrom(originX: number, originY: number, targetX: number, targetY: number, radius: number) {
      assert.deepEqual([targetX, targetY, radius], [6, 1, 5]);
      return originX === 2 && originY === 1;
    },
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 4;
    },
    toTileIndex(x: number, y: number) {
      return y * 8 + x;
    },
    isWalkable(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 4;
    },
    forEachPathingBlocker(_playerId: string, _callback: (x: number, y: number) => void) {},
    getTileTraversalCost() {
      return 1;
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 24;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'move',
    direction: 2,
    continuous: true,
    maxSteps: 1,
    path: [{ x: 2, y: 1 }],
    autoCombat: true,
  });
}

function testUnreachableCurrentTargetIsPenalizedAndRetargetedImmediately(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 8,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 5,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:ranged',
          cost: 0,
          range: 5,
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'monster:far',
      combatTargetLocked: true,
      manualEngagePending: false,
    },
  };
  const playerRuntimeService = createPlayerRuntimeService(player);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);
  const command = service.buildAutoCombatCommand({
    template: { width: 8, height: 4 },
    meta: { instanceId: 'public:test_map' },
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 8, height: 4 },
        visiblePlayers: [],
        localMonsters: [
          { runtimeId: 'monster:far', x: 6, y: 1, hp: 20 },
          { runtimeId: 'monster:near', x: 1, y: 2, hp: 20 },
        ],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster(runtimeId: string) {
      if (runtimeId === 'monster:far') {
        return {
          runtimeId,
          x: 6,
          y: 1,
          hp: 20,
          maxHp: 20,
          alive: true,
        };
      }
      if (runtimeId === 'monster:near') {
        return {
          runtimeId,
          x: 1,
          y: 2,
          hp: 20,
          maxHp: 20,
          alive: true,
          aggroTargetPlayerId: 'player:1',
        };
      }
      return null;
    },
    canSeeTileFrom(originX: number, originY: number, targetX: number, targetY: number) {
      return originX === 1 && originY === 1 && targetX === 1 && targetY === 2;
    },
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 4;
    },
    toTileIndex(x: number, y: number) {
      return y * 8 + x;
    },
    isWalkable(x: number, y: number) {
      return x === 1 && y === 1;
    },
    forEachPathingBlocker(_playerId: string, _callback: (x: number, y: number) => void) {},
    getTileTraversalCost(x: number, y: number) {
      return x === 1 && y === 1 ? 1 : Number.POSITIVE_INFINITY;
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 25;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:ranged',
    targetPlayerId: null,
    targetMonsterId: 'monster:near',
    targetRef: null,
    autoCombat: true,
  });
  assert.deepEqual(playerRuntimeService.log, [
    ['clearManualEngagePending', 'player:1'],
    ['clearCombatTarget', 'player:1', 25],
    ['setCombatTarget', 'player:1', 'monster:near', false, 25],
  ]);
}

function testStationaryOutOfRangeSkillSkipsWithoutMove(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 8,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 3,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:ranged',
          cost: 0,
        }],
      }],
    },
    combat: {
      autoBattle: false,
      autoRetaliate: false,
      autoBattleStationary: true,
      combatTargetId: 'monster:1',
      combatTargetLocked: false,
      manualEngagePending: true,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand(createLongRangePathingInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 14;
    },
    queuePlayerNotice() {},
  } as never);
  assert.equal(command, null);
}

function testStationaryOutOfRangeFirstSkillFallsThroughToLaterInRangeSkill(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 8,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:short',
        type: 'skill',
        range: 3,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }, {
        id: 'skill:long',
        type: 'skill',
        range: 5,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:short',
          cost: 0,
          range: 3,
        }, {
          id: 'skill:long',
          cost: 0,
          range: 5,
        }],
      }],
    },
    combat: {
      autoBattle: false,
      autoRetaliate: false,
      autoBattleStationary: true,
      combatTargetId: 'monster:1',
      combatTargetLocked: false,
      manualEngagePending: true,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand(createLongRangePathingInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 14;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:long',
    targetPlayerId: null,
    targetMonsterId: 'monster:1',
    targetRef: null,
    autoCombat: true,
  });
}

function testStationaryOutOfRangeFarTargetRetargetsAdjacentHittableSameTick(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 8,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 3,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:ranged',
          cost: 0,
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: true,
      autoBattleTargetingMode: 'auto',
      combatTargetId: 'monster:far',
      combatTargetLocked: false,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  seedFarMonsterThreat(service, 14);
  const command = service.buildAutoCombatCommand(createFarAndAdjacentMonsterInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 14;
    },
    queuePlayerNotice() {},
  } as never);
  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:ranged',
    targetPlayerId: null,
    targetMonsterId: 'monster:near',
    targetRef: null,
    autoCombat: true,
  });
}

function testNearestPrefersHittableAdjacentOverFarHighThreat(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 8,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 5,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:ranged',
          cost: 0,
          range: 5,
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      autoBattleTargetingMode: 'nearest',
      combatTargetId: 'monster:far',
      combatTargetLocked: false,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  seedFarMonsterThreat(service, 15);
  const command = service.buildAutoCombatCommand(createFarAndAdjacentMonsterInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 15;
    },
    queuePlayerNotice() {},
  } as never);
  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:ranged',
    targetPlayerId: null,
    targetMonsterId: 'monster:near',
    targetRef: null,
    autoCombat: true,
  });
}

function createSkillFallbackInstance(canSeeTileFrom: (radius: number) => boolean, monsterX = 1, monsterY = 5) {
  return {
    template: { width: 8, height: 8 },
    meta: { instanceId: 'public:test_map' },
    isPointInSafeZone() {
      return false;
    },
    isSafeZoneTile() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 8, height: 8 },
        visiblePlayers: [],
        localMonsters: [{
          runtimeId: 'monster:1',
          x: monsterX,
          y: monsterY,
          hp: 20,
        }],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster(runtimeId: string) {
      assert.equal(runtimeId, 'monster:1');
      return {
        runtimeId: 'monster:1',
        x: monsterX,
        y: monsterY,
        hp: 20,
        maxHp: 20,
        alive: true,
      };
    },
    canSeeTileFrom(_originX: number, _originY: number, _targetX: number, _targetY: number, radius: number) {
      return canSeeTileFrom(radius);
    },
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 8;
    },
    toTileIndex(x: number, y: number) {
      return y * 8 + x;
    },
    isWalkable(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 8;
    },
    forEachPathingBlocker(_playerId: string, _callback: (x: number, y: number) => void) {},
    getTileTraversalCost() {
      return 1;
    },
  };
}

function createSkillFallbackPlayer(stationary: boolean, includeSelfCastArea: boolean) {
  const actions: Array<Record<string, unknown>> = [
    {
      id: 'skill:short',
      type: 'skill',
      range: 1,
      cooldownLeft: 0,
      autoBattleEnabled: true,
      skillEnabled: true,
    },
    {
      id: 'skill:long',
      type: 'skill',
      range: 6,
      cooldownLeft: 0,
      autoBattleEnabled: true,
      skillEnabled: true,
    },
  ];
  const skills: Array<Record<string, unknown>> = [
    { id: 'skill:short', name: '短擊訣', cost: 0, range: 1 },
    { id: 'skill:long', name: '長鞭術', cost: 0, range: 6 },
  ];
  if (includeSelfCastArea) {
    actions.push({
      id: 'skill:self-area',
      type: 'skill',
      range: 0,
      cooldownLeft: 0,
      autoBattleEnabled: true,
      skillEnabled: true,
    });
    skills.push({
      id: 'skill:self-area',
      name: '原地劫焰',
      cost: 0,
      requiresTarget: false,
      range: 0,
      targeting: { shape: 'box', width: 9, height: 9, maxTargets: 81 },
      effects: [{ type: 'damage', formula: 1 }],
    });
  }
  return {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 8,
        maxQiOutputPerTick: 100,
      },
    },
    actions: { actions },
    techniques: {
      techniques: [{
        skills,
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: stationary,
      autoBattleTargetingMode: 'nearest',
      combatTargetId: 'monster:1',
      combatTargetLocked: false,
      manualEngagePending: false,
    },
  };
}

function createSkillFallbackDeps(now: number) {
  return {
    resolveCurrentTickForPlayerId() {
      return now;
    },
    queuePlayerNotice() {},
  };
}

function seedSkillFallbackThreat(service: WorldRuntimeAutoCombatService, now: number): void {
  const threatService = service.worldRuntimeThreatService;
  threatService.addThreat(threatService.buildPlayerOwnerId('player:1'), 'monster:1', {
    baseThreat: 100000,
    distance: 4,
    extraAggroRate: 0,
    now,
  });
}

function testStationaryOutOfRangeFirstSkillCastsLongerSkillOnSameTarget(): void {
  const player = createSkillFallbackPlayer(true, false);
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  seedSkillFallbackThreat(service, 20);
  const command = service.buildAutoCombatCommand(
    createSkillFallbackInstance(() => true) as never,
    player as never,
    createSkillFallbackDeps(20) as never,
  );
  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:long',
    targetPlayerId: null,
    targetMonsterId: 'monster:1',
    targetRef: null,
    autoCombat: true,
  });
}

function testMobileOutOfRangeFirstSkillCastsLongerSkillOnSameTarget(): void {
  const player = createSkillFallbackPlayer(false, false);
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  seedSkillFallbackThreat(service, 20);
  const command = service.buildAutoCombatCommand(
    createSkillFallbackInstance(() => true) as never,
    player as never,
    createSkillFallbackDeps(20) as never,
  );
  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:long',
    targetPlayerId: null,
    targetMonsterId: 'monster:1',
    targetRef: null,
    autoCombat: true,
  });
}

function testStationaryBlockedSightFallsBackToSelfCastAreaOnSameTarget(): void {
  // 指向型技能視線全被遮擋時，原地 AOE（9x9，覆蓋半徑 4）能打中距離 4 的同一目標，不應發呆
  const player = createSkillFallbackPlayer(true, true);
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  seedSkillFallbackThreat(service, 21);
  const command = service.buildAutoCombatCommand(
    createSkillFallbackInstance(() => false) as never,
    player as never,
    createSkillFallbackDeps(21) as never,
  );
  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:self-area',
    targetPlayerId: null,
    targetMonsterId: null,
    targetRef: null,
    autoCombat: true,
  });
}

function testMobileBlockedSightFallsBackToSelfCastAreaOnSameTarget(): void {
  const player = createSkillFallbackPlayer(false, true);
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  seedSkillFallbackThreat(service, 21);
  const command = service.buildAutoCombatCommand(
    createSkillFallbackInstance(() => false) as never,
    player as never,
    createSkillFallbackDeps(21) as never,
  );
  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:self-area',
    targetPlayerId: null,
    targetMonsterId: null,
    targetRef: null,
    autoCombat: true,
  });
}

function testShortSkillBlindedButLongerSkillSeesTargetCastsLongSkill(): void {
  // 視線檢查以技能射程封頂：短技(1)看不清、長技(6)看得見同一目標 → 放長技
  for (const stationary of [true, false]) {
    const player = createSkillFallbackPlayer(stationary, false);
    const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
    seedSkillFallbackThreat(service, 22);
    const command = service.buildAutoCombatCommand(
      createSkillFallbackInstance((radius) => radius >= 6, 2, 1) as never,
      player as never,
      createSkillFallbackDeps(22) as never,
    );
    assert.deepEqual(command, {
      kind: 'castSkill',
      skillId: 'skill:long',
      targetPlayerId: null,
      targetMonsterId: 'monster:1',
      targetRef: null,
      autoCombat: true,
    }, `stationary=${stationary}`);
  }
}

function testAutoBattleSkipsSelfBuffSkillWithoutTarget(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    buffs: {
      buffs: [],
    },
    actions: {
      actions: [{
        id: 'skill:guard',
        type: 'skill',
        range: 1,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:guard',
          name: '护体术',
          cost: 0,
          requiresTarget: false,
          range: 1,
          effects: [{
            type: 'buff',
            target: 'self',
            buffId: 'buff:guard',
            name: '护体',
            duration: 10,
          }],
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: null,
      combatTargetLocked: false,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand({
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 15;
    },
    queuePlayerNotice() {},
  } as never);

  assert.equal(command, null);
}

function testAutoBattleCastsMissingSelfBuffSkillWithTarget(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    buffs: {
      buffs: [],
    },
    actions: {
      actions: [{
        id: 'skill:guard',
        type: 'skill',
        range: 1,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:guard',
          name: '护体术',
          cost: 0,
          requiresTarget: false,
          range: 1,
          effects: [{
            type: 'buff',
            target: 'self',
            buffId: 'buff:guard',
            name: '护体',
            duration: 10,
          }],
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: null,
      combatTargetLocked: false,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand(createAdjacentMonsterInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 15;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:guard',
    targetPlayerId: null,
    targetMonsterId: null,
    targetRef: null,
    autoCombat: true,
  });
}

function testAutoBattleCastsSelfAnchoredAreaSkillWithTarget(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:self-area',
        type: 'skill',
        range: 0,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:self-area',
          name: '原地劫焰',
          cost: 0,
          requiresTarget: false,
          range: 0,
          targeting: { shape: 'box', width: 5, height: 5, maxTargets: 25 },
          effects: [{ type: 'damage', formula: 1 }],
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: null,
      combatTargetLocked: false,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand(createAdjacentMonsterInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 17;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'castSkill',
    skillId: 'skill:self-area',
    targetPlayerId: null,
    targetMonsterId: null,
    targetRef: null,
    autoCombat: true,
  });
}

function testActionRangeCannotOverruleSkillGeometryForChase(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 8,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 4,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:ranged',
          name: '飞剑术',
          cost: 0,
          range: 3,
          effects: [{ type: 'damage', formula: 1 }],
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'monster:1',
      combatTargetLocked: true,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand(createLongRangePathingInstance() as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 18;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'move',
    direction: 2,
    continuous: true,
    maxSteps: 1,
    path: [{ x: 2, y: 1 }],
    autoCombat: true,
  });
}

function testAutoBattleSkipsSelfBuffSkillWhenBuffActive(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    buffs: {
      buffs: [{
        buffId: 'buff:guard',
        name: '护体',
        remainingTicks: 5,
        stacks: 1,
      }],
    },
    actions: {
      actions: [{
        id: 'skill:guard',
        type: 'skill',
        range: 4,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    techniques: {
      techniques: [{
        skills: [{
          id: 'skill:guard',
          name: '护体术',
          cost: 0,
          requiresTarget: false,
          range: 4,
          effects: [{
            type: 'buff',
            target: 'self',
            buffId: 'buff:guard',
            name: '护体',
            duration: 10,
          }],
        }],
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: null,
      combatTargetLocked: false,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand({
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 16;
    },
    queuePlayerNotice() {},
  } as never);

  assert.equal(command, null);
}

function testStopDistancePathDoesNotGenerateRangeCandidateGrid(): void {
  const { instance, getBoundsChecks } = createWidePathingInstance();
  const path = findPathToTargetWithinRangeOnMap(
    instance as never,
    'player:1',
    1,
    1,
    25,
    1,
    20,
    false,
  );
  assert.deepEqual(path?.points, [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 5, y: 1 },
  ]);
  assert.ok(getBoundsChecks() < 400, `unexpected range-grid-like bounds checks: ${getBoundsChecks()}`);
}

function testAutoCombatPathCacheDoesNotSkipUnresolvedFirstStep(): void {
  const { instance } = createCachedChasePathingInstance();
  const player = {
    playerId: 'player:1',
    x: 1,
    y: 1,
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const first = service.findPathWithCache(instance as never, player as never, 5, 1, 1);
  assert.deepEqual(first?.points, [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
  ]);

  const second = service.findPathWithCache(instance as never, player as never, 5, 1, 1);
  assert.deepEqual(second?.points, [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
  ]);
}

function testAutoCombatPathCacheReplansWhenNextStepBecomesBlocked(): void {
  const { instance, block } = createCachedChasePathingInstance();
  const player = {
    playerId: 'player:1',
    x: 1,
    y: 1,
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const first = service.findPathWithCache(instance as never, player as never, 5, 1, 1);
  assert.equal(first?.points[0]?.x, 2);
  assert.equal(first?.points[0]?.y, 1);

  player.x = 2;
  block(3, 1);
  const second = service.findPathWithCache(instance as never, player as never, 5, 1, 1);
  assert.notDeepEqual(second?.points[0], { x: 3, y: 1 });
  assert.equal(Math.abs((second?.points[0]?.x ?? 0) - player.x) + Math.abs((second?.points[0]?.y ?? 0) - player.y), 1);
}

function testStopDistancePathUsesStaticObstacleIgnoreOption(): void {
  const instance = createStaticObstaclePathingInstance();
  const blocked = findPathToTargetWithinRangeOnMap(
    instance as never,
    'player:1',
    1,
    1,
    4,
    1,
    1,
    false,
  );
  assert.equal(blocked, null);

  const ignored = findPathToTargetWithinRangeOnMap(
    instance as never,
    'player:1',
    1,
    1,
    4,
    1,
    1,
    false,
    undefined,
    { allowIgnoreStaticObstacle: true },
  );
  assert.deepEqual(ignored?.points, [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ]);
}

function testLockedDestroyedTileClearsTarget(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'tile:2:1',
      combatTargetLocked: true,
      manualEngagePending: false,
    },
  };
  const playerRuntimeService = createPlayerRuntimeService(player);
  const notices: unknown[][] = [];
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);
  const command = service.buildAutoCombatCommand({
    meta: {
      canDamageTile: true,
    },
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getTileCombatState(x: number, y: number) {
      assert.deepEqual([x, y], [2, 1]);
      return {
        hp: 0,
        maxHp: 100,
        destroyed: true,
      };
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 19;
    },
    queuePlayerNotice(playerId: string, text: string, kind: string) {
      notices.push([playerId, text, kind]);
    },
  } as never);

  assert.equal(command, null);
  assert.deepEqual(playerRuntimeService.log, [
    ['clearCombatTarget', 'player:1', 19],
  ]);
  assert.deepEqual(notices, []);
}

function testLockedHerbTileContinuesBasicAttack(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: {
      actions: [{
        id: 'skill:ranged',
        type: 'skill',
        range: 3,
        cooldownLeft: 0,
        autoBattleEnabled: true,
        skillEnabled: true,
      }],
    },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'tile:2:1',
      combatTargetLocked: true,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand({
    meta: {
      canDamageTile: true,
    },
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getContainerAtTile(x: number, y: number) {
      assert.deepEqual([x, y], [2, 1]);
      return {
        id: 'herb:1',
        variant: 'herb',
        name: '灵草',
      };
    },
    getTileCombatState() {
      return null;
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 21;
    },
    worldRuntimeLootContainerService: {
      getAttackableContainerCombatStateAtTile(instanceId: string, container: Record<string, unknown>, currentTick: number) {
        assert.equal(instanceId, 'public:test_map');
        assert.equal(container.id, 'herb:1');
        assert.equal(currentTick, 21);
        return {
          kind: 'container',
          id: 'herb:1',
          hp: 2,
          supportsSkill: false,
        };
      },
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'basicAttack',
    targetPlayerId: null,
    targetMonsterId: null,
    targetX: 2,
    targetY: 1,
    autoCombat: true,
  });
}

function testRetaliatePlayerPreemptsLockedMiningTileWithoutClearingLock(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: { actions: [] },
    combat: {
      autoBattle: true,
      autoRetaliate: true,
      autoBattleStationary: false,
      combatTargetId: 'tile:2:1',
      combatTargetLocked: true,
      retaliatePlayerTargetId: 'attacker',
      manualEngagePending: false,
    },
  };
  const attacker = {
    playerId: 'attacker',
    hp: 100,
    maxHp: 100,
    x: 2,
    y: 1,
    instanceId: 'public:test_map',
    combat: {},
  };
  const playerRuntimeService = createPlayerRuntimeService(player, [attacker]);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);
  const command = service.buildAutoCombatCommand({
    meta: {
      instanceId: 'public:test_map',
      supportsPvp: true,
      canDamageTile: true,
    },
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 24;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'basicAttack',
    targetPlayerId: 'attacker',
    targetMonsterId: null,
    targetX: null,
    targetY: null,
    autoCombat: true,
  });
  assert.equal((player.combat as { combatTargetId: string }).combatTargetId, 'tile:2:1');
  assert.equal((player.combat as { combatTargetLocked: boolean }).combatTargetLocked, true);
  assert.deepEqual(playerRuntimeService.log, []);
}

function testThreatPlayerTargetFallsBackToBasicAttackWithPlayerId(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    maxHp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 0,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: { actions: [] },
    combat: {
      autoBattle: true,
      autoRetaliate: true,
      autoBattleStationary: false,
      autoBattleTargetingMode: 'player',
      allowAoePlayerHit: true,
      manualEngagePending: false,
    },
  };
  const target = {
    playerId: 'duel',
    hp: 100,
    maxHp: 100,
    x: 2,
    y: 2,
    instanceId: 'public:test_map',
    combat: {},
  };
  const playerRuntimeService = createPlayerRuntimeService(player, [target]);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);
  const command = service.buildAutoCombatCommand({
    meta: {
      instanceId: 'public:test_map',
      supportsPvp: true,
    },
    isPointInSafeZone() {
      return false;
    },
    canSeeTileFrom() {
      return true;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [{ playerId: 'duel' }],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 31;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'basicAttack',
    targetPlayerId: 'duel',
    targetMonsterId: null,
    targetX: null,
    targetY: null,
    autoCombat: true,
  });
  assert.deepEqual(playerRuntimeService.log, [
    ['setCombatTarget', 'player:1', 'player:duel', false, 31],
  ]);
}

function testNonPvpInstanceSkipsAndClearsPlayerAutoTarget(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    maxHp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 0,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: { actions: [] },
    combat: {
      autoBattle: true,
      autoRetaliate: true,
      autoBattleStationary: false,
      autoBattleTargetingMode: 'player',
      allowAoePlayerHit: true,
      combatTargetId: 'player:duel',
      combatTargetLocked: false,
      manualEngagePending: false,
    },
  };
  const target = {
    playerId: 'duel',
    hp: 100,
    maxHp: 100,
    x: 2,
    y: 2,
    instanceId: 'public:test_map',
    combat: {},
  };
  const threatService = new WorldRuntimeThreatService();
  threatService.addThreat(threatService.buildPlayerOwnerId('player:1'), threatService.buildPlayerTargetId('duel'), {
    baseThreat: 100,
    distance: 1,
    now: 32,
  });
  const playerRuntimeService = createPlayerRuntimeService(player, [target]);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never, threatService as never);
  const command = service.buildAutoCombatCommand({
    meta: {
      instanceId: 'public:test_map',
      supportsPvp: false,
    },
    isPointInSafeZone() {
      return false;
    },
    canSeeTileFrom() {
      return true;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [{ playerId: 'duel' }],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 32;
    },
    queuePlayerNotice() {},
  } as never);

  assert.equal(command, null);
  assert.deepEqual(playerRuntimeService.log, [
    ['clearCombatTarget', 'player:1', 32],
  ]);
}

function testRetaliatePlayerDoesNotPreemptLockedPlayerTarget(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: { actions: [] },
    combat: {
      autoBattle: true,
      autoRetaliate: true,
      autoBattleStationary: false,
      combatTargetId: 'player:duel',
      combatTargetLocked: true,
      retaliatePlayerTargetId: 'attacker',
      allowAoePlayerHit: true,
      manualEngagePending: false,
    },
  };
  const duelTarget = {
    playerId: 'duel',
    hp: 100,
    maxHp: 100,
    x: 2,
    y: 1,
    instanceId: 'public:test_map',
    combat: {},
  };
  const attacker = {
    playerId: 'attacker',
    hp: 100,
    maxHp: 100,
    x: 1,
    y: 2,
    instanceId: 'public:test_map',
    combat: {},
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player, [duelTarget, attacker]) as never);
  const command = service.buildAutoCombatCommand({
    meta: {
      instanceId: 'public:test_map',
      supportsPvp: true,
    },
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 25;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'basicAttack',
    targetPlayerId: 'duel',
    targetMonsterId: null,
    targetX: null,
    targetY: null,
    autoCombat: true,
  });
}

function testLockedDepletedHerbTileClearsTarget(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: { actions: [] },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'tile:2:1',
      combatTargetLocked: true,
      manualEngagePending: false,
    },
  };
  const playerRuntimeService = createPlayerRuntimeService(player);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);
  const command = service.buildAutoCombatCommand({
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getContainerAtTile() {
      return {
        id: 'herb:1',
        variant: 'herb',
        name: '灵草',
      };
    },
    getTileCombatState() {
      return null;
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 22;
    },
    worldRuntimeLootContainerService: {
      getAttackableContainerCombatStateAtTile() {
        return null;
      },
    },
    queuePlayerNotice() {},
  } as never);

  assert.equal(command, null);
  assert.deepEqual(playerRuntimeService.log, [
    ['clearCombatTarget', 'player:1', 22],
  ]);
}

function testLockedFormationContinuesBasicAttack(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: { actions: [] },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'formation:earth:1',
      combatTargetLocked: true,
      manualEngagePending: false,
    },
  };
  const service = new WorldRuntimeAutoCombatService(createPlayerRuntimeService(player) as never);
  const command = service.buildAutoCombatCommand({
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 4, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster() {
      return null;
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 23;
    },
    worldRuntimeFormationService: {
      getAttackableEntityCombatState(instanceId: string, formationId: string) {
        assert.equal(instanceId, 'public:test_map');
        assert.equal(formationId, 'formation:earth:1');
        return {
          kind: 'formation',
          id: 'formation:earth:1',
          targetRef: 'formation:earth:1',
          targetMonsterId: 'formation:earth:1',
          name: '厚土阵',
          x: 2,
          y: 1,
          hp: 1000,
          supportsSkill: true,
        };
      },
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'basicAttack',
    targetPlayerId: null,
    targetMonsterId: 'formation:earth:1',
    targetX: null,
    targetY: null,
    autoCombat: true,
  });
}

function testLockedMiningTileOutsideViewRangeMovesBack(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 2,
        maxQiOutputPerTick: 100,
      },
    },
    actions: { actions: [] },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'tile:8:1',
      combatTargetLocked: true,
      manualEngagePending: false,
    },
    miningJob: {
      jobRunId: 'mining:job:outside-view',
      targetX: 8,
      targetY: 1,
    },
  };
  const playerRuntimeService = createPlayerRuntimeService(player);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);
  const command = service.buildAutoCombatCommand({
    template: {
      width: 12,
      height: 4,
    },
    meta: {
      instanceId: 'public:test_map',
      canDamageTile: true,
    },
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: 1, y: 1 },
        instance: { width: 12, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster() {
      return null;
    },
    getTileCombatState(x: number, y: number) {
      assert.equal(x, 8);
      assert.equal(y, 1);
      return {
        tileType: 'black_iron_ore',
        hp: 10,
        maxHp: 10,
        destroyed: false,
      };
    },
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 12 && y < 4;
    },
    toTileIndex(x: number, y: number) {
      return y * 12 + x;
    },
    isWalkable(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 12 && y < 4 && !(x === 8 && y === 1);
    },
    forEachPathingBlocker(_playerId: string, _callback: (x: number, y: number) => void) {},
    getTileTraversalCost(x: number, y: number) {
      return x === 8 && y === 1 ? Number.POSITIVE_INFINITY : 1;
    },
  } as never, player as never, {
    resolveCurrentTickForPlayerId() {
      return 31;
    },
    queuePlayerNotice() {},
  } as never);

  assert.deepEqual(command, {
    kind: 'move',
    direction: 2,
    continuous: true,
    maxSteps: 6,
    path: [
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 5, y: 1 },
      { x: 6, y: 1 },
      { x: 7, y: 1 },
    ],
    autoCombat: true,
    miningJobRunId: 'mining:job:outside-view',
    miningTargetRef: 'tile:8:1',
  });
  assert.deepEqual(playerRuntimeService.log, []);
}

function testLockedFormationBoundaryMovesAndAttacksFromOutside(): void {
  const player = {
    playerId: 'player:1',
    hp: 100,
    x: 1,
    y: 1,
    instanceId: 'public:test_map',
    qi: 100,
    attrs: {
      numericStats: {
        viewRange: 6,
        maxQiOutputPerTick: 100,
      },
    },
    actions: { actions: [] },
    combat: {
      autoBattle: true,
      autoRetaliate: false,
      autoBattleStationary: false,
      combatTargetId: 'tile:5:1',
      combatTargetLocked: true,
      manualEngagePending: false,
    },
  };
  const playerRuntimeService = createPlayerRuntimeService(player);
  const service = new WorldRuntimeAutoCombatService(playerRuntimeService as never);
  const instance = {
    template: { width: 8, height: 4 },
    meta: { instanceId: 'public:test_map', canDamageTile: true },
    isPointInSafeZone() {
      return false;
    },
    buildPlayerView() {
      return {
        playerId: 'player:1',
        self: { x: player.x, y: player.y },
        instance: { width: 8, height: 4 },
        visiblePlayers: [],
        localMonsters: [],
        localNpcs: [],
        localPortals: [],
        localGroundPiles: [],
      };
    },
    getMonster() {
      return null;
    },
    getTileCombatState() {
      return null;
    },
    getContainerAtTile() {
      return null;
    },
    canSeeTileFrom() {
      return true;
    },
    isInBounds(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 4;
    },
    toTileIndex(x: number, y: number) {
      return y * 8 + x;
    },
    isDynamicallyBlockedTile(x: number, y: number) {
      return x === 5 && y === 1;
    },
    isWalkable(x: number, y: number) {
      return x >= 0 && y >= 0 && x < 8 && y < 4 && !(x === 5 && y === 1);
    },
    forEachPathingBlocker(_playerId: string, callback: (x: number, y: number) => void) {
      callback(5, 1);
    },
    getTileTraversalCost() {
      return 1;
    },
  };
  const deps = {
    resolveCurrentTickForPlayerId() {
      return 32;
    },
    worldRuntimeFormationService: {
      getAttackableTileCombatState(instanceId: string, x: number, y: number) {
        assert.equal(instanceId, 'public:test_map');
        assert.deepEqual([x, y], [5, 1]);
        return {
          kind: 'formation_boundary',
          id: 'formation-boundary:warding:5:1',
          name: '太玄封界阵',
          hp: 1000,
          supportsSkill: true,
        };
      },
    },
    queuePlayerNotice() {},
  };

  const moveCommand = service.buildAutoCombatCommand(instance as never, player as never, deps as never);
  assert.deepEqual(moveCommand, {
    kind: 'move',
    direction: 2,
    continuous: true,
    maxSteps: 3,
    path: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
    autoCombat: true,
  });

  player.x = 4;
  const attackCommand = service.buildAutoCombatCommand(instance as never, player as never, deps as never);
  assert.deepEqual(attackCommand, {
    kind: 'basicAttack',
    targetPlayerId: null,
    targetMonsterId: null,
    targetX: 5,
    targetY: 1,
    autoCombat: true,
  });
  assert.deepEqual(playerRuntimeService.log, []);
}

testAutoCombatDoesNotEnqueueSpentActionCommand();
testInstanceMaterializationIncludesOfflineMapResidents();
testManualEngageFallsBackToMoveWhenOnlyRangedSkillIsOnCooldown();
testAutoBattleSkipsSkillWhenReadyTickIsStillFuture();
testOutOfRangeSkillMovesToSkillMaxRangeImmediately();
testInRangeButBlockedLineOfSightMovesToCastPosition();
testUnreachableCurrentTargetIsPenalizedAndRetargetedImmediately();
testStationaryOutOfRangeSkillSkipsWithoutMove();
testStationaryOutOfRangeFirstSkillFallsThroughToLaterInRangeSkill();
testStationaryOutOfRangeFarTargetRetargetsAdjacentHittableSameTick();
testNearestPrefersHittableAdjacentOverFarHighThreat();
testStationaryOutOfRangeFirstSkillCastsLongerSkillOnSameTarget();
testMobileOutOfRangeFirstSkillCastsLongerSkillOnSameTarget();
testStationaryBlockedSightFallsBackToSelfCastAreaOnSameTarget();
testMobileBlockedSightFallsBackToSelfCastAreaOnSameTarget();
testShortSkillBlindedButLongerSkillSeesTargetCastsLongSkill();
testAutoBattleSkipsSelfBuffSkillWithoutTarget();
testAutoBattleCastsMissingSelfBuffSkillWithTarget();
testAutoBattleCastsSelfAnchoredAreaSkillWithTarget();
testActionRangeCannotOverruleSkillGeometryForChase();
testAutoBattleSkipsSelfBuffSkillWhenBuffActive();
testStopDistancePathDoesNotGenerateRangeCandidateGrid();
testAutoCombatPathCacheDoesNotSkipUnresolvedFirstStep();
testAutoCombatPathCacheReplansWhenNextStepBecomesBlocked();
testStopDistancePathUsesStaticObstacleIgnoreOption();
testLockedDestroyedTileClearsTarget();
testLockedHerbTileContinuesBasicAttack();
testRetaliatePlayerPreemptsLockedMiningTileWithoutClearingLock();
testThreatPlayerTargetFallsBackToBasicAttackWithPlayerId();
testNonPvpInstanceSkipsAndClearsPlayerAutoTarget();
testRetaliatePlayerDoesNotPreemptLockedPlayerTarget();
testLockedDepletedHerbTileClearsTarget();
testLockedFormationContinuesBasicAttack();
testLockedMiningTileOutsideViewRangeMovesBack();
testLockedFormationBoundaryMovesAndAttacksFromOutside();
testAutoUsePillTriggersBeforeAutoCombatCommandMaterialization();
testAutoUsePillSkipsEmptyConditions();
testAutoUsePillSkipsWhenManualCommandIsPending();
testAutoUseBuffPillTriggersOnlyWhenBuffMissing();
testMaterializeAutoCombatClearsExpiredRetaliatorBeforeEarlyExit();

console.log(JSON.stringify({
  ok: true,
  case: 'world-runtime-auto-combat',
  answers: '自動戰鬥物化不依賴線上 session，離線地圖居民仍可生成攻擊指令；自動戰鬥不會在本 tick 行動次數已滿時繼續物化必然失敗的攻擊指令；一次性接戰按第一個當前可用技能決定停止距離，自動戰鬥沒有技能在射程內時按最長可用技能射程決定追擊停止距離，目標已在射程內但視線被遮擋時，會改用其他打得到同一目標的自動戰鬥技能（原地 AOE 或視距更長的技能），沒有替代才尋路找可釋放站位；自動追擊路徑快取不會在上一段移動未真正落位時跳過首步，快取下一步被動態佔位後會重新規劃，且追擊尋路會沿用玩家忽略靜態障礙能力；當前鎖定目標不可達時只對該目標做一次 80% 仇恨降權、清理當前目標並立即重選；普通自動戰鬥每 tick 按即時仇恨重算目標，只有明確鎖定或一次性接戰才優先沿用 tracked target；原地戰鬥當前目標站著打不中且身邊有打得到的怪時同一息改打鄰格，沒有打得到的候選才發呆；近處優先在站著打得到的目標裡永遠選最近，仇恨只拆同距離平手；原地戰鬥會按 AOE 覆蓋半徑作為停止距離；無需目標的自身 buff 技能只有在存在有效自動戰鬥目標且缺少對應 buff 時才會按自動技能順序原地施放，已有 buff 時不會重複刷也不會把 buff 技能當成追擊距離；鎖定目標失效後只清理當前目標鎖，不關閉自動戰鬥、不發遺失提示；鎖定草藥、挖礦和陣法會在未清空或未摧毀前繼續生成下一次攻擊；自動反擊會臨時搶佔非玩家鎖定目標並保留原鎖定，明確鎖定玩家時不擅自切目標，且仇敵 30 分鐘未續攻會在 tick 內過期；自動丹藥會按資源閾值或缺 Buff 條件在 tick 受控流程內使用，空條件不觸發，已有 pending command 時不改動背包槽位。',
}, null, 2));
