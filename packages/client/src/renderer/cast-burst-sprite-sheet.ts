/** 施放特效圖集的共用載入與 Canvas 著色切圖快取。 */
const SHEET_WIDTH = 1536;
const SHEET_HEIGHT = 1024;
const FRAME_WIDTH = 384;
const ROW_EDGES = [0, 341, 683, 1024] as const;
const MAX_TINTED_FRAMES = 48;
export const CAST_BURST_RETRY_DELAY_MS = 5000;
const imageUrl = `${import.meta.env.BASE_URL}assets/vfx/technique-cast-v1.webp`;
let image: HTMLImageElement | null = null;
let loadPromise: Promise<HTMLImageElement> | null = null;
let retryAt = 0;
const tintedFrames = new Map<string, Map<number, HTMLCanvasElement>>();
const tintOrder: { color: string; frame: number }[] = [];

export function getCastBurstSpriteSheetUrl(): string {
  return imageUrl;
}

export function getCastBurstFrameRect(frame: number): { x: number; y: number; width: number; height: number } {
  const row = Math.floor(frame / 4);
  return {
    x: (frame % 4) * FRAME_WIDTH,
    y: ROW_EDGES[row],
    width: FRAME_WIDTH,
    height: ROW_EDGES[row + 1] - ROW_EDGES[row],
  };
}

/** 兩套渲染器共用一次解碼；失敗的請求保留五秒，避免逐幀重試。 */
export function loadCastBurstSpriteSheet(): Promise<HTMLImageElement> {
  if (loadPromise && (retryAt === 0 || performance.now() < retryAt)) return loadPromise;
  retryAt = 0;
  loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.decoding = 'async';
    next.onload = () => {
      if (next.naturalWidth !== SHEET_WIDTH || next.naturalHeight !== SHEET_HEIGHT) {
        reject(new Error(`invalid cast burst sprite sheet dimensions: ${next.naturalWidth}x${next.naturalHeight}`));
        return;
      }
      image = next;
      resolve(next);
    };
    next.onerror = () => reject(new Error('failed to load cast burst sprite sheet'));
    next.src = imageUrl;
  }).catch((error: unknown) => {
    retryAt = performance.now() + CAST_BURST_RETRY_DELAY_MS;
    throw error;
  });
  return loadPromise;
}

export function warmCastBurstSpriteSheet(): void {
  if (loadPromise && (retryAt === 0 || performance.now() < retryAt)) return;
  void loadCastBurstSpriteSheet().catch(() => undefined);
}

/** 只在快取缺失時切圖，逐像素乘色保留亮暗與 alpha，與 Pixi tint 相同。 */
export function getTintedCastBurstFrame(frame: number, color: string): HTMLCanvasElement | null {
  if (!image) {
    warmCastBurstSpriteSheet();
    return null;
  }
  const cached = tintedFrames.get(color)?.get(frame);
  if (cached) return cached;
  const rect = getCastBurstFrameRect(frame);
  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const pixels = context.getImageData(0, 0, rect.width, rect.height);
  const rgb = Number.parseInt(color.slice(1), 16);
  const red = ((rgb >> 16) & 255) / 255;
  const green = ((rgb >> 8) & 255) / 255;
  const blue = (rgb & 255) / 255;
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] *= red;
    pixels.data[index + 1] *= green;
    pixels.data[index + 2] *= blue;
  }
  context.putImageData(pixels, 0, 0);
  if (tintOrder.length >= MAX_TINTED_FRAMES) {
    const oldest = tintOrder.shift()!;
    const palette = tintedFrames.get(oldest.color)!;
    palette.delete(oldest.frame);
    if (palette.size === 0) tintedFrames.delete(oldest.color);
  }
  let palette = tintedFrames.get(color);
  if (!palette) {
    palette = new Map<number, HTMLCanvasElement>();
    tintedFrames.set(color, palette);
  }
  palette.set(frame, canvas);
  tintOrder.push({ color, frame });
  return canvas;
}
