/**
 * dual-grid 地塊邊緣羽化共用數學與選項歸一化。
 *
 * Canvas 路徑（renderer/runtime-image-pack.ts）與 Pixi 路徑
 * （game-map/renderer/pixi-dual-grid-feather.ts）共用同一套
 * 「距離 fade + noise 干擾」公式，保證兩個渲染器的材質過渡帶一致。
 */

export type DualGridFadeCurve = 'linear' | 'smooth' | 'ease-in' | 'ease-out';

export type DualGridNoiseType = 'hash' | 'value' | 'fractal' | 'cellular';

export interface DualGridEdgeOptions {
  range: number;
  fade: number;
  fadeStart: number;
  fadeCurve: DualGridFadeCurve;
  noise: boolean;
  noiseType: DualGridNoiseType;
  noiseScale: number;
  noiseAmount: number;
}

export interface DualGridOptions {
  enabled: boolean;
  edge: DualGridEdgeOptions;
}

/** 象限 bit：1=TL、2=BL、4=TR、8=BR（與 atlas mask 位元一致）。 */
export const DUAL_GRID_QUADS = [
  { mask: 1, x: 0, y: 0 },
  { mask: 2, x: 0, y: 0.5 },
  { mask: 4, x: 0.5, y: 0 },
  { mask: 8, x: 0.5, y: 0.5 },
] as const;

export const DEFAULT_DUAL_GRID_EDGE: DualGridEdgeOptions = Object.freeze({
  range: 20,
  fade: 100,
  fadeStart: 33,
  fadeCurve: 'ease-in',
  noise: true,
  noiseType: 'cellular',
  noiseScale: 20,
  noiseAmount: 50,
});

/** 羽化框解析度（每格 32px），Canvas 版 edge frame 與 Pixi 版共用。 */
export const DUAL_GRID_EDGE_FRAME_SIZE = 32;
export const DUAL_GRID_EDGE_NOISE_VARIANTS = 8;
export const DUAL_GRID_EDGE_NOISE_VARIANT_STRIDE = 53;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizePercent(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : fallback;
}

export function normalizeFadeCurve(value: unknown, fallback: DualGridFadeCurve): DualGridFadeCurve {
  return value === 'linear' || value === 'smooth' || value === 'ease-in' || value === 'ease-out'
    ? value
    : fallback;
}

export function normalizeNoiseType(value: unknown, fallback: DualGridNoiseType): DualGridNoiseType {
  return value === 'hash' || value === 'value' || value === 'fractal' || value === 'cellular'
    ? value
    : fallback;
}

/** 由 manifest 原始 edge 設定歸一化羽化參數，未提供的欄位套用 DEFAULT_DUAL_GRID_EDGE。 */
export function normalizeDualGridEdgeOptions(rawEdge: unknown): DualGridEdgeOptions {
  const normalized = isRecord(rawEdge) ? rawEdge : {};
  return {
    range: normalizePercent(normalized.range, DEFAULT_DUAL_GRID_EDGE.range),
    fade: normalizePercent(normalized.fade, DEFAULT_DUAL_GRID_EDGE.fade),
    fadeStart: normalizePercent(normalized.fadeStart, DEFAULT_DUAL_GRID_EDGE.fadeStart),
    fadeCurve: normalizeFadeCurve(normalized.fadeCurve, DEFAULT_DUAL_GRID_EDGE.fadeCurve),
    noise: typeof normalized.noise === 'boolean' ? normalized.noise : DEFAULT_DUAL_GRID_EDGE.noise,
    noiseType: normalizeNoiseType(normalized.noiseType, DEFAULT_DUAL_GRID_EDGE.noiseType),
    noiseScale: normalizePercent(normalized.noiseScale, DEFAULT_DUAL_GRID_EDGE.noiseScale),
    noiseAmount: normalizePercent(normalized.noiseAmount, DEFAULT_DUAL_GRID_EDGE.noiseAmount),
  };
}

