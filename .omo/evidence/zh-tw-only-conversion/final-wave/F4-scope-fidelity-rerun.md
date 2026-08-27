# F4 — 範圍忠實度稽核重跑

**裁決：APPROVE**

稽核範圍：`14a49fd3^..7c174ec6`；本次補查範圍：`43739e75..7c174ec6`。

前次 F4 的三個阻擋項已消除或按執行策略接受。補查提交未引入任何未列入「文字轉換／斷言同步／守衛工具／郵件雙表相容轉換／正則同步／數值顯示／證據」分類的產品變更。

## 前次阻擋項覆核

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| `app.module.ts` 繁體註解 | PASS | 現行 `packages/server/src/app.module.ts:273-274` 為簡體：`不读 .env 文件`、`环境变量一律由 process.env 注入`。`7c174ec6` 僅把這兩行由繁體改回簡體；`ConfigModule.forRoot({ isGlobal: true, envFilePath: [] })` 未改。 |
| `responsive.css` 繁體註解 | PASS | 現行 `packages/client/src/styles/responsive.css:906-907` 為簡體：`手机端锚定视口底部`、`保证营造模式`。本次以檔案位元組正確解碼結果判定；前次 PowerShell pipeline 編碼誤判。該檔不在 `43739e75..7c174ec6 --stat`。 |
| 已接受的必要工程變更 | PASS | 既有接受集合為 `envFilePath: []`、手機 `.building-mode-toolbar { position: fixed; }`、process-supervisor 對 `null` 結束碼的容許、server `compile` 與跨平台 audit scripts。本次補查差異中，`app.module.ts` 僅有上述註解回復；responsive CSS、process-supervisor 與 server `package.json` 均未改。未發現新增的未規劃執行期行為。 |
| 四份 package `AGENTS.md` | PASS | 全範圍只新增 `packages/{client,server,shared,config-editor}/AGENTS.md`；均為 package 工程說明，未進入產品執行、協議、資料或玩法路徑。計畫的提交策略允許文件隨實作提交，故不阻擋。 |

## `43739e75..7c174ec6` 檔案分類

`git diff 43739e75..7c174ec6 --stat`：**79 檔、1,762 新增、1,409 刪除**。逐檔分類如下；**evidence 類為 0 檔，其他類之外為 0 檔**。

### 文字轉換（21）

- 玩家內容真源與產物：`docs/tutorial-mechanics.md`、`packages/shared/src/tutorial-mechanics.generated.ts`。
- 客戶端玩家文案：`packages/client/src/react-ui/panels/inventory/InventoryPanel.tsx`、`packages/client/src/ui/npc-quest-modal.ts`、`packages/client/src/ui/offline-gain-modal.ts`、`packages/client/src/ui/panels/party-panel-view.ts`、`packages/client/src/ui/stat-preview.ts`。
- 註解回復為簡體：`packages/server/src/app.module.ts`。
- shared 玩家可見文案：`packages/shared/src/constants/gameplay/player-final-attr-baselines.json`、`packages/shared/src/constants/gameplay/realm.ts`、`packages/shared/src/constants/gameplay/technique-arts-strength.ts`、`packages/shared/src/constants/gameplay/world.ts`、`packages/shared/src/content-display-name.ts`、`packages/shared/src/enhancement-cost.ts`、`packages/shared/src/formation-types.ts`、`packages/shared/src/mail.ts`、`packages/shared/src/map-groups.ts`、`packages/shared/src/name-visibility.ts`、`packages/shared/src/qi.ts`、`packages/shared/src/technique-arts-strength.ts`、`packages/shared/src/value.ts`。

### 斷言同步（47）

