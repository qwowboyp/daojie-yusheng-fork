# Evidence — F2/F4 REJECT 修復（final-wave / fix-f4-misc）

日期：2026-08-22
範圍：F2（InventoryPanel fallback 台灣用語）+ F4（Must NOT #3 繁體註解）

## 修復內容

### 1. InventoryPanel.tsx:124 — 台灣用語 fallback（F2）
- `placeholder={t('inventory.search.placeholder', undefined, '搜索物品')}`
  → `placeholder={t('inventory.search.placeholder', undefined, '搜尋物品')}`
- 原因：台灣用語為「搜尋」非「搜索」；兩字同為簡繁同形字，guard 無法偵測，需人工修正。
- 此 fallback 源於 commit 8e4213b1（早於計畫），但屬 F2 明確指出的台灣用語問題，依任務指示修正。

### 2. app.module.ts:273-274 — 繁體註解轉簡體（F4 / Must NOT #3）
- 原（commit 82fb101d 引入）：
  ```
  // envFilePath: [] 表示不讀 .env 檔案（本環境 .env 是目錄，讀取會 EISDIR）；
  // 環境變數一律由 process.env 注入（verify 鏈 / load-local-runtime-env 負責）。
  ```
- 改為簡體（技術語義不變）：
  ```
  // envFilePath: [] 表示不读 .env 文件（本环境 .env 是目录，读取会 EISDIR）；
  // 环境变量一律由 process.env 注入（verify 链 / load-local-runtime-env 负责）。
  ```

### 3. responsive.css:906-907 — 無需修改（F4 誤報）
- 以 UTF-8 位元組層級驗證 HEAD 內容：`/* 手机端锚定视口底部而非 #game-stage（offsetParent），避免工具栏跟随未展开的地图行高，保证营造模式下游戏世界保留高度按 window.innerHeight 计算 */` 已是簡體。
- F4 報告的「繁體註解」判定源於終端編碼亂碼（git show 經 PowerShell 管道輸出被破壞成 `?` 字元），實際檔案內容為簡體。`git status` 亦確認此檔無未提交變更。

## 額外檢查（Must #2）
- `git log -p` 檢查 commit 82fb101d / 43739e75 對這 3 檔新增的所有註解行：
  - app.module.ts：僅 273-274 兩行（已轉簡體）
  - responsive.css：僅 906-907 兩行（HEAD 已是簡體）
  - InventoryPanel.tsx：計畫 commit 無變更
- 無其他由計畫引入的繁體註解殘留。

## 驗證
- `pnpm --filter @mud/server exec tsc --noEmit` → EXIT=0
- `pnpm --filter @mud/client exec tsc --noEmit` → EXIT=0（InventoryPanel.tsx 純字串字面值變更，無型別風險；LSP daemon 忙碌逾時，以 tsc 替代）
- `git diff` 僅 2 檔、3 行變更（1 行 fallback + 2 行註解），無邏輯變更。

## 未提交
- 依任務指示，本次修復不 commit。