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

/** 确定性伪随机（0~1）：保证 bolt/barrage 的抖动在双渲染器逐帧一致，不闪烁。 */
function fractSin(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
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
        // phase=1 表示收缩环（buff_self/vortex），其余为扩散环
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
        let px = centerX + particle.offsetX * cellSize + particle.velocityX * cellSize * eased * 0.5;
        let py = centerY + particle.offsetY * cellSize + particle.velocityY * cellSize * eased * 0.5;
        // buff_debuff 封印阵锁与 tile 阵眼锚点：角标向心收拢而非外扩
        if (burst.variant === 'buff_debuff' || burst.variant === 'tile') {
          const halfIn = (particle.size * (1 - eased * 0.5) * cellSize) / 2;
          graphics
            .rect(px - halfIn, py - halfIn, halfIn * 2, halfIn * 2)
            .stroke({ color: burst.colorNumber, alpha: alpha * 0.6, width: Math.max(1.5, cellSize * 0.05) });
          break;
        }
        graphics
          .rect(px - half, py - half, half * 2, half * 2)
          .stroke({ color: burst.colorNumber, alpha: alpha * 0.6, width: Math.max(1.5, cellSize * 0.05) });
        break;
      }
      case 'bolt': {
        // 折线连锁：center→end 之间 3~4 段确定性锯齿折线（phase 为种子）
        const segments = 3 + Math.floor(fractSin(particle.phase * 3.1) * 2);
        const lineWidth = Math.max(1.5, cellSize * particle.size);
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len;
        const ny = dy / len;
        graphics.moveTo(centerX, centerY);
        for (let seg = 1; seg < segments; seg += 1) {
          const t = seg / segments;
          const jitter = (fractSin(particle.phase * 13.7 + seg * 7.9) - 0.5) * cellSize * 0.55 * (1 - Math.abs(t - 0.5) * 0.7);
          graphics.lineTo(centerX + dx * t + ny * jitter, centerY + dy * t - nx * jitter);
        }
        graphics.lineTo(endX, endY);
        graphics.stroke({ color: burst.colorNumber, alpha, width: lineWidth });
        break;
      }
      case 'streak': {
        if (burst.variant === 'line') {
          if (particle.phase === -1) {
            // 贯穿主轴光束：全线路程高亮淡出
            const coreAlpha = alpha * 0.85;
            graphics
              .moveTo(centerX, centerY)
              .lineTo(endX, endY)
              .stroke({ color: burst.colorNumber, alpha: coreAlpha, width: Math.max(3, cellSize * particle.size * 2.2) });
            break;
          }
          // 线形扫射侧翼气浪：沿施法者→锚点方向按 phase 排布，横向抖动
          const head = clamp01(particle.phase + eased * 0.55);
          const side = (fractSin(particle.phase * 17.3) - 0.5) * cellSize * 0.5 * (1 - eased);
          const px = centerX + dx * head - (dy / (len2(dx, dy) || 1)) * side;
          const py = centerY + dy * head + (dx / (len2(dx, dy) || 1)) * side;
          const trail = Math.max(0, head - 0.18);
          const tx = centerX + dx * trail - (dy / (len2(dx, dy) || 1)) * side;
          const ty = centerY + dy * trail + (dx / (len2(dx, dy) || 1)) * side;
          graphics
            .moveTo(tx, ty)
            .lineTo(px, py)
            .stroke({ color: burst.colorNumber, alpha, width: Math.max(1.5, cellSize * particle.size) });
          break;
        }
        if (burst.variant === 'vortex') {
          // 气旋引力：外圈粒子沿切向加速旋转并向心收拢
          const dist = Math.hypot(particle.offsetX, particle.offsetY) || 0.1;
          const angle = particle.phase + eased * 4.6;
          const radius = dist * (1 - eased * 0.85);
          const px = centerX + Math.cos(angle) * radius * cellSize;
          const py = centerY + Math.sin(angle) * radius * cellSize;
          const tailX = px - Math.cos(angle + Math.PI / 2) * cellSize * particle.size * 2.4;
          const tailY = py - Math.sin(angle + Math.PI / 2) * cellSize * particle.size * 2.4;
          graphics
            .moveTo(tailX, tailY)
            .lineTo(px, py)
            .stroke({ color: burst.colorNumber, alpha, width: Math.max(1.5, cellSize * particle.size) });
          break;
        }
        if (burst.variant === 'barrage') {
          // 万刃攒射：从施法者出发的锥形弹幕，横向偏移随生命收拢
          const head = clamp01((particle.phase - 1) + eased * 0.6);
          const side = (fractSin(particle.phase * 31.7) - 0.5) * cellSize * 0.55 * (1 - eased);
          const px = centerX + dx * head - (dy / (len2(dx, dy) || 1)) * side;
          const py = centerY + dy * head + (dx / (len2(dx, dy) || 1)) * side;
          const trail = Math.max(0, head - 0.2);
          const tx = centerX + dx * trail - (dy / (len2(dx, dy) || 1)) * side;
          const ty = centerY + dy * trail + (dx / (len2(dx, dy) || 1)) * side;
          graphics
            .moveTo(tx, ty)
            .lineTo(px, py)
            .stroke({ color: burst.colorNumber, alpha, width: Math.max(1.5, cellSize * particle.size) });
          break;
        }
        // 爆散 streak：沿速度方向短划（single 破片 / aoe 地裂放射线）
        const px = centerX + particle.offsetX * cellSize + particle.velocityX * cellSize * eased * 0.5;
        const py = centerY + particle.offsetY * cellSize + particle.velocityY * cellSize * eased * 0.5;
        const tailX = px - Math.cos(particle.phase) * cellSize * particle.size * 2;
        const tailY = py - Math.sin(particle.phase) * cellSize * particle.size * 2;
        graphics
          .moveTo(tailX, tailY)
          .lineTo(px, py)
          .stroke({ color: burst.colorNumber, alpha, width: Math.max(1.5, cellSize * particle.size) });
        break;
      }
      case 'dot':
      default: {
        let px = centerX + particle.offsetX * cellSize + particle.velocityX * cellSize * eased * 0.5;
        let py = centerY + particle.offsetY * cellSize + particle.velocityY * cellSize * eased * 0.5;
        if (burst.variant === 'buff_self') {
          if (particle.phase === 99) {
            // 中心聚气点：保持中心随生命淡出
          } else {
            // 阴阳双逆向环绕：phase 为负时逆时针
            const orbitRadius = cellSize * (0.55 + eased * 0.25);
            const angle = particle.phase + eased * 2.4 * (particle.phase < 0 ? -1 : 1);
            px = centerX + Math.cos(angle) * orbitRadius;
            py = centerY + Math.sin(angle) * orbitRadius * 0.92;
          }
        } else if (burst.variant === 'heal') {
          // 双螺旋上升光尘：phase 正负决定初始旋向
          px += Math.cos(particle.phase * 4 + localProgress * 6) * cellSize * 0.22;
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

/** 向量长度平方的别名（避免重复 hypot）。 */
function len2(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}
