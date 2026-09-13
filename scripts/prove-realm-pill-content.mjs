#!/usr/bin/env node
/** 境界增益丹內容閉環：正式採集來源、丹方、坊市目錄、神行白名單與飛昇採集點。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const realms = [
  ['foundation', '築基', 31, 'foundation_qinglin_marsh'], ['golden_core', '金丹', 43, 'lg_golden_core_xinjin_slope'],
  ['nascent_soul', '元嬰', 55, 'lg_nascent_soul_m1_entry'], ['spirit_transformation', '化神', 67, 'lg_spirit_transformation_m1_entry'],
  ['void_refinement', '煉虛', 79, 'lg_void_refinement_m1_entry'], ['body_integration', '合體', 91, 'lg_body_integration_m1_entry'],
  ['great_vehicle', '大乘', 103, 'lg_great_vehicle_m1_entry'], ['tribulation', '渡劫', 115, 'lg_tribulation_m1_entry'], ['ascension', '飛昇', 127, 'lg_ascension_gate'],
];
const realmMaps = {
  foundation: ['foundation_qinglin_marsh'], golden_core: ['lg_golden_core_xinjin_slope', 'lg_golden_core_molten_channel', 'lg_golden_core_hanging_lamps', 'lg_golden_core_sky_mending_furnace'],
  nascent_soul: ['lg_nascent_soul_m1_entry', 'lg_nascent_soul_m2_entry', 'lg_nascent_soul_m3_entry', 'lg_nascent_soul_m4_entry'], spirit_transformation: ['lg_spirit_transformation_m1_entry', 'lg_spirit_transformation_m2_entry', 'lg_spirit_transformation_m3_entry', 'lg_spirit_transformation_m4_entry'],
  void_refinement: ['lg_void_refinement_m1_entry', 'lg_void_refinement_m2_entry', 'lg_void_refinement_m3_entry', 'lg_void_refinement_m4_entry'], body_integration: ['lg_body_integration_m1_entry', 'lg_body_integration_m2_entry', 'lg_body_integration_m3_entry', 'lg_body_integration_m4_entry'],
  great_vehicle: ['lg_great_vehicle_m1_entry', 'lg_great_vehicle_m2_entry', 'lg_great_vehicle_m3_entry', 'lg_great_vehicle_m4_entry'], tribulation: ['lg_tribulation_m1_entry', 'lg_tribulation_m2_entry', 'lg_tribulation_m3_entry', 'lg_tribulation_m4_entry'], ascension: ['lg_ascension_gate'],
};
const families = ['martial_edge', 'arcane_surge', 'iron_guard', 'veil_guard', 'hawk_eye', 'mist_step'];
const expectedIds = realms.flatMap(([key]) => [...families.map((family) => `pill.realm.${key}.${family}`), `pill.realm.${key}.swiftwind`]);
function loadAllContentItems(relativePath = 'packages/server/data/content/items') {
  const absolutePath = path.join(root, relativePath);
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const nested = path.join(relativePath, entry.name);
    return entry.isDirectory() ? loadAllContentItems(nested) : (entry.name.endsWith('.json') ? read(nested) : []);
  });
}
const items = loadAllContentItems();
const itemById = new Map(items.map((item) => [item.itemId, item]));
const recipes = read('packages/server/data/content/alchemy/recipes.json');
const recipeByOutput = new Map(recipes.map((recipe) => [recipe.outputItemId, recipe]));
assert.equal(expectedIds.length, 63);
assert.equal(new Set(expectedIds).size, expectedIds.length);
for (const [realmKey, realmName, level] of realms) {
  for (const family of families) {
    const itemId = `pill.realm.${realmKey}.${family}`;
    const item = itemById.get(itemId);
    assert.ok(item, `遺失 ${itemId}`);
    assert.equal(item.type, 'consumable'); assert.equal(item.level, Math.min(127, level + Math.floor(families.indexOf(family) / 2) * 4));
    assert.equal(item.baselineHealPercent, undefined); assert.equal(item.baselineQiPercent, undefined);
    const buff = item.consumeBuffs?.[0];
    assert.ok(buff, `${itemId} 缺少增益`);
    assert.equal(buff.buffId, `item_buff.realm_${family}`, `${realmName}同族必須共用 buffId`);
    assert.equal(buff.maxStacks, 1, `${itemId} 不得疊層`);
    assert.equal(buff.statMode, 'percent'); assert.ok(Object.keys(buff.stats ?? {}).length >= 2, `${itemId} 必須有雙數值側重`);
  }
  const shenxing = itemById.get(`pill.realm.${realmKey}.swiftwind`);
  assert.equal(shenxing?.useBehavior, 'shenxing_travel'); assert.equal(shenxing?.level, level);
}
const nodes = read('packages/server/data/content/resource-nodes.json').resourceNodes;
const nodeById = new Map(nodes.map((node) => [node.id, node]));
function harvestableForMap(mapId) {
  const map = read(`packages/server/data/maps/${mapId}.json`);
  const ids = new Set((map.mineralNodes ?? []).map((entry) => typeof entry === 'string' ? entry : entry.itemId));
  for (const group of map.resourceNodeGroups ?? []) for (const drop of nodeById.get(group.resourceNodeId)?.container?.drops ?? []) ids.add(drop.itemId);
  for (const container of map.containers ?? []) for (const drop of container.drops ?? []) ids.add(drop.itemId);
  return { map, ids };
}
for (const [realmKey, realmName, , mapId] of realms) {
  const sourceMaps = realmMaps[realmKey];
  const harvested = sourceMaps.map(harvestableForMap);
  const map = harvested[0].map;
  const ids = new Set(harvested.flatMap((entry) => [...entry.ids]));
  assert.ok(ids.size >= 2, `${realmName}地圖缺少至少兩種可採材料`);
  for (const itemId of expectedIds.filter((id) => id.includes(`.${realmKey}.`))) {
    const recipe = recipeByOutput.get(itemId);
    assert.ok(recipe, `${itemId} 沒有丹方`); assert.equal(recipe.category, itemId.endsWith('.swiftwind') ? 'special' : 'buff');
    assert.equal(recipe.level, itemById.get(itemId).level, `${itemId} 丹方與產物境界不一致`);
    assert.equal(recipe.mainIngredients?.length, 1);
    for (const ingredient of recipe.ingredients ?? []) {
      assert.ok(ids.has(ingredient.itemId), `${itemId} 使用非${realmName}地圖採集材料 ${ingredient.itemId}`);
      assert.ok(itemById.get(ingredient.itemId)?.materialValues?.elements, `${ingredient.itemId} 缺少五行材料值`);
    }
  }
  if (realmKey === 'ascension') {
    assert.equal(map.shenxingCategory, 'wild');
    assert.deepEqual([...ids].sort(), ['mat.ascension_cloudstep_orchid', 'mat.ascension_starfold_crystal']);
    for (const group of map.resourceNodeGroups) for (const point of group.placements) {
      assert.equal(map.terrain[point.y][point.x], '地', `飛昇採集點不可站立 ${group.name}/${point.x},${point.y}`);
    }
  }
}
const townMaps = ['yunlai_town', 'qizhen_crossing', 'lg_golden_core_ember_lamp_market', 'lg_nascent_soul_town', 'lg_spirit_transformation_town', 'lg_void_refinement_town', 'lg_body_integration_town', 'lg_great_vehicle_town', 'lg_tribulation_town'];
const wildMaps = ['bamboo_forest', 'ancient_ruins', 'spirit_ridge', 'wildlands', 'frostblade_abyss', 'darksoil_abyss', 'cleft_blade_plain', 'blazewood_waste', 'cold_tide_marsh', 'beast_valley', 'black_iron_mine', ...Object.values(realmMaps).flat()];
for (const mapId of townMaps) assert.equal(read(`packages/server/data/maps/${mapId}.json`).shenxingCategory, 'town', `${mapId} 神行城鎮標記`);
for (const mapId of wildMaps) assert.equal(read(`packages/server/data/maps/${mapId}.json`).shenxingCategory, 'wild', `${mapId} 神行野外標記`);
const { ContentTemplateRepository } = require(path.join(root, 'packages/server/dist/content/content-template.repository.js'));
const { MarketRuntimeService } = require(path.join(root, 'packages/server/dist/runtime/market/market-runtime.service.js'));
const { MapTemplateRepository } = require(path.join(root, 'packages/server/dist/runtime/map/map-template.repository.js'));
const content = new ContentTemplateRepository(); content.loadAll();
const market = new MarketRuntimeService(content); const catalog = new Set(market.buildMarketListingEntries().map((entry) => entry.itemId));
for (const itemId of [...expectedIds, 'mat.ascension_cloudstep_orchid', 'mat.ascension_starfold_crystal']) {
  assert.ok(content.createItem(itemId, 1), `內容模板未載入 ${itemId}`); assert.ok(catalog.has(itemId), `坊市目錄缺少 ${itemId}`);
}
const maps = new MapTemplateRepository(); maps.loadAll();
const sources = read('packages/client/src/constants/world/item-sources.generated.json');
for (const itemId of expectedIds) {
  assert.ok(sources[itemId]?.some((source) => source.kind === 'alchemy' && source.recipeId === `alchemy.${itemId}`), `${itemId} 途徑百科缺少對應丹方`);
}
for (const itemId of ['mat.ascension_cloudstep_orchid', 'mat.ascension_starfold_crystal']) {
  assert.ok(sources[itemId]?.some((source) => source.mapId === 'lg_ascension_gate' && Number.isInteger(source.navigationX) && Number.isInteger(source.navigationY)), `${itemId} 途徑百科缺少可導航採集地點`);
}
const ascensionContainers = maps.getOrThrow('lg_ascension_gate').containers;
assert.ok(ascensionContainers.some((entry) => entry.drops?.some((drop) => drop.itemId === 'mat.ascension_cloudstep_orchid')), '飛昇雲階蘭未成為實際採集容器');
assert.ok(ascensionContainers.some((entry) => entry.drops?.some((drop) => drop.itemId === 'mat.ascension_starfold_crystal')), '飛昇摺星晶未成為實際採集容器');
console.log(JSON.stringify({ ok: true, pills: 63, recipes: 63, ascensionMaterials: 2, marketCatalog: 65, shenxing: { town: townMaps.length, wild: wildMaps.length }, databaseWrites: 0 }));
