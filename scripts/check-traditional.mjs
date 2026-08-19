/**
 * 简体 → 台湾繁体 守卫（zh-tw-only-conversion 计划的幂等检查器）。
 *
 * 对文件做「是否已是台湾繁体」的幂等检查：
 *   1. U+FFFD（替换字符）→ 立即违规（文件编码已损坏）
 *   2. 词级命中（VOCABULARY_CN_TO_TW 命中 → 说明还有简体词）
 *   3. 字级残留（cn2tw(s) !== s → 说明还有简体字）
 *
 * 模式（按扩展名自动选择）：
 *   - json   ：只检查字符串值（排除字段见 convert-exclude-fields.json，至少含 char）
 *   - csv    ：只检查文本列（表头与 key 列跳过）
 *   - source ：TypeScript AST，只检查 StringLiteral 与无插值模板字符串
 *              （含 ${...} 插值的模板字符串不判违规，避免误报）
 *
 * 幂等性：对已转换完成的文件运行 → {ok:true, violations:[]}，退出码 0。
 *
 * 输出：JSON 行 {ok, violations:[{file,line,sample}]} 到 stdout；退出码 0=通过，1=有违规。
 *
 * 可复用导出：
 *   - checkFile(filePath, {mode, excludedFields}) → {ok, violations:[{file,line,sample}]}
 *   - checkJsonValue(value, {excludedFields}) → 递归检查 JSON 值（字符串值）
 *   - checkCsvText(text) → 检查 CSV 文本
 *   - checkSourceText(text, {fileName}) → 检查源码
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Converter } from 'opencc-js';
import ts from 'typescript';
import { VOCABULARY_CN_TO_TW, applyProtectedMask } from './lib/tw-vocabulary.mjs';
import { convertText, findReplacementChar, loadExcludeFields } from './convert-to-traditional.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

/** 简体 → 繁体（台湾用字）字级转换器，用于检查是否还有简体字残留。 */
const cn2tw = Converter({ from: 'cn', to: 'tw' });

/**
 * 单条文本的幂等检查：词级命中或字级残留 → true（需要转换）。
 * 检查前先掩码保护台湾标准词（濃郁/馥郁/岩），避免 opencc cn→tw
 * 非幂等误转（濃郁→濃鬱、岩→巖）对已正确的台湾文本造成误报。
 * 掩码词均为繁体台湾标准写法，简体词（浓郁/忧郁）不受掩码影响，
 * 真正的简体残留仍会被词级检查或 cn2tw 差异抓到。
 */
function textNeedsConversion(text) {
  if (!text || text.length === 0) return false;
  const masked = applyProtectedMask(text);
  for (const cn of VOCABULARY_CN_TO_TW.keys()) {
    if (masked.includes(cn)) return true;
  }
  return cn2tw(masked) !== masked;
}

/** 统计位置的行号（从 0 起始，行号 = 行数 + 1）。 */
function lineAt(text, index) {
  let line = 0;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/* ------------------------------------------------------------------ */
/* JSON 模式                                                           */
/* ------------------------------------------------------------------ */

/** 递归检查 JSON 值：字符串值做幂等检查；key 不动；排除字段跳过。 */
export function checkJsonValue(value, { excludedFields = [], file = '', line = 1, violations = [] } = {}) {
  if (typeof value === 'string') {
    if (textNeedsConversion(value)) {
      violations.push({ file, line, sample: value.slice(0, 60) });
    }
    return violations;
  }
  if (Array.isArray(value)) {
    for (const item of value) checkJsonValue(item, { excludedFields, file, line, violations });
    return violations;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (excludedFields.includes(key)) continue;
      checkJsonValue(value[key], { excludedFields, file, line, violations });
    }
    return violations;
  }
  return violations;
}

