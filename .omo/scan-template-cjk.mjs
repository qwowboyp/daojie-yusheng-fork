/**
 * 掃描白名單檔案的 TemplateExpression，找出「含簡體 CJK 需人工改寫」的插值模板。
 * 判定：模板 raw 文本中，移除 ${...} 插值後的靜態文字 + 插值內所有字串字面量，
 * 任一經 convertText 有差異 → 需人工改寫。輸出 檔案:行號 + 完整模板 + 需轉換的字串。
 */
import fs from 'node:fs';
import ts from 'typescript';
import { convertText } from '../scripts/convert-to-traditional.mjs';

const files = process.argv.slice(2);

function lineAt(text, index) {
  let line = 0;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line + 1;
}

for (const filePath of files) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const hits = [];

  const collectStrings = (node, out) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
      return;
    }
    ts.forEachChild(node, (child) => collectStrings(child, out));
  };

  const visit = (node) => {
    if (ts.isTemplateExpression(node)) {
      const raw = text.slice(node.getStart(sourceFile), node.end);
      // 靜態文字 = template.head.text + 各 span 的 literal.text
      let staticText = node.head.text;
      for (const span of node.templateSpans) {
        staticText += span.literal.text;
      }
      // 插值內的字串字面量
      const innerStrings = [];
      for (const span of node.templateSpans) {
        collectStrings(span.expression, innerStrings);
      }
      const changed = [];
      for (const s of [staticText, ...innerStrings]) {
        if (!s || !/[\u4e00-\u9fff]/.test(s)) continue;
        const { text: converted } = convertText(s);
        if (converted !== s) changed.push(`${s} → ${converted}`);
      }
      if (changed.length > 0) {
        hits.push({ line: lineAt(text, node.getStart(sourceFile)), raw: raw.slice(0, 120), changed });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (hits.length > 0) {
    console.log(`\n===== ${filePath} =====`);
    for (const h of hits) {
      console.log(`  :${h.line} ${h.raw}`);
      for (const c of h.changed) console.log(`      [需改] ${c}`);
    }
  }
}

