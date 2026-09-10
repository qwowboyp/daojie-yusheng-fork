/**
 * Pixi 路徑的 dual-grid 邊緣羽化框快取。
 *
 * 對齊 Canvas 版（runtime-image-pack.ts getEtchedDualGridFrame）的
 * 「距離 fade + cellular noise」公式（共用 renderer/dual-grid-edge.ts），
 * 在材質交界先畫一層半透明羽化 halo，再疊精確象限裁切，消除硬邊割裂感。
 */
import { CanvasSource, Texture } from 'pixi.js';
import {
  DUAL_GRID_EDGE_FRAME_SIZE,
  distanceToSourceMask,
  edgeFadeAlpha,
  edgeNoiseAt,
  edgeSignature,
  getDualGridNoiseVariantOffset,
  quadrantBitAt,
  type DualGridEdgeOptions,
} from '../../renderer/dual-grid-edge';

/** 羽化框快取上限，與 Canvas 版 edge frame LRU 一致。 */
const MAX_FEATHER_FRAME_CACHE_ENTRIES = 768;

export interface PixiDualGridFeatherRequest {
  /** atlas 貼圖來源（HTMLImageElement / ImageBitmap 等，可直接 drawImage）。 */
  atlasSource: CanvasImageSource;
  /** atlas 資源 URL，作為快取鍵前綴，重載後可整體失效。 */
  src: string;
  /** atlas 內 sourceMask 幀的來源矩形（atlas 像素座標）。 */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  edge: DualGridEdgeOptions;
  /** 由世界頂點座標決定的 noise 變體（跨 chunk 一致）。 */
  noiseVariant: number;
  sourceMask: number;
  clipMask: number;
}

/** 與 Canvas 版 getDualGridEdgeAlphaMask 完全同構的逐像素 alpha 因子。 */
function getDualGridEdgeAlphaFactors(
  edge: DualGridEdgeOptions,
  size: number,
  noiseVariant: number,
  sourceMask: number,
  clipMask: number,
): Uint8Array | null {
  const range = (edge.range / 100) * (size / 2) * Math.SQRT2;
  if (range <= 0) {
    return null;
  }
  const factors = new Uint8Array(size * size);
  const fade = edge.fade / 100;
  const fadeStart = edge.fadeStart / 100;
  const noiseScale = edge.noise ? edge.noiseAmount / 100 : 0;
  const noiseOffset = getDualGridNoiseVariantOffset(noiseVariant);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const bit = quadrantBitAt(x, y, size);
      if ((clipMask & bit) === 0 || (sourceMask & bit) !== 0) {
        continue;
      }
      let distance = distanceToSourceMask(x + 0.5, y + 0.5, sourceMask, size);
      if (noiseScale > 0) {
        const noise = edgeNoiseAt(x + noiseOffset.x, y + noiseOffset.y, edge.noiseType, edge.noiseScale);
        distance += (noise - 0.5) * 2 * range * 0.45 * noiseScale;
      }
      if (distance > range) {
        continue;
      }
      const fadeAlpha = edgeFadeAlpha(distance, range, fadeStart, edge.fadeCurve);
      const alphaFactor = 1 - fade + fade * fadeAlpha;
      factors[y * size + x] = Math.max(0, Math.min(255, Math.round(alphaFactor * 255)));
    }
  }
  return factors;
}

/** 從 atlas 來源矩形生成羽化框 canvas；失敗（edge range 無效等）回傳 null。 */
function renderFeatherFrame(request: PixiDualGridFeatherRequest): HTMLCanvasElement | null {
  const size = DUAL_GRID_EDGE_FRAME_SIZE;
  const factors = getDualGridEdgeAlphaFactors(
    request.edge,
    size,
    request.noiseVariant,
    request.sourceMask,
    request.clipMask,
  );
  if (!factors) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  if (ctx.imageSmoothingEnabled) {
    ctx.imageSmoothingEnabled = false;
  }
  ctx.drawImage(request.atlasSource, request.sx, request.sy, request.sw, request.sh, 0, 0, size, size);
  const sourceFrame = ctx.getImageData(0, 0, size, size);
  const outputData = ctx.createImageData(size, size);
  const sourcePixels = sourceFrame.data;
  const outputPixels = outputData.data;

  for (let pixel = 0; pixel < factors.length; pixel += 1) {
    const alphaFactor = factors[pixel] ?? 0;
    if (alphaFactor === 0) {
      continue;
    }
    const index = pixel * 4;
    const alphaBase = sourcePixels[index + 3] ?? 0;
    if (alphaBase === 0) {
      continue;
    }
    outputPixels[index] = sourcePixels[index] ?? 0;
    outputPixels[index + 1] = sourcePixels[index + 1] ?? 0;
    outputPixels[index + 2] = sourcePixels[index + 2] ?? 0;
    outputPixels[index + 3] = Math.round(alphaBase * alphaFactor / 255);
  }

  ctx.putImageData(outputData, 0, 0);
  return canvas;
}

export class PixiDualGridFeatherCache {
  private readonly frames = new Map<string, Texture>();

  request(request: PixiDualGridFeatherRequest): Texture | null {
    const key = `${request.src}:${request.sx}:${request.sy}:${request.sw}:${request.sh}:${request.noiseVariant}:${request.sourceMask}:${request.clipMask}:${edgeSignature(request.edge)}`;
    const hit = this.frames.get(key);
    if (hit) {
      // LRU：命中後移到最新端。
      this.frames.delete(key);
      this.frames.set(key, hit);
      return hit;
    }
    const canvas = renderFeatherFrame(request);
    if (!canvas) {
      return null;
    }
    const texture = new Texture({ source: new CanvasSource({ resource: canvas }) });
    this.frames.set(key, texture);
    if (this.frames.size > MAX_FEATHER_FRAME_CACHE_ENTRIES) {
      const oldestKey = this.frames.keys().next().value;
      if (typeof oldestKey === 'string') {
        this.frames.get(oldestKey)?.destroy(true);
        this.frames.delete(oldestKey);
      }
    }
    return texture;
  }

  /** 銷毀並清空全部羽化框（manifest/本機覆蓋重載、資源釋放時呼叫）。 */
  clear(): void {
    for (const texture of this.frames.values()) {
      texture.destroy(true);
    }
    this.frames.clear();
  }

  get size(): number {
    return this.frames.size;
  }
}
