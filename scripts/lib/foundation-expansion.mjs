/** 青霖澤正式內容真源；生成流程不得讀取 .runtime。 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const calibration = require('./foundation-expansion-calibration.json');

export const MAP_ID = 'foundation_qinglin_marsh';
export const TECHNIQUE_ID = 'monster_qinglin_arts';
export const RESOURCE_NODE_IDS = ['landmark.herb.qinglin_orchid', 'landmark.herb.qinglin_ling'];
export const ITEM_IDENTITIES = [
  ['equip.qinglin_raincleaver', '霖紋斷雨刀'], ['equip.qinglin_tide_staff', '澤心引潮杖'],
  ['equip.qinglin_dew_crown', '凝露冠'], ['equip.qinglin_scale_robe', '澤鱗護衣'],
  ['equip.qinglin_lotus_boots', '踏荷履'], ['equip.qinglin_pool_pendant', '碧潭守心佩'],
  ['mat.qinglin_orchid', '青霖蘭'], ['mat.qinglin_ling', '澤心苓'],
  ['mat.qinglin_copper_ore', '碧紋銅礦'], ['mat.qinglin_jade_sand', '沉水玉砂'],
  ['mat.qinglin_lizard_scale', '雨蜥鱗'], ['mat.qinglin_crab_shell', '澤螯殼'],
  ['mat.qinglin_dragon_core', '青霖妖丹'], ['pill.qinglin_qi_restore', '青霖回元丹'],
  ['pill.qinglin_meridian_restore', '凝露養脈丹'], ['scroll.qinglin_marsh', '青霖澤圖卷'],
];
export const MONSTER_IDENTITIES = [
  ['m_qinglin_rain_lizard', '青苔雨蜥', 'normal_35_physical'],
  ['m_qinglin_wet_crane', '濕羽鶴', 'normal_36_spell'],
  ['m_qinglin_marsh_crab', '碧螯澤蟹', 'normal_36_guard'],
  ['m_qinglin_dew_spider', '凝露蛛母', 'elite_37_physical'],
  ['m_qinglin_root_fiend', '盤根泥魈', 'elite_38_spell'],
  ['m_qinglin_dragon_lord', '青霖蛟主', 'boss_38_hybrid'],
];

const EQUIPMENT = [
  ['equip.qinglin_raincleaver', '霖紋斷雨刀', 'weapon', '斷雨刀刃以碧紋銅反覆摺鍛，適合在濕地中破開厚殼。'],
  ['equip.qinglin_tide_staff', '澤心引潮杖', 'weapon', '古木杖芯封入澤心水脈，能穩定牽引法術與靈力輸出。'],
  ['equip.qinglin_dew_crown', '凝露冠', 'head', '荷葉狀冠片承住晨露，替識海卸開迎面的術勢。'],
  ['equip.qinglin_scale_robe', '澤鱗護衣', 'body', '雨蜥厚鱗覆在墨綠短袍上，兼顧氣血與雙重防護。'],
  ['equip.qinglin_lotus_boots', '踏荷履', 'legs', '鞋底刻著荷脈水紋，踏過泥澤時仍能迅速轉身。'],
  ['equip.qinglin_pool_pendant', '碧潭守心佩', 'accessory', '玉佩內封一縷深潭迴流，能穩住出手與靈力運轉。'],
];
const MATERIALS = [
  ['mat.qinglin_orchid', '青霖蘭', 'herb', { wood: 63, water: 34 }, () => [TAG_HERB], '古石棧橋外側迎雨而生的蘭草，葉脈與花心都蓄著木水靈機。'],
  ['mat.qinglin_ling', '澤心苓', 'herb', { water: 63, wood: 34 }, () => [TAG_HERB], '紮根於淺澤泥心的靈苓，能引散亂靈力回歸氣海。'],
  ['mat.qinglin_copper_ore', '碧紋銅礦', 'ore', { metal: 63, earth: 34 }, () => [TAG_ORE, TAG_ORE_MATERIAL, '石材', TAG_METAL], '濕地岩脊露出的古銅礦，翠色礦紋在雨中尤其清楚。'],
  ['mat.qinglin_jade_sand', '沉水玉砂', 'ore', { water: 63, earth: 34 }, () => [TAG_ORE, TAG_ORE_MATERIAL, '石材'], '水道底部沉積的玉砂，顆粒雖細，仍封著厚實水土之氣。'],
  ['mat.qinglin_lizard_scale', '雨蜥鱗', 'exotic', { water: 63, wood: 34 }, () => [TAG_EXOTIC], '青苔雨蜥脫落的厚鱗，雨水滑過時會浮出細密木紋。'],
  ['mat.qinglin_crab_shell', '澤螯殼', 'exotic', { earth: 63, water: 34 }, () => [TAG_EXOTIC], '碧螯澤蟹留下的硬殼，能承受泥澤與暗流的長年沖刷。'],
  ['mat.qinglin_dragon_core', '青霖妖丹', 'exotic', { water: 58, wood: 34, earth: 23 }, () => [TAG_EXOTIC], '青霖蛟主凝成的妖丹，水木氣機纏著一線沉厚地脈。'],
];
const EQUIP_STATS = new Map(calibration.equipment.map((entry, index) => [EQUIPMENT[index][0], entry.equipBaselinePercents]));
const MONSTER_CALIBRATION = new Map(calibration.monsters.map((entry) => [entry.key, entry]));
const TAG_HERB = String.fromCodePoint(0x836f, 0x6750);
const TAG_ORE = String.fromCodePoint(0x77ff, 0x77f3);
const TAG_ORE_MATERIAL = String.fromCodePoint(0x77ff, 0x6750);
const TAG_METAL = String.fromCodePoint(0x91d1, 0x5c5e);
const TAG_EXOTIC = String.fromCodePoint(0x5f02, 0x6750);
const GLYPH_TREE = String.fromCodePoint(0x6811);
const GLYPH_IRON = String.fromCodePoint(0x94c1);

function drop(itemId, name, type, chance) {
  return { itemId, name, type, count: 1, ...(chance === undefined ? {} : { chance }) };
}
function buff(id, name, desc, mark, category, target, duration, stats, color) {
  return { type: 'buff', target, buffId: id, name, desc, shortMark: mark, category, visibility: 'public', color, duration, maxStacks: 1, statMode: 'percent', valueStats: stats };
}
function skillCost(shared, multiplier, level) {
  return shared.calculateTechniqueSkillQiCost(multiplier, 'earth', level);
}
function damageSkill(shared, o) {
  return {
    id: o.id, name: o.name, desc: o.desc, cooldown: o.cooldown,
    costMultiplier: o.costMultiplier, cost: skillCost(shared, o.costMultiplier, o.level), range: o.range,
    ...(o.targeting ? { targeting: o.targeting } : {}),
    effects: [{ type: 'damage', damageKind: o.damageKind, element: o.element, formula: { var: `caster.stat.${o.damageKind === 'spell' ? 'spellAtk' : 'physAtk'}`, scale: o.scale } }, ...(o.extraEffects ?? [])],
    unlockLevel: 1,
    ...(o.windupTicks ? { monsterCast: { windupTicks: o.windupTicks, warningColor: o.warningColor } } : {}),
  };
}

function buildTechnique(shared) {
  const s = (o) => damageSkill(shared, o);
  const skills = [
    s({ id: 'skill.qinglin_moss_pounce', name: '苔影撲咬', desc: '青苔雨蜥借濕苔掩護撲咬，造成一點四倍物理攻擊的木行傷害。', cooldown: 14, costMultiplier: 2, level: 35, range: 1, damageKind: 'physical', element: 'wood', scale: 1.4 }),
    s({ id: 'skill.qinglin_rain_spit', name: '雨涎飛濺', desc: '青苔雨蜥沿直線噴出雨涎，造成一點五倍法術攻擊的水行傷害。', cooldown: 18, costMultiplier: 2, level: 35, range: 4, damageKind: 'spell', element: 'water', scale: 1.5, targeting: { shape: 'line', width: 1, maxTargets: 4 } }),
    s({ id: 'skill.qinglin_mist_peck', name: '霧羽啄', desc: '濕羽鶴從霧中啄出水刃，造成一點五倍法術攻擊的水行傷害。', cooldown: 15, costMultiplier: 2, level: 36, range: 3, damageKind: 'spell', element: 'water', scale: 1.5 }),
    s({ id: 'skill.qinglin_wet_wing_sweep', name: '濕羽橫掃', desc: '濕羽鶴以飽含水氣的翼尖掃過前方，造成一點六倍物理攻擊的木行傷害。', cooldown: 20, costMultiplier: 3, level: 36, range: 1, damageKind: 'physical', element: 'wood', scale: 1.6, targeting: { shape: 'orientedBox', width: 3, height: 1, maxTargets: 3 } }),
    s({ id: 'skill.qinglin_shell_clamp', name: '厚螯夾擊', desc: '碧螯澤蟹以雙螯夾擊，造成一點四倍物理攻擊的土行傷害。', cooldown: 15, costMultiplier: 2, level: 36, range: 1, damageKind: 'physical', element: 'earth', scale: 1.4 }),
    { id: 'skill.qinglin_marsh_guard', name: '澤殼固守', desc: '碧螯澤蟹縮入厚殼，十二息內提高物理與法術防禦百分之十。', cooldown: 30, costMultiplier: 2, cost: skillCost(shared, 2, 36), range: 0, requiresTarget: false, unlockLevel: 1, effects: [buff('buff.qinglin_marsh_guard', '澤殼固守', '厚殼閉合，雙防提高百分之十。', '殼', 'buff', 'self', 12, { physDef: 10, spellDef: 10 }, '#718f7d')] },
    s({ id: 'skill.qinglin_dew_thread', name: '凝露絲', desc: '凝露蛛母射出帶露蛛絲，造成一點八倍法術攻擊的水行傷害，並使目標十二息內移速與閃避降低百分之十。', cooldown: 18, costMultiplier: 3, level: 37, range: 4, damageKind: 'spell', element: 'water', scale: 1.8, extraEffects: [buff('buff.qinglin_dew_thread', '凝露纏絲', '蛛絲黏住步伐，移速與閃避降低百分之十。', '絲', 'debuff', 'target', 12, { moveSpeed: -10, dodge: -10 }, '#93c9c2')] }),
    s({ id: 'skill.qinglin_rain_needle', name: '驟雨飛針', desc: '凝露蛛母沿直線散出細密水針，造成兩倍法術攻擊的水行傷害。', cooldown: 23, costMultiplier: 4, level: 37, range: 5, damageKind: 'spell', element: 'water', scale: 2, targeting: { shape: 'line', width: 2, maxTargets: 8 } }),
    s({ id: 'skill.qinglin_dewburst', name: '露網迸裂', desc: '凝露蛛母引爆三乘三範圍內的露網，預警兩息後造成二點三倍法術攻擊的水行傷害。', cooldown: 30, costMultiplier: 5, level: 37, range: 5, damageKind: 'spell', element: 'water', scale: 2.3, targeting: { shape: 'box', width: 3, height: 3, maxTargets: 9 }, windupTicks: 2, warningColor: '#78c9d4' }),
    s({ id: 'skill.qinglin_root_lash', name: '盤根鞭', desc: '盤根泥魈抽出老根，造成一點八倍物理攻擊的木行傷害。', cooldown: 17, costMultiplier: 3, level: 38, range: 2, damageKind: 'physical', element: 'wood', scale: 1.8 }),
    s({ id: 'skill.qinglin_bog_mist', name: '泥澤濁霧', desc: '盤根泥魈吐出濁霧，造成兩倍法術攻擊的水行傷害，並使目標十二息內命中降低百分之十。', cooldown: 24, costMultiplier: 4, level: 38, range: 4, damageKind: 'spell', element: 'water', scale: 2, extraEffects: [buff('buff.qinglin_bog_mist', '濁霧障目', '濁霧遮蔽視線，命中降低百分之十。', '霧', 'debuff', 'target', 12, { hit: -10 }, '#788f67')] }),
    s({ id: 'skill.qinglin_sinking_roots', name: '沉根陷地', desc: '盤根泥魈使三乘三範圍內的老根翻起，預警兩息後造成二點三倍物理攻擊的木行傷害。', cooldown: 31, costMultiplier: 5, level: 38, range: 5, damageKind: 'physical', element: 'wood', scale: 2.3, targeting: { shape: 'box', width: 3, height: 3, maxTargets: 9 }, windupTicks: 2, warningColor: '#6e9b63' }),
    s({ id: 'skill.qinglin_tide_bite', name: '潮牙噬', desc: '青霖蛟主借潮勢近身撕咬，造成二點四倍物理攻擊的水行傷害。', cooldown: 18, costMultiplier: 3, level: 38, range: 2, damageKind: 'physical', element: 'water', scale: 2.4 }),
    s({ id: 'skill.qinglin_rainfall', name: '青霖暴雨', desc: '青霖蛟主召下暴雨，預警三息後對五乘五範圍造成三倍法術攻擊的水行傷害。', cooldown: 34, costMultiplier: 6, level: 38, range: 6, damageKind: 'spell', element: 'water', scale: 3, targeting: { shape: 'box', width: 5, height: 5, maxTargets: 25 }, windupTicks: 3, warningColor: '#4daed0' }),
    s({ id: 'skill.qinglin_dragon_coil', name: '蛟影纏江', desc: '青霖蛟主沿直線捲起水流，預警兩息後造成二點四倍法術攻擊的水行傷害，並使目標十二息內移速降低百分之十二。', cooldown: 28, costMultiplier: 5, level: 38, range: 6, damageKind: 'spell', element: 'water', scale: 2.4, targeting: { shape: 'line', width: 2, maxTargets: 10 }, windupTicks: 2, warningColor: '#62b9c7', extraEffects: [buff('buff.qinglin_dragon_coil', '蛟流纏身', '迴流纏住雙腿，移速降低百分之十二。', '纏', 'debuff', 'target', 12, { moveSpeed: -12 }, '#62b9c7')] }),
    { id: 'skill.qinglin_deep_pool_guard', name: '深潭護鱗', desc: '青霖蛟主收攏潭水護住鱗甲，十四息內提高雙防百分之十與化解百分之八。', cooldown: 42, costMultiplier: 3, cost: skillCost(shared, 3, 38), range: 0, requiresTarget: false, unlockLevel: 1, effects: [buff('buff.qinglin_deep_pool_guard', '深潭護鱗', '潭水覆住鱗甲，雙防提高百分之十、化解提高百分之八。', '潭', 'buff', 'self', 14, { physDef: 10, spellDef: 10, resolvePower: 8 }, '#478f99')] },
  ];
  return { id: TECHNIQUE_ID, name: '青霖澤妖術', desc: '青霖澤妖物借木水濕氣施展的攻守術式。', grade: 'earth', category: 'arts', realmLv: 35, maxLayer: 10, expDifficulty: 1, skills };
}

function buildItems() {
  const equipment = EQUIPMENT.map(([itemId, name, equipSlot, desc]) => ({ itemId, name, type: 'equipment', grade: 'mystic', level: 37, desc, equipSlot, equipBaselinePercents: EQUIP_STATS.get(itemId) }));
  const materials = MATERIALS.map(([itemId, name, materialCategory, elements, buildTags, desc]) => ({ itemId, name, type: 'material', grade: 'mystic', level: 37, materialCategory, materialValues: { elements }, desc, tags: buildTags() }));
  return [...equipment, ...materials,
    { itemId: 'pill.qinglin_qi_restore', name: '青霖回元丹', type: 'consumable', grade: 'mystic', level: 37, desc: '澤心苓與青霖蘭煉成的回元丹，服下後立即補回靈力，並短時加快靈力回覆。', cooldown: 60, baselineQiPercent: 2, consumeBuffs: [{ buffId: 'item_buff.pill_qinglin_qi_restore', name: '青霖回元', desc: '藥力迴流氣海，靈力回覆提高百分之三百。', shortMark: '元', duration: 90, stats: { qiRegenRate: 300 }, statMode: 'percent' }] },
    { itemId: 'pill.qinglin_meridian_restore', name: '凝露養脈丹', type: 'consumable', grade: 'mystic', level: 37, desc: '凝露裹住受損經脈，服下後立即回覆生命，並短時加快生命回覆。', cooldown: 60, baselineHealPercent: 2, consumeBuffs: [{ buffId: 'item_buff.pill_qinglin_meridian_restore', name: '凝露養脈', desc: '凝露護住經脈，生命回覆提高百分之三百。', shortMark: '養', duration: 90, stats: { hpRegenRate: 300 }, statMode: 'percent' }] },
    { itemId: 'scroll.qinglin_marsh', name: '青霖澤圖卷', type: 'consumable', grade: 'mystic', level: 35, desc: '記著寒鐵側洞、濕地石棧橋、採集岸與深潭位置。使用後可永久解鎖青霖澤地圖。', mapUnlockId: MAP_ID },
  ];
}

function sumElements(ingredients, itemById) {
  const total = {};
  for (const ingredient of ingredients) {
    const elements = itemById.get(ingredient.itemId)?.materialValues?.elements;
    if (!elements) throw new Error(`青霖澤配方引用了沒有五行值的材料：${ingredient.itemId}`);
    for (const [element, value] of Object.entries(elements)) total[element] = (total[element] ?? 0) + value * ingredient.count;
  }
  return total;
}
function makeRecipe(recipeId, outputItemId, specs, itemById, baseBrewTicks, category) {
  const ingredients = specs.map(([itemId, count, role]) => ({ itemId, count, role }));
  const mainIngredients = ingredients.filter((entry) => entry.role === 'main').map(({ itemId, count }) => ({ itemId, count }));
  return { recipeId, outputItemId, outputCount: 1, baseBrewTicks, level: 37, grade: 'mystic', ...(category ? { category } : {}), ingredients, mainIngredients, requiredAuxElements: sumElements(ingredients.filter((entry) => entry.role === 'aux'), itemById) };
}
function buildRecipes(items) {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const r = (id, output, ingredients, ticks, category) => makeRecipe(id, output, ingredients, byId, ticks, category);
  return {
    forging: [
      r('forging.qinglin_raincleaver', 'equip.qinglin_raincleaver', [['mat.qinglin_copper_ore', 2, 'main'], ['mat.qinglin_lizard_scale', 1, 'aux'], ['mat.qinglin_jade_sand', 1, 'aux']], 84, 'equipment'),
      r('forging.qinglin_tide_staff', 'equip.qinglin_tide_staff', [['mat.qinglin_jade_sand', 2, 'main'], ['mat.qinglin_ling', 1, 'aux'], ['mat.qinglin_lizard_scale', 1, 'aux']], 84, 'equipment'),
      r('forging.qinglin_dew_crown', 'equip.qinglin_dew_crown', [['mat.qinglin_crab_shell', 2, 'main'], ['mat.qinglin_orchid', 1, 'aux']], 82, 'equipment'),
      r('forging.qinglin_scale_robe', 'equip.qinglin_scale_robe', [['mat.qinglin_lizard_scale', 2, 'main'], ['mat.qinglin_orchid', 1, 'aux'], ['mat.qinglin_ling', 1, 'aux']], 88, 'equipment'),
      r('forging.qinglin_lotus_boots', 'equip.qinglin_lotus_boots', [['mat.qinglin_jade_sand', 2, 'main'], ['mat.qinglin_crab_shell', 1, 'aux']], 82, 'equipment'),
      r('forging.qinglin_pool_pendant', 'equip.qinglin_pool_pendant', [['mat.qinglin_dragon_core', 1, 'main'], ['mat.qinglin_ling', 2, 'aux'], ['mat.qinglin_jade_sand', 1, 'aux']], 90, 'equipment'),
    ],
    alchemy: [
      r('alchemy.pill.qinglin_qi_restore', 'pill.qinglin_qi_restore', [['mat.qinglin_ling', 2, 'main'], ['mat.qinglin_orchid', 1, 'aux'], ['mat.qinglin_jade_sand', 1, 'aux']], 48),
      r('alchemy.pill.qinglin_meridian_restore', 'pill.qinglin_meridian_restore', [['mat.qinglin_orchid', 2, 'main'], ['mat.qinglin_ling', 1, 'aux'], ['mat.qinglin_lizard_scale', 1, 'aux']], 48),
    ],
  };
}

function buildMonsters() {
  const defs = [
    { identity: MONSTER_IDENTITIES[0], char: '蜥', color: '#5d9c72', count: 4, radius: 5, aggroRange: 6, respawnSec: 18, skills: ['skill.qinglin_moss_pounce', 'skill.qinglin_rain_spit'], drops: [drop('mat.qinglin_lizard_scale', '雨蜥鱗', 'material'), drop('book.foundation_manual_5', '《焚木回春篇》', 'skill_book', 0.008)] },
    { identity: MONSTER_IDENTITIES[1], char: '鶴', color: '#a8c9c1', count: 3, radius: 6, aggroRange: 6, respawnSec: 19, skills: ['skill.qinglin_mist_peck', 'skill.qinglin_wet_wing_sweep'], drops: [drop('mat.qinglin_lizard_scale', '雨蜥鱗', 'material', 0.35), drop('book.foundation_manual_6', '《藤火纏枝訣》', 'skill_book', 0.008)] },
    { identity: MONSTER_IDENTITIES[2], char: '蟹', color: '#658f84', count: 3, radius: 5, aggroRange: 5, respawnSec: 20, skills: ['skill.qinglin_shell_clamp', 'skill.qinglin_marsh_guard'], drops: [drop('mat.qinglin_crab_shell', '澤螯殼', 'material')] },
    { identity: MONSTER_IDENTITIES[3], char: '蛛', color: '#86b7ab', count: 2, radius: 4, aggroRange: 7, respawnSec: 36, skills: ['skill.qinglin_dew_thread', 'skill.qinglin_rain_needle', 'skill.qinglin_dewburst'], drops: [drop('mat.qinglin_lizard_scale', '雨蜥鱗', 'material'), drop('mat.qinglin_crab_shell', '澤螯殼', 'material', 0.4), drop('book.foundation_manual_7', '《燼息調元法》', 'skill_book', 0.04)] },
    { identity: MONSTER_IDENTITIES[4], char: '魈', color: '#607a58', count: 2, radius: 4, aggroRange: 7, respawnSec: 40, skills: ['skill.qinglin_root_lash', 'skill.qinglin_bog_mist', 'skill.qinglin_sinking_roots'], drops: [drop('mat.qinglin_crab_shell', '澤螯殼', 'material'), drop('mat.qinglin_lizard_scale', '雨蜥鱗', 'material', 0.4), drop('book.foundation_manual_8', '《焚林照夜印》', 'skill_book', 0.04)] },
    { identity: MONSTER_IDENTITIES[5], char: '蛟', color: '#38a3a5', count: 1, maxAlive: 1, radius: 3, aggroRange: 9, respawnSec: 120, skills: ['skill.qinglin_tide_bite', 'skill.qinglin_rainfall', 'skill.qinglin_dragon_coil', 'skill.qinglin_deep_pool_guard'], drops: [drop('mat.qinglin_dragon_core', '青霖妖丹', 'material'), drop('mat.qinglin_lizard_scale', '雨蜥鱗', 'material', 0.5), drop('mat.qinglin_crab_shell', '澤螯殼', 'material', 0.5), drop('book.foundation_manual_8', '《焚林照夜印》', 'skill_book', 0.08)] },
  ];
  return defs.map(({ identity: [id, name, key], ...rest }) => {
    const tuned = MONSTER_CALIBRATION.get(key);
    if (!tuned) throw new Error(`缺少青霖澤怪物校準：${key}`);
    return { id, name, ...rest, grade: tuned.grade, tier: tuned.tier, level: tuned.level, valueStats: tuned.valueStats, statPercents: tuned.statPercents };
  });
}

function grid(width, height, value) { return Array.from({ length: height }, () => Array(width).fill(value)); }
function ellipse(target, cx, cy, rx, ry, paint) {
  for (let y = Math.max(0, cy - ry); y <= Math.min(target.length - 1, cy + ry); y += 1) {
    for (let x = Math.max(0, cx - rx); x <= Math.min(target[0].length - 1, cx + rx); x += 1) {
      if (((x - cx) ** 2) / rx ** 2 + ((y - cy) ** 2) / ry ** 2 <= 1) target[y][x] = paint(x, y);
    }
  }
}
function overlayEllipse(target, cx, cy, rx, ry, value) {
  for (let y = Math.max(0, cy - ry); y <= Math.min(target.length - 1, cy + ry); y += 1) {
    for (let x = Math.max(0, cx - rx); x <= Math.min(target[0].length - 1, cx + rx); x += 1) {
      if (((x - cx) ** 2) / rx ** 2 + ((y - cy) ** 2) / ry ** 2 <= 1 && target[y][x] !== '水') target[y][x] = value;
    }
  }
}
function path(target, points, value, width = 1) {
  for (let i = 1; i < points.length; i += 1) {
    let [x, y] = points[i - 1]; const [tx, ty] = points[i];
    while (x !== tx || y !== ty) {
      for (let o = 0; o < width; o += 1) if (target[y]?.[x + o] !== undefined) target[y][x + o] = value;
      if (x !== tx) x += Math.sign(tx - x); else y += Math.sign(ty - y);
    }
    for (let o = 0; o < width; o += 1) if (target[ty]?.[tx + o] !== undefined) target[ty][tx + o] = value;
  }
}
function buildMap() {
  const width = 48; const height = 40;
  const terrain = grid(width, height, '水'); const surface = grid(width, height, '.'); const structure = grid(width, height, '.');
  for (const [cx, cy, rx, ry] of [[7, 24, 6, 8], [18, 10, 9, 6], [21, 28, 10, 7], [34, 12, 9, 7], [40, 25, 7, 8], [31, 29, 7, 6]]) ellipse(terrain, cx, cy, rx, ry, () => '草');
  // 以相連的大塊泥岸與沿水沼帶分區，避免座標取餘造成重複斜紋或棋盤感。
  for (const patch of [[7, 27, 4, 3], [15, 11, 4, 3], [20, 29, 6, 4], [35, 13, 5, 3], [41, 26, 4, 4]]) overlayEllipse(terrain, ...patch, '泥');
  for (const patch of [[4, 22, 2, 4], [23, 10, 2, 3], [13, 28, 2, 4], [29, 14, 2, 4], [45, 24, 2, 4]]) overlayEllipse(terrain, ...patch, '沼');
  path(surface, [[4, 24], [13, 24], [20, 24], [28, 21], [35, 21], [41, 24]], '板', 2);
  path(surface, [[17, 24], [17, 16], [18, 10]], '板'); path(surface, [[27, 21], [29, 16], [34, 12]], '板');
  path(surface, [[22, 24], [22, 29], [31, 29]], '板'); path(surface, [[36, 21], [40, 18], [43, 20]], '板'); path(surface, [[36, 25], [43, 25], [43, 29]], '板');
  for (const [x, y] of [[3, 19], [5, 18], [9, 20], [12, 7], [15, 5], [23, 8], [26, 13], [30, 7], [38, 8], [44, 12], [13, 30], [17, 34], [27, 32], [35, 33], [45, 27]]) if (terrain[y][x] !== '水' && surface[y][x] === '.') structure[y][x] = GLYPH_TREE;
  for (const [x, y] of [[8, 29], [12, 26], [29, 9], [36, 13], [24, 32], [28, 28], [39, 19], [44, 27]]) structure[y][x] = GLYPH_IRON;
  return {
    format: 2, id: MAP_ID, name: '青霖澤', mapGroupId: MAP_ID, mapGroupName: '青霖澤', mapGroupOrder: 1020, mapGroupMemberOrder: 0,
    width, height, routeDomain: 'system', mapLv: 35, spaceVisionMode: 'isolated', description: '寒鐵側洞外的木水濕地。古石棧橋跨過水道與泥澤，採集岸、沉礦脊和青霖蛟主盤踞的深潭彼此相連。',
    terrain: terrain.map((row) => row.join('')), structure: structure.map((row) => row.join('')), surface: surface.map((row) => row.join('')), spawnPoint: { x: 4, y: 24 },
    portals: [{ id: `${MAP_ID}:4,24`, targetPortalId: 'frostblade_abyss:32,26', direction: 'two_way', x: 4, y: 24, targetMapId: 'frostblade_abyss', targetX: 32, targetY: 26, kind: 'portal', trigger: 'manual', routeDomain: 'inherit', allowPlayerOverlap: false, hidden: false, observeTitle: '寒鐵側洞', observeDesc: '循西側古石棧橋穿回寒鐵側洞，便能返回霜刃淵。' }],
    monsterSpawns: [[9, 24, 'm_qinglin_rain_lizard'], [18, 10, 'm_qinglin_wet_crane'], [20, 29, 'm_qinglin_marsh_crab'], [31, 11, 'm_qinglin_dew_spider'], [31, 29, 'm_qinglin_root_fiend'], [41, 24, 'm_qinglin_dragon_lord']],
    landmarks: [
      { id: 'lm_qinglin_bridgehead', name: '青霖石棧橋', x: 7, y: 24, desc: '斥候沿寒鐵側洞外的暗流補起古老石橋，橋面常年帶著水光。' },
      { id: 'lm_qinglin_orchid_bank', name: '蘭雨岸', x: 17, y: 8, desc: '北岸雨霧不散，青霖蘭與澤心苓沿泥水交界成片生長。' },
      { id: 'lm_qinglin_sunken_vein', name: '沉礦脊', x: 25, y: 30, desc: '水道沖開低矮岩脊，碧紋銅礦與沉水玉砂從泥下露出。' },
      { id: 'lm_qinglin_web_channel', name: '露網汊', x: 33, y: 14, desc: '支水道上掛滿凝露蛛網，水珠會隨蛛母的氣息同時震動。' },
      { id: 'lm_qinglin_deep_pool', name: '蛟眠深潭', x: 43, y: 25, desc: '石堤在深潭前分作兩岔，潭底盤著收攏青霖雨勢的蛟主。' },
    ], npcs: [],
    resourceNodeGroups: [
      { resourceNodeId: RESOURCE_NODE_IDS[0], idPrefix: 'lm_qinglin_orchid', name: '青霖蘭', placements: [{ x: 13, y: 8 }, { x: 17, y: 6 }, { x: 21, y: 9 }, { x: 25, y: 13 }] },
      { resourceNodeId: RESOURCE_NODE_IDS[1], idPrefix: 'lm_qinglin_ling', name: '澤心苓', placements: [{ x: 15, y: 29 }, { x: 20, y: 33 }, { x: 34, y: 10 }, { x: 38, y: 15 }] },
    ],
    mineralNodes: [
      ...[[8, 29], [12, 26], [29, 9], [36, 13]].map(([x, y]) => ({ x, y, name: '碧紋銅礦', itemId: 'mat.qinglin_copper_ore', level: 37, damageChanceBps: 50, destroyCount: 1 })),
      ...[[24, 32], [28, 28], [39, 19], [44, 27]].map(([x, y]) => ({ x, y, name: '沉水玉砂', itemId: 'mat.qinglin_jade_sand', level: 37, damageChanceBps: 50, destroyCount: 1 })),
    ],
  };
}
function buildResourceNodes() {
  return [
    { id: RESOURCE_NODE_IDS[0], kind: 'landmark_container', name: '青霖蘭', container: { variant: 'herb', grade: 'mystic', refreshTicksMin: 90, refreshTicksMax: 140, char: '蘭', color: '#88c9a0', drops: [drop('mat.qinglin_orchid', '青霖蘭', 'material')] } },
    { id: RESOURCE_NODE_IDS[1], kind: 'landmark_container', name: '澤心苓', container: { variant: 'herb', grade: 'mystic', refreshTicksMin: 100, refreshTicksMax: 150, char: '苓', color: '#b8d6a3', drops: [drop('mat.qinglin_ling', '澤心苓', 'material')] } },
  ];
}

export function buildFoundationExpansion(shared) {
  for (const api of ['calculateTechniqueSkillQiCost', 'resolveMonsterTemplateRecord', 'computeFivePhaseElementMatch']) if (typeof shared?.[api] !== 'function') throw new Error(`青霖澤生成器缺少 shared API：${api}`);
  const items = buildItems(); const recipes = buildRecipes(items);
  return { items, monsters: buildMonsters(), techniques: [buildTechnique(shared)], ...recipes, resourceNodes: buildResourceNodes(), map: buildMap() };
}
