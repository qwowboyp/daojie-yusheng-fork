/**
 * 验证建筑搬迁链路：仅自己建设的完工建筑可搬迁，目标点需在视野与范围内，搬迁后旧格还原、新格占位可逆。
 */
import assert from 'node:assert/strict';

import { TileType } from '@mud/shared';

import { getDefaultBuildingRuntime } from '../runtime/building/building-default-content';
import { MapInstanceRuntime } from '../runtime/instance/map-instance.runtime';
import { MapTemplateRepository } from '../runtime/map/map-template.repository';
import { handleBuildMoveIntent } from '../runtime/world/world-runtime-building.service';

const MARKER = 'BUILD_MOVE_PROOF:PASS';

async function main(): Promise<void> {
  const playerId = 'move-proof:owner';
  const foreignPlayerId = 'move-proof:visitor';
  const ownedBuildingId = 'move-proof:stone-wall:owned';
  const foreignBuildingId = 'move-proof:stone-wall:foreign';
  const unfinishedBuildingId = 'move-proof:stone-wall:unfinished';
  const templateRepository = new MapTemplateRepository();
  templateRepository.registerRuntimeMapTemplate({
    id: 'move-proof-building-move',
    name: '搬迁坐标验证',
    width: 7,
    height: 5,
    routeDomain: 'system',
    tiles: Array.from({ length: 5 }, () => '.......'),
    spawnPoint: { x: 6, y: 4 },
    portals: [],
    npcs: [],
    monsters: [],
    safeZones: [],
    landmarks: [],
    containers: [],
    auras: [],
  });

  const instance = new MapInstanceRuntime({
    instanceId: 'real:move-proof-building-move',
    template: templateRepository.getOrThrow('move-proof-building-move'),
    monsterSpawns: [],
    kind: 'public',
    persistent: true,
    createdAt: Date.now(),
    displayName: '搬迁坐标验证',
    linePreset: 'real',
    lineIndex: 1,
    instanceOrigin: 'move-proof',
    defaultEntry: true,
    canDamageTile: true,
  });
  const { catalog, rules } = getDefaultBuildingRuntime();
  instance.configureBuildingRuntime(catalog, rules);

  function placeWall(buildingId: string, x: number, y: number, ownerPlayerId: string, state = 'active'): void {
    const placement = instance.placeBuildingInstance({
      buildingId,
      defId: 'stone_wall',
      x,
      y,
      ownerPlayerId,
      state,
    });
    assert.equal(placement.ok, true, `${buildingId} 应能通过生产放置链进入权威运行态`);
  }

  placeWall(ownedBuildingId, 1, 2, playerId);
  placeWall(foreignBuildingId, 4, 0, foreignPlayerId);
  placeWall(unfinishedBuildingId, 2, 3, playerId, 'building');

  const domainPlayer = {
    playerId,
    x: 0,
    y: 2,
    attrs: { numericStats: { viewRange: 5 } },
  };
  instance.playersById.set(playerId, { playerId, x: 0, y: 2, selfRevision: 1 });
  let visibleTileIndices = new Set<number>();
  const runtime = {
    tick: 1,
    buildingOperationResultsByKey: new Map<string, unknown>(),
    buildingOperationAuditLog: [] as unknown[],
    getPlayerLocationOrThrow: () => ({ instanceId: instance.meta.instanceId, x: domainPlayer.x, y: domainPlayer.y }),
    getInstanceRuntimeOrThrow: () => instance,
    getPlayerView: () => ({
      visibleTileIndices: Array.from(visibleTileIndices),
      visibleTileKeys: [],
    }),
    playerRuntimeService: {
      getPlayer: (requestedPlayerId: string) => requestedPlayerId === playerId ? domainPlayer : null,
      getViewRadius: (requestedPlayerId: string) => requestedPlayerId === playerId ? 5 : 1,
    },
  };

  // 1) 他人的建筑不得搬迁，且状态不得改变。
  visibleTileIndices = new Set([instance.toTileIndex(1, 2)]);
  const foreignResult = await handleBuildMoveIntent(runtime, playerId, {
    requestId: 'move-proof:move:foreign',
    buildingId: foreignBuildingId,
    x: 5,
    y: 1,
  });
  assert.equal(foreignResult.ok, false, '他人建设的建筑必须拒绝搬迁');
  assert.equal(foreignResult.reason, 'building_owner_mismatch');
  assert.equal(instance.buildingById.get(foreignBuildingId)?.x, 4, '被拒绝的搬迁不得改变他人建筑坐标');
  assert.equal(instance.buildingById.get(foreignBuildingId)?.y, 0);

  // 2) 未完工的半成品不得搬迁。
  visibleTileIndices = new Set([
    instance.toTileIndex(1, 2),
    instance.toTileIndex(2, 3),
    instance.toTileIndex(3, 1),
  ]);
  const unfinishedResult = await handleBuildMoveIntent(runtime, playerId, {
    requestId: 'move-proof:move:unfinished',
    buildingId: unfinishedBuildingId,
    x: 3,
    y: 1,
  });
  assert.equal(unfinishedResult.ok, false, '半成品必须拒绝搬迁');
  assert.equal(unfinishedResult.reason, 'building_move_unavailable');
  assert.equal(instance.buildingById.get(unfinishedBuildingId)?.x, 2, '被拒绝的搬迁不得改变半成品坐标');
  assert.equal(instance.buildingById.get(unfinishedBuildingId)?.y, 3);

  // 3) 目标点超范围或不可见都必须拒绝，防止隔空搬迁。
  visibleTileIndices = new Set([instance.toTileIndex(1, 2)]);
  const farResult = await handleBuildMoveIntent(runtime, playerId, {
    requestId: 'move-proof:move:far',
    buildingId: ownedBuildingId,
    x: 6,
    y: 4,
  });
  assert.equal(farResult.ok, false, '超出视野范围的搬迁必须拒绝');
  assert.equal(farResult.reason, 'building_out_of_range');
  assert.equal(instance.buildingById.get(ownedBuildingId)?.x, 1, '拒绝后建筑坐标保持不变');

  const hiddenResult = await handleBuildMoveIntent(runtime, playerId, {
    requestId: 'move-proof:move:hidden',
    buildingId: ownedBuildingId,
    x: 3,
    y: 4,
  });
  assert.equal(hiddenResult.ok, false, '范围内但不在权威 AOI 的目标点必须拒绝');
  assert.equal(hiddenResult.reason, 'building_not_visible');
  assert.equal(instance.buildingById.get(ownedBuildingId)?.x, 1, '拒绝后建筑坐标保持不变');
  assert.equal(instance.buildingCellsById.get(ownedBuildingId)?.includes(instance.toTileIndex(1, 2)), true, '拒绝后旧占格必须保留');

  // 4) 自己的完工建筑正常搬迁：坐标、占格与地块全部迁移。
  visibleTileIndices = new Set([instance.toTileIndex(1, 2), instance.toTileIndex(5, 1)]);
  const moveResult = await handleBuildMoveIntent(runtime, playerId, {
    requestId: 'move-proof:move:ok',
    buildingId: ownedBuildingId,
    x: 5,
    y: 1,
  });
  assert.equal(moveResult.ok, true, `自有建筑搬迁应成功，实际原因：${String(moveResult.reason ?? '')}`);
  assert.equal(moveResult.moved, true, '搬迁成功必须回报 moved=true');
  const movedBuilding = instance.buildingById.get(ownedBuildingId);
  assert.equal(movedBuilding?.x, 5, '搬迁后锚点 x 必须更新');
  assert.equal(movedBuilding?.y, 1, '搬迁后锚点 y 必须更新');
  assert.equal(instance.buildingCellsById.get(ownedBuildingId)?.includes(instance.toTileIndex(5, 1)), true, '新占格必须纳入权威索引');
  assert.equal(instance.buildingCellsById.get(ownedBuildingId)?.includes(instance.toTileIndex(1, 2)), false, '旧占格必须从权威索引移除');
  assert.equal(instance.tilePlane.getTileType(instance.toTileIndex(1, 2)), TileType.Floor, '旧格地块状态必须还原');
  assert.equal(instance.tilePlane.getTileType(instance.toTileIndex(5, 1)), TileType.Wall, '石墙视觉必须随建筑落到新格');

  // 5) 相同 requestId 重放必须命中幂等缓存，不得二次搬迁。
  const replayResult = await handleBuildMoveIntent(runtime, playerId, {
    requestId: 'move-proof:move:ok',
    buildingId: ownedBuildingId,
    x: 5,
    y: 1,
  });
  assert.equal(replayResult.duplicate, true, '相同 requestId 必须命中幂等重放');
  assert.equal(replayResult.ok, true);
  assert.equal(instance.buildingById.get(ownedBuildingId)?.x, 5);

  assert.equal(runtime.buildingOperationAuditLog.length, 5, '成功与拒绝结果都必须进入既有操作审计链');

  console.log(MARKER);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
