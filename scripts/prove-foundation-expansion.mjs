import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ITEM_IDENTITIES, MAP_ID, MONSTER_IDENTITIES, RESOURCE_NODE_IDS, TECHNIQUE_ID, buildFoundationExpansion } from './lib/foundation-expansion.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = require('../packages/shared/dist/index.js');
const baselines = require('../packages/shared/src/constants/gameplay/player-final-attr-baselines.json');
const { ContentTemplateRepository } = require('../packages/server/dist/content/content-template.repository.js');
const { MapTemplateRepository } = require('../packages/server/dist/runtime/map/map-template.repository.js');
const { CraftPanelRuntimeService } = require('../packages/server/dist/runtime/craft/craft-panel-runtime.service.js');
const { resolveCombatDamage } = require('../packages/server/dist/runtime/combat/combat-pipeline-compose.js');

const failures = [];
const checks = [];
const generated = buildFoundationExpansion(shared);
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
function check(label, callback) {
  try { callback(); checks.push(label); }
  catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
}
function sumElements(ingredients, itemById) {
  const total = {};
  for (const ingredient of ingredients) {
    for (const [element, value] of Object.entries(itemById.get(ingredient.itemId)?.materialValues?.elements ?? {})) total[element] = (total[element] ?? 0) + value * ingredient.count;
  }
  return total;
}
function applyEquipment(baseStats, build) {
  const result = structuredClone(baseStats);
  const weaponSuffix = build === 'physical' ? 'raincleaver' : 'tide_staff';
  const equipment = generated.items.filter((item) => item.type === 'equipment' && (item.equipSlot !== 'weapon' || item.itemId.endsWith(weaponSuffix)));
  for (const item of equipment) {
    const effectiveness = shared.getEquipmentRealmEffectiveness(35, item.level);
    const actual = shared.compileEquipmentBaselinePercentsToActualStats(item.equipBaselinePercents, { grade: item.grade, level: item.level }) ?? {};
    for (const [key, value] of Object.entries(actual)) if (typeof value === 'number') result[key] = (result[key] ?? 0) + value * effectiveness;
  }
  result.realmLv = 35;
  return result;
}
function averageDamage(input, samples = 4_000) {
  let total = 0; let hits = 0;
  for (let index = 0; index < samples; index += 1) {
    const outcome = resolveCombatDamage({ ...input, attackerCombatExp: 100, targetCombatExp: 100 });
    total += outcome.damage; if (outcome.hit) hits += 1;
  }
  return { damage: total / samples, hitRate: hits / samples };
}
function attackEstimate(player, monster, damageKind) {
  const monsterStats = shared.resolveMonsterTemplateRecord(monster).computedStats;
  const stat = damageKind === 'spell' ? 'spellAtk' : 'physAtk';
  const attack = averageDamage({ attackerStats: player, attackerRatios: {}, attackerRealmLv: 35, targetStats: monsterStats, targetRatios: {}, targetRealmLv: monster.level, baseDamage: player[stat], damageKind });
  return { opportunities: monsterStats.maxHp / Math.max(1, attack.damage - monsterStats.hpRegenRate), hitRate: attack.hitRate };
}
function percent(value) { return Number((value * 100).toFixed(3)); }
function adjacentReachable(template, seen, x, y) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((y + dy) * template.width + x + dx));
}

