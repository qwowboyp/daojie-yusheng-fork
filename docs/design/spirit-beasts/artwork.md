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
