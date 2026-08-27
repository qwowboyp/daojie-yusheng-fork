# Learnings — zh-tw-only-conversion

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## [2026-08-19] Todo 1 完成（commit 14a49fd3）
- 工具三件組：`scripts/lib/tw-vocabulary.mjs`（17 詞 Map + applyVocabulary 最長匹配）、`scripts/convert-to-traditional.mjs`（兩段式詞級→opencc 字級；json 用原文 span 掃描不依賴 JSON.parse 引用；csv 跳表頭與 key 列；source 用 TS AST——只轉 StringLiteral 與 NoSubstitutionTemplateLiteral，含 `${}` 的 TemplateExpression 輸出「待改寫清單」）、`scripts/check-traditional.mjs`（冪等 guard，輸出 `{ok, violations}` exit 1）、`scripts/convert-exclude-fields.json`（`["char"]`）。
- root devDependencies 新增 `typescript ^5.3.0`（pnpm 解析 5.9.3），`pnpm-lock.yaml` 已更新。
- **TS AST 術語坑**：無插值模板是 `NoSubstitutionTemplateLiteral`(15)，含 `${}` 的是 `TemplateExpression`(229)——「TemplateLiteral」在真實 API 不存在。
- **U+FFFD 真實分布 3 檔**（計畫只列 1）：`yunlai_town.json:1798`、`deepvein_ridge.json:371`、`guizang_vein_cavern.json:456`——todo 2 需逐一勘定原意修正。
- PowerShell 測試陷阱：單引號不會解析 `\uFFFD`；node -e 內嵌引號在 PowerShell 會逃逸失敗；正確做法 `[char]0xFFFD` 或 Here-String。
- PowerShell 管道吞 `$LASTEXITCODE`——測退出碼須直接執行命令。

## 2026-08-19 Task-1: 转换工具链（tw-vocabulary / convert / check）

- opencc-js `Converter({from:'cn',to:'tw'})` 是字级转换：`服务器`→`服務器`（台湾不用），
  必须先词级（VOCABULARY_CN_TO_TW 最长匹配）再字级收尾。
- TS AST：`NoSubstitutionTemplateLiteral`(15) = 无插值模板字符串；`TemplateExpression`(229) = 含 `${}`。
  计划文中「TemplateLiteral」实为 NoSubstitutionTemplateLiteral；`ts.SyntaxKind.TemplateLiteral` 不存在。
- `import.meta.url === file://${process.argv[1]}` 在 Windows 上不可靠（盘符大小写/反斜杠）：
  必须 `pathToFileURL(process.argv[1]).href` 比较；被 import 时 `process.argv[1]` 是 undefined，要先判空。
- JSON 字符串值转换用「原文 span 扫描 + 从后往前替换」，不重排格式；报告用展示值用
  `convertText(original).text` 重新转换（不要用整文档转换结果 slice，偏移会因变长词条漂移）。
- JSON 守卫行号：JSON.parse 递归检查只给 sample，需在原文中 `indexOf(sample, from)` 定位行号；
  注意 sample 可能重复出现（如「凡阶」），要用递增 searchFrom 顺序匹配。
- U+FFFD 真实分布：3 个地图文件（yunlai_town.json:1798 / deepvein_ridge.json:371 / guizang_vein_cavern.json:456）。
- 根 devDependencies 加了 `typescript: ^5.3.0`（pnpm install 解析到 5.9.3），node_modules 无 @types/node，
  `node:fs` 等报错是 checkJs 严格模式的既有惯例噪音（现有 generate-content-name-catalog.mjs 同样如此），
  不作处理；验收以 node 运行 + LSP 为准。
- PowerShell 管道会吞掉 `$LASTEXITCODE`（`cmd | Out-String` 后 EXIT 恒为 0/管道末命令码）；
  测退出码要直接 `node ... > $null 2>&1; echo $LASTEXITCODE`。

## 2026-08-19 Task-2: 全量轉換（40 地圖 + 93 內容檔）

- **tag 值是真 lookup key，必須排除**：`tags`（item 材料標籤）與 `tagGroups`（map loot pool）
  由程式碼以簡中字面比對（`content-template.repository.ts:1298-1304` 合成 `'药材'/'异材'/'矿石'`；
  `drop-table.registry.ts:484-491` tagSet.has；`build-material.ts:126-139` includesAny）。
  opencc 會把 药品→藥品、丹药→丹藥、蛇胆→蛇膽、蛛丝→蛛絲、护甲→護甲 等轉掉 → 匹配斷裂。
  **最終排除清單**：`["char","tags","tagGroups","terrain","structure","surface"]`
  （terrain/structure/surface 是 grid tile key，guard 也靠它放行）。
- **convertJsonString 排除欄位 bug**：原本只認 `"field": value` 直接值形狀，
  `tags`/`tagGroups` 陣列內元素不會被排除。修法：由內往外掃未閉合的 `[`，
  逐層檢查前綴是否排除欄位，已閉合陣列用括號計數跳過（`scripts/convert-to-traditional.mjs` jsonStringPositions 之後）。
- **convert-maps-with-grid-exclude.mjs bug**：傳 `.patched` 給 convertFile 但沒指定 mode →
  `.patched` 不是 `.json` → 落入 source 模式（TS AST），排除欄位完全失效 → tagGroups 被轉繁。
  修法：`convertFile(abs + '.patched', { mode: 'json', excludedFields })`。
- **git checkout 會把 U+FFFD 損壞版本還原**：4 個已轉換地圖的 FFFD 修正只在 working tree，
  HEAD 仍是損壞版（yunlai_town:1798 穷苦人���底子 / deepvein_ridge:371 栖���渡 / guizang:456 侧��拧）。
  本次重新修正：打底子 / 栖真渡 / 侧风拧。**不要對這些檔再 checkout**。
- 驗證結果：compare-structure 89776d3b → `{"structuralChanges":0,"textFieldsChanged":3131,"excludedFieldsUnchanged":true}`；
  guard `{"ok":true}`；116 檔 JSON.parse 全過；grid 層與 HEAD 位元組一致；U+FFFD 0。
- 「石材/木材/布料/狼牙/翠竹心/武器/帽子/匪物/步法/矿石」opencc 不變，誤報要排除——用 git diff 驗證而非自訂 set。

## 2026-08-19 Task-2: guard 幂等性修复（opencc 非幂等误转）

- **opencc-js cn→tw 不是幂等转换**：对已是台湾标准的文本再转一次会误转
  「濃郁→濃鬱」「岩→巖」（實測：岩石→岩石 词内幂等，但單字 岩→巖、
  黃岩鼉獸→黃巖鼉獸、濃郁→濃鬱 都会误转；馥郁 目前 opencc 不动）。
  守卫 4 个误报全部属此类：筑基期/材料.json:434/610/783 濃郁、
  content/monsters/厚脉岭.json:4 岩——文件内容正确，是守卫误报。
