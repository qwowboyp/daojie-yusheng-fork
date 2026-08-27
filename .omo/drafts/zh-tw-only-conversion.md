---
slug: zh-tw-only-conversion
status: review-approved
intent: clear
review_required: true
plan_path: .omo/plans/zh-tw-only-conversion.md
plan_sha256: 20070083bcabcf53e518032370fdf4b5d2e7eb6f60a02d6c9e226a2b7cc3849a
review_round_id: zh-tw-only-conversion-r3
round_status: approved
pending-action: none（計畫已核准交付，等待用戶啟動 worker 執行）
review:
  momus:
    status: approved
    workspace_root: X:\workSpace\daojie-yusheng-fork
    runtime_home: null
    target: .omo/plans/zh-tw-only-conversion.md
    round_id: zh-tw-only-conversion-r3
    plan_sha256: 20070083bcabcf53e518032370fdf4b5d2e7eb6f60a02d6c9e226a2b7cc3849a
    launch_id: r3-momus-launch-1
    session: pwsh:6784
    result: APPROVED（0 blocker / 0 note）
  independent:
    status: approved
    workspace_root: X:\workSpace\daojie-yusheng-fork
    runtime_home: null
    target: .omo/plans/zh-tw-only-conversion.md
    round_id: zh-tw-only-conversion-r3
    plan_sha256: 20070083bcabcf53e518032370fdf4b5d2e7eb6f60a02d6c9e226a2b7cc3849a
    launch_id: r3-oracle-launch-1
    session: pwsh:7652
    result: APPROVED（0 blocker / 1 note＝確認 r2 blocker 已消除）
round_history:
  r3:
    plan_sha256_reported: 20070083bcabcf53e518032370fdf4b5d2e7eb6f60a02d6c9e226a2b7cc3849a（兩軌一致；雙無條件 APPROVED——收斂）
    momus: {session: pwsh:6784, verdict: APPROVED, blockers: 0, notes: 0}
    oracle: {session: pwsh:7652, verdict: APPROVED, blockers: 0, notes: 1}
  r2:
    plan_sha256_reported: f2ec30949efef8c09be902336fd1109e096dc25a3fcc6f341a3285c4842f00c3（兩軌一致）
    momus: {session: opencode-r2-momus-launch-1, verdict: APPROVED, blockers: 0, notes: 0}
    oracle: {session: pwsh:11752, verdict: CHANGES_REQUESTED, blockers: 1（typescript root 依賴）, notes: 1（r1 五 blocker 確認修復）}
    fixes_applied: [todo1 root package.json devDependencies + typescript ^5.3.0（同 client :64 版本）+ pnpm-lock 更新；Must NOT 放寬允許改 root package.json/pnpm-lock；acceptance 加 node -e require.resolve('typescript') 於 repo root]
  r1:
    plan_sha256_reported: e6e51609e14f178589a0e49a30acacc9abca678731673e2db80b23ba55b0041f（兩軌一致）
    momus: {session: opencode-momus-review, verdict: INCONCLUSIVE, cause: incomplete_retrieval（Read 於 todo4 長行 2000 字元截斷 + TL;DR 殘留模板註解）}
    oracle: {session: oracle-subsession/pwsh:10928, verdict: CHANGES_REQUESTED, blockers: 5, notes: 3}
    fixes_applied:
      - B1 系統郵件判別式（僅 sender_type='system'；跳過列 byte-identical）＋備份 CREATE TABLE IF NOT EXISTS＋conversion marker 冪等
      - B2 Nest 接線明列（native-http.registry.ts:41,89 provider/路由＋native-gm.controller.ts:277,1179 注入/端點＋dry-run/apply 成對端點）
      - B3 門禁改 verify:release:with-db（todo 8/9；verify:quick dbEnabled:false 證據 verify-quick.js:10,26）
      - B4 雙映像建置（client Dockerfile）＋pre-tw 回滾 tag＋df -h 磁碟預檢＋雙映像回滾
      - B5 Must NOT #4 明確決策：CSV gm.* category 隨全表轉繁、guardrail 僅限硬編碼 GM 面
      - N1 轉換器原始碼模式改 TypeScript AST（插值 template 不自動轉、輸出待改寫清單）
      - N2 詞彙表複製為 server TS 模組＋tw-vocabulary-consistency-smoke
      - N3 todo 10 SQL 佔位改 conversion residual count＋可執行只讀抽樣 SQL
      - entity-facing.ts 路徑修正（src 根層，非 renderer/；自驗 grep 證實存在 :18-34）
      - Momus drift 修正：TL;DR 模板註解移除；todo 1/2/3/4/8/10 長行拆 sub-bullets（消除 2000 字元行截斷）
