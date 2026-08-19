# Learnings — zh-tw-only-conversion

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

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