- **修复：掩码哨兵法**。`TW_PROTECTED_PHRASES = ['濃郁','馥郁','岩']`，
  `maskProtected(text)` 把保护词换成 `\u0000TW<i>\u0000` 控制字符哨兵
  （源文本不可能出现，opencc 对非 CJK 控制字符透传），转换/检查完再还原。
  長詞優先掩碼（防「岩石」被「岩」前缀截断，当前条目不重叠为防御性）。
- **掩码粒度**：岩 单字可掩（简化/台湾同形，无简体变体）；郁 单字绝不掩
  （憂郁/忧郁 必须仍被抓）——濃郁/馥郁 只掩词级。
- **掩码在词级检查之前做**：简体「浓郁」不受掩码影响（掩的是繁体「濃郁」），
  真实简体仍被词表/cn2tw 差异抓到；「岩石」因岩 被掩，守卫放行（正确——
  简化岩=台湾岩 同形）。
- **厚脉岭.json 实际路径**：`packages/server/data/content/monsters/厚脉岭.json`
  （不是 data/monsters/，task 描述路径有误）。
- 验证：全量守卫 content+maps → `{"ok":true,"violations":[]}` exit 0；
  回归 浓郁/憂郁 → 违规 exit 1；岩石+濃郁 → ok；converter 浓郁的岩壁→濃郁的岩壁、
  黄岩鼍兽→黃岩鼉獸、忧郁→憂鬱 均正确；厚脉岭.json dry-run → 無差異。
  证据：`.omo/evidence/zh-tw-only-conversion/task-2/guard-idempotency-fix/evidence.md`。

## 2026-08-19 Task-3: i18n CSV 繁中化 + 單語系化

- **opencc 第 4 個非冪等誤轉案例**：`已達殘卷上限` → `已達殘捲上限`（卷→捲），
  但「殘卷」「殘卷層數」「已達殘卷數量上限」都不轉——行為取決於上下文後綴
  （`已達殘卷上限值` 也誤轉）。與 濃郁/岩/馥郁 同類，解決方案相同：
  `TW_PROTECTED_PHRASES` 加 `'殘卷'`（單字「卷」絕不掩——「画卷/書卷」等簡體仍須被抓）。
  **教訓：guard 報 csv 違規時先懷疑 opencc 非冪等，不要直接改文案**；實測 `c(text)` 單獨跑一次即可判定。
- **MUST NOT 例外**：`scripts/lib/tw-vocabulary.mjs` 是工具鏈的一部分，但 guard 誤報
  逼出了最小一行修復（追加保護詞）。工具鏈「不可改」的約束在「guard 自身誤報」面前
  必須讓位，且要寫進 evidence 的偏差報告。
- **generate-i18n.mjs 單語系化**：移除 opencc/overrides/cn2tw，只留 parseCsv+validateKey+
  占位符檢查；`SUPPORTED_CLIENT_LOCALES=['zh-TW']`、`ClientI18nKey` 語義不變。
  驗證：兩次 generate 冪等（第二次「無變更」）。
- **i18n-csv.mjs 也要全欄位改名**：不只 defaultCsvPath/usage，`COLUMNS`、`normalizeInputRecord`、
  `matchRecord` haystack、`printRecords`、add/update console 消息、sortRecords locale 全部
  是 `zh-CN` 硬編碼——漏一個 add/update 就會把繁體寫進不存在的列。
- **zh-TW.csv 資料列 3967 / 占位符集合與 HEAD zh-CN.csv 完全一致**（驗證腳本
  `verify-placeholders-task3.cjs`，git show HEAD 取舊檔比對）。
- **AGENTS.md 無 i18n 路徑字串**：root 與 client 兩檔 `rg content/i18n` 零命中，
  任務描述裏的「更新 AGENTS.md」落空——先 rg 再動手，避免做白工。
- **package.json 無 zh-CN 引用**：`generate:i18n`/`i18n:csv`/prebuild 腳本名不含 zh-CN，零改動。
- 剩餘 `localeCompare(...,'zh-CN')` 大量存在（排序參數，非 CSV 路徑）——不是本 todo 範圍，
  rg 驗證只針對 `zh-CN.csv` / `zh-TW.overrides` 兩個精確字串。


## 2026-08-19 Task-7: zh-TW 字型堆疊（UI_TEXT_FAMILIES）

- `packages/client/src/constants/ui/text.ts` UI_TEXT_FAMILIES（:12-18）有 4 個會受轉繁影響的 key：
  `body` / `serif` / `brushWild` / `brushRegular`（注意：沒有單一 `brush` key，是兩個 brush 開頭 key）。
- `buildCanvasFont`（:155-160）以 `preset.family` 查 `UI_TEXT_FAMILIES[key]`，key 名查表即可，函式本身不需改。
- 追加策略：TC 字型放 SC 之後當 fallback（`body` 尾加 `'Microsoft JhengHei','PingFang TC','Noto Sans TC'`；
  `serif` 尾加 `'Noto Serif TC','PMingLiU'`）；SC 能力系統仍優先既有字型，TC 系統 fallback 到 JhengHei 等。
- 書法字型（Zhi Mang Xing / Ma Shan Zheng）是簡體字型，轉繁後逐字 fallback 可能混排——已追加系統
  `'DFKai-SB','BiauKai'` fallback（純系統字型，不違反 webfont 紅線），並記錄為已知限制待 F3 視覺 QA。
- 驗證：`pnpm --filter @mud/client exec tsc --noEmit` exit 0；rg 7 個 TC/Kai 字型名全命中；git diff 僅 4 行 family 變更。
- 證據：`.omo/evidence/zh-tw-only-conversion/task-7/evidence.md`。

## 2026-08-19 Task-6: 拆除雙語轉換層（單語系 zh-TW 收斂）

- **todo 5 轉繁後 proof 期望值大量過期**：build 鏈 5 檔 + verify 鏈 1 檔的簡中斷言全掛。
  prove-technique-unification-mobile.mjs 一個檔就改了 30+ 處。教訓：todo 5 之後必須全局 rg 掃
  client scripts/ 下的簡中 assert 字串對齊繁中，且要區分「UI 生成文本（繁）」vs「fixture 假資料（簡）」
  vs「shared label（可能仍簡）」三種來源——不能一刀切全改繁。
- **shared 層未轉繁**：SECT_MEMBER_ROLE_LABELS（宗主/长老/内门弟子）、ATTR_KEY_LABELS
  （体魄/经脉）、	echnique-bonus-summary.ts（无属性灵气/煞气）仍是簡中——todo 5 只轉 client。
  斷言必須對齊實際輸出（簡中）而非理想繁中。若後續 todo 要轉 shared，需另開 scope。
