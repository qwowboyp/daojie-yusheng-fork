#!/usr/bin/env node
/** 境界增益丹與神行丹內容真源；所有配方材料必須由明列地圖的採集節點取得。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const writeArtPlan = process.argv.includes('--write-art-plan') || write;
const contentRoot = 'packages/server/data/content';
const foundationItemsPath = `${contentRoot}/items/筑基期/消耗品.json`;
const lateItemsPath = `${contentRoot}/items/後期七境/內容.json`;
const alchemyPath = `${contentRoot}/alchemy/recipes.json`;
const sourceNodesPath = `${contentRoot}/resource-nodes.json`;

const families = [
  ['martial_edge', '破軍丹', '攻', (n) => ({ physAtk: n, crit: Math.max(3, Math.floor(n / 2)) }), '裂紋赤金雙丸，表面嵌一枚斷戟形金片'],
  ['arcane_surge', '玄元丹', '元', (n) => ({ spellAtk: n, maxQiOutputPerTick: Math.max(3, Math.floor(n / 2)) }), '旋渦藍紫珠，半透明核心浮著一道靈流'],
  ['iron_guard', '金剛丹', '剛', (n) => ({ physDef: n, resolvePower: Math.max(3, Math.floor(n / 2)) }), '龜甲褐金丸，外殼有明顯分節與厚重邊緣'],
  ['veil_guard', '玄甲丹', '甲', (n) => ({ spellDef: n, antiCrit: Math.max(3, Math.floor(n / 2)) }), '半透明青玉護珠，內封六角護符'],
  ['hawk_eye', '明瞳丹', '瞳', (n) => ({ hit: n, breakPower: Math.max(3, Math.floor(n / 2)) }), '瞳孔琥珀丸，黑金虹膜環繞一點高光'],
  ['mist_step', '幻影丹', '影', (n) => ({ dodge: n, moveSpeed: Math.max(3, Math.floor(n / 2)) }), '羽紋銀霧丸，拖著分離的薄霧尾痕'],
];

const realms = [
  { key: 'foundation', name: '築基', level: 31, grade: 'mystic', duration: 120, bonus: 9, maps: ['foundation_qinglin_marsh'], visual: '濕地青玉與荷露' },
  { key: 'golden_core', name: '金丹', level: 43, grade: 'heaven', duration: 150, bonus: 11, maps: ['lg_golden_core_xinjin_slope', 'lg_golden_core_molten_channel', 'lg_golden_core_hanging_lamps', 'lg_golden_core_sky_mending_furnace'], visual: '燈芯灰燼與熔金' },
  { key: 'nascent_soul', name: '元嬰', level: 55, grade: 'heaven', duration: 180, bonus: 13, maps: ['lg_nascent_soul_m1_entry', 'lg_nascent_soul_m2_entry', 'lg_nascent_soul_m3_entry', 'lg_nascent_soul_m4_entry'], visual: '潮音貝殼與月白水紋' },
  { key: 'spirit_transformation', name: '化神', level: 67, grade: 'spirit', duration: 210, bonus: 15, maps: ['lg_spirit_transformation_m1_entry', 'lg_spirit_transformation_m2_entry', 'lg_spirit_transformation_m3_entry', 'lg_spirit_transformation_m4_entry'], visual: '神木琥珀與幽綠火星' },
  { key: 'void_refinement', name: '煉虛', level: 79, grade: 'spirit', duration: 240, bonus: 17, maps: ['lg_void_refinement_m1_entry', 'lg_void_refinement_m2_entry', 'lg_void_refinement_m3_entry', 'lg_void_refinement_m4_entry'], visual: '裂空晶面與深靛星砂' },
  { key: 'body_integration', name: '合體', level: 91, grade: 'saint', duration: 270, bonus: 19, maps: ['lg_body_integration_m1_entry', 'lg_body_integration_m2_entry', 'lg_body_integration_m3_entry', 'lg_body_integration_m4_entry'], visual: '骨金合鑄與朱紅脈絡' },
  { key: 'great_vehicle', name: '大乘', level: 103, grade: 'saint', duration: 300, bonus: 21, maps: ['lg_great_vehicle_m1_entry', 'lg_great_vehicle_m2_entry', 'lg_great_vehicle_m3_entry', 'lg_great_vehicle_m4_entry'], visual: '雷紋蓮座與白金流光' },
  { key: 'tribulation', name: '渡劫', level: 115, grade: 'emperor', duration: 330, bonus: 23, maps: ['lg_tribulation_m1_entry', 'lg_tribulation_m2_entry', 'lg_tribulation_m3_entry', 'lg_tribulation_m4_entry'], visual: '焦木雷痕與熾白電弧' },
  { key: 'ascension', name: '飛昇', level: 127, grade: 'emperor', duration: 360, bonus: 25, maps: ['lg_ascension_gate'], visual: '雲階星塵與虹彩天光' },
];

const shenxingVisual = '螺旋翼紋青白丸，外圈有獨立風環與折紙般的雲翼';
const managedItemIds = new Set(realms.flatMap((realm) => [...families.map(([key]) => `pill.realm.${realm.key}.${key}`), `pill.realm.${realm.key}.swiftwind`]));
const managedRecipeIds = new Set([...managedItemIds].map((itemId) => `alchemy.${itemId}`));
const ascensionMaterials = [
  { itemId: 'mat.ascension_cloudstep_orchid', name: '雲階蘭', type: 'material', grade: 'emperor', level: 127, materialCategory: 'herb', materialValues: { elements: { wood: 1020, water: 640 } }, tags: ['藥材', '靈植'], desc: '生於飛昇關雲階裂縫的淡銀蘭草，花瓣會隨天風轉向。' },
  { itemId: 'mat.ascension_starfold_crystal', name: '摺星晶', type: 'material', grade: 'emperor', level: 127, materialCategory: 'ore', materialValues: { elements: { metal: 920, fire: 740 } }, tags: ['礦石', '礦材'], desc: '飛昇關石階中的虹彩晶體，折面映出碎星般的冷光。' },
];
const ascensionResourceNodes = [
  { id: 'landmark.herb.ascension_cloudstep_orchid', kind: 'landmark_container', name: '雲階蘭', sourceLabel: '雲階蘭叢', container: { variant: 'herb', grade: 'emperor', refreshTicksMin: 180, refreshTicksMax: 260, char: '草', color: '#c9e9dc', drops: [{ itemId: 'mat.ascension_cloudstep_orchid', name: '雲階蘭', type: 'material', count: 1, chance: 1 }] } },
  { id: 'landmark.ore.ascension_starfold_crystal', kind: 'landmark_container', name: '摺星晶', sourceLabel: '摺星晶脈', container: { variant: 'ore', grade: 'emperor', refreshTicksMin: 220, refreshTicksMax: 300, char: '礦', color: '#b9b5e7', drops: [{ itemId: 'mat.ascension_starfold_crystal', name: '摺星晶', type: 'material', count: 1, chance: 1 }] } },
];

// 經地圖內容逐張核對後的唯一可神行白名單；城鎮與戶外可達區分，洞府、塔、副本、測試與私人地圖不列入。
const shenxingMaps = {
  town: ['yunlai_town', 'qizhen_crossing', 'lg_golden_core_ember_lamp_market', 'lg_nascent_soul_town', 'lg_spirit_transformation_town', 'lg_void_refinement_town', 'lg_body_integration_town', 'lg_great_vehicle_town', 'lg_tribulation_town'],
  wild: ['bamboo_forest', 'ancient_ruins', 'spirit_ridge', 'wildlands', 'frostblade_abyss', 'darksoil_abyss', 'cleft_blade_plain', 'blazewood_waste', 'cold_tide_marsh', 'beast_valley', 'black_iron_mine', 'foundation_qinglin_marsh', ...realms.filter((realm) => realm.key !== 'foundation' && realm.key !== 'ascension').flatMap((realm) => realm.maps)],
};

function read(relativePath) { return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')); }
function writeJson(relativePath, value, outputs) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== serialized) outputs.push([relativePath, serialized]);
}
function upsert(entries, replacements, key) {
  const byKey = new Map(replacements.map((entry) => [entry[key], entry]));
  const seen = new Set();
  const next = entries.map((entry) => { const replacement = byKey.get(entry[key]); if (replacement) seen.add(entry[key]); return replacement ?? entry; });
  for (const replacement of replacements) if (!seen.has(replacement[key])) next.push(replacement);
  return next;
}
function loadItems() {
  const items = [];
  const visit = (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const nested = path.join(relativePath, entry.name);
      if (entry.isDirectory()) visit(nested);
      else if (entry.name.endsWith('.json')) items.push(...read(nested));
    }
  };
  visit(`${contentRoot}/items`);
  return new Map(items.map((item) => [item.itemId, item]));
}
function harvestableMaterialIds(realm, resourceNodes) {
  const known = new Set();
  const byNodeId = new Map(resourceNodes.map((node) => [node.id, node]));
  for (const mapId of realm.maps) {
    const map = read(`packages/server/data/maps/${mapId}.json`);
    for (const mineral of map.mineralNodes ?? []) known.add(typeof mineral === 'string' ? mineral : mineral.itemId);
    for (const group of map.resourceNodeGroups ?? []) {
      const node = byNodeId.get(group.resourceNodeId);
      for (const drop of node?.container?.drops ?? []) known.add(drop.itemId);
    }
    for (const container of map.containers ?? []) for (const drop of container.drops ?? []) known.add(drop.itemId);
  }
  // 飛昇關採集節點與配方由本生成器同批寫入；在尚未落盤的 check 模式也必須以同一真源計算。
  if (realm.key === 'ascension') for (const material of ascensionMaterials) known.add(material.itemId);
  return [...known].filter(Boolean).sort();
}
function sumAuxElements(ingredients, items) {
  const totals = {};
  for (const ingredient of ingredients.filter((entry) => entry.role === 'aux')) {
    const material = items.get(ingredient.itemId);
    if (!material?.materialValues?.elements) throw new Error(`丹方輔材缺少五行值：${ingredient.itemId}`);
    for (const [element, amount] of Object.entries(material.materialValues.elements)) totals[element] = (totals[element] ?? 0) + amount * ingredient.count;
  }
  return totals;
}
function realmPillItem(realm, family) {
  const [key, name, shortMark, stats, visual] = family;
  const itemId = `pill.realm.${realm.key}.${key}`;
  const level = Math.min(127, realm.level + Math.floor(families.indexOf(family) / 2) * 4);
  const labels = { physAtk: '物攻', crit: '暴擊', spellAtk: '法攻', maxQiOutputPerTick: '每息靈力輸出上限', physDef: '物防', resolvePower: '化解', spellDef: '法防', antiCrit: '抗暴', hit: '命中', breakPower: '破招', dodge: '閃避', moveSpeed: '移速' };
  const effect = Object.entries(stats(realm.bonus)).map(([stat, value]) => `${labels[stat]}提升 ${value}%`).join('、');
  return { itemId, name: `${realm.name}${name}`, type: 'consumable', grade: realm.grade, level,
    desc: `${realm.name}修士淬鍊用的${name}。同類丹效只保留一層，改服不同境界同族丹時以新藥力替換舊效果。`,
    consumeBuffs: [{ buffId: `item_buff.realm_${key}`, name: `${name}·${realm.name}`, desc: `${effect}，持續 ${realm.duration} 息。同族丹效不疊層。`, shortMark, duration: realm.duration, maxStacks: 1, stats: stats(realm.bonus), statMode: 'percent', color: '#d6b567' }],
    artDirection: `${realm.visual}；${visual}` };
}
function shenxingItem(realm) {
  return { itemId: `pill.realm.${realm.key}.swiftwind`, name: `${realm.name}神行丹`, type: 'consumable', grade: realm.grade, level: realm.level, useBehavior: 'shenxing_travel',
    desc: `${realm.name}行旅丹，啟動神行後可前往已收錄的城鎮或野外地圖；不可進入副本、塔、私人或測試地圖。`, artDirection: `${realm.visual}；${shenxingVisual}` };
}
function buildRecipes(items, resourceNodes) {
  const recipes = [];
  for (const realm of realms) {
    const materials = harvestableMaterialIds(realm, resourceNodes).filter((itemId) => items.get(itemId)?.type === 'material');
    if (materials.length < 2) throw new Error(`${realm.name}缺少兩種可採集的正式材料：${materials.join(', ') || '無'}`);
    const main = materials[0], aux = materials[1];
    for (const itemId of [...families.map(([key]) => `pill.realm.${realm.key}.${key}`), `pill.realm.${realm.key}.swiftwind`]) {
      const ingredients = [{ itemId: main, count: 2, role: 'main' }, { itemId: aux, count: 1, role: 'aux' }];
      recipes.push({ recipeId: `alchemy.${itemId}`, outputItemId: itemId, outputCount: 1, baseBrewTicks: 48 + Math.floor((realm.level - 31) / 6) * 6, level: items.get(itemId).level, grade: realm.grade, category: itemId.endsWith('.swiftwind') ? 'special' : 'buff', ingredients, mainIngredients: [{ itemId: main, count: 2 }], requiredAuxElements: sumAuxElements(ingredients, items) });
    }
  }
  return recipes;
}
function artPlan() {
  const entries = [];
  for (const realm of realms) for (const item of [...families.map((family) => realmPillItem(realm, family)), shenxingItem(realm)]) entries.push({ itemId: item.itemId, name: item.name, realm: realm.name, effect: item.consumeBuffs?.[0]?.stats ?? '神行', visual: item.artDirection });
  for (const material of ascensionMaterials) entries.push({ itemId: material.itemId, name: material.name, realm: '飛昇', effect: '煉丹材料', visual: material.itemId.includes('orchid') ? '雲階裂縫中完整的淡銀蘭草，弧形花瓣指向風向' : '虹彩摺面晶簇，輪廓如展開的星圖' });
  return { version: 1, layout: 'rowmajor', atlases: [{ id: 'realm-pills-a', grid: '6x6', entries: entries.slice(0, 36).map((entry, index) => ({ cell: index, ...entry })) }, { id: 'realm-pills-b', grid: '6x6', entries: entries.slice(36).map((entry, index) => ({ cell: index, ...entry })) }], total: entries.length };
}
function updateMapFlags(outputs) {
  const expected = new Map([...shenxingMaps.town.map((id) => [id, 'town']), ...shenxingMaps.wild.map((id) => [id, 'wild'])]);
  for (const [mapId, category] of expected) {
    const relativePath = `packages/server/data/maps/${mapId}.json`;
    const map = read(relativePath);
    map.shenxingCategory = category;
    writeJson(relativePath, map, outputs);
  }
}

const outputs = [];
const sourceNodeDoc = read(sourceNodesPath);
sourceNodeDoc.resourceNodes = upsert(sourceNodeDoc.resourceNodes ?? [], ascensionResourceNodes, 'id');
const gate = read('packages/server/data/maps/lg_ascension_gate.json');
gate.shenxingCategory = 'wild';
gate.resourceNodeGroups = upsert(gate.resourceNodeGroups ?? [], [
  { resourceNodeId: 'landmark.herb.ascension_cloudstep_orchid', idPrefix: 'lg_ascension_cloudstep_orchid', name: '雲階蘭', placements: [{ x: 11, y: 17 }, { x: 18, y: 24 }] },
  { resourceNodeId: 'landmark.ore.ascension_starfold_crystal', idPrefix: 'lg_ascension_starfold_crystal', name: '摺星晶', placements: [{ x: 24, y: 17 }, { x: 31, y: 24 }] },
], 'resourceNodeId');
writeJson(sourceNodesPath, sourceNodeDoc, outputs);
writeJson('packages/server/data/maps/lg_ascension_gate.json', gate, outputs);
const items = loadItems();
for (const material of ascensionMaterials) items.set(material.itemId, material);
const allPills = realms.flatMap((realm) => [...families.map((family) => realmPillItem(realm, family)), shenxingItem(realm)]);
const foundation = upsert(read(foundationItemsPath).filter((item) => !managedItemIds.has(item.itemId)), allPills.filter((item) => item.itemId.includes('.foundation.')), 'itemId');
const late = upsert(read(lateItemsPath).filter((item) => !managedItemIds.has(item.itemId) && !ascensionMaterials.some((material) => material.itemId === item.itemId)), [...allPills.filter((item) => !item.itemId.includes('.foundation.')), ...ascensionMaterials], 'itemId');
for (const item of [...foundation, ...late]) items.set(item.itemId, item);
const recipes = upsert(read(alchemyPath).filter((recipe) => !managedRecipeIds.has(recipe.recipeId)), buildRecipes(items, sourceNodeDoc.resourceNodes), 'recipeId');
writeJson(foundationItemsPath, foundation, outputs);
writeJson(lateItemsPath, late, outputs);
writeJson(alchemyPath, recipes, outputs);
updateMapFlags(outputs);
if (writeArtPlan) writeJson('.runtime/pill-art-plan.json', artPlan(), outputs);
if (write) for (const [relativePath, serialized] of outputs) { const filePath = path.join(root, relativePath); fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, serialized); }
console.log(JSON.stringify({ ok: write || outputs.length === 0, write, outputs: outputs.map(([file]) => file), pills: allPills.length, materials: ascensionMaterials.length, recipes: managedRecipeIds.size, shenxingMaps, artPlan: artPlan().total }, null, 2));
if (!write && outputs.length > 0) process.exitCode = 1;
