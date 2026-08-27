# F1 Plan Compliance Audit — zh-tw-only-conversion

**日期：** 2026-08-20  
**結論：REJECT**

計畫 `.omo/plans/zh-tw-only-conversion.md` 的 implementation todos 尚未全數滿足驗收條件。當前 guard 綠燈，但它不能覆蓋郵件封存表遺漏，也不能取代 Todo 7 要求的書法字型抽樣截圖。

## 審計方式

- 已讀計畫、notepad 與 task evidence。
- 已檢查關鍵工具、scope、單語系設定、字型設定、GM 轉換與 smoke 原始碼。
- 已執行唯一允許的即時驗證：`node scripts/check-traditional.mjs --scope`。
  - 結果：`{"ok":true,"violations":[]}`。
- 未執行 build、`verify:*` 或資料庫驗證鏈；本審計不重跑完整驗證。

## Todo 逐項結果

| Todo | 計畫 checkbox | 判定 | 證據 / 結論 |
| --- | --- | --- | --- |
| 1 工具 | `[x]` | PASS | `convert-to-traditional.mjs`、`check-traditional.mjs`、`lib/tw-vocabulary.mjs`、`convert-exclude-fields.json` 均存在；根 `package.json:69` 有 `typescript`。詞彙表、AST、U+FFFD 與 `char` 排除已落地。task-1 evidence 完整。 |
| 2 內容 | `[x]` | PASS | task-2 的結構比較記錄為 `structuralChanges:0`、`textFieldsChanged:3131`、`excludedFieldsUnchanged:true`；notepad 記錄 content 93 + maps 40、U+FFFD 為 0。現行 scope guard 已覆蓋兩資料目錄且綠燈。 |
| 3 i18n | `[x]` | PASS | task-3 證據記錄 3967 列由 `zh-CN.csv` 轉為 `zh-TW.csv`、placeholder mismatch 為 0、overrides 已刪。`generate-i18n.mjs:17-19,166-174` 是單一 `zh-TW` 管線。 |
| 4 server 玩家文案 | `[x]` | PASS | task-4 證據記錄 6 個通知 key 已生成；現行 scope 包含 server 玩家面白名單，guard 綠燈。後續 task-10 亦修正登入 HTTP 玩家訊息遺漏。 |
| 5 client 玩家文案 | `[x]` | PASS | task-5 初版被平行 todo 3 阻斷；task-10 已補 JSXText 與 36 個白名單外檔案，scope 從 280 擴為 318，現行 guard 綠燈。 |
| 6 雙語層移除 | `[x]` | PASS | task-6 證據確認 catalog、overrides、語言切換與儲存鍵已移除。`content-name-locale.ts:20-40` 直接回傳 server fallback；`storage.ts:29,35` 收斂為 `['zh-TW']` / `'zh-TW'`。 |
| 7 字型 | `[x]` | **FAIL** | TC fallback 已在 `text.ts:13-16` 存在。但 task-7 acceptance 明定「brush 混排抽樣截圖存 evidence」；`task-7/evidence.md:26-32` 明載未執行截圖、待 F3，task-7 目錄亦無截圖。此驗收項未完成。 |
| 8 GM 系統郵件轉換 | `[x]` | **FAIL** | `mail-snapshot-traditionalize.ts:39-41` 只定義 `player_mail` 與其單一備份表；`loadMailRows()` (`:266-274`)、`ensureBackupTable()` (`:343-354`)、殘留掃描 (`:425-446`) 都只操作 `player_mail`。計畫要求同時轉換 `player_mail` **及** `player_mail_archive`，並為 archive 建立備份/驗證；現行實作與 smoke 均未處理 archive。另計畫要求的 `.omo/evidence/zh-tw-only-conversion/task-8/` 目錄不存在。 |
| 9 guard + 全量驗證 | `[~]` | CONDITIONAL | scope 檔存在，root `package.json:23-24` 已把 `--scope` 接入 `verify:quick`、`verify:client`，即時 guard 綠燈。checkbox 是 `[~]`，因本機未執行 `verify:release:with-db`。本計畫允許以 LXC GM 實測補強，但該實測只覆蓋 `player_mail`，不能補足 Todo 8 的 archive 漏項。 |
| 10 部署 | `[x]` | PASS（限已部署 `player_mail` 範圍） | task-10 evidence 有雙 image、rollback tags、`/health` / `/live` 200、無新增 WARN、dry-run → apply → 冪等與 residual=0、四張線上抽樣截圖。但郵件轉換的線上證據只涵蓋單筆 `player_mail`。 |

## 阻擋項

1. **Todo 8 功能缺口：`player_mail_archive` 未轉換。**
   - 違反計畫 Scope:29、Todo 8:170-173。
   - 現行 conversion 只讀寫 `player_mail`；archive 系統郵件可保留簡體，違反「玩家信箱裡的舊郵件全部以繁體顯示」目標。
   - `mail-traditionalize-conversion-smoke.ts` 只建立/驗證 `player_mail`，未能保護 archive 行為。

2. **Todo 7 證據缺口：未保存 brush 字型抽樣截圖。**
   - 計畫 Todo 7 的 acceptance 要求已明確，現有 evidence 明載該檢查尚未做。

3. **Todo 8 證據目錄缺失。**
   - 計畫 Verification strategy:47 要求每個 todo 使用 `task-<N>/` evidence；evidence 根目錄只有 task-1 至 task-7、task-9、task-10，沒有 task-8。

## 解除 REJECT 所需最小修正

1. 擴充 `MailSnapshotTraditionalizeConversion`：對 `player_mail_archive` 以同一 `sender_type='system'`、三欄轉換、CAS、skip hash、殘留檢查、冪等 marker 與獨立備份表執行；更新 DB smoke 覆蓋 active + archive。
2. 在 `task-8/` 補存 compile、詞彙一致性 smoke、資料庫 smoke、Nest dry-run/apply endpoint 接線的可追溯證據。
3. 產生並存入 `task-7/` 的 brush 繁體標題截圖，標記可接受或需使用者決策。
4. 重新執行受影響的 with-db smoke 與 LXC dry-run → apply → 冪等 → archive residual 回讀；更新 Todo 9 的狀態與證據後再送 F1。

## 附註

- 本次 REJECT 不否定 guard 的有效性：現行 scope guard 已通過。
- `verify:release:with-db` 的本機不可用是已知環境限制；它不是本 verdict 的唯一理由。即使接受此例外，archive 未實作與 Todo 7 截圖缺失仍足以拒絕。
