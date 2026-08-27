# F4 — 範圍忠實度稽核

**裁決：REJECT**

稽核範圍：`14a49fd3^..43739e75`（計畫實作提交 1–9 與補漏提交）。

資料文字轉換本身未改 JSON 結構、非字串值、ID 或排除欄位；但提交範圍包含未列入計畫、且非文字轉換的執行行為與 UI 版面變更，並新增繁體註解。這違反「只動文字值」與「註解維持簡體」邊界，不能通過 F4 核准門檻。

## 阻擋項目

1. **非文字、非計畫行為變更**
   - `packages/server/src/app.module.ts:273`：`ConfigModule.forRoot()` 新增 `envFilePath: []`，改變伺服器載入 `.env` 的執行期行為。
   - `packages/client/src/styles/responsive.css:906`：手機版 `.building-mode-toolbar` 由既有定位改為 `position: fixed`，改變營造模式工具列的視口錨定與版面行為。
   - `packages/server/src/tools/process-supervisor-smoke.ts:89`：退出碼斷言由僅接受 `0` 改為同時接受 `null`，改變 smoke 的通過語義。
   - `packages/server/package.json`：`compile` 與三個 audit/proof script 改變 TypeScript 解析與跨平台執行流程。
   - 這些變更出現在 `82fb101d` 與 `43739e75`，不屬於計畫列出的文字、單語系、GM 系統郵件或 guard 工作。

2. **註解未維持簡體**
   - `packages/server/src/app.module.ts:271-274` 新增繁體註解。
   - `packages/client/src/styles/responsive.css:906-907` 新增繁體註解。
   - 計畫 Must NOT #3 要求「不轉代碼註解、JSDoc、內部 log 訊息」，並要求註解維持簡體；上述非必要繁體註解違反此邊界。

3. **額外範圍檔案**
   - `82fb101d` 新增 `packages/client/AGENTS.md`、`packages/config-editor/AGENTS.md`、`packages/server/AGENTS.md`、`packages/shared/AGENTS.md`。
   - 其中 `packages/config-editor/AGENTS.md` 不屬計畫中允許的 config-editor UI 範圍。此項不是主阻擋原因，但證明提交不只含計畫工作。

## Guardrail 矩陣

| # | Guardrail | 結果 | 稽核證據 |
| --- | --- | --- | --- |
| 1 | 不改 ID / 數值 / 公式 / 協議語義 / 機制，只動文字值 | **REJECT** | 116 個有變更的 content/maps JSON 比對結果：`nonTextOrExcludedViolations: []`、`idFieldViolations: []`；協議檔案 diff 為 0。但上列 `app.module.ts`、responsive CSS、smoke 與 package scripts 是非文字行為變更，違反「只動文字值」邊界。 |
| 2 | 不改簡體檔名與目錄名 | PASS | `练气期/材料.json` 與 `青竹林.json` 在基準與 HEAD 均存在；name-status 僅有計畫允許的 `zh-CN.csv` 刪除與 `zh-TW.csv` 新增。 |
| 3 | 不轉註解 / JSDoc / 內部 log / `docs/` | **REJECT** | `app.module.ts:271-274`、`responsive.css:906-907` 加入繁體註解。`rg` 亦確認 GM 面既有簡體註解與文案仍在。 |
| 4 | GM 硬編碼 UI 維持簡體（CSV `gm.*` 例外） | PASS | `rg` 命中 `packages/client/src/gm.ts` 的「错误／服务器／创建／关闭」等既有簡體文案；git diff 未修改 `gm.ts`、`gm-*.ts`、`react-ui/prototype/` 或 `runtime/gm/`。`native-gm.controller.ts` 僅有計畫要求的 GM 相容轉換接線。 |
| 5 | 不轉玩家自輸入內容 | PASS | 系統郵件轉換實作限定 `sender_type = 'system'`，範圍僅 `title`、`body`、`sender_label`；非 system 列走跳過與 byte-identical 驗證。 |
| 6 | 不轉 DB 技能快照 | PASS | `packages/server/src/gm/compat-conversions/conversions/technique/` 在稽核範圍 diff 為 0；郵件轉換明列排除 skill snapshot。 |
| 7 | 不動 docker-stack | PASS | `git diff --name-only 14a49fd3^ 43739e75 -- ':(glob)docker-stack*'` 計數為 0。 |
| 8 | 不新增玩法 / 不做多語系擴展 | PASS | 未發現新玩法或 `en` locale；`SUPPORTED_LOCALES` 與 `SUPPORTED_CLIENT_LOCALES` 都是唯一 `['zh-TW']`。手機工具列定位屬非計畫 UI 行為變更，已列入阻擋項目 1。 |
| 9 | 轉換工具偵測 U+FFFD | PASS | `findReplacementChar()` 定位 U+FFFD 行列；`readFileChecked()` 發現後直接拋錯並拒絕轉換。`node scripts/check-traditional.mjs --scope` 輸出 `{ "ok": true, "violations": [] }`；轉換後 data 與 i18n 路徑 U+FFFD 搜尋為 0。 |

## 結論與解鎖條件

移除或獨立處理上述非文字行為變更、繁體註解與未計畫 AGENTS 文件；保留已驗證的資料與 GM 邊界後，重新執行 F4 稽核。未完成前，本計畫不能宣告最終通過。