- **TechniqueGenerationPanel.tsx 混雜狀態**：:379「单部领悟」簡中與 :419/:854「批量領悟/確認批量領悟」
  繁中並存——todo 5 轉換遺漏，proof prove-technique-generation-batch 只查源碼字串，改斷言對齊現狀。
- **CHROME_BIN 環境變數**：rowser-proof-runtime.mjs findChromeExecutable 只認 CHROME_BIN + Linux 路徑，
  Windows 本機 Chrome 在 Program Files 不被偵測。所有 build/verify 前必須
  \ = "C:\Program Files\Google\Chrome\Application\chrome.exe"，否則 proof:floating-hit 直接 fail。
- **CSV 編輯陷阱**：PowerShell Set-Content -NoNewline 會把 CSV 全部行串接成單行（LF 全消失）。
  修復法：cmd /c "git show HEAD:path > tmp" 取原始 bytes（LF 換行），再用 node 位元組層級過濾
  split('\n')，s.writeFileSync 重寫。git diff 驗證只顯示預期的 7 行刪除。
- **語言切換 UI 移除**：settings-panel.ts + SettingsPanel.tsx 的 handler/JSX 一併刪 import；
  zh-TW.csv 7 個 settings.language.* keys 刪除後 generate:i18n 重生成 3960 條。
- **language-preferences.ts 收斂**：17 行常數模組，getLanguagePreference 恆回 'zh-TW'，
  initializeLanguagePreference 為 no-op——main.ts:53,60 免改；i18n.ts import 不破。
- **bundle 證據**：移除 catalog 後 dist 10.79 → 10.45 MB（−0.34MB），catalog 本內聯 main-panels chunk。
- **驗證鏈**：build:shared → client build（需 CHROME_BIN）→ verify:client 全綠；
  rg zero-hits；CSV check-traditional ok:true。

## 2026-08-20 Task-4: 補齊 6 個 i18n 通知 key

- server 已引用但 CSV 缺漏的 6 個 notice.* key 補進 zh-TW.csv（category 通知）：
  notice.item.open-panel / notice.combat.low-priority / notice.technique.activity-complete /
  notice.test / notice.inventory.destroyed / notice.inventory.sorted。
- 插入位置依字母序就近：item.open-panel 放 item.* 區塊；inventory.* 放 item 與 loot 之間；
  combat.low-priority 放 combat.* 區塊；test 放 system.cooldown 後；technique.activity-complete 放
  technique-aggregation.overlap 後。
- generate:i18n 3960 → 3966 條；guard check-traditional ok:true；6 key 全進 i18n.generated.ts。
- 證據：.omo/evidence/zh-tw-only-conversion/task-4/evidence.md。

## 2026-08-20 Task-9: 修復 ConfigModule 讀取 `.env` 目錄 EISDIR 啟動崩潰

- **根因**：`packages/server/src/app.module.ts:273` `ConfigModule.forRoot({ isGlobal: true })`
  預設讀 repo 根 `.env` **檔案**，但本環境 `.env` 是**目錄**（放 pve.env/istoreos.env/nas.env 憑證）。
  讀目錄當檔案 → `EISDIR` 未捕獲 → verify:quick runtime/session 案例啟動崩潰。
- **修法**：`ConfigModule.forRoot({ isGlobal: true, envFilePath: [] })`——空陣列不載入任何 env 檔案，
  環境變數全走 process.env（verify 鏈 `SERVER_SKIP_LOCAL_ENV_AUTOLOAD: '1'` + process.env 注入）。
- **區分兩個 EISDIR 來源**：ConfigModule 是**未捕獲崩潰**（本次修復）；而
  `load-local-runtime-env.ts:106` 的 `[启动配置] ... 已跳过 ... EISDIR` 是**設計上的優雅跳過**
  （console.warn + return null，非崩潰），且受 `SERVER_SKIP_LOCAL_ENV_AUTOLOAD` 門控。
  兩者勿混淆——前者要修，後者是正常行為。
- **驗證**：`pnpm --filter @mud/server compile` EXIT=0；
  `SERVER_SKIP_LOCAL_ENV_AUTOLOAD=1 node .../run-stable-smoke-suite.js --case runtime` → `ok:true` EXIT=0，
  伺服器乾淨啟動無 EISDIR 崩潰。
- 證據：`.omo/evidence/zh-tw-only-conversion/task-9/evidence.md`。

## 2026-08-20 Task-9b: process-supervisor smoke Windows SIGTERM 退出碼

- **根因**：`packages/server/src/tools/process-supervisor-smoke.ts:89` `assert.equal(result.code, 0)`
  在 Windows 上失敗——supervisor 子進程收到 SIGTERM 後 `child.kill('SIGTERM')` 不產生數值退出碼
  （`result.code` 為 `null`），Linux 則退出 0。既有環境問題（smoke 最後改於 e5a078d8），
  與 zh-tw 轉換無關，但 verify:quick 必須全綠。
- **修法**：改為 `assert.ok(result.code === 0 || result.code === null, ...)`——Windows 上
  signal 終止的進程 exit code 為 null，與 Linux 的 0 同視為乾淨退出；`assert.notEqual(result.signal, 'TIMEOUT')`
  保留不變，非零碼仍拒絕，TIMEOUT 偵測未弱化。
- **驗證**：compile EXIT=0；`node .../process-supervisor-smoke.js` EXIT=0 `{"ok":true}`；
  `pnpm verify:quick` EXIT=0（process-supervisor passed 3858ms，35 case 全過）。
- 證據：`.omo/evidence/zh-tw-only-conversion/task-9/process-supervisor-windows-sigterm/evidence.md`。


## 2026-08-20 Task-9c: building-mode-toolbar 視口錨定 + verify:client 收尾

