// @ts-nocheck

const assert = require("node:assert/strict");

const { Direction, getMaxStoredMovePoints } = require("@mud/shared");
const { MapInstanceRuntime } = require("../runtime/instance/map-instance.runtime");
const { MapTemplateRepository } = require("../runtime/map/map-template.repository");
const { WorldRuntimeMovementService } = require("../runtime/world/world-runtime-movement.service");
const { WorldRuntimeNavigationService } = require("../runtime/world/world-runtime-navigation.service");
/**
 * buildDeps：构建并返回目标对象。
 * @param log 参数说明。
 * @returns 无返回值，直接更新Dep相关状态。
 */


function buildDeps(log) {
    const playerLocations = new Map([['player:1', { instanceId: 'instance:1', sessionId: 'session:1' }]]);
    const instanceRuntimes = new Map([['instance:1', {    
    /**
 * setPlayerMoveSpeed：写入玩家MoveSpeed。
 * @param playerId 玩家 ID。
 * @param speed 参数说明。
 * @returns 无返回值，直接更新玩家MoveSpeed相关状态。
 */

        setPlayerMoveSpeed(playerId, speed) { log.push(['setPlayerMoveSpeed', playerId, speed]); },        
        /**
 * enqueueMove：处理Move并更新相关状态。
 * @param payload 载荷参数。
 * @returns 无返回值，直接更新Move相关状态。
 */

        enqueueMove(payload) { log.push(['enqueueMove', payload]); },        
        /**
 * tryPortalTransfer：执行try传送门Transfer相关逻辑。
 * @param playerId 玩家 ID。
 * @param mode 参数说明。
 * @returns 无返回值，直接更新tryPortalTransfer相关状态。
 */

        tryPortalTransfer(playerId, mode) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

            log.push(['tryPortalTransfer', playerId, mode]);
            if (mode === 'manual_portal') {
                return null;
            }
            return { fromInstanceId: 'instance:1', targetMapId: 'yunlai_town', targetX: 8, targetY: 9, playerId, sessionId: 'session:1', reason: mode };
        },        
        /**
 * enqueuePortalUse：处理传送门Use并更新相关状态。
 * @param payload 载荷参数。
 * @returns 无返回值，直接更新PortalUse相关状态。
 */

        enqueuePortalUse(payload) { log.push(['enqueuePortalUse', payload]); },
    }]]);
    return {    
    /**
 * getPlayerLocation：读取玩家位置。
 * @param playerId 玩家 ID。
 * @returns 无返回值，完成玩家位置的读取/组装。
 */

        getPlayerLocation(playerId) {
            return playerLocations.get(playerId) ?? null;
        },        
        /**
 * getInstanceRuntime：读取Instance运行态。
 * @param instanceId instance ID。
 * @returns 无返回值，完成Instance运行态的读取/组装。
 */

        getInstanceRuntime(instanceId) {
            return instanceRuntimes.get(instanceId) ?? null;
        },
        playerRuntimeService: {        
        /**
 * getPlayer：读取玩家。
 * @param playerId 玩家 ID。
 * @returns 无返回值，完成玩家的读取/组装。
 */

            getPlayer(playerId) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

                if (playerId !== 'player:1') return null;
                return { hp: 10, attrs: { numericStats: { moveSpeed: 12 } } };
            },            
            /**
 * recordActivity：执行recordActivity相关逻辑。
 * @param playerId 玩家 ID。
 * @param tick 当前 tick。
 * @param payload 载荷参数。
 * @returns 无返回值，直接更新recordActivity相关状态。
 */

            recordActivity(playerId, tick, payload) { log.push(['recordActivity', playerId, tick, payload]); },
        },        
        /**
 * resolveCurrentTickForPlayerId：规范化或转换当前tickFor玩家ID。
 * @returns 无返回值，直接更新CurrenttickFor玩家ID相关状态。
 */

        resolveCurrentTickForPlayerId() { return 33; },
        worldRuntimeCraftInterruptService: {        
        /**
 * interruptCraftForReason：执行interrupt炼制ForReason相关逻辑。
 * @param playerId 玩家 ID。
 * @param _player 参数说明。
 * @param reason 参数说明。
 * @returns 无返回值，直接更新interrupt炼制ForReason相关状态。
 */

            interruptCraftForReason(playerId, _player, reason) { log.push(['interruptCraftForReason', playerId, reason]); },
        },        
        /**
 * applyTransfer：处理Transfer并更新相关状态。
 * @param transfer 参数说明。
 * @returns 无返回值，直接更新Transfer相关状态。
 */

        applyTransfer(transfer) { log.push(['applyTransfer', transfer.reason]); },
    };
}
/**
 * testMoveBranch：执行testMoveBranch相关逻辑。
 * @returns 无返回值，直接更新testMoveBranch相关状态。
 */


