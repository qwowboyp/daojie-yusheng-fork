/** 用途：验证 100ms 玩家移动子步、预算余数、怪物穿越原子段与逻辑 tick 隔离。 */
import assert from 'node:assert/strict';

import { Direction } from '@mud/shared';

import { MapInstanceRuntime } from '../runtime/instance/map-instance.runtime';
import { WorldRuntimePendingCommandService } from '../runtime/world/command/world-runtime-pending-command.service';
import { WorldRuntimeMovementService } from '../runtime/world/world-runtime-movement.service';

function createTemplate() {
  const width = 32;
  const height = 3;
  const cellCount = width * height;
  return {
    id: 'movement_substeps_smoke',
    mapId: 'movement_substeps_smoke',
    name: '移動子步 Smoke',
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
    spawnX: 0,
    spawnY: 1,
    source: {},
  };
}

function createInstance(): MapInstanceRuntime {
  return new MapInstanceRuntime({
    instanceId: 'instance:movement-substeps-smoke',
    template: createTemplate(),
    monsterSpawns: [],
    kind: 'public',
    persistent: false,
    createdAt: Date.now(),
    displayName: '移動子步 Smoke',
    linePreset: 'peaceful',
    lineIndex: 1,
    instanceOrigin: 'smoke',
    defaultEntry: true,
    supportsPvp: false,
    canDamageTile: false,
  });
}

function connectPlayer(instance: MapInstanceRuntime, playerId: string, x: number, y: number): any {
  return instance.connectPlayer({
    playerId,
    sessionId: `session:${playerId}`,
    preferredX: x,
    preferredY: y,
  });
}

function resetMovementClock(player: any, nowMs: number): void {
  player.movePoints = 0;
  player.movementBudgetUpdatedAtMs = nowMs;
  player.movementWindowStartedAtMs = nowMs;
  player.movementStepsInWindow = 0;
  player.lastMovementFrameAtMs = 0;
  player.movementTickSpeed = 1;
  player.movementSuspended = false;
}

function enqueuePath(instance: MapInstanceRuntime, playerId: string, points: Array<{ x: number; y: number }>): void {
  assert.equal(instance.enqueueMove({
    playerId,
    direction: Direction.East,
    continuous: true,
    maxSteps: points.length,
    path: points,
    resetBudget: false,
  }), true);
}

function testFlatTerrainCadenceAndLogicalTickIsolation(): void {
  const instance = createInstance();
  const player = connectPlayer(instance, 'player:cadence', 0, 1);
  connectPlayer(instance, 'player:observer', 0, 0);
  resetMovementClock(player, 1000);
  enqueuePath(instance, player.playerId, [{ x: 1, y: 1 }, { x: 2, y: 1 }]);

  const beforeTick = instance.tick;
  const tooEarly = instance.advancePlayerMovement(player.playerId, 1100, 1);
  assert.equal(tooEarly.moved, false);
  assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 0, y: 1 });
  assert.equal(player.movePoints, 10, '基礎移速每秒一格，每 100ms 補十點');

  for (let nowMs = 1200; nowMs < 2000; nowMs += 100) {
    assert.equal(instance.advancePlayerMovement(player.playerId, nowMs, 1).moved, false);
  }
  const firstStep = instance.advancePlayerMovement(player.playerId, 2000, 1);
  assert.equal(firstStep.moved, true);
  assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 1, y: 1 });
  assert.equal(instance.tick, beforeTick);
  assert.equal(instance.hasPendingCommand(player.playerId), true);
  assert.equal(instance.getPlayerMovementMetadata(player.playerId)?.durationMs, 1000);
  assert.equal(firstStep.affectedPlayerIds.has('player:observer'), true);

  for (let nowMs = 2100; nowMs < 3000; nowMs += 100) {
    assert.equal(instance.advancePlayerMovement(player.playerId, nowMs, 1).moved, false);
  }
  const secondStep = instance.advancePlayerMovement(player.playerId, 3000, 1);
  assert.equal(secondStep.moved, true);
  assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 2, y: 1 });
  assert.equal(instance.hasPendingCommand(player.playerId), false);
}

