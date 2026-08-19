/**
 * 本脚本负责生成客户端单一语言包（台湾繁体 zh-TW）的前端可消费产物。
 *
 * 输入：packages/client/src/content/i18n/zh-TW.csv（key, category, zh-TW, note）
 * 输出：packages/client/src/constants/ui/i18n.generated.ts
 *
 * 维护时要检查输入文件、输出路径和生成结果是否稳定，避免构建期产物与运行时展示口径分叉。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(clientDir, '..', '..');
const twSourcePath = path.join(clientDir, 'src/content/i18n/zh-TW.csv');
const targetPath = path.join(clientDir, 'src/constants/ui/i18n.generated.ts');
const COLUMNS = ['key', 'category', 'zh-TW', 'note'];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
        continue;
      }
      cell += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (char === '\r') {
      continue;
    }
    cell += char;
  }

  if (inQuotes) {
    throw new Error('CSV 解析失败：存在未闭合的双引号。');
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cellValue) => cellValue.length > 0));
}

function validateKey(key) {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(key)) {
    throw new Error(`非法 i18n key：${key}`);
  }
}

/** 从 CSV 路径读取记录列表。 */
function readCsvRecords(csvPath, required = false) {
  if (!fs.existsSync(csvPath)) {
    if (required) {
      throw new Error(`缺少语言包 CSV：${path.relative(repoRoot, csvPath)}`);
    }
    return [];
  }
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  if (rows.length === 0) {
    return [];
  }
  const [header, ...bodyRows] = rows;
  const missingColumns = COLUMNS.filter((column) => !header.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(`语言包 CSV 缺少列：${missingColumns.join(', ')}`);
  }

  const records = bodyRows.map((row, rowIndex) => {
    const record = {};
    for (const column of COLUMNS) {
      record[column] = row[header.indexOf(column)] ?? '';
    }
    const source = `${path.relative(repoRoot, csvPath)}:${rowIndex + 2}`;
    if (!record.key.trim()) {
      throw new Error(`${source} 缺少 key。`);
    }
    validateKey(record.key);
    if (!record.category.trim()) {
      throw new Error(`${source} 缺少 category。`);
    }
    if (!record['zh-TW'].trim()) {
      throw new Error(`${source} 缺少 zh-TW 文案。`);
    }
    return {
      key: record.key.trim(),
      category: record.category.trim(),
      text: record['zh-TW'],
      note: record.note.trim(),
    };
  });

  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.key)) {
      throw new Error(`语言包 CSV 存在重复 key：${record.key}`);
    }
    seen.add(record.key);
  }
  return records.sort((left, right) => (
    left.category.localeCompare(right.category, 'zh-TW')
    || left.key.localeCompare(right.key, 'zh-TW')
  ));
}

/** 校验记录占位符格式（{xxx} 命名占位符，保证运行时变量替换语义完整）。 */
function validatePlaceholders(records) {
  const placeholderPattern = /\{[a-zA-Z][a-zA-Z0-9_]*\}/g;
  for (const record of records) {
    for (const match of record.text.match(placeholderPattern) ?? []) {
      if (!/[a-zA-Z]/.test(match)) {
        throw new Error(`key ${record.key} 的占位符格式非法：${match}`);
      }
    }
  }
}

function toTsObject(records) {
  if (records.length === 0) {
    return '{}';
  }
  return `{\n${records.map((record) => `  ${JSON.stringify(record.key)}: ${JSON.stringify(record.text)},`).join('\n')}\n}`;
}

function buildOutput(records) {
  const body = toTsObject(records);
  return `/**
 * 本文件负责承载自动生成的前端语言包常量。
 *
 * 来源：
 *   - zh-TW 真源：packages/client/src/content/i18n/zh-TW.csv
 *
 * 维护时要通过生成脚本更新文案，保持 CSV、类型导出和客户端渲染口径一致，避免手写本文件造成覆盖丢失。
 */

export const SUPPORTED_CLIENT_LOCALES = ['zh-TW'] as const;

export type ClientLocale = (typeof SUPPORTED_CLIENT_LOCALES)[number];

export const CLIENT_I18N_MESSAGES: Record<ClientLocale, Record<string, string>> = {
  'zh-TW': ${body},
} as const;

export type ClientI18nKey = keyof typeof CLIENT_I18N_MESSAGES['zh-TW'];
`;
}

const records = readCsvRecords(twSourcePath, true);
validatePlaceholders(records);

const output = buildOutput(records);
const localeCountLabel = `zh-TW`;
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== output) {
  fs.writeFileSync(targetPath, output);
  console.log(`已生成 ${path.relative(repoRoot, targetPath)}（${records.length} 条 × ${localeCountLabel}）`);
} else {
  console.log(`i18n.generated.ts 无变更（${records.length} 条 × ${localeCountLabel}）`);
}