function testMoveBranch() {
    const log = [];
    const service = new WorldRuntimeMovementService();
    const deps = buildDeps(log);
    service.dispatchInstanceCommand('player:1', {
        kind: 'move',
        direction: 2,
        continuous: true,
        maxSteps: 3,
        path: [{ x: 1, y: 2 }],
        resetBudget: true,
    }, deps);
    assert.deepEqual(log, [
        ['setPlayerMoveSpeed', 'player:1', 12],
        ['recordActivity', 'player:1', 33, { interruptCultivation: true, reason: 'move' }],
        ['interruptCraftForReason', 'player:1', 'move'],
        ['enqueueMove', {
            playerId: 'player:1',
            direction: 2,
            continuous: true,
            maxSteps: 3,
            path: [{ x: 1, y: 2 }],
            resetBudget: true,
        }],
    ]);
}
/**
 * testPortalBranch：执行test传送门Branch相关逻辑。
 * @returns 无返回值，直接更新testPortalBranch相关状态。
 */


function testPortalBranch() {
    const log = [];
    const service = new WorldRuntimeMovementService();
    const deps = buildDeps(log);
    service.dispatchInstanceCommand('player:1', { kind: 'portal' }, deps);
    assert.deepEqual(log, [
        ['recordActivity', 'player:1', 33, { interruptCultivation: true, reason: 'move' }],
        ['interruptCraftForReason', 'player:1', 'move'],
        ['tryPortalTransfer', 'player:1', 'manual_portal'],
        ['enqueuePortalUse', { playerId: 'player:1' }],
    ]);
}

function testMiningJobMoveDoesNotInterruptCraft() {
    const log = [];
    const service = new WorldRuntimeMovementService();
    const deps = buildDeps(log);
    deps.playerRuntimeService.getPlayer = (playerId) => {
        if (playerId !== 'player:1') return null;
        return {
            hp: 10,
            attrs: { numericStats: { moveSpeed: 12 } },
            miningJob: {
                jobRunId: 'mining:job:1',
                targetX: 8,
                targetY: 1,
            },
        };
    };
    service.dispatchInstanceCommand('player:1', {
        kind: 'move',
        direction: 2,
        continuous: true,
        maxSteps: 3,
        path: [{ x: 2, y: 1 }, { x: 3, y: 1 }],
        miningJobRunId: 'mining:job:1',
        miningTargetRef: 'tile:8:1',
    }, deps);
    assert.deepEqual(log, [
        ['setPlayerMoveSpeed', 'player:1', 12],
        ['recordActivity', 'player:1', 33, { interruptCultivation: true, reason: 'move' }],
        ['enqueueMove', {
            playerId: 'player:1',
            direction: 2,
            continuous: true,
            maxSteps: 3,
            path: [{ x: 2, y: 1 }, { x: 3, y: 1 }],
            resetBudget: false,
        }],
    ]);
}

function testStaleMiningJobMoveIsIgnored() {
    const log = [];
    const service = new WorldRuntimeMovementService();
    const deps = buildDeps(log);
    deps.playerRuntimeService.getPlayer = (playerId) => {
        if (playerId !== 'player:1') return null;
        return {
            hp: 10,
            attrs: { numericStats: { moveSpeed: 12 } },
            miningJob: null,
        };
    };
    service.dispatchInstanceCommand('player:1', {
        kind: 'move',
        direction: 2,
        continuous: true,
        miningJobRunId: 'mining:job:old',
        miningTargetRef: 'tile:8:1',
    }, deps);
    assert.deepEqual(log, []);
}

