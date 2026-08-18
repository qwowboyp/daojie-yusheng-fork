/**
 * 本脚本属于客户端构建或内容生成链路，负责把共享配置、语言包或展示索引整理成前端可消费产物。
 *
 * 维护时要检查输入文件、输出路径和生成结果是否稳定，避免构建期产物与运行时展示口径分叉。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Converter } from 'opencc-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(clientDir, '..', '..');
const cnSourcePath = path.join(clientDir, 'src/content/i18n/zh-CN.csv');
const twOverridePath = path.join(clientDir, 'src/content/i18n/zh-TW.overrides.csv');
const targetPath = path.join(clientDir, 'src/constants/ui/i18n.generated.ts');
const COLUMNS = ['key', 'category', 'zh-CN', 'note'];

/** 简体 → 繁体（台湾用字）转换器，仅用于生成 zh-TW 初稿。 */
const cn2tw = Converter({ from: 'cn', to: 'tw' });

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
    if (!record['zh-CN'].trim()) {
      throw new Error(`${source} 缺少 zh-CN 文案。`);
    }
    return {
      key: record.key.trim(),
      category: record.category.trim(),
      text: record['zh-CN'],
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
    left.category.localeCompare(right.category, 'zh-CN')
    || left.key.localeCompare(right.key, 'zh-CN')
  ));
}

/** 从 zh-TW.overrides.csv 读取覆盖映射：key -> 繁体文案。 */
function readTwOverrides() {
  const overrides = new Map();
  for (const record of readCsvRecords(twOverridePath, false)) {
    if (overrides.has(record.key)) {
      throw new Error(`zh-TW.overrides.csv 存在重复 key：${record.key}`);
    }
    overrides.set(record.key, record.text);
  }
  return overrides;
}

/** 校验各 locale 的 key 集合一致且占位符一致。 */
function validateLocales(cnRecords, twMap) {
  const cnKeys = cnRecords.map((record) => record.key);
  const twKeys = [...twMap.keys()];
  const cnSet = new Set(cnKeys);
  const twSet = new Set(twKeys);
  for (const key of twKeys) {
    if (!cnSet.has(key)) {
      throw new Error(`zh-TW.overrides.csv 覆盖了不存在的 key：${key}（zh-CN.csv 中无此 key）`);
    }
  }

  const placeholderPattern = /\{[a-zA-Z][a-zA-Z0-9_]*\}/g;
  const placeholderSet = (text) => new Set(text.match(placeholderPattern) ?? []);
  for (const record of cnRecords) {
    if (!twMap.has(record.key)) {
      continue;
    }
    const twText = twMap.get(record.key);
    const cnPlaceholders = placeholderSet(record.text);
    const twPlaceholders = placeholderSet(twText);
    if (cnPlaceholders.size !== twPlaceholders.size) {
      throw new Error(`key ${record.key} 的 zh-TW 覆盖占位符与 zh-CN 不一致：cn=${[...cnPlaceholders].join(',')} tw=${[...twPlaceholders].join(',')}`);
    }
  }
}

function toTsObject(records, valueSelector) {
  if (records.length === 0) {
    return '{}';
  }
  return `{\n${records.map((record) => `  ${JSON.stringify(record.key)}: ${JSON.stringify(valueSelector(record))},`).join('\n')}\n}`;
}

function buildOutput(cnRecords, twTextsByKey) {
  const cnBody = toTsObject(cnRecords, (record) => record.text);
  const twBody = toTsObject(cnRecords, (record) => twTextsByKey.get(record.key) ?? record.text);
  return `/**
 * 本文件负责承载自动生成的前端语言包常量。
 *
 * 来源：
 *   - zh-CN 真源：packages/client/src/content/i18n/zh-CN.csv
 *   - zh-TW 初稿：由 zh-CN 经 opencc-js（cn → tw）生成，覆写见 packages/client/src/content/i18n/zh-TW.overrides.csv
 *
 * 维护时要通过生成脚本更新文案，保持 CSV、类型导出和客户端渲染口径一致，避免手写本文件造成覆盖丢失。
 */

export const SUPPORTED_CLIENT_LOCALES = ['zh-CN', 'zh-TW'] as const;

export type ClientLocale = (typeof SUPPORTED_CLIENT_LOCALES)[number];

export const CLIENT_I18N_MESSAGES: Record<ClientLocale, Record<string, string>> = {
  'zh-CN': ${cnBody},
  'zh-TW': ${twBody},
} as const;

export type ClientI18nKey = keyof typeof CLIENT_I18N_MESSAGES['zh-CN'];
`;
}

const cnRecords = readCsvRecords(cnSourcePath, true);
const twOverrides = readTwOverrides();
validateLocales(cnRecords, twOverrides);

// 建立 zh-TW 文案：简转繁初稿 + 覆盖
const twTextsByKey = new Map();
for (const record of cnRecords) {
  twTextsByKey.set(record.key, twOverrides.has(record.key) ? twOverrides.get(record.key) : cn2tw(record.text));
}

const output = buildOutput(cnRecords, twTextsByKey);
const localeCountLabel = `zh-CN + zh-TW`;
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== output) {
  fs.writeFileSync(targetPath, output);
  console.log(`已生成 ${path.relative(repoRoot, targetPath)}（${cnRecords.length} 条 × ${localeCountLabel}）`);
} else {
  console.log(`i18n.generated.ts 无变更（${cnRecords.length} 条 × ${localeCountLabel}）`);
}
