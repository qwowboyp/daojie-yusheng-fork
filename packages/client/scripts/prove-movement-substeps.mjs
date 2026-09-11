import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClientBrowserProof } from './browser-proof-runtime.mjs';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath) => readFile(path.join(clientRoot, relativePath), 'utf8');

const [deltaSource, storeSource, pixiSource, runtimeSource] = await Promise.all([
  readSource('src/main-runtime-delta-state-source.ts'),
  readSource('src/game-map/store/map-store.ts'),
  readSource('src/game-map/renderer/pixi-map-renderer-adapter.ts'),
  readSource('src/game-map/runtime/map-runtime.ts'),
]);

assert.match(deltaSource, /acceptMovementFrame\(data\.mv, 'world'/, 'world 必须在套用状态前拒绝旧移动帧');
assert.match(deltaSource, /acceptMovementFrame\(data\.mv, 'self'/, 'self 必须有独立游标');
assert.match(deltaSource, /entityMotionDurations\.set\(patch\.id, patch\.md\)/, '玩家 md 必须映射到实体移动段');
assert.match(storeSource, /data\.entityMotionDurations\?\.get\(patch\.id\)/, '不得把 mv.dt 套到所有实体');
assert.match(pixiSource, /entityT = anim\.motionStartedAt !== undefined \? entityProgress : t/, '有 md 的实体必须按自己的线性时间轴渲染');
assert.match(runtimeSource, /snapshot\.entityTransition\?\.motionSyncToken/, 'runtime 必须将同帧 token 传给 Pixi');

for (const viewport of [{ width: 960, height: 640 }, { width: 390, height: 844 }]) {
await withClientBrowserProof({ viewport, profilePrefix: 'mud-movement-substeps-' }, async (cdp) => {
  const result = await cdp.evaluate(`(async () => {
    const { MapStore } = await import('/src/game-map/store/map-store.ts');
    const { MapRuntime } = await import('/src/game-map/runtime/map-runtime.ts');
    const store = new MapStore();
    const self = { id: 'self', name: '自我', displayName: '自我', mapId: 'm1', instanceId: 'i1', x: 0, y: 0, hp: 10, maxHp: 10, facing: 'down', unlockedMinimapIds: [] };
    store.applyBootstrap({ self, players: [{ id: 'slow', x: 0, y: 1, char: '慢', color: '#fff', name: '慢者', kind: 'player' }, { id: 'fast', x: 0, y: 2, char: '快', color: '#fff', name: '快者', kind: 'player' }] });
    store.applyWorldDelta({ playerPatches: [{ id: 'slow', x: 1, y: 1 }, { id: 'fast', x: 4, y: 2 }], entityPatches: [], entityMotionDurations: new Map([['slow', 500], ['fast', 100]]), motion: { e: 1, q: 2, at: performance.now(), dt: 100 }, tickDurationMs: 1000 });
    const first = store.getSnapshot();
    const firstMotions = first.entityTransition?.motions;
    const firstToken = first.entityTransition?.motionSyncToken;
    const tickMs = first.tickTiming.durationMs;
    const slowMs = firstMotions?.get('slow')?.durationMs;
    const fastMs = firstMotions?.get('fast')?.durationMs;
    store.applySelfDelta({ x: 0, y: 0, hp: 9, motion: { e: 1, q: 2, at: performance.now(), dt: 100 } });
    const merged = store.getSnapshot();
    store.applyWorldDelta({ playerPatches: [{ id: 'slow', x: 2, y: 1 }], entityPatches: [], entityMotionDurations: new Map([['slow', 500]]), motion: { e: 1, q: 3, at: performance.now(), dt: 100 }, tickDurationMs: 1000 });
    const continued = store.getSnapshot();
    const { createMainRuntimeDeltaStateSource } = await import('/src/main-runtime-delta-state-source.ts');
    const cursorPlayer = { ...self };
    let worldAccepted = 0;
    let selfAccepted = 0;
    const source = createMainRuntimeDeltaStateSource({
      getPlayer: () => cursorPlayer, getLatestEntityById: () => undefined,
      setLatestObservedEntities: () => {}, setLatestObservedEntityMap: () => {}, refreshObservedDecorations: () => {},
      getLatestAttrUpdate: () => null, setLatestAttrUpdate: () => {}, mergeAttrUpdatePatch: (_, patch) => patch,
      syncAuraLevelBaseValue: () => {}, syncCurrentTimeState: () => {}, syncCurrentTimeTickInterval: () => {},
      applyWorldDeltaToRuntime: () => { worldAccepted += 1; }, applySelfDeltaToRuntime: () => { selfAccepted += 1; },
      navigation: { trimCurrentPathProgress: () => {}, triggerAutoInteractionIfReady: () => false, getPathTarget: () => null, getPathCells: () => [], clearCurrentPath: () => {}, syncPathCellsToRuntime: () => {} },
      targeting: { syncSenseQiOverlay: () => {}, syncTargetingOverlay: () => {}, setHoveredMapTile: () => {}, cancelTargeting: () => {}, clearState: () => {} },
      refreshHudChrome: () => {}, syncPlayerContext: () => {}, hideObserveModal: () => {}, clearLootPanel: () => {}, clearBuildingFengShuiState: () => {},
      setChatPersistenceScope: () => {}, setPanelRuntimeMapId: () => {}, syncQuestMapId: () => {}, updateAttrPanel: () => {}, refreshUiChrome: () => {},
      handleAttrUpdate: () => {}, handleInventoryUpdate: () => {}, handleEquipmentUpdate: () => {}, handleArtifactUpdate: () => {}, handleTechniqueUpdate: () => {}, handleActionsUpdate: () => {},
    });
    source.handleWorldDelta({ full: 1, mv: { e: 1, q: 1, at: 1, dt: 100 } });
    source.handleWorldDelta({ full: 1, mv: { e: 1, q: 1, at: 2, dt: 100 } });
    source.handleWorldDelta({ full: 1, mv: { e: 0, q: 9, at: 3, dt: 100 } });
    source.handleSelfDelta({ mv: { e: 1, q: 1, at: 1, dt: 100 } });
    source.resetMovementFrames();
    source.handleWorldDelta({ full: 1, mv: { e: 2, q: 1, at: 4, dt: 100 } });
    const host = document.createElement('div');
    host.style.cssText = 'width:640px;height:360px;position:fixed;left:-10000px;top:0';
    host.innerHTML = '<canvas id="game-canvas" width="640" height="360"></canvas>';
    document.body.append(host);
    const runtime = new MapRuntime();
    runtime.attach(host);
    runtime.setViewportSize(640, 360, 1);
    runtime.applyBootstrap({ self, players: [
      { id: 'slow', x: 0, y: 1, char: '慢', color: '#fff', name: '慢者', kind: 'player' },
      { id: 'fast', x: 0, y: 2, char: '快', color: '#fff', name: '快者', kind: 'player' },
      { id: 'monster', x: 0, y: 3, char: '獸', color: '#fff', name: '妖獸', kind: 'monster' },
    ] });
    runtime.applyWorldDelta({ playerPatches: [{ id: 'slow', x: 1, y: 1 }, { id: 'fast', x: 1, y: 2 }], entityPatches: [], entityMotionDurations: new Map([['slow', 500], ['fast', 100]]), motion: { e: 3, q: 1, at: performance.now(), dt: 100 }, tickDurationMs: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 180));
    const firstVisualX = runtime.renderer.entities.get('slow')?.root.position.x;
    runtime.setViewportSize(640, 360, 1);
    runtime.setPathCells([{ x: 1, y: 1 }]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const afterUiSyncX = runtime.renderer.entities.get('slow')?.root.position.x;
    runtime.applyWorldDelta({ playerPatches: [{ id: 'fast', x: 2, y: 2 }], entityPatches: [{ id: 'monster', x: 1, y: 3 }], entityMotionDurations: new Map([['fast', 100]]), motion: { e: 3, q: 2, at: performance.now(), dt: 100 }, tickDurationMs: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterFastX = runtime.renderer.entities.get('slow')?.root.position.x;
    const monsterHasMd = runtime.renderer.entities.get('monster')?.anim.motionStartedAt !== undefined;
    await new Promise((resolve) => setTimeout(resolve, 420));
    const slowSettledX = runtime.renderer.entities.get('slow')?.root.position.x;
    const slowTargetX = runtime.renderer.entities.get('slow')?.anim.targetWX;
    runtime.applyWorldDelta({ playerPatches: [{ id: 'slow', x: 2, y: 1 }], entityPatches: [], entityMotionDurations: new Map([['slow', 1000]]), motion: { e: 3, q: 3, at: performance.now(), dt: 100 }, tickDurationMs: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 650));
    const longSegmentMiddleX = runtime.renderer.entities.get('slow')?.root.position.x;
    await new Promise((resolve) => setTimeout(resolve, 500));
    const longSegmentEndX = runtime.renderer.entities.get('slow')?.root.position.x;
    const longTargetX = runtime.renderer.entities.get('slow')?.anim.targetWX;
    runtime.applyWorldDelta({ playerPatches: [{ id: 'self', x: 1, y: 0 }], entityPatches: [], entityMotionDurations: new Map([['self', 500]]), motion: { e: 3, q: 4, at: performance.now(), dt: 100 }, tickDurationMs: 1000 });
    runtime.applySelfDelta({ x: 1, y: 0, motion: { e: 3, q: 4, at: performance.now(), dt: 100 } });
    await new Promise((resolve) => setTimeout(resolve, 180));
    const selfView = runtime.renderer.entities.get('self');
    const selfVisualX = selfView?.root.position.x;
    const selfTargetX = selfView?.anim.targetWX;
    const selfMotionMs = runtime.store.getSnapshot().entityTransition?.motions?.get('self')?.durationMs;
    const selfCenterX = selfVisualX === undefined ? undefined : selfVisualX + (selfTargetX ?? 0) / 2;
    const cameraTargetX = runtime.camera.getState().targetX;
    runtime.destroy();
    host.remove();
    store.reset();
    return {
      tickMs,
      slowMs,
      fastMs,
      tokenRetained: merged.entityTransition?.motionSyncToken === firstToken,
      continuationMs: continued.entityTransition?.motions?.get('slow')?.durationMs,
      worldAccepted,
      selfAccepted,
      firstVisualX,
      afterUiSyncX,
      afterFastX,
      monsterHasMd,
      slowSettledX,
      slowTargetX,
      longSegmentMiddleX,
      longSegmentEndX,
      longTargetX,
      selfVisualX,
      selfTargetX,
      selfMotionMs,
      selfCenterX,
      cameraTargetX,
      resetTransition: store.getSnapshot().entityTransition,
    };
  })()`);
  assert.equal(result.tickMs, 340, 'WorldDelta.dt=1000 的既有玩法显示时钟不得变为 100ms');
  assert.equal(result.slowMs, 500, '2 格/秒玩家必须保持 500ms 移动段');
  assert.equal(result.fastMs, 100, '高速玩家必须使用服务端 md');
  assert.equal(result.tokenRetained, true, '同 envelope 的 self patch 不得重启 world 过渡');
  assert.equal(result.continuationMs, 500, '连续子步必须保留下一段的权威时长');
  assert.equal(result.worldAccepted, 2, '重复/旧 epoch world 包必须在状态层前拒绝，reset 后新基线可接受');
  assert.equal(result.selfAccepted, 1, 'world/self 必须使用独立 cursor，允许同 q 的 self 包');
  assert.ok(result.firstVisualX > 0 && result.firstVisualX < result.slowTargetX, '真实 Pixi 画面应在慢速段中间，而不是 100ms 后停住');
  assert.ok(result.afterUiSyncX > result.firstVisualX && result.afterUiSyncX < result.slowTargetX, 'viewport/选取同步不得重设 slow 的动画起点或直接结算');
  assert.ok(result.afterFastX > result.afterUiSyncX && result.afterFastX < result.slowTargetX, 'fast 新帧不得让 slow 跳到目标或回退');
  assert.equal(result.monsterHasMd, false, '无 md 怪物必须保留既有全局动画路径');
  assert.ok(Math.abs(result.slowSettledX - result.slowTargetX) <= 0.5, 'slow 500ms 段必须正常抵达终点');
  assert.ok(result.longSegmentMiddleX > result.slowTargetX && result.longSegmentMiddleX < result.longTargetX, '全局 340ms 到期后，1000ms md 段仍必须由 RAF 持续推进');
  assert.ok(Math.abs(result.longSegmentEndX - result.longTargetX) <= 0.5, '1000ms md 段最终必须抵达权威目标');
  assert.equal(result.selfMotionMs, 500, '本人的 world p.md 必须在 same-q self 后保留');
  assert.ok(result.selfVisualX > 0 && result.selfVisualX < result.selfTargetX, 'same-q self.x 不得撤销本人的 500ms 线性段');
  assert.ok(Math.abs(result.cameraTargetX - result.selfCenterX) <= 3, '镜头目标必须跟随上一实际绘制的本体中心，而非提前跳到权威终点');
  assert.equal(result.resetTransition, null, 'map reset 必须清除旧插值');
});
}

console.log('移动子步 Vite/Chrome proof 通过');
