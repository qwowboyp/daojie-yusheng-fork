# Fix-F2：smoke 斷言同步器修復 + 29檔/80處（實際169處）全量同步

日期：2026-08-22。對應 F2-code-quality.md 阻擋問題 1、2。

## 1. 工具修復：`scripts/sync-smoke-assertions.mjs`

### Bug（修復前）

`collectAssertionLiterals()` 的 fixture 預掃 `collectFixtureValues()` 遞迴收集了**所有**
`StringLiteral`——包括 assert 呼叫實參裡的斷言字串本身。之後 `pushStringLiteral()`
以 `fixtureValues.has(raw)` 跳過，導致**斷言預期值必然命中集合、被當成 fixture 靜默跳過**。
證據：修復前 dry-run 只報 `(regexp)` 類站點（`pushRegExpLiteral` 不查 fixtureValues），
字串斷言 0 處可見——工具對核心輸入整類 no-op。

### 修法（三段式）

1. **標記遍歷**（markVisit）：先按原規則定位全部斷言字面量節點
   （assert.* 值比較位實參 + 斷言鏈內 includes/startsWith/endsWith/indexOf/match 實參），
   存入 `assertionStringNodes` / `assertionRegExpNodes`，不轉換。
2. **fixture 收集**：`collectFixtureValues()` 跳過已標記的斷言 StringLiteral 節點，
   只收「非斷言位置」的字面量值。
3. **轉換判定**：對標記節點逐一 pushStringLiteral/pushRegExpLiteral
   （保留 KEYWORD_EXCLUSIONS / LITERAL_EXCLUSIONS / fixture 配對語義）。

### 修復前後行為對比

| 指標 | 修復前 | 修復後 |
|---|---|---|
| dry-run 可見站點 | 29 檔 / 80 處（全為 regexp） | 57 檔 / 169 處（regexp + 新增可見的字串斷言） |
| 字串斷言同步 | 永遠靜默跳過 | 正常轉換 |

## 2. 分類與套用

逐 needle 對生產真源（`packages/server/src` 非 tools + `packages/shared/src`）做
簡體/繁體雙向 rg 驗證後分類：

### 2a. 工具 --write 套用：45 檔 / 140 處

含任務指名案例：
- `sect-runtime-durable-reconciliation-smoke.ts:671/678`
  `/宗门持久化连接池不可用/` → `/宗門持久化連接池不可用/`（生產 world-runtime-sect.service.ts:2411 已繁）
- `tongtian-tower-smoke.ts` 各 regex（第一層不能退到上一層／還需 N 秒／重傷倒地…）
- 內容模板鏡像（青靈莖/殘魄掌/初入雲來鎮/司命臺/藏經參悟/傳法/銅羅盤相關等）全部對齊繁體內容 JSON

### 2b. 排除清單固化進工具（dry-run 計 0 pending 的前提）

**LITERAL_EXCLUSIONS 新增 12 條——生產文本仍為簡體的鏡像斷言**（GM 面/啟動校驗/共享校驗，
逐條 rg 確認生產來源仍輸出簡體）：

| 排除 needle | 生產來源（仍簡體） |
|---|---|
| 不支持的玩家修改分区 | http/native/native-gm-player.service.ts:1869 |
| GM 密码错误 | runtime/gm/runtime-gm-auth.service.ts:161 |
| GM 运行时环境变量文件不可读 | runtime/gm/runtime-env-management.service.ts:54 |
| 数据库备份目录不可用 | http/native/native-gm-admin.service.ts:1234 |
| 非开发环境必须显式配置 SERVER_CORS_ORIGINS | config/server-cors.ts:49 |
| 手动分线创建后未就绪 | http/native/native-gm-world.service.ts:1047 |
| 分线预设必须是和平线或真实线 | http/native/native-gm-world.service.ts:1492 |
| 目标玩家未在线 | http/native/native-gm-world.service.ts:1200 |
| 显示名称组合序列不能超过 / 显示名称必须为可见字符 | auth/account-validation.ts:99/103 |
| [敏感请求正文已隐藏] | runtime/gm/runtime-gm-state.service.ts:1772 |
| 背包物品身份已修复，请重新选择 | network/world-gateway-inventory.helper.ts:149/446 |

