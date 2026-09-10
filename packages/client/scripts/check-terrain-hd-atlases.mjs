/** 地塊 HD dual-grid atlas 的瀏覽器可重用結構與遮罩驗證。 */
export const TERRAIN_HD_STEMS = [
  'terrain-floor', 'grass', 'hill', 'water', 'mud', 'swamp', 'cold-bog', 'molten-pool',
  'cloud-floor', 'cloud', 'void', 'cliff', 'floor', 'trail', 'road', 'veranda', 'stone-stairs',
  'wall', 'door', 'window', 'house-eave', 'house-corner', 'screen-wall', 'tree', 'bamboo',
  'stone', 'spirit-ore', 'black-iron-ore', 'broken-sword-heap',
];

export const DUAL_GRID_MASK_COORDS = [
  [0, 3], [3, 3], [0, 0], [3, 2], [0, 2], [1, 2], [2, 3], [3, 1],
  [1, 3], [0, 1], [3, 0], [2, 0], [1, 0], [2, 2], [1, 1], [2, 1],
];

const ATLAS_SIZE = 1024;
const CELL_SIZE = 256;
const EDGE_TOLERANCE = 8;
const opaque = (alpha) => alpha >= 247;
const clear = (alpha) => alpha <= EDGE_TOLERANCE;

function assert(condition, message) {
  if (!condition) throw new Error(`terrain_hd_atlas: ${message}`);
}

function alphaAt(data, mask, x, y) {
  const [column, row] = DUAL_GRID_MASK_COORDS[mask];
  return data[((row * CELL_SIZE + y) * ATLAS_SIZE + column * CELL_SIZE + x) * 4 + 3];
}

function sideAlpha(data, mask, side, offset) {
  if (side === 'left') return alphaAt(data, mask, 0, offset);
  if (side === 'right') return alphaAt(data, mask, CELL_SIZE - 1, offset);
  if (side === 'top') return alphaAt(data, mask, offset, 0);
  return alphaAt(data, mask, offset, CELL_SIZE - 1);
}

function expectedSideBit(side, offset) {
  const firstHalf = offset < CELL_SIZE / 2;
  if (side === 'left') return firstHalf ? 1 : 2;
  if (side === 'right') return firstHalf ? 4 : 8;
  if (side === 'top') return firstHalf ? 1 : 4;
  return firstHalf ? 2 : 8;
}

function assertOuterEdges(data, stem) {
  for (let mask = 0; mask < 16; mask += 1) for (const side of ['left', 'right', 'top', 'bottom']) {
    for (let offset = 0; offset < CELL_SIZE; offset += 1) {
      const expected = (mask & expectedSideBit(side, offset)) !== 0;
      const alpha = sideAlpha(data, mask, side, offset);
      assert(expected ? opaque(alpha) : clear(alpha), `${stem}: mask${mask}_${side}_${offset}_outer_edge`);
    }
  }
}

/** 左/右、上/下只要兩個共享 corner 相等，邊界 alpha 必須逐像素吻合。 */
function assertSharedEdges(data, stem) {
  for (let leftMask = 0; leftMask < 16; leftMask += 1) for (let rightMask = 0; rightMask < 16; rightMask += 1) {
    if (((leftMask & 4) !== 0) !== ((rightMask & 1) !== 0) || ((leftMask & 8) !== 0) !== ((rightMask & 2) !== 0)) continue;
    for (let offset = 0; offset < CELL_SIZE; offset += 1) assert(Math.abs(sideAlpha(data, leftMask, 'right', offset) - sideAlpha(data, rightMask, 'left', offset)) <= EDGE_TOLERANCE, `${stem}: mask${leftMask}_right_mask${rightMask}_left_${offset}_shared_edge`);
  }
  for (let topMask = 0; topMask < 16; topMask += 1) for (let bottomMask = 0; bottomMask < 16; bottomMask += 1) {
    if (((topMask & 2) !== 0) !== ((bottomMask & 1) !== 0) || ((topMask & 8) !== 0) !== ((bottomMask & 4) !== 0)) continue;
    for (let offset = 0; offset < CELL_SIZE; offset += 1) assert(Math.abs(sideAlpha(data, topMask, 'bottom', offset) - sideAlpha(data, bottomMask, 'top', offset)) <= EDGE_TOLERANCE, `${stem}: mask${topMask}_bottom_mask${bottomMask}_top_${offset}_shared_edge`);
  }
}

