# 功法圖片特效

## 視覺設計

以既有俯視仙俠地圖為基礎替換功法施放表現。保留五行配色、施法位置、技能名字、傷害飄字及預警格；特效採透明能量紋理與短時間動態，不增加操作入口。

設計尺度：視覺變化 4、動態強度 6、資訊密度 8、圖片依賴 10、既有風格保留 9。以手機與桌面地圖中的戰鬥辨識為用途，重點是不同形態可辨、淺深背景可讀，以及保留中央人物和文字的空間。

## 素材來源與對應

使用內建 imagegen 生成原始 RGBA 圖集，再轉為 WebP 交付。正式資源為 `packages/client/public/assets/vfx/technique-cast-v1.webp`，1536 × 1024，四欄三列。每列邊界使用 `round(row × 1024 / 3)`，每欄寬 384；灰白原圖由客戶端依既有元素配色著色。

| 列 | 第 1 欄 | 第 2 欄 | 第 3 欄 | 第 4 欄 |
|---|---|---|---|---|
| 1 | single 衝擊 | aoe 環爆 | line 劍氣 | heal 回春 |
| 2 | buff_self 護體 | buff_debuff 束縛 | tile 符陣 | vortex 旋渦 |
| 3 | chain 雷鏈 | barrage 萬刃 | divine 神通光環 | secret 秘法光環 |

系統功法與自創功法沿用服務端推導的同一個形態契約。內功沒有施法動作，不額外添加虛構特效。

## 生成提示詞

生成方式：內建 `image_gen`，未使用外部 API。以下為實際完整提示詞。

```text
Use case: stylized-concept. Production game VFX texture atlas for a Chinese xianxia top-down multiplayer RPG. Generate ONE true transparent RGBA image, landscape aspect 3:2, ideally 1536 by 1024. EXACT 4 columns by 3 rows of 12 equally sized cells. Each texture is isolated in its own cell, centered precisely; at least 12% empty transparent padding on every side of every cell, no overlap, nothing cut off. No grid, no cell dividers, no frames, no text, no letters, no numbers, no UI, no characters, no background, no checkerboard painted into the image. This is realistic luminous magical energy artwork for animated sprite effects, NOT interface icons. All artwork neutral white/silver/grayscale so the engine can tint it; preserve textured luminous wisps, layered feathered edges, bright cores, soft partial alpha halos, strong legibility on both dark and pale maps. Actual alpha transparency is essential.
Cell ordering LEFT TO RIGHT, TOP TO BOTTOM:
row 1 col 1: concentrated radial magical impact explosion, sharp energetic shards, tiny core with smoky outward streaks.
row 1 col 2: circular expanding shockwave, broken volumetric fiery energy ring seen from directly above with open center.
row 1 col 3: horizontal piercing sword-energy beam pointing RIGHT, long clean bright core, wispy side trails, starts left ends right, occupies central 70% width.
row 1 col 4: restorative spiritual healing bloom, luminous lotus-like energy with rising vapor, open center and delicate motes, no actual solid flower.
row 2 col 1: protective cultivation aura, layered circular flowing spirit ribbons surrounding an empty center.
row 2 col 2: hostile binding seal, four curved spectral talon ribbons folding inward around an empty center, cracked smoky aura.
row 2 col 3: grounded formation sigil, ornate circular energy pattern and diagonal rune-like strokes, no legible words, directly overhead, luminous weathered mystical material.
row 2 col 4: turbulent spiral vortex, several flowing energy arms wrapping inward, visible eye, top-down.
row 3 col 1: horizontal branching lightning chain from LEFT to RIGHT, strong bolt across center, organic branching arcs, narrow luminous core.
row 3 col 2: barrage of multiple sharp sword-energy projectiles, all pointing RIGHT, several slightly offset parallel luminous blades with tails.
row 3 col 3: divine rank accent, luminous celestial aureole with thin rays and delicate curling cloud flourishes, empty center.
row 3 col 4: secret technique accent, concentrated mystical eclipse-like halo with smoky ink-energy flowing around perimeter, empty center.
Keep the twelve cells identically sized and regularly aligned. Detailed real VFX textures with coherent elegant martial fantasy art direction. Output transparent artwork only.
```

## 執行與資源生命週期

- Canvas 與 Pixi 共用一次圖片載入／解碼；尺寸不符或網路失敗會拒絕載入，五秒後才重試，不會逐幀發出請求。
- Pixi 預切 12 個共用 Texture，事件僅擁有兩個 Sprite（主圖、可選光環）；Canvas 以乘色保留原圖亮暗與透明度，最多快取 48 個已著色幀（約 24 MiB 像素）。
- 同屏最多 32 個施放事件，逐幀僅更新位置、旋轉、尺寸與透明度。第一幀透明不代表到期；重設場景會移除事件，但不銷毀共用圖集。
- 圖片尚未就緒時不延後或補播過期事件，技能結算、技能名、傷害文字、預警與音效繼續依原鏈路執行。
- 此次只替換客戶端表現，不改功法命中／傷害／費用，也不改服務端形態推導。旋渦、雷鏈、萬刃已支援協議形態；內容若未傳出對應 castStyle，仍按既有 single／aoe／line 顯示，不由客戶端猜測或改寫。

## 驗收入口

- pnpm --filter @mud/client proof:technique-image-vfx：真實瀏覽器驗證兩套渲染器、形態／光環、載入與重試、著色、生命週期、事件上限與 reset；淺深色及桌面／手機尺寸截圖存於已忽略的 packages/client/.codex/vfx-proof/。
- pnpm verify:client：包含此圖片特效 proof 的完整客戶端門禁。
- 截圖場景為隔離驗證畫面，不能等同實體手機或實際玩家完整戰鬥驗收。

## 本次驗證紀錄（2026-09-09）

- `pnpm verify:client` 全部通過；其後僅調整驗收腳本的場景與截圖，重新執行圖片特效專項亦通過，產品程式未再變更。
- 桌面與 390px 手機的淺深色截圖，使用正式色票、每格 26px 與 45% 動畫幀，逐組比較 Canvas／Pixi 的 10 種形態及神通／秘法。各圖驗證有效像素面積、寬高及未被畫布裁切。
- Canvas 第一次冷快取繪製 32 個事件，本機 Chromium 觀測為 42.1ms；此數值不是低階手機效能保證，後續命中快取不再逐像素著色。
- 候選建置 `56e74237c877` 已確認包含圖集，且執行程式引用正確資源 URL。圖集 SHA-256：`86b2dd8dfc2ab171b3e98991608886c6b4ecc2b18a23b2ed4667a1e45c211ad2`。
- `pnpm verify:release:full` 因缺少隔離資料庫、shadow 伺服器與 GM 驗證環境而中止；尚未執行生產切換。若本次採僅前端發布，須先確認此門禁例外，並保留舊前端映像供回復。
