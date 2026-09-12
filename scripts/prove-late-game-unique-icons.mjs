#!/usr/bin/env node
/** 僅以正式內容與已提交資產驗證後期專屬 atlas 圖示。 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const loadSharp = () => {
  const bundled = process.env.CODEX_BUNDLED_NODE_MODULES
    ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  if (process.env.UNIQUE_ICON_SHARP_PATH) return require(process.env.UNIQUE_ICON_SHARP_PATH);
  try { return require('sharp'); } catch { return createRequire(path.join(bundled, 'package.json'))('sharp'); }
};
const sharp = loadSharp(), sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
function requireTransparent(metadata, stats, name) {
  assert.ok(metadata.hasAlpha, `${name} 缺少 alpha 通道`);
  assert.equal(stats.channels[3]?.min, 0, `${name} 沒有透明留白`);
  assert.ok((stats.channels[3]?.max ?? 0) >= 200, `${name} 沒有可見物件`);
}
async function assertAtlasCellTransparency(file, columns, rows, cell, name) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const left = Math.round(cell.col * info.width / columns), top = Math.round(cell.row * info.height / rows);
  const width = Math.round((cell.col + 1) * info.width / columns) - left, height = Math.round((cell.row + 1) * info.height / rows) - top;
  let transparent = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[((top + y) * info.width + left + x) * 4 + 3] < 96) transparent += 1;
  assert.ok(transparent >= width * height * .1, `${name} 的透明留白不足，疑似嵌入棋盤格背景`);
}
const expected = (await Promise.all([readJson(path.join(root, 'packages/server/data/content/items/後期七境/內容.json')), readJson(path.join(root, 'packages/server/data/content/items/後期七境/功法書.json'))])).flat()
  .filter((item) => item.type === 'skill_book' || item.type === 'equipment');
const expectedById = new Map(expected.map((item) => [item.itemId, item]));
assert.equal(expectedById.size, 224, '正式內容功法書與裝備數量錯誤');
assert.deepEqual(expected.reduce((counts, item) => ({ ...counts, [item.type]: (counts[item.type] ?? 0) + 1 }), {}), { skill_book: 56, equipment: 168 });
const manifestPath = path.join(root, 'docs/artwork/late-game-unique-icons.json'), manifest = await readJson(manifestPath), records = manifest.records ?? [];
const recordById = new Map(records.map((record) => [record.id, record]));
assert.equal(manifest.mode, 'built-in-imagegen-atlas', 'manifest mode 錯誤');
assert.equal(recordById.size, 224, 'manifest 必須完整且 ID 唯一');
assert.deepEqual(new Set(recordById.keys()), new Set(expectedById.keys()), 'manifest 與正式內容 ID 不一致');
assert.equal(new Set(records.map((record) => record.cropSha256)).size, 224, 'crop hash 必須一圖一物');
assert.equal(new Set(records.flatMap((record) => record.variants?.map((variant) => variant.sha256))).size, 448, 'variant hash 必須一圖一物');
const iconsPath = path.join(root, 'packages/client/src/constants/world/item-art.generated.json'), icons = await readJson(iconsPath), publicRoot = path.join(root, 'packages/client/public');
const atlasByPath = new Map();
for (const record of records) {
  const item = expectedById.get(record.id), stem = `/assets/item-icons/v2/${record.id}`;
  assert.equal(record.name, item.name, `名稱不符：${record.id}`); assert.equal(record.type, item.type, `類型不符：${record.id}`); assert.equal(record.desc, item.desc, `介紹不符：${record.id}`);
  assert.equal(record.mode, 'built-in-imagegen-atlas', `mode 不符：${record.id}`); assert.equal(record.stem, stem, `stem 不符：${record.id}`); assert.equal(icons[record.id], stem, `映射不符：${record.id}`);
  assert.match(record.atlas, /^atlases\/late-unique-[\w-]+\.webp$/, `atlas 路徑不符：${record.id}`);
  assert.ok(Number.isInteger(record.cell?.col) && Number.isInteger(record.cell?.row) && record.cell.width > 0 && record.cell.height > 0, `格位不符：${record.id}`);
  assert.equal(record.extraction?.method, 'connected-alpha-components', `裁切方法不符：${record.id}`);
  assert.ok(Array.isArray(record.extraction.componentIds) && record.extraction.componentIds.length > 0, `裁切元件缺失：${record.id}`);
  const atlasFile = path.join(root, 'docs/artwork', record.atlas), atlasJsonFile = atlasFile.replace(/\.webp$/, '.json');
  if (!atlasByPath.has(atlasFile)) atlasByPath.set(atlasFile, await readJson(atlasJsonFile));
  const atlas = atlasByPath.get(atlasFile);
  assert.equal(atlas.mode, 'built-in-imagegen-atlas', `atlas mode 錯誤：${record.atlas}`); assert.equal(atlas.sourceSha256, record.sourceSha256, `atlas hash 不符：${record.id}`);
  assert.equal(atlas.items[record.cell.row * atlas.columns + record.cell.col]?.id, record.id, `atlas 格位對應錯誤：${record.id}`);
  const atlasMetadata = await sharp(await fs.readFile(atlasFile)).metadata(), atlasStats = await sharp(await fs.readFile(atlasFile)).stats(); requireTransparent(atlasMetadata, atlasStats, `atlas ${record.atlas}`);
  await assertAtlasCellTransparency(atlasFile, atlas.columns, atlas.rows, record.cell, `atlas ${record.atlas} 格位 ${record.id}`);
  for (const size of [96, 192]) {
    const variant = record.variants?.find((entry) => entry.size === size); assert.ok(variant, `缺少 ${size} 變體：${record.id}`);
    const file = path.join(publicRoot, `${stem}-${size}.webp`), content = await fs.readFile(file), metadata = await sharp(content).metadata(), stats = await sharp(content).stats();
    assert.equal(metadata.format, 'webp', `格式錯誤：${record.id} ${size}`); assert.equal(metadata.width, size, `寬度錯誤：${record.id} ${size}`); assert.equal(metadata.height, size, `高度錯誤：${record.id} ${size}`); requireTransparent(metadata, stats, `${record.id} ${size}`);
    assert.equal(variant.sha256, sha256(content), `hash 不符：${record.id} ${size}`); assert.equal(variant.bytes, content.length, `大小不符：${record.id} ${size}`);
  }
}
assert.equal(atlasByPath.size, 7, '必須引用 7 張專屬圖集');
const tracked = [...records.flatMap((record) => [96, 192].map((size) => path.join(publicRoot, `${record.stem}-${size}.webp`))), iconsPath, manifestPath, ...atlasByPath.keys(), ...[...atlasByPath.keys()].map((file) => file.replace(/\.webp$/, '.json'))];
const snapshot = async () => new Map(await Promise.all(tracked.map(async (file) => [file, sha256(await fs.readFile(file))])));
const before = await snapshot();
const sync = spawnSync(process.execPath, [path.join(root, 'scripts/sync-late-game-icons.mjs')], { cwd: root, encoding: 'utf8' });
assert.equal(sync.status, 0, `重跑同步失敗：${sync.stderr || sync.stdout}`);
assert.deepEqual(await snapshot(), before, '重跑同步改寫了專屬圖示、映射或 atlas metadata');
console.log('LATE_GAME_UNIQUE_ICONS:PASS atlases=7 items=224 books=56 equipment=168 variants=448');
