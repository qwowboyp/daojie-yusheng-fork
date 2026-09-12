#!/usr/bin/env node
/** 匯入已確認的青霖澤多格圖集。用法：node scripts/import-foundation-expansion-art.mjs <job.json> */
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

assert.ok(process.argv[2], '需要圖集工作 JSON 路徑');
const job = await readJson(path.resolve(process.argv[2]));
const monsterMode = job.kind === 'monsters';
const count = monsterMode ? 6 : 16;
assert.equal(job.items.length, count);
assert.equal(job.columns * job.rows, count);
assert.equal(new Set(job.items.map((item) => item.id)).size, count);
assert.match(job.id, /^foundation-qinglin-(?:items|monsters)-01$/);
const source = await fs.readFile(job.source), meta = await sharp(source).metadata();
requireTransparent(meta, await sharp(source).stats(), job.id);
const atlas = await connectedComponents(source, job.columns, job.rows, count);
const sourceSha256 = sha256(source);
const artPath = path.join(root, 'docs/artwork/atlases', `${job.id}.webp`);
const atlasBytes = await sharp(source).webp({ lossless: true, effort: 6 }).toBuffer();
await fs.writeFile(artPath, atlasBytes);
const manifestPath = path.join(root, 'docs/artwork/item-icons-v1.json');
const itemManifest = monsterMode ? null : await readJson(manifestPath);
const mappingPath = path.join(root, 'packages/client/src/constants/world/item-art.generated.json');
const mapping = monsterMode ? null : await readJson(mappingPath);
const packPath = path.join(root, 'packages/client/public/assets/runtime-image-packs/default/manifest.json');
let packSource = (await fs.readFile(packPath, 'utf8')).replaceAll('\r\n', '\n');
const pack = await readJson(packPath);
const records = [];
for (let index = 0; index < count; index++) {
  const item = job.items[index];
  assert.match(item.id, monsterMode ? /^m_qinglin_[a-z_]+$/ : /^(equip|mat|pill|scroll)\.qinglin_[a-z_]+$/);
  const { clean, extraction } = extractComponentCrop(atlas, atlas.groups[index], item.id);
  const crop = await sharp(clean, { raw: { width: extraction.width, height: extraction.height, channels: 4 } }).png().toBuffer();
  const outputs = [];
  for (const size of monsterMode ? [128] : [96, 192]) {
    const inner = Math.round(size * .84), margin = Math.floor((size - inner) / 2);
    const resized = await sharp(crop).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
      ...(monsterMode ? { kernel: 'nearest' } : {}) }).png().toBuffer();
    const canvas = sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: resized, left: margin, top: margin }]);
    const bytes = await (monsterMode ? canvas.png() : canvas.webp({ quality: 87, alphaQuality: 100, effort: 6 })).toBuffer();
    requireTransparent(await sharp(bytes).metadata(), await sharp(bytes).stats(), item.id);
    const relative = monsterMode ? `assets/runtime-image-packs/default/monsters/${item.id}.png`
      : `assets/item-icons/v1/${item.id}-${size}.webp`;
    await fs.writeFile(path.join(root, 'packages/client/public', relative), bytes);
    outputs.push({ size, path: relative, sha256: sha256(bytes), bytes: bytes.length });
  }
  const record = { id: item.id, name: item.name, description: item.description ?? item.name, mode: 'built-in-imagegen-atlas',
    atlas: `atlases/${job.id}.webp`, cell: cellRect(atlas.info, job.columns, job.rows, index), extraction,
    sourceSha256, cropSha256: sha256(crop), variants: monsterMode ? [128] : [96, 192], outputs };
  records.push(record);
  if (monsterMode) {
    pack.entities[`monster:${item.id}`] = { src: `monsters/${item.id}.png`, cols: 1, rows: 1, col: 0, row: 0, fit: 'contain', insetRatio: .02 };
  } else {
    mapping[item.id] = `/assets/item-icons/v1/${item.id}`;
    itemManifest.records = itemManifest.records.filter((entry) => entry.id !== item.id);
    itemManifest.records.push(record);
    if (['mat.qinglin_orchid', 'mat.qinglin_ling'].includes(item.id)) {
      pack.entities[`container:${item.name}`] = { src: `/assets/item-icons/v1/${item.id}-192.webp`,
        cols: 1, rows: 1, col: 0, row: 0, fit: 'contain', insetRatio: .04 };
    }
  }
}
assert.equal(new Set(records.map((record) => record.cropSha256)).size, count);
// This release adds new paths only. A fixed minimum makes repeat imports idempotent.
pack.version = Math.max(pack.version, 11);
packSource = packSource.replace(/"version":\s*\d+/, `"version": ${pack.version}`);
for (const [key, ref] of Object.entries(pack.entities)) {
  if (!key.startsWith('monster:m_qinglin_') && !['container:青霖蘭', 'container:澤心苓'].includes(key)) continue;
  const escapedKey = JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = new RegExp(`    ${escapedKey}: \\{[^}]*\\}`, 'g');
  const entry = `    ${JSON.stringify(key)}: ${JSON.stringify(ref, null, 2).split('\n').map((line, index) => index ? `    ${line}` : line).join('\n')}`;
  packSource = existing.test(packSource) ? packSource.replace(existing, entry)
    : packSource.replace(/\n  }\n}\s*$/, `,\n${entry}\n  }\n}\n`);
}
assert.deepEqual(JSON.parse(packSource), pack, '圖包文字更新必須保留所有既有條目');
await fs.writeFile(packPath, packSource);
if (!monsterMode) {
  await fs.writeFile(manifestPath, `${JSON.stringify(itemManifest, null, 2)}\n`);
  await fs.writeFile(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);
}
await fs.writeFile(path.join(root, 'docs/artwork/atlases', `${job.id}.json`), `${JSON.stringify({ id: job.id,
  kind: job.kind ?? 'items', columns: job.columns, rows: job.rows, prompt: job.prompt, editPrompt: job.editPrompt,
  sourceSha256, atlasSha256: sha256(atlasBytes), dimensions: [meta.width, meta.height], items: job.items, records }, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, atlas: job.id, count, outputs: records.flatMap((record) => record.outputs).length }));
