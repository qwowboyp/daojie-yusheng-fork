import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const CELL_SIZE = 256;
const ATLAS_SIZE = CELL_SIZE * 4;
const ATLAS_COORDS = [
  [0, 3], [3, 3], [0, 0], [3, 2], [0, 2], [1, 2], [2, 3], [3, 1],
  [1, 3], [0, 1], [3, 0], [2, 0], [1, 0], [2, 2], [1, 1], [2, 1],
];
const STEMS = [
  'terrain-floor', 'grass', 'hill', 'water', 'mud', 'swamp', 'cold-bog',
  'molten-pool', 'cloud-floor', 'cloud', 'void', 'cliff', 'floor', 'trail',
  'road', 'veranda', 'stone-stairs', 'wall', 'door', 'window', 'house-eave',
  'house-corner', 'screen-wall', 'tree', 'bamboo', 'stone', 'spirit-ore',
  'black-iron-ore', 'broken-sword-heap',
];
const BUNDLED_NODE_MODULES = process.env.CODEX_BUNDLED_NODE_MODULES
  ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadSharp() {
  const localRequire = createRequire(import.meta.url);
  try {
    return localRequire('sharp');
  } catch {
    return createRequire(path.join(BUNDLED_NODE_MODULES, 'package.json'))('sharp');
  }
}

const sharp = loadSharp();

function parseArgs(argv) {
  const options = {
    sourceDir: path.join(REPO_ROOT, 'assets/generated/terrain-hd-v2/sources'),
    outputDir: path.join(REPO_ROOT, 'assets/generated/terrain-hd-v2/candidate/tiles'),
    only: null,
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source-dir' || arg === '--output-dir' || arg === '--only') {
      const value = argv[++index];
      if (!value) throw new Error(`${arg}_requires_value`);
      if (arg === '--source-dir') options.sourceDir = path.resolve(value);
      if (arg === '--output-dir') options.outputDir = path.resolve(value);
      if (arg === '--only') options.only = value;
    } else if (arg === '--self-test') {
      options.selfTest = true;
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }
  if (options.only && !STEMS.includes(options.only)) {
    throw new Error(`unknown_terrain_stem:${options.only}`);
  }
  return options;
}

function cornerEnabled(mask, x, y) {
  const bit = x < CELL_SIZE / 2
    ? (y < CELL_SIZE / 2 ? 1 : 2)
    : (y < CELL_SIZE / 2 ? 4 : 8);
  return (mask & bit) !== 0;
}

function insideCircle(x, y, centerX, centerY) {
  return Math.hypot(x - centerX, y - centerY) <= CELL_SIZE / 2;
}

/** Returns only mask coverage; RGB pixels always originate from the supplied source artwork. */
function maskAlpha(mask, x, y) {
  if (mask === 0) return 0;
  if (mask === 15) return 255;
  const hasTL = (mask & 1) !== 0;
  const hasBL = (mask & 2) !== 0;
  const hasTR = (mask & 4) !== 0;
  const hasBR = (mask & 8) !== 0;
  const count = Number(hasTL) + Number(hasBL) + Number(hasTR) + Number(hasBR);
  let covered;
  if (count === 1) {
    covered = (hasTL && insideCircle(x, y, 0, 0))
      || (hasBL && insideCircle(x, y, 0, CELL_SIZE))
      || (hasTR && insideCircle(x, y, CELL_SIZE, 0))
      || (hasBR && insideCircle(x, y, CELL_SIZE, CELL_SIZE));
  } else if (count === 2 && (hasTL === hasBR)) {
    covered = (hasTL && insideCircle(x, y, 0, 0)) || (hasBR && insideCircle(x, y, CELL_SIZE, CELL_SIZE))
      || (hasTR && insideCircle(x, y, CELL_SIZE, 0)) || (hasBL && insideCircle(x, y, 0, CELL_SIZE));
  } else if (count === 2) {
    // 相鄰雙角必須是半平面；半圓會讓相同共用角的圖格邊界不一致而裂開。
    covered = (hasTL && hasTR && y < CELL_SIZE / 2)
      || (hasBL && hasBR && y >= CELL_SIZE / 2)
      || (hasTL && hasBL && x < CELL_SIZE / 2)
      || (hasTR && hasBR && x >= CELL_SIZE / 2);
  } else {
    const missingTL = !hasTL;
    const missingBL = !hasBL;
    const missingTR = !hasTR;
    const missingBR = !hasBR;
    covered = !((missingTL && insideCircle(x, y, 0, 0))
      || (missingBL && insideCircle(x, y, 0, CELL_SIZE))
      || (missingTR && insideCircle(x, y, CELL_SIZE, 0))
      || (missingBR && insideCircle(x, y, CELL_SIZE, CELL_SIZE)));
  }
  // 只裁切來源材質；不把假透明背景或新繪製的裝飾混入圖集。
  return covered ? 255 : 0;
}

