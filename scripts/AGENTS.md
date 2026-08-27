# scripts — 根级验证/发布编排脚本

**本目录：76 文件**（含 lib/ 4 个 .mjs 辅助模块：tw-vocabulary、sync-smoke-assertions 等）。根 package.json 的 `verify:*` / `proof:*` / `audit:*` 几乎一对一映射到此。门禁选择指引见仓库根 AGENTS.md §12。

## 前缀分类

| 前缀 | 数量 | 角色 |
|---|---|---|
| verify-* | 7 | 门禁编排（quick / client / standard / release / building / building-perf / backup-worker） |
| release-* | 10 | 发布流水线（full / with-db / proof-with-db / acceptance / doctor / local / shadow / shadow-destructive[-preflight] / verification-mode 共享库） |
| prove-* | 12 | 针对性证明（protocol-source / protobuf-drift / s2c-consumption / server-runtime-boundaries / craft-* / gm-login-autofill 等） |
| check-* | 6+1json | 一次性检查（release-gates / file-size-gate[+baseline.json] / traditional[+scope.json] / item-sources / player-facing-name-boundaries / runtime-realm-exp-boundary） |
| shadow-local-* | 13 | 本地 Docker shadow 环境生命周期 shell（up/down/reset/full/all/verify/acceptance/destructive[-preflight]/maintenance-on/off/status/lib） |
| generate-* / sync-* / convert-* | 4/4/2 | 内容生成 / 数据同步 / 简转繁转换 |
| 其他 | 12 | 共享库（load-local-runtime-env / server-env-alias / parallel-verification / verification-timing / shadow-target-probe）+ 工具（analyze-heap / compile-monster-tendency / gm-api.sh / tencent-swarm-volumes.sh） |

## 命名后缀语义

| 后缀 | 意义 |
|---|---|
| -with-db | 连真实 DB 跑（需 `DATABASE_URL` 或 `SERVER_DATABASE_URL`） |
| -shadow | 对 shadow 隔离副本跑（需 `SERVER_SHADOW_URL`） |
| -destructive / -destructive-preflight | 破坏性操作 / 其 dry-run（需 `SERVER_SHADOW_ALLOW_DESTRUCTIVE=1` + maintenance.active=true） |
| -local | 本机模式（无 DB 时自动降级） |
| -doctor | 环境预检（无执行，输出 ready/missing/blocked-by 表） |
| -perf | 基准测试变体 |
| -gates | 门禁契约校验 |
| -full | 全量门禁集合 |
| -acceptance | 正式验收 |

## CONVENTIONS

- `verify:quick` 与 `verify:client` 前置 `check-traditional.mjs --scope`（简→台繁体幂等检查，2026-08 新增）
- env 载入顺序：`.runtime/server.local.env` > `.env` > `.env.local` > `packages/server/.env` > `packages/server/.env.local`（load-local-runtime-env.js）；`SERVER_SKIP_LOCAL_ENV_AUTOLOAD=1` 可跳过
- release 步骤预设 serial（避免 DB 抢占）
