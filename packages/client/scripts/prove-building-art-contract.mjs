import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(scriptDirectory, '..');
const repoRoot = path.resolve(clientRoot, '../..');
const manifestPath = path.join(clientRoot, 'public/assets/runtime-image-packs/default/manifest.json');
const artRoot = path.join(clientRoot, 'public/assets/building-art/v1');
const ids = [
  'stone_wall',
  'wooden_door',
  'wooden_window',
  'plain_floor',
  'scripture_platform',
  'treasure_vault',
  'technique_refining_table',
  'technique_unification_platform',
  'time_chamber',
  'meditation_mat',
];
const tileIds = new Set(ids.slice(0, 4));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertWebp(relativeName) {
  const filePath = path.join(artRoot, relativeName);
  const bytes = fs.readFileSync(filePath);
  assert.ok(bytes.length > 64, `${relativeName} 不得是空白佔位檔`);
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', `${relativeName} 必須是 RIFF WebP`);
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', `${relativeName} 必須是 WebP`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const id of ids) {
  const key = `building:${id}`;
  const ref = tileIds.has(id) ? manifest.tiles?.[key] : manifest.entities?.[key];
  assert.ok(ref, `${key} 必須存在於正確的 manifest 分層`);
  assert.equal(ref.src, `/assets/building-art/v1/${id}-ground-256.webp`, `${key} 必須指向固定 ground 路徑`);
  assert.equal(ref.cols, 1, `${key} 不得沿用 atlas 多欄取樣`);
  assert.equal(ref.rows, 1, `${key} 不得沿用 atlas 多列取樣`);
  assert.notEqual(ref.meta?.dualGrid, true, `${key} 不得沿用 dual-grid 變體`);
  assertWebp(`${id}-ground-256.webp`);
  assertWebp(`${id}-icon-96.webp`);
  assertWebp(`${id}-icon-192.webp`);
}
for (const key of ['structure:wall', 'structure:door', 'structure:window', 'surface:floor']) {
  assert.ok(manifest.tiles?.[key], `${key} 通用地形 key 必須保留`);
  assert.match(manifest.tiles[key].src, /dual-grid\./, `${key} 不得被自建建築單格圖覆寫`);
}

const vite = await createServer({ root: clientRoot, logLevel: 'silent', server: { middlewareMode: true } });
try {
  const entityFacing = await vite.ssrLoadModule('/src/entity-facing.ts');
  const pixiManifest = await vite.ssrLoadModule('/src/game-map/renderer/pixi-runtime-image-manifest.ts');
  const protobuf = await vite.ssrLoadModule(path.join(repoRoot, 'packages/shared/src/network-protobuf.ts'));
  assert.deepEqual(
    entityFacing.buildEntitySpriteLookupPlan({
      id: 'runtime-can-change',
      kind: 'building',
      name: '玩家已改名',
      char: '台',
      buildingDefId: 'time_chamber',
    }).keys,
    ['building:time_chamber'],
    '建築實體只能依穩定 defId 選圖',
  );
  assert.deepEqual(
    entityFacing.buildEntitySpriteLookupPlan({ id: 'runtime', kind: 'building', name: '藏寶閣', char: '寶' }).keys,
    [],
    '缺少 defId 時不得按名稱、glyph 或執行期 ID 猜圖',
  );
  for (const id of ids) {
    assert.equal(entityFacing.resolveBuildingPreviewSpriteKey({ id }), `building:${id}`, '預覽必須使用穩定建築 key');
  }
  const legacy = new Map([['floor', 'terrain:floor']]);
  assert.equal(
    pixiManifest.resolveTopTileSpriteKey({ type: 'floor', structureType: 'wall', surfaceType: 'floor', buildingDefId: 'stone_wall' }, legacy),
    'building:stone_wall',
    '玩家自建結構必須覆蓋該格通用結構圖',
  );
  assert.equal(
    pixiManifest.resolveTopTileSpriteKey({ type: 'floor', structureType: 'wall', surfaceType: 'floor' }, legacy),
    'structure:wall',
    '沒有自建投影時必須保留模板結構圖',
  );
  assert.equal(
    pixiManifest.resolveTopTileSpriteKey({ type: 'floor', surfaceType: 'floor', buildingDefId: 'plain_floor' }, legacy),
    'building:plain_floor',
    '拆除上層自建牆後，自建地板必須可重新顯示',
  );
  const fullPayload = {
    t: 1,
    wr: 2,
    sr: 3,
    full: 1,
    bd: [{ id: 'building:1', di: 'time_chamber', x: 4, y: 5 }],
    tp: [{ x: 4, y: 5, tile: { type: 'floor', buildingDefId: 'stone_wall' } }],
  };
  const fullDecoded = protobuf.decodeServerEventPayload(
    'n:s:worldDelta',
    protobuf.encodeServerEventPayload('n:s:worldDelta', fullPayload),
  );
  assert.deepEqual(fullDecoded, fullPayload, 'worldDelta JSON binary 首包必須保留 entity/tile 建築身份');
  const clearPayload = {
    t: 2,
    wr: 3,
    sr: 3,
    bd: [{ id: 'building:1', di: null }],
    tp: [{ x: 4, y: 5, tile: { type: 'floor', surfaceType: 'floor' } }],
  };
  const clearDecoded = protobuf.decodeServerEventPayload(
    'n:s:worldDelta',
    protobuf.encodeServerEventPayload('n:s:worldDelta', clearPayload),
  );
  assert.deepEqual(clearDecoded, clearPayload, 'worldDelta JSON binary 差量必須保留 defId null 清除與 tile 替換');
  const tileWire = protobuf.toWireVisibleTile({ type: 'floor', structureType: 'wall', buildingDefId: 'stone_wall' });
  assert.equal(tileWire.buildingDefId, 'stone_wall', '固定欄位 tile wire helper 必須編碼建築身份');
  assert.equal(protobuf.fromWireVisibleTile(tileWire)?.buildingDefId, 'stone_wall', '固定欄位 tile wire helper 必須解碼建築身份');
} finally {
  await vite.close();
}

const projectorSource = read('packages/server/src/network/world-projector.helpers.ts');
const diffSource = read('packages/server/src/network/projector-diff.ts');
const deltaSource = read('packages/client/src/main-runtime-delta-state-source.ts');
const tileSnapshotSource = read('packages/server/src/network/world-sync-map-snapshot.service.ts');
assert.match(projectorSource, /di:\s*entry\.defId/, '建築實體首包必須投影穩定 defId');
assert.match(diffSource, /prev\.di !== entry\.di[\s\S]*?delta\.di = entry\.di/, '建築實體差量必須更新穩定 defId');
assert.match(deltaSource, /patch\.di === null \? undefined : patch\.di \?\? previous\?\.buildingDefId/, '客戶端必須支援 defId 更新與清除');
assert.match(tileSnapshotSource, /tile\.buildingDefId = state\.buildingDefId/, '完工結構與地板必須以 tile 派生欄位投影');
assert.match(tileSnapshotSource, /left\.buildingDefId === right\.buildingDefId/, 'AOI tile cache 必須在建築身份變更時失效');

console.log('自建建築圖片 manifest、穩定 ID、Canvas/Pixi 選圖與預覽契約證明通過');