function testManualNavigationMoveKeepsBudget() {
    const log = [];
    const service = new WorldRuntimeNavigationService(null, {
        getPlayer(playerId) {
            assert.equal(playerId, 'player:1');
            return { templateId: 'movement_budget_smoke', x: 0, y: 1 };
        },
        updateCombatSettings(playerId, settings, tick) {
            log.push(['updateCombatSettings', playerId, settings, tick]);
        },
    });
    service.enqueueMove('player:1', Direction.East, {
        getPlayerLocationOrThrow(playerId) {
            assert.equal(playerId, 'player:1');
            return { instanceId: 'smoke:movement_budget', sessionId: 'session:1' };
        },
        enqueuePendingCommand(playerId, command) {
            log.push(['enqueuePendingCommand', playerId, command]);
        },
        getPlayerViewOrThrow(playerId) {
            assert.equal(playerId, 'player:1');
            return {};
        },
        resolveCurrentTickForPlayerId(playerId) {
            assert.equal(playerId, 'player:1');
            return 7;
        },
        cancelPendingInstanceCommand(playerId) {
            log.push(['cancelPendingInstanceCommand', playerId]);
        },
        logger: null,
    });
    assert.deepEqual(log, [
        ['updateCombatSettings', 'player:1', { autoBattle: false }, 7],
        ['cancelPendingInstanceCommand', 'player:1'],
        ['enqueuePendingCommand', 'player:1', {
            kind: 'move',
            direction: Direction.East,
            continuous: true,
            resetBudget: false,
        }],
    ]);
}

function testMoveToQueuesInitialInstanceMoveImmediately() {
    const log = [];
    const templateRepository = new MapTemplateRepository();
    templateRepository.registerRuntimeMapTemplate({
        id: 'move_to_initial_step_smoke',
        name: '寻路首步烟测',
        width: 4,
        height: 3,
        routeDomain: 'system',
        tiles: [
            '....',
            '....',
            '....',
        ],
        spawnPoint: { x: 0, y: 1 },
        portals: [],
        npcs: [],
        monsters: [],
        safeZones: [],
        landmarks: [],
        containers: [],
        auras: [],
        tileEffects: [],
    });
    const instance = new MapInstanceRuntime({
        instanceId: 'smoke:move_to_initial_step',
        template: templateRepository.getOrThrow('move_to_initial_step_smoke'),
        monsterSpawns: [],
        kind: 'public',
        persistent: false,
        createdAt: Date.now(),
        displayName: '寻路首步烟测',
        linePreset: 'peaceful',
        lineIndex: 1,
        instanceOrigin: 'smoke',
        defaultEntry: true,
        canDamageTile: false,
    });
    const runtimePlayer = instance.connectPlayer({
        playerId: 'player:move-to',
        sessionId: 'session:move-to',
        preferredX: 0,
        preferredY: 1,
    });
    const service = new WorldRuntimeNavigationService(templateRepository, {
        getPlayer(playerId) {
            assert.equal(playerId, runtimePlayer.playerId);
            return { playerId, templateId: instance.template.mapId, x: runtimePlayer.x, y: runtimePlayer.y };
        },
        getPlayerOrThrow(playerId) {
            assert.equal(playerId, runtimePlayer.playerId);
            return { playerId, templateId: instance.template.mapId, x: runtimePlayer.x, y: runtimePlayer.y };
        },
        updateCombatSettings(playerId, settings, tick) {
            log.push(['updateCombatSettings', playerId, settings, tick]);
        },
        recordActivity(playerId, tick, payload) {
            log.push(['recordActivity', playerId, tick, payload]);
        },
    });
    service.enqueueMoveTo(runtimePlayer.playerId, 2, 1, false, null, null, null, null, {
        getPlayerLocationOrThrow(playerId) {
            assert.equal(playerId, runtimePlayer.playerId);
            return { instanceId: instance.meta.instanceId, sessionId: runtimePlayer.sessionId };
        },
        getInstanceRuntimeOrThrow(instanceId) {
            assert.equal(instanceId, instance.meta.instanceId);
            return instance;
        },
        dispatchInstanceCommand(playerId, command) {
            log.push(['dispatchInstanceCommand', playerId, command]);
            instance.enqueueMove({ playerId, ...command });
        },
        enqueuePendingCommand(playerId, command) {
            log.push(['enqueuePendingCommand', playerId, command]);
        },
        getPlayerViewOrThrow(playerId) {
            assert.equal(playerId, runtimePlayer.playerId);
            return {};
        },
        resolveCurrentTickForPlayerId(playerId) {
            assert.equal(playerId, runtimePlayer.playerId);
            return 11;
        },
        cancelPendingInstanceCommand(playerId) {
            log.push(['cancelPendingInstanceCommand', playerId]);
            return false;
        },
        logger: null,
    });
    assert.equal(service.hasNavigationIntent(runtimePlayer.playerId), true);
    assert.equal(service.navigationIntents.get(runtimePlayer.playerId)?.mapId, 'move_to_initial_step_smoke');
    assert.equal(log.some((entry) => entry[0] === 'enqueuePendingCommand'), false);
    assert.deepEqual(log.filter((entry) => entry[0] === 'dispatchInstanceCommand'), [
        ['dispatchInstanceCommand', runtimePlayer.playerId, {
            kind: 'move',
            direction: Direction.East,
            continuous: true,
            maxSteps: 2,
            path: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
            resetBudget: false,
        }],
    ]);
    instance.tickOnce();
    // 基础移动点数 200（平地代价 100），单 tick 可走完 2 步路径直达终点
    assert.deepEqual(instance.getPlayerPosition(runtimePlayer.playerId), { x: 2, y: 1 });
}