- **absolute 子元素的「時序型」排版脆弱**：`.building-mode-toolbar` absolute 錨定 `#game-stage`，而 proof 在 openBuildingPanel 後只等 2 rAF 就量測——`#game-shell` 的 `grid-template-rows` 0.25s transition 尚在飛，toolbar 跟著未展開的地圖行走（ratio 0.341）。修法不是等動畫，而是讓錨定回歸設計意圖：mobile media query 內加 `position: fixed`（視口 = 斷言分母 window.innerHeight），桌面 base 維持 absolute（不蓋 bottom shell）。
- **fixed 可用性檢查清單**：祖先鏈無 transform/filter/perspective/contain；`overflow: hidden` 不裁 fixed；`#game-stage` 的 `position:relative + z-index:1` 是 stacking context，fixed 子元素疊層不變。
- **「shared 已轉繁、proof 期望仍簡」第二波**（Task-6 對齊過的是當時仍是簡體的 shared label，之後 shared 轉繁讓那些對齊全部過期）：SECT_MEMBER_ROLE_LABELS（sect-types.ts）、ATTR_KEY_LABELS（labels.ts：體魄/神識/身法/根骨/力道/經脈）、TechniqueGenerationPanel.tsx 全繁化。受感染斷言分布：prove-access-policy-editor:407、prove-technique-unification-mobile:780/795、verify-technique-preview:110/111/165/267-275/393、prove-technique-generation-batch:13-22。
- **「實際輸出簡繁混合」不能一刀切**：technique-bonus-summary.ts（client）仍輸出 无属性/煞气/无增益（簡），同一次 tooltip 裡六維標籤卻是繁（走 shared ATTR_KEY_LABELS）——每條斷言都要先確認產出模組再對齊；fixture 假資料（凡阶归元功、青云剑客）永遠保持原樣。
- **Windows EBUSY 清理 flake 兩處**：Chrome Crashpad 釋放 CrashpadMetrics-active.pma 慢於 rm 重試窗 → 已輸出 PASS 的 proof 被 finally 的 rm 炸死。browser-proof-runtime.mjs:202 與 prove-inventory-cooldown-visibility.mjs:343（後者是自有 inline harness，不吃共用 runtime！）都要 maxRetries + try/catch best-effort。**教訓：找 profile 清理問題時 rg profilePrefix，確認該 proof 是用共用 runtime 還是 inline 副本**。範圍外未修：prove-auction-mobile-scroll:421、prove-transmission-status-request-lifecycle:360（不在 verify 鏈）。
- 驗證：proof:building-material-candidates EXIT=0（ratio 0.758≥0.74）；pnpm verify:client EXIT=0（gm-login-autofill → build:client 28 proof → technique-preview → player-statistic-history）。
- 證據：`.omo/evidence/zh-tw-only-conversion/task-9/client-building-toolbar-viewport/evidence.md`。

## [2026-08-20] Task: todo 9 完成（guard 接入 + 全量驗證跑綠）
- verify:client 的 proof:building-material-candidates 失敗根因：building-mode-toolbar 是 position:absolute，offsetParent=#game-stage（position:relative），bottom 錨定地圖區而非視口。修復：mobile media query 內改 position:fixed（錨定視口），worldVisibleRatio 0.341→0.758。
- verify:client 全綠需同步 6 個 proof 斷言為繁體（prove-access-policy-editor / prove-technique-unification-mobile / verify-technique-preview / prove-technique-generation-batch）+ browser-proof-runtime EBUSY 修復。
- server smoke 斷言字串需同步為繁體（todo 4 連動），verify:quick 才綠。
- app.module.ts 設 envFilePath:[]（.env 為目錄，避免 EISDIR）。
- process-supervisor-smoke Windows SIGTERM 退出碼為 null（Linux 為 0），需相容。
- server package.json 的 POSIX if [ -f ] 在 Windows 無法執行，改 node -e || compile 跨平台。
- verify:release:with-db 需本地 Postgres，本機無 docker/DB → 環境 blocker，需在 todo 10 LXC 環境驗證。
- git add -A 會強制加入 .omo/ 與 .codegraph/（雖被 gitignore），需 git reset 排除。

## 2026-08-20 Task-10: LXC 生產部署 + 線上驗證（GM 郵件轉換 + 簡體殘留大掃除）

- **部署流程**：git archive HEAD → WinSCP sftp（hostkey ssh-ed25519 BIrLOS6gElJJ08pEYO4nvIBvRInllRlUYtOlKoLlkVw）→ LXC 解包 /opt/daojie/src（原子替換）→ docker build server+client → lxc-deploy.sh。**docker build 長逾時會斷 WinSCP 連線**：一律 `nohup docker build ... > /tmp/x.log 2>&1 &` 背景跑 + 輪詢 log。
- **Docker build blocker**：todo 1 把 typescript 加 root devDeps 後 pnpm 不再 public-hoist，server compile script 硬編碼 `../../node_modules/.pnpm/node_modules/typescript/bin/tsc` 在乾淨 Docker 環境不存在。修法 `pnpm exec tsc`（本機 + LXC sed 同步）。**教訓：硬編碼 .pnpm 路徑的 script 是 Docker 環境地雷**。
- **GM 面板 11921 CORS 被拒**：lxc-deploy.sh CORS_ORIGINS 缺 `http://192.168.0.191:11921`（有 a.twno1.uk:11921 沒有 IP:11921）。sed 加白名單 + 重跑 deploy。
- **GM 郵件轉換**：`POST /api/gm/shortcuts/compat/mail-traditionalize/{dry-run,apply}`。1 筆 system mail（司命台→司命臺），apply 後 residualSimplifiedRows=0，冪等（二次 apply converted=0 skipped=1）。備份表 player_mail_pre_tw_backup 自動建立。DB 驗證 psql 輸出在 LXC 主機是亂碼（編碼問題），用 GM API diagnostics/query 才是 UTF-8 乾淨輸出。
- **guard 的 JSXText 盲點（重大）**：check-traditional.mjs checkSourceText 只掃 `ts.isStringLiteral`/`NoSubstitutionTemplateLiteral`，**JSXText（`<button>文字</button>`）不掃** → todo 5 轉換 JSX 文字全漏（InventoryPanel 一键丢弃、TechniquePanel 11 處、SettingsPanel 15 處、TutorialPanel 4 處）。修法：checkSourceText 加 `ts.isJsxText(node)` 分支（修剪空白檢查）。**教訓：source 掃描必須同時覆蓋 StringLiteral + JSXText，缺一即漏**。
- **todo 5 白名單外 36 檔簡體**：main-social-state-source、main-time-chamber-state-source、account-rules、party-panel-view、item-display、technique-bonus-summary 等全漏網。用 `node scripts/convert-to-traditional.mjs --write --mode source <files>` 批量轉（CLI --write 才寫檔；node -e 直呼 convertFile 只回報不寫）。白名單 280→318。
- **server 玩家面 HTTP 錯誤訊息 todo 5 漏轉**：native-player-auth.service.ts 10 處 + native-player-auth-store.service.ts 10 處（密码错误/用户不存在/账号已封禁等）。部署後實際登入錯誤訊息「使用者不存在」繁中確認。**教訓：todo 5 轉換範圍遺漏 server http/native 的玩家面錯誤訊息**。
- **保留不轉（計畫性例外確認）**：gm.ts/gm-*.ts（GM 面「关闭」）、react-ui/gm/、react-ui/prototype/、constants/editor/map-editor.ts（GM 地圖編輯器）、constants/ui/text.ts（字型 family 名稱 Microsoft YaHei 是字型名非 UI 文字）。
- **離線收益舊快照簡體**：轉換前建立的 offline gain session payload 內 item name 簡體（采气木坠）是歷史資料；確認收取後新 session 繁中。非 mail 轉換範圍。
- **headless 滾輪 flake**：prove-item-card-constellation-layout:235 觸控滾輪模擬在 LXC headless 偶發失敗，重試即過；本機 build 一次通過。
- **登入自動化**：DOM UI 登入走 form submit（auth-form.requestSubmit()），點按鈕不觸發；React 受控 input 需 native setter + input/change 事件才保留值。
- **證據**：.omo/evidence/zh-tw-only-conversion/task-10/（evidence.md + gm-mail-conversion.json + screenshots/ 4 張）。

