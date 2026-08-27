# packages/client/src/game-map — PixiJS 地图渲染域

**本目录：21 文件 / 10 子目录**。PixiJS 地图渲染。表现插值/预测只影响显示，**不污染服务端权威坐标**。行为红线见 packages/client/AGENTS.md 与仓库根 AGENTS.md。

## STRUCTURE

| 位置 | 职责 |
|---|---|
| renderer/ | 11 档 PixiJS 核心：pixi-map-renderer-adapter.ts（主入口）、pixi-render-state / render-primitives / render-profiler / profiler-window / frame-spatial-index / combat-effect-runtime / artifact-aura-geometry / runtime-image-manifest / terrain-cache-signatures、combat-damage-summary-text |
| camera/ | camera-controller.ts |
| viewport/ | viewport-controller.ts |
| scene/ | map-scene.ts |
| minimap/ | minimap-runtime.ts |
| interaction/ | interaction-controller.ts |
| projection/ | topdown-projection.ts（俯视投影数学） |
| runtime/ | map-runtime.ts + frame-schedule.ts（tick 帧调度） |
| store/ | map-store.ts |
| 根 | types.ts |

## WHERE TO LOOK

| 任务 | 位置 |
|---|---|
| 渲染入口 | `renderer/pixi-map-renderer-adapter.ts` |
| 帧调度 | `runtime/frame-schedule.ts` |
| 坐标投影 | `projection/topdown-projection.ts` |
| 小地图 | `minimap/minimap-runtime.ts` |

## CONVENTIONS

- 静态层 / 动态实体层 / overlay 层分离更新；高频变化只更新受影响区域或层
- 每帧避免全量解析协议、重复全图查询、大量短命对象

## ANTI-PATTERNS

- 法宝光环每帧禁止重建几何（`pixi-artifact-aura-geometry.ts`；proof:artifact-aura-frame-cache 守门）
- 地形缓存签名比对失配时禁止全图重绘（`pixi-terrain-cache-signatures.ts`）
- 远处 worldRevision 变化不得重建局部投影（AOI 缓存局部性，world-runtime-aoi-cache-locality-smoke 验证）