function buildAtlas(source) {
  const atlas = Buffer.alloc(ATLAS_SIZE * ATLAS_SIZE * 4);
  for (let mask = 0; mask < 16; mask += 1) {
    const [column, row] = ATLAS_COORDS[mask];
    for (let y = 0; y < CELL_SIZE; y += 1) {
      for (let x = 0; x < CELL_SIZE; x += 1) {
        const sourceX = (x + CELL_SIZE / 2) % CELL_SIZE;
        const sourceY = (y + CELL_SIZE / 2) % CELL_SIZE;
        const sourceOffset = (sourceY * CELL_SIZE + sourceX) * 4;
        const atlasOffset = ((row * CELL_SIZE + y) * ATLAS_SIZE + column * CELL_SIZE + x) * 4;
        source.copy(atlas, atlasOffset, sourceOffset, sourceOffset + 3);
        atlas[atlasOffset + 3] = maskAlpha(mask, x + 0.5, y + 0.5);
      }
    }
  }
  return atlas;
}

function assertSyntheticTopology() {
  const synthetic = Buffer.alloc(CELL_SIZE * CELL_SIZE * 4, 0);
  for (let pixel = 0; pixel < CELL_SIZE * CELL_SIZE; pixel += 1) {
    synthetic[pixel * 4] = pixel & 255;
    synthetic[pixel * 4 + 1] = (pixel >>> 8) & 255;
    synthetic[pixel * 4 + 2] = 173;
    synthetic[pixel * 4 + 3] = 255;
  }
  const atlas = buildAtlas(synthetic);
  const alphaAt = (mask, x, y) => {
    const [column, row] = ATLAS_COORDS[mask];
    return atlas[((row * CELL_SIZE + y) * ATLAS_SIZE + column * CELL_SIZE + x) * 4 + 3];
  };
  for (let mask = 0; mask < 16; mask += 1) {
    for (const [x, y] of [[64, 64], [64, 192], [192, 64], [192, 192]]) {
      assert.equal(alphaAt(mask, x, y) > 0, cornerEnabled(mask, x, y), `synthetic_corner_mask_${mask}_${x}_${y}`);
    }
  }
  assert.equal(alphaAt(1, 0, 0), 255, 'synthetic_quarter_corner');
  assert.equal(alphaAt(5, 128, 0), 255, 'synthetic_straight_edge');
  assert.equal(alphaAt(5, 0, 64), 255, 'synthetic_straight_edge_is_half_plane');
  // 所有具有相同共用角的相鄰 mask 都必須在接縫上完全吻合。
  for (let first = 0; first < 16; first += 1) {
    for (let second = 0; second < 16; second += 1) {
      for (let position = 0; position < CELL_SIZE; position += 1) {
        if ((first >> 2) === (second & 3)) {
          assert.equal(alphaAt(first, 255, position), alphaAt(second, 0, position), `horizontal_seam_${first}_${second}_${position}`);
        }
        if (((first & 2) >> 1 | (first & 8) >> 1) === (second & 5)) {
          assert.equal(alphaAt(first, position, 255), alphaAt(second, position, 0), `vertical_seam_${first}_${second}_${position}`);
        }
      }
    }
  }
  assert.equal(alphaAt(9, 128, 128), 0, 'synthetic_saddle_center');
  assert.equal(alphaAt(14, 0, 0), 0, 'synthetic_inverse_quarter');
  assert.equal(alphaAt(15, 255, 255), 255, 'synthetic_full_cell');
}

async function fileExists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertSyntheticTopology();
  if (options.selfTest) {
    console.log('terrain-hd-atlas synthetic topology passed');
    return;
  }
  const stems = options.only ? [options.only] : STEMS;
  const missing = [];
  for (const stem of stems) {
    const input = path.join(options.sourceDir, `${stem}.png`);
    if (!(await fileExists(input))) missing.push(input);
  }
  if (missing.length > 0) {
    throw new Error(`missing_terrain_hd_sources:\n${missing.join('\n')}`);
  }
  await mkdir(options.outputDir, { recursive: true });
  for (const stem of stems) {
    const input = path.join(options.sourceDir, `${stem}.png`);
    const output = path.join(options.outputDir, `${stem}-dual-grid.webp`);
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .resize(CELL_SIZE, CELL_SIZE, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, CELL_SIZE, `${stem}_normalized_width`);
    assert.equal(info.height, CELL_SIZE, `${stem}_normalized_height`);
    await sharp(buildAtlas(data), { raw: { width: ATLAS_SIZE, height: ATLAS_SIZE, channels: 4 } })
      .webp({ lossless: true, effort: 6 })
      .toFile(output);
    console.log(`built ${path.relative(process.cwd(), output)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
