import type { MovementFrameMetadata, SelfDeltaView, WorldDeltaView } from '@mud/shared';

interface MovementEnvelope {
  worldDelta?: WorldDeltaView;
  selfDelta?: SelfDeltaView;
  mapEnter?: unknown;
}

interface MovementCursor {
  instanceId: string;
  epoch: number;
  sequence: number;
}

interface PlayerMovementSegment {
  durationMs: number;
  toX: number;
  toY: number;
}

/** 對同一接收者的 world/self 差量加上共同時序，不額外製造空包。 */
export class WorldSyncMovementFrames {
  private readonly cursors = new Map<string, MovementCursor>();

  clear(playerId: string): void {
    this.cursors.delete(playerId);
  }

  stamp<T extends MovementEnvelope>(
    playerId: string,
    instanceId: string,
    envelope: T | null,
    initial: boolean,
    readSegment: (playerId: string) => PlayerMovementSegment | null | undefined,
    nowMs = performance.now(),
  ): T | null {
    if (!envelope || (!envelope.worldDelta && !envelope.selfDelta)) return envelope;
    let cursor = this.cursors.get(playerId);
    if (!cursor) {
      cursor = { instanceId, epoch: 1, sequence: 0 };
      this.cursors.set(playerId, cursor);
    } else if (initial || envelope.mapEnter || cursor.instanceId !== instanceId) {
      cursor.instanceId = instanceId;
      cursor.epoch += 1;
      cursor.sequence = 0;
    }
    const frame: MovementFrameMetadata = {
      e: cursor.epoch,
      q: ++cursor.sequence,
      at: Math.max(0, Math.round(nowMs)),
      dt: 100,
    };
    if (envelope.worldDelta) {
      envelope.worldDelta.mv = frame;
      if (!initial && envelope.worldDelta.full !== 1 && envelope.worldDelta.reset !== 1) {
        for (const patch of envelope.worldDelta.p ?? []) {
          if (patch.rm === 1 || (patch.x === undefined && patch.y === undefined)) continue;
          const segment = readSegment(patch.id);
          if (!segment || !Number.isFinite(segment.durationMs)
            || (patch.x !== undefined && patch.x !== segment.toX)
            || (patch.y !== undefined && patch.y !== segment.toY)) continue;
          patch.md = Math.max(40, Math.min(1000, Math.round(segment.durationMs)));
        }
      }
    }
    if (envelope.selfDelta) envelope.selfDelta.mv = frame;
    return envelope;
  }
}
