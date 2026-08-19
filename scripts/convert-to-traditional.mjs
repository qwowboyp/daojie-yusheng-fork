/**
 * 简体 → 台湾繁体 转换器（zh-tw-only-conversion 计划的核心工具）。
 *
 * 两段式转换：
 *   1. 词级：VOCABULARY_CN_TO_TW 最长匹配替换（服务器→伺服器、信息→訊息 …）
 *   2. 字级：opencc-js Converter({from:'cn',to:'tw'}) 收尾（车→車、为→為 …）
 *
 * 模式（按文件扩展名自动选择，也可用 --mode 强制）：
 *   - json：只转换字符串值；key、数字、布尔、null 原样保留；排除字段（convert-exclude-fields.json，
 *     至少含 char）的值完全不转。字符串按「原始字节位置」做两段式替换，只改动差异位置，
 *     与原文格式（缩进 / 引号风格 / key 顺序）完全无关。
 *   - csv：转换非表头列的文本单元格（表头与 key 列不转）。
 *   - source：TypeScript AST 解析，只转换 StringLiteral 与无插值模板字符串
 *     （NoSubstitutionTemplateLiteral）内的 CJK；注释、标识符、正则不转；
 *     含 ${...} 插值的模板字符串（TemplateExpression）不自动转，输出到「待改寫清單」。
 *
 * U+FFFD 防护：任何待转换文件包含替换字符（\uFFFD，损坏编码的产物）→ 立即报错
 * （文件名 + 行号），非零退出，不写任何输出。
 *
 * 安全保证：本脚本只会写 --write 显式传入（或 --dir 目录下）的文件，且仅在转换确有
 * 差异时写盘；--dry-run 永远不写盘。默认不写盘（等同 dry-run 报告）。
 *
 * 可复用导出（供 check-traditional.mjs 与后续对比脚本使用）：
 *   - convertText(text)        ：两段式转换单段文本
 *   - convertJsonValue(value, {excludedFields}) ：转换 JSON 值（字符串值递归处理）
 *   - convertJsonString(text, {excludedFields}) ：按字节位置转换 JSON 文档字符串
 *   - convertCsvText(text)     ：转换 CSV 文本（跳过表头/key 列）
 *   - convertSourceText(text, {fileName}) ：AST 转换源码；返回 {text, rewrites, needsRewrite}
 *   - findReplacementChar(text)：{line, column} 或 null
 *   - loadExcludeFields()      ：读取 convert-exclude-fields.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Converter } from 'opencc-js';
import ts from 'typescript';
import { VOCABULARY_CN_TO_TW, sortedVocabularyEntries, maskProtected } from './lib/tw-vocabulary.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const excludeFieldsPath = path.join(repoRoot, 'scripts/convert-exclude-fields.json');

/** 简体 → 繁体（台湾用字）字级转换器，用于词级替换后的字级收尾。 */
const cn2tw = Converter({ from: 'cn', to: 'tw' });

/* ------------------------------------------------------------------ */
/* 词级 / 字级转换核心                                                  */
/* ------------------------------------------------------------------ */

/** 从脚本目录读取排除字段列表（JSON 数组，至少包含 char）。 */
export function loadExcludeFields() {
  let list = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(excludeFieldsPath, 'utf8'));
    if (Array.isArray(parsed)) {
      list = parsed.filter((item) => typeof item === 'string');
    }
  } catch (error) {
    console.error(`读取排除字段列表失败：${excludeFieldsPath}（${error.message}）`);
  }
  return list;
}

/** 两段式转换单段文本：先掩码保护台湾标准词 → 词级最长匹配 → 字级收尾 → 还原保护词。 */
export function convertText(text) {
  // 掩码：把已是台湾标准的「濃郁 / 馥郁 / 岩」替换为控制字符哨兵，
  // 防止 opencc cn→tw 在字级收尾时误转（濃郁→濃鬱、岩→巖）。
  const { text: masked, restore } = maskProtected(text);
  // 词级：按 key 长度降序替换
  let vocabResult = masked;
  const vocabHits = [];
  const seen = new Set();
  for (const [cn, tw] of sortedVocabularyEntries()) {
    if (vocabResult.includes(cn)) {
      vocabResult = vocabResult.split(cn).join(tw);
      if (!seen.has(cn)) {
        seen.add(cn);
        vocabHits.push(cn);
      }
    }
  }
  // 字级：词级结果再走 opencc（哨兵为控制字符，原样透传）
  const charResult = cn2tw(vocabResult);
  // 还原：把哨兵换回台湾标准原词
  return { text: restore(charResult), vocabHits };
}

