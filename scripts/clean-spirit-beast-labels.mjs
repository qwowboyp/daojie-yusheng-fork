import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve('.');
const reportRoot = path.join(root, '.runtime/reports/spirit-beasts-design-20260914/art');
const outputDir = path.join(root, 'packages/client/public/assets/spirit-beasts/species');
const grades = ['fan', 'human', 'heaven', 'saint', 'immortal'];

function isMagenta(r, g, b) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  if (max <= 90 || delta / max <= 0.18) return false;
  const hue = delta === 0 ? 0 : (max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
  return hue >= 250 && hue <= 345;
}

function isLabelInk(r, g, b, y, height) {
  if (y >= 32 && y < height - 44) return false;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  if (max >= 190 || delta < 18 || delta / Math.max(1, max) < 0.28) return false;
  const hue = max === r ? ((g - b) / delta + 6) % 6 * 60 : max === g ? ((b - r) / delta + 2) * 60 : ((r - g) / delta + 4) * 60;
  return hue >= 250 && hue <= 350;
}

function components(pixels, width, height) {
  const seen = new Uint8Array(width * height);
  const result = [];
  const indexOf = (x, y) => y * width + x;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const start = indexOf(x, y);
    if (seen[start] || pixels[start * 4 + 3] < 20) continue;
    const queue = [start]; seen[start] = 1;
    let area = 0; let minX = x; let maxX = x; let minY = y; let maxY = y;
    for (let head = 0; head < queue.length; head += 1) {
      const point = queue[head]; const px = point % width; const py = Math.floor(point / width);
      area += 1; minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = indexOf(nx, ny);
        if (!seen[next] && pixels[next * 4 + 3] >= 20) { seen[next] = 1; queue.push(next); }
      }
    }
    result.push({ pixels: queue, area, minX, maxX, minY, maxY });
  }
  return result;
}

function boxDistance(a, b) {
  const dx = Math.max(0, a.minX - b.maxX - 1, b.minX - a.maxX - 1);
  const dy = Math.max(0, a.minY - b.maxY - 1, b.minY - a.maxY - 1);
  return Math.max(dx, dy);
}

const contactCells = [];
for (const grade of grades) {
  const sourceDir = path.join(reportRoot, `species-${grade}`);
  const source = path.join(sourceDir, `spirit-beasts-${grade}-raw.png`);
  const roster = JSON.parse(fs.readFileSync(path.join(sourceDir, 'roster.json'), 'utf8'));
  const meta = await sharp(source).metadata();
  const cellWidth = meta.width / roster.columns; const cellHeight = meta.height / roster.rows;
  const records = [];
  for (const item of roster.items) {
    const left = Math.round(item.cell.col * cellWidth); const top = Math.round(item.cell.row * cellHeight);
    const width = Math.round((item.cell.col + 1) * cellWidth) - left; const height = Math.round((item.cell.row + 1) * cellHeight) - top;
    const pixels = await sharp(source).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer();
    for (let p = 0; p < pixels.length; p += 4) {
      const y = Math.floor(p / 4 / width);
      if (isMagenta(pixels[p], pixels[p + 1], pixels[p + 2]) || isLabelInk(pixels[p], pixels[p + 1], pixels[p + 2], y, height)) pixels[p + 3] = 0;
    }
    const parts = components(pixels, width, height).sort((a, b) => b.area - a.area);
    if (!parts[0] || parts[0].area < 64) throw new Error(`${item.id}: 找不到主體連通輪廓`);
    const primary = parts[0];
    // 每格主獸由連續描邊連成最大元件；名稱是獨立小字，即使靠近尾巴也不能併入。
    const kept = [primary];
    const keepSet = new Uint8Array(width * height);
    for (const part of kept) for (const pixel of part.pixels) keepSet[pixel] = 1;
    for (let index = 0; index < keepSet.length; index += 1) if (!keepSet[index]) pixels[index * 4 + 3] = 0;
    const minX = Math.max(0, Math.min(...kept.map((part) => part.minX)) - 5); const maxX = Math.min(width - 1, Math.max(...kept.map((part) => part.maxX)) + 5);
    const minY = Math.max(0, Math.min(...kept.map((part) => part.minY)) - 5); const maxY = Math.min(height - 1, Math.max(...kept.map((part) => part.maxY)) + 5);
    const cleaned = sharp(pixels, { raw: { width, height, channels: 4 } }).extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
    const outputs = [];
    for (const size of [96, 192]) {
      const target = path.join(outputDir, `${item.id}-${size}.webp`);
      await cleaned.clone().resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 92, alphaQuality: 100 }).toFile(target);
      const bytes = fs.readFileSync(target);
      outputs.push({ size, path: path.relative(root, target).replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    }
    contactCells.push({ id: item.id, file: path.join(outputDir, `${item.id}-96.webp`) });
    records.push({ ...item, source: path.relative(root, source).replaceAll('\\', '/'), extraction: { method: 'magenta-chroma-key-connected-primary-component', alphaKey: '#ff00ff', sourceCell: { left, top, width, height }, primaryComponent: { area: primary.area, left: primary.minX, top: primary.minY, width: primary.maxX - primary.minX + 1, height: primary.maxY - primary.minY + 1 }, keptComponentCount: kept.length, removedComponentCount: parts.length - kept.length, extraction: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, excludedReason: 'generator-added-text-components' }, outputs });
  }
  const manifest = { id: `spirit-beasts-${grade}-01`, grade, sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), nativeDimensions: [meta.width, meta.height], records };
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(sourceDir, 'art-manifest.json'), serialized);
  fs.writeFileSync(path.join(root, 'docs/artwork/atlases', `spirit-beasts-${grade}-01.json`), serialized);
}

