# 道具與自建建築美術

圖片以內容 ID 對應，不用名稱、價格、字形或道具實例 ID 猜測外觀。

## 來源與製作方式

- 道具名稱與介紹取自 `packages/server/data/content/items/` 的 301 個模板。
- 建築定義取自 `packages/server/data/content/building-runtime/buildings.json`。定義沒有獨立介紹欄位，因此依建築機制、功法機制、材料與用途製作十種建築的介面圖示及地面視角。
- 使用內建 ImageGen。已完成的單張素材保留沿用；其餘道具集中成每張最多 36 格的 6 × 6 圖集，剩餘六種設施的兩種視角集中成 4 × 3 圖集。
- `atlases/*.webp` 是可檢視的圖集；同名 JSON 保存完整提示詞、逐格道具介紹、順序、尺寸與來源雜湊。`item-icons-v1.json`、`building-art-v1.json` 保存每件產物的來源與裁切位置。

## 遊戲載入與尺寸

圖集裁切後輸出具透明背景的獨立 WebP，小列表不必載入整張高解析圖集。道具和建築介面圖都有 96px、192px 兩種來源；建築地面圖為 256px。

道具圖集先依透明輪廓辨識完整物件，再裁切並保留留白，避免格線偏移造成鄰格殘片或截斷較高的物件。來源紀錄的 `extraction` 欄位保存實際擷取區域。

| 顯示位置 | 桌面 | 手機與緊湊觸控畫面 |
| --- | --- | --- |
| 背包與交易列表 | 48px | 40px |
| 道具詳情 | 80px | 64px |

手機規則與既有遊戲工作區一致：768px 以下，或 1024px 以下的觸控畫面，包含手機橫向。`srcset` 與 `sizes` 讓瀏覽器依螢幕密度選擇來源。圖片預留大小、等比例縮放；圖片旁既有名稱繼續提供無障礙文字。

背包、坊市、拍賣行、傳法臺、天道商店、靈石商店、回收商共用 `src/content/item-art.ts` 的 ID 對應。未知 ID 保留名稱而不顯示錯誤圖片。既有模板別名使用 shared 的唯一映射。

建築以穩定定義 ID 同步至客戶端；完成後的地圖顯示與放置預覽共用圖包。自建結構使用 `tiles[building:<id>]`，設施使用 `entities[building:<id>]`；通用地形圖保持原樣。圖片不改變佔位、施工、通行、存取權限或資產判定。

## 驗證入口

- `node packages/client/scripts/check-description-art-assets.mjs`：逐一確認模板、兩種尺寸、建築地面圖及 manifest 對應完整。
- `pnpm --dir packages/client exec node scripts/prove-item-icon-surfaces.mjs`：實際面板的桌面、手機、深淺模式及局部更新。
- `pnpm --dir packages/client exec node scripts/prove-building-art-contract.mjs`：建築身份、首包／增量／二進位協議與清除契約。
- `pnpm --dir packages/client exec node scripts/prove-building-art-browser.mjs`：實際 Canvas／Pixi 建築圖片、合法／非法預覽、清除及桌面／手機截圖。

瀏覽器截圖屬本機驗證產物，置於 `packages/client/.codex/`，不隨正式包發布。瀏覽器模擬不代表實體 iPhone／Safari 驗收。