## [2026-08-20] Task: todo 10 完成（LXC 部署 + GM 郵件轉換 + 線上驗證）
- 部署成功：雙 image（server+client）build、rollback tags、/health+/live 200、無新增 WARN。
- GM 郵件轉換：dry-run(1 matched/1 converted) → apply(1 converted/verified 1/residual 0) → 冪等(0 converted/1 skipped)。備份表 player_mail_pre_tw_backup 已建立。
- 線上抽樣暴露 todo 5/9 真實缺口：
  - guard JSXText 盲點：checkSourceText 不掃 JSX 文字節點 → 補 ts.isJsxText 分支，抓到 20+ JSX 簡體
  - server 玩家面 HTTP 錯誤訊息（native-player-auth*.ts）20 處簡體 → 轉繁
  - 白名單外 36 檔 .ts 簡體 → 轉繁
  - guard 白名單 280→318
- Docker build blocker：todo 1 移除 public-hoist 後 .pnpm/node_modules/typescript 路徑失效 → server compile 改 pnpm exec tsc
- CORS 缺 11921：lxc-deploy.sh 白名單補 http://192.168.0.191:11921
- 這些修復（48 檔）已 commit 為 43739e75（todo 5/9 補漏）
- verify:release:with-db 本地不可跑（無 Postgres），但 DB smoke 行為已在 LXC 生產環境透過 GM 郵件轉換驗證

## 2026-08-20 F2: Code quality review — REJECT

- `scripts/sync-smoke-assertions.mjs` 的 `collectAssertionLiterals()` 預掃把所有 `StringLiteral` 都收進 `fixtureValues`，後續 assertion 字串也被誤判 fixture 而跳過；修正時必須先排除 assertion span，再收集 fixture。
- `--dry-run` 仍列出 29 檔／80 處待同步 assertion；已確認 `sect-runtime-durable-reconciliation-smoke.ts`、`tongtian-tower-smoke.ts` 的簡體期望值與已轉繁生產訊息失配。必須修同步器後精準套用，不可盲轉 lookup key 或 GM 例外。
- `convert-to-traditional.mjs` 的 JSON `isKey` 對 `"key" : value`（冒號前空白）誤判，現有 JSON 格式不觸發；`pending` 回傳未使用，均非 blocker。
- GM 郵件轉換交易、CAS、skip hash、Nest 接線與審計品質通過；CAS 漂移處實作是部分成功提交，註解卻寫全量回滾，需對齊。

## [2026-08-20] F4 範圍忠實度稽核

- **裁決：REJECT**。資料轉換本身安全：116 個變更的 content/maps JSON 比對為零非字串、排除欄位與 ID 變更；協議與 docker-stack diff 均為零。
- 阻擋原因是提交混入非文字行為：`app.module.ts` 的 `.env` 載入變更、`responsive.css` 的 mobile toolbar `position: fixed`、process-supervisor smoke 退出碼放寬、server package scripts 跨平台重寫。
- Must NOT #3 亦失敗：`app.module.ts` 與 `responsive.css` 新增繁體註解；另有未計畫的 package AGENTS 文件。重審前必須移除、回復或從轉換提交分離這些變更。

## 2026-08-20 F1 Plan Compliance Audit
- **F1 verdict: REJECT**。`node scripts/check-traditional.mjs --scope` 為 `{"ok":true,"violations":[]}`，但 guard 綠燈不代表所有計畫驗收完成。
- **Todo 8 實質缺口**：`MailSnapshotTraditionalizeConversion` 只操作 `player_mail`；沒有 `player_mail_archive` 查詢、轉換、備份、skip hash 或 residual 驗證。計畫 Scope/Todo 8 明定兩表都要處理；smoke 也只建了 `player_mail`。
- **Todo 8 證據缺口**：`.omo/evidence/zh-tw-only-conversion/task-8/` 不存在，違反每 todo 要有 task-N evidence 的策略。
- **Todo 7 證據缺口**：task-7 evidence 明載 brush 混排截圖待 F3，未滿足 Todo 7 acceptance 的「抽樣截圖存 evidence」。
- Todo 9 維持 `[~]`：本機沒有 Postgres，with-db 未跑；LXC 的 player_mail dry-run/apply/冪等只能作補強，不能補 archive 漏項。

## 2026-08-20 F3 手動 QA（REJECT）：shared 層系統性漏掃 + guard 模板盲點

- **Verdict：REJECT**。登入頁/背包/狀態/功法/設置/突破面板全繁中 ✅；GM 郵件 sender_label=司命臺 ✅（1 筆 system mail，residual 0）；但發現 150+ 玩家可見簡體殘留。
- **shared 層 whitelist 只有 3 檔**（labels.ts/storage.ts/sect-types.ts），199 檔 src/ 其餘全漏掃：value.ts（NUMERIC_STAT_LABELS 70+ 違規：体魄/神识/经脉/最大灵力/闪避/暴击/灵力回复/生命回复/视野范围/额外射程 + 行增伤/行减伤 + 触发时机 装备时/攻击后/击杀后）、realm.ts（80+ 違規：淬体境/锻骨境/练气前期/筑基前期/金丹后期/化神/炼虚/合体/大乘/渡劫/飞升 + 全境界描述「筋骨未开」「以气血反复淬洗皮肉」）。
- **guard 第 3 個盲點（StringLiteral/JSXText 之後）**：offline-gain-modal.ts:401 的 `${blocking ? '<div>确认前角色仍保持离线挂机，收益会自动刷新。</div>' : ''}` 在 template literal 的 TemplateExpression 內，check-traditional source 模式掃不到（單檔跑 ok:true）。此為玩家登入離線收益阻塞彈窗的必現文字。
- **client ui/ 59 檔不在 whitelist**（offline-gain-modal/stat-preview/npc-quest-modal/gm-panel 等）→ stat-preview.ts:96/105 行增伤/行减伤、npc-quest-modal.ts:486-494 i18n fallback 简體（csv 已覆蓋，低風險）。
- **F3 驗證技巧**：agent-browser fill 對 React 受控 input 無效（值不保留）→ 用 focus+type；登出用 eval JS 點按鈕避免 ref 失效；離線收益 blocking note 在「本次沒有收支變化」時不顯示（非阻塞直接 ack），要抓 DOM body text 才看得到。
- **教訓**：F3 前必須全量 rg shared 層簡體；guard 通過 ≠ 無殘留（scope 覆蓋才是關鍵）。
- 證據：`.omo/evidence/zh-tw-only-conversion/final-wave/F3-manual-qa.md` + 7 張截圖 + gm-mail-db-check.json。

