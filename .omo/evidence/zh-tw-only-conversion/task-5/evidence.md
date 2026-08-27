# Task 5 Evidence — client 玩家面硬編碼字面值轉繁

日期：2026-08-19
範圍：`packages/client/src` 玩家可見硬編碼簡體字面值 → 台灣繁體
工具：`scripts/convert-to-traditional.mjs`（source 模式 AST）+ `.omo/convert-templates.mjs`（插值模板補完）

## 執行摘要

1. **白名單 30 檔批量轉換**（todo-1 轉換器 source 模式）：22 檔寫回、8 檔無差異
   （minimap.ts / renderer/text.ts / selection-preserver.ts / constants/ui/{inventory-panel,market,attr-panel,chat}.ts 無 StringLiteral 差異）。
2. **插值模板補完**（`${}` TemplateExpression，428 處）：`.omo/convert-templates.mjs` 精確 AST 改寫
   ——只轉 head.text / span.literal.text 靜態文字 + 插值內 StringLiteral，不動 `${expr}` 其他內容。
3. **PLUS 掃描**（rg `escapeHtml(|textContent=|placeholder=|title=|aria-label=` + CJK）：69 候選中 34 檔
   含簡體殘留 → 全部轉換（267 處插值模板補完）。
4. **人工修正殘留**（nested TemplateExpression 的 literal 段漏網）：
   - `social-panel.ts:1575` 當前页 → 當前頁
   - `craft-alchemy-view.ts:851` 等级 → 等級
   - `craft-enhancement-view.ts:831` 首阶 → 首階（+ 693/710/756/829 當前 +）
   - `market-browse-view.ts:115,141,299` 卖 → 賣、剩余 → 剩餘
   - `inventory-bulk-discard-dialog.ts:149` 当前 → 當前
5. **保留不轉**：`action-panel.ts:1356` `<!-- 点击档位按钮 -->`（HTML 註解，規範不轉註解）。

## 驗證結果

| 驗證 | 結果 |
|---|---|
| convert dry-run 64 檔 | `待轉換 0 個` |
| check-traditional 64 檔 | `{"ok":true,"violations":[]}` exit 0 |
| 插值模板掃描（scan-template-cjk） | 僅 1 個 HTML 註解（保留） |
| `pnpm --filter @mud/client exec tsc --noEmit` | **被 todo-3 斷裂阻擋**（見下） |
| 換回 HEAD 版 i18n.generated.ts（雙語）後 tsc | **exit 0 全綠**（證明本 task 57 檔零型別錯誤） |
| `pnpm verify:client` | build:client 卡在 todo-3 斷裂（見下） |
| GM surfaces（gm.ts/gm-map-editor/gm-world-viewer/gm-panel/prototype） | **零觸碰**（git diff 清單 0 命中） |
| `*.generated.*` | 未手改；i18n.generated.ts + 5 catalog 為 todo-2/3 重生成物 |

## ⚠ verify:client / tsc 被 todo-3 半完成狀態阻擋（非本 task 缺陷）

並行 wave 中 todo 3（CSV 轉繁+管線單語系化）已在 working tree 留下半完成狀態：

- `packages/client/scripts/generate-i18n.mjs` 已改為單語系 zh-TW（103 行 diff）
- prebuild 執行 `generate:i18n` → 重生成 `i18n.generated.ts` 為 `SUPPORTED_CLIENT_LOCALES=['zh-TW']`
- 但 `src/ui/i18n.ts:31` 的 `getLanguagePreference()` 型別仍是 `'zh-CN'|'zh-TW'`（todo 6 才收斂）
  → TS7053：`Property 'zh-CN' does not exist on type 'Record<"zh-TW", ...>'`

**證據**：手動把 i18n.generated.ts 換回 HEAD 雙語版 → `tsc --noEmit` exit 0（全專案零錯誤，
本 task 57 檔無一錯誤）；還原 todo-3 版後 verify:client 在 build:client 的 tsc 失敗，與本 task 無關。

**todo 3 完成（i18n.ts 收斂或雙語生成恢復）後，verify:client 應可全綠。**

## 檔案統計

- 本 task 變更：57 檔（白名單 22 檔寫回 + 34 檔 PLUS + 1 檔手動修正 social-panel）
- 插值模板補完：428 + 267 = 695 處
- 未動：server/**、shared/**（除 verify 觸發的 tutorial-mechanics.generated.ts 重生成）、
  config-editor/**

## 證據檔

- convert-write-batch1.log / convert-write-batch2.log — 批量轉換報告
- convert-templates-batch1.log / convert-templates-batch2.log — 插值模板補完報告
- final-guard-64files.json — check-traditional ok:true
- verify-client-todo3-blocked.log — verify:client 失敗（todo-3 斷裂）
- tsc-head-i18n-exit0.log — HEAD-i18n 替換後 tsc exit 0
- gm-surfaces-touched.txt — 0 bytes（GM 面零觸碰證明）
- changed-client-files.txt — 61 檔 client/src 非 generated 變更