/** 检查 JSON 文档：解析后递归检查字符串值。返回违规列表（行号经原文定位校正）。 */
export function checkJsonText(text, { file = '', excludedFields = [] } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return [{ file, line: 1, sample: `JSON 解析失败：${error.message}` }];
  }
  const violations = checkJsonValue(parsed, { excludedFields, file });
  // 校正行号：在原文中依次查找 sample 出现位置（首个出现即视为该值所在行）
  let searchFrom = 0;
  for (const violation of violations) {
    const index = text.indexOf(violation.sample, searchFrom);
    if (index !== -1) {
      violation.line = lineAt(text, index) + 1;
      searchFrom = index + 1;
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ */
/* CSV 模式                                                           */
/* ------------------------------------------------------------------ */

/** 解析 CSV 为行（与转换器共用同一份实现）。 */
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

/** 检查 CSV 文本：跳过表头行与 key 列，其余单元格做幂等检查。 */
export function checkCsvText(text, { file = '' } = {}) {
  const violations = [];
  const rows = parseCsv(text);
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    for (let c = 1; c < row.length; c += 1) {
      if (textNeedsConversion(row[c])) {
        violations.push({ file, line: r + 1, sample: row[c].slice(0, 60) });
      }
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ */
/* Source 模式                                                         */
/* ------------------------------------------------------------------ */

/** 检查源码：只检查 StringLiteral 与无插值模板字符串；含插值模板不判违规。 */
export function checkSourceText(text, { file = '' } = {}) {
  const violations = [];
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(sourceFile) + 1;
      const end = node.end - 1;
      const raw = text.slice(start, end);
      if (textNeedsConversion(raw)) {
        violations.push({ file, line: lineAt(text, node.getStart(sourceFile)) + 1, sample: raw.slice(0, 60) });
      }
      return;
    }
    if (ts.isTemplateExpression(node)) {
      return; // 含插值模板：不判违规（需人工改写，见转换器待改寫清單）
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

/* ------------------------------------------------------------------ */
/* 文件级别                                                            */
/* ------------------------------------------------------------------ */

function modeOf(filePath, explicitMode) {
  if (explicitMode) return explicitMode;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.csv') return 'csv';
  return 'source';
}

/** 检查单个文件。返回 {ok, violations:[{file,line,sample}]}。 */
export function checkFile(filePath, { mode, excludedFields = [] } = {}) {
  const actualMode = modeOf(filePath, mode);
  const violations = [];
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return { ok: false, violations: [{ file: filePath, line: 1, sample: `读取失败：${error.message}` }] };
  }
  const bad = findReplacementChar(text);
  if (bad) {
    violations.push({ file: filePath, line: bad.line, sample: `包含替换字符 U+FFFD（\uFFFD）` });
  }
  if (actualMode === 'json') {
    violations.push(...checkJsonText(text, { file: filePath, excludedFields }));
  } else if (actualMode === 'csv') {
    violations.push(...checkCsvText(text, { file: filePath }));
  } else {
    violations.push(...checkSourceText(text, { file: filePath }));
  }
  return { ok: violations.length === 0, violations };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log(`用法：node scripts/check-traditional.mjs [选项] <文件或目录...>

简体 → 台湾繁体 幂等守卫（zh-tw-only-conversion 计划）。
对文件做「是否已是台湾繁体」检查：U+FFFD / 词级命中 / 字级残留。

模式（按扩展名自动选择，json/csv/source；也可用 --mode 强制）：
  json    只检查字符串值（排除字段见 convert-exclude-fields.json，至少含 char）
  csv     只检查文本列（表头与 key 列跳过）
  source  TypeScript AST，只检查字符串字面量（注释 / 标识符 / 正则不动；
          含 \${...} 插值的模板字符串不判违规）

选项：
  --mode <json|csv|source>  强制指定模式
  --exclude-fields <f1,f2>  额外排除字段（json 模式，追加到 convert-exclude-fields.json）
  --help                    显示本帮助
  -v / --verbose            输出每个文件通过/失败明细

输出：{ok, violations:[{file,line,sample}]} 到 stdout。
退出码：0=全部通过（幂等），1=存在违规。`);
}

function main() {
  const argv = process.argv.slice(2);
  const targets = [];
  let mode = null;
  let verbose = false;
  let extraExcludes = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--mode') {
      mode = argv[++i];
      if (!['json', 'csv', 'source'].includes(mode)) {
        console.error(`未知模式：${mode}（可用：json / csv / source）`);
        process.exit(2);
      }
    } else if (arg === '--exclude-fields') {
      extraExcludes = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '-v' || arg === '--verbose') {
      verbose = true;
    } else if (arg.startsWith('-')) {
      console.error(`未知选项：${arg}（--help 查看用法）`);
      process.exit(2);
    } else {
      targets.push(arg);
    }
  }

  if (targets.length === 0) {
    console.error('未指定文件或目录（--help 查看用法）');
    process.exit(2);
  }

  const excludedFields = [...new Set([...loadExcludeFields(), ...extraExcludes])];
  const allViolations = [];
  let checked = 0;
  let hadReadError = false;

  for (const target of targets) {
    if (fs.statSync(target).isDirectory()) {
      const files = [];
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) walk(full);
          else if (['.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(path.extname(full).toLowerCase())) {
            files.push(full);
          }
        }
      };
      walk(target);
      for (const file of files) {
        checked += 1;
        const result = checkFile(file, { mode, excludedFields });
        if (verbose) {
          console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${path.relative(repoRoot, file) || file}`);
        }
        allViolations.push(...result.violations);
      }
      continue;
    }
    checked += 1;
    const result = checkFile(target, { mode, excludedFields });
    if (verbose) {
      console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${path.relative(repoRoot, target) || target}`);
    }
    allViolations.push(...result.violations);
  }

  if (hadReadError) process.exitCode = 2;

  console.log(JSON.stringify({ ok: allViolations.length === 0, violations: allViolations }, null, 2));
  if (allViolations.length > 0) process.exit(1);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
