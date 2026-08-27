/**
 * 插值模板補完轉換器（todo 5 手動改寫階段的自動化助手）。
 *
 * 對白名單檔案中「含 ${} 插值的 TemplateExpression」做精確 AST 改寫：
 *   - 只轉換 template 的靜態文字部分（head.text + 各 span.literal.text）中的簡體 CJK
 *   - 只轉換插值表達式內部的 StringLiteral / NoSubstitutionTemplateLiteral 的簡體 CJK
 *   - 完全不動 ${expr} 的其他內容（識別字、呼叫、屬性存取等）
 *   - 遞迴處理嵌套 TemplateExpression（模板內含模板）
 *
 * 這等同於把 todo 1 轉換器「待改寫清單」的項目按規則逐一人工改寫，
 * 只是用 AST 精確定位替代人工逐處搜尋，確保零遺漏、零誤傷。
 */
import fs from 'node:fs';
import ts from 'typescript';
import { convertText } from '../scripts/convert-to-traditional.mjs';

const files = process.argv.slice(2);
let totalRewrites = 0;

for (const filePath of files) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const spans = []; // {start, end, original} 替換區間（不含引號）
  const reported = [];

  const collect = (node) => {
    // 字串字面量（在模板插值內）
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(sourceFile) + 1;
      const end = node.end - 1;
      const raw = text.slice(start, end);
      const { text: converted } = convertText(raw);
      if (converted !== raw) {
        spans.push({ start, end, original: raw });
        reported.push(`${raw} → ${converted}`);
      }
      return;
    }
    if (ts.isTemplateExpression(node)) {
      // 靜態文字部分
      const headStart = node.getStart(sourceFile) + 1;
      const headRaw = text.slice(headStart, headStart + node.head.text.length);
      const { text: headConverted } = convertText(headRaw);
      if (headConverted !== headRaw) {
        spans.push({ start: headStart, end: headStart + node.head.text.length, original: headRaw });
        reported.push(`${headRaw} → ${headConverted}`);
      }
      for (const span of node.templateSpans) {
        const litStart = span.literal.getStart(sourceFile) + 1;
        const litRaw = text.slice(litStart, litStart + span.literal.text.length);
        const { text: litConverted } = convertText(litRaw);
        if (litConverted !== litRaw) {
          spans.push({ start: litStart, end: litStart + span.literal.text.length, original: litRaw });
          reported.push(`${litRaw} → ${litConverted}`);
        }
        // 遞迴處理插值內部（nested 模板 / 字串字面量）
        ts.forEachChild(span.expression, collect);
      }
      return;
    }
    ts.forEachChild(node, collect);
  };

  collect(sourceFile);

  if (spans.length === 0) {
    console.log(`[無需改寫] ${filePath}`);
    continue;
  }

  let result = text;
  const dedup = new Map();
  for (const span of spans) {
    dedup.set(`${span.start}:${span.end}`, span);
  }
  const unique = [...dedup.values()].sort((a, b) => b.start - a.start);
  for (const span of unique) {
    const { text: converted } = convertText(text.slice(span.start, span.end));
    result = result.slice(0, span.start) + converted + result.slice(span.end);
  }
  fs.writeFileSync(filePath, result);
  totalRewrites += unique.length;
  console.log(`[已改寫 ${unique.length} 處] ${filePath}`);
  for (const r of reported) console.log(`    ${r}`);
}

console.log(`\n共 ${files.length} 檔，插值模板改寫 ${totalRewrites} 處。`);