const idempotence = spawnSync(process.execPath, [path.join(root, 'scripts/generate-foundation-expansion.mjs')], { cwd: root, encoding: 'utf8' });
check('正式生成器冪等', () => {
  assert.equal(idempotence.status, 0, idempotence.stderr || idempotence.stdout);
  assert.deepEqual(JSON.parse(idempotence.stdout).changed, []);
  const sources = ['scripts/generate-foundation-expansion.mjs', 'scripts/lib/foundation-expansion.mjs', 'scripts/lib/foundation-expansion-calibration.json'].map((entry) => fs.readFileSync(path.join(root, entry), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /readFileSync\([^\n]*\.runtime/);
});

const content = new ContentTemplateRepository();
content.onModuleInit();
const maps = new MapTemplateRepository();
maps.onModuleInit();
const craft = new CraftPanelRuntimeService(content, null, null, null, null);
craft.loadAlchemyCatalog();
craft.loadForgingCatalog();
const map = maps.getOrThrow(MAP_ID);
const frost = maps.getOrThrow('frostblade_abyss');
const sourceMap = readJson('packages/server/data/maps/foundation_qinglin_marsh.json');
const sourceFrost = readJson('packages/server/data/maps/frostblade_abyss.json');
const itemById = new Map(generated.items.map((item) => [item.itemId, item]));

check('16 件固定物品名稱與執行期載入', () => {
  assert.equal(generated.items.length, 16);
  for (const [itemId, name] of ITEM_IDENTITIES) {
    assert.equal(itemById.get(itemId)?.name, name);
    assert.equal(content.itemTemplates.get(itemId)?.name, name);
  }
});
check('六怪與十六招皆由 ContentTemplateRepository 載入', () => {
  assert.equal(generated.monsters.length, 6);
  assert.equal(generated.techniques[0].skills.length, 16);
  for (const [monsterId] of MONSTER_IDENTITIES) {
    assert(content.monsterRuntimeTemplates.has(monsterId), monsterId);
    for (const skillId of generated.monsters.find((entry) => entry.id === monsterId).skills) assert(content.getSkill(skillId), skillId);
  }
  assert.equal(content.createRuntimeMonstersForMap(MAP_ID).length, 23);
});
check('六器方與兩丹方進入真製作目錄', () => {
  const forging = craft.forgingCatalog.filter((entry) => entry.recipeId.startsWith('forging.qinglin_'));
  const alchemy = craft.alchemyCatalog.filter((entry) => entry.recipeId.startsWith('alchemy.pill.qinglin_'));
  assert.equal(forging.length, 6); assert.equal(alchemy.length, 2);
  assert.deepEqual(new Set(forging.map((entry) => entry.outputItemId)), new Set(generated.forging.map((entry) => entry.outputItemId)));
});
check('所有配方引用與五行標準材料閉合', () => {
  for (const recipe of [...generated.forging, ...generated.alchemy]) {
    assert(content.itemTemplates.has(recipe.outputItemId), recipe.outputItemId);
    for (const ingredient of recipe.ingredients) assert(content.itemTemplates.has(ingredient.itemId), ingredient.itemId);
    const main = sumElements(recipe.mainIngredients, itemById);
    const input = sumElements(recipe.ingredients, itemById);
    const target = { ...main };
    for (const [element, value] of Object.entries(recipe.requiredAuxElements)) target[element] = (target[element] ?? 0) + value;
    assert.deepEqual(input, target, recipe.recipeId);
    assert.equal(shared.computeFivePhaseElementMatch(input, target).baseElementSuccessRate, 1, recipe.recipeId);
  }
  for (const material of generated.items.filter((item) => item.type === 'material')) {
    const total = Object.values(material.materialValues.elements).reduce((sum, value) => sum + value, 0);
    const expected = material.materialCategory === 'herb' ? 97 : material.materialCategory === 'ore' ? 97 : 97;
    assert(total >= expected, material.itemId);
    assert([...generated.forging, ...generated.alchemy].some((recipe) => recipe.ingredients.some((entry) => entry.itemId === material.itemId)), `${material.itemId} 無配方用途`);
  }
});
check('七材料來源與四本完整功法定向掉落', () => {
  const monsterDrops = generated.monsters.flatMap((monster) => monster.drops.map((entry) => ({ monsterId: monster.id, ...entry })));
  for (const itemId of ['mat.qinglin_lizard_scale', 'mat.qinglin_crab_shell', 'mat.qinglin_dragon_core']) assert(monsterDrops.some((entry) => entry.itemId === itemId), itemId);
  const nodeDrops = generated.resourceNodes.flatMap((node) => node.container.drops);
  for (const itemId of ['mat.qinglin_orchid', 'mat.qinglin_ling']) assert(nodeDrops.some((entry) => entry.itemId === itemId), itemId);
  for (const itemId of ['mat.qinglin_copper_ore', 'mat.qinglin_jade_sand']) assert(sourceMap.mineralNodes.some((entry) => entry.itemId === itemId), itemId);
  for (const number of [5, 6, 7, 8]) assert(monsterDrops.some((entry) => entry.itemId === `book.foundation_manual_${number}`), `book.foundation_manual_${number}`);
});
check('丹藥與圖卷使用既有真功能', () => {
  const qi = content.itemTemplates.get('pill.qinglin_qi_restore');
  const hp = content.itemTemplates.get('pill.qinglin_meridian_restore');
  const scroll = content.itemTemplates.get('scroll.qinglin_marsh');
  assert.equal(qi.baselineQiPercent, 2); assert.equal(qi.consumeBuffs[0].stats.qiRegenRate, 300);
  assert.equal(hp.baselineHealPercent, 2); assert.equal(hp.consumeBuffs[0].stats.hpRegenRate, 300);
  assert.equal(scroll.mapUnlockId, MAP_ID);
  assert(sourceFrost.npcs.find((npc) => npc.id === 'npc_frostblade_scout')?.shopItems.some((entry) => entry.itemId === 'scroll.qinglin_marsh'));
});
check('雙向傳送門互指並保留霜刃淵原精英與採集點', () => {
  const outbound = map.portals.find((portal) => portal.id === `${MAP_ID}:4,24`);
  const inbound = frost.portals.find((portal) => portal.id === 'frostblade_abyss:32,26');
  assert(outbound && inbound); assert.equal(outbound.targetPortalId, inbound.id); assert.equal(inbound.targetPortalId, outbound.id);
  assert.deepEqual([outbound.targetX, outbound.targetY], [inbound.x, inbound.y]); assert.deepEqual([inbound.targetX, inbound.targetY], [outbound.x, outbound.y]);
  assert(sourceFrost.monsterSpawns.some((entry) => entry[0] === 36 && entry[1] === 28 && entry[2] === 'm_ironshell_turtle'));
  assert(sourceFrost.resourceNodeGroups.some((entry) => entry.resourceNodeId === 'landmark.herb.frostblade_frost_crystal'));
});

const walkableCount = [...map.walkableMask].reduce((sum, value) => sum + value, 0);
const queue = [map.spawnY * map.width + map.spawnX];
const seen = new Set(queue);
for (let cursor = 0; cursor < queue.length; cursor += 1) {
  const index = queue[cursor]; const x = index % map.width; const y = Math.floor(index / map.width);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx; const ny = y + dy; const next = ny * map.width + nx;
    if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && map.walkableMask[next] === 1 && !seen.has(next)) { seen.add(next); queue.push(next); }
  }
}
check('全圖可行走區 BFS 單一連通且關鍵場景可達', () => {
  assert.equal(seen.size, walkableCount);
  for (const [x, y] of [...sourceMap.monsterSpawns.map(([sx, sy]) => [sx, sy]), ...sourceMap.landmarks.map((entry) => [entry.x, entry.y]), ...sourceMap.resourceNodeGroups.flatMap((entry) => entry.placements.map(({ x, y }) => [x, y])), [4, 24]]) assert(seen.has(y * map.width + x), `${x},${y}`);
  for (const mineral of sourceMap.mineralNodes) assert(adjacentReachable(map, seen, mineral.x, mineral.y), `${mineral.x},${mineral.y}`);
});
check('木水濕地分層地形不是草地矩形', () => {
  const chars = sourceMap.terrain.join(''); const surfaces = sourceMap.surface.join(''); const structures = sourceMap.structure.join('');
  assert(chars.match(/水/g).length > 500); assert(chars.match(/草/g).length > 200); assert(chars.match(/泥/g).length > 100); assert(chars.match(/沼/g).length > 30);
  assert(surfaces.match(/板/g).length > 100); assert.equal(structures.match(/铁/g).length, 8); assert(structures.match(/树/g).length >= 10);
  assert.equal(sourceMap.resourceNodeGroups.length, 2); assert.equal(sourceMap.mineralNodes.length, 8); assert.equal(sourceMap.landmarks.length, 5);
  for (const resourceNodeId of RESOURCE_NODE_IDS) assert(map.landmarks.some((entry) => entry.id.startsWith(resourceNodeId.replace('landmark.herb.', 'lm_qinglin_').split('.').at(-1))) || generated.resourceNodes.some((entry) => entry.id === resourceNodeId));
});