/**
 * 计算两个字符串之间「需要替换的区间」列表。
 * 保守算法：逐字符比较；从第一个不同字符开始，到最后一个不同字符为止，作为单个替换区间。
 * 返回 [{start, end, original}]，end 为开区间（slice(start, end) 即为 original）。
 * 两字符串完全相同时返回 []。
 */
export function diffSpans(original, converted) {
  const n = original.length;
  let start = -1;
  let end = -1;
  for (let i = 0; i < n; i += 1) {
    if (original[i] !== converted[i]) {
      if (start === -1) start = i;
      end = i + 1;
    }
  }
  if (start === -1) return [];
  return [{ start, end, original: original.slice(start, end) }];
}

/** 把替换区间应用到文档文本上（从后往前替换，位置不受影响）。 */
export function applySpans(text, spans, newText) {
  let result = text;
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  for (const span of ordered) {
    result = result.slice(0, span.start) + newText.slice(span.start, span.end) + result.slice(span.end);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* U+FFFD 防护                                                         */
/* ------------------------------------------------------------------ */

/**
 * 查找文本中第一个替换字符（U+FFFD，损坏编码的产物）。
 * 返回 { line, column }（1 起始），未找到返回 null。
 */
export function findReplacementChar(text) {
  const index = text.indexOf('\uFFFD');
  if (index === -1) return null;
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  return { line, column: index - lineStart + 1 };
}

/** 读取文件（utf8）并检查是否含 U+FFFD；发现即抛错（含文件名与行号）。 */
export function readFileChecked(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`无法读取 ${filePath}：${error.message}`);
  }
  const bad = findReplacementChar(text);
  if (bad) {
    throw new Error(
      `${filePath}:${bad.line}:${bad.column} 包含替换字符 U+FFFD（\uFFFD）——该文件编码已损坏，拒绝转换。` +
        `请先修复该文件（如为简体原文，请人工改写后再转换；todo 2 会处理已知的 3 个地图文件）。`
    );
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* JSON 模式：只转字符串值（span 级，不改格式）                          */
/* ------------------------------------------------------------------ */

/** 递归转换 JSON 值：字符串值转换，其他类型原样保留；key 永远不动。 */
export function convertJsonValue(value, { excludedFields = [] } = {}) {
  if (typeof value === 'string') {
    const { text } = convertText(value);
    return text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertJsonValue(item, { excludedFields }));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      if (excludedFields.includes(key)) {
        out[key] = value[key];
        continue;
      }
      out[key] = convertJsonValue(value[key], { excludedFields });
    }
    return out;
  }
  return value;
}

/** 判定 JSON 文档字符串值所在位置（不依赖 JSON.parse 的 value 引用）。 */
function jsonStringPositions(text) {
  const positions = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('"', index);
    if (open === -1) break;
    let end = open + 1;
    let closed = false;
    while (end < text.length) {
      const ch = text[end];
      if (ch === '\\') {
        end += 2;
        continue;
      }
      if (ch === '"') {
        closed = true;
        break;
      }
      end += 1;
    }
    if (!closed) break;
    positions.push({ start: open, end: end + 1 });
    index = end + 1;
  }
  return positions;
}

/**
 * 按原始字节位置转换 JSON 文档中的字符串字面量。
 * 只替换「值位置」（key 的字符串与冒号后的字符串不转）；排除字段的值位置不转。
 * 返回 { text, rewrites, pending }：rewrites 为实际替换区间，pending 为排除字段中未转的值位置。
 */