function assertMaskShapes(data, stem) {
  for (const mask of [0, 15]) {
    const expected = mask === 15 ? 255 : 0;
    for (let y = 0; y < CELL_SIZE; y += 1) for (let x = 0; x < CELL_SIZE; x += 1) assert(alphaAt(data, mask, x, y) === expected, `${stem}: mask${mask}_${x}_${y}`);
  }
  const corners = [[64, 64, 1], [64, 192, 2], [192, 64, 4], [192, 192, 8]];
  for (let mask = 1; mask < 15; mask += 1) for (const [x, y, bit] of corners) assert(((mask & bit) !== 0) === (alphaAt(data, mask, x, y) > EDGE_TOLERANCE), `${stem}: mask${mask}_corner_${bit}`);
  assert(opaque(alphaAt(data, 1, 64, 64)) && clear(alphaAt(data, 1, 192, 192)), `${stem}: quarter`);
  assert(opaque(alphaAt(data, 5, 128, 64)) && clear(alphaAt(data, 5, 128, 192)), `${stem}: half_plane_top`);
  assert(opaque(alphaAt(data, 3, 64, 128)) && clear(alphaAt(data, 3, 192, 128)), `${stem}: half_plane_left`);
  assert(opaque(alphaAt(data, 9, 64, 64)) && opaque(alphaAt(data, 9, 192, 192)) && clear(alphaAt(data, 9, 128, 128)), `${stem}: diagonal`);
  assert(clear(alphaAt(data, 14, 32, 32)) && opaque(alphaAt(data, 14, 192, 192)), `${stem}: inverse_quarter`);
  assertOuterEdges(data, stem);
  assertSharedEdges(data, stem);
}

/** 由 Vite/Chrome 執行，避免 hard-code sharp 或非專案依賴。 */
export async function checkTerrainHdAtlasesInBrowser({ manifestUrl = '/assets/runtime-image-packs/default/manifest.json' } = {}) {
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  assert(response.ok, `manifest_fetch_${response.status}`);
  const manifest = await response.json();
  assert(Number(manifest.version) >= 6, 'manifest_version_must_be_at_least_6');
  const canvas = document.createElement('canvas'); canvas.width = ATLAS_SIZE; canvas.height = ATLAS_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true }); assert(context, 'canvas_2d_unavailable');
  const checked = [];
  for (const stem of TERRAIN_HD_STEMS) {
    const suffix = `${stem}-dual-grid.webp`;
    const entry = Object.values(manifest.tiles ?? {}).find((candidate) => typeof candidate?.src === 'string' && candidate.src.endsWith(suffix));
    assert(entry, `${stem}: manifest_entry_missing`);
    const image = new Image(); image.src = `${manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)}${entry.src}`; await image.decode();
    assert(image.naturalWidth === ATLAS_SIZE && image.naturalHeight === ATLAS_SIZE, `${stem}: must_be_1024x1024`);
    context.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE); context.drawImage(image, 0, 0); assertMaskShapes(context.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data, stem);
    checked.push({ stem, src: entry.src, width: image.naturalWidth, height: image.naturalHeight });
  }
  return { manifestVersion: Number(manifest.version), atlasCount: checked.length, atlases: checked };
}

if (typeof window === 'undefined' && process.argv[1]?.endsWith('check-terrain-hd-atlases.mjs')) {
  console.error('請執行 prove-terrain-hd-browser.mjs；atlas alpha 檢查必須由 Chrome 真實解碼。');
  process.exitCode = 1;
}