digest_binding_note: 規劃環境無 shell，plan_sha256 由兩位審核者依 intake 合約自行讀檔計算並回顯（receipt 時比對一致後回填）；不一致 = drift = INCONCLUSIVE。
convergence_ledger:
  round: 3 (cap 5)
  metis_pre_review: 4 BLOCKER + 9 NOTES — 已折入
  r1_accepted_blockers: [B1 郵件範圍/冪等, B2 GM 接線, B3 with-db 門禁, B4 client 映像, B5 GM CSV scope]（r2 oracle 確認全修復）
  r2_accepted_blockers: [B6 root typescript 依賴（reproducible_broken_flow）]（r3 待驗）
  ledger_frozen_after: round 1
approach: <fill: the approach you intend to plan>
---

# Draft: zh-tw-only-conversion

## Components (topology ledger)
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
| id | outcome | status | evidence |
| --- | --- | --- | --- |
| C1 繁體轉換工具鏈 | 一次性 cn→tw 轉換腳本（詞彙表 + opencc）+ 永久 guard（簡體字元偵測器進驗證鏈） | active | scripts/generate-i18n.mjs:21, scripts/generate-content-name-catalog.mjs:20 |
| C2 內容真源繁體化 | server data/content 93 檔 + data/maps 40 檔全部文字欄位轉繁體（id/數值不動） | active | packages/server/data/content/**/*.json, data/maps/*.json |
| C3 UI 文案真源繁體化 | zh-CN.csv 3973 keys 轉繁體、i18n 生成管線改單語系 | active | packages/client/src/content/i18n/zh-CN.csv:1-3974, scripts/generate-i18n.mjs |
| C4 伺服器硬編碼文字繁體化 | server 源碼中玩家可見簡體字串全數轉繁（log/內部註解除外） | active | 待 bg 統計（runtime/world/world-runtime-tick-dispatch.service.ts:279 等） |
| C5 客戶端硬編碼文字繁體化 | client 面板中未走 t() 的簡體字面值全數轉繁 | active | 待 bg 統計 |
| C6 單語系化拆除 | 移除 zh-TW.overrides 空表、content-name-catalog 目錄、語言切換 UI；shared locale 常數收斂 | active | zh-TW.overrides.csv:1（空）、content-name-locale.ts、settings-panel.ts:444-457,814-828、SettingsPanel.tsx:541、shared/src/constants/ui/storage.ts:29-38 |
| C7 DB 既有簡體快照遷移 | GM 一鍵相容轉換：player_mail(_archive) title/body/sender_label 簡→繁 | active | mail-persistence.service.ts:737-806（title/body 欄位）、gm/compat-conversions/ 模式 |
| C8 驗證與部署 | verify:quick / verify:client / build:shared 全綠 + LXC 部署流程 + 上線驗證 | active | .omo 契約、AGENTS.md §0.5 |
| C9 字型堆疊補 TC | UI_TEXT_FAMILIES 加入 TC 字型（Microsoft JhengHei / PingFang TC / Noto Sans TC / Noto Serif TC） | active | constants/ui/text.ts:12-18（bg_52469a53 發現，全 SC 無 TC） |

## Open assumptions (announced defaults)
<!-- assumption | adopted default | rationale | reversible? -->
| assumption | default | rationale | reversible |
| --- | --- | --- | --- |
| 雙語 vs 單語 | **單語系繁體**（用戶已預授權「太麻煩就只留繁體」） | zh-TW.overrides.csv 為空＝零人工維護；server 硬編碼簡體無任何繁體路徑；opencc 詞彙誤轉需永久維護 overrides | 部分（保留 i18n key 架構，恢复雙語可行） |
| 簡體檔名/目錄名 | **不改名**（练气期/青竹林.json 等保持原樣，只轉 JSON 內文字欄位） | 檔名對玩家不可見；改名動 git history + config-editor + tools 引用，風險大收益零 | 是（日後可單獨 rename） |
| 代碼註解/內部 log/文檔 | **不轉**（僅玩家可見文字） | 內部資產，轉了製造百萬行 diff 無玩家價值 | 是 |
| config-editor UI 文字 | **不轉**（開發工具），但未來內容產出必須繁體（由 guard 把關） | 內部工具；guard 在 build 期攔截簡體內容 | 是 |
| 詞彙映射表 | 建立 `tw-vocabulary.mjs`（游戏 IT 詞彙 cn→tw 映射，先詞後字兩段式轉換） | opencc 純字級轉換會產出「服務器→服務器」而非「伺服器」類錯詞 | 是（表可持續擴充） |
| 玩家自輸入（名稱/聊天/郵件正文用戶輸入） | **不轉換** | 用戶生成內容保持原樣是自然界限 | 是 |
| 郵件模板 fallback | DB 舊郵件經 GM 指令一次性轉換（冪等、審計、先備份） | 符合 AGENTS.md §10「相容轉換統一做成 GM 快捷指令」 | 是（先備份可回滾） |

## Findings (cited - path:lines)
1. 現行 i18n 管線：`packages/client/src/content/i18n/zh-CN.csv`（3973 keys + 表頭，共 3974 行）→ `packages/client/scripts/generate-i18n.mjs:215-218`（opencc cn2tw 自動轉 + `zh-TW.overrides.csv` 覆蓋，**overrides 為空檔只有表頭**）→ `src/constants/ui/i18n.generated.ts`。
2. 內容名稱目錄：`scripts/generate-content-name-catalog.mjs:20`（opencc cn→tw）讀 `packages/server/data/content/**` 生成 `packages/client/src/constants/world/content-name-catalog.generated.json`；客戶端 `content-name-locale.ts:48-62` 只在 zh-TW 時查表，查不到回退簡體。
3. 預設語系已是 zh-TW：`packages/shared/src/constants/ui/storage.ts:38` `DEFAULT_CLIENT_LOCALE = 'zh-TW'`；localStorage key `mud:language-preference:v1`（:29）。
4. 語言切換 UI 兩處：`packages/client/src/ui/panels/settings-panel.ts:444-457,814-828`、`packages/client/src/react-ui/panels/settings/SettingsPanel.tsx:541`。
5. 通知渲染鏈：server `queuePlayerNotice(playerId, text, kind, ...)`（world-runtime-tick-dispatch.service.ts:279）→ 客戶端 `structured-notice-display.ts:23-36`：有 i18n key 走 tLoose，**無 key 的 rawText 原樣顯示（簡體洩漏主通道）**。
6. 內容真源規模：`packages/server/data/content/` 93 個 JSON（items/monsters/techniques/technique-buffs/quests/enhancements/forging/alchemy/building-runtime + 頂層 10 檔）、`packages/server/data/maps/` 40 個 JSON（含 NPC dialogue、地標 name/desc）。
7. 名稱冗餘快照：monsters `drops[].name`、quests `reward[].name`、technique skills effects 內嵌 buff `name/desc/shortMark`（如 凡人期/术法/黄阶.json:48-50）→ 同一名詞多檔多處，轉換必須全覆蓋。
8. 檔名/目錄名為簡體：`data/content/techniques/练气期/术法/玄阶.json`、`data/content/monsters/青竹林.json`、`data/content/quests/序章_主线.json` 等。
9. DB 文字快照：`player_mail` 表 `title/body/sender_label` 欄位存 fallback 字面文字（mail-persistence.service.ts:737-806 INSERT）；另有 `player_mail_archive`。廣播郵件以 payload hash 去重（:1012-1021），改文字只影響新插入。
10. 既有資料損壞：`data/maps/yunlai_town.json:1798` 含 U+FFFD 替換字元（"给穷苦人���底子的"）——轉換工具須偵測通報而非靜默處理。
11. GM 相容轉換模式已存在：`packages/server/src/gm/compat-conversions/types.ts` + conversions/（8 個先例），可承載郵件文字轉換。
12. server 亦有硬編碼玩家可見字串：`player-display-name.ts:53,81,100`（'未知玩家'/'修士'/'未知成员'）等。
13. 無任何簡體字元偵測工具（scripts/ 下僅 generate-content-name-catalog.mjs 提及繁體）。
14. config-editor（packages/config-editor/AGENTS.md）為地圖/怪物/技法/檔案/服務五頁內容生產工具，直接讀寫內容 JSON。
15. 郵件 CSV 工具：`packages/client/scripts/i18n-csv.mjs`（key CRUD，寫 zh-CN 列）——轉換後繼續用於繁體維護。
16. 生成目錄同源洩漏：`packages/client/src/constants/world/editor-catalog.generated.json` 等三個生成檔直接內嵌簡體名稱（:160 "残丹唤灵诀" 等）——源頭轉繁後重生成即解決，無須單獨轉換。
17. server 硬編碼通知 text 熱點（自查）：`text: '中'` 48 處/6 檔 + `text: \`中\`` 12 處/3 檔（player-progression.service.ts 38 處最集中）；直接 inline 中文於 queuePlayerNotice 僅 smoke 工具 6 處。
18. client 硬編碼渲染熱點（自查）：escapeHtml/textContent/placeholder 等直接接中文約 187 處/25 檔（gm.ts 69 屬 GM 面、PrototypeApp.tsx 23 屬原型；玩家面約 100 處）。另有 guided-tour.ts 620 行 titleFallback/bodyFallback。
19. shared 包中文 1041 行幾乎全為註解；字串值僅 3 處：`item-stack.ts:21` '未知物品'、`name-visibility.ts:9` '人'、`:13` '隐身'。
20. HTTP 層中文訊息約 109 行/15 檔（native-player-auth 等玩家可見登入錯誤 + GM 面）。
21. 語言切換確認彈窗 key：`settings.language.reload-confirm` 等（settings-panel.ts:453）。
22. 【bg_1dd5666f】server 中文發射點精確分類：純 text 無 key enqueueNotice **2 處**（world-gateway-inventory.helper.ts:74-77 `你摧毁了...`、:99-102 `背包已整理`）；buildStructuredNotice 中文 fallback **77 處/25 檔**（pending-command 20、use-item 13、player-combat 10 為最）；text+structured.key 雙格式 **15+**（player-progression.service.ts:714 起）；key+text 物件返回 6 處（pending-command:1012-1022）；craft mutation 純 text 無 key **≥2**（craft-panel-runtime.service.ts:1582,1987）；戰鬥長句 text 2 處（player-skill-dispatch:1599-1613）；actionLabel '攻击' ×8（basic-attack/monster-action-apply）。
23. 【bg_1dd5666f】**HTTP 例外中文 508 處**：BadRequestException 420、NotFoundException 66、ForbiddenException 10、UnauthorizedException 9、HttpException 1；玩家可見約 424（runtime 服務經 socket 直達）、GM 專屬約 84。代表：`'玩家不存在'`、`'待执行指令过多，请稍后再试'`。
24. 【bg_1dd5666f】**i18n key 缺漏 4 個**：`notice.combat.low-priority`（僅 smoke）、`notice.item.open-panel`（**生產玩家可見**，world-runtime-use-item.service.ts:129）、`notice.technique.activity-complete`（僅 smoke）、`notice.test`（僅 smoke）。伺服器去重 notice.* key 共 94，客戶端 CSV 有 295。
25. 【bg_1dd5666f】opencc 運行時使用 = 0，僅 build 期兩腳本。docs/mechanics 無本地化文檔；`docs/plans/通知聚合计划.md` 與 `前端技术性文本排查报告.md` 為僅有相關文檔。
26. 【bg_52469a53】**字型堆疊缺 TC**：`constants/ui/text.ts:12-18` UI_TEXT_FAMILIES 全為 SC 字型（PingFang SC / Noto Sans SC / Microsoft YaHei / Noto Serif SC），**零 TC 字型**（PingFang TC / Microsoft JhengHei / Noto Sans TC / Noto Serif TC）——繁體字在這些字型下可能缺字掉 fallback。buildCanvasFont（text.ts:155-160）影響全部 Canvas/Pixi 渲染。
27. 【bg_52469a53】client 硬編碼總量：含 CJK 行 15,675 行/~440 檔（含註釋）；UI 字面值熱點 attr-panel.ts:116-132（CRAFT_EFFECT_SKILL_LABELS '炼丹'/'炼器' 等 12 詞）、gm.ts 1,915 行、gm-map-editor.ts 794 行、PrototypeApp.tsx 306 行。
28. 【bg_52469a53】content-name-catalog 規模：items=301、monsters=97、techniques=71、quests=58、realmLevels=127、buffs=21，合計 675 條全為 opencc 機械轉換無人工校對。
29. 【bg_52469a53】無任何 i18n 覆蓋率校驗腳本（prove-i18n / audit-i18n / coverage 皆不存在）；generate-i18n.mjs 的 validateLocales 只驗 key 集合與占位符一致。
30. 【bg_52469a53】locale 純客戶端 localStorage，無伺服器持久化、無跨設備同步；切換需整頁 reload。

## Decisions (with rationale)
- D1（待核可）：採單語系繁體，拆除雙語轉換層。理由見 assumption #1。
- D2：轉換策略＝「詞彙表先行 + opencc 字級收尾」兩段式，一次性腳本 + 生成後 guard。opencc 單獨用會產生台灣不通用的錯詞。
- D3：guard 形態＝`scripts/check-traditional.mjs` 對內容 JSON / i18n CSV / 指定源碼白名單檔做 `cn2tw(s) === s` 冪等檢查，掛進 verify:client 與 verify:quick。
- D4：DB 郵件遷移走 GM compat-conversions 模式（冪等、審計、回讀驗證）。
- D5：i18n key 與 CSV 結構保持不變（key 是協議資產），只改文字值——避免觸發 4000 鍵的客戶端呼叫點改動。

## Scope IN
- packages/server/data/content/**、data/maps/** 文字欄位繁體化
- packages/client/src/content/i18n/zh-CN.csv 繁體化 + i18n 生成管線單語系化
- server 源碼玩家可見硬編碼字串繁體化（含 GM 回應、HTTP 錯誤訊息中玩家可見者）
- client 源碼硬編碼簡體字面值繁體化
- 語言切換 UI 移除、content-name-catalog 目錄與查表層移除、shared locale 常數收斂為單語系
- GM 一鍵 DB 郵件簡→繁轉換
- 簡體偵測 guard 進驗證鏈
- 上線部署與線上驗證

## Scope OUT (Must NOT have)
- 不改任何 id / 數值 / 機制 / 協議欄位語義（只動文字值）
- 不改簡體檔名與目錄名
- 不轉代碼註解、內部 log、docs 文檔
- 不轉 config-editor / gm 工具的 UI 介面文字
- 不轉玩家自輸入內容（名稱、聊天、用戶郵件正文）
- 不新增玩法、不改面板職責、不動 docker-stack
- 不做多語系擴展（en 等）

## Open questions
- Q1（owner，gate 提問）：單語系繁體確認（建議：是；已預授權條件成立——雙語維護成本證據確鑿）
- Q2（owner，gate 提問）：DB 舊郵件 title/body/sender_label 是否遷移（建議：遷移，GM compat-conversion 指令）
- Q3（已解）：server 硬編碼熱點 ≈ 60 處/8 檔 + HTTP 109 行；client 玩家面 ≈ 100+ 處 + guided-tour fallback
- Q4（已解）：structured notice keys 由 zh-CN.csv 生成期自動產出 TW 行，無缺行個案；風險在詞彙品質而非覆蓋

## Approval gate
status: approved (2026-08-19，用戶三叉全數核可)
- Fork 1 單語系繁體：**是**
- Fork 2 DB 郵件遷移：**遷移（GM 一鍵轉換）**
- Fork 3 測試策略：**tests-after + guard**
approach: 單語系繁體化——真源一次性兩段式轉換（詞彙表 + opencc），拆除雙語轉換層（overrides/catalog/語言切換），GM 指令遷移 DB 郵件快照，新增簡體偵測 guard 進驗證鏈
pending-action: write and review .omo/plans/zh-tw-only-conversion.md（寫計畫 → Metis 缺口分析 → 雙軌高精度審核 momus+oracle）
test-strategy: tests-after（guard 腳本即測試 + 既有 verify:quick / verify:client / build:shared + smoke 全綠）

### 補充發現（bg_728d6bb0）
31. 內容條目數精確值：items=301、monsters=97、quests=58、techniques=71、realmLevels=127、buffs=21；CSV 資料列 3967（非 3973）。
32. Registry 載入路徑解析：`common/project-path.ts:34` resolveProjectPath；各 registry loadAll 行號（item-template.registry.ts:33、technique:55、buff:59,78、formation:18、content-template.repository.ts:326,358,600,751,757,798）。內容全在檔案系統，無 DB 內容。
33. **client prove-\* 腳本直接讀 zh-CN.csv 斷言關鍵字**（prove-sect-application-page-request-lifecycle.mjs:22,249 等）——CSV 轉繁 + 改名後必須同步更新這些腳本。
34. 生成產物：`data/generated/monster-runtime-stats.json`（159KB，server compile 期由 compile-monster-tendency-stats.mjs 重生成）；`data/runtime/map-monster-runtime-state.json`（runtime 快取，repository.ts:600 讀取）——需在部署驗證中確認刷新。
35. client `content/local-templates.ts`（437 條）由 generate:item-sources 從 server 內容重生成——源頭轉換後 prebuild 自動解決。
