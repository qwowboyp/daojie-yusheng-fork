#!/usr/bin/env node
/** 驗證境界丹 AGY 圖集的來源可追溯性、透明邊緣、裁切完整性與正式映射。 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function loadSharp() { try { return require('sharp'); } catch { return createRequire(path.join(process.env.CODEX_BUNDLED_NODE_MODULES ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'package.json'))('sharp'); } }
const sharp = loadSharp(); const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const read = async (relativePath) => JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
async function loadContentItems(relativePath = 'packages/server/data/content/items') {
  const absolutePath = path.join(root, relativePath); const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? loadContentItems(path.join(relativePath, entry.name)) : (entry.name.endsWith('.json') ? read(path.join(relativePath, entry.name)) : [])))).flat();
}
const contentItems = await loadContentItems();
const expected = new Set(contentItems.filter((item) => typeof item.itemId === 'string' && item.itemId.startsWith('pill.realm.')).map((item) => item.itemId));
assert.equal(expected.size, 63, '正式內容必須有 63 種境界丹');
for (const itemId of ['mat.ascension_cloudstep_orchid', 'mat.ascension_starfold_crystal']) { assert.ok(contentItems.some((item) => item.itemId === itemId), `正式內容缺少 ${itemId}`); expected.add(itemId); }
assert.equal(expected.size, 65);
const manifest = await read('docs/artwork/item-icons-v1.json'); const records = new Map(manifest.records.map((record) => [record.id, record]));
const mapping = await read('packages/client/src/constants/world/item-art.generated.json'); const imageHashes = new Set(); let outputCount = 0;
const atlasIds = new Set();
// 證明背景鍵色未殘留；紫晶、靈流等正常主體顏色不可誤判為洋紅。
function hasMagenta(r, g, b, a) { return a > 8 && r > 210 && b > 210 && g < 100; }
for (const atlasKey of ['a', 'b']) {
  const atlas = await read(`docs/artwork/atlases/realm-pills-${atlasKey}.json`);
  assert.equal(atlas.mode, 'agy-generate-image-atlas'); assert.equal(atlas.columns, 6); assert.equal(atlas.rows, atlasKey === 'a' ? 6 : 5);
  assert.equal(atlas.records.length, atlasKey === 'a' ? 36 : 29); assert.ok(atlas.sourceSha256 && atlas.originalSha256 && atlas.prompt.trim());
  if (atlasKey === 'b') { assert.deepEqual(atlas.rawGrid, { columns: 7, rows: 5 }); assert.ok(atlas.records[5].extraction.override); assert.ok(atlas.records[23].extraction.override); assert.ok(atlas.records[24].extraction.override); }
  const atlasPath = path.join(root, `docs/artwork/atlases/realm-pills-${atlasKey}.webp`); const atlasMeta = await sharp(atlasPath).metadata(); assert.equal(atlasMeta.hasAlpha, true);
  for (const record of atlas.records) {
    assert.ok(expected.has(record.id), `atlas 收錄非正式境界物品 ${record.id}`); atlasIds.add(record.id);
    assert.deepEqual(records.get(record.id), record, `manifest 與 atlas metadata 不一致 ${record.id}`); assert.equal(record.mode, 'agy-generate-image-atlas'); assert.equal(mapping[record.id], `/assets/item-icons/v1/${record.id}`);
    assert.equal(record.atlas, `atlases/realm-pills-${atlasKey}.webp`); assert.equal(record.sourceSha256, record.originalSha256); assert.equal(record.variants.join(','), '96,192');
    assert.ok(record.extraction?.retainedComponents?.length, `${record.id} 缺少連通輪廓記錄`);
    for (const output of record.outputs) {
      const bytes = await fs.readFile(path.join(root, 'packages/client/public', output.path)); assert.equal(hash(bytes), output.sha256); assert.ok(output.bytes > 400);
      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); assert.equal(decoded.info.width, output.size); assert.equal(decoded.info.height, output.size);
      let transparent = 0;
      for (let pixel = 0; pixel < decoded.info.width * decoded.info.height; pixel++) { const offset = pixel * 4; if (decoded.data[offset + 3] < 8) transparent++; assert.equal(hasMagenta(decoded.data[offset], decoded.data[offset + 1], decoded.data[offset + 2], decoded.data[offset + 3]), false, `${record.id} 殘留洋紅`); }
      assert.ok(transparent > decoded.info.width * decoded.info.height * .15, `${record.id} 透明留白不足`); assert.ok(!imageHashes.has(output.sha256), `${record.id} 圖示與同批重複`); imageHashes.add(output.sha256); outputCount++;
    }
  }
}
assert.deepEqual([...atlasIds].sort(), [...expected].sort(), '正式 65 件物品與兩張 atlas metadata 必須一一對應');
assert.equal(outputCount, 130); assert.equal(imageHashes.size, 130);
console.log(JSON.stringify({ ok: true, items: 65, outputs: outputCount, uniqueHashes: imageHashes.size, alphaAndMagentaChecked: true }));
