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
| 背包與道具列表 | 48px | 40px |
| 道具詳情 | 80px | 64px |
| 文字內的道具標籤 | 24px | 20px |

手機規則與既有遊戲工作區一致：768px 以下，或 1024px 以下的觸控畫面，包含手機橫向。`srcset` 與 `sizes` 讓瀏覽器依螢幕密度選擇來源。圖片預留大小、等比例縮放；圖片旁既有名稱繼續提供無障礙文字。

背包、坊市、拍賣行、傳法臺、天道商店、靈石商店、回收商共用 `src/content/item-art.ts` 的 ID 對應。未知 ID 保留名稱而不顯示錯誤圖片。既有模板別名使用 shared 的唯一映射。

煉丹、煉器、強化的配方、投料、目標選擇、確認、執行中與歷史詳情沿用相同圖片來源。任務獎勵與需求等文字內的道具標籤使用較小圖示；圖片不覆蓋既有數量欄、操作按鈕或道具提示的事件資料。

建築以穩定定義 ID 同步至客戶端；完成後的地圖顯示與放置預覽共用圖包。自建結構使用 `tiles[building:<id>]`，設施使用 `entities[building:<id>]`；通用地形圖保持原樣。圖片不改變佔位、施工、通行、存取權限或資產判定。

## 驗證入口

- `node packages/client/scripts/check-description-art-assets.mjs`：逐一確認模板、兩種尺寸、建築地面圖及 manifest 對應完整。
- `pnpm --dir packages/client exec node scripts/prove-item-icon-surfaces.mjs`：實際面板的桌面、手機、深淺模式及局部更新。
- `pnpm --dir packages/client exec node scripts/prove-building-art-contract.mjs`：建築身份、首包／增量／二進位協議與清除契約。
- `pnpm --dir packages/client exec node scripts/prove-building-art-browser.mjs`：實際 Canvas／Pixi 建築圖片、合法／非法預覽、清除及桌面／手機截圖。

瀏覽器截圖屬本機驗證產物，置於 `packages/client/.codex/`，不隨正式包發布。瀏覽器模擬不代表實體 iPhone／Safari 驗收。

## 道具圖片顯示入口

共用行內道具標籤同時涵蓋 legacy DOM 與 React。道具清單與確認窗使用既有圖集來源，未知內容 ID 保留名稱，不以實例 ID、寶庫庫位或名稱猜測圖片。

| 入口 | 已涵蓋位置 |
| --- | --- |
| 煉丹、煉器 | 配方、材料、材料挑選、預設、確認、統一執行與等待清單 |
| 強化 | 目標、挑選、保護道具、消耗材料、執行中與歷史 |
| 建築、寶庫 | 建築材料候選、庫存、批量放入與取出詳情；建築本體沿用專用圖片 |
| 背包、裝備、拾取 | 物品格、法寶、拾取物、批量丟棄、使用/丟棄確認與陣盤 |
| 交易、郵件 | 各商店、NPC 商店、交易確認、郵件附件與離線收益 |
| 任務、說明 | 道具需求、獎勵、文字引用、懸浮提示與裝備對照 |
| 其他 | 技法書分解、自動用藥槽位/選擇/條件、GM 背包/附件/兌換獎勵 |

統一技藝任務僅新增可選的靜態 `itemId` 顯示資料，不傳圖片網址；煉丹/煉器等待項目以穩定配方 ID 查閱啟動期建立的產物索引，強化沿用目標 ID。既有等待與休眠資料無需遷移；未知道具或配方保留名稱。

本輪瀏覽器驗證入口：`proof:craft-item-icons`、`proof:vault-building-item-icons`、`proof:secondary-item-icons`、`proof:item-reference-dialogs`。檢查實際產品 DOM、圖片解碼、PC/手機尺寸、祖先裁切、觸控選擇與表單狀態保留。
