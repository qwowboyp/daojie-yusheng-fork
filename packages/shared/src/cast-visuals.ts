/**
 * 本文件定义前后端共享的技能施放表现推导，是 cast_burst 特效形态分类的单一真源。
 *
 * 服务端在技能结算点调用本函数推导结构化枚举并随 combatEffects 广播，
 * 客户端据此查表渲染粒子与音效；两端都不各自发明分类规则。
 * 系统功法与 AI 自创功法共用同一套 SkillDef 推导，因此 AI 功法自动获得特效，无需额外配置。
 */
import type { CastBurstVariant } from './action-combat-types';
import type { ElementKey } from './numeric';
import type { SkillDamageKind, SkillDef, SkillEffectDef } from './skill-types';

/** 技能施放表现档案：cast_burst 协议载荷的推导结果。 */
export interface SkillCastVisualProfile {
  /** 表现形态枚举。 */
  variant: CastBurstVariant;
  /** 五行元素（来自首个 damage 效果）。 */
  element?: ElementKey;
  /** 伤害类型（来自首个 damage 效果）。 */
  damageKind?: SkillDamageKind;
}

/** 判定效果是否朝向施法者自身或友方。 */
function isSelfDirectedBuff(effect: SkillEffectDef): boolean {
  return effect.type === 'buff' && (effect.target === 'self' || effect.target === 'allies');
}

/**
 * 从技能定义推导施放表现档案。
 *
 * 推导优先级（与战斗观感对齐，攻击是最主要的视觉事件）：
 * 1. temporary_tile 主导 → 'tile'（地面阵纹）
 * 2. damage 主导 → 按目标形状分 single / aoe / line
 * 3. heal 主导 → 'heal'
 * 4. buff 主导 → self/allies 为 'buff_self'，target 为 'buff_debuff'（两者兼有时取自身）
 * 5. 无可表现效果（如内功）→ null，调用方不推送
 */
export function resolveSkillCastVisualProfile(
  skill: Pick<SkillDef, 'effects' | 'targeting'> | null | undefined,
): SkillCastVisualProfile | null {
  const effects = Array.isArray(skill?.effects) ? skill.effects : [];
  if (effects.length === 0) {
    return null;
  }

  let hasDamage = false;
  let damageKind: SkillDamageKind | undefined;
  let element: ElementKey | undefined;
  let hasHeal = false;
  let hasSelfBuff = false;
  let hasTargetBuff = false;
  let hasTemporaryTile = false;
  for (const effect of effects) {
    if (effect.type === 'damage') {
      if (!hasDamage) {
        hasDamage = true;
        damageKind = effect.damageKind;
        element = effect.element;
      }
      continue;
    }
    if (effect.type === 'heal') {
      hasHeal = true;
      continue;
    }
    if (effect.type === 'temporary_tile') {
      hasTemporaryTile = true;
      continue;
    }
    if (effect.type === 'buff') {
      if (isSelfDirectedBuff(effect)) {
        hasSelfBuff = true;
      } else {
        hasTargetBuff = true;
      }
    }
  }

  let variant: CastBurstVariant | null = null;
  if (hasTemporaryTile) {
    variant = 'tile';
  } else if (hasDamage) {
    variant = resolveDamageCastVariant(skill);
  } else if (hasHeal) {
    variant = 'heal';
  } else if (hasSelfBuff) {
    variant = 'buff_self';
  } else if (hasTargetBuff) {
    variant = 'buff_debuff';
  }
  if (!variant) {
    return null;
  }
  return { variant, element, damageKind };
}

/** damage 主导技能按目标形状推导表现形态。 */
function resolveDamageCastVariant(
  skill: Pick<SkillDef, 'effects' | 'targeting'> | null | undefined,
): CastBurstVariant {
  const targeting = skill?.targeting;
  const shape = targeting?.shape;
  if (shape === 'line') {
    return 'line';
  }
  if (shape === 'area' || shape === 'box' || shape === 'orientedBox' || shape === 'ring' || shape === 'checkerboard') {
    return 'aoe';
  }
  const maxTargets = Number(targeting?.maxTargets);
  if (Number.isFinite(maxTargets) && maxTargets > 1) {
    return 'aoe';
  }
  const radius = Number(targeting?.radius);
  if (Number.isFinite(radius) && radius > 0) {
    return 'aoe';
  }
  return 'single';
}