const baseline35 = baselines.levels.find((entry) => entry.realmLv === 35)?.stats;
assert(baseline35, '缺少35級玩家最終屬性基線');
const physicalPlayer = applyEquipment(baseline35, 'physical');
const spellPlayer = applyEquipment(baseline35, 'spell');
const balanceRows = generated.monsters.map((monster) => {
  const stats = shared.resolveMonsterTemplateRecord(monster).computedStats;
  const physical = attackEstimate(physicalPlayer, monster, 'physical');
  const spell = attackEstimate(spellPlayer, monster, 'spell');
  const basicKind = monster.id === 'm_qinglin_wet_crane' || monster.id === 'm_qinglin_root_fiend' ? 'spell' : 'physical';
  const basic = averageDamage({ attackerStats: stats, attackerRatios: {}, attackerRealmLv: monster.level, targetStats: physicalPlayer, targetRatios: {}, targetRealmLv: 35, baseDamage: stats[basicKind === 'spell' ? 'spellAtk' : 'physAtk'], damageKind: basicKind });
  return { monsterId: monster.id, level: monster.level, tier: monster.tier, maxHp: stats.maxHp, physAtk: stats.physAtk, spellAtk: stats.spellAtk, physicalOpportunities: Number(physical.opportunities.toFixed(2)), spellOpportunities: Number(spell.opportunities.toFixed(2)), playerPhysicalHitRate: Number(physical.hitRate.toFixed(4)), playerSpellHitRate: Number(spell.hitRate.toFixed(4)), basicDamagePercentOfPlayerHp: percent(basic.damage / physicalPlayer.maxHp), passiveRegenPercent: percent(stats.hpRegenRate / stats.maxHp) };
});
check('真傷害管線的普通、精英、頭目曲線', () => {
  for (const row of balanceRows.slice(0, 3)) { assert(row.physicalOpportunities >= 8 && row.physicalOpportunities <= 18, JSON.stringify(row)); assert(row.spellOpportunities >= 8 && row.spellOpportunities <= 18, JSON.stringify(row)); }
  for (const row of balanceRows.slice(3, 5)) { assert(row.physicalOpportunities >= 25 && row.physicalOpportunities <= 50, JSON.stringify(row)); assert(row.spellOpportunities >= 25 && row.spellOpportunities <= 50, JSON.stringify(row)); }
  const boss = balanceRows.at(-1); assert(boss.physicalOpportunities >= 75 && boss.physicalOpportunities <= 95, JSON.stringify(boss)); assert(boss.spellOpportunities >= 65 && boss.spellOpportunities <= 85, JSON.stringify(boss));
  assert(boss.basicDamagePercentOfPlayerHp >= 3.5 && boss.basicDamagePercentOfPlayerHp <= 5.2, JSON.stringify(boss));
});
const bossTemplate = generated.monsters.at(-1); const bossStats = shared.resolveMonsterTemplateRecord(bossTemplate).computedStats;
const warnedRows = generated.techniques[0].skills.filter((skill) => bossTemplate.skills.includes(skill.id) && skill.monsterCast).map((skill) => {
  const effect = skill.effects.find((entry) => entry.type === 'damage'); const stat = effect.damageKind === 'spell' ? 'spellAtk' : 'physAtk';
  const result = averageDamage({ attackerStats: bossStats, attackerRatios: {}, attackerRealmLv: bossTemplate.level, targetStats: physicalPlayer, targetRatios: {}, targetRealmLv: 35, baseDamage: bossStats[stat] * effect.formula.scale, damageKind: effect.damageKind });
  return { skillId: skill.id, windupTicks: skill.monsterCast.windupTicks, averageDamagePercentOfPlayerHp: percent(result.damage / physicalPlayer.maxHp), qiCostPercent: percent(skill.cost / bossStats.maxQi) };
});
check('頭目預警招與耗靈可承受', () => {
  assert.equal(warnedRows.length, 2);
  for (const row of warnedRows) { assert(row.averageDamagePercentOfPlayerHp >= 8 && row.averageDamagePercentOfPlayerHp <= 15, JSON.stringify(row)); assert(row.qiCostPercent <= 35, JSON.stringify(row)); }
});
const golden = content.monsterRuntimeTemplates.get('m_huanling_zhenren');
check('38級頭目沒有抹平43級金丹邊界', () => {
  assert(golden); assert(bossStats.maxHp < golden.maxHp * 0.2); assert(Math.max(bossStats.physAtk, bossStats.spellAtk) < Math.max(golden.numericStats.physAtk, golden.numericStats.spellAtk) * 0.2);
});

