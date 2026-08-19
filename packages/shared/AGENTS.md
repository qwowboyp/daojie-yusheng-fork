# packages/shared — 共享契约层

**本目录：211 文件（src/ 199）**。client / server / config-editor 唯一契约源。行为红线见仓库根 AGENTS.md，本文件只补充本包特有内容。

## OVERVIEW

单一 barrel `src/index.ts`（全部 `export *`，无 named export），改动影响全仓。协议、HTTP DTO、领域类型、常量、procgen 均在此。

## STRUCTURE（src/）

| 位置 | 文件 | 职责 |
|---|---|---|
| 根层 *.ts | ~119 | 协议、API 契约、领域类型、工具 |
| constants/ | 48 | 跨端稳定数值（gameplay 31 / network 4 / ui 6 / visuals 6） |
| procgen/ | 28 | 秘境随机地形生成 |
| actor/ | 4 | Actor 契约（blueprint / ephemeral / bot） |

## WHERE TO LOOK

| 任务 | 位置 |
|---|---|
| Socket 事件 | `protocol.ts` → `protocol-core/combat/craft/social/market` |
| HTTP/GM DTO | `api-contracts.ts`（4492 行，最大文件） |
| Protobuf 编解码 | `network-protobuf*.ts`（tick/update/payload codec） |
| 功法 / 成长 | `technique-*.ts`（15+ 文件，50 refs） |
| 战斗公式 | `combat.ts`（29 refs） |
| 地形 / 瓦片 | `terrain.ts`（44 refs）、`map-document.ts` |
| 数值显示 | `numeric.ts`、`display-number.ts` |
| 物品实例 | `item-runtime-types.ts` |
| 常量 | `constants/gameplay/*.ts` |
| 随机生成 | `procgen/` |

## CONVENTIONS

- **修改后必跑**：`pnpm build:shared` + `pnpm audit:protocol`；build 会执行 8 条 `check-*.cjs`（protocol-event-maps / payload-shapes / protobuf-contract / entry-boundaries / display-number / numeric-stats / role-name-graphemes / access-policy）
- 消费方式：client / server / config-editor 均 `import ... from '@mud/shared'`
- config-editor 走 vite alias 指向 `src`；其 local-api.cjs 直接 require `dist/index.js`
- barrel 增删 `export *` = 全仓 API 变更，先搜索所有使用点
- 领域前缀命名（protocol- / technique- / network-protobuf-）即文件组织规范，新增文件沿用

## ANTI-PATTERNS

- 禁止 `Math.random` — 一律 `ProcgenRng`（同 seed 同结果）
- 禁止 `rng.fork()`（消耗父流状态）
- `getRef*` 只供调试/冷路径，禁止 tick 热路径
- 移动点数不跨 tick 累积（最多存 1 tick 基础产出）
- 分区连通性必须预留门位构造，禁止事后全图凿穿墙体
- 不新增旧格式兼容分支；破坏性 schema 变更走 GM 一键转换（见根 AGENTS.md §10）