- `packages/client/scripts/verify-technique-preview.mjs`。
- `packages/server/src/tools/content-monster-spawn-smoke.ts`
- `packages/server/src/tools/instance-lease-sync-error-smoke.ts`
- `packages/server/src/tools/leaderboard-offline-snapshots-smoke.ts`
- `packages/server/src/tools/mail-runtime-durable-required-smoke.ts`
- `packages/server/src/tools/map-template-resource-node-smoke.ts`
- `packages/server/src/tools/market-heavenly-dao-shop-smoke.ts`
- `packages/server/src/tools/market-runtime-buy-now-smoke.ts`
- `packages/server/src/tools/market-transmission-smoke.assertions.ts`
- `packages/server/src/tools/player-display-name-smoke.ts`
- `packages/server/src/tools/sect-runtime-durable-reconciliation-smoke.ts`
- `packages/server/src/tools/technique-activity-task-view-smoke.ts`
- `packages/server/src/tools/technique-comprehension-smoke.ts`
- `packages/server/src/tools/technique-generation-initialization-smoke.ts`
- `packages/server/src/tools/technique-unification-platform-smoke.ts`
- `packages/server/src/tools/tongtian-tower-smoke.ts`
- `packages/server/src/tools/world-runtime-action-execution-smoke.ts`
- `packages/server/src/tools/world-runtime-alchemy-smoke.ts`
- `packages/server/src/tools/world-runtime-battle-engage-smoke.ts`
- `packages/server/src/tools/world-runtime-combat-action-service-smoke.ts`
- `packages/server/src/tools/world-runtime-combat-relation-smoke.ts`
- `packages/server/src/tools/world-runtime-context-actions-smoke.ts`
- `packages/server/src/tools/world-runtime-craft-smoke.ts`
- `packages/server/src/tools/world-runtime-damageable-tile-smoke.ts`
- `packages/server/src/tools/world-runtime-equipment-smoke.ts`
- `packages/server/src/tools/world-runtime-formation-smoke.ts`
- `packages/server/src/tools/world-runtime-gameplay-write-facade-smoke.ts`
- `packages/server/src/tools/world-runtime-instance-capability-guard-smoke.ts`
- `packages/server/src/tools/world-runtime-instance-read-facade-smoke.ts`
- `packages/server/src/tools/world-runtime-item-ground-smoke.ts`
- `packages/server/src/tools/world-runtime-loot-container-smoke.ts`
- `packages/server/src/tools/world-runtime-main-quest-singleton-smoke.ts`
- `packages/server/src/tools/world-runtime-mining-job-smoke.ts`
- `packages/server/src/tools/world-runtime-npc-shop-smoke.ts`
- `packages/server/src/tools/world-runtime-player-command-enqueue-smoke.ts`
- `packages/server/src/tools/world-runtime-player-command-smoke.ts`
- `packages/server/src/tools/world-runtime-player-movement-capability-smoke.ts`
- `packages/server/src/tools/world-runtime-player-view-query-smoke.ts`
- `packages/server/src/tools/world-runtime-progression-smoke.ts`
- `packages/server/src/tools/world-runtime-quest-list-view-smoke.ts`
- `packages/server/src/tools/world-runtime-quest-state-smoke.ts`
- `packages/server/src/tools/world-runtime-sect-smoke.ts`
- `packages/server/src/tools/world-runtime-technique-command-idempotency-smoke.ts`
- `packages/server/src/tools/world-runtime-tick-dispatch-smoke.ts`
- `packages/server/src/tools/world-runtime-tile-resource-item-durable-smoke.ts`
- `packages/server/src/tools/world-runtime-use-item-smoke.ts`
- `packages/server/src/tools/world-runtime-wallet-route-smoke.ts`

所有這些變更都只把既有 smoke/proof 的預期玩家字串同步為繁體，沒有改測試情境、輸入、斷言條件或玩法規則。

### 守衛工具（3）

- `scripts/check-traditional.mjs`：遞迴檢查插值模板表達式內的字串字面量，補齊 JSXText／插值盲點；模板結構文字仍不掃描。
- `scripts/check-traditional.scope.json`：把本次補漏的 client/shared 玩家文字來源加入既有固定掃描範圍。
- `scripts/sync-smoke-assertions.mjs`：先標記斷言字面量、再收集非斷言 fixture，修正舊實作把斷言本身誤視為 fixture 而靜默跳過的 no-op；另列出合法簡體 fixture／GM 鏡像字串排除項。

