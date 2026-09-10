/** 內容目錄與生成美術一一對應，避免新模板漏圖或漏帶行動版產物。 */
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(clientRoot, '../..');
const itemRoot = path.join(repoRoot, 'packages/server/data/content/items');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function readItems(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await readItems(file));
    else if (entry.name.endsWith('.json')) {
      const data = await readJson(file);
      result.push(...(Array.isArray(data) ? data : [data]));
    }
  }
  return result;
}

const items = await readItems(itemRoot);
const icons = await readJson(path.join(clientRoot, 'src/constants/world/item-art.generated.json'));
const manifest = await readJson(path.join(clientRoot, 'public/assets/runtime-image-packs/default/manifest.json'));
const buildings = await readJson(path.join(repoRoot, 'packages/server/data/content/building-runtime/buildings.json'));
const files = [];
for (const item of items) {
  const stem = `/assets/item-icons/v1/${item.itemId}`;
  assert.equal(icons[item.itemId], stem, `道具未配圖：${item.itemId} ${item.name}`);
  files.push(`${stem}-96.webp`, `${stem}-192.webp`);
}
const tileBuildings = new Set(['stone_wall', 'wooden_door', 'wooden_window', 'plain_floor']);
for (const building of buildings) {
  const stem = `/assets/building-art/v1/${building.id}`;
  files.push(`${stem}-icon-96.webp`, `${stem}-icon-192.webp`, `${stem}-ground-256.webp`);
  const entry = tileBuildings.has(building.id) ? manifest.tiles[`building:${building.id}`] : manifest.entities[`building:${building.id}`];
  assert.equal(entry?.src, `${stem}-ground-256.webp`, `建築地圖未配圖：${building.id}`);
}
let bytes = 0;
for (const file of files) {
  const asset = await stat(path.join(clientRoot, 'public', file));
  assert(asset.isFile() && asset.size > 0, `美術產物缺失：${file}`);
  bytes += asset.size;
}
console.log(`DESCRIPTION_ART_ASSETS:PASS items=${items.length} buildings=${buildings.length} files=${files.length} bytes=${bytes}`);