function testHighCostTileAccumulatesMoveBudget() {
    // 基础移动点数为 200（2 倍单位），高耗费地块代价按同倍数放大为 1860，保持原测试节奏
    assert.equal(getMaxStoredMovePoints(0), 200);
    assert.equal(getMaxStoredMovePoints(0, 1860), 1860);

    const templateRepository = new MapTemplateRepository();
    templateRepository.registerRuntimeMapTemplate({
        id: 'movement_budget_smoke',
        name: '移动预算烟测',
        width: 3,
        height: 3,
        routeDomain: 'system',
        tiles: [
            '...',
            '...',
            '...',
        ],
        spawnPoint: { x: 0, y: 1 },
        portals: [],
        npcs: [],
        monsters: [],
        safeZones: [],
        landmarks: [],
        containers: [],
        auras: [],
        tileEffects: [
            { x: 1, y: 1, width: 1, height: 1, movementCost: 1860 },
        ],
    });
    const instance = new MapInstanceRuntime({
        instanceId: 'smoke:movement_budget',
        template: templateRepository.getOrThrow('movement_budget_smoke'),
        monsterSpawns: [],
        kind: 'public',
        persistent: false,
        createdAt: Date.now(),
        displayName: '移动预算烟测',
        linePreset: 'peaceful',
        lineIndex: 1,
        instanceOrigin: 'smoke',
        defaultEntry: true,
        canDamageTile: false,
    });
    const player = instance.connectPlayer({
        playerId: 'player:budget',
        sessionId: 'session:budget',
        preferredX: 0,
        preferredY: 1,
    });
    instance.setPlayerMoveSpeed(player.playerId, 0);

    for (let index = 0; index < 9; index += 1) {
        instance.enqueueMove({
            playerId: player.playerId,
            direction: Direction.East,
            continuous: true,
            resetBudget: false,
        });
        instance.tickOnce();
        assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 0, y: 1 });
    }
    assert.equal(player.movePoints, 1800);

    instance.enqueueMove({
        playerId: player.playerId,
        direction: Direction.East,
        continuous: true,
        resetBudget: false,
    });
    instance.tickOnce();
    assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 1, y: 1 });
    assert.equal(player.movePoints, 0);
}

