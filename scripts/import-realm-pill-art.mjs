#!/usr/bin/env node
/** 將 AGY 境界丹圖集轉為透明獨立道具圖示；不處理任何既有圖集或圖包。 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function loadSharp() {
  try { return require('sharp'); } catch {
    const bundled = process.env.CODEX_BUNDLED_NODE_MODULES ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
    return createRequire(path.join(bundled, 'package.json'))('sharp');
  }
}
const sharp = loadSharp();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const atlasKey = arg('--atlas');
const sourcePath = arg('--source');
const overrideSourcePath = arg('--override-source');
const planPath = arg('--plan');
const promptPath = arg('--prompt');
assert.ok(['a', 'b'].includes(atlasKey), '需要 --atlas a 或 --atlas b');
assert.ok(sourcePath, '需要 --source <AGY 圖集路徑>');

const atlasMetadataPath = path.join(root, 'docs/artwork/atlases', `realm-pills-${atlasKey}.json`);
const existingAtlas = await fs.readFile(atlasMetadataPath, 'utf8').then(JSON.parse).catch(() => null);
const defaultPlanPath = path.join(root, '.runtime/pill-art-plan.json');
const selectedPlanPath = planPath ? path.resolve(planPath) : defaultPlanPath;
const suppliedPlan = await fs.readFile(selectedPlanPath, 'utf8').then(JSON.parse).catch(() => null);
const planAtlas = suppliedPlan?.atlases?.find((entry) => entry.id === `realm-pills-${atlasKey}`)
  ?? (existingAtlas ? { entries: existingAtlas.records.map((record, cell) => ({ itemId: record.id, name: record.name, description: record.description, cell })) } : null);
assert.ok(planAtlas, `缺少 realm-pills-${atlasKey} 美術計畫`);
const columns = 6, rows = atlasKey === 'a' ? 6 : 5;
const rawColumns = atlasKey === 'a' ? 6 : 7, rawRows = atlasKey === 'a' ? 6 : 5;
const bRawCells = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 31, 32];
assert.equal(planAtlas.entries.length, atlasKey === 'a' ? 36 : 29, '圖集計畫格數錯誤');
const promptFile = path.join(root, '.runtime', atlasKey === 'a' ? 'agy-generate-pills-prompt.txt' : 'agy-correct-b-prompt.txt');
const prompt = promptPath
  ? await fs.readFile(path.resolve(promptPath), 'utf8')
  : await fs.readFile(promptFile, 'utf8').catch(() => existingAtlas?.prompt ?? '');
assert.ok(prompt.trim(), '需要 --prompt，或保留既有 atlas metadata 的 prompt');
const original = await fs.readFile(path.resolve(sourcePath));
const sourceSha256 = hash(original);
const { data: source, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
assert.deepEqual([info.width, info.height], atlasKey === 'a' ? [1024, 1024] : [1264, 848], 'AGY 圖集尺寸與核對記錄不符');
let override = null;
if (atlasKey === 'b') {
  assert.ok(overrideSourcePath, 'B 需要 --override-source <初版 B 圖集> 供 body swift 使用');
  const bytes = await fs.readFile(path.resolve(overrideSourcePath));
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([decoded.info.width, decoded.info.height], [1024, 1024], 'B override 必須為原 6x6 圖集');
  override = { source: decoded.data, info: decoded.info, sha256: hash(bytes), columns: 6, rows: 6 };
}

function rectFor(atlas, index) {
  const col = index % atlas.columns, row = Math.floor(index / atlas.columns);
  const left = Math.round(col * atlas.info.width / atlas.columns), top = Math.round(row * atlas.info.height / atlas.rows);
  return { col, row, left, top, width: Math.round((col + 1) * atlas.info.width / atlas.columns) - left, height: Math.round((row + 1) * atlas.info.height / atlas.rows) - top };
}
function isMagenta(r, g, b) {
  // JPEG 邊緣會把 #ff00ff 與主體混色，不能只辨識純洋紅。
  return r > g + 40 && b > g + 40 && r + b > 280;
}
function buildGlobalComponents(atlas) {
  const total = atlas.info.width * atlas.info.height, mask = new Uint8Array(total), labels = new Int32Array(total), queue = new Int32Array(total), components = [];
  for (let pixel = 0; pixel < total; pixel++) { const offset = pixel * 4; mask[pixel] = atlas.source[offset + 3] > 8 && !isMagenta(atlas.source[offset], atlas.source[offset + 1], atlas.source[offset + 2]) ? 1 : 0; }
  for (let start = 0; start < total; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = components.length + 1; let head = 0, tail = 1, minX = info.width, minY = info.height, maxX = 0, maxY = 0, sumX = 0, sumY = 0;
    labels[start] = label; queue[0] = start;
    while (head < tail) {
      const point = queue[head++], x = point % atlas.info.width, y = Math.floor(point / atlas.info.width); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); sumX += x; sumY += y;
      for (const next of [x ? point - 1 : -1, x + 1 < atlas.info.width ? point + 1 : -1, y ? point - atlas.info.width : -1, y + 1 < atlas.info.height ? point + atlas.info.width : -1]) if (next >= 0 && mask[next] && !labels[next]) { labels[next] = label; queue[tail++] = next; }
    }
    components.push({ label, size: tail, minX, minY, maxX, maxY, slot: Math.min(atlas.columns - 1, Math.floor(sumX / tail * atlas.columns / atlas.info.width)) + atlas.columns * Math.min(atlas.rows - 1, Math.floor(sumY / tail * atlas.rows / atlas.info.height)) });
  }
  return { labels, components };
}
const primary = { source, info, sha256: sourceSha256, columns: rawColumns, rows: rawRows }; primary.components = buildGlobalComponents(primary); if (override) override.components = buildGlobalComponents(override);
function cleanCell(atlas, rawCell, id) {
  const candidates = atlas.components.components.filter((component) => component.slot === rawCell).sort((left, right) => right.size - left.size);
  assert.ok(candidates[0]?.size >= 30, `${id} 沒有可辨識主體`);
  const retained = candidates.filter((component) => component.size >= Math.max(12, candidates[0].size * .008)); const keep = new Set(retained.map((component) => component.label));
  const minX = Math.min(...retained.map((component) => component.minX)), minY = Math.min(...retained.map((component) => component.minY)), maxX = Math.max(...retained.map((component) => component.maxX)), maxY = Math.max(...retained.map((component) => component.maxY));
  assert.ok(minX >= 2 && minY >= 2 && maxX <= atlas.info.width - 3 && maxY <= atlas.info.height - 3, `${id} 輪廓碰到圖集邊緣，疑似被裁斷`);
  const pad = 3, left = Math.max(0, minX - pad), top = Math.max(0, minY - pad), width = Math.min(atlas.info.width - left, maxX - minX + 1 + pad * 2), height = Math.min(atlas.info.height - top, maxY - minY + 1 + pad * 2), clean = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const point = (top + y) * atlas.info.width + left + x, destination = (y * width + x) * 4; if (!keep.has(atlas.components.labels[point])) continue; const offset = point * 4; clean[destination] = atlas.source[offset]; clean[destination + 1] = atlas.source[offset + 1]; clean[destination + 2] = atlas.source[offset + 2]; clean[destination + 3] = 255; }
  return { clean, width, height, extraction: { method: 'magenta-key-connected-components', magentaRule: 'r>g+40,b>g+40,r+b>280', componentMinRatio: .008, contentRatio: .84, retainedComponents: retained.map((component) => ({ size: component.size, box: [component.minX, component.minY, component.maxX, component.maxY] })), crop: { left, top, width, height } } };
}
async function writeIcon(cleaned, id) {
  const crop = await sharp(cleaned.clean, { raw: { width: cleaned.width, height: cleaned.height, channels: 4 } }).png().toBuffer();
  const outputs = [];
  for (const size of [96, 192]) {
    const inner = Math.round(size * .84), margin = Math.floor((size - inner) / 2);
    const resized = await sharp(crop).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const bytes = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: resized, left: margin, top: margin }]).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toBuffer();
    const relative = `assets/item-icons/v1/${id}-${size}.webp`;
    await fs.writeFile(path.join(root, 'packages/client/public', relative), bytes);
    outputs.push({ size, path: relative, sha256: hash(bytes), bytes: bytes.length });
  }
  return { cropSha256: hash(crop), outputs };
}
const manifestPath = path.join(root, 'docs/artwork/item-icons-v1.json');
const mappingPath = path.join(root, 'packages/client/src/constants/world/item-art.generated.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); const mapping = JSON.parse(await fs.readFile(mappingPath, 'utf8'));
const records = [];
for (const [index, entry] of planAtlas.entries.entries()) {
  const rawCell = atlasKey === 'a' ? entry.cell : bRawCells[index];
  const overrideCell = atlasKey === 'b' ? new Map([[5, 5], [23, 29], [24, 30]]).get(index) : undefined;
  const selectedAtlas = overrideCell === undefined ? primary : override;
  const selectedCell = overrideCell ?? rawCell;
  const cell = rectFor(selectedAtlas, selectedCell), cleaned = cleanCell(selectedAtlas, selectedCell, entry.itemId), icon = await writeIcon(cleaned, entry.itemId);
  const record = { id: entry.itemId, name: entry.name, description: entry.description ?? `${entry.realm}：${typeof entry.effect === 'string' ? entry.effect : Object.keys(entry.effect).join('、')}。${entry.visual}`,
    mode: 'agy-generate-image-atlas', source: selectedAtlas === primary ? path.resolve(sourcePath) : path.resolve(overrideSourcePath), sourceSha256: selectedAtlas.sha256, originalSha256: selectedAtlas.sha256, prompt, atlas: `atlases/realm-pills-${atlasKey}.webp`, grid: { columns: selectedAtlas.columns, rows: selectedAtlas.rows }, cell, extraction: { ...cleaned.extraction, ...(selectedAtlas === primary ? {} : { override: `realm-pills-b original 6x6 cell ${selectedCell}; corrected atlas raw cell ${rawCell} was not usable` }) }, variants: [96, 192], ...icon };
  records.push(record); mapping[entry.itemId] = `/assets/item-icons/v1/${entry.itemId}`;
}
assert.equal(new Set(records.map((record) => record.cropSha256)).size, records.length, '同批裁切圖示不得重複');
manifest.records = [...manifest.records.filter((record) => !records.some((entry) => entry.id === record.id)), ...records];
let atlasBytes; let atlasDimensions;
if (atlasKey === 'a') {
  const atlasRgba = Buffer.alloc(info.width * info.height * 4);
  for (let pixel = 0; pixel < info.width * info.height; pixel++) { const offset = pixel * 4, r = source[offset], g = source[offset + 1], b = source[offset + 2]; if (!isMagenta(r, g, b)) { atlasRgba[offset] = r; atlasRgba[offset + 1] = g; atlasRgba[offset + 2] = b; atlasRgba[offset + 3] = 255; } }
  atlasBytes = await sharp(atlasRgba, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ lossless: true, effort: 6 }).toBuffer(); atlasDimensions = [info.width, info.height];
} else {
  const composites = await Promise.all(records.map(async (record, index) => ({ input: await sharp(path.join(root, 'packages/client/public', record.outputs[1].path)).resize(132, 132, { fit: 'contain' }).png().toBuffer(), left: (index % 6) * 171 + 19, top: Math.floor(index / 6) * 205 + 36 })));
  atlasBytes = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).webp({ lossless: true, effort: 6 }).toBuffer(); atlasDimensions = [1024, 1024];
}
await fs.writeFile(path.join(root, 'docs/artwork/atlases', `realm-pills-${atlasKey}.webp`), atlasBytes);
await fs.writeFile(path.join(root, 'docs/artwork/atlases', `realm-pills-${atlasKey}.json`), `${JSON.stringify({ id: `realm-pills-${atlasKey}`, mode: 'agy-generate-image-atlas', source: path.resolve(sourcePath), sourceSha256, originalSha256: sourceSha256, prompt, columns, rows, dimensions: atlasDimensions, rawGrid: { columns: rawColumns, rows: rawRows }, records }, null, 2)}\n`);
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); await fs.writeFile(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);
const thumbs = await Promise.all(records.map(async (record, index) => ({ input: path.join(root, 'packages/client/public', record.outputs[0].path), left: (index % columns) * 160, top: Math.floor(index / columns) * 160 })));
const sheet = sharp({ create: { width: 960, height: Math.ceil(records.length / columns) * 160, channels: 4, background: { r: 20, g: 25, b: 35, alpha: 1 } } }).composite(thumbs);
await fs.writeFile(path.join(root, '.runtime', `realm-pills-${atlasKey}-contact-sheet.webp`), await sheet.webp({ quality: 92, effort: 6 }).toBuffer());
const allEntries = suppliedPlan?.atlases?.flatMap((atlas) => atlas.entries) ?? [
  ...(await fs.readFile(path.join(root, 'docs/artwork/atlases/realm-pills-a.json'), 'utf8').then(JSON.parse)).records.map((record) => ({ itemId: record.id })),
  ...(await fs.readFile(path.join(root, 'docs/artwork/atlases/realm-pills-b.json'), 'utf8').then(JSON.parse)).records.map((record) => ({ itemId: record.id })),
];
const allThumbs = allEntries.map((entry, index) => ({ input: path.join(root, 'packages/client/public', `assets/item-icons/v1/${entry.itemId}-96.webp`), left: (index % 6) * 160, top: Math.floor(index / 6) * 160 }));
const allSheet = sharp({ create: { width: 960, height: Math.ceil(allEntries.length / 6) * 160, channels: 4, background: { r: 20, g: 25, b: 35, alpha: 1 } } }).composite(allThumbs);
await fs.writeFile(path.join(root, '.runtime', 'realm-pills-contact-sheet.webp'), await allSheet.webp({ quality: 92, effort: 6 }).toBuffer());
console.log(JSON.stringify({ ok: true, atlas: atlasKey, records: records.length, outputs: records.length * 2, sourceSha256, contactSheet: `.runtime/realm-pills-${atlasKey}-contact-sheet.webp`, totalContactSheet: '.runtime/realm-pills-contact-sheet.webp' }));
