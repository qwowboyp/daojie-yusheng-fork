# packages/server — 游戏服务端

**本目录：1208 文件（src/ 1064）**。NestJS + Socket.IO 权威服务端，纯 tsc 编译（无 webpack/swc/esbuild）。行为红线见仓库根 AGENTS.md，本文件只补充本包特有内容。子目录深导航：`src/runtime/AGENTS.md`（22 子域）、`src/tools/AGENTS.md`（415 smoke 脚手架）。

## OVERVIEW

服务端是唯一权威来源。入口链：`src/main.ts` → `bootstrap/server-application.ts` → `app.module.ts`（单一扁平 @Module，注册 220+ provider）。tick 为 1Hz 权威推进（`runtime/tick/world-tick.service.ts`）。

## STRUCTURE（src/）

| 目录 | 文件 | 职责 |
|---|---|---|
| runtime/ | 271 | 权威玩法运行时（22 个子系统，详见 src/runtime/AGENTS.md） |
| tools/ | 531 | smoke / proof / audit / bench / 修复 / 迁移脚本（验证入口，详见 src/tools/AGENTS.md） |
| network/ | 73 | Socket.IO gateway + session/sync/projector + 领域 helper |
| persistence/ | 54 | 刷盘任务、outbox、领域持久化、连接池、节点注册 |
| http/ | 40 | 对外 HTTP controllers（native-http.registry 聚合） |
| content/ | 10 | 模板 repository + 8 个 registry（启动期装载） |
| concurrency/ | 13 | worker pool（encoding/instance/persistence/leaderboard） |
| config/ | 12 | env 加载、runtime-role、CORS、worker pool 配置 |
| gm/ | 9 | GM 环境 / runtime 认证 + compat-conversions |
| scheduler/ lifecycle/ ai/ auth/ health/ logging/ bootstrap/ constants/ common/ debug/ | | 支撑层 |

## WHERE TO LOOK

| 任务 | 位置 |
|---|---|
| 世界 tick / 玩法 facade | `runtime/world/world-runtime.service.ts`、`runtime/tick/world-tick.service.ts` |
| 玩家状态 | `runtime/player/`、`persistence/player-domain-persistence.service.ts` |
| 战斗 | `runtime/combat/`、`runtime/world/combat/` |
| 制造/技艺 job | `runtime/craft/`（pipeline/ 为 technique-activity 生命周期） |
| Socket 收发 | `network/world.gateway.ts` + `world-gateway-*.helper.ts` |
| 同步 / 投影 | `network/world-sync.service.ts`、`world-projector.service.ts` |
| 模板装载 | `content/content-template.repository.ts` + `content/registries/` |
| 持久化真源 | `persistence/*-persistence.service.ts` |
| 后台 worker | `runtime/world/worker/`（17 个 *.worker.ts） |
| 命令摄取 | `runtime/world/command/` |
| 读 facade | `runtime/world/query/`（11 个） |
| 验证脚本 | `tools/`（`pnpm --filter @mud/server tool -- <name>`） |
| 技能生成 | `runtime/technique-generation/` |
| GM AI 触发 | `http/native/native-gm-technique-generation.service.ts` |

## KEY HUBS

- `app.module.ts` — 唯一 @Module；任何服务新增都要进这里
- `player-runtime.service.ts`（201 refs，12744 行）— 玩家状态真源，全服最高中心性
- `content-template.repository.ts`（123 refs）— 模板装载中枢
- `map-instance.runtime.ts`（106 refs）+ `map-template.repository.ts`（100 refs）— 地图/实例双核
- `player-domain-persistence.service.ts`（71 refs，9024 行）— 玩家持久化真源
- `durable-operation.service.ts`（64 refs，8071 行）— 通用持久化调度器
- `world-runtime.service.ts`（61 refs）— 世界运行时 facade
- `world.gateway.ts` — Socket.IO 主网关（经 DI 注入，class 直引仅 7 处，引用数不反映枢纽地位）

## CONVENTIONS

- **编译**：`compile` = 清 dist → 建 shared → `compile-monster-tendency-stats.mjs` → `tsc -p tsconfig.json`。tsconfig 覆写 `strict:false`（NestJS 装饰器）、`experimentalDecorators`、`noEmitOnError`
- **测试**：无 vitest/jest。每个 `src/tools/*-smoke.ts` 是独立 Node.js 入口，`node:assert/strict` 断言，经 dist 执行；smoke 脚手架约定见 src/tools/AGENTS.md
- **验证链**：`verify` = compile + `proof:production-boundaries` + `smoke:all`；持久化测试需 `--include-persistence`；shadow 测试需 `SERVER_SHADOW_URL`；根 `verify:quick`/`verify:client` 前置简繁幂等检查（scripts/check-traditional.mjs）
- **超时/快照**：`smoke-timeout.ts`（per-file 超时表）、`stable-dist.ts` + `run-stable-smoke-suite.ts`（--case/--group）
- **测试玩家**：`smoke-player-auth.ts` / `smoke-player-cleanup.ts` 负责注册与自动清理
- **worker pool**：`concurrency/worker-pool.module.ts`；确认 pool 真实启用后再依赖，防「已启用但 0 任务提交」
- **GM AI 功法触发**：`POST /api/gm/technique-generation/run` 由 GM 鉴权调用，绕过玩家物品/境界门槛；服务侧 `TechniqueGenerationService.requestGeneration` / `requestBatchGeneration` 接受 `bypassInventoryCheck: boolean`（仅 GM 路径使用，常规玩家路径不许走），开启时跳过 inventory transaction + session fence，直接 INSERT pending job 行到 `technique_generation_job` 表。

## ANTI-PATTERNS

- `@ts-nocheck` / `@ts-ignore` / `@ts-expect-error` 仅限 `src/tools/` 旧 smoke helper；src 其他位置零容忍
- tick 热路径禁止 DB IO、`JSON.stringify`、临时字符串键、每 tick 全表扫描
- WorldGateway Helper 禁止注入回退 `any` / `this as any` / 手动 new 持有完整 gateway
- 不可绕过通用技艺 job 骨架另写任务生命周期
- 持久化测试若创建对象必须自带自动清理
