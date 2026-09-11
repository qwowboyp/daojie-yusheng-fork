import assert from 'node:assert/strict';
import { withClientBrowserProof } from './browser-proof-runtime.mjs';

await withClientBrowserProof({ viewport: { width: 960, height: 640 }, profilePrefix: 'mud-movement-bootstrap-' }, async (cdp) => {
  const result = await cdp.evaluate(`(async () => {
    const { createMainRuntimeStateSource } = await import('/src/main-runtime-state-source.ts');
    const { createMainRuntimeDeltaStateSource } = await import('/src/main-runtime-delta-state-source.ts');
    let player = null;
    let attr = null;
    const applied = [];
    let resetCount = 0;
    const noop = () => {};
    const baseOptions = new Proxy({
      getPlayer: () => player,
      getLatestEntityById: () => undefined,
      getLatestAttrUpdate: () => attr,
      setLatestAttrUpdate: (value) => { attr = value; },
      mergeAttrUpdatePatch: (_, patch) => patch,
      applyWorldDeltaToRuntime: (data) => { applied.push('w:' + data.motion.q); },
      applySelfDeltaToRuntime: (data) => { applied.push('s:' + data.motion.q); },
      navigation: { trimCurrentPathProgress: noop, triggerAutoInteractionIfReady: () => false, getPathTarget: () => null, getPathCells: () => [], clearCurrentPath: noop, syncPathCellsToRuntime: noop },
      targeting: { syncSenseQiOverlay: noop, syncTargetingOverlay: noop, setHoveredMapTile: noop, cancelTargeting: noop, clearState: noop },
    }, { get: (target, key) => key in target ? target[key] : noop });
    const deltas = createMainRuntimeDeltaStateSource(baseOptions);
    const bootstrapOptions = new Proxy({
      getPlayer: () => player,
      setPlayer: (value) => { player = value; },
      getLatestAttrUpdate: () => attr,
      setLatestAttrUpdate: (value) => { attr = value; },
      buildAttrStateFromPlayer: () => ({}),
      resolvePreviewTechniques: (value) => value,
      resetMovementFrames: () => { resetCount += 1; deltas.resetMovementFrames(); },
      applyWorldDelta: (...args) => deltas.handleWorldDelta(...args),
      applySelfDelta: (...args) => deltas.handleSelfDelta(...args),
    }, { get: (target, key) => key in target ? target[key] : noop });
    const state = createMainRuntimeStateSource(bootstrapOptions);
    const self = { id: 'p1', mapId: 'm1', instanceId: 'i1', x: 0, y: 0, hp: 10, maxHp: 10, facing: 'down', inventory: { items: [] }, equipment: {}, techniques: [], actions: [], quests: [] };
    const frame = (q) => ({ e: 1, q, at: q * 100, dt: 100 });
    const beginSession = () => {
      state.handleInitSession({ pid: 'p1' });
      state.handleMapEnter({ mid: 'm1', iid: 'i1' });
      state.handleWorldDelta({ full: 1, mv: frame(1) });
      state.handleSelfDelta({ mv: frame(1), x: 0 });
      state.handleWorldDelta({ mv: frame(2) });
      state.handleSelfDelta({ mv: frame(2), x: 1 });
    };
    beginSession();
    const beforeFirstBootstrap = applied.slice();
    state.handleBootstrap({ self, mapMeta: { name: '測試' } });
    const first = { applied: applied.slice(), x: player.x, resetCount };
    state.handleWorldDelta({ mv: frame(3) });
    state.handleSelfDelta({ mv: frame(3), x: 2 });
    const afterFirst = applied.slice();
    // 重連保留舊玩家物件時，新 epoch 仍要等 bootstrap 水合後按序套用。
    beginSession();
    const beforeReconnectBootstrap = applied.slice();
    state.handleBootstrap({ self, mapMeta: { name: '測試' } });
    state.handleWorldDelta({ mv: frame(3) });
    state.handleSelfDelta({ mv: frame(3), x: 2 });
    const reconnect = { applied: applied.slice(), x: player.x, resetCount };
    // 同會話補發 bootstrap 不得抹掉已建立的 mv 游標。
    state.handleBootstrap({ self: { ...self, x: 2 }, mapMeta: { name: '測試' } });
    state.handleWorldDelta({ mv: frame(4) });
    state.handleWorldDelta({ mv: frame(3) });
    const refresh = { applied: applied.slice(), resetCount };
    state.clear();
    return { beforeFirstBootstrap, first, afterFirst, beforeReconnectBootstrap, reconnect, refresh, clearResetCount: resetCount };
  })()`);
  assert.deepEqual(result.beforeFirstBootstrap, []);
  assert.deepEqual(result.first.applied, ['w:1', 's:1', 'w:2', 's:2'], '啟動期間不得丟棄完整基線或重排 world/self');
  assert.equal(result.first.x, 1, 'bootstrap 水合不得覆蓋較新的 self 位移');
  assert.equal(result.first.resetCount, 1);
  assert.deepEqual(result.afterFirst, ['w:1', 's:1', 'w:2', 's:2', 'w:3', 's:3']);
  assert.deepEqual(result.beforeReconnectBootstrap, result.afterFirst, '重連有舊 player 時同樣必須等待新 bootstrap');
  assert.deepEqual(result.reconnect.applied, [...result.afterFirst, ...result.afterFirst]);
  assert.equal(result.reconnect.x, 2);
  assert.equal(result.reconnect.resetCount, 2);
  assert.deepEqual(result.refresh.applied, [...result.reconnect.applied, 'w:4'], '同會話 bootstrap 後可接受新包，仍拒絕舊包');
  assert.equal(result.refresh.resetCount, 2);
  assert.equal(result.clearResetCount, 3);
});

console.log('移動首包與重連 Vite/Chrome proof 通過');
