# packages/server/src/network — Socket.IO 網路層

**本目錄：77 檔案（無子目錄）**。Socket.IO 入站網關、session 生命週期、每 tick 同步出站與協議投影。行為紅線與編譯/測試鏈見 packages/server/AGENTS.md，本文件只補充本目錄特有內容。

## STRUCTURE

| 群組 | 檔案 | 職責 |
|---|---|---|
| 網關主體 | `world.gateway.ts` | Socket.IO 入口，158 個 `@SubscribeMessage`，只做路由分發委派 helper |
| 領域 helper | `world-gateway-*.helper.ts` 25 + `world-gateway-context.types.ts` | 各域 handler（movement / inventory / market / technique / gm-command …），依賴契約 `WorldGatewayHelperContext` |
| 會話 | `world-session*` 12 | socket-player 綁定真源、bootstrap 9 段鏈、過期回收、重連恢復佇列 |
| 同步出站 | `world-sync*` 17 | 每 tick 出站 envelope、AOI 地圖快照、aux 狀態、worker encode |
| 協議投影 | `world-projector*` 2 + `projector-*` 4 | 權威狀態 → S2C 視圖；diff / compare / clone 純函式工具 |
| 鑑權 | `world-auth.registry.ts` + `world-player-*` 5 + `world-gm-auth.service.ts` | token 解析、玩家鑑權、GM 權限，匯出 `WORLD_AUTH_PROVIDERS` |
| 下發 / 支撐 | `world-client-event.service.ts`、`world-protocol-projection.service.ts`、`world-gm-socket.service.ts`、`world-shutdown-drain.service.ts`、`aoi-envelope-encoder.service.ts`、`envelope-spec.types.ts`、`gateway-result.types.ts`、`sync-slot.ts` | S2C 唯一翻譯層、GM 請求轉排、關停順序、AOI 編碼與共用型別 |

## WHERE TO LOOK

| 任務 | 位置 |
|---|---|
| 入站事件註冊 / 連線 | `world.gateway.ts`（`handleConnection:185` 檢查 draining → 掛限流 → 委派 bootstrap helper） |
| 域 handler | `world-gateway-*.helper.ts`（25 個，一域一檔） |
| helper 依賴契約 | `world-gateway-context.types.ts`（`WorldGatewayHelperContext`；gateway 本體 implements，`world.gateway.ts:92`） |
| handler 回包格式 | `gateway-result.types.ts`（`ok`/`fail` 工廠，客戶端按 `success` 分流） |
| 連線鑑權 | `world-player-auth.service.ts` + `world-player-token.service.ts` / `world-player-token-codec.service.ts`；GM 走 `world-gm-auth.service.ts`；注入清單 `world-auth.registry.ts` |
| 會話綁定 / 斷線 | `world-session.service.ts`（detach 15 秒窗口，單進程記憶體為唯一真源） |
| 登入 bootstrap | `world-session-bootstrap.service.ts` + 8 段（context / contract / runtime / session-bind / player-init / snapshot / finalize / post-emit） |
| 過期回收 / 重連恢復 | `world-session-reaper.service.ts`（flush + 路由清理）、`world-session-recovery-queue.service.ts`（並發控制與優先級） |
| 每 tick 出站 | `world-sync.service.ts`（+ `world-sync-envelope.service.ts`、`world-sync-aux-state.service.ts`、`world-sync-map-snapshot.service.ts`、`world-sync-worker-encode.service.ts`） |
| 協議投影 | `world-projector.service.ts`、`world-projector.helpers.ts` |
| S2C 事件下發 | `world-client-event.service.ts`（runtime 結果 → socket 事件的唯一翻譯層） |
| GM 請求轉排 | `world-gm-socket.service.ts`（gateway 收到的 GM 操作轉 runtime GM 狀態隊列） |
| 關停順序 | `world-shutdown-drain.service.ts`（停接入 → 斷 socket → 停 tick/worker → final flush → 釋 lease → 註銷節點） |
| AOI worker 編碼 | `aoi-envelope-encoder.service.ts` + `envelope-spec.types.ts`（plain POJO 輸入，可安全 postMessage） |

## CONVENTIONS

- **helper 構造**：參數必須是具名 context / deps 介面（`WorldGatewayHelperContext` 或更窄的 `WorldGatewayActionDeps` 等）；部分 helper 走 DI，部分在 gateway 構造器以 `new XHelper(this)` 建立（typed `this`，`world.gateway.ts:144-165`）
- **handler 邊界**：收意圖 → 鑑權 → enqueue，不直接改世界狀態；世界改動一律走 runtime command intake（`world-gateway-movement.helper.ts:60` `enqueueMoveTo`、`:120` `enqueueMove`）
- **條件註冊**：`app.module.ts:255` `WORLD_GATEWAY_PROVIDERS = shouldStartHttpServer() ? [13 項（drain + 11 helper + WorldGateway）] : []`，worker role 不註冊；鑑權 5 項由 `world-auth.registry.ts` 匯出、`app.module.ts:475` 展開
- **傳輸**：msgpack parser + `perMessageDeflate` threshold 256（`world.gateway.ts:84-90`）
- **smoke 覆蓋**：`src/tools/` 實測 world-gateway-* 12、world-sync-* 9、world-session-* 7

## ANTI-PATTERNS

- helper 注入禁回退 `any`：`marketRuntimeService: any` / `worldRuntimeService: any`（`tools/audit/production-boundary-audit.ts:171-185`）
- 禁 `new WorldGatewayActionHelper(this as any)`（同檔 `:187-193`）；禁 `new WorldGatewayGuardHelper(this)` 等手動 new 持有完整 gateway 的清單（同檔 `:195-265`）
- helper 構造禁退無型別 `constructor(gateway)`（同檔 `:267-393`，逐 helper 條目）
- handler 不得繞過 command intake 直接改權威狀態（檔頭規約 `world-gateway-context.types.ts:4`）