### 郵件雙表相容轉換（2）

- `packages/server/src/gm/compat-conversions/conversions/mail/mail-snapshot-traditionalize.ts`
- `packages/server/src/tools/mail-traditionalize-conversion-smoke.ts`

轉換管線從 `player_mail` 擴至 `player_mail_archive`，每表獨立備份表與 conversion marker；仍只更新 `sender_type='system'` 的 `title`、`body`、`sender_label`。非 system 行維持 byte-identical，archive 的 `archived_at` 不寫入。這是已接受的歷史系統郵件繁體化範圍補齊，不是新玩法、協議或一般資料遷移行為。

### 正則同步（3）

- `packages/server/src/runtime/world/command/world-runtime-pending-command.service.ts`
- `packages/server/src/runtime/world/world-runtime-navigation.service.ts`
- `packages/shared/src/monster.ts`

三者只把既有錯誤／名稱比對正則的簡體針改為對應繁體針，維持原有拒絕分類與怪物 tier 判定。

### 數值顯示（3）

- `packages/shared/src/display-number.ts`
- `packages/shared/scripts/check-display-number.cjs`
- `packages/client/scripts/prove-item-card-constellation-layout.mjs`

只轉換顯示後綴（例如 `万` → `萬`、`亿` → `億`）與其直接斷言／畫面 proof；數值截斷、單位門檻與排版邏輯未變。

## 教程 Markdown 真源判定

**確認為玩家內容真源，非開發文件違規。**

1. `rg 'tutorial-mechanics'` 命中 `scripts/sync-tutorial-mechanics.mjs`、根 `package.json` 的 `sync:tutorial-mechanics`，以及 shared build 前同步命令。
2. `scripts/sync-tutorial-mechanics.mjs:22` 將來源固定為 `docs/tutorial-mechanics.md`；`:33` 將目標固定為 `packages/shared/src/tutorial-mechanics.generated.ts`；`:236` 讀取 Markdown、`:247` 解析 topic、`:263` 寫入 generated TS。
3. `packages/shared/package.json:8` 的 `build` 先執行該同步器；`packages/shared/src/index.ts` 匯出 generated artifact。

因此 `docs/tutorial-mechanics.md` 的繁體化直接改變玩家教程面板的資料來源，符合玩家內容轉換範圍；它不屬 Must NOT #3 所指的開發／機制說明文件。

## 護欄覆核

| 護欄 | 結果 | 證據 |
| --- | --- | --- |
| content JSON 不改 ID／數值／公式 | PASS | 對基準 `14a49fd3^` 與 `7c174ec6` 做遞迴 JSON spot-check：`items/凡人期/材料.json` 69 個、`monsters/云来镇.json` 5 個、`quests/序章_主线.json` 57 個、`technique-buffs/练气期/术法/地阶.json` 1 個、`maps/bamboo_forest.json` 11 個差異葉子皆為 string；五檔均 `shape: []`、`nonString: []`。 |
| GM 面不轉換 | PASS | `git diff --name-only 14a49fd3^..7c174ec6 -- packages/client/src/gm.ts` 為 0 檔。 |
| 不動 docker-stack | PASS | `git diff --name-only 14a49fd3^..7c174ec6 -- ':(glob)docker-stack*'` 為 0 檔。 |
| 不新增玩法／locale 擴展 | PASS | 補查差異的非文字程式碼僅為 mail 相容轉換、守衛與正則同步；無玩法入口、協議、mechanics 變更。現行 `SUPPORTED_LOCALES` 與各 `SUPPORTED_CLIENT_LOCALES` 均唯一為 `['zh-TW']`。 |
| 固定繁體 scope | PASS | `node scripts/check-traditional.mjs --scope` 輸出 `{ "ok": true, "violations": [] }`，退出碼 0。 |

## 結論

前次的註解違規已實際消除；其餘工程必要改動屬明示接受集合。本次兩個 fix commits 沒有引入新的越界行為，教程 Markdown 經已驗證的同步鏈成為玩家可見內容。F4 可以核准。

VERDICT: APPROVE
