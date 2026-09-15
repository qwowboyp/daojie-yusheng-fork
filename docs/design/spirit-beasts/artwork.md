# 靈獸系統美術交付

本批以正式內容 `packages/server/data/content/spirit-beasts/catalog.json` 的 150 個 `species[].id` 為靈獸唯一鍵；不依顯示名稱選圖。

## 正式載入路徑

- 靈獸：`assets/spirit-beasts/species/<species-id>-96.webp` 與 `-192.webp`
- 五行靈蛋：`assets/spirit-beasts/items/spirit_egg.<element>-96.webp` 與 `-192.webp`
- 靈種：`assets/spirit-beasts/items/<seed-id>-96.webp` 與 `-192.webp`
- 設施介面：`assets/spirit-beasts/buildings/<building-id>-96.webp` 與 `-192.webp`
- 設施地圖：`assets/spirit-beasts/buildings/<building-id>-256.webp`

同元素五顆星的蛋共用一張美術，UI 以星數呈現差異。別名清單與每張圖的來源、格位、裁切和 SHA-256 位於 `docs/artwork/atlases/spirit-beasts-*.json`。

## 驗收範圍

每張正式 WebP 必須可解碼、為指定像素尺寸且帶真實 alpha。原始 AGY 圖集、提示詞、AGY 記錄、原始雜湊與裁切記錄只留在 `.runtime/reports/spirit-beasts-design-20260914/art/`，不作遊戲載入來源。AGY 原生輸出若非透明，使用純 `#ff00ff` 背景的色鍵處理；棋盤格像素或有文字的區域不可進正式圖示。

## 2026-09-15 仙相重製

150 種靈獸改用五品各一張 AGY 圖集，新名稱沿用原 species ID 與全部養成數值。最高原生尺寸為 1200×896，正式圖保持 96/192 WebP；沒有假稱高解析生成或放大原圖。已核對的視覺提示詞保存於 `docs/artwork/prompts/spirit-beasts-v2/`，後續 `prepare` 優先沿用。

重製指令：`node scripts/refresh-spirit-beast-redesign.mjs prepare <grade>` 準備 AGY 提示詞；AGY 產出並實看後用 `crop <grade>`、`contact` 匯入與建立聯絡圖。`node scripts/prove-spirit-beast-redesign.mjs` 只讀驗證資料不變量與 300 張圖的尺寸、透明度、映射和雜湊。工具需專案可解析的 sharp，或設定 `CODEX_BUNDLED_NODE_MODULES` 指向宿主提供的 Node 套件目錄。

有標籤的原圖採主體連通輪廓擷取，捨棄分離文字與碎星點；九色鹿依本批像素保護粉紫鱗片、排除上下標籤區，避免去背誤刪頭部。聯絡圖須人工核對完整輪廓與無字，不能以 alpha/hash 通過代替畫面驗收。

圖鑑的品質色位於卡框、箔面與光環，文字使用高對比主題色。圖鑑、宗門面板和 Pixi 地圖共用 `content/spirit-beast-art.ts` 的素材版本，避開舊圖快取。
