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
  shape: 'dot' | 'streak' | 'ring' | 'square' | 'bolt';
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
const MAX_PARTICLES_PER_BURST = 26;

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
      // 命中爆散：核心爆闪 + 快慢双速射流 + 扩散闪环
      // 核心爆闪（大尺寸瞬态，随生命快速淡出）
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.32 * tierBoost, delay: 0, shape: 'dot', phase: 0 });
      const sparkCount = Math.round(14 * tierBoost);
      for (let index = 0; index < sparkCount; index += 1) {
        const angle = (Math.PI * 2 * index) / sparkCount + (Math.random() - 0.5) * 0.4;
        // 偶数高速细长破片，奇数低速粗圆残渣，拉出景深
        const isFast = index % 2 === 0;
        const speed = isFast ? 2.2 + Math.random() * 1.5 : 0.8 + Math.random() * 0.6;
        push({
          offsetX: 0,
          offsetY: 0,
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed,
          size: (isFast ? 0.06 : 0.1) + Math.random() * 0.04,
          delay: isFast ? 0 : 0.05,
          shape: isFast ? 'streak' : 'dot',
          phase: angle,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 1.2, delay: 0, shape: 'ring', phase: 0 });
      break;
    }
    case 'aoe': {
      // 范围环爆：双层扩散环 + 地裂放射线 + 上升余烬（左右摆动）
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.9, delay: 0, shape: 'ring', phase: 0 });
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 1.7, delay: 0.18, shape: 'ring', phase: 0 });
      const crackCount = Math.round(4 * tierBoost);
      for (let index = 0; index < crackCount; index += 1) {
        const angle = (Math.PI * 2 * index) / crackCount + (Math.random() - 0.5) * 0.3;
        push({
          offsetX: 0,
          offsetY: 0,
          velocityX: Math.cos(angle) * 2.4,
          velocityY: Math.sin(angle) * 2.4,
          size: 0.09,
          delay: 0.06,
          shape: 'streak',
          phase: angle,
        });
      }
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
      // 扫射：贯穿主轴光束（phase=-1 标记主芯）+ 两侧激波气浪 + 头部光点
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.16, delay: 0, shape: 'streak', phase: -1 });
      const wispCount = Math.round(8 * tierBoost);
      for (let index = 0; index < wispCount; index += 1) {
        push({
          offsetX: 0,
          offsetY: 0,
          velocityX: 0,
          velocityY: 0,
          size: 0.07 + Math.random() * 0.05,
          delay: (index / wispCount) * 0.4,
          shape: 'streak',
          phase: index / wispCount,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.16, delay: 0.45, shape: 'dot', phase: 1 });
      break;
    }
    case 'heal': {
      // 治疗：双螺旋上升光尘（phase 存起始极角）+ 顶端闪烁
      const moteCount = Math.round(12 * tierBoost);
      for (let index = 0; index < moteCount; index += 1) {
        const angle = (Math.PI * 2 * index) / moteCount;
        const flip = index % 2 === 0 ? 1 : -1;
        push({
          offsetX: (Math.random() - 0.5) * 0.8,
          offsetY: 0.5 + Math.random() * 0.4,
          velocityX: 0,
          velocityY: -1.6 - Math.random() * 0.9,
          size: 0.06 + Math.random() * 0.07,
          delay: Math.random() * 0.45,
          shape: 'dot',
          phase: angle * flip,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.55, delay: 0.38, shape: 'ring', phase: 0 });
      break;
    }
    case 'buff_self': {
      // 自身增益：阴阳双逆向环绕光点 + 收缩气盾 + 中心聚气
      const orbitCount = Math.round(8 * tierBoost);
      for (let index = 0; index < orbitCount; index += 1) {
        // 偶数顺时针、奇数逆时针（phase 为负表示逆转）
        const ccw = index % 2 === 1 ? -1 : 1;
        push({
          offsetX: 0,
          offsetY: 0,
          velocityX: 0,
          velocityY: 0,
          size: 0.08 + Math.random() * 0.06,
          delay: 0,
          shape: 'dot',
          phase: ((Math.PI * 2 * index) / orbitCount) * ccw,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 1.2, delay: 0, shape: 'ring', phase: 1 });
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.16, delay: 0.2, shape: 'dot', phase: 99 });
      break;
    }
    case 'buff_debuff': {
      // 减益：四角封印阵锁向内收拢 + 下沉浊气 + 收缩小环
      for (let index = 0; index < 4; index += 1) {
        const signX = index % 2 === 0 ? 1 : -1;
        const signY = index < 2 ? 1 : -1;
        push({
          offsetX: signX * 0.75,
          offsetY: signY * 0.75,
          velocityX: -signX * 1.6,
          velocityY: -signY * 1.6,
          size: 0.18,
          delay: 0,
          shape: 'square',
          phase: 0,
        });
      }
      const sinkCount = Math.round(6 * tierBoost);
      for (let index = 0; index < sinkCount; index += 1) {
        push({
          offsetX: (Math.random() - 0.5) * 1.4,
          offsetY: (Math.random() - 0.5) * 0.8,
          velocityX: (Math.random() - 0.5) * 0.5,
          velocityY: 0.5 + Math.random() * 0.7,
          size: 0.06 + Math.random() * 0.06,
          delay: Math.random() * 0.25,
          shape: 'dot',
          phase: 0,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.7, delay: 0.12, shape: 'ring', phase: 1 });
      break;
    }
    case 'tile': {
      // 地面阵纹：双层方框扩散 + 四角阵眼锚点 + 尘粒
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.9, delay: 0, shape: 'square', phase: 0 });
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 1.5, delay: 0.2, shape: 'square', phase: 0 });
      for (let index = 0; index < 4; index += 1) {
        const signX = index % 2 === 0 ? 1 : -1;
        const signY = index < 2 ? 1 : -1;
        push({
          offsetX: signX * 0.92,
          offsetY: signY * 0.92,
          velocityX: 0,
          velocityY: 0,
          size: 0.22,
          delay: 0.1,
          shape: 'square',
          phase: 0,
        });
      }
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
    case 'vortex': {
      // 气旋引力：中心收缩亮环 + 外圈阿基米德螺旋吸入（phase 存起始极角）
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 1.4, delay: 0, shape: 'ring', phase: 1 });
      const spiralCount = Math.round(12 * tierBoost);
      for (let index = 0; index < spiralCount; index += 1) {
        const angle = (Math.PI * 2 * index) / spiralCount;
        const dist = 1.2 + Math.random() * 0.5;
        push({
          offsetX: Math.cos(angle) * dist,
          offsetY: Math.sin(angle) * dist,
          velocityX: -Math.cos(angle) * 1.8,
          velocityY: -Math.sin(angle) * 1.8,
          size: 0.07 + Math.random() * 0.06,
          delay: Math.random() * 0.25,
          shape: 'streak',
          phase: angle,
        });
      }
      break;
    }
    case 'chain': {
      // 折线连锁：三段随机扰动闪电路径（phase 为确定性种子）+ 目标爆裂环
      const boltCount = Math.round(3 * tierBoost);
      for (let index = 0; index < boltCount; index += 1) {
        push({
          offsetX: 0,
          offsetY: 0,
          velocityX: 0,
          velocityY: 0,
          size: 0.14,
          delay: index * 0.08,
          shape: 'bolt',
          phase: index + 1,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.8, delay: 0.18, shape: 'ring', phase: 0 });
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.12, delay: 0.22, shape: 'dot', phase: 0 });
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.12, delay: 0.28, shape: 'dot', phase: 1 });
      break;
    }
    case 'barrage': {
      // 万刃攒射：施法者→目标锥形高速弹幕（phase 存进度与横向种子）+ 落点爆闪
      const shotCount = Math.round(10 * tierBoost);
      for (let index = 0; index < shotCount; index += 1) {
        push({
          offsetX: 0,
          offsetY: 0,
          velocityX: 0,
          velocityY: 0,
          size: 0.08 + Math.random() * 0.05,
          delay: (index / shotCount) * 0.3,
          shape: 'streak',
          phase: index / shotCount + 1,
        });
      }
      push({ offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, size: 0.16, delay: 0.42, shape: 'dot', phase: 1 });
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
