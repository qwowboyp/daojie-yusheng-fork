# Fix F3 REJECT — shared 層系統性漏掃 + client ui/ 白名單外檔案 + guard TemplateExpression 盲點

> 日期：2026-08-22
> 範圍：packages/shared/src、packages/client/src/ui、scripts/check-traditional.mjs、scripts/check-traditional.scope.json
> 驗證：guard --scope ok:true（337 條白名單全綠）、tsc --noEmit shared exit 0、tsc --noEmit client exit 0

---

## 1. Guard TemplateExpression 盲點修復（scripts/check-traditional.mjs）

**Root cause**：`checkSourceText` 的 visitor 對 `ts.isTemplateExpression(node)` 直接 `return`，
插值表達式內嵌的 StringLiteral 全部漏掃。F3 三個玩家可見簡體案例全是同一根因：

| 案例 | 位置 | 盲點形態 |
|---|---|---|
| offline-gain-modal 阻塞提示 | ui/offline-gain-modal.ts:401 | `${blocking ? '<div>确认前…</div>' : ''}` — 內嵌 StringLiteral |
| npc-quest-modal i18n fallback | ui/npc-quest-modal.ts:486/488/494 | `${escapeHtml(t('key', undefined, '相关引导'))}` — 內嵌 StringLiteral |
| party-panel-view 徽章 | ui/panels/party-panel-view.ts:123/126/127 | `${isLeader ? '<span>队长</span>' : ''}` — 內嵌 StringLiteral |

**修法**：TemplateExpression 分支改為 `ts.forEachChild(node, visit)` 後 return。
TemplateHead/TemplateMiddle/TemplateTail 的 SyntaxKind 不匹配任何檢查分支，
模板結構文字（如 `` `${element}行增伤+…` `` 的「行增伤」）自然跳過、不誤報；
forEachChild 繼續走訪插值內的 StringLiteral / NoSubstitutionTemplateLiteral / JsxText。

**驗證**：
- 修復後單掃 offline-gain-modal + npc-quest-modal → 4 條違規全被抓到（exit 1）
- stat-preview.ts（結構文字行增伤/行减伤）→ ok:true 不誤報（結構文字按計畫歸待改寫清單，已另行手動轉換）
- 合成測試：`${x ? '已達殘卷上限' : ''}行增伤+1` → ok:true（繁體內嵌通過、結構文字跳過）

**附帶修正**：`loadScopeTargets` 的 sourceWhitelist 條目原強制 source 模式；
現按副檔名選模式（.json→json / .csv→csv），讓 `player-final-attr-baselines.json`
這類資料檔能以正確語義納入固定掃描。

## 2. shared 層轉換（14 檔 + tutorial 文檔鏈）

| 檔案 | 違規數 | 內容 | 方式 |
|---|---|---|---|
| value.ts | 65+23 | NUMERIC_STAT_LABELS/ATTR_LABELS/觸發時機標籤 + 23 處模板結構文字（時段:/地圖:/常駐特效:/持續代價:/觸發特效:/乘區/每點X價值/裝備價值…）與內嵌字串（無數值變化/當前/獲得） | converter --write + 手動 Edit |
| constants/gameplay/realm.ts | 79 | 全境界 name/shortName/narrative（淬體境/鍛骨境/練氣前期/金丹後期/飛升…） | converter --write |
| tutorial-mechanics.generated.ts | 267 | 教程全文 | **先轉 docs/tutorial-mechanics.md 再跑 scripts/sync-tutorial-mechanics.mjs 重生成**（單轉 generated 檔會被下次 sync 回退） |
| player-final-attr-baselines.json | 125 | realmName/realmStage 值（78 levels） | converter json 模式（value-only）；technique.ts 以 index 存取、無名稱鍵匹配；generate-player-final-attr-baselines.mjs 讀 realm.ts name/shortName → 未來重生成即繁中，一致 |
| mail.ts | 25 | MAIL_TEMPLATE_DEFS 玩家郵件標題/正文（初入塵世/補償發放/司命臺…）+ GM_MAIL_TEMPLATE_OPTIONS 標籤 | converter --write |
| formation-types.ts | 17 | 陣法名稱/描述/品階（黃階/玄階/地階）+ visual.char 隱/護（純顯示字形，無字元比對消費端） | converter --write |
| map-groups.ts | 5 | STATIC_MAP_GROUPS 組名（雲來鎮/棲真渡/裂鋒原/青蘿谷）— 以 id/prefix 匹配非名稱；mapUnlockId 全 ASCII 已驗證 | converter --write |
| qi.ts | 4 | getQiResourceDisplayLabel（靈氣/煞氣/魔氣） | converter --write |
| constants/gameplay/world.ts | 6 | 時段標籤（殘夜/黃昏/夜闌）+ sourceSkillName 晝夜 + 夜色遮目 desc | converter + 手動 desc 模板 |
| constants/gameplay/technique-arts-strength.ts | 10 | SCALAR_PERCENT_BONUS_SOURCE label 表 | converter --write |
| technique-arts-strength.ts | 3+2 | 未命名術法 + 驗證訊息（含 2 處模板結構） | converter + 手動 |
| content-display-name.ts | 1 | 未知內容 fallback | converter --write |
| enhancement-cost.ts | 1 | 強化推演失敗 Error | converter --write |
| name-visibility.ts | 1 | DEFAULT_INVISIBLE_ROLE_NAME_BASE 隱身（無比對消費端） | converter --write |

