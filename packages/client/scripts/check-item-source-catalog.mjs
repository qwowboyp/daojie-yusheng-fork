/**
 * 驗證物品取得途徑索引與內容真源的一致性。
 * `--check` 另外確認生成檔沒有過期，但不會改寫任何檔案。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(clientDir, '..', '..');
const catalogPath = path.join(clientDir, 'src/constants/world/item-sources.generated.json');
const itemsDir = path.join(repoRoot, 'packages/server/data/content/items');
const mapsDir = path.join(repoRoot, 'packages/server/data/maps');
const generatorPath = path.join(__dirname, 'generate-item-sources.mjs');

function walkJsonFiles(dirPath) {
  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) return walkJsonFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.json') ? [entryPath] : [];
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertAcquisitionRule(entries, itemId, ruleId) {
  assert.ok(
    entries.some((entry) => entry.kind === 'acquisition_rule' && entry.ruleId === ruleId),
    `${itemId} 缺少已證明的取得規則 ${ruleId}`,
  );
}

function chooseStablePoint(points) {
  return points
    .filter((point) => Number.isInteger(point?.x) && Number.isInteger(point?.y))
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
    .sort((left, right) => left.y - right.y || left.x - right.x)[0] ?? null;
}

function resolveMonsterSpawnId(spawn) {
  if (Array.isArray(spawn)) return typeof spawn[2] === 'string' ? spawn[2].trim() : '';
  return typeof spawn?.templateId === 'string'
    ? spawn.templateId.trim()
    : (typeof spawn?.id === 'string' ? spawn.id.trim() : '');
}

function sourceCoordinateKey(mapId, kind, sourceId) {
  return `${mapId}\u0000${kind}\u0000${sourceId}`;
}

function buildSourceCoordinateIndex(maps) {
  const index = new Map();
  const add = (mapId, kind, sourceId, point) => {
    if (!mapId || !sourceId || !point) return;
    const key = sourceCoordinateKey(mapId, kind, sourceId);
    const current = index.get(key);
    if (!current || point.y < current.y || (point.y === current.y && point.x < current.x)) index.set(key, point);
  };
  for (const map of maps) {
    const mapId = typeof map?.id === 'string' ? map.id.trim() : '';
    for (const spawn of Array.isArray(map?.monsterSpawns) ? map.monsterSpawns : []) {
      const monsterId = resolveMonsterSpawnId(spawn);
      const point = chooseStablePoint([Array.isArray(spawn) ? { x: spawn[0], y: spawn[1] } : spawn]);
      add(mapId, 'monster_drop', monsterId, point);
    }
    for (const npc of Array.isArray(map?.npcs) ? map.npcs : []) {
      add(mapId, 'shop', typeof npc?.id === 'string' ? npc.id.trim() : '', chooseStablePoint([npc]));
    }
    for (const landmark of Array.isArray(map?.landmarks) ? map.landmarks : []) {
      add(mapId, 'landmark', typeof landmark?.id === 'string' ? landmark.id.trim() : '', chooseStablePoint([landmark]));
    }
    for (const node of Array.isArray(map?.mineralNodes) ? map.mineralNodes : []) {
      add(mapId, 'landmark', `mineral:${node?.x}:${node?.y}`, chooseStablePoint([node]));
    }
    for (const group of Array.isArray(map?.resourceNodeGroups) ? map.resourceNodeGroups : []) {
      const sourceId = typeof group?.idPrefix === 'string' && group.idPrefix.trim()
        ? group.idPrefix.trim()
        : (typeof group?.resourceNodeId === 'string' ? group.resourceNodeId.trim() : '');
      add(mapId, 'landmark', sourceId, chooseStablePoint(Array.isArray(group?.placements) ? group.placements : []));
    }
  }
  return index;
}

if (process.argv.includes('--check')) {
  const freshness = spawnSync(process.execPath, [generatorPath, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (freshness.status !== 0) {
    throw new Error(`物品取得途徑生成檔已過期：${freshness.stderr || freshness.stdout}`.trim());
  }
}

const itemIds = new Set(
  walkJsonFiles(itemsDir)
    .flatMap((filePath) => readJson(filePath))
    .map((item) => item?.itemId)
    .filter((itemId) => typeof itemId === 'string' && itemId.length > 0),
);
const catalog = readJson(catalogPath);
const mapLevels = new Map(walkJsonFiles(mapsDir).map(readJson).map(map => [map.id, map.mapLv]));
const sourceCoordinateIndex = buildSourceCoordinateIndex(walkJsonFiles(mapsDir).map(readJson));

assert.deepEqual(new Set(Object.keys(catalog)), itemIds, '索引物品鍵必須與內容物品真源一致');
let sourceEntryCount = 0;
let nonRuleSourceEntryCount = 0;
const unresolvedEntitySources = [];
for (const [itemId, entries] of Object.entries(catalog)) {
  assert.ok(Array.isArray(entries), `${itemId} 的來源必須是陣列`);
  for (const entry of entries) {
    sourceEntryCount += 1;
    const mapLv = mapLevels.get(entry.mapId);
    assert.equal(entry.mapLv, Number.isInteger(mapLv) && mapLv > 0 ? mapLv : undefined, `${itemId} 地圖等級必須對齊地圖真源`);
    if (entry?.kind !== 'acquisition_rule') nonRuleSourceEntryCount += 1;
    assert.equal(typeof entry?.kind, 'string', `${itemId} 的來源缺少 kind`);
    assert.equal(typeof entry?.mapId, 'string', `${itemId} 的來源缺少 mapId`);
    assert.equal(typeof entry?.mapName, 'string', `${itemId} 的來源缺少 mapName`);
    if (entry.kind === 'acquisition_rule') {
      assert.equal(typeof entry.ruleId, 'string', `${itemId} 的規則來源缺少 ruleId`);
      assert.equal(typeof entry.title, 'string', `${itemId} 的規則來源缺少 title`);
      assert.equal(typeof entry.description, 'string', `${itemId} 的規則來源缺少 description`);
    }
    if (['monster_drop', 'shop', 'mining', 'search'].includes(entry.kind)) {
      const hasNavigationPoint = Number.isInteger(entry.navigationX) && Number.isInteger(entry.navigationY);
      if (!hasNavigationPoint) {
        const sourceId = entry.monsterId ?? entry.npcId ?? entry.landmarkId ?? '未知來源';
        const reason = entry.mapId === 'runtime'
          ? '運行時資源點沒有固定地圖座標'
          : '權威地圖設定缺少可解析座標';
        unresolvedEntitySources.push(`${itemId}/${entry.kind}/${sourceId}：${reason}`);
      } else if (entry.mapId !== 'runtime') {
        const sourceId = entry.kind === 'monster_drop'
          ? entry.monsterId
          : entry.kind === 'shop'
            ? entry.npcId
            : entry.landmarkId;
        const sourceKind = entry.kind === 'monster_drop' || entry.kind === 'shop' ? entry.kind : 'landmark';
        const expectedPoint = sourceCoordinateIndex.get(sourceCoordinateKey(entry.mapId, sourceKind, sourceId));
        assert.ok(expectedPoint, `${itemId}/${entry.kind}/${sourceId} 缺少權威地圖座標真源`);
        assert.deepEqual(
          { x: entry.navigationX, y: entry.navigationY },
          expectedPoint,
          `${itemId}/${entry.kind}/${sourceId} 的導航座標必須與權威地圖設定一致`,
        );
      }
    }
  }
}

assert.ok(sourceEntryCount > 1_000, '索引不應遺失為空或只剩少數來源');
assert.ok(nonRuleSourceEntryCount > 1_000, '既有靜態來源不應被規則來源取代或遺失');
assert.ok(catalog['pill.minor_heal'].filter((entry) => entry.kind !== 'acquisition_rule').length > 3, '既有多條任務與商店來源不應遺失');
assertAcquisitionRule(catalog['book.qingmu_sword'], 'book.qingmu_sword', 'new-player-starter-inventory');
assertAcquisitionRule(catalog['pill.minor_heal'], 'pill.minor_heal', 'new-player-starter-inventory');
assertAcquisitionRule(catalog.spirit_stone, 'spirit_stone', 'monster-currency-drop');
assertAcquisitionRule(catalog.spirit_stone, 'spirit_stone', 'activity-invitation-reward');
assertAcquisitionRule(catalog.merit, 'merit', 'monster-currency-drop');
assertAcquisitionRule(catalog.merit, 'merit', 'activity-daily-sign-in');
assertAcquisitionRule(catalog['book.custom_technique'], 'book.custom_technique', 'technique-book-craft');
assertAcquisitionRule(catalog['mat.technique_fragment'], 'mat.technique_fragment', 'technique-book-decompose');

const unresolvedFixedMapSources = unresolvedEntitySources.filter((entry) => !entry.includes('運行時資源點'));
assert.equal(unresolvedFixedMapSources.length, 0, `固定地圖實體來源缺少導航座標：${unresolvedFixedMapSources.join('；')}`);
if (unresolvedEntitySources.length > 0) {
  console.log(`不可自動移動的實體來源：${unresolvedEntitySources.join('；')}`);
}

console.log(`item-source-catalog 檢查通過：${itemIds.size} 個物品、${sourceEntryCount} 條來源`);