## 2026-08-22 Fix-F2: smoke 斷言同步器修復 + 全量同步（45+6 檔）

- **pre-scan 吞斷言字串的根因與修法**：`collectFixtureValues()` 遞迴收所有 StringLiteral
  （含 assert 實參）→ `pushStringLiteral` 的 `fixtureValues.has(raw)` 恆命中 → 字串斷言整類 no-op。
  證據：修復前 dry-run 只有 (regexp) 類（pushRegExpLiteral 不查 fixtureValues）。
  修法=三段式：markVisit 先標記斷言節點 → fixture 收集跳過已標記節點 → 對標記節點轉換。
  修復後可見站點 29檔/80處 → 57檔/169處（新增可見的全是先前被吞的字串斷言）。
- **分類方法論**：每個 needle 用 rg -F 同時搜「簡體原形」與「繁體轉形」於生產真源
  （server src 非 tools + shared src）。簡體仍命中=生產仍簡體→排除；僅繁體命中=生產已轉→同步；
  兩者皆無=內容 JSON 或 smoke 自造 fixture，需讀 smoke 上下文判定資料流。
- **三類例外要分清**：(1) GM 面/啟動校驗生產仍簡體（native-gm-*、runtime/gm、server-cors、
  account-validation、runtime-gm-state 脫敏常量、world-gateway-inventory.helper）→ LITERAL_EXCLUSIONS；
  (2) 純 fixture 回顯（輸入名→trim/顯示名合成/搜索規範化/payload 回顯，兩側都是 smoke 自造）
  → KEYWORD_EXCLUSIONS；(3) fixture 名流入生產模板（如 `裝備 ${name}`、`統法臺：${name}`、
  `你對…施展…`）→ 必須 fixture 與斷言成對轉繁，只轉斷言必失配。
- **工具盲區：deepEqual/deepStrictEqual 物件內嵌套字串不收**（只收直接實參位）。
  tongtian-tower-smoke:99 `你进入通天塔第 1 层。` 即此類（任務指名案例），手工修復 6 檔：
  tongtian-tower:99、technique-unification-platform:256、context-actions:17/127/153/155、
  combat-relation:702/708/720/727/877/984、equipment:59、leaderboard-offline-snapshots:327/598。
- **rg 大批量 -e 時的顯示陷阱**：一次掛數十個 -e 時個別行可能顯示成另一 pattern 形態
  （formation-types.ts:438 曾顯示簡體、Read 卻是繁體 護宗大陣）——關鍵判定一律用 Read 複核。
- **`rg -rn` 會被解析成 `-r n`（replace）**，輸出全被替換成 n——測退出碼/搜尋都別加 -r。
- **生產端疑似轉換殘留（另行追蹤）**：world-runtime-pending-command.service.ts:31 以簡體 regex
  `/^实例 .+ 中没有可用出生点$/` 分類訊息，但 map-instance.runtime.ts:795 已拋繁體——分支恐永不命中。
- 驗證：--write 後 dry-run 0 pending（523 檔掃描）；`pnpm --filter @mud/server exec tsc --noEmit` EXIT=0；
  未 commit。證據：`.omo/evidence/zh-tw-only-conversion/final-wave/fix-f2-smoke-assertions/evidence.md`。

## 2026-08-22 F2/F4 REJECT 修復（final-wave / fix-f4-misc）

- **F4 誤報陷阱：git show 經 PowerShell 管道輸出會被編碼破壞成 ? 字元**，看起來像繁體/亂碼，實際檔案可能是簡體。判定前必須用 UTF-8 位元組層級讀檔（[System.IO.File]::ReadAllBytes + UTF8.GetString）或 git show 前先設 [Console]::OutputEncoding = UTF8。responsive.css:906-907 即因此被 F4 誤判為繁體，實際 HEAD 已是簡體。
- **台灣用語「搜索 vs 搜尋」是 guard 盲點**：兩字簡繁同形，check-traditional 無法偵測。InventoryPanel.tsx:124 fallback 搜索物品 需人工改 搜尋物品。此類同形字用語差異（搜索/搜尋、信息/資訊、網絡/網路）只能靠人工或詞表。
- **git status 是「檔案是否真的被改過」的最快判據**：responsive.css 不在 modified 清單 → 工作樹 == HEAD → 不需編輯；edit 工具回報「identical」也印證。
- 驗證：server + client tsc --noEmit 雙 EXIT=0；git diff 僅 2 檔 3 行。

## 2026-08-22 Task-8 修復: GM 郵件轉換補齊 player_mail_archive（F1 REJECT 修復）

- **雙表重構模式**：表描述符陣列（tableName/backupTable/hasUpdatedAtColumn）+ 單表管線方法
  convertSingleTable()，兩表共用同一套檢測/CAS/skip-hash/殘留回讀；單事務覆蓋兩表，
  任一表拋錯整體 ROLLBACK。
- **player_mail_archive 沒有 updated_at**（只有 archived_at，mail-persistence.service.ts:1116-1137）
  ——UPDATE 語句必須按 hasUpdatedAtColumn 條件拼裝時間戳子句，否則 archive 表 UPDATE 直接
  column does not exist。smoke 的 INSERT 也要按表切換時間戳欄位。
- **聚合時機陷阱**：populateScanResult 寫入的 convertedRows 是掃描期預估；CAS 漂移會讓實際
  轉換數低於預估。apply 後必須用逐表實際值 reduce 覆寫頂層 convertedRows/verifiedRows，
  否則結果負載謊報。
- **marker per table**：conversion_key = `<conversion_id>:<table>`（每表一條，ON CONFLICT upsert）；
  生產已跑過單表版留下的舊聚合 key `mail_snapshot_traditionalize` 成歷史記錄，無害不清理。
  冪等性真正靠內容檢測（can_convert=false）而非 marker——marker 只是審計記錄。
- **sample id / 錯誤碼加表名前綴**：兩表 mail_id 可能撞號，`<table>:<mail_id>` 與
  `<table>_convert_row_drift:<id>` 讓 dry-run 報告與錯誤排查可定位到表。
- **dry-run 也給逐表 breakdown**：orchestrator 在 LXC 重部署後跑 dry-run 就能直接看到
  archive pending 行數，不用先 apply。