function testExistingPlayerConnectDoesNotRelocateWithoutExplicitFlag() {
    const templateRepository = new MapTemplateRepository();
    templateRepository.registerRuntimeMapTemplate({
        id: 'existing_connect_position_smoke',
        name: '已有玩家重连位置烟测',
        width: 5,
        height: 3,
        routeDomain: 'system',
        tiles: [
            '.....',
            '.....',
            '.....',
        ],
        spawnPoint: { x: 0, y: 1 },
        portals: [],
        npcs: [],
        monsters: [],
        safeZones: [],
        landmarks: [],
        containers: [],
        auras: [],
        tileEffects: [],
    });
    const instance = new MapInstanceRuntime({
        instanceId: 'smoke:existing_connect_position',
        template: templateRepository.getOrThrow('existing_connect_position_smoke'),
        monsterSpawns: [],
        kind: 'public',
        persistent: false,
        createdAt: Date.now(),
        displayName: '已有玩家重连位置烟测',
        linePreset: 'peaceful',
        lineIndex: 1,
        instanceOrigin: 'smoke',
        defaultEntry: true,
        canDamageTile: false,
    });
    const player = instance.connectPlayer({
        playerId: 'player:existing-connect',
        sessionId: 'session:first',
        preferredX: 0,
        preferredY: 1,
    });
    instance.relocatePlayer(player.playerId, 2, 1);
    assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 2, y: 1 });

    instance.connectPlayer({
        playerId: player.playerId,
        sessionId: 'session:reconnect',
        preferredX: 0,
        preferredY: 1,
    });
    assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 2, y: 1 });

    instance.connectPlayer({
        playerId: player.playerId,
        sessionId: 'session:forced',
        preferredX: 4,
        preferredY: 1,
        relocateExisting: true,
    });
    assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 4, y: 1 });
}

/**
 * createMonsterCorridorInstance：创建单行走廊地图实例，杜绝绕行使妖兽格成为唯一通道。
 */
function createMonsterCorridorInstance(instanceId, templateId, width) {
    const templateRepository = new MapTemplateRepository();
    templateRepository.registerRuntimeMapTemplate({
        id: templateId,
        name: '妖兽格穿越烟测',
        width,
        height: 1,
        routeDomain: 'system',
        tiles: ['.'.repeat(width)],
        spawnPoint: { x: 0, y: 0 },
        portals: [],
        npcs: [],
        monsters: [],
        safeZones: [],
        landmarks: [],
        containers: [],
        auras: [],
        tileEffects: [],
    });
    const instance = new MapInstanceRuntime({
        instanceId,
        template: templateRepository.getOrThrow(templateId),
        monsterSpawns: [],
        kind: 'public',
        persistent: false,
        createdAt: Date.now(),
        displayName: '妖兽格穿越烟测',
        linePreset: 'peaceful',
        lineIndex: 1,
        instanceOrigin: 'smoke',
        defaultEntry: true,
        canDamageTile: false,
    });
    return { templateRepository, instance };
}

/**
 * injectLiveMonster：向实例注入最小化存活妖兽并登记占位索引。
 * 配合 tickOnce(null, { sleepMonsterAi: true }) 使用，AI 休眠不会移动/攻击。
 */
function injectLiveMonster(instance, runtimeId, x, y) {
    const monster = {
        runtimeId,
        spawnId: `spawn:${runtimeId}`,
        x,
        y,
        hp: 10,
        maxHp: 10,
        qi: 0,
        maxQi: 0,
        alive: true,
        buffs: [],
    };
    instance.monstersByRuntimeId.set(runtimeId, monster);
    instance.monsterRuntimeIdByTile.set(instance.toTileIndex(x, y), runtimeId);
    return monster;
}

