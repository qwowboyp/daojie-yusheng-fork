/** 新內容的 stable ID、圖集格位、來源與正式輸出完整性。瀏覽器解碼另見 client proof。 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const items = read('packages/server/data/content/items/筑基期/青霖澤.json');
const monsters = read('packages/server/data/content/monsters/青霖澤.json');
const mapping = read('packages/client/src/constants/world/item-art.generated.json');
const pack = read('packages/client/public/assets/runtime-image-packs/default/manifest.json');
const itemRecords = read('docs/artwork/item-icons-v1.json').records;
assert.equal(items.length, 16);
assert.equal(monsters.length, 6);
assert.ok(pack.version >= 11);
assert.equal(pack.entities['container:青霖蘭'].src, '/assets/item-icons/v1/mat.qinglin_orchid-192.webp');
assert.equal(pack.entities['container:澤心苓'].src, '/assets/item-icons/v1/mat.qinglin_ling-192.webp');
let outputCount = 0;
for (const [kind, entries, sizes] of [['items', items, [96, 192]], ['monsters', monsters, [128]]]) {
  const id = `foundation-qinglin-${kind}-01`;
  const atlas = read(`docs/artwork/atlases/${id}.json`);
  const expected = entries.map((entry) => entry.itemId ?? entry.id).sort();
  assert.deepEqual(atlas.records.map((record) => record.id).sort(), expected);
  assert.equal(atlas.columns * atlas.rows, entries.length);
  assert.equal(new Set(atlas.records.map((record) => `${record.cell.col},${record.cell.row}`)).size, entries.length);
  assert.equal(new Set(atlas.records.map((record) => record.cropSha256)).size, entries.length);
  assert.equal(hash(`docs/artwork/atlases/${id}.webp`), atlas.atlasSha256);
  assert.ok(atlas.prompt && atlas.editPrompt);
  for (const record of atlas.records) {
    assert.equal(record.sourceSha256, atlas.sourceSha256);
    assert.equal(record.extraction.method, 'connected-alpha-components');
    assert.deepEqual(record.outputs.map((output) => output.size), sizes);
    assert.ok(record.cell.col >= 0 && record.cell.col < atlas.columns);
    assert.ok(record.cell.row >= 0 && record.cell.row < atlas.rows);
    if (kind === 'items') {
      assert.equal(mapping[record.id], `/assets/item-icons/v1/${record.id}`);
      assert.deepEqual(itemRecords.find((entry) => entry.id === record.id), record);
    } else {
      const ref = pack.entities[`monster:${record.id}`];
      assert.equal(ref.src, `monsters/${record.id}.png`);
      assert.equal(ref.cols, 1);
      assert.equal(ref.rows, 1);
      assert.equal(ref.fit, 'contain');
    }
    for (const output of record.outputs) {
      const expectedPath = kind === 'items' ? `assets/item-icons/v1/${record.id}-${output.size}.webp`
        : `assets/runtime-image-packs/default/monsters/${record.id}.png`;
      assert.equal(output.path, expectedPath);
      assert.equal(hash(`packages/client/public/${output.path}`), output.sha256);
      assert.ok(output.bytes > 500);
      outputCount++;
    }
  }
}
console.log(JSON.stringify({ ok: true, items: items.length, monsters: monsters.length, outputs: outputCount }));
