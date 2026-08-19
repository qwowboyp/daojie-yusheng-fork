/**
 * compare-structure.mjs — 結構對比（zh-tw-only-conversion task-2 拋棄式驗證腳本）。
 *
 * 用法：node .omo/evidence/zh-tw-only-conversion/task-2/compare-structure.mjs <baselineCommit>
 *   baselineCommit 為 git stash create 產生的快照 commit；本腳本對
 *   packages/server/data/content/** 與 packages/server/data/maps/** 下所有 .json：
 *     1. 比較「鍵集合」：baseline 與 working tree 必須完全一致
 *     2. 比較「非字符串值」：數字 / 布林 / null 必須位元組一致
 *     3. 比較「純 ASCII 字符串值」：必須完全一致
 *     4. 排除字段（convert-exclude-fields.json，至少 char）的值必須位元組一致
 *   （排除字段值會被遞迴處理——若排除字段值是巢狀物件，其全部子值都必須一致）
 *   「有 CJK 的字符串值」允許不同（正是轉換的目標）。
 *
 * 輸出：{ structuralChanges, textFieldsChanged, excludedFieldsUnchanged } 一行 JSON。
 *   非零退出碼 = 結構破壞。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const dataRoot = path.join(repoRoot, 'packages', 'server', 'data');
const excludeFields = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'convert-exclude-fields.json'), 'utf8'));

const baselineCommit = process.argv[2];
if (!baselineCommit) {
  console.error('用法：node compare-structure.mjs <baselineCommit>');
  process.exit(2);
}

/** 遞迴收集路徑下所有 .json 檔（相對 dataRoot）。 */
function collectJsonFiles(dir, out = [], prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collectJsonFiles(path.join(dir, entry.name), out, rel);
    else if (entry.name.endsWith('.json')) out.push(rel);
  }
  return out;
}

/** 從 git commit 讀取檔案內容（不存在回 null）。 */
function readBaseline(commit, relPath) {
  try {
    return execFileSync('git', ['show', `${commit}:${relPath}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** 判斷字符串是否為「純 ASCII」（無任何非 ASCII 字元）。 */
function isPureAscii(s) {
  return /^[\x00-\x7F]*$/.test(s);
}

/**
 * 對比兩個 JSON 值（僅對字符串值做結構性檢查；物件鍵集合必須一致）。
 * 返回 { structural: boolean, textChanged: number, excludedChanged: boolean, excluded }。
 *   structural=false 表示鍵集合或非字符串值或純 ASCII 字符串有差異。
 */
function compareValue(a, b, { excluded, pathStr = '$' }) {
  let structural = true;
  let textChanged = 0;
  let excludedChanged = false;

  if (typeof a !== typeof b) return { structural: false, textChanged: 0, excludedChanged: true, excluded };
  if (a === null || b === null) {
    if (a !== b) return { structural: false, textChanged: 0, excludedChanged: true, excluded };
    return { structural: true, textChanged: 0, excludedChanged: false, excluded };
  }

  if (typeof a === 'string') {
    if (excluded) {
      if (a !== b) return { structural: false, textChanged: 0, excludedChanged: true, excluded };
      return { structural: true, textChanged: 0, excludedChanged: false, excluded };
    }
    if (isPureAscii(a)) {
      if (a !== b) return { structural: false, textChanged: 0, excludedChanged: true, excluded };
      return { structural: true, textChanged: 0, excludedChanged: false, excluded };
    }
    // 含 CJK 的字符串：允許不同（轉換目標）
    if (a !== b) textChanged += 1;
    return { structural: true, textChanged, excludedChanged: false, excluded };
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return { structural: false, textChanged: 0, excludedChanged: true, excluded };
    for (let i = 0; i < a.length; i += 1) {
      const r = compareValue(a[i], b[i], { excluded, pathStr: `${pathStr}[${i}]` });
      if (!r.structural) structural = false;
      textChanged += r.textChanged;
      if (r.excludedChanged) excludedChanged = true;
    }
    return { structural, textChanged, excludedChanged, excluded };
  }

  if (typeof a === 'object') {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { structural: false, textChanged: 0, excludedChanged: true, excluded };
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) {
      return { structural: false, textChanged: 0, excludedChanged: true, excluded };
    }
    for (const key of aKeys) {
      const childExcluded = excluded || excludeFields.includes(key);
      const r = compareValue(a[key], b[key], { excluded: childExcluded, pathStr: `${pathStr}.${key}` });
      if (!r.structural) structural = false;
      textChanged += r.textChanged;
      if (r.excludedChanged) excludedChanged = true;
    }
    return { structural, textChanged, excludedChanged, excluded };
  }

  // 數字 / 布林
  if (a !== b) return { structural: false, textChanged: 0, excludedChanged: true, excluded };
  return { structural: true, textChanged: 0, excludedChanged: false, excluded };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const files = [];
for (const sub of ['content', 'maps']) {
  collectJsonFiles(path.join(dataRoot, sub), files, `packages/server/data/${sub}`);
}
files.sort();

let structuralChanges = 0;
let textFieldsChanged = 0;
const excludedViolations = [];
const changedFiles = [];

for (const rel of files) {
  const baselineRaw = readBaseline(baselineCommit, rel);
  const currentRaw = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  if (baselineRaw === null) {
    console.error(`baseline 缺檔：${rel}`);
    structuralChanges += 1;
    continue;
  }
  let a, b;
  try {
    a = JSON.parse(baselineRaw);
    b = JSON.parse(currentRaw);
  } catch (error) {
    console.error(`JSON.parse 失敗 ${rel}：${error.message}`);
    structuralChanges += 1;
    continue;
  }
  const r = compareValue(a, b, { excluded: false, pathStr: '$' });
  if (!r.structural) {
    structuralChanges += 1;
    console.error(`結構差異：${rel}`);
  }
  textFieldsChanged += r.textChanged;
  if (r.excludedChanged) {
    excludedViolations.push(rel);
    console.error(`排除字段被改動：${rel}`);
  }
  if (r.textChanged > 0) changedFiles.push(rel);
}

const result = {
  structuralChanges,
  textFieldsChanged,
  excludedFieldsUnchanged: excludedViolations.length === 0,
  excludedViolations,
  changedFiles,
  fileCount: files.length,
};
console.log(JSON.stringify({ structuralChanges: result.structuralChanges, textFieldsChanged: result.textFieldsChanged, excludedFieldsUnchanged: result.excludedFieldsUnchanged }));
if (structuralChanges > 0 || excludedViolations.length > 0) process.exit(1);
process.exit(0);
