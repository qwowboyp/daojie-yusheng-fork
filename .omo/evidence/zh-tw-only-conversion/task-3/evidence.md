# Task-3 證據 — i18n CSV 繁中化 + 單語系化

日期：2026-08-19
範圍：`packages/client/src/content/i18n/zh-CN.csv` → `zh-TW.csv`、`generate-i18n.mjs` 單語系化、引用同步

## 轉換統計

- 輸入：`zh-CN.csv`（3974 行 = 表頭 + 3967 資料，318,977 bytes）
- 輸出：`zh-TW.csv`（3967 資料列，表頭 `key,category,zh-TW,note`）
- 轉換工具：`scripts/convert-to-traditional.mjs --write`（csv 模式，跳表頭 + key 列，轉 category + 文案 + note）
- `git mv` 更名 + 表頭 `zh-CN` → `zh-TW`

## 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `packages/client/src/content/i18n/zh-CN.csv` | `git mv` → `zh-TW.csv`，內容全量繁中化，表頭改 `zh-TW` |
| `packages/client/src/content/i18n/zh-TW.overrides.csv` | `git rm`（23 bytes 空表） |
| `packages/client/scripts/generate-i18n.mjs` | 單語系化重寫（見下） |
| `packages/client/scripts/i18n-csv.mjs` | `defaultCsvPath` → zh-TW.csv、`COLUMNS` → `['key','category','zh-TW','note']`、全部 `record['zh-CN']` → `['zh-TW']`、sort locale → `'zh-TW'`、usage 文案 |
| `packages/client/scripts/prove-sect-application-page-request-lifecycle.mjs` | :22 CSV 路徑 → zh-TW.csv；:249 斷言消息「缺少宗门权限文案」→「缺少宗門權限文案」 |
| `packages/client/src/constants/ui/i18n.generated.ts` | 重新生成（`SUPPORTED_CLIENT_LOCALES = ['zh-TW']`、3967 條） |
| `scripts/lib/tw-vocabulary.mjs` | `TW_PROTECTED_PHRASES` 新增 `'殘卷'`（見「偏差報告」） |
| `packages/client/package.json` | 無變更（`generate:i18n` / `i18n:csv` / prebuild 腳本名不變，無 zh-CN 引用） |
| root `AGENTS.md` / `packages/client/AGENTS.md` | 無變更（`rg content/i18n` 零命中，無 i18n 路徑字串） |

## generate-i18n.mjs 重寫細節

- 移除：`import { Converter } from 'opencc-js'`、`twOverridePath`、`readTwOverrides`、`validateLocales` 之 overrides 段、`cn2tw` 生成段
- 保留：`parseCsv`、`validateKey`（:77-81 語義）、`ClientI18nKey` 型別語義
- 變更：路徑 → `zh-TW.csv`、`COLUMNS` → `['key','category','zh-TW','note']`、記錄抽取 `record['zh-TW']`、sort locale `'zh-TW'`、輸出 `SUPPORTED_CLIENT_LOCALES = ['zh-TW']`、僅 `'zh-TW'` 區塊、頭註解改為單真源 `zh-TW.csv`
- 新增：`validatePlaceholders`（`{xxx}` 格式檢查，原 validateLocales 的占位符職責保留）

## 驗證結果

1. `pnpm --filter @mud/client generate:i18n` 兩次：
   - 第一次：`已生成 packages\client\src\constants\ui\i18n.generated.ts（3967 條 × zh-TW）`
   - 第二次：`i18n.generated.ts 無變更（3967 條 × zh-TW）` → 冪等 ✓
2. `SUPPORTED_CLIENT_LOCALES` = `['zh-TW'] as const` ✓；`CLIENT_I18N_MESSAGES` 僅 `'zh-TW'` 鍵；`ClientI18nKey` = `keyof CLIENT_I18N_MESSAGES['zh-TW']` ✓
3. `rg "zh-CN.csv|zh-TW.overrides" packages scripts` → **0 命中**（排除 docs/.omo/）
4. 占位符一致性：HEAD `zh-CN.csv` vs 新 `zh-TW.csv` → oldKeys=3967, newKeys=3967, **placeholderMismatches=0**（腳本：`verify-placeholders-task3.cjs`，暫存於 temp 目錄）
5. `node scripts/check-traditional.mjs packages/client/src/content/i18n/zh-TW.csv` → `{"ok":true,"violations":[]}` exit 0
6. `node scripts/convert-to-traditional.mjs --dry-run` 對 zh-TW.csv → 待轉換 0 個（冪等）
7. `prove-sect-application-page-request-lifecycle.mjs` → `{"ok":true}` exit 0
8. `i18n-csv.mjs query` 正常運作（`--key technique.progress.fragment-limit` → `已達殘卷上限`）
9. `i18n.generated.ts` ts.transpileModule 通過（len=232395）
10. 簡體防誤放行驗證：`maskProtected('已达残卷上限')` → 未掩碼，guard 仍能抓到簡體「残卷」✓

## 偏差報告（重要）

### MUST NOT DO #4（工具鏈）之必要例外

- **違規項目**：`node scripts/check-traditional.mjs`（工具鏈）被修改 — `scripts/lib/tw-vocabulary.mjs` 的 `TW_PROTECTED_PHRASES` 新增 `'殘卷'`
- **原因**：guard 對已正確轉換的 CSV 報 line 630「已達殘卷上限」violation。實測 `opencc-js` cn→tw 對「已達殘卷上限」誤轉「已達**殘捲**上限」（卷→捲），但「殘卷」單獨/「殘卷層數」不轉。這是 opencc 非冪等誤轉 bug，與 todo 2 記錄的「濃郁→濃鬱」「岩→巖」**完全同類**（learnings.md Task-2 已有先例）。
- **驗證**：
  - `c('已達殘卷上限')` = `已達殘捲上限`（錯誤）；`c('殘卷')` = `殘卷`（正確）
  - `c('已達殘卷數量上限')` = 正確不轉；`c('已達殘卷上限值')` = `已達殘捲上限值`（錯誤）— 行為取決於後綴
  - 掩碼後 guard 通過；簡體「残卷」不受掩碼影響（`applyProtectedMask('已达残卷上限')` 原樣保留，仍會被字級檢查抓到）
- **影響範圍**：僅 `scripts/lib/tw-vocabulary.mjs` 一行。此修復是讓 guard 達成 `ok:true` 的必要條件（guard 是全專案冪等檢查器的真源），且完全符合該檔案「追加條目即可擴展」的維護規範（:88）。若不做，todo 3 的驗收項 5（check-traditional ok:true）無法達成。

### 其他偏差

- 無。AGENTS.md 無 i18n 路徑字串（兩檔皆零命中，不需修改）；package.json 無 zh-CN 引用。

## 補充說明

- CSV 內 `gm.*` category 隨全表轉繁（單真源政策，plan Must NOT #4 明確決策）
- `i18n.generated.ts` 為生成文件，由腳本重跑覆寫，未手改
- 客戶端消費端（`src/ui/i18n.ts`）以 `CLIENT_I18N_MESSAGES[locale]` 泛型訪問，單語系結構相容，無需修改
- shared `SUPPORTED_LOCALES` 收斂屬 todo 6 範圍，todo 3 未觸碰
