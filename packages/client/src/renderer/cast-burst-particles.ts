/**
 * 技能施放粒子特效（cast_burst）的共享粒子数据层：Canvas2D 与 Pixi 双渲染器共用。
 *
 * 服务端只发结构化枚举（variant/element/damageKind/tier），本文件把枚举展开成
 * 短寿命几何粒子（圆点/短线/圆环/方框）的运动参数，不含任何渲染 API 依赖。
 * 颜色统一保留 CSS 字符串，Pixi 侧创建时自行解析为数值。
 */
import type { CastBurstTier, CastBurstVariant, CombatEffectCastBurst, ElementKey } from '@mud/shared';
import {
  DAMAGE_TRAIL_PHYSICAL_COLOR,
  DAMAGE_TRAIL_SPELL_COLOR,
  ELEMENT_DAMAGE_TRAIL_COLORS,
} from '@mud/shared';

/** 单个粒子的运动与绘制参数。 */
export interface CastBurstParticle {
  /** 起始格偏移（相对特效中心）。 */
  offsetX: number;
  offsetY: number;
  /** 格/生命占比速度。 */
  velocityX: number;
  velocityY: number;
  /** 粒子尺寸基数（格的百分比）。 */
  size: number;
  /** 生命占比延迟（错开出现时机）。 */
  delay: number;
  /** 绘制形状。 */
  shape: 'dot' | 'streak' | 'ring' | 'square';
  /** 附加相位（环绕/摆动/方向用）。 */
  phase: number;
}

/** 单个施放特效实例的运行态（纯数据，双渲染器共用）。 */
export interface CastBurstEffect {
  x: number;
  y: number;
  toX: number;
  toY: number;
  variant: CastBurstVariant;
  tier?: CastBurstTier;
  /** 主色（CSS 字符串）。 */
  color: string;
  /** 辅色（CSS 字符串，tier 光柱/点缀用）。 */
  accentColor: string;
  createdAt: number;
  duration: number;
  particles: CastBurstParticle[];
}

/** 施放特效基础时长（毫秒）；divine/secret 档位乘 1.6。 */
export const CAST_BURST_DURATION_MS = 620;
export const CAST_BURST_TIER_DURATION_MULTIPLIER = 1.6;
/** 同屏施放特效上限。 */
export const MAX_CAST_BURSTS = 32;
/** 单个特效的粒子上限（tier 加强时约 1.5 倍）。 */
const MAX_PARTICLES_PER_BURST = 18;

/** 治疗绿。 */
const HEAL_CAST_COLOR = '#7ee08a';
/** 自身增益暖金。 */
const BUFF_SELF_CAST_COLOR = '#ffd27a';
/** 目标减益暗紫。 */
const BUFF_DEBUFF_CAST_COLOR = '#9c6ade';
/** 神通/秘法高规格金白。 */
const DIVINE_CAST_COLOR = '#ffe9a8';
const DIVINE_CAST_ACCENT = '#fff8e1';

/** 元素优先，其次伤害类型，最后法术蓝。 */
export function resolveElementColor(
  element: ElementKey | undefined,
  damageKind: CombatEffectCastBurst['damageKind'],
): string {
  if (element && ELEMENT_DAMAGE_TRAIL_COLORS[element]) {
    return ELEMENT_DAMAGE_TRAIL_COLORS[element];
  }
  return damageKind === 'physical' ? DAMAGE_TRAIL_PHYSICAL_COLOR : DAMAGE_TRAIL_SPELL_COLOR;
}

/** 按特效载荷解析主色与辅色。 */
function resolveCastBurstColors(
  effect: Pick<CombatEffectCastBurst, 'variant' | 'element' | 'damageKind' | 'tier'>,
): { color: string; accent: string } {
  if (effect.tier === 'divine' || effect.tier === 'secret') {
    return { color: DIVINE_CAST_COLOR, accent: DIVINE_CAST_ACCENT };
  }
  switch (effect.variant) {
    case 'heal':
      return { color: HEAL_CAST_COLOR, accent: DIVINE_CAST_COLOR };
    case 'buff_self':
      return { color: BUFF_SELF_CAST_COLOR, accent: DIVINE_CAST_ACCENT };
    case 'buff_debuff':
      return { color: BUFF_DEBUFF_CAST_COLOR, accent: '#5d4a8a' };
    default: {
      return { color: resolveElementColor(effect.element, effect.damageKind), accent: '#fff3d6' };
    }
  }
}

/** 构建一个施放特效的完整运行态（含全部粒子）。 */
export function createCastBurstEffect(effect: CombatEffectCastBurst, now: number): CastBurstEffect {
  const colors = resolveCastBurstColors(effect);
  const tierBoost = effect.tier === 'divine' || effect.tier === 'secret' ? 1.5 : 1;
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
    duration: CAST_BURST_DURATION_MS * (tierBoost > 1 ? CAST_BURST_TIER_DURATION_MULTIPLIER : 1),
    particles: buildCastBurstParticles(effect.variant, tierBoost),
  };
}

