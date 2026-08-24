/** 两种地图渲染后端共用的战斗特效布局与生命周期纯规则。 */

export interface FloatingTextBurstEntry {
  x: number;
  y: number;
  variant: 'damage' | 'action';
  burstOffsetX: number;
  burstOffsetY: number;
}

interface FloatingTextBurstTile<T extends FloatingTextBurstEntry> {
  damage: T[];
  action: T[];
}

/**
 * 复用行、格点和分组数组；调用方须以创建顺序传入条目，避免每帧字符串键、排序和元数据对象。
 */
export class FloatingTextBurstLayout<T extends FloatingTextBurstEntry> {
  private readonly rows = new Map<number, Map<number, FloatingTextBurstTile<T>>>();
  private readonly rowPool: Array<Map<number, FloatingTextBurstTile<T>>> = [];
  private readonly tilePool: Array<FloatingTextBurstTile<T>> = [];

  apply(entries: readonly T[], cellSize: number): void {
    this.reset();
    for (const entry of entries) {
      let row = this.rows.get(entry.x);
      if (!row) {
        row = this.rowPool.pop() ?? new Map<number, FloatingTextBurstTile<T>>();
        this.rows.set(entry.x, row);
      }
      let tile = row.get(entry.y);
      if (!tile) {
        tile = this.tilePool.pop() ?? { damage: [], action: [] };
        row.set(entry.y, tile);
      }
      tile[entry.variant].push(entry);
    }
    for (const row of this.rows.values()) {
      for (const tile of row.values()) {
        this.applyGroup(tile.damage, cellSize);
        this.applyGroup(tile.action, cellSize);
      }
    }
  }

  reset(): void {
    for (const row of this.rows.values()) {
      for (const tile of row.values()) {
        tile.damage.length = 0;
        tile.action.length = 0;
        this.tilePool.push(tile);
      }
      row.clear();
      this.rowPool.push(row);
    }
    this.rows.clear();
  }

  private applyGroup(group: readonly T[], cellSize: number): void {
    const count = group.length;
    for (let index = 0; index < count; index += 1) {
      const entry = group[index];
      if (count <= 1) {
        entry.burstOffsetX = 0;
        entry.burstOffsetY = 0;
        continue;
      }
      const centeredIndex = index - (count - 1) / 2;
      entry.burstOffsetX = centeredIndex * cellSize * 0.3;
      entry.burstOffsetY = Math.abs(centeredIndex) * cellSize * 0.12;
    }
  }
}

export function resolveFloatingTextDuration(
  variant: 'damage' | 'action',
  actionStyle: 'default' | 'divine' | 'chant' | undefined,
  durationMs: number | undefined,
): number {
  // 傷害數字 1400ms、動作字（攻擊/閃避/功法名）1800ms：拉長可讀時間；吟唱 1240ms 僅為服務端未下發時的兜底
  const fallback = variant !== 'action' ? 1400 : actionStyle === 'chant' ? 1240 : 1800;
  return normalizeTimedEffectDuration(durationMs, fallback);
}

/** 浮字前段保持全不透明的比例（傷害數字與動作字共用，確保飄出後仍清晰可讀）。 */
export const FLOATING_TEXT_HOLD_RATIO = 0.6;

/** 保持後淡：前段全不透明、尾段才線性淡出（divine/chant 各有自帶節奏，不使用此曲線）。 */
export function resolveFloatingTextAlpha(progress: number): number {
  if (progress <= FLOATING_TEXT_HOLD_RATIO) return 1;
  return Math.max(0, 1 - (progress - FLOATING_TEXT_HOLD_RATIO) / (1 - FLOATING_TEXT_HOLD_RATIO));
}

export function normalizeTimedEffectDuration(durationMs: number | undefined, fallback: number): number {
  const value = Number.isFinite(durationMs) ? Math.round(durationMs as number) : Math.round(fallback);
  return Math.max(1, value);
}

export function buildVerticalFloatingText(text: string): string {
  return [...text.trim()].filter((char) => char.trim().length > 0).join('\n');
}

export function pruneExpiredTimedEffectsInPlace<T extends { createdAt: number; duration: number }>(
  entries: T[],
  now: number,
): void {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < entries.length; readIndex += 1) {
    const entry = entries[readIndex];
    if (now - entry.createdAt >= entry.duration) continue;
    entries[writeIndex] = entry;
    writeIndex += 1;
  }
  entries.length = writeIndex;
}

export function resolveWarningZoneOrigin(
  cells: readonly { x: number; y: number }[],
  originX?: number,
  originY?: number,
): { x: number; y: number } {
  if (Number.isFinite(originX) && Number.isFinite(originY)) {
    return { x: Math.round(originX ?? 0), y: Math.round(originY ?? 0) };
  }
  let minX = cells[0]?.x ?? 0;
  let maxX = minX;
  let minY = cells[0]?.y ?? 0;
  let maxY = minY;
  for (const cell of cells) {
    if (cell.x < minX) minX = cell.x;
    if (cell.x > maxX) maxX = cell.x;
    if (cell.y < minY) minY = cell.y;
    if (cell.y > maxY) maxY = cell.y;
  }
  return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) };
}
