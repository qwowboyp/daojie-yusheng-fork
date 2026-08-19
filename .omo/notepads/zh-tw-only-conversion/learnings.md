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

