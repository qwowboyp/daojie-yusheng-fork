# Fix Leftovers — ISSUE 1 regex 失配 + ISSUE 2 display-number 萬/億

日期：2026-08-22 / 執行者：fix-leftovers 任務 / 未 commit（依 MUST NOT DO）

## ISSUE 1：生產 regex 簡繁失配（內部識別碼洩漏防護修復）

### 指名修復（world-runtime-pending-command.service.ts）

| 行 | 舊（簡體，永不命中） | 新（繁體） | 拋出點驗證 |
|---|---|---|---|
| :21 | `/^妖兽不存在：/` | `/^妖獸不存在：/` | monster-system-command:82、basic-attack:254/341、skill-dispatch:795/2857 均拋 `` `妖獸不存在：${id}` `` ✅ 錨點+全形冒號一致。monster-system-command:63 的 `妖獸不存在或已經死亡：` 前綴不同、本就不在分類範圍 |
| :31 | `/^实例 .+ 中没有可用出生点$/` | `/^實例 .+ 中沒有可用出生點$/` | map-instance.runtime.ts:795 `` `實例 ${instanceId} 中沒有可用出生點` `` ✅ 錨點/空格/全形完全一致 |

### 同檔額外發現並修復（任務要求的全檔掃描產出，共 8 處字面）

| 行 | 舊 → 新 | 拋出點 |
|---|---|---|
| :15 | `/^技能 .+ 超出范围$/` → `超出範圍` | player-combat:281、skill-dispatch:879/2606 |
| :155/:224/:225 | `元气不足` → `元氣不足`（技能/玩家 兩變體） | player-combat:295、skill-dispatch:360/2600；「玩家」變體現無拋出點（防禦性保留，僅轉字） |
| :174/:235 | `/^当前没有可取消的.+任务。$/` → `/^當前沒有可取消的.+任務。$/` | loot-container:963（採集）、craft-panel:1462（煉器/煉丹）、1974（強化）——注意 :235 是第二處同 regex（isExpectedTechniqueActivityReject），首輪編輯差點漏掉 |
| :189 | `/^技能 .+ 尚在冷却$/` → `尚在冷卻` | player-combat:285、skill-dispatch:353/2603 |
| :205/:206 | `无法规划前往…跨图路线` / `当前地图没有通往…界门` → 繁體 | navigation.service:666/671 |

### 掃描暴露的第二個生產檔（同類 bug）

`packages/server/src/runtime/world/world-runtime-navigation.service.ts:79-80`：同兩個導航 regex 簡體對繁體拋出點 → 已轉繁。

### 全倉掃描方法與計數

工具：臨時腳本（Temp/opencode/sweep-simplified-compare.mjs）複用 `convertText`（詞級+opencc）逐行偵測「含簡體字且行內有 `.test(/.match(/.startsWith(/.includes(/.endsWith(/===/!==/RegExp(` 的 .ts 行，排除純註解行。

- **server src（排除 tools/gm）**：掃後剩 4 命中，全數分類保留：
  - debug/movement-debug.ts:60 `[移动调试]`（debug 面）
  - native-gm-player.service.ts:759/2357、native-gm-secret-store.service.ts:190（GM 面；:2357 `目标玩家不存在` 為 GM 服務自拋自比、簡體自洽）
- **shared src**：monster.ts:805/808 `/妖王|荒王|兽王|王$/`、`/精英|异种/` —— 怪名來自已轉繁內容 JSON。妖王/荒王/精英 簡繁同形仍命中；兽王→獸王、异种→異種 為簡繁異形死分支 → 已轉（零行為變更：現有 content 無此四詞任何形態；唯一 fixture world-runtime-player-combat-smoke:483 明確給 tier:'variant' 不走名稱推斷）
- **client src**：全部命中為 gm*.ts / gm-map-editor* / gm-world-viewer GM 面 → 保留
- **config-editor / tools/procgen-demo / benchmarks**：零命中

**統計**：掃描生產檔命中 15 處（server 9 + shared 2 + 導航檔 2 + 待歸類 2）；修復 3 檔 14 個 regex 字面；保留 11 處（debug 1 + GM 10）。

### 孤兒 smoke 發現（未動）

