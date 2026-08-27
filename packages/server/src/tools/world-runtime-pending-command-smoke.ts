import assert from 'node:assert/strict';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { WorldRuntimePendingCommandService } from '../runtime/world/command/world-runtime-pending-command.service';
/**
 * testQueueOwnershipMethods：执行testQueueOwnershipMethod相关逻辑。
 * @returns 无返回值，直接更新testQueueOwnershipMethod相关状态。
 */


function testQueueOwnershipMethods() {
    const service = new WorldRuntimePendingCommandService();
    service.enqueuePendingCommand('player:1', { kind: 'move', direction: 'east' });
    service.enqueuePendingCommand('player:1', { kind: 'portal' });
    service.enqueuePendingCommand('player:2', { kind: 'basicAttack', targetPlayerId: null, targetMonsterId: 'monster:1', targetX: null, targetY: null });
    assert.equal(service.hasPendingCommand('player:1'), true);
    assert.deepEqual(service.getPendingCommand('player:1'), { kind: 'move', direction: 'east' });
    assert.equal(service.getPendingCommandCount(), 3);
    service.clearPendingCommand('player:2');
    assert.equal(service.hasPendingCommand('player:2'), false);
    assert.equal(service.getPendingCommandCount(), 2);
}
/**
 * testDispatchRoutesAndClearsQueue：判断testDispatch路线AndClearQueue是否满足条件。
 * @returns 无返回值，直接更新testDispatch路线AndClearQueue相关状态。
 */