- **驗證**：tsc --noEmit EXIT=0（唯讀）；LSP daemon 平行任務佔用逾時，以 tsc 全專案型別檢查
  兜底。with-db smoke 留給 orchestrator 統一跑（MUST NOT 提前 compile 防 dist 衝突）。
- 證據：.omo/evidence/zh-tw-only-conversion/task-8/evidence.md

## 2026-08-22 Fix-F3: shared 層補轉 + guard TemplateExpression 盲點修復

- **guard 第 3 盲點的修法是最小改動**：TemplateExpression 分支刪 early-return、
  改 `ts.forEachChild(node, visit)` 後 return。TemplateHead/Middle/Tail 的 kind
  不匹配檢查分支 → 結構文字自然跳過不誤報；插值內 StringLiteral 正常被掃。
  不要手寫 head/spans 遞迴——forEachChild 就是正確的遞迴。
- **F3 三個玩家可見案例全是同一盲點**：offline-gain-modal:401（三元內嵌字串）、
  npc-quest-modal:486/488/494（t() fallback 參數）、party-panel-view:123/126/127
  （徽章字串）——全部是「模板插值內的 StringLiteral」。修復後 --scope 立刻曝光
  party-panel-view 3 條新違規：**改 guard 後必須重掃全 whitelist 處理 fallout**。
- **stat-preview 行增伤/行减伤是「結構文字」不是內嵌字串**：
  `` `${label}行增伤 ${x}` `` 的中文在 template literal 本體，guard/converter 皆不碰
  （歸待改寫清單）。這類要手動 Edit；value.ts 同類 23 處（時段:/常駐特效:/乘區/
  每點X價值…）也是手動轉的。用 `cn2tw(line)!==line` 逐行掃 + 排除註解行可精準定位。
- **generated 檔要轉生成源**：tutorial-mechanics.generated.ts 由
  scripts/sync-tutorial-mechanics.mjs 從 docs/tutorial-mechanics.md 生成——
  只轉生成物會被下次 sync 回退。正確順序：convertText 轉 .md（converter 不支援 .md，
  用 node -e 呼叫 convertText 全文轉）→ 跑 sync 重生成 → guard 驗證 ok:true。
- **player-final-attr-baselines.json 安全轉換的依據**：technique.ts 以
  `levels[realmLv-1]` index 存取，realmName/realmStage 是純 metadata 無名稱鍵匹配；
  generate-player-final-attr-baselines.mjs 讀 shared dist 的 realm.ts name/shortName，
  轉換 realm.ts 後未來重生成自動繁中。scope.json 白名單條目原強制 source 模式，
  已改為按副檔名選模式（.json→json），資料檔才能納入 scope。
- **display-number.ts 是 blocked 不是遺漏**：万/亿 後綴被三處斷言鎖定——
  check-display-number.cjs（shared build 鏈）、world-runtime-sect-smoke:990/1006
  （/10万/ regex）、prove-item-card-constellation-layout:19/200（x136万）。
  server 檔禁改 → 需協調波次同步三處後再轉。已寫入 evidence §4。
- **qi.ts 轉換的真實 fallout 一例**：world-runtime-damageable-tile-smoke:622/625/628
  斷言 getQiResourceDisplayLabel 生產輸出 '灵气'/'木灵气'/'煞气' → 轉後失配。
  其餘 smoke 引用全是 fixture 或 assert message。判斷式：值從生產模組流出=會炸；
  測試自己建構的物件=fixture 不動。F2 的 sync-smoke-assertions 工具正是收這類失配。
- **排查斷言依賴的高效法**：對已轉字串 rg server tools + client scripts，
  再逐一看是 assert 預期值 / fixture 輸入 / message 文字；rg -r 是 replace flag
  （`rg -rn "X"` 會把 X 換成 n 輸出），別誤用。
- map-groups.ts STATIC_MAP_GROUPS 名稱可安全轉：以 id/prefix 匹配非名稱；
  check-content-reference-consistency 的 mapRefIds 雖含 mapGroupName，
  但 mapUnlockId 內容全 ASCII id（rg 驗證），無中文名引用。
- 成果：shared 757→153 違規（剩餘全分類保留）；--scope 337 條全綠；
  shared/client tsc --noEmit 雙 exit 0。

## 2026-08-22 Fix-Leftovers: 生產 regex 簡繁失配 + display-number 萬/億解鎖

- **pending-command.service.ts 簡體 regex 不止指名 2 處**：全檔掃出 10 個簡體 regex 字面
  （超出范围/妖兽/实例出生点/元气不足×3/当前没有可取消×2/尚在冷却/无法规划跨图/界门），
  其中 :235 是 :174 同 regex 的第二處（isExpectedTechniqueActivityReject）——改「指名行」前
  先對同檔 rg 同 pattern，避免 replaceAll 漏網。
- **同類 bug 第二生產檔**：world-runtime-navigation.service.ts:79-80 兩個導航 regex 同樣
  簡體對繁體拋出點（:666/:671）——分類器 regex 要連「拋出點所在服務」一起掃，不只消費端。
- **shared/monster.ts inferMonsterTierFromName 是內容資料版同類 bug**：regex 吃已轉繁的
  怪物名稱；妖王/荒王/精英 簡繁同形掩護了 兽王→獸王、异种→異種 的死分支。判定要點：
  現有 content 零命中＝零行為變更，但未來繁中怪名會誤分類 tier → 經驗倍率錯。
