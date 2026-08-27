# F2 程式碼品質審查：zh-tw-only-conversion

## 裁定：REJECT

審查範圍：`14a49fd3`、`e660e716`、`c474fcce`、`0e88c3d0`、`37c37ba1`、`21b74b6b`、`a388a3db`、`82fb101d`、`43739e75`。

阻擋原因是 smoke 斷言同步尚未完成，且同步器本身無法正確區分 fixture 與 assertion 字串。這會留下已轉繁的生產訊息與簡體 assertion 不一致的失敗案例，違反計畫要求的全鏈綠燈與同步斷言語意。

## 阻擋問題

### 1. `sync-smoke-assertions.mjs` 對字串 assertion 的 fixture 判定失效

- 位置：`scripts/sync-smoke-assertions.mjs` 的 `collectAssertionLiterals()`；fixture 預掃在第 136–144 行，後續 `pushStringLiteral()` 以 `fixtureValues.has(raw)` 跳過字串。
- 問題：預掃遞迴收集了**所有** `StringLiteral`，沒有排除 assertion 節點；故 assertion 預期值本身也必然進入 `fixtureValues`，接著被當成 fixture 跳過。結果：工具可處理 RegExp literal，但不能可靠改寫待同步的 StringLiteral assertion。
- 影響：工具宣稱同步 assertion，卻對一整類核心輸入靜默不做事；不能作為繁簡斷言同步保證。
- 修正方向：預掃僅收集經 `insideAssertArgs`／assert-call 判定為非 assertion 的字串，或改為先收集 assertion span，再排除該 span。

### 2. 斷言同步未完整套用，存在可重現的生產／smoke 文案失配

- 證據：`node scripts/sync-smoke-assertions.mjs --dir packages/server/src/tools --dry-run` 回報 **29 檔、80 處**待轉換。
- 可重現案例：
  - `packages/server/src/tools/sect-runtime-durable-reconciliation-smoke.ts:671` 仍匹配 `/宗门持久化连接池不可用/`，生產端已拋出 `宗門持久化連接池不可用`。
  - `packages/server/src/tools/tongtian-tower-smoke.ts` 仍期望 `你进入通天塔第 1 层。`，生產輸出為 `你進入通天塔第 1 層。`。
- 影響：已轉繁的生產文案會令 smoke assertion 失敗；這不是可接受的測試資料差異，因為它們是生產訊息的鏡像期望值。
- 修正方向：先修正同步器的 fixture 判定，再以明確檔案清單套用 `--write`；逐一保留資料 lookup key／GM 例外，並對受影響 smoke 做最小驗證。

## 逐區品質評估

| 區域 | 結果 | 評估 |
|---|---|---|
| Guard：`check-traditional.mjs`、scope | PASS（非阻擋） | `--scope` 覆蓋 318 個白名單 source 檔；JSON／CSV／source 分流、U+FFFD 攔截、受保護詞遮罩均符合設計。`ts.isJsxText` 分支會 trim 空白後檢查，能攔截 `<button>一鍵丟棄</button>` 類文字，沒有 JSXText 盲點。注意：此 guard 是簡繁字形偵測，無法偵測字形相同但偏大陸用語的詞。 |
| Converter：`convert-to-traditional.mjs`、詞表 | PASS（有小缺陷） | 先詞級最長匹配、再 OpenCC 字級轉換；`char`、`tags`、`tagGroups` 等排除欄位和巢狀陣列處理合理。`isKey` 第 227–229 行對 `"key" : value` 的空白冒號形式誤判；本庫 JSON 不使用該格式，屬潛在問題。`pending` 回傳後未使用、CSV parser 重複，均非阻擋。 |
| GM 郵件 conversion／Nest 接線 | PASS（有小缺陷） | 只處理 `sender_type='system'`、CAS 使用 `IS NOT DISTINCT FROM`、交易包覆、備份表、殘留回讀、skip hash、audit 與 dry-run/apply 接線完整。`mail-snapshot-traditionalize.ts:209` 註解聲稱 CAS 漂移會「回滾全部」，實作卻記錄失敗並提交部分成功；行為可重試但註解不實。`normalizeSafeInteger` 為未使用死碼。 |
| Server：`app.module.ts`、native player auth | PASS | `envFilePath: []` 明確避免本專案 `.env` 為目錄導致 EISDIR，使用既有 `NATIVE_HTTP_PROVIDERS` spread 接線；玩家認證錯誤訊息已轉繁，未見 `as any`、忽略註解或空 catch 新增。 |
| Client：Panels、responsive CSS | NEEDS FOLLOW-UP | JSX 可見文字已補上繁體；mobile `.building-mode-toolbar` 在 `responsive.css:905-916` 改 `position: fixed`，維持 safe-area 和桌面 base 規則。`InventoryPanel.tsx:124` 的 fallback 仍為 `搜索物品`；字形不是簡體，guard 不會攔截，但與「台灣繁體」用詞目標不一致，應改為 `搜尋物品` 或移除 fallback。 |
| i18n：`generate-i18n.mjs` | PASS | 單一輸入 `zh-TW.csv`、單一 `SUPPORTED_CLIENT_LOCALES=['zh-TW']`、key／重複 key／欄位／占位符格式檢查、穩定排序和冪等輸出均合理。 |

## 反模式／scope

- 未在審查的產品變更中發現新增 `@ts-ignore`、`@ts-expect-error`、`as any`、TODO/FIXME/HACK placeholder 或熱路徑 `console.log`。
- `git diff --check 14a49fd3^..43739e75` 無輸出，沒有 whitespace error。
- 範圍外但隨計畫提交的變更包括 `packages/server/src/app.module.ts`、`packages/server/src/tools/process-supervisor-smoke.ts`、`packages/client/src/styles/responsive.css` 及 `packages/{server,shared,config-editor}/AGENTS.md`。前兩項修復本機驗證環境／Windows 行為，CSS 修復 client proof；均有工程理由，但未列於原始文字轉換 scope。F4 應確認是否接受這些例外。

## 重新送審條件

1. 修正 `sync-smoke-assertions.mjs`，使 fixture 排除不會吞掉 assertion 字串。
2. 對 29 檔／80 處逐一同步，只轉換生產文案鏡像 assertion，不轉 lookup key、fixture 或 GM 例外。
3. 修正 `InventoryPanel.tsx:124` 的台灣用詞 fallback。
4. 更正 GM conversion 的 CAS 漂移註解，刪除未使用 helper；或明確記錄保留理由。
5. 重新進行 F2 審查；不要求在本審查中執行完整驗證鏈。