async function testDispatchRoutesAndClearsQueue() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', { kind: 'move', direction: 'east' });
    service.enqueuePendingCommand('player:2', { kind: 'basicAttack', targetPlayerId: null, targetMonsterId: 'monster:2', targetX: null, targetY: null });
    service.enqueuePendingCommand('player:3', { kind: 'portal' });
    await service.dispatchPendingCommands({    
    /**
 * dispatchInstanceCommand：判断InstanceCommand是否满足条件。
 * @param playerId 玩家 ID。
 * @param command 输入指令。
 * @returns 无返回值，直接更新InstanceCommand相关状态。
 */

        dispatchInstanceCommand(playerId, command) {
            log.push(['dispatchInstanceCommand', playerId, command.kind]);
        },        
        /**
 * dispatchPlayerCommand：判断玩家Command是否满足条件。
 * @param playerId 玩家 ID。
 * @param command 输入指令。
 * @returns 无返回值，直接更新玩家Command相关状态。
 */

        dispatchPlayerCommand(playerId, command) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

            if (playerId === 'player:2') {
                throw new Error('boom');
            }
            log.push(['dispatchPlayerCommand', playerId, command.kind]);
        },
        logger: {        
        /**
 * warn：执行warn相关逻辑。
 * @param message 参数说明。
 * @returns 无返回值，直接更新warn相关状态。
 */

            warn(message) {
                log.push(['warn', message]);
            },
        },        
        /**
 * queuePlayerNotice：执行queue玩家Notice相关逻辑。
 * @param playerId 玩家 ID。
 * @param message 参数说明。
 * @param tone 参数说明。
 * @returns 无返回值，直接更新queue玩家Notice相关状态。
 */

        queuePlayerNotice(playerId, message, tone, _title, _icon, structured) {
            log.push(['queuePlayerNotice', playerId, message, tone, structured?.key ?? null]);
        },
    });
    assert.deepEqual(log, [
        ['dispatchInstanceCommand', 'player:1', 'move'],
        ['warn', '處理玩家 player:2 的待執行指令失敗：basicAttack（boom） debug=auto=0 manual=0 playerState=missing'],
        ['queuePlayerNotice', 'player:2', '行動未能完成，請稍後重試。', 'warn', 'notice.command.failed'],
        ['dispatchInstanceCommand', 'player:3', 'portal'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testAsyncPlayerCommandIsAwaitedBeforeQueueClear() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    let resolvePlayerCommand = () => {};
    service.enqueuePendingCommand('player:1', { kind: 'startAlchemy', payload: { presetId: 'p1' } });
    const pendingDispatch = service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand(playerId, command) {
            log.push(['dispatchPlayerCommand', playerId, command.kind]);
            return new Promise((resolve) => {
                resolvePlayerCommand = () => {
                    log.push(['dispatchPlayerCommand:resolved', playerId, command.kind]);
                    resolve(undefined);
                };
            });
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(log, [
        ['dispatchPlayerCommand', 'player:1', 'startAlchemy'],
    ]);
    assert.equal(service.getPendingCommandCount(), 1);
    service.enqueuePendingCommand('player:1', { kind: 'startForging', payload: { presetId: 'p2' } });
    resolvePlayerCommand();
    await pendingDispatch;
    assert.deepEqual(log, [
        ['dispatchPlayerCommand', 'player:1', 'startAlchemy'],
        ['dispatchPlayerCommand:resolved', 'player:1', 'startAlchemy'],
    ]);
    assert.equal(service.getPendingCommandCount(), 1);
    assert.deepEqual(service.getPendingCommand('player:1'), { kind: 'startForging', payload: { presetId: 'p2' } });
}

async function testCombatResolvedCommandDropsSameTickMoveIntent() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'basicAttack',
        targetPlayerId: null,
        targetMonsterId: 'monster:1',
        targetX: null,
        targetY: null,
        autoCombat: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand(playerId, command) {
            log.push(['dispatchInstanceCommand', playerId, command.kind]);
        },
        dispatchPlayerCommand(playerId, command) {
            log.push(['dispatchPlayerCommand', playerId, command.kind]);
            service.enqueuePendingCommand(playerId, {
                kind: 'move',
                direction: 'west',
                continuous: false,
                maxSteps: 1,
                autoCombat: true,
            });
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['dispatchPlayerCommand', 'player:1', 'basicAttack'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testAutoCombatStaleTargetRetriesImmediately() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    const player = {
        playerId: 'player:1',
        displayName: '青衫客',
        instanceId: 'public:yunlai_town',
        hp: 100,
        combat: {
            autoBattle: true,
        },
    };
    service.enqueuePendingCommand('player:1', {
        kind: 'basicAttack',
        targetPlayerId: null,
        targetMonsterId: 'monster:stale',
        targetX: null,
        targetY: null,
        autoCombat: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand(playerId, command) {
            log.push(['dispatchInstanceCommand', playerId, command.kind, command.direction ?? null]);
        },
        dispatchPlayerCommand(playerId, command) {
            log.push(['dispatchPlayerCommand', playerId, command.kind, command.targetMonsterId ?? null]);
            if (command.targetMonsterId === 'monster:stale') {
                throw new Error('Monster monster:stale not found');
            }
        },
        buildAutoCombatCommand(instance, runtimePlayer) {
            log.push(['buildAutoCombatCommand', instance.meta.instanceId, runtimePlayer.playerId]);
            return {
                kind: 'move',
                direction: 'east',
                continuous: false,
                maxSteps: 1,
                autoCombat: true,
            };
        },
        getInstanceRuntime(instanceId) {
            assert.equal(instanceId, 'public:yunlai_town');
            return {
                meta: {
                    instanceId,
                },
            };
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                return playerId === player.playerId ? player : null;
            },
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['dispatchPlayerCommand', 'player:1', 'basicAttack', 'monster:stale'],
        ['buildAutoCombatCommand', 'public:yunlai_town', 'player:1'],
        ['dispatchInstanceCommand', 'player:1', 'move', 'east'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testAutoCombatFailedSkillFallsBackToAlternativeCommand() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    const player = {
        playerId: 'player:1',
        displayName: '青衫客',
        instanceId: 'public:yunlai_town',
        hp: 100,
        combat: {
            autoBattle: true,
        },
    };
    service.enqueuePendingCommand('player:1', {
        kind: 'castSkill',
        skillId: 'skill:expensive',
        targetPlayerId: null,
        targetMonsterId: 'monster:1',
        targetRef: null,
        autoCombat: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand(playerId, command) {
            log.push([
                'dispatchPlayerCommand',
                playerId,
                command.kind,
                command.kind === 'castSkill' ? command.skillId : (command.targetMonsterId ?? null),
            ]);
            if (command.kind === 'castSkill' && command.skillId === 'skill:expensive') {
                throw new Error('Skill skill:expensive qi insufficient');
            }
        },
        buildAutoCombatCommand(instance, runtimePlayer, options) {
            const excludedSkillIds = [...(options?.excludedSkillIds ?? [])].sort();
            log.push(['buildAutoCombatCommand', instance.meta.instanceId, runtimePlayer.playerId, excludedSkillIds.join(',')]);
            assert.deepEqual(excludedSkillIds, ['skill:expensive']);
            return {
                kind: 'basicAttack',
                targetPlayerId: null,
                targetMonsterId: 'monster:1',
                targetX: null,
                targetY: null,
                autoCombat: true,
            };
        },
        getInstanceRuntime(instanceId) {
            assert.equal(instanceId, 'public:yunlai_town');
            return {
                meta: {
                    instanceId,
                },
            };
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                return playerId === player.playerId ? player : null;
            },
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['dispatchPlayerCommand', 'player:1', 'castSkill', 'skill:expensive'],
        ['buildAutoCombatCommand', 'public:yunlai_town', 'player:1', 'skill:expensive'],
        ['dispatchPlayerCommand', 'player:1', 'basicAttack', 'monster:1'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testAutoCombatRetryFailureStaysSilentWithoutDebugLogger() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    const player = {
        playerId: 'player:1',
        displayName: '青衫客',
        instanceId: 'public:yunlai_town',
        hp: 100,
        x: 43,
        y: 56,
        techniques: {
            techniques: [{
                skills: [{
                    id: 'skill.qingmu_sword',
                    name: '青木劍訣',
                    range: 2,
                    effects: [{ type: 'damage', formula: 1 }],
                }],
            }],
        },
        combat: {
            autoBattle: true,
            combatTargetId: 'monster:far',
        },
    };
    service.enqueuePendingCommand('player:1', {
        kind: 'castSkill',
        skillId: 'skill.qingmu_sword',
        targetPlayerId: null,
        targetMonsterId: null,
        targetRef: 'player:target:1',
        autoCombat: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand(playerId, command) {
            log.push(['dispatchPlayerCommand', playerId, command.kind, command.skillId ?? command.targetMonsterId ?? command.targetRef ?? null]);
            if (command.kind === 'castSkill') {
                throw new Error('技能 skill.qingmu_sword 元氣不足');
            }
            throw new Error('目標超出攻擊距離');
        },
        buildAutoCombatCommand(instance, runtimePlayer, options) {
            const excludedSkillIds = [...(options?.excludedSkillIds ?? [])].sort();
            log.push(['buildAutoCombatCommand', instance.meta.instanceId, runtimePlayer.playerId, excludedSkillIds.join(',')]);
            return {
                kind: 'basicAttack',
                targetPlayerId: null,
                targetMonsterId: 'monster:far',
                targetX: null,
                targetY: null,
                autoCombat: true,
            };
        },
        getInstanceRuntime(instanceId) {
            return {
                meta: { instanceId },
                getMonster(monsterId) {
                    return monsterId === 'monster:far'
                        ? { runtimeId: monsterId, x: 99, y: 1, alive: true }
                        : null;
                },
            };
        },
        resolveCurrentTickForPlayerId() {
            return 0;
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                if (playerId === 'player:1') {
                    return player;
                }
                if (playerId === 'target:1') {
                    return {
                        playerId,
                        instanceId: 'public:yunlai_town',
                        hp: 100,
                        x: 44,
                        y: 57,
                        combat: {},
                    };
                }
                return null;
            },
            clearManualEngagePending(playerId) {
                log.push(['clearManualEngagePending', playerId]);
            },
            clearCombatTarget(playerId, currentTick) {
                log.push(['clearCombatTarget', playerId, currentTick]);
            },
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['dispatchPlayerCommand', 'player:1', 'castSkill', 'skill.qingmu_sword'],
        ['buildAutoCombatCommand', 'public:yunlai_town', 'player:1', 'skill.qingmu_sword'],
        ['dispatchPlayerCommand', 'player:1', 'basicAttack', 'monster:far'],
        ['clearManualEngagePending', 'player:1'],
        ['clearCombatTarget', 'player:1', 0],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testManualEngageAttackClearsServerOnlyEngageState() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'basicAttack',
        targetPlayerId: null,
        targetMonsterId: 'monster:1',
        targetX: null,
        targetY: null,
        manualEngage: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand(playerId, command) {
            log.push(['dispatchPlayerCommand', playerId, command.kind, command.targetMonsterId ?? null]);
        },
        resolveCurrentTickForPlayerId(playerId) {
            log.push(['resolveCurrentTickForPlayerId', playerId]);
            return 17;
        },
        playerRuntimeService: {
            clearManualEngagePending(playerId) {
                log.push(['clearManualEngagePending', playerId]);
            },
            clearCombatTarget(playerId, currentTick) {
                log.push(['clearCombatTarget', playerId, currentTick]);
            },
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['dispatchPlayerCommand', 'player:1', 'basicAttack', 'monster:1'],
        ['resolveCurrentTickForPlayerId', 'player:1'],
        ['clearManualEngagePending', 'player:1'],
        ['clearCombatTarget', 'player:1', 17],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testInvalidAttackNoticeUsesTargetReason() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'basicAttack',
        targetPlayerId: null,
        targetMonsterId: null,
        targetX: 10,
        targetY: 11,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('該目標無法被攻擊');
        },
        logger: {
            log(message) {
                log.push(['log', message]);
            },
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone, _title, _icon, structured) {
            log.push(['queuePlayerNotice', playerId, message, tone, structured?.key ?? null]);
        },
    });
    assert.deepEqual(log, [
        ['queuePlayerNotice', 'player:1', '沒有可命中的目標', 'warn', 'notice.command.no-target'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testForbiddenTileDamageUsesCapabilityNotice() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'engageBattle',
        targetPlayerId: null,
        targetMonsterId: null,
        targetX: 2,
        targetY: 2,
        locked: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('當前實例不允許攻擊地形');
        },
        logger: {
            debug() {},
            warn() {},
        },
        queuePlayerNotice(playerId, message, tone, _title, _icon, structured) {
            log.push(['queuePlayerNotice', playerId, message, tone, structured?.key ?? null]);
        },
    });
    assert.deepEqual(log, [
        ['queuePlayerNotice', 'player:1', '當前區域禁止攻擊地形。', 'warn', 'notice.command.tile-damage-forbidden'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testMoveToUnreachableFailureDoesNotPromoteDebug() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'moveTo',
        x: 99,
        y: 99,
        allowNearestReachable: false,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('無法到達該位置');
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                assert.equal(playerId, 'player:1');
                return {
                    playerId: 'player:1',
                    name: '妖',
                    instanceId: 'real:cold_tide_marsh',
                    x: 23,
                    y: 37,
                };
            },
        },
        logger: {
            log(message) {
                log.push(['log', message]);
            },
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone, _title, _icon, structured) {
            log.push(['queuePlayerNotice', playerId, message, tone, structured?.key ?? null]);
        },
    });
    assert.deepEqual(log, [
        ['queuePlayerNotice', 'player:1', '無法到達該位置', 'warn', 'notice.navigation.unreachable'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testAutoCombatInvalidTargetStaysServerInternal() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'basicAttack',
        targetPlayerId: null,
        targetMonsterId: null,
        targetX: 10,
        targetY: 11,
        autoCombat: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('該目標無法被攻擊');
        },
        buildAutoCombatCommand() {
            return null;
        },
        getInstanceRuntime() {
            return null;
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                return {
                    playerId,
                    instanceId: 'public:yunlai_town',
                    hp: 100,
                    combat: {
                        autoBattle: true,
                    },
                };
            },
            clearManualEngagePending(playerId) {
                log.push(['clearManualEngagePending', playerId]);
            },
            updateCombatSettings() {
                throw new Error('updateCombatSettings should not run for auto-combat target failure');
            },
            clearCombatTarget(playerId, currentTick) {
                log.push(['clearCombatTarget', playerId, currentTick]);
            },
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['clearManualEngagePending', 'player:1'],
        ['clearCombatTarget', 'player:1', 0],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);

    const skillService = new WorldRuntimePendingCommandService();
    const skillLog = [];
    skillService.enqueuePendingCommand('player:1', {
        kind: 'castSkill',
        skillId: 'skill:area',
        targetPlayerId: null,
        targetMonsterId: 'monster:gone',
        targetRef: null,
        autoCombat: true,
    });
    await skillService.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('沒有可命中的目標');
        },
        buildAutoCombatCommand() {
            return null;
        },
        getInstanceRuntime() {
            return null;
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                return {
                    playerId,
                    instanceId: 'public:yunlai_town',
                    hp: 100,
                    combat: {
                        autoBattle: true,
                    },
                };
            },
            clearManualEngagePending(playerId) {
                skillLog.push(['clearManualEngagePending', playerId]);
            },
            updateCombatSettings() {
                throw new Error('updateCombatSettings should not run for auto-combat target failure');
            },
            clearCombatTarget(playerId, currentTick) {
                skillLog.push(['clearCombatTarget', playerId, currentTick]);
            },
        },
        logger: {
            warn(message) {
                skillLog.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            skillLog.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(skillLog, [
        ['clearManualEngagePending', 'player:1'],
        ['clearCombatTarget', 'player:1', 0],
    ]);
    assert.equal(skillService.getPendingCommandCount(), 0);
}

async function testAutoCombatRetaliateFailurePreservesDifferentLockedTarget() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'basicAttack',
        targetPlayerId: 'attacker',
        targetMonsterId: null,
        targetX: null,
        targetY: null,
        autoCombat: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('該目標無法被攻擊');
        },
        buildAutoCombatCommand() {
            return null;
        },
        getInstanceRuntime() {
            return null;
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                return {
                    playerId,
                    instanceId: 'public:yunlai_town',
                    hp: 100,
                    combat: {
                        autoBattle: true,
                        combatTargetId: 'tile:2:1',
                        combatTargetLocked: true,
                    },
                };
            },
            clearManualEngagePending(playerId) {
                log.push(['clearManualEngagePending', playerId]);
            },
            clearCombatTarget(playerId, currentTick) {
                log.push(['clearCombatTarget', playerId, currentTick]);
            },
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['clearManualEngagePending', 'player:1'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testAutoCombatOutOfRangeClearsTargetWithoutNotice() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'castSkill',
        skillId: 'skill:area',
        targetPlayerId: null,
        targetMonsterId: 'monster:far',
        targetRef: null,
        autoCombat: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('技能 skill:area 超出範圍');
        },
        buildAutoCombatCommand() {
            return null;
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                return {
                    playerId,
                    instanceId: 'public:yunlai_town',
                    hp: 100,
                    x: 1,
                    y: 1,
                    techniques: {
                        techniques: [{
                            skills: [{
                                id: 'skill:area',
                                name: '地火術',
                                range: 3,
                                effects: [{ type: 'damage', formula: 1 }],
                            }],
                        }],
                    },
                    combat: {
                        autoBattle: false,
                        combatTargetId: 'monster:far',
                    },
                };
            },
            clearManualEngagePending(playerId) {
                log.push(['clearManualEngagePending', playerId]);
            },
            clearCombatTarget(playerId, currentTick) {
                log.push(['clearCombatTarget', playerId, currentTick]);
            },
        },
        getInstanceRuntime(instanceId) {
            assert.equal(instanceId, 'public:yunlai_town');
            return {
                getMonster(runtimeId) {
                    assert.equal(runtimeId, 'monster:far');
                    return {
                        runtimeId,
                        x: 7,
                        y: 2,
                        hp: 100,
                        alive: true,
                    };
                },
            };
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['clearManualEngagePending', 'player:1'],
        ['clearCombatTarget', 'player:1', 0],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testAutoCombatPlayerOutOfRangeClearsRetaliateAndThreatTarget() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'castSkill',
        skillId: 'skill.cloud_blade',
        targetPlayerId: null,
        targetMonsterId: null,
        targetRef: 'player:target:1',
        autoCombat: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('目標超出攻擊距離');
        },
        buildAutoCombatCommand() {
            return null;
        },
        getInstanceRuntime() {
            return null;
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                if (playerId === 'player:1') {
                    return {
                        playerId,
                        instanceId: 'public:yunlai_town',
                        hp: 100,
                        x: 43,
                        y: 56,
                        techniques: {
                            techniques: [{
                                skills: [{
                                    id: 'skill.cloud_blade',
                                    name: '流雲刀譜',
                                    range: 3,
                                    effects: [{ type: 'damage', formula: 1 }],
                                }],
                            }],
                        },
                        combat: {
                            autoBattle: false,
                            retaliatePlayerTargetId: 'target:1',
                            combatTargetId: 'player:target:1',
                        },
                    };
                }
                if (playerId === 'target:1') {
                    return {
                        playerId,
                        instanceId: 'public:yunlai_town',
                        hp: 100,
                        x: 99,
                        y: 1,
                        combat: {},
                    };
                }
                return null;
            },
            clearManualEngagePending(playerId) {
                log.push(['clearManualEngagePending', playerId]);
            },
            clearRetaliatePlayerTargetIfMatches(playerId, targetPlayerId, currentTick) {
                log.push(['clearRetaliatePlayerTargetIfMatches', playerId, targetPlayerId, currentTick]);
            },
            clearCombatTarget(playerId, currentTick) {
                log.push(['clearCombatTarget', playerId, currentTick]);
            },
        },
        worldRuntimeThreatService: {
            buildPlayerOwnerId(playerId) {
                log.push(['buildPlayerOwnerId', playerId]);
                return `player:${playerId}`;
            },
            multiplyThreat(ownerId, targetRef, multiplier) {
                log.push(['multiplyThreat', ownerId, targetRef, multiplier]);
            },
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['clearManualEngagePending', 'player:1'],
        ['clearRetaliatePlayerTargetIfMatches', 'player:1', 'target:1', 0],
        ['buildPlayerOwnerId', 'player:1'],
        ['multiplyThreat', 'player:player:1', 'player:target:1', 0],
        ['clearCombatTarget', 'player:1', 0],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testAutoCombatPlayerPvpDisabledClearsTargetWithoutNotice() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'basicAttack',
        targetPlayerId: 'target:1',
        targetMonsterId: null,
        targetX: null,
        targetY: null,
        autoCombat: true,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('當前實例不允許玩家互攻');
        },
        buildAutoCombatCommand() {
            return null;
        },
        getInstanceRuntime() {
            return null;
        },
        playerRuntimeService: {
            getPlayer(playerId) {
                if (playerId === 'player:1') {
                    return {
                        playerId,
                        instanceId: 'public:yunlai_town',
                        hp: 100,
                        x: 43,
                        y: 56,
                        combat: {
                            autoBattle: true,
                            retaliatePlayerTargetId: 'target:1',
                            combatTargetId: 'player:target:1',
                        },
                    };
                }
                if (playerId === 'target:1') {
                    return {
                        playerId,
                        instanceId: 'public:yunlai_town',
                        hp: 100,
                        x: 44,
                        y: 57,
                        combat: {},
                    };
                }
                return null;
            },
            clearManualEngagePending(playerId) {
                log.push(['clearManualEngagePending', playerId]);
            },
            clearRetaliatePlayerTargetIfMatches(playerId, targetPlayerId, currentTick) {
                log.push(['clearRetaliatePlayerTargetIfMatches', playerId, targetPlayerId, currentTick]);
            },
            clearCombatTarget(playerId, currentTick) {
                log.push(['clearCombatTarget', playerId, currentTick]);
            },
        },
        worldRuntimeThreatService: {
            buildPlayerOwnerId(playerId) {
                log.push(['buildPlayerOwnerId', playerId]);
                return `player:${playerId}`;
            },
            multiplyThreat(ownerId, targetRef, multiplier) {
                log.push(['multiplyThreat', ownerId, targetRef, multiplier]);
            },
        },
        logger: {
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ['clearManualEngagePending', 'player:1'],
        ['clearRetaliatePlayerTargetIfMatches', 'player:1', 'target:1', 0],
        ['buildPlayerOwnerId', 'player:1'],
        ['multiplyThreat', 'player:player:1', 'player:target:1', 0],
        ['clearCombatTarget', 'player:1', 0],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testSkillOutOfRangeStaysServerInternal() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'castSkill',
        skillId: 'skill.liyan_duanxi',
        targetPlayerId: null,
        targetMonsterId: 'monster:1',
        targetRef: null,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('Skill skill.liyan_duanxi out of range');
        },
        logger: {
            log(message) {
                log.push(['log', message]);
            },
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, []);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testManualSkillCooldownFailureUsesDebugWhenAvailable() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'castSkill',
        skillId: 'skill.iron_bone_art',
        targetPlayerId: null,
        targetMonsterId: null,
        targetRef: null,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('技能 skill.iron_bone_art 尚在冷卻');
        },
        logger: {
            log(message) {
                log.push(['log', message]);
            },
            debug(message) {
                log.push(['debug', message]);
            },
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone, _title, _icon, structured) {
            log.push(['queuePlayerNotice', playerId, message, tone, structured?.key ?? null]);
        },
    });
    assert.deepEqual(log, [
        ['debug', '處理玩家 player:1 的待執行指令失敗：castSkill（技能 skill.iron_bone_art 尚在冷卻） debug=auto=0 manual=0 skill=skill.iron_bone_art playerState=missing'],
        ['queuePlayerNotice', 'player:1', '技能尚在冷卻。', 'warn', 'notice.command.skill-cooldown'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testManualEngageNoTargetFailureUsesDebugWhenAvailable() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'engageBattle',
        targetPlayerId: null,
        targetMonsterId: 'monster:gone',
        targetX: null,
        targetY: null,
        locked: false,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error('沒有可命中的目標');
        },
        logger: {
            log(message) {
                log.push(['log', message]);
            },
            debug(message) {
                log.push(['debug', message]);
            },
            warn(message) {
                log.push(['warn', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone, _title, _icon, structured) {
            log.push(['queuePlayerNotice', playerId, message, tone, structured?.key ?? null]);
        },
    });
    assert.deepEqual(log, [
        ['debug', '處理玩家 player:1 的待執行指令失敗：engageBattle（沒有可命中的目標） debug=auto=0 manual=0 playerState=missing'],
        ['queuePlayerNotice', 'player:1', '沒有可命中的目標', 'warn', 'notice.command.no-target'],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testInternalSliceErrorStaysServerInternal() {
    const service = new WorldRuntimePendingCommandService();
    const log = [];
    service.enqueuePendingCommand('player:1', {
        kind: 'castSkill',
        skillId: 'skill.baihong_duanyue',
        targetPlayerId: null,
        targetMonsterId: 'monster:1',
        targetRef: null,
    });
    await service.dispatchPendingCommands({
        dispatchInstanceCommand() {
            throw new Error('unexpected dispatchInstanceCommand');
        },
        dispatchPlayerCommand() {
            throw new Error("Cannot read properties of undefined (reading 'slice')");
        },
        logger: {
            error(message) {
                log.push(['error', message]);
            },
        },
        queuePlayerNotice(playerId, message, tone) {
            log.push(['queuePlayerNotice', playerId, message, tone]);
        },
    });
    assert.deepEqual(log, [
        ["error", "處理玩家 player:1 的待執行指令失敗：castSkill（Cannot read properties of undefined (reading 'slice')） debug=auto=0 manual=0 skill=skill.baihong_duanyue playerState=missing"],
    ]);
    assert.equal(service.getPendingCommandCount(), 0);
}

async function testCaughtHttpExceptionsUseSemanticLogLevels() {
    async function dispatch(error) {
        const service = new WorldRuntimePendingCommandService();
        const logs = [];
        service.enqueuePendingCommand('player:semantic', {
            kind: 'startTechniqueTransmission',
            teacherPlayerId: 'player:teacher',
            techniqueId: 'technique:missing',
        });
        await service.dispatchPendingCommands({
            dispatchInstanceCommand() {
                throw new Error('unexpected dispatchInstanceCommand');
            },
            dispatchPlayerCommand() {
                throw error;
            },
            logger: {
                debug(message) {
                    logs.push(['debug', message]);
                },
                warn(message) {
                    logs.push(['warn', message]);
                },
                error(message) {
                    logs.push(['error', message]);
                },
            },
            queuePlayerNotice() {},
        });
        return logs;
    }

    const missingTeacherTechnique = await dispatch(new BadRequestException('傳授者尚未掌握該功法。'));
    const missingTechnique = await dispatch(new NotFoundException('功法不存在：technique:missing'));
    const unavailable = await dispatch(new ServiceUnavailableException('功法目錄暫不可用'));
    const programmingError = await dispatch(new TypeError('unexpected technique projection shape'));

    assert.deepEqual(missingTeacherTechnique.map(([level]) => level), ['debug']);
    assert.deepEqual(missingTechnique.map(([level]) => level), ['debug']);
    assert.deepEqual(unavailable.map(([level]) => level), ['warn']);
    assert.deepEqual(programmingError.map(([level]) => level), ['error']);
}

async function testStructuredNoticeAllowlistSanitizesCommandFamilies() {
    const cases = [
        {
            name: 'unknown-infrastructure-error',
            command: { kind: 'portal' },
            message: 'database host=internal-db pending write failed',
            text: '行動未能完成，請稍後重試。',
            key: 'notice.command.failed',
        },
        {
            name: 'unmapped-business-reject-reason',
            command: { kind: 'startGather', targetRef: 'resource:1' },
            message: '此處靈草已被採盡',
            text: '此處靈草已被採盡',
            key: 'notice.command.failed-with-reason',
        },
        {
            name: 'technique-queue-full',
            command: { kind: 'startAlchemy', payload: { presetId: 'preset:1' } },
            message: '技藝任務隊列已滿。',
            text: '技藝任務隊列已滿。',
            key: 'notice.command.technique-queue-full',
        },
        {
            name: 'protected-item-use',
            command: { kind: 'useItem', itemInstanceId: 'item:secret' },
            message: '當前位於安全區、出生點、傳送點或 NPC 附近，無法使用地塊資源道具。',
            text: '當前位於受保護區域，無法使用地塊資源道具。',
            key: 'notice.item.tile-resource-protected-area',
        },
        {
            name: 'qi-insufficient',
            command: { kind: 'castSkill', skillId: 'skill.internal', targetRef: null },
            message: '技能 skill.internal 元氣不足',
            text: '元氣不足。',
            key: 'notice.command.qi-insufficient',
        },
        {
            name: 'navigation-route-unavailable',
            command: { kind: 'moveTo', x: 10, y: 10, allowNearestReachable: false },
            message: '無法規劃前往 map.internal 的跨圖路線',
            text: '無法到達該位置',
            key: 'notice.navigation.unreachable',
        },
        {
            name: 'navigation-infrastructure-error',
            command: { kind: 'moveTo', x: 20, y: 20, allowNearestReachable: false },
            message: 'path worker=internal-7 crashed',
            text: '行動未能完成，請稍後重試。',
            key: 'notice.command.failed',
        },
    ];

    for (const testCase of cases) {
        const service = new WorldRuntimePendingCommandService();
        const notices = [];
        service.enqueuePendingCommand('player:structured', testCase.command);
        await service.dispatchPendingCommands({
            dispatchInstanceCommand() {
                throw new Error(testCase.message);
            },
            dispatchPlayerCommand() {
                throw new Error(testCase.message);
            },
            logger: {
                debug() {},
                log() {},
                warn() {},
            },
            queuePlayerNotice(playerId, text, kind, _title, _icon, structured) {
                notices.push({ playerId, text, kind, key: structured?.key ?? null });
            },
        });
        assert.deepEqual(notices, [{
            playerId: 'player:structured',
            text: testCase.text,
            kind: 'warn',
            key: testCase.key,
        }], testCase.name);
        assert.equal(JSON.stringify(notices).includes('internal'), false, testCase.name);
    }
}

testQueueOwnershipMethods();
Promise.resolve()
    .then(() => testDispatchRoutesAndClearsQueue())
    .then(() => testAsyncPlayerCommandIsAwaitedBeforeQueueClear())
    .then(() => testCombatResolvedCommandDropsSameTickMoveIntent())
    .then(() => testAutoCombatStaleTargetRetriesImmediately())
    .then(() => testAutoCombatFailedSkillFallsBackToAlternativeCommand())
    .then(() => testAutoCombatRetryFailureStaysSilentWithoutDebugLogger())
    .then(() => testManualEngageAttackClearsServerOnlyEngageState())
    .then(() => testInvalidAttackNoticeUsesTargetReason())
    .then(() => testForbiddenTileDamageUsesCapabilityNotice())
    .then(() => testMoveToUnreachableFailureDoesNotPromoteDebug())
    .then(() => testAutoCombatInvalidTargetStaysServerInternal())
    .then(() => testAutoCombatRetaliateFailurePreservesDifferentLockedTarget())
    .then(() => testAutoCombatOutOfRangeClearsTargetWithoutNotice())
    .then(() => testAutoCombatPlayerOutOfRangeClearsRetaliateAndThreatTarget())
    .then(() => testAutoCombatPlayerPvpDisabledClearsTargetWithoutNotice())
    .then(() => testSkillOutOfRangeStaysServerInternal())
    .then(() => testManualSkillCooldownFailureUsesDebugWhenAvailable())
    .then(() => testManualEngageNoTargetFailureUsesDebugWhenAvailable())
    .then(() => testInternalSliceErrorStaysServerInternal())
    .then(() => testCaughtHttpExceptionsUseSemanticLogLevels())
    .then(() => testStructuredNoticeAllowlistSanitizesCommandFamilies())
    .then(() => {
    console.log(JSON.stringify({
        ok: true,
        case: 'world-runtime-pending-command',
        answers: [
            '未知基礎設施異常統一映射為穩定通用失敗，原始文本只進入服務端診斷。',
            '戰鬥、導航、技藝和物品拒絕均使用結構化通知 key，技能與地圖內部 ID 不再進入玩家通知。',
            '自動戰鬥常態目標失效只進入 DEBUG；未知程序異常進入 ERROR，4xx/5xx 分別進入 DEBUG/WARN。',
        ],
    }, null, 2));
});
