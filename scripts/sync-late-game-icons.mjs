#!/usr/bin/env node
/** 將既有美術依類型配給後期物品，保留每個模板的穩定圖示路徑與來源紀錄。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const itemRoot = path.join(root, 'packages/server/data/content/items');
function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap((entry) => entry.isDirectory() ? collect(path.join(directory, entry.name))
      : entry.name.endsWith('.json') ? JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8')) : []);
}
const current = [...read('packages/server/data/content/items/後期七境/內容.json'),
  ...read('packages/server/data/content/items/後期七境/功法書.json')];
const uniqueManifest = read('docs/artwork/late-game-unique-icons.json');
const uniqueRecords = Array.isArray(uniqueManifest.records) ? uniqueManifest.records : [];
assert.equal(uniqueRecords.length, 224, '獨立美術 manifest 必須完整登錄 224 筆');
const uniqueById = new Map(uniqueRecords.map((record) => [record.id, record]));
assert.equal(uniqueById.size, uniqueRecords.length, '獨立美術 manifest 含重複 ID');
const currentById = new Map(current.map((item) => [item.itemId, item]));
for (const [id, record] of uniqueById) {
  assert.ok(currentById.has(id), `獨立美術對應不存在的後期物品 ${id}`);
  assert.equal(record.stem, `/assets/item-icons/v2/${id}`, `獨立美術 stem 不符 ${id}`);
}
const bookArtSources = { '內功': 'book.ningqi_chengji', '法術': 'book.frost_sutra',
  '神通': 'book.wildsunder_chart', '秘術': 'book.mountain_insight_chart' };
const iconFile = 'packages/client/src/constants/world/item-art.generated.json';
const icons = read(iconFile);
function validateUnique(record) {
  assert.equal(icons[record.id], record.stem, `獨立美術映射被覆蓋 ${record.id}`);
  for (const size of [96, 192]) {
    const file = path.join(root, 'packages/client/public', `${record.stem}-${size}.webp`);
    assert.ok(fs.statSync(file).size > 0, `獨立美術產物缺失 ${record.id} ${size}`);
  }
}
for (const record of uniqueRecords) validateUnique(record);
const uniqueIds = new Set(uniqueById.keys());
const reuseItems = current.filter((item) => !uniqueIds.has(item.itemId));
assert.equal(reuseItems.length, 247, '後期重用美術應只保留 247 筆消耗品');
const originals = collect(itemRoot).filter((item) => !currentById.has(item.itemId) && !/測試/.test(item.name));
const groups = [/草|蕨|莖|葦|芽|葉|藻|蘚/, /花|瓣|蓮/, /果|子/, /藤|根|鬚/, /菌|菇|芝/,
  /砂|沙|塵|屑/, /晶|玉|琉璃/, /鐵|金|鋼|銅/, /石|礦|岩/, /骨|骸|牙|角|爪/, /甲|殼|鱗/,
  /羽|翎/, /絲|線|繩/, /珮|佩|環|鏡|符|牌|印/, /頁|書|卷/, /火|燼|炎|熔/, /水|潮|瀾|海|霜|冰/];
function score(item, candidate) {
  let value = 0;
  for (const pattern of groups) if (pattern.test(item.name) && pattern.test(candidate.name)) value += 4;
  const source = item.materialValues?.elements ?? {};
  const target = candidate.materialValues?.elements ?? {};
  const dominant = Object.keys(source).sort((a, b) => source[b] - source[a])[0];
  const other = Object.keys(target).sort((a, b) => target[b] - target[a])[0];
  if (dominant && dominant === other) value += 3;
  if (item.grade === candidate.grade) value += 1;
  if (item.equipSlot === 'weapon') {
    if (/法杖/.test(item.name)) value += /杖/.test(candidate.name) ? 20 : /法尺/.test(candidate.name) ? 8 : 0;
    else value += /刃|劍|鋒/.test(candidate.name) ? 20 : 0;
  }
  return value;
}
const records = [];
let bytes = 0;
for (const item of reuseItems) {
  const candidates = originals.filter((candidate) => icons[candidate.itemId] && candidate.type === item.type
    && (item.type !== 'equipment' || candidate.equipSlot === item.equipSlot)
    && (item.type !== 'material' || candidate.materialCategory === item.materialCategory)
    && (item.type !== 'consumable' || /丹$/.test(candidate.name)));
  candidates.sort((a, b) => score(item, b) - score(item, a) || a.itemId.localeCompare(b.itemId, 'en'));
  const bookSourceId = item.type === 'skill_book'
    ? bookArtSources[item.tags.find((tag) => bookArtSources[tag])] : undefined;
  const source = bookSourceId ? originals.find((candidate) => candidate.itemId === bookSourceId) : candidates[0];
  assert.ok(source, `缺少合適的既有圖片 ${item.itemId}`);
  const stem = `/assets/item-icons/v1/${item.itemId}`;
  for (const size of [96, 192]) {
    const original = path.join(root, 'packages/client/public', `${icons[source.itemId]}-${size}.webp`);
    const target = path.join(root, 'packages/client/public', `${stem}-${size}.webp`);
    const content = fs.readFileSync(original);
    bytes += content.length;
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content)) fs.writeFileSync(target, content);
  }
  icons[item.itemId] = stem;
  records.push({ itemId: item.itemId, name: item.name, sourceItemId: source.itemId,
    sourceName: source.name, mode: 'existing-art-reuse', variants: [96, 192] });
}
for (const record of uniqueRecords) validateUnique(record);
fs.writeFileSync(path.join(root, iconFile), JSON.stringify(icons, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'docs/artwork/late-game-icon-reuse.json'), JSON.stringify({
  description: '後期消耗品沿用既有同類美術；獨立繪製的功法書與裝備記錄於 late-game-unique-icons.json。', records,
}, null, 2) + '\n');
console.log(JSON.stringify({ uniqueItems: uniqueRecords.length, reusedItems: records.length, files: records.length * 2, bytes,
  distinctSources: new Set(records.map((entry) => entry.sourceItemId)).size }));