function testMonsterTraversalIsAtomicAndBudgetSafe(): void {
  const instance = createInstance();
  const player = connectPlayer(instance, 'player:monster-segment', 2, 1);
  resetMovementClock(player, 3000);
  player.movePoints = 199;
  (instance as any).monsterRuntimeIdByTile.set(instance.toTileIndex(3, 1), 'monster:block');
  enqueuePath(instance, player.playerId, [{ x: 3, y: 1 }, { x: 4, y: 1 }]);

  const insufficient = instance.advancePlayerMovement(player.playerId, 3000, 1);
  assert.equal(insufficient.moved, false);
  assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 2, y: 1 });
  assert.equal(player.movePoints, 199);

  const committed = instance.advancePlayerMovement(player.playerId, 3010, 1);
  assert.equal(committed.moved, true);
  assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 4, y: 1 });
  assert.equal(player.movePoints, 0);
  assert.equal(instance.hasPendingCommand(player.playerId), false);
  assert.equal(instance.getPlayerMovementMetadata(player.playerId)?.durationMs, 1000, '跨怪原子段的表現時長仍受一秒上限約束');
}

function testFullTickCannotDoubleConsumeMovement(): void {
  const instance = createInstance();
  const player = connectPlayer(instance, 'player:logical-tick', 0, 1);
  resetMovementClock(player, 4000);
  player.movePoints = 100;
  enqueuePath(instance, player.playerId, [{ x: 1, y: 1 }]);

  const result = instance.tickOnce(null, { skipPlayerMovement: true, sleepMonsterAi: true });
  assert.equal(instance.tick, 1);
  assert.deepEqual(result.transfers, []);
  assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 0, y: 1 });
  assert.equal(instance.hasPendingCommand(player.playerId), true);

  assert.equal(instance.advancePlayerMovement(player.playerId, 4100, 1).moved, true);
  assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 1, y: 1 });
}