- **高效掃描法**：臨時 node 腳本複用 convertText 逐行偵測「含簡體字 + 行內有 .test(/===/
  .includes( 等比較上下文」，排除純註解行——比人工 rg 列舉簡體字快且不漏。
- **孤兒 smoke 陷阱**：world-runtime-pending-command-smoke.ts 整檔簡體與生產全面失配，
  但未註冊任何驗證鏈（rg 全倉僅 audit 文件提及）。sweep 範圍定義 non-tools 時此類檔
  保留不動、登記 evidence 即可；不要替死檔做全檔同步（50+ 字串的無驗證覆蓋改動）。
- **display-number 白名單曝光效應**：把 blocked 檔案加入 scope.json 後 guard 立刻抓出
  同表另外 7 個簡體後綴（無量大數/不可思議/恆河沙/極/載/澗/溝）——「任務只指名万/亿」
  但同一後綴表必須一次轉齊，否則白名單納管失敗。check-display-number.cjs:40 的 MAX_VALUE
  regex（无量大数）也是鎖定斷言，容易漏。
- **formation smoke effectValue="42万" 是隱藏鎖定點**：生產端 formatInteger 是
  formatDisplayInteger 的包裝——表面看是普通字串斷言，實際走 display-number 管線。
  判定法：rg 斷言值的生產端組裝點，追到 import 為止。
- **sync-smoke-assertions 排除清單更新語義**：display-number 轉繁後 '万' 不能刪
  （保護 万矿归元 等 fixture 名），要「加 '萬'」而非「換 '萬'」——排除清單是按
  「字串包含即跳過」運作，簡繁兩形都要在場。
- 驗證：guard --scope ok:true；server/client tsc --noEmit 雙 EXIT=0；未 commit。
  證據：.omo/evidence/zh-tw-only-conversion/final-wave/fix-leftovers/evidence.md

## 2026-08-22 Redeploy 7c174ec6（LXC 回歸）

- **rollback tag 命名**：todo 10 已佔 `*-pre-tw`；本次打 `*-pre-tw2` 指向當時線上 image（server 9bebfd301c98 / client bebb05a9b12d），新 image 為 server 2b300a647bc7 / client 90a5c510a7f4。
- **遠端 bash -c 引號陷阱**：從 Windows ssh 傳 `bash -c "cd ... && docker build"` 會被遠端 sh 再解析，`cd` 丟失、build 在 `/root` 找 Dockerfile。正解：先 scp 腳本再 `nohup /tmp/daojie-build.sh`。
- **PowerShell 不能當遠端指令**：`Select-Object` / `$?` / `$!` 在 Linux ssh 命令裡會炸或被本機吃掉。遠端只用 POSIX。
- **player_mail_archive 生產為空**：自用服從未封存郵件。雙表 dry-run 仍回 `tables[]`（archive matched=0）；apply 會建 `player_mail_archive_pre_tw_backup` + per-table marker，即使 0 列。不要把「0 pending」誤判成漏掃——先 `SELECT count(*) FROM player_mail_archive`。
- **舊 marker 無害**：`mail_snapshot_traditionalize`（無表後綴）是 todo 10 單表版留下的；新 key 是 `mail_snapshot_traditionalize:player_mail` / `:player_mail_archive`。
- **display-number 線上確認**：狀態欄原文 `境界修為 (1.5萬/1.5萬)`，不再是 F3 的 `1.5万`。
- **離線收益阻塞註記**：新 session 顯示「確認前角色仍保持離線掛機，收益會自動刷新。」（TemplateExpression 內嵌字串修復生效）。
- **書法字登入標題**：`道劫餘生` 四字視覺一致，判定 acceptable；截圖在 task-7/brush-sample.png。
- **agent-browser**：`--headed` + `wait --text` 曾落到 Example Domain；改 `open` → `wait 4000` → `get url/title` 才穩。React fill 這次保住了帳密（與 F3「fill 無效」不同，仍優先 focus+type）。
- 證據：`.omo/evidence/zh-tw-only-conversion/final-wave/redeploy-regression/`
- 未 commit。

## 2026-08-22 Fix-F2: CAS 漂移全有或全無語義修復

- **`ok: true` 字面量型別是 blocker 幫兇**：`GmCompatConversionRunResult.ok` 鎖死 `true`，失敗路徑想回 `ok:false` 連編譯都過不了——部分提交被型別系統「洗白」。修法：子型別 `extends Omit<Base, 'ok'>` + `ok: boolean`，不動共享基底（28 個其他轉換消費者零影響）。直接改基底 `ok: boolean` 會波及全部轉換，Omit 窄化是正解。
- **空串歸一化 = 確定性 CAS 漂移注入器**：`normalizeNullableString('') → null` 讓掃描快照與存儲值在 `IS NOT DISTINCT FROM NULL` 下必然失配（SQL 中 `'' IS DISTINCT FROM NULL` 恆真）→ UPDATE 命中 0 行。單進程 smoke 無法無 hook 地在掃描與 UPDATE 之間插併發寫入，此構造精準命中同一 throw 分支且零時序依賴。
- **事務內 CREATE TABLE 隨 ROLLBACK 消失（PG 特性）**：備份表與 marker 表都在事務內建，回滾後 `to_regclass` 斷言 null 即可證明「零殘留」——不用查表內容，查表存在性更強。
- **residual>0 / skip-verify 失敗無法廉價構造的原因要寫清楚**：殘餘檢測與分類共用同一 JS 口徑，「轉換輸出再被判簡體」需要保護詞表外的新 opencc 非冪等對；skip-verify 需要掃描後外部改列。兩者與 CAS 漂移共用同一外層 catch→rollback，機制覆蓋一次即可，文件化跳過而非硬湊 flaky 案例。
- **雙層審計語義分工**：controller 層 `executeAuditedGmWrite` 對正常 return 記 success:true（HTTP 操作本身成功），轉換專用 `recordAudit` 以 `failedRows === 0` 記 success:false（業務失敗）——ok:false 走 return 不走 throw 時兩層各自正確，不要合併。
- **LSP daemon 逾時兜底模式第二次生效**：平行任務佔用時 lsp_diagnostics 30s timeout，`tsc --noEmit` 全專案檢查是更強的替代驗證。
- 驗證：tsc --noEmit EXIT=0；未 commit。證據：`.omo/evidence/zh-tw-only-conversion/final-wave/fix-f2-cas-allornot/evidence.md`

## [2026-08-22] 計畫完成：zh-tw-only-conversion
- 13/13 項目關閉（todo 9 為 [~]：verify:release:with-db 本地無 Postgres，由 LXC 生產 GM 轉換 + 容器內 DB smoke 補償驗證）。
- Final Wave 兩輪修復後 F1-F4 全數 APPROVE。9 個計畫 commit（14a49fd3→0d660d58）。
- 審查驅動修復的最重要教訓：
  1. 文字轉換計畫的 guard 必須覆蓋「字串存在的所有語法位置」（StringLiteral/JSXText/TemplateExpression 內嵌）與「所有玩家可見真源層」（shared 層是最大盲區——whitelist 只放 3 檔導致 196 檔漏掃）。
  2. 轉換生產訊息後，所有「以文字比對訊息」的 regex/startsWith 站點是隱性消費者，必須全倉掃描（本次 12 處失配，含 exposesInternalIdentifier 安全防線失效）。
  3. 斷言是生產文案的鏡像：轉換後必須同步，且同步工具的 fixture/assertion 判定要精確（預掃吞掉斷言字串會讓工具靜默 no-op）。
  4. 資料遷移類 GM conversion 的安全語義是全有或全無：任何漂移/驗證失敗必須 throw→rollback→ok:false，絕不可部分提交回報成功。
  5. LSP daemon 逾時時以 tsc --noEmit 全專案型別檢查作等價補償（tsserver 即 LSP 底層引擎）。
- 遺留（非本計畫 scope）：stash@{0} 用戶變更保留未動；GM 面/註解簡體為計畫性例外。