shared/src 違規總量：757 → 153（剩餘全為下方分類保留項）。

## 3. client ui/ survey（59 白名單外檔案）

`node scripts/check-traditional.mjs packages/client/src/ui --mode source`：
盲點修復前僅 gm-panel.ts 5 條（GM 面，計畫例外保留簡體）；修復後曝光
offline-gain-modal / npc-quest-modal / party-panel-view 共 7 條，全部已轉繁。
stat-preview.ts:96/105 行增傷/行減傷為模板結構文字（guard 不掃），手動轉換完成。

## 4. 分類保留（不轉換，理由）

| 檔案 | 違規數 | 保留理由 |
|---|---|---|
| build-material.ts | 20 | 材料關鍵詞 includesAny 對照 content JSON tags（簡體 lookup key，learnings Task-2 鐵律） |
| editor-item-catalog.ts | 4 | tags.add('药材'/'异材'/'矿石'/'矿材') 合成 tag key |
| technique-internal-normalization.ts | 12 | 同義詞正規化對照表（對照 AI 生成簡體文本） |
| map-layer-chars.ts / constants/gameplay/terrain.ts / constants/visuals/terrain.ts / house-terrain.ts(mapChar) | 26 | 格子地形字元 = game values（地圖 JSON grid 為排除欄位不轉） |
| map-document.ts | 13 | SUPPORTED_MAP_TILE_CHARS game values（混合檔；驗證訊息為 dev 面） |
| procgen/*（catalog/presets/infinite-themes/chunk-structures） | 29 | 僅 tools/procgen-demo 消費（dev 工具面）+ 家具字形池為格子字形 |
| content-config-validation.ts | 35 | 內容配置載入驗證 Error（dev/GM 運維面，非玩家可見） |
| display-number.ts | 9 | **BLOCKED**：COMPACT_NUMBER_UNITS 後綴（万/亿）被三處斷言鎖定——`packages/shared/scripts/check-display-number.cjs:14-29`（build 鏈）、`packages/server/src/tools/world-runtime-sect-smoke.ts:990/1006`（/當前大陣靈力\s+10万/）、`packages/client/scripts/prove-item-card-constellation-layout.mjs:19/200`（x136万）。server 檔本任務禁改，需協調波次同步三處後再轉（万→萬/亿→億）。F3 實測 HUD「1.5万/1.5万」未列違規。 |

## 5. 已知 fallout（交 orchestrator / F2 sync 任務）

- `world-runtime-damageable-tile-smoke.ts:622/625/628` 斷言 getQiResourceDisplayLabel
  生產輸出 `'灵气'/'木灵气'/'煞气'` → 轉換後產出 `'靈氣'/'木靈氣'/'煞氣'`，斷言失配。
  屬 server 檔（本任務 MUST NOT），且 F2 正在修 sync-smoke-assertions 工具，
  應由該工具精準套用或 orchestrator verify 波次一併同步。
- 其餘排查過的 smoke/proof 引用（realm 名、陣法名、郵件標題、qi 標籤）皆為
  fixture 輸入或 assert message 文字，不受轉換影響；technique-prompt-builder.ts
  有自己獨立的繁體 realm 標籤表，方向一致。

## 6. scope.json

sourceWhitelist 318 → 337 條：新增 client ui/ 3 條（npc-quest-modal / offline-gain-modal /
stat-preview）+ shared 16 條（含 baselines.json 走 json 模式）。

## 7. 驗證結果

```
node scripts/check-traditional.mjs --scope
  → {"ok":true,"violations":[]}（337 條全綠）
pnpm --filter @mud/shared exec tsc --noEmit → EXIT=0
pnpm --filter @mud/client exec tsc --noEmit → EXIT=0
LSP diagnostics：daemon 忙碌逾時（2 次），以 tsc 全專案型別檢查替代（涵蓋全部改動檔，更嚴格）
```

未 commit、未跑 pnpm build/compile/verify 鏈（依任務約束，由 orchestrator 統一執行）。

## 8. 偏差記錄

- mail.ts 的 GM_MAIL_TEMPLATE_OPTIONS（GM 郵件範本下拉標籤）一併轉繁：
  該檔其餘字串皆玩家可見郵件正文，若保留 GM 標籤簡體則整檔無法進白名單、
  玩家面字串失去守衛覆蓋。GM 看到繁體標籤無行為影響，記錄為計畫例外的一點擴張。
- docs/tutorial-mechanics.md 一併轉繁：它是 tutorial-mechanics.generated.ts 的
  生成源，只轉生成物會被下次 sync 回退（見 learnings）。