/** 按 variant 生成粒子集合。 */
function buildCastBurstParticles(variant: CastBurstVariant, tierBoost: number): CastBurstParticle[] {
  const particles: CastBurstParticle[] = [];
  const limit = Math.round(MAX_PARTICLES_PER_BURST * (tierBoost > 1 ? 1.5 : 1));
  const push = (particle: CastBurstParticle) => {
    if (particles.length < limit) {
      particles.push(particle);
    }
  };
  switch (variant) {
    case 'single': {
      // 命中爆散：径向火花 + 扩散闪环
      const sparkCount = Math.round(12 * tierBoost);
      for (let index = 0; index < sparkCount; index += 1) {
        const angle = (Math.PI * 2 * index) / sparkCount + Math.random() * 0.5;
        const speed = 1.6 + Math.random() * 2.2;
        push({
          offsetX: 0,
          offsetY: 0,
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed,
          size: 0.08 + Math.random() * 0.08,
          delay: 0,
          shape: Math.random() < 0.6 ? 'streak' : 'dot',
          phase: angle,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 1.1, delay: 0, shape: 'ring', phase: 0 });
      break;
    }
    case 'aoe': {
      // 范围环爆：双层扩散环 + 上升余烬
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.9, delay: 0, shape: 'ring', phase: 0 });
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 1.6, delay: 0.18, shape: 'ring', phase: 0 });
      const emberCount = Math.round(8 * tierBoost);
      for (let index = 0; index < emberCount; index += 1) {
        push({
          offsetX: (Math.random() - 0.5) * 1.6,
          offsetY: (Math.random() - 0.5) * 1.6,
          velocityX: (Math.random() - 0.5) * 0.6,
          velocityY: -0.9 - Math.random() * 1.2,
          size: 0.06 + Math.random() * 0.07,
          delay: Math.random() * 0.35,
          shape: 'dot',
          phase: Math.random() * Math.PI * 2,
        });
      }
      break;
    }
    case 'line': {
      // 扫射：沿施法者→锚点方向渐进 streak + 头部光点（phase 记录沿线进度）
      const streakCount = Math.round(10 * tierBoost);
      for (let index = 0; index < streakCount; index += 1) {
        push({
          offsetX: 0,
          offsetY: 0,
          velocityX: 0,
          velocityY: 0,
          size: 0.1 + Math.random() * 0.08,
          delay: (index / streakCount) * 0.45,
          shape: 'streak',
          phase: index / streakCount,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.16, delay: 0.45, shape: 'dot', phase: 1 });
      break;
    }
    case 'heal': {
      // 治疗：上升光尘（轻微左右摆动）
      const moteCount = Math.round(9 * tierBoost);
      for (let index = 0; index < moteCount; index += 1) {
        push({
          offsetX: (Math.random() - 0.5) * 1.2,
          offsetY: 0.5 + Math.random() * 0.4,
          velocityX: 0,
          velocityY: -1.4 - Math.random() * 0.8,
          size: 0.07 + Math.random() * 0.08,
          delay: Math.random() * 0.5,
          shape: 'dot',
          phase: Math.random() * Math.PI * 2,
        });
      }
      break;
    }
    case 'buff_self': {
      // 自身增益：环绕光点 + 收缩内环（ring phase=1 表收缩）
      const orbitCount = Math.round(8 * tierBoost);
      for (let index = 0; index < orbitCount; index += 1) {
        push({
          offsetX: 0,
          offsetY: 0,
          velocityX: 0,
          velocityY: 0,
          size: 0.08 + Math.random() * 0.06,
          delay: 0,
          shape: 'dot',
          phase: (Math.PI * 2 * index) / orbitCount,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 1.2, delay: 0, shape: 'ring', phase: 1 });
      break;
    }
    case 'buff_debuff': {
      // 减益：外圈向内坠落粒子
      const markCount = Math.round(10 * tierBoost);
      for (let index = 0; index < markCount; index += 1) {
        const angle = (Math.PI * 2 * index) / markCount;
        const radius = 0.9 + Math.random() * 0.4;
        push({
          offsetX: Math.cos(angle) * radius,
          offsetY: Math.sin(angle) * radius,
          velocityX: -Math.cos(angle) * 1.6,
          velocityY: -Math.sin(angle) * 1.6,
          size: 0.07 + Math.random() * 0.06,
          delay: Math.random() * 0.2,
          shape: 'dot',
          phase: angle,
        });
      }
      break;
    }
    case 'tile': {
      // 地面阵纹：双层方框扩散 + 尘粒
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.9, delay: 0, shape: 'square', phase: 0 });
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 1.5, delay: 0.2, shape: 'square', phase: 0 });
      const dustCount = Math.round(6 * tierBoost);
      for (let index = 0; index < dustCount; index += 1) {
        push({
          offsetX: (Math.random() - 0.5) * 1.6,
          offsetY: (Math.random() - 0.5) * 1.6,
          velocityX: 0,
          velocityY: -0.5 - Math.random() * 0.6,
          size: 0.05 + Math.random() * 0.05,
          delay: Math.random() * 0.3,
          shape: 'dot',
          phase: 0,
        });
      }
      break;
    }
  }
  return particles;
}

/** 通用缓动（双渲染器共用）。 */
export function easeOutCubicCastBurst(value: number): number {
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return 1 - Math.pow(1 - clamped, 3);
}
