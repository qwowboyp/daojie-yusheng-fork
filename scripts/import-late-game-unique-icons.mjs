#!/usr/bin/env node
/** 由已視覺確認的 imagegen 圖集擷取後期專屬圖示；不接受單件原圖。 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const loadSharp = () => {
  const bundled = process.env.CODEX_BUNDLED_NODE_MODULES
    ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  if (process.env.UNIQUE_ICON_SHARP_PATH) return require(process.env.UNIQUE_ICON_SHARP_PATH);
  try { return require('sharp'); } catch { return createRequire(path.join(bundled, 'package.json'))('sharp'); }
};
const sharp = loadSharp();
const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const sizes = [96, 192];

function requireTransparent(metadata, stats, name) {
  assert.ok(metadata.hasAlpha, `${name} 缺少 alpha 通道`);
  assert.equal(stats.channels[3]?.min, 0, `${name} 沒有透明留白`);
  assert.ok((stats.channels[3]?.max ?? 0) >= 200, `${name} 沒有可見物件`);
}
function assertTransparentCoverage(data, width, height, name) {
  let transparent = 0;
  for (let pixel = 0; pixel < width * height; pixel++) if (data[pixel * 4 + 3] < 96) transparent += 1;
  assert.ok(transparent >= width * height * .1, `${name} 的透明留白不足，疑似嵌入棋盤格背景`);
}
async function connectedComponents(source, columns, rows, count) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const labels = new Int32Array(info.width * info.height), queue = new Int32Array(info.width * info.height), blobs = [null];
  const threshold = 96;
  for (let index = 0; index < labels.length; index++) {
    if (labels[index] || data[index * 4 + 3] < threshold) continue;
    const id = blobs.length; let head = 0, tail = 1, minX = info.width, maxX = 0, minY = info.height, maxY = 0, sumX = 0, sumY = 0;
    queue[0] = index; labels[index] = id;
    while (head < tail) {
      const point = queue[head++], x = point % info.width, y = Math.floor(point / info.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); sumX += x; sumY += y;
      for (const next of [x > 0 ? point - 1 : -1, x < info.width - 1 ? point + 1 : -1, y > 0 ? point - info.width : -1, y < info.height - 1 ? point + info.width : -1]) {
        if (next >= 0 && !labels[next] && data[next * 4 + 3] >= threshold) { labels[next] = id; queue[tail++] = next; }
      }
    }
    const col = Math.min(columns - 1, Math.floor(sumX / tail * columns / info.width));
    const row = Math.min(rows - 1, Math.floor(sumY / tail * rows / info.height));
    blobs.push({ id, size: tail, minX, maxX, minY, maxY, slot: row * columns + col });
  }
  const groups = Array.from({ length: count }, (_, slot) => blobs.filter((blob) => blob?.slot === slot).sort((a, b) => b.size - a.size));
  const outliers = blobs.filter((blob) => blob && blob.size > 200 && (blob.maxX - blob.minX > info.width / columns * 1.5 || blob.maxY - blob.minY > info.height / rows * 1.5));
  assert.equal(outliers.length, 0, '連通 alpha 元件跨越格位，請先修正 atlas');
  return { data, info, labels, groups, threshold };
}
function cellRect(info, columns, rows, index) {
  const col = index % columns, row = Math.floor(index / columns);
  const left = Math.round(col * info.width / columns), top = Math.round(row * info.height / rows);
  return { col, row, left, top, width: Math.round((col + 1) * info.width / columns) - left, height: Math.round((row + 1) * info.height / rows) - top };
}
function extractComponentCrop(atlas, group, id) {
  assert.ok(group.length, `Atlas 格位沒有物件：${id}`);
  const selected = group.filter((blob) => blob.size >= Math.max(16, group[0].size * 0.005));
  const left = Math.max(0, Math.min(...selected.map((blob) => blob.minX)) - 8), top = Math.max(0, Math.min(...selected.map((blob) => blob.minY)) - 8);
  const right = Math.min(atlas.info.width - 1, Math.max(...selected.map((blob) => blob.maxX)) + 8), bottom = Math.min(atlas.info.height - 1, Math.max(...selected.map((blob) => blob.maxY)) + 8);
  const width = right - left + 1, height = bottom - top + 1, clean = Buffer.alloc(width * height * 4), keep = new Set(selected.map((blob) => blob.id));
  const distance = new Uint16Array(width * height); distance.fill(60000);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, source = (top + y) * atlas.info.width + left + x;
    if (keep.has(atlas.labels[source])) distance[index] = 0;
    else distance[index] = Math.min(distance[index], x ? distance[index - 1] + 1 : 60000, y ? distance[index - width] + 1 : 60000, x && y ? distance[index - width - 1] + 1 : 60000);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const index = y * width + x;
    distance[index] = Math.min(distance[index], x < width - 1 ? distance[index + 1] + 1 : 60000, y < height - 1 ? distance[index + width] + 1 : 60000, x < width - 1 && y < height - 1 ? distance[index + width + 1] + 1 : 60000);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, source = (top + y) * atlas.info.width + left + x, label = atlas.labels[source];
    if (distance[index] <= 6 && (!label || keep.has(label))) atlas.data.copy(clean, index * 4, source * 4, source * 4 + 4);
  }
  assertTransparentCoverage(clean, width, height, `裁切 ${id}`);
  return { clean, extraction: { method: 'connected-alpha-components', alphaThreshold: atlas.threshold, alphaHalo: 6, contentRatio: 0.84, left, top, width, height, componentIds: [...keep] } };
}

const atlasInput = await readJson(path.join(root, '.runtime/unique-art-atlas/atlases.json'));
const atlasJobs = Array.isArray(atlasInput) ? atlasInput : atlasInput.atlases ?? atlasInput.sheets;
assert.ok(Array.isArray(atlasJobs), 'atlases.json 必須是圖集陣列或包含 atlases/sheets 陣列');
assert.equal(atlasJobs.length, 7, '必須取得完整的 7 張後期圖集');
const expected = (await Promise.all([readJson(path.join(root, 'packages/server/data/content/items/後期七境/內容.json')), readJson(path.join(root, 'packages/server/data/content/items/後期七境/功法書.json'))])).flat()
  .filter((item) => item.type === 'skill_book' || item.type === 'equipment');
const expectedById = new Map(expected.map((item) => [item.itemId, item]));
assert.equal(expectedById.size, 224, '正式內容的功法書與裝備必須剛好是 224 筆');
assert.deepEqual(expected.reduce((counts, item) => ({ ...counts, [item.type]: (counts[item.type] ?? 0) + 1 }), {}), { skill_book: 56, equipment: 168 });
const allAtlasItems = atlasJobs.flatMap((job) => job.items);
assert.equal(new Set(allAtlasItems.map((item) => item.id)).size, 224, 'atlas 有重複 ID');
assert.deepEqual(new Set(allAtlasItems.map((item) => item.id)), new Set(expectedById.keys()), 'atlas 與正式內容 ID 不一致');

const publicRoot = path.join(root, 'packages/client/public'), atlasRoot = path.join(root, 'docs/artwork/atlases');
const iconsFile = path.join(root, 'packages/client/src/constants/world/item-art.generated.json'), icons = await readJson(iconsFile);
const records = [], atlasFiles = [];
for (const job of atlasJobs) {
  assert.ok(job.id && job.columns > 0 && job.rows > 0 && Array.isArray(job.items) && job.items.length <= job.columns * job.rows, `atlas 格式錯誤：${job.id}`);
  assert.match(job.id, /^late-unique-[\w-]+$/, `atlas ID 必須使用 late-unique- 前綴：${job.id}`);
  assert.equal(typeof job.prompt, 'string', `atlas 缺少提示詞：${job.id}`);
  assert.equal(typeof job.source, 'string', `atlas 缺少來源：${job.id}`);
  const source = await fs.readFile(job.source), sourceMetadata = await sharp(source).metadata(), sourceStats = await sharp(source).stats();
  assert.equal(sourceMetadata.format, 'png', `atlas 來源不是 PNG：${job.id}`); requireTransparent(sourceMetadata, sourceStats, `atlas ${job.id}`);
  const sourceSha256 = sha256(source), atlas = await connectedComponents(source, job.columns, job.rows, job.items.length);
  const atlasWebp = await sharp(source).webp({ lossless: true, effort: 6 }).toBuffer();
  const atlasJson = { id: job.id, columns: job.columns, rows: job.rows, items: job.items, prompt: job.prompt, mode: 'built-in-imagegen-atlas', sourceSha256, dimensions: [sourceMetadata.width, sourceMetadata.height] };
  atlasFiles.push({ id: job.id, webp: atlasWebp, json: atlasJson });
  for (const [index, atlasItem] of job.items.entries()) {
    const item = expectedById.get(atlasItem.id); assert.ok(item, `未知 atlas 物品：${atlasItem.id}`);
    assert.equal(atlasItem.name, item.name, `atlas 名稱不符：${atlasItem.id}`); assert.equal(atlasItem.type, item.type, `atlas 類型不符：${atlasItem.id}`); assert.equal(atlasItem.desc, item.desc, `atlas 介紹不符：${atlasItem.id}`);
    const cell = cellRect(atlas.info, job.columns, job.rows, index);
    const cellData = Buffer.alloc(cell.width * cell.height * 4);
    for (let y = 0; y < cell.height; y++) atlas.data.copy(cellData, y * cell.width * 4, ((cell.top + y) * atlas.info.width + cell.left) * 4, ((cell.top + y) * atlas.info.width + cell.left + cell.width) * 4);
    assertTransparentCoverage(cellData, cell.width, cell.height, `atlas ${job.id} 格位 ${atlasItem.id}`);
    const { clean, extraction } = extractComponentCrop(atlas, atlas.groups[index], atlasItem.id);
    const cropPng = await sharp(clean, { raw: { width: extraction.width, height: extraction.height, channels: 4 } }).png().toBuffer();
    const cropMetadata = await sharp(cropPng).metadata(), cropStats = await sharp(cropPng).stats(); requireTransparent(cropMetadata, cropStats, `裁切 ${atlasItem.id}`);
    const variants = [];
    for (const size of sizes) {
      const inner = Math.round(size * .84), image = await sharp(cropPng).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const margin = Math.floor((size - inner) / 2), content = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: image, left: margin, top: margin }]).webp({ quality: 85, alphaQuality: 100, effort: 6 }).toBuffer();
      const metadata = await sharp(content).metadata(), stats = await sharp(content).stats(); requireTransparent(metadata, stats, `${atlasItem.id} ${size}`);
      variants.push({ size, content, sha256: sha256(content), bytes: content.length });
    }
    records.push({ id: item.itemId, name: item.name, type: item.type, desc: item.desc, mode: 'built-in-imagegen-atlas', stem: `/assets/item-icons/v2/${item.itemId}`, atlas: `atlases/${job.id}.webp`, cell, extraction, sourceSha256, cropSha256: sha256(cropPng), variants: variants.map(({ content, ...variant }) => variant), _variants: variants });
  }
}
assert.equal(new Set(records.map((record) => record.cropSha256)).size, 224, '裁切圖示有重複內容');
assert.equal(new Set(records.flatMap((record) => record.variants.map((variant) => variant.sha256))).size, 448, '輸出 WebP 有重複內容');
for (const atlas of atlasFiles) { await fs.mkdir(atlasRoot, { recursive: true }); await fs.writeFile(path.join(atlasRoot, `${atlas.id}.webp`), atlas.webp); await fs.writeFile(path.join(atlasRoot, `${atlas.id}.json`), JSON.stringify(atlas.json, null, 2) + '\n'); }
for (const record of records) { for (const variant of record._variants) { const file = path.join(publicRoot, `assets/item-icons/v2/${record.id}-${variant.size}.webp`); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, variant.content); } icons[record.id] = `/assets/item-icons/v2/${record.id}`; delete record._variants; }
await fs.writeFile(iconsFile, JSON.stringify(icons, null, 2) + '\n');
await fs.writeFile(path.join(root, 'docs/artwork/late-game-unique-icons.json'), JSON.stringify({ description: '後期功法書與裝備的專屬 imagegen 圖集裁切產物。', mode: 'built-in-imagegen-atlas', records }, null, 2) + '\n');
console.log(JSON.stringify({ atlases: atlasFiles.length, imported: records.length, variants: 448 }));