**KEYWORD_EXCLUSIONS 新增 8 條——純 fixture 回顯**（smoke 自造數據兩側一致即可，
非生產文案；轉單側必壞）：唤灵真人、唤灵火（capability-guard 自造怪物/技能名）、
测试玩家_0（payload 回顯）、云来散修（輸入→trim 回顯）、+5 测试剑（顯示名合成回顯）、
铜 罗盘（搜索串規範化回顯）、青云（搜索串規範化回顯）、旧（自造玩家名首字投影）、
目标实例没有可用出生点（smoke 自拋錯誤→斷言透傳）。

### 2c. 手工修復 6 檔（工具設計上不可達的位置）

| 檔案:行 | 修改 | 原因 |
|---|---|---|
| tongtian-tower-smoke.ts:99 | `你进入通天塔第 1 层。`→`你進入通天塔第 1 層。` | deepEqual 物件內嵌套字串，工具只收直接實參位；生產 tongtian-tower.service.ts:530 已繁 |
| technique-unification-platform-smoke.ts:256 | customName `归元正法`→`歸元正法` | fixture 輸入與斷言成對轉（生產模板 `統法臺：${name}` 前綴硬編繁體，map-instance.runtime.ts:1974） |
| world-runtime-context-actions-smoke.ts:17,127,153,155 | 地圖名/NPC 台詞/強制攻擊名+描述 成對轉繁 | fixture 與嵌套 deepEqual 期望成對轉；生產 context-action-query.service.ts:140-182 已繁 |
| world-runtime-combat-relation-smoke.ts:702,708,720,727,877,984 | 青木劍訣/攻擊者/目標修士/測試妖獸×2/裂地術 fixture 名成對轉繁 | 斷言=生產模板（你對…施展…，observation.helpers.ts:211 已繁）+fixture 名；只轉斷言必失配 |
| world-runtime-equipment-smoke.ts:59 | 青萝束冠→青蘿束冠 | fixture 名流入生產通知 `裝備 ${name}`；內容模板同名道具已繁 |
| leaderboard-offline-snapshots-smoke.ts:327,598 | mock 地圖摘要與期望成對轉雲來鎮 | mock 模擬內容源，對齊生產模板真名 |

## 3. 驗證結果

```
node scripts/sync-smoke-assertions.mjs --dir packages/server/src/tools --dry-run
→ 共掃描 523 個文件，0 個有斷言轉換，共 0 處
pnpm --filter @mud/server exec tsc --noEmit → TSC_EXIT=0
```

變更足跡：46 個 smoke 檔案 + `scripts/sync-smoke-assertions.mjs`（git diff --name-only 核對；
`check-traditional.mjs`/`check-traditional.scope.json`/`mail-traditionalize-conversion-smoke.ts`
的 working tree 變更屬平行任務既有改動，本次未觸碰）。未 commit（依任務要求）。

## 4. 已知限制 / 後續追蹤（非本任務 scope）

1. **嵌套 deepEqual/deepStrictEqual 物件內的字串是工具盲區**（只收直接實參位）。
   本次以手工修復補齊已發現的 6 檔；不保證 repo 內無其他嵌套過期期望，
   建議後續跑 smoke 全量驗證時暴露、或考慮讓工具遞迴收集值比較位物件內的字串。
2. **生產端疑似轉換殘留**（rg 時偶然發現，需另行確認）：
   - `world-runtime-pending-command.service.ts:31` 以簡體 regex
     `/^实例 .+ 中没有可用出生点$/` 比對訊息，但 `map-instance.runtime.ts:795`
     現在拋繁體 `實例 … 中沒有可用出生點`——該分類分支可能永不命中。
3. `InventoryPanel.tsx:124` fallback 用詞、GM conversion CAS 註解等 F2 其他重新送審條件不在本任務範圍。
