import { S2C, type SpiritBeastMapDeltaView, type SpiritBeastMapProjection } from '@mud/shared';
import type { SpiritBeastRuntimeService } from '../runtime/spirit-beast/spirit-beast-runtime.service';

/** 每位玩家的靈獸視野游標；初次同步及跨圖重置，離線時清除。 */
export class WorldSyncSpiritBeastMapCache {
    private readonly entriesByPlayerId = new Map<string, { mapInstanceId: string; revision: number; entries: Map<string, SpiritBeastMapProjection> }>();

    clear(playerId: string): void {
        this.entriesByPlayerId.delete(playerId);
    }

    emit(runtime: SpiritBeastRuntimeService | undefined, playerId: string, socket: any, view: any, player: any, reset: boolean): void {
        if (!runtime || !socket || !view?.instance?.instanceId || !view?.self) return;
        const mapInstanceId = String(view.instance.instanceId);
        const radius = Math.max(1, Math.round(Number(player?.attrs?.numericStats?.viewRange) || 12));
        const x = Math.trunc(Number(view.self.x) || 0);
        const y = Math.trunc(Number(view.self.y) || 0);
        const visible = runtime.listMapProjections(mapInstanceId)
            .filter((entry) => Math.max(Math.abs(entry.x - x), Math.abs(entry.y - y)) <= radius);
        const next = new Map(visible.map((entry) => [entry.instanceId, entry]));
        const previous = this.entriesByPlayerId.get(playerId);
        const mustReset = reset || !previous || previous.mapInstanceId !== mapInstanceId;
        const added: SpiritBeastMapProjection[] = [];
        const updated: SpiritBeastMapDeltaView['updated'] = [];
        const removed: string[] = [];
        if (mustReset) {
            added.push(...visible);
        } else {
            for (const [id, entry] of next) {
                const before = previous.entries.get(id);
                if (!before) { added.push(entry); continue; }
                const patch: SpiritBeastMapDeltaView['updated'][number] = { instanceId: id };
                if (before.x !== entry.x) patch.x = entry.x;
                if (before.y !== entry.y) patch.y = entry.y;
                if (before.state !== entry.state) patch.state = entry.state;
                if ((before.buildingId ?? null) !== (entry.buildingId ?? null)) patch.buildingId = entry.buildingId ?? null;
                if (Object.keys(patch).length > 1) updated.push(patch);
            }
            for (const id of previous.entries.keys()) if (!next.has(id)) removed.push(id);
        }
        if (!mustReset && added.length === 0 && updated.length === 0 && removed.length === 0) return;
        const revision = (previous?.revision ?? 0) + 1;
        this.entriesByPlayerId.set(playerId, { mapInstanceId, revision, entries: next });
        socket.emit(S2C.SpiritBeastMapDelta, { mapInstanceId, revision, ...(mustReset ? { reset: true } : {}), added, updated, removed } satisfies SpiritBeastMapDeltaView);
    }

}