function assertPlayerNotOnMonsterTile(instance, player) {
    const position = instance.getPlayerPosition(player.playerId);
    const monsterTileRuntimeId = instance.monsterRuntimeIdByTile.get(instance.toTileIndex(position.x, position.y));
    if (monsterTileRuntimeId != null) {
        throw new Error(`玩家 ${player.playerId} 停靠在妖兽格 ${position.x},${position.y}（runtimeId=${monsterTileRuntimeId}），违反停靠不变式`);
    }
    return position;
}

/** 案例 1：妖兽挡路时路径规划穿过它，玩家跨息抵达妖兽身后目的地。 */
function testPlayerPlansThroughMonsterTileAndArrives() {
    const log = [];
    const { templateRepository, instance } = createMonsterCorridorInstance('smoke:monster-traverse', 'monster_traverse_smoke', 6);
    const runtimePlayer = instance.connectPlayer({
        playerId: 'player:traverse',
        sessionId: 'session:traverse',
        preferredX: 0,
        preferredY: 0,
    });
    injectLiveMonster(instance, 'monster:traverse:1', 3, 0);
    const service = new WorldRuntimeNavigationService(templateRepository, {
        getPlayer(playerId) {
            return { playerId, templateId: instance.template.mapId, x: runtimePlayer.x, y: runtimePlayer.y };
        },
        getPlayerOrThrow(playerId) {
            return { playerId, templateId: instance.template.mapId, x: runtimePlayer.x, y: runtimePlayer.y };
        },
        updateCombatSettings() {},
        recordActivity() {},
    });
    const moveToDeps = {
        getPlayerLocationOrThrow(playerId) {
            return { instanceId: instance.meta.instanceId, sessionId: runtimePlayer.sessionId };
        },
        getInstanceRuntimeOrThrow(instanceId) {
            assert.equal(instanceId, instance.meta.instanceId);
            return instance;
        },
        dispatchInstanceCommand(playerId, command) {
            log.push(['dispatchInstanceCommand', playerId, command]);
            instance.enqueueMove({ playerId, ...command });
        },
        enqueuePendingCommand(playerId, command) {
            log.push(['enqueuePendingCommand', playerId, command]);
        },
        getPlayerViewOrThrow() {
            return {};
        },
        resolveCurrentTickForPlayerId() {
            return instance.tick;
        },
        cancelPendingInstanceCommand() {
            return false;
        },
        logger: null,
    };
    service.enqueueMoveTo(runtimePlayer.playerId, 5, 0, false, null, null, null, null, moveToDeps);

    // 规划层必须给出穿过妖兽格 (3,0) 的直线路径
    const moveEntry = log.find((entry) => entry[0] === 'dispatchInstanceCommand');
    assert.ok(moveEntry, 'enqueueMoveTo 未派发实例移动命令');
    assert.deepEqual(moveEntry[2].path, [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 0 },
    ]);

    // 基础移动点数每息回复 200（平地单步代价 100），单条移动命令每息最多走两步；
    // 与线上节奏一致，导航意图逐息重新物化并从当前位置续规划；全程确认从未停靠在妖兽格
    for (let round = 0; round < 6; round += 1) {
        if (instance.getPlayerPosition(runtimePlayer.playerId).x === 5) {
            break;
        }
        service.enqueueMoveTo(runtimePlayer.playerId, 5, 0, false, null, null, null, null, moveToDeps);
        instance.tickOnce(null, { sleepMonsterAi: true });
        assertPlayerNotOnMonsterTile(instance, runtimePlayer);
    }
    assert.deepEqual(instance.getPlayerPosition(runtimePlayer.playerId), { x: 5, y: 0 }, '玩家未抵达妖兽身后的目的地');
}

