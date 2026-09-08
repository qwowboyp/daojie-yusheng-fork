/** Pixi 版功法圖片特效：有限 Sprite 實例，共用圖集 Texture。 */
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { CombatEffectCastBurst } from '@mud/shared';
import {
  CAST_BURST_FRAME_COUNT,
  createCastBurstEffect,
  resolveCastBurstSpritePose,
  type CastBurstEffect,
  type CastBurstSpritePose,
} from '../../renderer/cast-burst-particles';
import {
  CAST_BURST_RETRY_DELAY_MS,
  getCastBurstFrameRect,
  loadCastBurstSpriteSheet,
} from '../../renderer/cast-burst-sprite-sheet';
import { parseColor } from './pixi-render-primitives';

export { MAX_CAST_BURSTS } from '../../renderer/cast-burst-particles';

export interface PixiCastBurstEffect extends CastBurstEffect {
  colorNumber: number;
  accentColorNumber: number;
  primary: Sprite;
  accent: Sprite;
  pose: CastBurstSpritePose;
}

let loading = false;
let retryAt = 0;
let frames: Texture[] | null = null;

/** 建構時預熱；失敗後限頻重試，尚未載入的事件仍按原時長過期。 */
export function warmPixiCastBurstTexture(): void {
  if (frames || loading || performance.now() < retryAt) return;
  loading = true;
  void loadCastBurstSpriteSheet().then((image) => {
    const sheet = Texture.from(image);
    frames = Array.from({ length: CAST_BURST_FRAME_COUNT }, (_, index) => {
      const rect = getCastBurstFrameRect(index);
      return new Texture({
        source: sheet.source,
        frame: new Rectangle(rect.x, rect.y, rect.width, rect.height),
        label: `technique-cast:${index}`,
      });
    });
  }).catch(() => {
    retryAt = performance.now() + CAST_BURST_RETRY_DELAY_MS;
  }).finally(() => {
    loading = false;
  });
}

export function createPixiCastBurstEffect(effect: CombatEffectCastBurst, now: number, layer: Container): PixiCastBurstEffect {
  const base = createCastBurstEffect(effect, now);
  const primary = new Sprite(Texture.EMPTY);
  const accent = new Sprite(Texture.EMPTY);
  primary.anchor.set(0.5);
  accent.anchor.set(0.5);
  primary.visible = false;
  accent.visible = false;
  layer.addChild(primary, accent);
  warmPixiCastBurstTexture();
  return {
    ...base,
    colorNumber: parseColor(base.color),
    accentColorNumber: parseColor(base.accentColor),
    primary,
    accent,
    pose: {
      frame: 0, accentFrame: 10, x: 0, y: 0, rotation: 0,
      width: 0, height: 0, alpha: 0, accentWidth: 0, accentHeight: 0,
      accentAlpha: 0, accentRotation: 0,
    },
  };
}

/** 逐幀只更新既有 Sprite 屬性；Texture/Frame 皆在載入時建立。 */
export function updatePixiCastBurstEffect(burst: PixiCastBurstEffect, now: number, cellSize: number): boolean {
  if (!resolveCastBurstSpritePose(burst, now, cellSize, burst.pose)) return false;
  const loadedFrames = frames;
  if (!loadedFrames) {
    warmPixiCastBurstTexture();
    return true;
  }
  const pose = burst.pose;
  if (burst.primary.texture !== loadedFrames[pose.frame]) burst.primary.texture = loadedFrames[pose.frame];
  burst.primary.position.set(pose.x, pose.y);
  burst.primary.rotation = pose.rotation;
  burst.primary.width = pose.width;
  burst.primary.height = pose.height;
  burst.primary.alpha = pose.alpha;
  burst.primary.tint = burst.colorNumber;
  burst.primary.visible = pose.alpha > 0.01;
  if (pose.accentAlpha > 0.01) {
    if (burst.accent.texture !== loadedFrames[pose.accentFrame]) burst.accent.texture = loadedFrames[pose.accentFrame];
    burst.accent.position.set(pose.x, pose.y);
    burst.accent.rotation = pose.accentRotation;
    burst.accent.width = pose.accentWidth;
    burst.accent.height = pose.accentHeight;
    burst.accent.alpha = pose.accentAlpha;
    burst.accent.tint = burst.accentColorNumber;
    burst.accent.visible = true;
  } else {
    burst.accent.visible = false;
  }
  return true;
}

/** 只銷毀事件擁有的 Sprite，保留全域共用 Texture。 */
export function destroyPixiCastBurstEffect(burst: PixiCastBurstEffect): void {
  burst.primary.parent?.removeChild(burst.primary);
  burst.accent.parent?.removeChild(burst.accent);
  burst.primary.destroy();
  burst.accent.destroy();
}
