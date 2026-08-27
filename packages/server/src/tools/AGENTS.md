# packages/server/src/tools — 验证脚本库

**本目录：531 文件 / 187,784 行，全仓最大目录**。415 个 `*-smoke.ts` 是独立 Node.js 验证入口，经 dist 执行（须先 `pnpm --filter @mud/server compile`）。行为红线见 packages/server/AGENTS.md。

## smoke 共用脚手架（新增 smoke 必须遵循）

| 条目 | 约定 |
|---|---|
| 档顶 | `// @ts-nocheck`（本目录豁免区）+ `/** 用途：xxx 链路的冒烟验证。 */` 注解 |
| 入口 | `void main().catch(err => { console.error(err); process.exitCode = 1; }).finally(...)` |
| 成功输出 | `console.log(JSON.stringify({ ok: true, ... }, null, 2))`；失败走 `throw new Error` → exitCode 1 |
| 环境变量 | `SERVER_URL`（`resolveServerUrl()`）、`SERVER_DATABASE_URL`（`resolveServerDatabaseUrl()`） |
| 无 DB 降级 | `if (!hasDatabaseUrl)` → 输出 `{ ok: true, skipped: true, reason: 'no_db_...' }` 直接 return；禁止静默通过 |
| 自动清理（强制） | `.finally()` 内调用 `flushRegisteredSmokePlayers()` 清除 `smoke_player_*_<suffix>` 测试玩家；精细清理走 `purgeSmokePlayerArtifactsByPlayerId`（HTTP `/api/test/*` + DB row 同步清） |
| 玩家注册 | `registerAndLoginPlayer()`（smoke-player-auth.ts / smoke-player-cleanup.ts） |
| 等待工具 | `waitFor(predicate, timeoutMs, label)` + `throwIfSocketError` |

## 子系统前缀分类

| 前缀 | 数量 | 涵盖 |
|---|---|---|
| world-runtime-* | ~70 | world facade 各子系统整合 |
| world-gateway-* | ~13 | gateway handler 按域拆分 |
| player-* | 27 | 玩家持久化 CRUD/fence/route |
| gm-* | 26 | GM HTTP/socket 主链路 |
| instance-* | 18 | 实例 lease/flush/migration |
| technique-* | 16 | 功法状态机 |
| market-* | 16 | 市场 fence/refund/expiry |
| flush-* | 13 | flush worker 幂等/重试 |
| mail-* / native-* | 9+9 | 邮件 / native HTTP 持久化 |
| world-sync-* / combat-* / runtime-* / monster-* | 9/8/8/8 | 同步、战斗、运行时、怪物 |
| world-session-* | 7 | session bootstrap/recovery |
| world-projector-* / world-tick-* | 4/2 | 协议投影 / tick 调度 |
| 汇总入口 | — | runtime-smoke.ts、persistence-smoke.ts、combat-smoke.ts、session-smoke.ts、gm-smoke.ts、shadow-smoke.ts |

## 执行方式

- 单跑：`pnpm --filter @mud/server tool -- <name>`
- 套件：`run-stable-smoke-suite.js` 支持 `--case` / `--group` / `--include-persistence`
- 超时：`smoke-timeout.ts` 是 per-file 超时表
- 子目录：`audit/`（production-boundary-audit.ts、persistence-retirement-audit.ts 静态审计）、`lib/`、`*-smoke-support/`

## ANTI-PATTERNS

- `@ts-nocheck` 仅限本目录；src 其他位置零容忍
- 持久化 smoke 若创建对象必须自带自动清理（`flushRegisteredSmokePlayers`）
- 无 DB 时必须显式 `skipped` 输出，禁止静默通过
