/** 驗證同息位置序號、跨圖代際及正式協議出口完整保留移動時序。 */
import assert from 'node:assert/strict';
import { decodeServerEventPayload, encodeServerEventPayload, S2C, type SelfDeltaView, type WorldDeltaView } from '@mud/shared';
import { WorldSyncMovementFrames } from '../network/world-sync-movement-frames';
import { WorldSyncProtocolService } from '../network/world-sync-protocol.service';

function main(): void {
  const frames = new WorldSyncMovementFrames();
  const segment = () => ({ durationMs: 500, toX: 2, toY: 1 });
  const initial = frames.stamp('p', 'a', {
    mapEnter: {},
    worldDelta: { t: 1, wr: 1, sr: 1, full: 1, dt: 1000, p: [{ id: 'p', x: 1, y: 1 }] } as WorldDeltaView,
    selfDelta: { sr: 1, x: 1, y: 1 } as SelfDeltaView,
  }, true, segment, 1000)!;
  assert.equal(initial.worldDelta.mv?.e, 1);
  assert.equal(initial.worldDelta.p?.[0].md, undefined);
  const next = frames.stamp('p', 'a', {
    worldDelta: { t: 1, wr: 2, sr: 2, p: [{ id: 'p', x: 2 }] } as WorldDeltaView,
    selfDelta: { sr: 2 } as SelfDeltaView,
  }, false, segment, 1100)!;
  assert.equal(next.worldDelta.t, initial.worldDelta.t);
  assert.equal(next.worldDelta.mv?.q, 2);
  assert.equal(next.worldDelta.mv, next.selfDelta.mv);
  assert.equal(next.worldDelta.dt, undefined);
  assert.equal(next.worldDelta.p?.[0].md, 500);
  const encoded = encodeServerEventPayload(S2C.WorldDelta, next.worldDelta);
  assert.deepEqual(decodeServerEventPayload(S2C.WorldDelta, encoded), next.worldDelta);
  const sent: { event: string; data: unknown }[] = [];
  new WorldSyncProtocolService().sendEnvelope({ emit(event: string, data: unknown) { sent.push({ event, data }); } }, next);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, S2C.SyncEnvelope);
  assert.deepEqual(sent[0].data, { w: next.worldDelta, s: next.selfDelta });
  assert.equal(frames.stamp('p', 'a', null, false, segment, 1200), null);
  const crossed = frames.stamp('p', 'b', {
    mapEnter: {}, worldDelta: { t: 0, wr: 1, sr: 1, full: 1 } as WorldDeltaView,
  }, false, segment, 1300)!;
  assert.equal(crossed.worldDelta.mv?.e, 2);
  assert.equal(crossed.worldDelta.mv?.q, 1);
  const resumed = frames.stamp('p', 'b', {
    worldDelta: { t: 0, wr: 1, sr: 1, full: 1 } as WorldDeltaView,
  }, true, segment, 1400)!;
  assert.equal(resumed.worldDelta.mv?.e, 3);
  frames.clear('p');
  console.log(JSON.stringify({ ok: true, case: 'world-sync-movement', sameTickOrdered: true, lowSpeedDurationMs: 500 }));
}

main();