/** 案例 2：目的地被妖兽占据时规划可达但最终停靠在其相邻格，绝不重叠。 */
function testPlayerStopsAdjacentWhenDestinationOccupiedByMonster() {
    const log = [];
    const { templateRepository, instance } = createMonsterCorridorInstance('smoke:monster-goal', 'monster_goal_smoke', 4);
    const runtimePlayer = instance.connectPlayer({
        playerId: 'player:goal-monster',
        sessionId: 'session:goal-monster',
        preferredX: 0,
        preferredY: 0,
    });
    injectLiveMonster(instance, 'monster:goal:1', 2, 0);
    const service = new WorldRuntimeNavigationService(templateRepository, {
        getPlayer(playerId) {
            return { playerId, templateId: instance.template.mapId, x: runtimePlayer.x, y: runtimePlayer.y };
        },
        getPlayerOrThrow(playerId) {
            return { playerId, templateId: instance.template.mapId, x: runtimePlayer.x, y: runtimePlayer.y };
        },
        updateCombatSettings() {},
        recordActivity() {},
    });
    service.enqueueMoveTo(runtimePlayer.playerId, 2, 0, false, null, null, null, null, {
        getPlayerLocationOrThrow(playerId) {
            return { instanceId: instance.meta.instanceId, sessionId: runtimePlayer.sessionId };
        },
        getInstanceRuntimeOrThrow(instanceId) {
            assert.equal(instanceId, instance.meta.instanceId);
            return instance;
        },
        dispatchInstanceCommand(playerId, command) {
            log.push(['dispatchInstanceCommand', playerId, command]);
            instance.enqueueMove({ playerId, ...command });
        },
        enqueuePendingCommand(playerId, command) {
            log.push(['enqueuePendingCommand', playerId, command]);
        },
        getPlayerViewOrThrow() {
            return {};
        },
        resolveCurrentTickForPlayerId() {
            return instance.tick;
        },
        cancelPendingInstanceCommand() {
            return false;
        },
        logger: null,
    });
    // 规划层允许把被妖兽占据的目标格作为终点（保留 allowOccupiedGoals 语义）
    const moveEntry = log.find((entry) => entry[0] === 'dispatchInstanceCommand');
    assert.ok(moveEntry, 'enqueueMoveTo 未派发实例移动命令');
    assert.equal(moveEntry[2].path[moveEntry[2].path.length - 1].x, 2);

    instance.tickOnce(null, { sleepMonsterAi: true });
    instance.tickOnce(null, { sleepMonsterAi: true });
    // 停靠不变式回退最后一步：终点落在妖兽相邻格而非其所在格
    assert.deepEqual(instance.getPlayerPosition(runtimePlayer.playerId), { x: 1, y: 0 });
    const goalTileIndex = instance.toTileIndex(2, 0);
    // 0 为 INVALID_OCCUPANCY（空占位）：妖兽格上不得残留玩家占位
    assert.equal(instance.occupancy[goalTileIndex], 0);
    assert.equal(instance.monsterRuntimeIdByTile.get(goalTileIndex), 'monster:goal:1');
}

/** 案例 3：预算恰好在妖兽格上耗尽时，本息结束时停靠回上一个合法格。 */
function testBudgetExhaustionOnMonsterTileRestsOnPreviousLegalTile() {
    const { instance } = createMonsterCorridorInstance('smoke:monster-budget', 'monster_budget_smoke', 5);
    const player = instance.connectPlayer({
        playerId: 'player:budget-monster',
        sessionId: 'session:budget-monster',
        preferredX: 0,
        preferredY: 0,
    });
    injectLiveMonster(instance, 'monster:budget:1', 2, 0);

    // 手工注入 250 点预算：够走一步平地(100)+踏入妖兽格(100)，第三步耗尽在妖兽格上
    assert.equal(instance.enqueueMove({
        playerId: player.playerId,
        direction: Direction.East,
        continuous: true,
        resetBudget: false,
        path: [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
        ],
    }), true);
    player.movePoints = 250;
    player.lastMoveBudgetTick = instance.tick;
    instance.tickOnce(null, { sleepMonsterAi: true });

    // 预算在妖兽格上告罄 → 回退停靠到进入妖兽格前的合法格
    assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 1, y: 0 });
    const monsterTileIndex = instance.toTileIndex(2, 0);
    // 0 为 INVALID_OCCUPANCY（空占位）
    assert.equal(instance.occupancy[monsterTileIndex], 0);
    assert.equal(instance.occupancy[instance.toTileIndex(1, 0)] !== 0, true);
    assert.equal(instance.monsterRuntimeIdByTile.get(monsterTileIndex), 'monster:budget:1');

    // 补足行动节奏后继续行进可正常穿过妖兽格抵达后方：
    // 预算上限随首次步进代价收口，手工巨额注入会被夹回；改为按线上节奏逐息续发剩余路径
    for (let round = 0; round < 4; round += 1) {
        const position = instance.getPlayerPosition(player.playerId);
        if (position.x === 4) {
            break;
        }
        /** 剩余相对路径：从当前位置起保证相邻步进语义成立 */
        const remainingPath = [];
        for (let x = position.x + 1; x <= 4; x += 1) {
            remainingPath.push({ x, y: 0 });
        }
        assert.equal(instance.enqueueMove({
            playerId: player.playerId,
            direction: Direction.East,
            continuous: true,
            resetBudget: false,
            path: remainingPath,
        }), true);
        instance.tickOnce(null, { sleepMonsterAi: true });
        assertPlayerNotOnMonsterTile(instance, player);
    }
    assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 4, y: 0 });
    assertPlayerNotOnMonsterTile(instance, player);
}