const cellSize = 96; const columns = 15; const rows = Math.ceil(contactCells.length / columns);
const contact = sharp({ create: { width: columns * cellSize, height: rows * cellSize, channels: 4, background: { r: 28, g: 36, b: 47, alpha: 1 } } });
await contact.composite(contactCells.map((entry, index) => ({ input: entry.file, left: (index % columns) * cellSize, top: Math.floor(index / columns) * cellSize }))).png().toFile(path.join(reportRoot, 'spirit-beasts-contact-sheet-clean.png'));

const itemAssetDir = path.join(root, 'packages/client/public/assets/spirit-beasts/items');
const canonicalItemDir = path.join(root, 'packages/client/public/assets/item-icons/v1');
const canonicalBuildingDir = path.join(root, 'packages/client/public/assets/building-art/v1');
fs.mkdirSync(canonicalItemDir, { recursive: true });
fs.mkdirSync(canonicalBuildingDir, { recursive: true });
const iconMapPath = path.join(root, 'packages/client/src/constants/world/item-art.generated.json');
const iconMap = JSON.parse(fs.readFileSync(iconMapPath, 'utf8'));
const canonicalItemOutputs = [];
for (const element of ['metal', 'wood', 'water', 'fire', 'earth']) for (let star = 1; star <= 5; star += 1) {
  const id = `spirit_egg.${element}.star${star}`; const sourceId = `spirit_egg.${element}`;
  for (const size of [96, 192]) fs.copyFileSync(path.join(itemAssetDir, `${sourceId}-${size}.webp`), path.join(canonicalItemDir, `${id}-${size}.webp`));
  iconMap[id] = `/assets/item-icons/v1/${id}`;
  canonicalItemOutputs.push(id);
}
for (const id of ['seed.returnspring_leaf', 'seed.longvein_vine', 'seed.coldmarrow_reed', 'seed.bearingroot_ginseng', 'seed.goldthread_briar']) {
  for (const size of [96, 192]) fs.copyFileSync(path.join(itemAssetDir, `${id}-${size}.webp`), path.join(canonicalItemDir, `${id}-${size}.webp`));
  iconMap[id] = `/assets/item-icons/v1/${id}`;
  canonicalItemOutputs.push(id);
}
fs.writeFileSync(iconMapPath, JSON.stringify(iconMap, null, 2) + '\n');

const buildingIds = ['spirit_incubator_metal', 'spirit_incubator_wood', 'spirit_incubator_water', 'spirit_incubator_fire', 'spirit_incubator_earth', 'sect_iron_mine', 'sect_spirit_stone_mine', 'sect_spirit_field', 'sect_forging_station', 'sect_enhancement_station', 'sect_alchemy_station', 'spirit_egg_enhancement_station', 'spirit_beast_cultivation_station', 'spirit_beast_fusion_station'];
const buildingSourceDir = path.join(root, 'packages/client/public/assets/spirit-beasts/buildings');
const runtimeManifestPath = path.join(root, 'packages/client/public/assets/runtime-image-packs/default/manifest.json');
const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'));
for (const id of buildingIds) {
  for (const size of [96, 192]) fs.copyFileSync(path.join(buildingSourceDir, `${id}-${size}.webp`), path.join(canonicalBuildingDir, `${id}-icon-${size}.webp`));
  fs.copyFileSync(path.join(buildingSourceDir, `${id}-256.webp`), path.join(canonicalBuildingDir, `${id}-ground-256.webp`));
  runtimeManifest.entities[`building:${id}`] = { src: `/assets/building-art/v1/${id}-ground-256.webp`, cols: 1, rows: 1, fit: 'contain' };
}
fs.writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + '\n');
const itemManifestPath = path.join(root, 'docs/artwork/atlases/spirit-beasts-system-items-01.json');
const itemManifest = JSON.parse(fs.readFileSync(itemManifestPath, 'utf8'));
itemManifest.canonicalItemAliases = canonicalItemOutputs;
itemManifest.canonicalBuildingIds = buildingIds;
fs.writeFileSync(itemManifestPath, JSON.stringify(itemManifest, null, 2) + '\n');
fs.writeFileSync(path.join(reportRoot, 'items/art-manifest.json'), JSON.stringify(itemManifest, null, 2) + '\n');
console.log(`cleaned ${contactCells.length} species; canonical items=${canonicalItemOutputs.length}; buildings=${buildingIds.length}; contact sheet=${path.join(reportRoot, 'spirit-beasts-contact-sheet-clean.png')}`);
