import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClientBrowserProof } from './browser-proof-runtime.mjs';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [storeSource, rendererSource, runtimeSource] = await Promise.all([
  readFile(path.join(clientRoot, 'src/game-map/store/spirit-beast-map-store.ts'), 'utf8'),
  readFile(path.join(clientRoot, 'src/game-map/renderer/pixi-map-renderer-adapter.ts'), 'utf8'),
  readFile(path.join(clientRoot, 'src/game-map/runtime/map-runtime.ts'), 'utf8'),
]);
assert.match(storeSource, /delta\.mapInstanceId !== activeInstanceId/, '錯圖 instance 的 delta 必須拒絕');
assert.match(storeSource, /delta\.revision <= this\.revision/, '過期 revision 必須拒絕');
assert.match(rendererSource, /SPIRIT_BEAST_MOTION_DURATION_MS = 320/, '地圖獸移動必須沿用 320ms 表現插值');
assert.match(rendererSource, /MAX_RENDERED_SPIRIT_BEASTS = 30/, '地圖獸必須有 30 隻上限');
assert.match(runtimeSource, /this\.spiritBeasts\.clear\(\)/, '重連和切圖必須清空靈獸 AOI');

await withClientBrowserProof({ viewport: { width: 390, height: 844 }, profilePrefix: 'mud-spirit-beast-map-' }, async (cdp) => {
  const result = await cdp.evaluate(`(async () => {
    const { SpiritBeastMapStore } = await import('/src/game-map/store/spirit-beast-map-store.ts');
    const store = new SpiritBeastMapStore();
    const base = { mapInstanceId: 'instance-a', revision: 1, reset: true, added: [{ instanceId: 'beast-1', speciesId: 'spirit_beast.fan.metal.01', ownerPlayerId: 'owner', x: 2, y: 3, state: 'idle' }], updated: [], removed: [] };
    const accepted = store.apply(base, 'instance-a');
    const wrongMapRejected = !store.apply({ ...base, revision: 2, mapInstanceId: 'instance-b' }, 'instance-a');
    const staleRejected = !store.apply({ ...base, revision: 1, updated: [{ instanceId: 'beast-1', x: 99 }] }, 'instance-a');
    const moved = store.apply({ ...base, revision: 2, reset: undefined, added: [], updated: [{ instanceId: 'beast-1', x: 4, y: 5, state: 'working' }], removed: [] }, 'instance-a');
    const afterMove = store.entriesSnapshot()[0];
    const recalled = store.apply({ ...base, revision: 3, reset: undefined, added: [], updated: [], removed: ['beast-1'] }, 'instance-a');
    const emptyAfterRecall = store.entriesSnapshot().length === 0;
    store.clear();
    return { accepted, wrongMapRejected, staleRejected, moved, afterMove, recalled, emptyAfterRecall, emptyAfterReconnect: store.entriesSnapshot().length === 0 };
  })()`);
  assert.equal(result.accepted, true);
  assert.equal(result.wrongMapRejected, true);
  assert.equal(result.staleRejected, true);
  assert.equal(result.moved, true);
  assert.deepEqual({ x: result.afterMove.x, y: result.afterMove.y, state: result.afterMove.state }, { x: 4, y: 5, state: 'working' });
  assert.equal(result.recalled, true);
  assert.equal(result.emptyAfterRecall, true);
  assert.equal(result.emptyAfterReconnect, true);
});

console.log('spirit-beast map store proof passed');
