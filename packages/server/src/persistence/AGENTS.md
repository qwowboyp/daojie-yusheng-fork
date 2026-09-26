# packages/server/src/persistence — 持久化真源、刷盤與 outbox 邊界

**本目錄：55 檔案（.ts）/ 49,954 行，1 子目錄 `compat/`**。服務端唯一 DB 真源的寫入層：分域持久化、統一刷盤帳本、強事務 durable operation、outbox、fence 與節點路由。行為紅線見倉庫根 AGENTS.md（持久資料以 DB 為真源、tick 外受控 flush/outbox/worker）與 packages/server/AGENTS.md（`--include-persistence`、smoke 自動清理），本檔只補充本目錄特有內容。

## STRUCTURE

| 分組 | 檔案 | 代表檔（行數） | 職責 |
|---|---|---|---|
| 領域持久化 | 13 | `player-domain-persistence.service.ts`（9483）、`instance-domain-persistence.service.ts`（5213） | 玩家 20+ / 實例分域表增量讀寫、恢復水位、快照水合；mail / market / activity / redeem / spirit-beast / tongtian-tower / generated-technique / identity / counters 各域服務 + `sect-member-profile-read-model.ts` 讀模型 |
| 刷盤調度 | 11 | `flush-task-runtime.service.ts`（2914）、`flush-ledger.service.ts`（2515） | 統一帳本 upsert/claim/markFlushed 與積壓摘要、inline/worker/direct/off 模式、喚醒、失敗分類、診斷；玩家與地圖定時刷盤服務、write plan |
| 強事務與 outbox | 6 | `durable-operation.service.ts`（8438） | 冪等 operation log、未知 COMMIT 收斂；outbox 寫入/死信/去重、輪詢分發、topic 消費者註冊、戰鬥審計 outbox、PG 錯誤分類 |
| 跨域 durable 事務 | 7 | `technique-generation-durable-persistence.ts`（1884）、`sect-durable-persistence.ts` | 單事務內跨「領域表＋背包＋帳本」提交：宗門、功法生成、道具使用、活動資產、掉落來源、地塊資源、GM 手工功法 |
| fence / 修復 / 相容 | 7 | `instance-lease-write-fence.ts`、`player-flush-asset-conflict-repair.ts` | 實例 lease 與帳本 fencing、資產衝突隔離修復、quest / market payload 修復、物品快照序列化水合、`compat/item-instance-id-compat.ts` 物品實例 ID 相容 |
| 基建與節點 | 7 | `database-pool.provider.ts`（306） | 四組連線池、`node_registry` CRUD、心跳與過期推進、玩家 session 路由、實例分線目錄、bigint 遷移、persistent_documents |
| GM 落庫 | 3 | `gm-audit-log-persistence.service.ts`（366） | GM 寫審計（N45 最小可追溯通道）、熱生效 flag、重啟生效 config |
| 退役 | 1 | `map-persistence.service.ts`（26） | 舊整檔地圖快照，僅留 `isEnabled()` 供退役審計，運行時不讀寫 |

## WHERE TO LOOK

| 任務 | 位置 |
|---|---|
| 玩家分域持久化 | `player-domain-persistence.service.ts`（71 refs，9483 行）+ `player-domain-write-plan.ts`（recorder 編譯寫計畫） |
| 通用強事務調度 | `durable-operation.service.ts`（64 refs，8438 行） |
| 實例分域持久化 | `instance-domain-persistence.service.ts`（5213 行） |
| 統一刷盤帳本 | `flush-ledger.service.ts`（player + instance 兩帳本 upsert/claim/markFlushed）；玩家帳本服務 `player-flush-ledger.service.ts`（建表 + advisory lock） |
| 刷盤調度器 / 運行模式 | `flush-task-runtime.service.ts` + `flush-task-runtime-mode.ts`（inline/worker/direct/off） |
| 玩家 / 地圖定時刷盤 | `player-persistence-flush.service.ts`、`map-persistence-flush.service.ts` |
| outbox 寫入/分發/消費者 | `outbox-dispatcher.service.ts`、`outbox-dispatcher-runtime.service.ts`、`outbox-event-consumer-registry.service.ts` |
| 連線池分組與逾時 | `database-pool.provider.ts`（runtimeCritical / flush / outbox / gmDiagnostics） |
| 節點註冊/玩家路由 | `node-registry.service.ts`、`node-registry-runtime.service.ts`、`player-session-route.service.ts` |
| 實例 lease / 帳本 fence | `instance-lease-write-fence.ts`、`instance-flush-ledger-fence.ts` |
| 資產衝突隔離查詢 | `flush-ledger.service.ts:988`（`isPlayerFlushAssetConflictQuarantined`） |
| 功法生成批量認領 | `technique-generation-durable-persistence.ts:361` |
| 快照回退靜態審計 | `../tools/audit/production-boundary-audit.ts`（`persistence.snapshot_rewrite.*`） |

## CONVENTIONS

- 檔頭含「持久化邊界」標記的 29 檔（含 flush / durable 系列）：優先冪等、崩潰恢復、自動清理；tick 內不引入阻塞 IO
- 硬切後只寫分域表：`player-persistence-flush.service.ts` 檔頭明示舊整檔快照（`player-persistence.service.ts` 的 `server_player_snapshot`）不再作運行時落點，僅保留載入與相容用途
- 資產衝突未核對時禁止恢復為可寫運行態：`flush-ledger.service.ts:987-1009`（`latest_version > flushed_version` 且 `failure_category` 為資產衝突即視為隔離）；登入側 `runtime/player/player-runtime.service.ts:3046` 查到隔離且修復失敗會直接拒絕載入
- COMMIT 結果未知時禁止降級成普通失敗回滾內存：`durable-operation.service.ts:4434-4446`（`settleUnknownCommitOutcome` 持資產鎖收斂）；`:391-394` 定義 `DurableOperationCommitOutcomeUnknownError`
- 批量 job 禁止部分 running：`technique-generation-durable-persistence.ts:360-391`（列數不符或任一不可認領即整批失敗）
- 連線池四組分離，各組 max / statement / query / lock 逾時有獨立預設（`database-pool.provider.ts:27-53`）

## ANTI-PATTERNS

- 整表 DELETE + 全量重插回退被機器禁止：`../tools/audit/production-boundary-audit.ts:395-886` 共 31 條 `persistence.snapshot_rewrite.*`，鎖定本目錄三巨檔（player-domain / durable-operation / instance-domain）；白名單僅 `deletePlayerInventoryForExplicitEmptySnapshot`、`deletePlayerWalletForExplicitEmptySnapshot`、`purgeInstanceState`、`deleteTileDamageStates` 等顯式函數，模板實例化邊界另見 packages/server/README.md「模板 Registry 邊界」
- 資產衝突未經核對就放行玩家可寫（`flush-ledger.service.ts:987`、`player-runtime.service.ts:3045`）
- 把 COMMIT 未知結果當普通失敗回滾（`durable-operation.service.ts:4436`）
- 批量任務拆批認領造成部分 running（`technique-generation-durable-persistence.ts:360`）
- 持久化測試建物件未自動清理、套件未加 `--include-persistence`（根 AGENTS.md 與 src/tools/AGENTS.md 規範，此處不重複）
