# 地塊、道具與自建建築美術

圖片以內容 ID 對應，不用名稱、價格、字形或道具實例 ID 猜測外觀。

## 批量生成必遵守的規則

使用者指定：**一張原圖放多個不同道具，再裁成每件獨立圖示**。通常沿用 6 × 6、每張最多 36 格的圖集；長型武器可調整格數及留白。批量功法與裝備不得預設為每件各生成一張大型原圖。

「每件各自有圖」指每格的造型、材質和意象有辨識度，不是重用同一張或僅換色，也不代表必須逐件呼叫生成工具。先排好 stable itemId 與格位，要求透明背景、完整物件、互不重疊，且無格線、文字、邊框及浮水印；裁切後檢查輪廓、鄰格殘片、96px／192px 尺寸與縮圖辨識度。

已完成且合格的單張圖片保留沿用；僅在使用者明確要求或修補個別失敗圖示時單件生成。這是使用者對本專案的長期要求，優先於通用生圖技能的逐資產呼叫預設。

實際風格參考：功法看 `atlases/items-05.webp`，武器、防具與飾品看 `atlases/items-04.webp`、`atlases/items-07.webp`，並對照裁切後的正式圖示。功法多為一致斜視角的古冊，透過封面意象、主色、材質及適量靈氣效果區分；不必刻意把每本改成不同載體。裝備依武器類型、甲衣結構與材料呈現差異。整體是輪廓清楚、對比鮮明的手繪遊戲圖示，不是填滿大型畫面的寫實物件特寫。

既有提示詞要求每格中央約 64% 放置物件、四邊各留約 18% 透明空間（包含光效），再以透明連通輪廓擷取完整物件；裁切來源記錄 `cell`、`extraction` 與原圖雜湊，輸出約 84% 內容佔比的獨立縮圖。

## 來源與製作方式

青霖澤使用 `atlases/foundation-qinglin-items-01.webp` 的 4×4 圖集產出 16 件道具，以及 `atlases/foundation-qinglin-monsters-01.webp` 的 3×2 像素怪物圖集產出 6 隻怪物。同名 JSON 記錄提示詞、去背指令、stable ID、格位、透明輪廓擷取與正式輸出雜湊。道具為 96px／192px WebP；地圖怪物沿用 128px PNG 與 `monster:<id>` 單格 manifest，圖包版本至少為 11。

`node scripts/import-foundation-expansion-art.mjs <job.json>` 匯入已完成去背與檢視的多格原圖；工作檔指定來源與正式 metadata 相同的清單，不逐件生圖。`node scripts/prove-foundation-expansion-art.mjs` 在乾淨 checkout 驗證兩張圖集、38 個正式產物與所有 ID 映射。

`packages/client/scripts/prove-foundation-expansion-art-browser.mjs` 驗證全部新圖解碼、透明留白和兩套正式怪物選圖；`prove-foundation-qinglin-map-browser.mjs` 使用權威地圖模板驗證整圖地貌、藥草與蛟潭。兩者均涵蓋桌面、手機直向／橫向與深淺背景，證據為瀏覽器模擬。

築基十二部功法使用 `atlases/foundation-manuals-01.webp` 的 4 × 3 圖集；同名 JSON 保存提示詞、去背指令、逐格 ID、裁切與 24 個正式產物雜湊。獨立縮圖沿用 `assets/item-icons/v1/book.foundation_manual_*-96.webp`／`-192.webp`，並收錄在 `item-icons-v1.json`。`node scripts/prove-foundation-techniques.mjs` 驗證全卷、掉落、坊市目錄與本批美術對應。

後期七境的 56 本功法書與 168 件裝備使用 `atlases/late-unique-*.webp` 七張圖集，每格對應一件物品。`late-game-unique-icons.json` 記錄 224 件的格位、透明輪廓裁切與兩種尺寸雜湊；正式檔案置於 `assets/item-icons/v2/`，避免沿用舊路徑的長效快取。其餘 247 件材料與消耗品仍由 `late-game-icon-reuse.json` 記錄既有美術來源。

生成後以 `node scripts/import-late-game-unique-icons.mjs` 匯入；`node scripts/prove-late-game-unique-icons.mjs` 可在乾淨 checkout 檢查完整覆蓋、透明度、尺寸、唯一性與同步腳本不覆蓋專屬美術。生成器輸出的棋盤格像素不等於透明背景，必須檢查實際 alpha 通道與每格透明留白。

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

建築以穩定定義 ID 同步至客戶端；完成後的地圖顯示與放置預覽共用圖包。自建結構使用 `tiles[building:<id>]`，設施使用 `entities[building:<id>]`；通用地形使用獨立拼接圖集。圖片不改變佔位、施工、通行、存取權限或資產判定。

## 高清地塊第二版

29 種地形、地表與結構使用逐張生成的俯視手繪材質，原圖為 1254px。正式產物為 **1024×1024 無損 WebP**，每張仍是 4×4 dual-grid，單格來源提高至 256px；保留 Canvas／Pixi 的圖集裁切、最高層優先序與地圖格尺寸。`terrain-hd-v2.json` 保存完整提示詞、原圖雜湊與正式產物雜湊。

原圖位於本機 `assets/generated/terrain-hd-v2/sources/`，被 Git 忽略；發布只使用已提交的 `packages/client/public/assets/runtime-image-packs/default/tiles/`。不把大尺寸原圖、候選圖或瀏覽器截圖放進正式包。

`scripts/build-terrain-hd-atlases.mjs` 只縮放、依既有角位映射裁切材質，不重新繪製美術。空格使用真透明 alpha，相鄰雙角採半平面，單角／缺角採圓弧；所有具相同共用角的水平及垂直接縫必須逐像素吻合，避免半圓邊界造成裂縫。打包用的 `sharp` 可來自本機安裝或 `CODEX_BUNDLED_NODE_MODULES`，不增加客戶端執行期依賴。

```sh
node scripts/build-terrain-hd-atlases.mjs
# 預設輸出至 assets/generated/terrain-hd-v2/candidate/tiles；不自動覆寫正式素材。
node scripts/build-terrain-hd-atlases.mjs --source-dir assets/generated/terrain-hd-v2/sources --output-dir packages/client/public/assets/runtime-image-packs/default/tiles
```

正式 manifest 快取版本升為 6；10 張自建建築地面圖維持 256px／單格，介面圖示維持原來的 96px／192px，不改建築身份或伺服器資料。

單格透明建築先繪原地表（沒有地表則繪地形），再疊建築，避免透明邊緣露出黑色／單色方塊。Canvas 與 Pixi 共用選圖規則；Canvas 快取鍵與 Pixi 靜態簽名包含 `buildingDefId`，防止建築與同類自然地塊、拆除後的地塊共用錯誤圖片。建造預覽維持純疊圖，地塊拼接遮罩不變。

`pnpm --dir packages/client run proof:terrain-hd` 以 Chrome 解碼全部正式圖集，檢查尺寸、透明拓撲與接縫，並在正式 Canvas／Pixi 路徑產出 32px／64px 及桌面／手機、深淺模式證據。產物在 `packages/client/.codex/terrain-hd-proof/`，屬本機隔離場景，非線上玩家或實體 iPhone／Safari 驗收。

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
