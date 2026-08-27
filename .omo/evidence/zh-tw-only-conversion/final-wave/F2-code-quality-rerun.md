# F2 Code Quality Re-run — `7c174ec6`

審查範圍：`7c174ec6`（79 檔、+1762/-1409）。僅讀取與審查；未修改產品檔、未執行建置/編譯/驗證鏈、未提交。

## 前次阻塞項驗證

1. **assertion fixture 預掃**：`scripts/sync-smoke-assertions.mjs:217-300` 已採三階段流程：先標記 assertion literal 節點、再收集未標記 fixture、最後轉換已標記節點。此修復排除了「assertion 自身被 fixture 預掃吞掉」的原缺陷。
   - 執行：`node scripts/sync-smoke-assertions.mjs --dir packages/server/src/tools --dry-run`
   - 結果：`共掃描 523 個文件，0 個有斷言轉換，共 0 處（dry-run，未寫盤）`。
   - 已確認指定手修案例仍存在：`sect-runtime-durable-reconciliation-smoke.ts` 的 `/宗門持久化連接池不可用/`，以及 `tongtian-tower-smoke.ts` 的 `你進入通天塔第 1 層。`。
2. **Inventory 搜尋 placeholder**：`packages/client/src/react-ui/panels/inventory/InventoryPanel.tsx:124` 為 `搜尋物品`。
3. **CAS 註解 / dead code**：`mail-snapshot-traditionalize.ts` 已移除 `normalizeSafeInteger`。但 CAS 實作與提交前的全量回滾語義產生新的阻塞問題，詳見下節。

## 新增程式品質

- **雙表郵件轉換**：`MAIL_TABLE_DESCRIPTORS` 正確封裝 `player_mail` / `player_mail_archive`，`hasUpdatedAtColumn` 僅讓 active 表寫入 `updated_at`；archive 表不碰 `archived_at`。smoke fixture 覆蓋兩表、跳過行 byte-identical、archive timestamp 與二次冪等。
- **TemplateExpression guard**：`scripts/check-traditional.mjs:201-208` 對 `TemplateExpression` 使用 `ts.forEachChild(node, visit)`。template head/middle/tail 不符合文字節點檢查分支，插值 expression 中的 `StringLiteral` 會被走訪；不會把模板結構文字誤判。
- **pending-command regex**：matcher 與 producer 字串形狀一致：`妖獸不存在：<id>`、`背包物品不存在：<id>`、`實例 <instanceId> 中沒有可用出生點`。`isNoSpawnPointFailure` 的完整錨定形狀與 `map-instance.runtime.ts` producer 相符；前兩者採 prefix，保留內部 ID 任意字串。
- **display-number**：四位進制單位與門檻不變；只將玩家可見 suffix 轉為繁體，包含 `萬`、`億` 與更高單位。無數值行為變更。
- **新增反模式**：commit 新增行掃描未發現 `as any`、`@ts-ignore`、`@ts-expect-error`、`@ts-nocheck`、`console.log` 或空 `catch {}`。OCR 對 77 檔完成部分審查；其餘回報均為非阻塞可維護性建議或已知 fixture/排除情境。

## 阻塞問題

### [BLOCKER] CAS 漂移會提交部分雙表轉換，卻回傳 `ok: true`

**位置：** `packages/server/src/gm/compat-conversions/conversions/mail/mail-snapshot-traditionalize.ts:334-344`。

`convertSingleTable()` 遇到 CAS `rowCount !== 1` 時，只遞增 `result.failedRows`、記錄 error，並 `continue`。外層 `run()` 隨後仍寫 marker 並在 `:253` 執行 `COMMIT`；`createEmptyResult()` 的 `ok: true` 沒有因 `failedRows` 轉為 `false`。

結果：並發寫入造成任一行漂移時，其他 active/archive 行仍會永久轉換；GM 呼叫端拿到 `ok: true`，但資料已是部分套用狀態。這違反此修復聲稱的「單事務整體 ROLLBACK」與兼容轉換應有的全有或全無資產/資料安全邊界。

**修復要求：** CAS 漂移、跳過行 byte 驗證失敗或 residual simplified rows > 0 必須 throw，使外層 `catch` rollback 整批兩表，並令結果 `ok: false`；或明確重設為受支援的 partial-apply 協議、持久化逐行狀態與可恢復機制。前者符合既有全量回滾語義。

## 結論

唯一阻塞項為 CAS 漂移時的部分提交；其餘指定修復已驗證。

VERDICT: REJECT