function smooth01(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(left: number, right: number, t: number): number {
  return left + (right - left) * t;
}

function hashNoise(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** 以世界頂點座標決定 noise 變體（0..7），同一頂點跨 frame 與跨 chunk 一致。 */
export function resolveDualGridNoiseVariant(worldX: number, worldY: number, size: number): number {
  const safeSize = Math.max(1, size);
  const vertexX = Math.floor(worldX / safeSize);
  const vertexY = Math.floor(worldY / safeSize);
  return Math.floor(hashNoise(vertexX, vertexY) * DUAL_GRID_EDGE_NOISE_VARIANTS);
}

export function getDualGridNoiseVariantOffset(variant: number): { x: number; y: number } {
  const normalized = Math.max(0, Math.min(DUAL_GRID_EDGE_NOISE_VARIANTS - 1, Math.trunc(variant)));
  return {
    x: (normalized + 1) * DUAL_GRID_EDGE_NOISE_VARIANT_STRIDE,
    y: (normalized * 3 + 5) * DUAL_GRID_EDGE_NOISE_VARIANT_STRIDE,
  };
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth01(x - x0);
  const ty = smooth01(y - y0);
  const a = hashNoise(x0, y0);
  const b = hashNoise(x0 + 1, y0);
  const c = hashNoise(x0, y0 + 1);
  const d = hashNoise(x0 + 1, y0 + 1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function fractalNoise(x: number, y: number): number {
  let total = 0;
  let amplitude = 0.55;
  let frequency = 1;
  let weight = 0;
  for (let index = 0; index < 4; index += 1) {
    total += valueNoise(x * frequency, y * frequency) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / Math.max(0.001, weight);
}

function cellularNoise(x: number, y: number): number {
  const gx = Math.floor(x);
  const gy = Math.floor(y);
  let nearest = Infinity;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const cx = gx + ox;
      const cy = gy + oy;
      const px = cx + hashNoise(cx, cy);
      const py = cy + hashNoise(cx + 17, cy - 11);
      nearest = Math.min(nearest, Math.hypot(x - px, y - py));
    }
  }
  return clamp(nearest / Math.SQRT2, 0, 1);
}

export function edgeNoiseAt(x: number, y: number, type: DualGridNoiseType, scale: number): number {
  const cellSize = 2 + (100 - clamp(scale, 1, 100)) / 99 * 30;
  const nx = x / cellSize;
  const ny = y / cellSize;
  if (type === 'hash') return hashNoise(Math.floor(nx), Math.floor(ny));
  if (type === 'fractal') return fractalNoise(nx, ny);
  if (type === 'cellular') return cellularNoise(nx, ny);
  return valueNoise(nx, ny);
}

function applyFalloffCurve(t: number, curve: DualGridFadeCurve): number {
  if (curve === 'smooth') return t * t * (3 - 2 * t);
  if (curve === 'ease-in') return t * t;
  if (curve === 'ease-out') return 1 - (1 - t) * (1 - t);
  return t;
}

export function edgeFadeAlpha(distance: number, range: number, fadeStart: number, curve: DualGridFadeCurve): number {
  const start = clamp(fadeStart, 0, 1) * range;
  if (distance <= start) return 1;
  const t = clamp((distance - start) / Math.max(0.001, range - start), 0, 1);
  return 1 - applyFalloffCurve(t, curve);
}

export function quadrantBitAt(x: number, y: number, size: number): number {
  const right = x >= size / 2;
  const bottom = y >= size / 2;
  if (!right && !bottom) return 1;
  if (!right && bottom) return 2;
  if (right && !bottom) return 4;
  return 8;
}

function distanceToRect(x: number, y: number, rect: { x: number; y: number; width: number; height: number }): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** 點到 sourceMask 覆蓋象限（半格矩形）的最短距離。 */
export function distanceToSourceMask(x: number, y: number, sourceMask: number, size: number): number {
  let best = Infinity;
  const half = size / 2;
  for (const quad of DUAL_GRID_QUADS) {
    if ((sourceMask & quad.mask) === 0) continue;
    best = Math.min(best, distanceToRect(x, y, {
      x: quad.x * size,
      y: quad.y * size,
      width: half,
      height: half,
    }));
  }
  return best;
}

/** edge 選項的快取鍵簽名（參數任一不同都視為不同羽化樣式）。 */
export function edgeSignature(edge: DualGridEdgeOptions): string {
  return `${edge.range}/${edge.fade}/${edge.fadeStart}/${edge.fadeCurve}/${edge.noise ? 1 : 0}/${edge.noiseType}/${edge.noiseScale}/${edge.noiseAmount}`;
}
