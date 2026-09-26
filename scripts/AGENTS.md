# scripts — 根级验证/发布编排脚本

根 package.json 的 `verify:*` / `proof:*` / `audit:*` 幾乎一對一映射到此。門禁選擇見根 AGENTS.md「驗證分級」。工作流工具自身使用 `pnpm verify:workflow` 和一次相關真實流程，不觸發完整遊戲發布。

- `workflow.mjs context`：精簡狀態、surface 入口和 proof 提示；`plan` 預覽精準檢查，`check` 執行文案/tsc/選定 proof，日誌與結果放 `.codex/tmp/workflow/`。
- 不可 import/require 會在頂層啟動任務的驗證腳本來取得設定或計數；靜態讀 package.json/原始碼，避免只讀探索誤啟完整 build。

## 前缀分类

| 前缀 | 数量 | 角色 |
|---|---|---|
| verify-* | 9 | 门禁编排（quick / client / standard / release / building / building-perf / backup-worker） |
| release-* | 10 | 发布流水线（full / with-db / proof-with-db / acceptance / doctor / local / shadow / shadow-destructive[-preflight] / verification-mode 共享库） |
| prove-* | 25 | 针对性证明（protocol-source / protobuf-drift / s2c-consumption / server-runtime-boundaries / craft-* / gm-login-autofill 等） |
| check-* | 6+1json | 一次性检查（release-gates / file-size-gate[+baseline.json] / traditional[+scope.json] / item-sources / player-facing-name-boundaries / runtime-realm-exp-boundary） |
| shadow-local-* | 13 | 本地 Docker shadow 环境生命周期 shell（up/down/reset/full/all/verify/acceptance/destructive[-preflight]/maintenance-on/off/status/lib） |
| generate-* / sync-* / convert-* | 9/5/2 | 内容生成 / 数据同步 / 简转繁转换 |
| 其他 | 20 | 共享库（load-local-runtime-env / server-env-alias / parallel-verification / verification-timing / shadow-target-probe）+ 工具（analyze-heap / compile-monster-tendency / gm-api.sh / tencent-swarm-volumes.sh 等） |

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