function testHighSpeedCapAndPathBoundary(): void {
  const instance = createInstance();
  const player = connectPlayer(instance, 'player:high-speed', 0, 1);
  // 用明確超過軟衰減後上限的移速，驗證每秒二十格硬上限。
  instance.setPlayerMoveSpeed(player.playerId, 100_000);
  resetMovementClock(player, 1000);
  player.movementWindowStartedAtMs = 1001;
  enqueuePath(instance, player.playerId, Array.from({ length: 20 }, (_, index) => ({ x: index + 1, y: 1 })));
  for (let nowMs = 1100; nowMs <= 2000; nowMs += 100) {
    instance.advancePlayerMovement(player.playerId, nowMs, 1);
  }
  assert.deepEqual(instance.getPlayerPosition(player.playerId), { x: 20, y: 1 });
  assert.equal(player.movementStepsInWindow, 20, '1x 实例须保留每现实秒最高 20 格');

  const heldDirection = createInstance();
  const heldPlayer = connectPlayer(heldDirection, 'player:held-direction', 0, 1);
  heldDirection.setPlayerMoveSpeed(heldPlayer.playerId, 100_000);
  resetMovementClock(heldPlayer, 2500);
  assert.equal(heldDirection.enqueueMove({
    playerId: heldPlayer.playerId,
    direction: Direction.East,
    continuous: true,
    maxSteps: 2,
  }), true);
  heldDirection.advancePlayerMovement(heldPlayer.playerId, 2600, 1);
  assert.deepEqual(heldDirection.getPlayerPosition(heldPlayer.playerId), { x: 2, y: 1 }, '持续方向输入在 100ms 可消费两格速率额度');

  const accelerated = createInstance();
  const acceleratedPlayer = connectPlayer(accelerated, 'player:accelerated', 0, 1);
  accelerated.setPlayerMoveSpeed(acceleratedPlayer.playerId, 100_000);
  resetMovementClock(acceleratedPlayer, 3000);
  acceleratedPlayer.movementTickSpeed = 10;
  enqueuePath(accelerated, acceleratedPlayer.playerId, Array.from({ length: 20 }, (_, index) => ({ x: index + 1, y: 1 })));
  accelerated.advancePlayerMovement(acceleratedPlayer.playerId, 3100, 10);
  assert.deepEqual(accelerated.getPlayerPosition(acceleratedPlayer.playerId), { x: 20, y: 1 });
  assert.equal(acceleratedPlayer.movementStepsInWindow, 20, '10x 实例须能在 100ms 执行原有一息 20 格上限');

  const bounded = createInstance();
  const boundedPlayer = connectPlayer(bounded, 'player:path-boundary', 0, 1);
  resetMovementClock(boundedPlayer, 4000);
  boundedPlayer.movePoints = 200;
  assert.equal(bounded.enqueueMove({
    playerId: boundedPlayer.playerId,
    direction: Direction.East,
    continuous: true,
    maxSteps: 2,
    path: [{ x: 1, y: 1 }],
  }), true);
  bounded.advancePlayerMovement(boundedPlayer.playerId, 4100, 1);
  assert.deepEqual(bounded.getPlayerPosition(boundedPlayer.playerId), { x: 1, y: 1 }, '不得在 path 尾端沿方向外推');

  const portalInstance = createInstance();
  const portalPlayer = connectPlayer(portalInstance, 'player:auto-portal', 0, 1);
  portalInstance.setPlayerMoveSpeed(portalPlayer.playerId, 100_000);
  resetMovementClock(portalPlayer, 5000);
  portalInstance.addRuntimePortal({
    id: 'portal:auto-middle',
    x: 1,
    y: 1,
    targetMapId: 'movement_substeps_smoke',
    targetX: 5,
    targetY: 1,
    kind: 'portal',
    trigger: 'auto',
  });
  enqueuePath(portalInstance, portalPlayer.playerId, [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  const portalMove = portalInstance.advancePlayerMovement(portalPlayer.playerId, 5100, 1);
  assert.deepEqual(portalInstance.getPlayerPosition(portalPlayer.playerId), { x: 1, y: 1 });
  assert.equal(portalMove.transfer?.reason, 'auto_portal', '同一子步可走多格时仍须在中途自动传送点停下');
}

function testPauseAndSpeedChangesDoNotCreateMovementDebt(): void {
  const pausedInstance = createInstance();
  const pausedPlayer = connectPlayer(pausedInstance, 'player:paused-clock', 0, 1);
  resetMovementClock(pausedPlayer, 1000);
  enqueuePath(pausedInstance, pausedPlayer.playerId, [{ x: 1, y: 1 }]);
  pausedInstance.paused = true;
  assert.equal(pausedInstance.advancePlayerMovement(pausedPlayer.playerId, 1500, 1).moved, false);
  pausedInstance.paused = false;
  assert.equal(pausedInstance.advancePlayerMovement(pausedPlayer.playerId, 1600, 1).moved, false);
  assert.equal(pausedPlayer.movePoints, 0, '恢复首帧不得补发暂停期间移动点数');
  pausedInstance.advancePlayerMovement(pausedPlayer.playerId, 1700, 1);
  assert.equal(pausedPlayer.movePoints, 10, '恢復後只按真實活動時間補點');

  const acceleratedInstance = createInstance();
  const acceleratedPlayer = connectPlayer(acceleratedInstance, 'player:speed-clock', 0, 1);
  resetMovementClock(acceleratedPlayer, 2000);
  enqueuePath(acceleratedInstance, acceleratedPlayer.playerId, [{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  acceleratedInstance.tickSpeed = 10;
  assert.equal(acceleratedInstance.advancePlayerMovement(acceleratedPlayer.playerId, 2500, 10).moved, false);
  assert.equal(acceleratedPlayer.movePoints, 0, '倍率切换首帧不得以新倍率回算旧区间');
  assert.equal(acceleratedInstance.advancePlayerMovement(acceleratedPlayer.playerId, 2600, 10).moved, true);
  assert.deepEqual(acceleratedInstance.getPlayerPosition(acceleratedPlayer.playerId), { x: 1, y: 1 });
}

async function testGuardsPrecedeDispatchAndMovementInterruptsCast(): Promise<void> {
  const instance = createInstance();
  const instancePlayer = connectPlayer(instance, 'player:guarded', 0, 1);
  const runtimePlayer = {
    playerId: instancePlayer.playerId,
    hp: 100,
    attrs: { numericStats: { moveSpeed: 0 } },
    movementCapabilities: { staticObstacleIgnore: false },
  };
  let leaseWritable = true;
  let materializeCount = 0;
  let dispatchCount = 0;
  let castInterruptCount = 0;
  let fenceCount = 0;
  const movementService = new WorldRuntimeMovementService();
  const deps: any = {
    getPlayerLocation: () => ({ instanceId: instance.meta.instanceId }),
    getInstanceRuntime: () => instance,
    playerRuntimeService: {
      getPlayer: () => runtimePlayer,
      recordActivity() {},
      syncWorldAnchorFromInstanceTick() {},
    },
    resolveCurrentTickForPlayerId: () => instance.tick,
    worldRuntimePlayerSkillDispatchService: {
      interruptPendingPlayerSkillCast() { castInterruptCount += 1; },
    },
    worldRuntimeCraftInterruptService: { interruptCraftForReason() {} },
    worldRuntimeNavigationService: {
      hasNavigationIntent: () => false,
      clearNavigationIntent() {},
      async materializeNavigationCommandsForPlayerIds() { materializeCount += 1; },
    },
    worldRuntimePendingCommandService: {
      hasPendingMovementCommand: () => true,
      async dispatchPendingMovementCommands() {
        dispatchCount += 1;
        movementService.dispatchInstanceCommand(runtimePlayer.playerId, {
          kind: 'move', direction: Direction.East, continuous: true, maxSteps: 1,
        }, deps);
      },
    },
    isInstanceLeaseWritable: () => leaseWritable,
    fenceInstanceRuntime() { fenceCount += 1; },
    applyTransfer() {},
  };

  instance.paused = true;
  movementService.activatePlayer(runtimePlayer.playerId, 5000);
  await movementService.advanceMovementFrame(5000, deps);
  assert.deepEqual([materializeCount, dispatchCount, castInterruptCount], [0, 0, 0]);

  instance.paused = false;
  leaseWritable = false;
  movementService.activatePlayer(runtimePlayer.playerId, 6000);
  await movementService.advanceMovementFrame(6000, deps);
  assert.deepEqual([materializeCount, dispatchCount, castInterruptCount, fenceCount], [0, 0, 0, 1]);

  leaseWritable = true;
  runtimePlayer.hp = 0;
  movementService.activatePlayer(runtimePlayer.playerId, 7000);
  await movementService.advanceMovementFrame(7000, deps);
  assert.deepEqual([materializeCount, dispatchCount, castInterruptCount], [0, 0, 0]);

  runtimePlayer.hp = 100;
  resetMovementClock(instancePlayer, 8000);
  instancePlayer.movePoints = 100;
  movementService.activatePlayer(runtimePlayer.playerId, 8000);
  await movementService.advanceMovementFrame(8000, deps);
  assert.deepEqual([materializeCount, dispatchCount, castInterruptCount], [1, 1, 1]);
}

async function testMovementDispatchDoesNotBypassAssetFifo(): Promise<void> {
  const pending = new WorldRuntimePendingCommandService();
  pending.enqueuePendingCommand('player:fifo', { kind: 'useItem', inventoryItemId: 'asset:first' });
  pending.enqueuePendingCommand('player:fifo', { kind: 'move', direction: Direction.East, continuous: true });
  let movementDispatchCount = 0;
  await pending.dispatchPendingMovementCommands({
    worldRuntimeMovementService: {
      dispatchInstanceCommand() { movementDispatchCount += 1; },
    },
  }, ['player:fifo']);
  assert.equal(movementDispatchCount, 0);
  assert.equal(pending.getPendingCommandCount(), 2, 'movement-only 帧不得越过资产队首');
}

async function testCrossMapObserversAreAffected(): Promise<void> {
  const source = createInstance();
  const destination = createInstance();
  destination.meta.instanceId = 'instance:movement-substeps-destination';
  const movingPlayer = connectPlayer(source, 'player:transfer', 1, 1);
  connectPlayer(source, 'player:source-observer', 0, 1);
  connectPlayer(destination, 'player:destination-observer', 3, 1);
  assert.equal(source.enqueuePortalUse({ playerId: movingPlayer.playerId }), true);
  (source as any).tryPortalTransfer = () => ({
    playerId: movingPlayer.playerId,
    sessionId: movingPlayer.sessionId,
    fromInstanceId: source.meta.instanceId,
    targetMapId: destination.meta.templateId,
    targetInstanceId: destination.meta.instanceId,
    targetX: 2,
    targetY: 1,
    reason: 'manual_portal',
  });
  let currentInstance = source;
  const runtimePlayer = { playerId: movingPlayer.playerId, hp: 100 };
  const movementService = new WorldRuntimeMovementService();
  const deps: any = {
    getPlayerLocation: () => ({ instanceId: currentInstance.meta.instanceId }),
    getInstanceRuntime: (instanceId: string) => (
      instanceId === source.meta.instanceId ? source : destination
    ),
    playerRuntimeService: { getPlayer: () => runtimePlayer },
    worldRuntimeNavigationService: {
      hasNavigationIntent: () => false,
      clearNavigationIntent() {},
      async materializeNavigationCommandsForPlayerIds() {},
    },
    worldRuntimePendingCommandService: {
      hasPendingMovementCommand: () => false,
      async dispatchPendingMovementCommands() {},
    },
    isInstanceLeaseWritable: () => true,
    applyTransfer() {
      source.disconnectPlayer(movingPlayer.playerId);
      connectPlayer(destination, movingPlayer.playerId, 2, 1);
      currentInstance = destination;
    },
  };
  movementService.activatePlayer(movingPlayer.playerId, 9000);
  const affected = await movementService.advanceMovementFrame(9000, deps);
  assert.equal(affected.has('player:source-observer'), true);
  assert.equal(affected.has('player:destination-observer'), true);
  assert.equal(affected.has(movingPlayer.playerId), true);
}

async function testActivityIndexAndAnchorSync(): Promise<void> {
  const instance = createInstance();
  const instancePlayer = connectPlayer(instance, 'player:indexed', 0, 1);
  const nowMs = performance.now();
  resetMovementClock(instancePlayer, nowMs);
  instancePlayer.movePoints = 100;
  const runtimePlayer = {
    playerId: instancePlayer.playerId,
    hp: 100,
    attrs: { numericStats: { moveSpeed: 0 } },
    movementCapabilities: { staticObstacleIgnore: false },
  };
  const anchors: unknown[] = [];
  const movementService = new WorldRuntimeMovementService();
  const deps: any = {
    getPlayerLocation: () => ({ instanceId: instance.meta.instanceId }),
    getInstanceRuntime: () => instance,
    playerRuntimeService: {
      getPlayer: () => runtimePlayer,
      recordActivity() {},
      syncWorldAnchorFromInstanceTick(_playerId: string, anchor: unknown) {
        anchors.push(anchor);
      },
    },
    resolveCurrentTickForPlayerId: () => instance.tick,
    worldRuntimePlayerSkillDispatchService: { interruptPendingPlayerSkillCast() {} },
    worldRuntimeCraftInterruptService: { interruptCraftForReason() {} },
    worldRuntimeNavigationService: {
      hasNavigationIntent: () => false,
      async materializeNavigationCommandsForPlayerIds() {},
    },
    worldRuntimePendingCommandService: {
      hasPendingMovementCommand: () => false,
      async dispatchPendingMovementCommands() {},
    },
    isInstanceLeaseWritable: () => true,
    applyTransfer() {},
  };

  movementService.dispatchInstanceCommand(runtimePlayer.playerId, {
    kind: 'move',
    direction: Direction.East,
    continuous: true,
    maxSteps: 1,
    path: [{ x: 1, y: 1 }],
  }, deps);
  const frameNowMs = performance.now();
  assert.equal(movementService.resolveNextMovementDelayMs(frameNowMs), 0);
  const affected = await movementService.advanceMovementFrame(frameNowMs, deps);
  assert.equal(affected.has(runtimePlayer.playerId), true);
  assert.equal(anchors.length, 1);
  assert.equal(movementService.resolveNextMovementDelayMs(frameNowMs), null);
}

async function main(): Promise<void> {
  const cases: Array<readonly [string, () => void | Promise<void>]> = [
    ['flat-cadence-and-logical-isolation', testFlatTerrainCadenceAndLogicalTickIsolation],
    ['monster-atomic-budget', testMonsterTraversalIsAtomicAndBudgetSafe],
    ['logical-tick-no-double-consume', testFullTickCannotDoubleConsumeMovement],
    ['speed-cap-path-and-portal-boundary', testHighSpeedCapAndPathBoundary],
    ['pause-and-speed-clock-boundary', testPauseAndSpeedChangesDoNotCreateMovementDebt],
    ['pre-dispatch-guards-and-cast-interrupt', testGuardsPrecedeDispatchAndMovementInterruptsCast],
    ['asset-fifo', testMovementDispatchDoesNotBypassAssetFifo],
    ['cross-map-observers', testCrossMapObserversAreAffected],
    ['activity-index-and-anchor', testActivityIndexAndAnchorSync],
  ];
  const failures: Error[] = [];
  for (const [name, run] of cases) {
    try {
      await run();
    } catch (error: unknown) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failure.message = `[${name}] ${failure.message}`;
      failures.push(failure);
    }
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure);
    }
    throw new AggregateError(failures, `${failures.length} movement substep smoke case(s) failed`);
  }
  console.log(JSON.stringify({ ok: true, case: 'world-runtime-movement-substeps' }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