const tileSamples = [[4, 24], [17, 8], [25, 30], [41, 24]].map(([x, y]) => ({
  x, y, type: shared.composeTileTypeFromLayers(map.terrainRows[y][x], map.surfaceRows[y]?.[x] ?? null, map.structureRows[y]?.[x] ?? null), terrainType: map.terrainRows[y][x],
  surfaceType: map.surfaceRows[y]?.[x] ?? null, structureType: map.structureRows[y]?.[x] ?? null,
  walkable: map.walkableMask[y * map.width + x] === 1,
}));
const report = {
  ok: failures.length === 0,
  assumptions: [
    '攻擊次數是假設玩家不中斷且每次成功下達一次普攻的歸一化機會，不是實際秒數。',
    '傷害由編譯後伺服器 resolveCombatDamage 各抽樣四千次；雙方戰鬥經驗固定一百，以隔離內容屬性與境界壓制。',
    '玩家採35級最終基線，裝備37級玄階的一把對應武器與頭、身、腿、飾四件，逐件套用0.9025境界效能。',
    '未模擬走位、技能輪替、控制、延遲、丹藥與怪物AI長期DPS；預警招欄位只代表單次命中平均傷害。',
  ],
  counts: { items: generated.items.length, monsters: generated.monsters.length, runtimeMonsters: content.createRuntimeMonstersForMap(MAP_ID).length, skills: generated.techniques[0].skills.length, forgingRecipes: generated.forging.length, alchemyRecipes: generated.alchemy.length, herbPlacements: sourceMap.resourceNodeGroups.reduce((sum, entry) => sum + entry.placements.length, 0), mineralNodes: sourceMap.mineralNodes.length, walkableTiles: walkableCount },
  balanceRows, warnedRows,
  realmBoundary: { qinglinBoss: { level: bossTemplate.level, maxHp: bossStats.maxHp, maxAttack: Math.max(bossStats.physAtk, bossStats.spellAtk) }, goldenCore43Boss: { id: golden?.id ?? 'm_huanling_zhenren', level: golden?.level, maxHp: golden?.maxHp, maxAttack: golden ? Math.max(golden.numericStats.physAtk, golden.numericStats.spellAtk) : null } },
  screenshotAnchors: { entrance: { x: 4, y: 24 }, herbBank: { x: 17, y: 8 }, mineralRidge: { x: 25, y: 30 }, bossPool: { x: 41, y: 24 } },
  tileSamples,
  checks, failures,
};
const outputPath = path.join(root, '.runtime/foundation-expansion/proof.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
