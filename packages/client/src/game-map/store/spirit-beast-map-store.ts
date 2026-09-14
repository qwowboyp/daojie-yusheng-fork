import type { SpiritBeastMapDeltaView } from '@mud/shared';

export type SpiritBeastMapEntry = SpiritBeastMapDeltaView['added'][number];

/** 靈獸 AOI 是獨立投影，絕不可混進可攻擊的 WorldDelta entities。 */
export class SpiritBeastMapStore {
  private mapInstanceId: string | null = null;
  private revision = -1;
  private readonly entries = new Map<string, SpiritBeastMapEntry>();

  clear(): void {
    this.mapInstanceId = null;
    this.revision = -1;
    this.entries.clear();
  }

  apply(delta: SpiritBeastMapDeltaView, activeInstanceId: string | null): boolean {
    if (!activeInstanceId || delta.mapInstanceId !== activeInstanceId || !Number.isSafeInteger(delta.revision)) return false;
    if (this.mapInstanceId !== null && this.mapInstanceId !== delta.mapInstanceId && !delta.reset) return false;
    if (this.mapInstanceId === delta.mapInstanceId && delta.revision <= this.revision) return false;
    if (delta.reset || this.mapInstanceId !== delta.mapInstanceId) this.entries.clear();
    this.mapInstanceId = delta.mapInstanceId;
    this.revision = delta.revision;
    for (const entry of delta.added) this.entries.set(entry.instanceId, { ...entry });
    for (const patch of delta.updated) {
      const previous = this.entries.get(patch.instanceId);
      if (!previous) continue;
      this.entries.set(patch.instanceId, {
        ...previous,
        ...(patch.x !== undefined ? { x: patch.x } : {}),
        ...(patch.y !== undefined ? { y: patch.y } : {}),
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.buildingId !== undefined ? { buildingId: patch.buildingId ?? undefined } : {}),
      });
    }
    for (const id of delta.removed) this.entries.delete(id);
    return true;
  }

  entriesSnapshot(): readonly SpiritBeastMapEntry[] {
    return [...this.entries.values()];
  }
}
