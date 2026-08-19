# Tag-Value Lookup-Key 調查結論（zh-tw-only-conversion task-2）

日期：2026-08-19（完成版，含實作中發現的兩個工具鏈 bug）

## 目標

判斷資料檔中的中文 tag 值（`药品/基础药品/丹药/材料/武器/护甲/旧兵器/步法/锻体/匪物/蛇胆/蛛丝/帽子/腿部护甲` 等）是否被程式碼以「字串字面值」比較。若是，則該欄位不能轉繁中，必須加入 `scripts/convert-exclude-fields.json`。

## 資料分布（探查結果）

| 位置 | 欄位 | 值例 | 數量 |
|---|---|---|---|
| maps `landmarks[].container.lootPools[].tagGroups[][]` | tagGroups（二維陣列元素） | 药品/基础药品/丹药/蛛丝/匪物/步法/材料/护甲/帽子/武器 | 199 |
| content `items/*/材料.json` `tags[]` | tags | 异材/木材/石材/金属/布料/药材/矿石 | 146 |
| content `monsters/*.json` `drops[].name` | name | 狼牙/翠竹心 | 6 |
| maps grid 層 | terrain/structure/surface（tile key 二維陣列） | 墙/板/路/草/树/石/门 | 大量 |

## 程式碼比較點（字面值）

1. **loot pool tag 匹配（tagGroups ↔ item.tags，Set 成員比對）**：
   - `content-template.repository.ts:1606-1614`、`drop-table.registry.ts:484-491`、`content-template-utils.ts:973-981`
   - 機制：`tagGroups.every((group) => group.some((tag) => tagSet.has(tag)))`——**兩邊都是中文資料值**，沒有硬編碼字面值，兩側必須保持一致。
2. **物品材料 tag 正規化**（`content-template.repository.ts:1294-1309` / `content-template-utils.ts:658-674`）：
   - `tags.add('药材')` / `'异材'` / `'矿石'` / `'矿材'`——**硬編碼 CN 字面值**，載入時合成進 item.tags。
3. **建築材料分類推斷**（`packages/shared/src/build-material.ts:126-139`）：
   - `includesAny(normalized, ['布','纱','丝','绢','帛','缎','蛛丝',...])`——檢查 item `name/tags` **包含** 簡中關鍵字。

## opencc cn→tw 穩定性探查

**會被轉換**：药品→藥品、丹药→丹藥、蛇胆→蛇膽、蛛丝→蛛絲、护甲→護甲、旧兵器→舊兵器、锻体→鍛體、药材→藥材、金属→金屬、异材→異材、生命回复→生命回覆、灵力回复→靈力回覆、步法残页→步法殘頁。

**不變（安全）**：材料、石材、木材、布料、透明材、透明、武器、帽子、匪物、步法、矿石、狼牙、翠竹心、矿材、布、纱、丝、绢、帛、缎。

## 結論

**必須排除的欄位**（加入 convert-exclude-fields.json）：

```json
["char", "tags", "tagGroups", "terrain", "structure", "surface"]
```

- `tags`：與 `build-material.ts`、`normalizeItemTags` 簡中字面比對（`'药材'`、`'异材'`、`'矿石'`、`'蛛丝'`、`'布'`…）。
- `tagGroups`：map loot pool 與 item.tags Set 匹配；兩側都保持簡中才一致。
- `terrain`/`structure`/`surface`：grid tile key（牆/板/路/草/樹/石/門），本就是 tile 索引，禁止轉換（`墙→牆` 會破壞地圖）。
- `drops[].name`（狼牙/翠竹心）：opencc 不變，**不需排除**（探查確認 狼牙→狼牙、翠竹心→翠竹心）。
- `char`：sprite key（既有排除）。

## 實作中發現並修復的兩個工具鏈 bug

1. **convertJsonString 的排除欄位判定只支援「直接值」形狀**（`"field": value`），
   `tags`/`tagGroups` 這類**陣列內元素**不會被排除 → 陣列元素被誤轉。
   修法：由內往外掃描未閉合的 `[`，逐層檢查其前綴是否為排除欄位（支援多層巢狀陣列），
   已閉合的 `]` 陣列用括號計數跳過。修復後 probe 驗證 5 種形狀全過：
   - 巢狀物件陣列 → 正常轉
   - 普通字串陣列 → 正常轉
   - tags 單層陣列 → 排除
   - tagGroups 深層巢狀 → 排除
   - char → 排除
2. **convert-maps-with-grid-exclude.mjs 傳 `.patched` 檔給 convertFile 但沒指定 mode**：
   `.patched` 副檔名不是 `.json` → `modeOf` 判定為 **source 模式**（TS AST），
   排除欄位完全失效 → tagGroups 全被轉成繁中。
   修法：`convertFile(abs + '.patched', { mode: 'json', excludedFields })`。

## 驗證結果（全綠）

- `compare-structure.mjs 89776d3b` → `{"structuralChanges":0,"textFieldsChanged":3131,"excludedFieldsUnchanged":true}` exit 0
- `check-traditional.mjs`（地圖 + 材料樣本）→ `{"ok":true,"violations":[]}`
- grid 層 40 檔全數與 HEAD 位元組一致
- 116 個改動檔 JSON.parse 全過
- `rg U+FFFD packages/server/data` → 0
