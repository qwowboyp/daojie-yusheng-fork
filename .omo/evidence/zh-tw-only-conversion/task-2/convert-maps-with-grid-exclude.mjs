import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { convertFile, loadExcludeFields } from '../../../../scripts/convert-to-traditional.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const GRID_LAYERS = ['terrain', 'structure', 'surface'];

/**
 * 以路徑定位並回寫物件值（避免 JSON.parse 重序列化產生的 key 重排/空 key 污染）。
 * path 形如 ['npcs', 3, 'char']；依序下鑽，最後一項寫值。
 */
function setByPath(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const next = cur[part];
    if (next === undefined || next === null || typeof next !== 'object') {
      throw new Error(`路徑中斷：${parts.slice(0, i + 1).join('.')}`);
    }
    cur = next;
  }
  cur[parts[parts.length - 1]] = value;
}

/** 收集原始文檔中所有 char 字段的 { parts, value }。 */
function collectCharPaths(o, parts, out) {
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i += 1) collectCharPaths(o[i], [...parts, i], out);
    return;
  }
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    if (k === 'char') {
      out.push({ parts: [...parts, k], value: o[k] });
    } else {
      collectCharPaths(o[k], [...parts, k], out);
    }
  }
}

/** 全物件深比較，輸出逐路徑差異（僅字符串值）。 */
function collectStringDiffs(a, b, path, out) {
  if (typeof a === 'string' && typeof b === 'string') {
    if (a !== b) out.push({ path, before: a, after: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < a.length; i += 1) collectStringDiffs(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    for (const k of Object.keys(a)) collectStringDiffs(a[k], b[k], `${path}.${k}`, out);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const files = [];
  let write = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') write = true;
    else if (arg === '--dry-run') write = false;
    else files.push(arg);
  }
  if (files.length === 0) {
    console.error('用法：node convert-maps-with-grid-exclude.mjs [--write] <file...>');
    process.exit(2);
  }
  const excludedFields = loadExcludeFields();
  for (const filePath of files) {
    const abs = path.resolve(repoRoot, filePath);
    const raw = fs.readFileSync(abs, 'utf8');
    const doc = JSON.parse(raw);
    const gridValues = {};
    for (const key of GRID_LAYERS) {
      if (Array.isArray(doc[key])) {
        gridValues[key] = doc[key];
        doc[key] = [GRID_LAYERS.length ? '__GRID_LAYER__' : '__GRID_LAYER__'];
      }
    }
    const patched = JSON.stringify(doc, null, 2) + '\n';
    fs.writeFileSync(abs + '.patched', patched);
    const result = convertFile(abs + '.patched', { mode: 'json', excludedFields });
    fs.rmSync(abs + '.patched');
    if (!result.changed) {
      console.log(`  [無差異] ${filePath}`);
      continue;
    }
    const convertedDoc = JSON.parse(result.output);
    // 還原網格層與 char 排除字段
    for (const key of Object.keys(gridValues)) {
      convertedDoc[key] = gridValues[key];
    }
    const charPaths = [];
    collectCharPaths(doc, [], charPaths);
    for (const { parts, value } of charPaths) {
      setByPath(convertedDoc, parts, value);
    }
    const finalText = JSON.stringify(convertedDoc, null, 2) + '\n';
    if (finalText === raw) {
      console.log(`  [無差異] ${filePath}`);
      continue;
    }
    if (write) {
      fs.writeFileSync(abs, finalText);
      console.log(`  [已轉換] ${filePath}（${result.rewrites.length} 處文本改寫，網格層/char 保持原樣）`);
    } else {
    const diffs = [];
    collectStringDiffs(doc, convertedDoc, '$', diffs);
    const filtered = diffs.filter((d) => !d.path.startsWith('$.terrain[') && !d.path.startsWith('$.structure[') && !d.path.startsWith('$.surface['));
    console.log(`  [待轉換] ${filePath}（${filtered.length} 處文本改寫，網格層/char 保持原樣）`);
    for (const d of filtered) {
      console.log(`    ${d.path}: ${d.before} → ${d.after}`);
    }
    }
  }
}

main();
