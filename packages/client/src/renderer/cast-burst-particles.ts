/** 功法施放圖片特效的共用資料與動畫 pose；不依賴 Canvas 或 Pixi。 */
import type { CastBurstTier, CastBurstVariant, CombatEffectCastBurst, ElementKey } from '@mud/shared';
import { DAMAGE_TRAIL_PHYSICAL_COLOR, DAMAGE_TRAIL_SPELL_COLOR, ELEMENT_DAMAGE_TRAIL_COLORS } from '@mud/shared';

export interface CastBurstEffect {
  x: number;
  y: number;
  toX: number;
  toY: number;
  variant: CastBurstVariant;
  tier?: CastBurstTier;
  color: string;
  accentColor: string;
  createdAt: number;
  duration: number;
}
/** 可重用輸出物件，呼叫端應於實例生命週期內重用，避免逐幀分配。 */
export interface CastBurstSpritePose {
  frame: number;
  accentFrame: number;
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  alpha: number;
  accentWidth: number;
  accentHeight: number;
  accentAlpha: number;
  accentRotation: number;
}
export const CAST_BURST_DURATION_MS = 620;
export const CAST_BURST_TIER_DURATION_MULTIPLIER = 1.6;
export const MAX_CAST_BURSTS = 32;
export const CAST_BURST_FRAME_COUNT = 12;
const HEAL_CAST_COLOR = '#7ee08a';
const BUFF_SELF_CAST_COLOR = '#ffd27a';
const BUFF_DEBUFF_CAST_COLOR = '#9c6ade';
const DIVINE_CAST_COLOR = '#ffe9a8';
const DIVINE_CAST_ACCENT = '#fff8e1';
const FRAME_BY_VARIANT: Record<CastBurstVariant, number> = { single: 0, aoe: 1, line: 2, heal: 3, buff_self: 4, buff_debuff: 5, tile: 6, vortex: 7, chain: 8, barrage: 9 };

export function resolveElementColor(element: ElementKey | undefined, damageKind: CombatEffectCastBurst['damageKind']): string {
  if (element && ELEMENT_DAMAGE_TRAIL_COLORS[element]) return ELEMENT_DAMAGE_TRAIL_COLORS[element];
  return damageKind === 'physical' ? DAMAGE_TRAIL_PHYSICAL_COLOR : DAMAGE_TRAIL_SPELL_COLOR;
}
function resolveCastBurstColors(effect: Pick<CombatEffectCastBurst, 'variant' | 'element' | 'damageKind' | 'tier'>): { color: string; accent: string } {
  if (effect.tier === 'divine' || effect.tier === 'secret') return { color: DIVINE_CAST_COLOR, accent: DIVINE_CAST_ACCENT };
  switch (effect.variant) {
    case 'heal':
      return { color: HEAL_CAST_COLOR, accent: DIVINE_CAST_COLOR };
    case 'buff_self':
      return { color: BUFF_SELF_CAST_COLOR, accent: DIVINE_CAST_ACCENT };
    case 'buff_debuff':
      return { color: BUFF_DEBUFF_CAST_COLOR, accent: '#5d4a8a' };
    default:
      return { color: resolveElementColor(effect.element, effect.damageKind), accent: '#fff3d6' };
  }
}
export function createCastBurstEffect(effect: CombatEffectCastBurst, now: number): CastBurstEffect {
  const colors = resolveCastBurstColors(effect);
  const enhanced = effect.tier === 'divine' || effect.tier === 'secret';
  return {
    x: effect.x,
    y: effect.y,
    toX: effect.toX ?? effect.x,
    toY: effect.toY ?? effect.y,
    variant: effect.variant,
    tier: effect.tier,
    color: colors.color,
    accentColor: colors.accent,
    createdAt: now,
    duration: CAST_BURST_DURATION_MS * (enhanced ? CAST_BURST_TIER_DURATION_MULTIPLIER : 1),
  };
}
function clamp01(value: number): number { return value < 0 ? 0 : value > 1 ? 1 : value; }
function easeOutCubic(value: number): number { const t = clamp01(value); return 1 - (1 - t) ** 3; }
/** 將真實格座標投影為圖片 pose。line/chain/barrage 沿起終點前進，其餘錨在施法者或目標格。 */
export function resolveCastBurstSpritePose(burst: CastBurstEffect, now: number, cellSize: number, pose: CastBurstSpritePose): boolean {
  const elapsed = now - burst.createdAt;
  if (elapsed >= burst.duration) return false;
  const progress = clamp01(elapsed / burst.duration);
  const eased = easeOutCubic(progress);
  const dx = burst.toX - burst.x;
  const dy = burst.toY - burst.y;
  const directed = burst.variant === 'line' || burst.variant === 'chain' || burst.variant === 'barrage';
  const selfAnchored = burst.variant === 'heal' || burst.variant === 'buff_self';
  let travel = 1;
  if (burst.variant === 'line') travel = Math.min(1, eased * 1.14);
  else if (burst.variant === 'chain') travel = eased;
  else if (burst.variant === 'barrage') travel = Math.min(1, 0.12 + eased * 1.05);
  // 有方向的圖在施法者與目前前緣之間拉伸，中心取線段中點，保留真實起點與終點關係。
  const anchorX = selfAnchored ? burst.x : directed ? burst.x + dx * travel * 0.5 : burst.toX;
  const anchorY = selfAnchored ? burst.y : directed ? burst.y + dy * travel * 0.5 : burst.toY;
  const isTier = burst.tier === 'divine' || burst.tier === 'secret';
  const scalePulse = 0.82 + Math.sin(progress * Math.PI) * 0.28;
  pose.frame = FRAME_BY_VARIANT[burst.variant]; pose.accentFrame = burst.tier === 'secret' ? 11 : 10;
  pose.x = (anchorX + 0.5) * cellSize; pose.y = (anchorY + 0.5) * cellSize;
  pose.rotation = directed && (dx !== 0 || dy !== 0) ? Math.atan2(dy, dx) : (burst.variant === 'vortex' ? progress * Math.PI * 2 : 0);
  const baseSize = cellSize * (isTier ? 2.5 : 1.8) * scalePulse;
  const distance = Math.hypot(dx, dy) * cellSize;
  pose.width = directed ? Math.max(cellSize * 1.45, distance * travel + cellSize * 1.15) * scalePulse : baseSize;
  pose.height = directed ? cellSize * (isTier ? 1.85 : 1.35) * scalePulse : baseSize;
  pose.alpha = Math.min(0.92, (1 - progress) * 1.1) * (progress < 0.08 ? progress / 0.08 : 1);
  pose.accentWidth = pose.width * (1.1 + eased * 0.28); pose.accentHeight = pose.height * (1.1 + eased * 0.28); pose.accentAlpha = isTier ? pose.alpha * (0.42 + Math.sin(progress * Math.PI) * 0.2) : 0; pose.accentRotation = pose.rotation - progress * Math.PI * 0.8;
  // 透明度為零仍可能是淡入的第一幀；生命週期只能由 elapsed 判定。
  return true;
}
