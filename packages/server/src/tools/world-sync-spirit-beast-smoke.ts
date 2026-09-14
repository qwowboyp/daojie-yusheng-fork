/** 用途：驗證靈獸 AOI 差量、跨圖與離線游標，以及通知不重送。 */
import assert from 'node:assert/strict';
import { S2C, type SpiritBeastMapDeltaView, type SpiritBeastMapProjection } from '@mud/shared';
import { WorldSyncSpiritBeastMapCache } from '../network/world-sync-spirit-beast-map-cache';
import { emitPendingInitialNotices, emitPendingRuntimeEvents } from '../network/world-sync-runtime-notices';
import type { SpiritBeastRuntimeService } from '../runtime/spirit-beast/spirit-beast-runtime.service';

function main(): void {
  const cache = new WorldSyncSpiritBeastMapCache();
  let entries: SpiritBeastMapProjection[] = [
    { instanceId: 'beast:1', speciesId: 'species:1', ownerPlayerId: 'player:1', x: 1, y: 0, state: 'idle' },
    { instanceId: 'beast:2', speciesId: 'species:2', ownerPlayerId: 'player:1', x: 20, y: 0, state: 'idle' },
  ];
  const runtime = { listMapProjections: () => entries } as unknown as SpiritBeastRuntimeService;
  const messages: SpiritBeastMapDeltaView[] = [];
  const socket = { emit: (event: string, delta: SpiritBeastMapDeltaView) => {
    assert.equal(event, S2C.SpiritBeastMapDelta);
    messages.push(delta);
  } };
  const view = { instance: { instanceId: 'sect:1' }, self: { x: 0, y: 0 } };
  const player = { attrs: { numericStats: { viewRange: 2 } } };
  const emit = (reset = false) => cache.emit(runtime, 'player:1', socket, view, player, reset);
  emit(true);
  assert.equal(messages[0].reset, true);
  assert.deepEqual(messages[0].added.map((entry) => entry.instanceId), ['beast:1']);
  emit();
  assert.equal(messages.length, 1, '未變更不可重送');
  entries = [{ ...entries[0], x: 2, state: 'working', buildingId: 'mine:1' }, entries[1]];
  emit();
  assert.deepEqual(messages[1].updated, [{ instanceId: 'beast:1', x: 2, state: 'working', buildingId: 'mine:1' }]);
  entries = [{ ...entries[0], buildingId: undefined }, entries[1]];
  emit();
  assert.deepEqual(messages[2].updated, [{ instanceId: 'beast:1', buildingId: null }]);
  view.self.x = 20;
  emit();
  assert.deepEqual(messages[3].removed, ['beast:1']);
  assert.deepEqual(messages[3].added.map((entry) => entry.instanceId), ['beast:2']);
  view.instance.instanceId = 'sect:2';
  emit();
  assert.equal(messages[4].reset, true, '跨圖重置視野');
  cache.clear('player:1');
  emit();
  assert.equal(messages[5].reset, true, '離線清理後需完整初次同步');
  assert.equal(messages[5].revision, 1);

  let notices = ['notice'];
  let sent = 0;
  let gmUpdates = 0;
  const playerRuntime = { drainNotices: () => { const pending = notices; notices = []; return pending; } };
  const protocol = { sendNotices: () => { sent += 1; } };
  const gm = { emitState: () => { gmUpdates += 1; } };
  emitPendingRuntimeEvents(gm, playerRuntime, protocol, 'player:1', socket, { gmStatePush: true, worldDelta: { eventBus: [] } });
  assert.equal(gmUpdates, 1);
  assert.equal(sent, 0, 'envelope 已含 EventBus 不重送');
  emitPendingInitialNotices(playerRuntime, protocol, 'player:1', socket);
  emitPendingRuntimeEvents(gm, playerRuntime, protocol, 'player:1', socket, {});
  assert.equal(sent, 1, '待送通知只清空一次');
  console.log(JSON.stringify({ ok: true, case: 'world-sync-spirit-beast', deltas: messages.length }));
}

try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
