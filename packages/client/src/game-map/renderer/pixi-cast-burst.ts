/**
 * 技能施放粒子特效（cast_burst）的 Pixi 绘制层。
 *
 * 粒子数据来自 renderer/cast-burst-particles（双渲染器共用），
 * 本文件只负责把数据逐帧画进共享 Graphics；容量上限由调用方 trim 保证。
 */
import { Graphics } from 'pixi.js';
import type { CombatEffectCastBurst } from '@mud/shared';
import { parseColor } from './pixi-render-primitives';
import {
  createCastBurstEffect,
  easeOutCubicCastBurst as easeOutCubic,
  type CastBurstEffect,
} from '../../renderer/cast-burst-particles';

/** Pixi 侧扩展：颜色预解析为数值，避免逐帧字符串解析。 */
export interface PixiCastBurstEffect extends CastBurstEffect {
  colorNumber: number;
  accentColorNumber: number;
}

export { MAX_CAST_BURSTS } from '../../renderer/cast-burst-particles';

/** 构建一个施放特效（含颜色数值预解析）。 */
export function createPixiCastBurstEffect(effect: CombatEffectCastBurst, now: number): PixiCastBurstEffect {
  const base = createCastBurstEffect(effect, now);
  return {
    ...base,
    colorNumber: parseColor(base.color),
    accentColorNumber: parseColor(base.accentColor),
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 逐帧绘制一个施放特效到共享 Graphics。
 * 返回 false 表示已过期可销毁。
 */
export function drawCastBurstEffect(
  burst: PixiCastBurstEffect,
  graphics: Graphics,
  now: number,
  cellSize: number,
): boolean {
  const elapsed = now - burst.createdAt;
  if (elapsed >= burst.duration) {
    return false;
  }
  const progress = clamp01(elapsed / burst.duration);
  const centerX = burst.x * cellSize + cellSize / 2;
  const centerY = burst.y * cellSize + cellSize / 2;
  const endX = burst.toX * cellSize + cellSize / 2;
  const endY = burst.toY * cellSize + cellSize / 2;
  const dx = endX - centerX;
  const dy = endY - centerY;

  for (const particle of burst.particles) {
    const localProgress = clamp01((progress - particle.delay) / Math.max(0.2, 1 - particle.delay));
    if (localProgress <= 0) {
      continue;
    }
    const eased = easeOutCubic(localProgress);
    const alpha = 1 - localProgress;
    if (alpha <= 0.02) {
      continue;
    }
    switch (particle.shape) {
      case 'ring': {
        // phase=1 表示收缩环（buff_self），其余为扩散环
        const radius = (particle.phase === 1
          ? particle.size * (1 - eased * 0.55)
          : particle.size * eased) * cellSize;
        if (radius < 1) {
          break;
        }
        graphics
          .circle(centerX, centerY, radius)
          .stroke({ color: burst.colorNumber, alpha: alpha * 0.7, width: Math.max(1.5, cellSize * 0.06) });
        break;
      }
      case 'square': {
        const half = (particle.size * eased * cellSize) / 2;
        if (half < 1) {
          break;
        }
        graphics
          .rect(centerX - half, centerY - half, half * 2, half * 2)
          .stroke({ color: burst.colorNumber, alpha: alpha * 0.6, width: Math.max(1.5, cellSize * 0.05) });
        break;
      }
      case 'streak': {
        if (burst.variant === 'line') {
          // 线形扫射：粒子沿施法者→锚点方向按 phase（进度）排布
          const head = clamp01(particle.phase + eased * 0.55);
          const px = centerX + dx * head;
          const py = centerY + dy * head;
          const trail = Math.max(0, head - 0.18);
          graphics
            .moveTo(centerX + dx * trail, centerY + dy * trail)
            .lineTo(px, py)
            .stroke({ color: burst.colorNumber, alpha, width: Math.max(1.5, cellSize * particle.size) });
        } else {
          // 爆散 streak：沿速度方向短划
          const px = centerX + particle.offsetX * cellSize + particle.velocityX * cellSize * eased * 0.5;
          const py = centerY + particle.offsetY * cellSize + particle.velocityY * cellSize * eased * 0.5;
          const tailX = px - Math.cos(particle.phase) * cellSize * particle.size * 2;
          const tailY = py - Math.sin(particle.phase) * cellSize * particle.size * 2;
          graphics
            .moveTo(tailX, tailY)
            .lineTo(px, py)
            .stroke({ color: burst.colorNumber, alpha, width: Math.max(1.5, cellSize * particle.size) });
        }
        break;
      }
      case 'dot':
      default: {
        let px = centerX + particle.offsetX * cellSize + particle.velocityX * cellSize * eased * 0.5;
        let py = centerY + particle.offsetY * cellSize + particle.velocityY * cellSize * eased * 0.5;
        if (burst.variant === 'buff_self') {
          // 环绕光点：绕中心旋转并缓慢外扩
          const orbitRadius = cellSize * (0.55 + eased * 0.25);
          const angle = particle.phase + eased * 2.4;
          px = centerX + Math.cos(angle) * orbitRadius;
          py = centerY + Math.sin(angle) * orbitRadius * 0.92;
        } else if (burst.variant === 'heal') {
          // 上升光尘左右轻摆
          px += Math.sin(particle.phase + localProgress * 3) * cellSize * 0.08;
        }
        const radius = Math.max(1, cellSize * particle.size * (1 - localProgress * 0.4));
        graphics.circle(px, py, radius).fill({ color: burst.colorNumber, alpha });
        break;
      }
    }
  }

  // 神通/秘法加强：金色垂直光柱一闪
  if (burst.tier) {
    const pillarAlpha = clamp01(1 - progress * 1.8);
    if (pillarAlpha > 0.02) {
      const pillarWidth = Math.max(3, cellSize * 0.22);
      graphics
        .rect(centerX - pillarWidth / 2, centerY - cellSize * 1.6, pillarWidth, cellSize * 1.6)
        .fill({ color: burst.accentColorNumber, alpha: pillarAlpha * 0.5 });
    }
  }
  return true;
}