function testCrossMapPointNavigationSurvivesTransfer() {    const notices = [];
    const service = new WorldRuntimeNavigationService({ getOrThrow: (mapId) => ({ id: mapId, name: mapId }) }, {
        getPlayer(playerId) {
            assert.equal(playerId, 'player:cross-map');
            return { worldPreference: { linePreset: 'peaceful' } };
        },
    });
    service.navigationIntents.set('player:cross-map', {
        kind: 'point',
        mapId: 'target_map',
        x: 4,
        y: 5,
        allowNearestReachable: false,
        clientPathHint: null,
    });
    service.handleTransfer({
        playerId: 'player:cross-map',
        fromInstanceId: 'public:source_map',
        sourceMapId: 'source_map',
        targetMapId: 'target_map',
        reason: 'auto_portal',
    }, {
        getInstanceRuntime() {
            return null;
        },
        getOrCreateDefaultLineInstance(mapId) {
            return { template: { name: mapId } };
        },
        queuePlayerNotice(playerId, text, kind, _a, _b, structured) {
            notices.push([playerId, text, kind, structured?.key ?? null]);
        },
    });
    assert.equal(service.navigationIntents.get('player:cross-map')?.mapId, 'target_map');
    assert.deepEqual(notices, [['player:cross-map', '穿過靈脈抵達 target_map', 'travel', 'notice.travel.arrived']]);

    service.navigationIntents.set('player:cross-map', {
        kind: 'point',
        mapId: 'source_map',
        x: 1,
        y: 2,
        allowNearestReachable: false,
        clientPathHint: null,
    });
    service.handleTransfer({
        playerId: 'player:cross-map',
        fromInstanceId: 'public:source_map',
        sourceMapId: 'source_map',
        targetMapId: 'target_map',
        reason: 'auto_portal',
    }, {
        getOrCreateDefaultLineInstance(mapId) {
            return { template: { name: mapId } };
        },
        queuePlayerNotice() {},
    });
    assert.equal(service.navigationIntents.has('player:cross-map'), false);
}

testMoveBranch();
testPortalBranch();
testMiningJobMoveDoesNotInterruptCraft();
testStaleMiningJobMoveIsIgnored();
testManualNavigationMoveKeepsBudget();
testMoveToQueuesInitialInstanceMoveImmediately();
testHighCostTileAccumulatesMoveBudget();
testExistingPlayerConnectDoesNotRelocateWithoutExplicitFlag();
testCrossMapPointNavigationSurvivesTransfer();
testPlayerPlansThroughMonsterTileAndArrives();
testPlayerStopsAdjacentWhenDestinationOccupiedByMonster();
testBudgetExhaustionOnMonsterTileRestsOnPreviousLegalTile();

console.log(JSON.stringify({ ok: true, case: 'world-runtime-movement' }, null, 2));