`packages/server/src/tools/world-runtime-pending-command-smoke.ts` 整檔簡體 fixture/斷言（:364/:792/:1097/:1262/:1269 等）與現行繁體生產輸出全面失配，但 **未註冊於任何驗證鏈**（rg 全倉僅 docs/issues/audit 文件提及；不在 run-stable-smoke-suite / package.json）。按任務 sweep 範圍定義（non-tools）保留不動，登記為已知過期孤兒檔。

## ISSUE 2：display-number 万/亿 → 萬/億

### 轉換內容

1. `packages/shared/src/display-number.ts` COMPACT_NUMBER_UNITS 後綴表：
   - 任務指名：万→萬(:84)、亿→億(:83)
   - 白名單加入後 guard 曝光同表其餘 7 個簡繁異形後綴，一併轉換（同一玩家可見顯示路徑）：无量大数→無量大數、不可思议→不可思議、恒河沙→恆河沙、极→極、载→載、涧→澗、沟→溝
   - 同形不動：那由他/阿僧由他/阿僧祇/正/穰/秭/垓/京/兆
2. 斷言同步（4 檔 23 處）：
   - `packages/shared/scripts/check-display-number.cjs`：17 條期望值 万/亿→萬/億 + :40 MAX_VALUE regex `无量大数→無量大數`（測試名稱標籤保持簡體）
   - `packages/server/src/tools/world-runtime-sect-smoke.ts:990/1006`：`/當前大陣靈力\s+10万/` → `10萬`
   - `packages/server/src/tools/world-runtime-formation-smoke.ts:256`：`effectValue: "42万"` → `"42萬"`（生產端 world-runtime-formation.service.ts:444 formatInteger→formatDisplayInteger 實證走 display-number）
   - `packages/client/scripts/prove-item-card-constellation-layout.mjs:19/200`：fixture HTML 與斷言成對 `x136万→x136萬`
3. `scripts/sync-smoke-assertions.mjs:52-53` KEYWORD_EXCLUSIONS 更新：`'万','億'` → `'万','萬','億'` + 註解對齊新狀態（簡體「万」保留以保護 万矿归元/万虚归墟 等 fixture 名；新增「萬」防止已同步的數值格式斷言被未來 sync 波動）
4. `scripts/check-traditional.scope.json`：加入 `packages/shared/src/display-number.ts`（此前 blocked 未入白名單；轉繁後納管）

### 分類保留（万/亿 其餘命中）

註解（numeric.ts:500 万分比、procgen-fields:90、procgen-routes:137、technique.ts:609 万法、lifecycle:785、frame-schedule:4、action-panel:1189）、assert message 文本（access-policy:300「25 万次」、move-speed:18「30 万」）、fixture 名（player-skill-aoe-batch:319 万矿归元、technique-generation-init:1775+ 万虚归墟、projector-smoke:60/world-gateway-attr-detail-helper-smoke:282 万法归元）。

### generated 檢查

display-number 為純函式模組，無 .generated 衍生物；check-display-number.cjs 即其 build 鏈守門（require('../dist')，由 orchestrator 統一 build 後跑）。

## 驗證結果

| 項目 | 結果 |
|---|---|
| `node scripts/check-traditional.mjs --scope` | `{"ok":true,"violations":[]}` ✅ |
| `pnpm --filter @mud/server exec tsc --noEmit` | EXIT=0 ✅ |
| `pnpm --filter @mud/client exec tsc --noEmit` | EXIT=0 ✅ |
| 拋出點字串形狀比對 | 8 種訊息形狀逐一 rg 驗證錨點/空格/全形冒號句號一致 ✅ |
| build/verify 鏈 | 未跑（依 MUST NOT DO，orchestrator 統一執行） |
| commit | 未執行（依 MUST NOT DO） |

## 偏差記錄

1. 轉換範圍超出任務指名的 万/亿：guard 白名單曝光同表 7 個簡體後綴，屬同一玩家可見顯示路徑，不轉則白名單無法納管（ok:false）。判定為任務目標（玩家可見繁中一致性）的必要延伸。
2. monster.ts（shared）regex 轉換：任務 sweep 字面範圍是 server src，但「repo-wide same bug class」要求涵蓋；且該 regex 消費已轉繁的內容 JSON 怪名，屬同一失配類。
