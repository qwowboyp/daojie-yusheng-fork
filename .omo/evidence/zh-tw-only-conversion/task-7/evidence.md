# Task 7 — zh-TW 字型堆疊（UI_TEXT_FAMILIES）驗證

日期：2026-08-19
狀態：已完成

## 變更內容

`packages/client/src/constants/ui/text.ts` `UI_TEXT_FAMILIES`（:12-18）：

| key | 追加字型（置於既有字型之後作為 fallback） |
|---|---|
| `body` | `'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC'` |
| `serif` | `'Noto Serif TC', 'PMingLiU'` |
| `brushWild` | `'DFKai-SB', 'BiauKai'` |
| `brushRegular` | `'DFKai-SB', 'BiauKai'` |

- `buildCanvasFont`（:155-160）以 `preset.family` 查 `UI_TEXT_FAMILIES` key，無需改動。
- 未改字重/字號/行高/排版邏輯；未引入任何 webfont / @font-face / 新依賴（純系統字型 fallback 鏈）。

## 驗證結果

1. `pnpm --filter @mud/client exec tsc --noEmit` → **exit 0**
2. `rg "Microsoft JhengHei|PingFang TC|Noto Sans TC|Noto Serif TC|PMingLiU|DFKai-SB|BiauKai" packages/client/src/constants/ui/text.ts` → 7 個名稱全部命中
3. `git diff packages/client/src/constants/ui/text.ts` → 僅 4 行 family 陣列變更（brushWild / brushRegular / body / serif），monospace 與其他邏輯未動

## 已知限制：書法字型（brush）傳統字形覆蓋

- `brushWild`（Zhi Mang Xing 之芒行書）與 `brushRegular`（Ma Shan Zheng 馬善政楷書）皆為**簡體書法字型**，
  對傳統漢字（zh-TW 轉換後）字元覆蓋不完整。轉繁後書法風格文字可能**逐字 fallback 造成混排**
  （部分字用書法、部分字落到後續 fallback 字型）。
- 已追加系統標楷體 fallback：`'DFKai-SB', 'BiauKai'`（僅系統字型，無下載成本），可緩解缺字混排，但視覺上書法筆意會在中間斷裂。
- **待 F3 視覺 QA**：本機未執行瀏覽器截圖驗證（需要起服務端 + 客戶端並登入才能看到實際書法字渲染；超出本 todo 範圍）。
  若 QA 時發現書法字混排嚴重，需使用者決策（例如：接受混排、書法字型僅保留簡體文案場合、或引入繁體書法 webfont——後者違反本計畫「不引 webfont」紅線，須另行評估）。

## 2026-08-22 線上書法字抽樣（redeploy 7c174ec6）

- 截圖：`brush-sample.png`（登入頁標題，與 final-wave/redeploy-regression/01-login-page.png 同一幀）
- 文案：登入標題「道劫餘生」（`餘` 為繁體；簡體為 `余`）
- 字型鏈：`brushWild` = Zhi Mang Xing → DFKai-SB / BiauKai
- **判定：acceptable**。四字筆畫粗細、墨色、行書傾斜一致，未見「前三字書法 + 餘字標楷」的明顯混排斷裂。`餘` 即使走系統楷體 fallback，在此字級下與之芒行書並排仍可接受。
- 不需使用者決策。已知限制仍在：更生僻的繁體字（境界長描述、罕見詞）仍可能逐字 fallback；本次只驗登入標題。