export function convertJsonString(text, { excludedFields = [] } = {}) {
  const positions = jsonStringPositions(text);
  const rewrites = [];
  const pending = [];

  for (const { start, end } of positions) {
    const raw = text.slice(start + 1, end - 1);
    const before = text.slice(0, start);
    const after = text.slice(end);

    // 判断是否为 key：冒号前是紧邻的（可能是对象 key 或数组末尾前的 key）
    const isKey =
      after.startsWith(':') ||
      /^[ \t]*:/.test(after.slice(0, after.search(/[^ \t]/) === -1 ? 0 : 1));

    // 判断是否在排除字段的 value 位置：向前找最近的「字段名」字符串。
    // 支援兩種形狀：
    //   1. "field": value            → 直接值（含陣列值的第一個元素之前）
    //   2. "field": [ ... ] 內的元素 → 由內往外找未閉合的 '['，直到找到
    //      其前綴為排除欄位；例如 "tagGroups": [ [ "药品" ] ] 的內層字串。
    let excluded = false;
    const m = /"((?:[^"\\]|\\.)*)"[ \t]*:[ \t]*$/.exec(before);
    if (m && excludedFields.includes(m[1])) {
      excluded = true;
    } else {
      // 由內往外掃描未閉合的 '['：
      // 從 before 結尾往回走，把已閉合的 ']' 前的內容直接跳過，
      // 遇到未閉合的 '[' 就檢查其緊鄰前綴是否為排除欄位；不是則繼續往外層找。
      let scan = before;
      for (;;) {
        const closeIdx = scan.lastIndexOf(']');
        const openIdx = scan.lastIndexOf('[');
        if (openIdx === -1) break;
        if (closeIdx > openIdx) {
          // 最後一個括號是 ']'：往前找到與它配對的 '[' 之前的內容。
          // 用括號計數找出真正未閉合的 '['。
          let depth = 0;
          let i = closeIdx - 1;
          for (; i >= 0; i -= 1) {
            const ch = scan[i];
            if (ch === ']') depth += 1;
            else if (ch === '[') {
              if (depth === 0) break;
              depth -= 1;
            }
          }
          scan = scan.slice(0, i);
          continue;
        }
        const head = scan.slice(0, openIdx);
        const fm = /"((?:[^"\\]|\\.)*)"[ \t]*:[ \t]*$/.exec(head);
        if (fm && excludedFields.includes(fm[1])) {
          excluded = true;
          break;
        }
        // 該層 '[' 前綴不是排除欄位 → 繼續往外找
        scan = head;
      }
    }

    if (isKey) continue;
    if (excluded) {
      pending.push({ start, end, original: raw });
      continue;
    }

    const { text: converted } = convertText(raw);
    if (converted === raw) continue;
    rewrites.push({ start: start + 1, end: end - 1, original: raw });
  }

  // 实际改写（从后往前，位置不受影响）
  let result = text;
  for (const span of [...rewrites].sort((a, b) => b.start - a.start)) {
    const raw = text.slice(span.start, span.end);
    const { text: converted } = convertText(raw);
    result = result.slice(0, span.start) + converted + result.slice(span.end);
  }
  return { text: result, rewrites, pending };
}

/* ------------------------------------------------------------------ */
/* CSV 模式：只转文本列（跳过表头与 key 列）                             */
/* ------------------------------------------------------------------ */

/** 解析 CSV 为行（每行为单元格数组），支持引号包裹与双引号转义。 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 把行数组序列化回 CSV 文本（保留原文件的换行风格）。 */
export function serializeCsv(rows, original) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const escapeCell = (cell) => (cell.includes(',') || cell.includes('"') || cell.includes('\n') || cell.includes('\r') ? `"${cell.replaceAll('"', '""')}"` : cell);
  return rows.map((row) => row.map(escapeCell).join(',')).join(eol) + eol;
}

/**
 * 转换 CSV 文本：跳过表头行与每行第 0 列（key 列），其余单元格做两段式转换。
 * 返回 { text, rewrites, pending }。
 */
export function convertCsvText(text) {
  const rows = parseCsv(text);
  const rewrites = [];
  const pending = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    for (let c = 1; c < row.length; c += 1) {
      const { text: converted } = convertText(row[c]);
      if (converted !== row[c]) {
        rewrites.push({ row: r + 1, column: c + 1, original: row[c] });
        row[c] = converted;
      }
    }
  }
  return { text: serializeCsv(rows, text), rewrites, pending };
}

/* ------------------------------------------------------------------ */
/* Source 模式：TypeScript AST，只转字符串字面量                         */
/* ------------------------------------------------------------------ */

/** 统计一个位置在第几行（从 0 起始，行号 = 行数 + 1）。 */
function lineAt(text, index) {
  let line = 0;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/**
 * 转换 TypeScript 源码中的 CJK 字符串字面量。
 * 只处理 StringLiteral 与 NoSubstitutionTemplateLiteral（无 ${} 插值的模板字符串）；
 * 注释、标识符、正则、数字、模板插值表达式一律不动。
 * 含 ${...} 的 TemplateExpression 不自动转，记录到 needsRewrite（待改寫清單）。
 *
 * 返回 { text, rewrites, needsRewrite }：
 *   - rewrites:      [{ start, end, original }] 实际替换区间（UTF-16 码元位置）
 *   - needsRewrite:  [{ line, sample }] 含插值、需人工改写的模板字符串
 */
export function convertSourceText(text, { fileName = 'source' } = {}) {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const rewrites = [];
  const needsRewrite = [];

  const visit = (node) => {
    if (ts.isStringLiteral(node)) {
      const start = node.getStart(sourceFile) + 1;
      const end = node.end - 1;
      const raw = text.slice(start, end);
      const { text: converted } = convertText(raw);
      if (converted !== raw) {
        rewrites.push({ start, end, original: raw });
      }
      return;
    }
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(sourceFile) + 1;
      const end = node.end - 1;
      const raw = text.slice(start, end);
      const { text: converted } = convertText(raw);
      if (converted !== raw) {
        rewrites.push({ start, end, original: raw });
      }
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const raw = text.slice(node.getStart(sourceFile), node.end);
      needsRewrite.push({ line: lineAt(text, node.getStart(sourceFile)) + 1, sample: raw.slice(0, 60) });
      return; // 不深入模板插值内部
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  let result = text;
  for (const span of [...rewrites].sort((a, b) => b.start - a.start)) {
    const raw = text.slice(span.start, span.end);
    const { text: converted } = convertText(raw);
    result = result.slice(0, span.start) + converted + result.slice(span.end);
  }
  return { text: result, rewrites, needsRewrite };
}

/* ------------------------------------------------------------------ */
/* 文件级别处理                                                        */
/* ------------------------------------------------------------------ */

function modeOf(filePath, explicitMode) {
  if (explicitMode) return explicitMode;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.csv') return 'csv';
  return 'source';
}

/** 转换单个文件内容（不写盘）。 */
export function convertFile(filePath, { mode, excludedFields = [] } = {}) {
  const actualMode = modeOf(filePath, mode);
  const text = readFileChecked(filePath);
  const result = { filePath, mode: actualMode, changed: false, vocabHits: [], charSpans: [], rewrites: [], needsRewrite: [] };
  if (actualMode === 'json') {
    const { text: converted, rewrites, pending } = convertJsonString(text, { excludedFields });
    result.rewrites = rewrites;
    result.changed = rewrites.length > 0;
    // 收集命中信息（报告用）：直接用原值重新转换得到展示用繁体重
    for (const span of rewrites) {
      const original = text.slice(span.start, span.end);
      const convertedText = convertText(original).text;
      const { vocabHits } = convertText(original);
      if (vocabHits.length > 0) result.vocabHits.push({ original, converted: convertedText, hits: vocabHits });
      else result.charSpans.push({ original, converted: convertedText });
    }
    result.output = converted;
  } else if (actualMode === 'csv') {
    const { text: converted, rewrites: csvRewrites } = convertCsvText(text);
    result.changed = csvRewrites.length > 0;
    result.rewrites = csvRewrites;
    result.output = converted;
    for (const r of csvRewrites) {
      const { vocabHits } = convertText(r.original);
      if (vocabHits.length > 0) result.vocabHits.push({ original: r.original, hits: vocabHits });
      else result.charSpans.push({ original: r.original });
    }
  } else {
    const { text: converted, rewrites: srcRewrites, needsRewrite } = convertSourceText(text, { fileName: filePath });
    result.changed = srcRewrites.length > 0;
    result.rewrites = srcRewrites;
    result.needsRewrite = needsRewrite;
    result.output = converted;
    for (const span of srcRewrites) {
      const original = text.slice(span.start, span.end);
      const { vocabHits } = convertText(original);
      if (vocabHits.length > 0) result.vocabHits.push({ original, hits: vocabHits });
      else result.charSpans.push({ original });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 报告输出                                                            */
/* ------------------------------------------------------------------ */

function printSection(title) {
  console.log(`\n===== ${title} =====`);
}

function printFileResult(result, { dryRun }) {
  const rel = path.relative(repoRoot, result.filePath) || result.filePath;
  const action = dryRun ? '待轉換' : '已轉換';
  if (!result.changed) {
    console.log(`  [無差異] ${rel}`);
    return;
  }
  console.log(`  [${action}] ${rel}`);
  if (result.vocabHits.length > 0) {
    printSection('詞彙表命中行');
    for (const hit of result.vocabHits) {
      console.log(`    ${rel}: ${hit.original} → ${hit.converted ?? ''}（命中：${hit.hits.join('、')}）`);
    }
  }
  if (result.charSpans.length > 0) {
    printSection('opencc 字級轉換行');
    for (const span of result.charSpans) {
      console.log(`    ${rel}: ${span.original} → ${span.converted ?? ''}`);
    }
  }
  if (result.needsRewrite.length > 0) {
    printSection('待改寫清單（含 ${} 插值的模板字符串，需人工改写）');
    for (const item of result.needsRewrite) {
      console.log(`    ${rel}:${item.line} ${item.sample}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log(`用法：node scripts/convert-to-traditional.mjs [选项] <文件...>

简体 → 台湾繁体 转换器（zh-tw-only-conversion 计划）。
两段式：先词级（VOCABULARY_CN_TO_TW 最长匹配），再字级（opencc-js cn→tw）。

模式（按扩展名自动选择，json/csv/source；也可用 --mode 强制）：
  json    只转换字符串值（key、数字、布尔、null 不动），排除字段见 convert-exclude-fields.json
  csv     只转换文本列（表头与 key 列不动）
  source  TypeScript AST，只转换字符串字面量（注释 / 标识符 / 正则不动）；
          含 \${...} 插值的模板字符串不自动转，输出待改寫清單

选项：
  --dry-run            只报告，不写任何文件（默认行为）
  --write              写回文件（仅当确有差异时写盘）
  --mode <json|csv|source>  强制指定转换模式
  --exclude-fields <f1,f2>  额外排除字段（json 模式，追加到 convert-exclude-fields.json）
  --help               显示本帮助

安全：
  - 任何文件含 U+FFFD（替换字符）→ 立即报错（文件名 + 行号），非零退出，不写盘
  - 不指定 --write 时等同 dry-run，永不写盘`);
}

function main() {
  const argv = process.argv.slice(2);
  const files = [];
  let dryRun = true;
  let write = false;
  let mode = null;
  let extraExcludes = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--dry-run') {
      dryRun = true;
      write = false;
    } else if (arg === '--write') {
      write = true;
      dryRun = false;
    } else if (arg === '--mode') {
      mode = argv[++i];
      if (!['json', 'csv', 'source'].includes(mode)) {
        console.error(`未知模式：${mode}（可用：json / csv / source）`);
        process.exit(2);
      }
    } else if (arg === '--exclude-fields') {
      extraExcludes = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('-')) {
      console.error(`未知选项：${arg}（--help 查看用法）`);
      process.exit(2);
    } else {
      files.push(arg);
    }
  }

  if (files.length === 0) {
    console.error('未指定文件（--help 查看用法）');
    process.exit(2);
  }

  const excludedFields = [...new Set([...loadExcludeFields(), ...extraExcludes])];
  let hadError = false;
  const pendingFiles = [];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      console.error(`文件不存在：${filePath}`);
      hadError = true;
      continue;
    }
    let result;
    try {
      result = convertFile(filePath, { mode, excludedFields });
    } catch (error) {
      console.error(`錯誤：${error.message}`);
      hadError = true;
      continue;
    }
    printFileResult(result, { dryRun });
    if (result.changed) pendingFiles.push(result);
    if (write && result.changed) {
      try {
        fs.writeFileSync(filePath, result.output);
      } catch (error) {
        console.error(`寫入失敗：${filePath}（${error.message}）`);
        hadError = true;
      }
    }
  }

  console.log(`\n共 ${files.length} 個文件，待轉換 ${pendingFiles.length} 個${write ? '（已寫回）' : ''}${dryRun ? '（dry-run，未寫盤）' : ''}`);
  if (hadError) process.exit(1);
}

// 作为 CLI 运行时执行 main；被 import 时不执行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
