#!/usr/bin/env node
/** 後期七境功法數值驗證：真實正規化、技能公式、Buff 套用與全學累積。無 DB 寫入。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildLateGameEncounters } from './lib/late-game-encounters.mjs';
import { buildLateGameTechniques, LATE_TECHNIQUE_PREFIX } from './lib/late-game-techniques.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const shared = require(path.join(root, 'packages/shared/dist/index.js'));
const { normalizeTechniqueTemplate } = require(path.join(root, 'packages/server/dist/content/content-template-utils.js'));
const { ContentTemplateRepository } = require(path.join(root, 'packages/server/dist/content/content-template.repository.js'));
const { PlayerCombatService } = require(path.join(root, 'packages/server/dist/runtime/combat/player-combat.service.js'));
const { PlayerRuntimeService } = require(path.join(root, 'packages/server/dist/runtime/player/player-runtime.service.js'));
const { PlayerAttributesService } = require(path.join(root, 'packages/server/dist/runtime/player/player-attributes.service.js'));
const { setCombatRngForTesting, resetCombatRngForTesting } = require(path.join(root, 'packages/server/dist/runtime/combat/combat-resolution.helpers.js'));

const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const catalog = read('scripts/lib/late-game-story.json');
const encounters = buildLateGameEncounters(catalog, shared);
const built = buildLateGameTechniques(catalog, encounters, shared);
const normalized = built.techniques.map((template) => normalizeTechniqueTemplate(template));
const byId = new Map(normalized.map((template) => [template?.id, template]));
const EPSILON = 1e-6;
const ATTACK_UNIT = 1_000_000;
const HP_UNIT = 1_000_000;
const ATTR_LIMITS = {
  newRawPerAttribute: 13_000,
  newFinalPerAttribute: 7_500,
  combinedRawPerAttribute: 14_000,
  combinedFinalPerAttribute: 8_000,
  maxPercentPerAttribute: 300,
  endgameFinalAttrRealmBaselineMultiplier: 14,
  endgameCoreStatRealmBaselineMultiplier: 13,
  legacyMarginalMultiplierOverNew: 1.15,
};
const DIVINE_LIMITS = {
  newBurstAttackEquivalent: 60,
  combinedBurstAttackEquivalent: 240,
  combinedAttackEquivalentPerTick: 0.2,
  guardHealMaxHpRatio: 0.36,
  guardHealMaxHpRatioPerTick: 0.0012,
};

assert.equal(built.techniques.length, 56, '必須產出 56 部功法');
assert.equal(built.books.length, 56, '必須產出 56 本功法書');
assert.equal(built.acquisition.length, 56, '每本功法書必須有取得記錄');
assert.equal(new Set(built.techniques.map((entry) => entry.id)).size, 56, '功法 ID 不得重複');
assert.ok(normalized.every(Boolean), '真實 normalizeTechniqueTemplate 不得忽略新功法');

const categories = Object.fromEntries(['internal', 'arts', 'divine', 'secret'].map((category) => [
  category,
  normalized.filter((template) => template.category === category),
]));
for (const [category, techniques] of Object.entries(categories)) {
  assert.equal(techniques.length, 14, `${category} 必須恰有 14 部`);
}

for (const template of normalized) {
  assert.equal(template.layers.length, template.maxLayer, `${template.id} 層數正規化不完整`);
  assert.ok(template.layers.every((layer, index) => layer.level === index + 1), `${template.id} 層級不連續`);
  if (template.category === 'internal') {
    assert.equal(template.skills.length, 0, `${template.id} 內功不得生成主動技能`);
    assert.ok(template.budgetPercent >= 0.85 && template.budgetPercent <= 1, `${template.id} 內功預算比例越界`);
    const expected = shared.calcInternalTechniqueAttrTotalByBudgetPercent(
      template.grade,
      template.realmLv,
      template.budgetPercent,
    );
    const actual = sumTechniqueAttrs(template);
    // 公式總量會按三階段、逐層、逐屬性取整；允許不超過 1% 的離散誤差。
    assert.ok(Math.abs(actual - expected) <= Math.max(3, expected * 0.01), `${template.id} 未沿用內功預算公式`);
  } else {
    assert.equal(template.skills.length, 1, `${template.id} 正規化後必須保留唯一主動技能`);
    assert.equal(template.skills[0].unlockPlayerRealm, undefined, `${template.id} 不得把 realmLv 誤填為 PlayerRealmStage 門檻`);
    assert.ok(Number.isFinite(template.skills[0].cost) && template.skills[0].cost >= 0, `${template.id} 低境使用的既有耗靈公式不得產生負數`);
    if (template.category === 'secret') {
      assert.ok(template.layers.every((layer) => !layer.attrs && !layer.specialStats), `${template.id} 秘術不得提供永久層級屬性`);
      const realmIndex = catalog.realms.findIndex((realm) => template.id.startsWith(`${LATE_TECHNIQUE_PREFIX}${realm.key}_`));
      assert.ok(realmIndex >= 0, `${template.id} 找不到七境索引`);
      for (const effect of template.skills[0].effects) {
        assert.equal(effect.type, 'buff', `${template.id} 秘術只應提供有限期增益`);
        assert.equal(effect.maxStacks, 1, `${template.id} 秘術同族增益只允許一層`);
        for (const forbidden of ['lootRate', 'rareLootRate', 'luck']) {
          assert.equal(effect.stats?.[forbidden], undefined, `${template.id} 秘術不得增加 ${forbidden}`);
        }
        if (effect.buffId === 'lg.manual.wayfinding') {
          const expectedKey = realmIndex % 2 === 0 ? 'viewRange' : 'moveSpeed';
          const expectedValue = realmIndex % 2 === 0 ? 1 + Math.floor(realmIndex / 3) : 1 + Math.floor(realmIndex / 2);
          assert.deepEqual(effect.stats, { [expectedKey]: expectedValue }, `${template.id} 引路成長值錯誤`);
        } else if (effect.buffId === 'lg.manual.breath') {
          assert.deepEqual(effect.stats, { maxQiOutputPerTick: 10 + realmIndex }, `${template.id} 調息成長值錯誤`);
        } else if (effect.buffId === 'lg.manual.contemplation') {
          assert.deepEqual(effect.stats, { techniqueExpRate: 500 + 50 * realmIndex }, `${template.id} 澄心成長值錯誤`);
        } else {
          assert.fail(`${template.id} 使用未知秘術家族 ${effect.buffId}`);
        }
      }
    }
  }
  for (const layer of template.layers) {
    assert.equal(Number(layer.specialStats?.luck ?? 0), 0, `${template.id} 不得給永久幸運`);
  }
}

// 正式內容庫必須讀到實際寫出的書與技能；不可只證明生成器記憶體內資料正確。
const content = new ContentTemplateRepository();
const warnings = [];
content.logger.warn = (message) => warnings.push(String(message));
content.loadAll();
assert.deepEqual(warnings, [], '正式內容載入不得警告或忽略模板');
const diskBooks = read('packages/server/data/content/items/後期七境/功法書.json');
assert.equal(diskBooks.length, 56, '正式功法書檔必須有 56 本');
for (const book of diskBooks) {
  const expected = byId.get(book.learnTechniqueId);
  const loadedBook = content.itemTemplates.get(book.itemId);
  const loadedTechnique = content.techniqueTemplates.get(book.learnTechniqueId);
  assert.ok(expected, `${book.itemId} 指向非本批功法`);
  assert.ok(loadedBook, `正式內容未載入功法書 ${book.itemId}`);
  assert.ok(loadedTechnique, `正式內容未載入功法 ${book.learnTechniqueId}`);
  assert.equal(loadedBook.learnTechniqueId, expected.id, `${book.itemId} 學習目標錯誤`);
  assert.equal(book.learnTechniqueMaxLevel, expected.maxLayer, `${book.itemId} 可學層數錯誤`);
  assert.equal(loadedTechnique.layers.length, expected.maxLayer, `${expected.id} 正式層數錯誤`);
  assert.deepEqual(
    loadedTechnique.skills.map((skill) => skill.id),
    expected.skills.map((skill) => skill.id),
    `${expected.id} 正式載入忽略技能`,
  );
}

// 14 部內功同時滿層的真實軟衰減與最高單項乘區。
const internalStates = categories.internal.map(toTechniqueState);
const legacyInternalStates = [...content.techniqueTemplates.values()]
  .filter((template) => template.category === 'internal' && !template.id.startsWith(LATE_TECHNIQUE_PREFIX))
  .map(toTechniqueState);
const combinedInternalStates = [...legacyInternalStates, ...internalStates];
const rawInternalAttrs = sumStateAttrs(internalStates);
const finalInternalAttrs = shared.calcTechniqueFinalAttrBonus(internalStates);
const maxInternalPercents = shared.calcTechniqueMaxAttrPercentBonus(internalStates);
const combinedRawInternalAttrs = sumStateAttrs(combinedInternalStates);
const combinedFinalInternalAttrs = shared.calcTechniqueFinalAttrBonus(combinedInternalStates);
const specialStats = shared.calcTechniqueFinalSpecialStatBonus(normalized.map(toTechniqueState));
for (const key of shared.ATTR_KEYS) {
  assert.ok(rawInternalAttrs[key] <= ATTR_LIMITS.newRawPerAttribute, `全學新內功 ${key} 原始累積膨脹`);
  assert.ok(finalInternalAttrs[key] <= ATTR_LIMITS.newFinalPerAttribute, `全學新內功 ${key} 軟衰減後膨脹`);
  assert.ok(combinedRawInternalAttrs[key] <= ATTR_LIMITS.combinedRawPerAttribute, `全庫內功 ${key} 原始累積膨脹`);
  assert.ok(combinedFinalInternalAttrs[key] <= ATTR_LIMITS.combinedFinalPerAttribute, `全庫內功 ${key} 軟衰減後膨脹`);
  assert.ok((maxInternalPercents[key] ?? 0) <= ATTR_LIMITS.maxPercentPerAttribute, `全學內功 ${key} 最高單項乘區膨脹`);
}
assert.deepEqual(specialStats, { comprehension: 0, luck: 0 }, '56 部同時滿層不得增加永久悟性或幸運');

// 最高單項乘區取「單本最高值 / 10」，284.5% 並非 14 本相加；再走完整屬性服務衡量角色成長。
const endgameStage = shared.PLAYER_REALM_ORDER.at(-1);
const endgameRealmLv = Math.max(...normalized.map((template) => template.realmLv));
const realmOnlyProjection = projectEndgameAttributes([], endgameStage, endgameRealmLv);
const newInternalProjection = projectEndgameAttributes(internalStates, endgameStage, endgameRealmLv);
const combinedInternalProjection = projectEndgameAttributes(combinedInternalStates, endgameStage, endgameRealmLv);
const endgameFinalAttrMultipliers = {};
const legacyMarginalMultipliers = {};
for (const key of shared.ATTR_KEYS) {
  endgameFinalAttrMultipliers[key] = combinedInternalProjection.finalAttrs[key] / realmOnlyProjection.finalAttrs[key];
  legacyMarginalMultipliers[key] = combinedInternalProjection.finalAttrs[key] / newInternalProjection.finalAttrs[key];
  assert.ok(endgameFinalAttrMultipliers[key] <= ATTR_LIMITS.endgameFinalAttrRealmBaselineMultiplier,
    `全庫內功使終局 ${key} 超過純境界基線 14 倍`);
  assert.ok(legacyMarginalMultipliers[key] <= ATTR_LIMITS.legacyMarginalMultiplierOverNew,
    `舊書加入新內功後使終局 ${key} 額外膨脹超過 15%`);
}
const endgameCoreStatMultipliers = {};
for (const key of Object.keys(realmOnlyProjection.coreStats)) {
  endgameCoreStatMultipliers[key] = combinedInternalProjection.coreStats[key] / realmOnlyProjection.coreStats[key];
  assert.ok(endgameCoreStatMultipliers[key] <= ATTR_LIMITS.endgameCoreStatRealmBaselineMultiplier,
    `全庫內功使終局 ${key} 超過純境界基線 13 倍`);
}

// 金丹新內功不得讓既有築基高階內功立刻失去價值，亦不得長期弱於舊書。
const oldHighInternal = content.techniqueTemplates.get('ningqi_chengji');
assert.ok(oldHighInternal, '缺少既有高階內功凝氣成基法');
const oldHighTotal = sumTechniqueAttrs(oldHighInternal);
const goldenCoreInternals = categories.internal.filter((template) => template.realmLv < catalog.realms[1].startLevel)
  .sort((left, right) => left.realmLv - right.realmLv);
assert.equal(goldenCoreInternals.length, 2, '金丹期應有兩部新內功');
for (const template of goldenCoreInternals) {
  assert.ok(sumTechniqueAttrs(template) >= oldHighTotal * 0.8, `${template.id} 滿層不足舊高階內功八成`);
}
const firstNascentInternal = categories.internal
  .filter((template) => template.realmLv >= catalog.realms[1].startLevel)
  .sort((left, right) => left.realmLv - right.realmLv)[0];
assert.ok(sumTechniqueAttrs(firstNascentInternal) > oldHighTotal, '元嬰首部內功應正式超越既有築基高階內功');

const combat = new PlayerCombatService({});
const techniqueSkillRows = [];
setCombatRngForTesting(() => 0.999999);
try {
  for (const template of normalized.filter((entry) => entry.category !== 'internal')) {
    const skill = template.skills[0];
    const entry = executeSkill(combat, template, skill.unlockLevel, { woundedTarget: true });
    const full = executeSkill(combat, template, template.maxLayer, { woundedTarget: true });
    assert.ok(full.totalRawDamage >= entry.totalRawDamage, `${skill.id} 滿層傷害低於入門層`);
    assert.ok(full.totalHeal >= entry.totalHeal, `${skill.id} 滿層治療低於入門層`);
    assert.ok(full.totalRawDamage > 0 || full.totalHeal > 0 || full.selfBuffs.length > 0 || full.targetBuffs.length > 0,
      `${skill.id} 沒有可執行效果`);
    const output = shared.getTechniqueStandardQiOutputBaseline(template.realmLv);
    const actualQiCost = Math.round(shared.calcQiCostWithOutputLimit(skill.cost, output));
    const plannedOutputRatio = skill.cost / output;
    const actualOutputRatio = actualQiCost / output;
    assert.ok(plannedOutputRatio >= 0.24 && plannedOutputRatio <= 1.201, `${skill.id} 計畫輸出倍率越界`);
    assert.ok(actualOutputRatio <= 1.41, `${skill.id} 每息輸出懲罰後消耗超出 1.41 倍基準`);
    techniqueSkillRows.push({
      techniqueId: template.id,
      skillId: skill.id,
      category: template.category,
      unlockLevel: skill.unlockLevel,
      maxLayer: template.maxLayer,
      cooldown: skill.cooldown,
      windup: skill.playerCast?.windupTicks ?? 0,
      maxTargets: resolveMaxTargets(skill),
      entryAttackEquivalent: entry.totalRawDamage / ATTACK_UNIT,
      fullAttackEquivalent: full.totalRawDamage / ATTACK_UNIT,
      entryHealRatio: entry.totalHeal / HP_UNIT,
      fullHealRatio: full.totalHeal / HP_UNIT,
      plannedOutputRatio,
      actualOutputRatio,
    });
  }
} finally {
  resetCombatRngForTesting();
}

const artsRows = techniqueSkillRows.filter((entry) => entry.category === 'arts');
for (const row of artsRows) {
  assert.ok(row.cooldown >= 6 && row.cooldown <= 18, `${row.skillId} 法術冷卻越界`);
  if (row.maxTargets === 1) {
    const template = byId.get(row.techniqueId);
    const effects = template.skills[0].effects;
    const hasControl = effects.some((effect) => effect.type === 'buff' && effect.target === 'target');
    const hasSelfHeal = effects.some((effect) => effect.type === 'heal');
    const minimum = hasControl ? 2.4 : hasSelfHeal ? 2.8 : 2.7;
    assert.ok(row.fullAttackEquivalent >= minimum - EPSILON && row.fullAttackEquivalent <= 4.2 + EPSILON,
      `${row.skillId} 單體滿層威力越界`);
  } else {
    assert.ok(row.fullAttackEquivalent >= 1.8 - EPSILON && row.fullAttackEquivalent <= 2.4 + EPSILON,
      `${row.skillId} 範圍單體滿層威力越界`);
    assert.ok(row.fullAttackEquivalent * row.maxTargets <= 12 + EPSILON, `${row.skillId} 範圍總威力越界`);
  }
}

const newDivineBurstRows = techniqueSkillRows.filter((row) => row.category === 'divine' && row.windup === 3);
const newDivineGuardRows = techniqueSkillRows.filter((row) => row.category === 'divine' && row.windup === 1);
assert.equal(newDivineBurstRows.length, 7, '應有七部決戰神通');
assert.equal(newDivineGuardRows.length, 7, '應有七部護持神通');
for (const row of newDivineBurstRows) {
  assert.equal(row.cooldown, 600, `${row.skillId} 決戰神通冷卻`);
  assert.ok(row.maxTargets === 1 || row.maxTargets === 5, `${row.skillId} 決戰神通目標數`);
  assert.ok(Math.abs(row.fullAttackEquivalent - (row.maxTargets === 1 ? 12 : 6)) <= EPSILON,
    `${row.skillId} 決戰神通滿層威力`);
}
for (const row of newDivineGuardRows) {
  assert.equal(row.cooldown, 300, `${row.skillId} 護持神通冷卻`);
  assert.ok(row.fullHealRatio <= 0.09 + EPSILON, `${row.skillId} 單次護持治療超過 9%`);
}
const newBurst = sum(newDivineBurstRows, (row) => row.fullAttackEquivalent);
const newBurstPerTick = sum(newDivineBurstRows, (row) => row.fullAttackEquivalent / row.cooldown);
const guardHeal = sum(newDivineGuardRows, (row) => row.fullHealRatio);
const guardHealPerTick = sum(newDivineGuardRows, (row) => row.fullHealRatio / row.cooldown);
assert.ok(newBurst <= DIVINE_LIMITS.newBurstAttackEquivalent + EPSILON, '新神通全輪替瞬間爆發超過 60 倍攻擊');
assert.ok(guardHeal <= DIVINE_LIMITS.guardHealMaxHpRatio + EPSILON, '護持全輪替治療超過 36% 最大生命');
assert.ok(guardHealPerTick <= DIVINE_LIMITS.guardHealMaxHpRatioPerTick + EPSILON, '護持長期治療頻率越界');

const oldDivines = [...content.techniqueTemplates.values()]
  .filter((template) => template.category === 'divine' && !template.id.startsWith(LATE_TECHNIQUE_PREFIX));
assert.equal(oldDivines.length, 2, '既有神通基線數量改變，須重審輪替風險');
setCombatRngForTesting(() => 0.999999);
let oldDivineRows;
try {
  oldDivineRows = oldDivines.map((template) => {
    const skill = template.skills[0];
    const result = executeSkill(combat, template, template.maxLayer, { woundedTarget: true });
    return { id: template.id, attackEquivalent: result.totalRawDamage / ATTACK_UNIT, cooldown: skill.cooldown };
  });
} finally {
  resetCombatRngForTesting();
}
const oldBurst = sum(oldDivineRows, (row) => row.attackEquivalent);
const oldBurstPerTick = sum(oldDivineRows, (row) => row.attackEquivalent / row.cooldown);
const combinedBurst = oldBurst + newBurst;
const combinedBurstPerTick = oldBurstPerTick + newBurstPerTick;
assert.ok(combinedBurst <= DIVINE_LIMITS.combinedBurstAttackEquivalent + EPSILON, '舊新神通全輪替瞬間爆發超過 240 倍攻擊');
assert.ok(combinedBurstPerTick <= DIVINE_LIMITS.combinedAttackEquivalentPerTick + EPSILON,
  '舊新神通全輪替長期輸出超過每息 0.2 倍攻擊');

// 走實際 toTemporaryBuff -> applyTemporaryBuff -> PlayerAttributesService.recalculate，
// 證明同 buffId 跨境只留一層、後施放刷新原型，且技能 Buff 未帶 realmLv 時依現行規則全效。
const buffProof = proveRuntimeBuffs(combat, categories.secret);
const dropBoundary = proveBookDropBoundary(content, built.acquisition[0]);

const result = {
  ok: true,
  techniques: normalized.length,
  books: diskBooks.length,
  categories: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, value.length])),
  internal: {
    oldHighTotal,
    goldenCoreTotals: goldenCoreInternals.map((template) => ({ id: template.id, total: sumTechniqueAttrs(template) })),
    firstNascentTotal: sumTechniqueAttrs(firstNascentInternal),
    rawAttrs: rawInternalAttrs,
    softDecayedAttrs: finalInternalAttrs,
    highestSingleTechniqueAttrPercent: maxInternalPercents,
    legacyCount: legacyInternalStates.length,
    combinedRawAttrs: combinedRawInternalAttrs,
    combinedSoftDecayedAttrs: combinedFinalInternalAttrs,
    endgameRealmOnlyFinalAttrs: realmOnlyProjection.finalAttrs,
    endgameCombinedFinalAttrs: combinedInternalProjection.finalAttrs,
    endgameFinalAttrRealmBaselineMultipliers: endgameFinalAttrMultipliers,
    endgameCoreStatRealmBaselineMultipliers: endgameCoreStatMultipliers,
    legacyMarginalMultipliersOverNew: legacyMarginalMultipliers,
    caps: ATTR_LIMITS,
  },
  skillCosts: {
    maxPlannedOutputRatio: Math.max(...techniqueSkillRows.map((row) => row.plannedOutputRatio)),
    maxActualOutputRatio: Math.max(...techniqueSkillRows.map((row) => row.actualOutputRatio)),
  },
  divineRotation: {
    newBurst,
    oldBurst,
    combinedBurst,
    newAttackEquivalentPerTick: newBurstPerTick,
    oldAttackEquivalentPerTick: oldBurstPerTick,
    combinedAttackEquivalentPerTick: combinedBurstPerTick,
    guardHealMaxHpRatio: guardHeal,
    guardHealMaxHpRatioPerTick: guardHealPerTick,
    caps: DIVINE_LIMITS,
  },
  buffs: buffProof,
  dropBoundary,
  skillRows: techniqueSkillRows,
  databaseWrites: 0,
};
fs.mkdirSync(path.join(root, '.runtime/late-game'), { recursive: true });
fs.writeFileSync(path.join(root, '.runtime/late-game/technique-balance-proof.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

function toTechniqueState(template) {
  return { techId: template.id, grade: template.grade, level: template.layers.length, layers: template.layers };
}

function sumTechniqueAttrs(template) {
  return Object.values(shared.calcTechniqueAttrValues(template.layers.length, template.layers))
    .reduce((total, value) => total + Number(value ?? 0), 0);
}

function sumStateAttrs(states) {
  const result = Object.fromEntries(shared.ATTR_KEYS.map((key) => [key, 0]));
  for (const state of states) {
    const attrs = shared.calcTechniqueAttrValues(state.level, state.layers);
    for (const key of shared.ATTR_KEYS) result[key] += Number(attrs[key] ?? 0);
  }
  return result;
}

function sum(entries, selector) {
  return entries.reduce((total, entry) => total + selector(entry), 0);
}

function projectEndgameAttributes(techniques, stage, realmLv) {
  const attributes = new PlayerAttributesService();
  const player = createProjectionPlayer(attributes, realmLv);
  player.realm.stage = stage;
  player.techniques = { revision: 1, techniques };
  attributes.recalculate(player, 'initialization');
  return {
    finalAttrs: { ...player.attrs.finalAttrs },
    coreStats: Object.fromEntries(['maxHp', 'maxQi', 'physAtk', 'spellAtk', 'physDef', 'spellDef']
      .map((key) => [key, player.attrs.numericStats[key]])),
  };
}

function proveBookDropBoundary(contentRepository, acquisition) {
  const source = acquisition.sources[0];
  assert.ok(source && source.chance > 0 && source.chance < 1, '缺少可驗證的功法書掉落來源');
  const hasBook = (items) => items.some((item) => item.itemId === acquisition.bookId);
  const withRandom = (value, callback) => {
    const original = Math.random;
    Math.random = () => value;
    try {
      return callback();
    } finally {
      Math.random = original;
    }
  };
  const epsilon = Math.min(1e-9, source.chance / 2);
  assert.equal(withRandom(source.chance - epsilon, () => hasBook(contentRepository.rollMonsterDrops(source.monsterId))), true,
    '固定亂數低於基礎機率時應命中功法書');
  assert.equal(withRandom(source.chance + epsilon, () => hasBook(contentRepository.rollMonsterDrops(source.monsterId))), false,
    '固定亂數高於基礎機率時不應命中功法書');
  const currentWorldChance = 1 - ((1 - source.chance) ** 2);
  assert.equal(withRandom(currentWorldChance - epsilon,
    () => hasBook(contentRepository.rollMonsterDrops(source.monsterId, 1, 0, 0, {}, 2))), true,
  '兩倍擊殺等價的現世掉率下界應命中功法書');
  assert.equal(withRandom(currentWorldChance + epsilon,
    () => hasBook(contentRepository.rollMonsterDrops(source.monsterId, 1, 0, 0, {}, 2))), false,
  '兩倍擊殺等價的現世掉率上界不應命中功法書');
  return {
    bookId: acquisition.bookId,
    monsterId: source.monsterId,
    baseChance: source.chance,
    currentWorldChance,
    randomRestored: true,
  };
}

function resolveMaxTargets(skill) {
  return Math.max(1, Math.round(Number(skill.targeting?.maxTargets ?? 1) || 1));
}

function makeCombatant(realmLv, { target = false, wounded = false } = {}) {
  const template = shared.PLAYER_REALM_NUMERIC_TEMPLATES[shared.DEFAULT_PLAYER_REALM_STAGE];
  const numericStats = shared.cloneNumericStats(template.stats);
  Object.assign(numericStats, {
    maxHp: HP_UNIT,
    maxQi: 1_000_000_000_000_000,
    physAtk: target ? 0 : ATTACK_UNIT,
    spellAtk: target ? 0 : ATTACK_UNIT,
    physDef: 0,
    spellDef: 0,
    hit: target ? 0 : 1_000_000_000_000_000,
    dodge: 0,
    crit: 0,
    antiCrit: 1_000_000_000_000_000,
    breakPower: 0,
    resolvePower: target ? 0 : 1_000_000_000_000_000,
    maxQiOutputPerTick: 1_000_000_000_000_000,
  });
  for (const element of shared.ELEMENT_KEYS) {
    numericStats.elementDamageBonus[element] = 0;
    numericStats.elementDamageReduce[element] = 0;
  }
  return {
    playerId: target ? 'proof:target' : 'proof:attacker',
    hp: wounded ? 1 : HP_UNIT,
    maxHp: HP_UNIT,
    qi: 1_000_000_000_000_000,
    maxQi: 1_000_000_000_000_000,
    combatAttackIntensity: 10,
    realm: { realmLv },
    combatExp: 1_000_000_000_000_000,
    attrs: { numericStats, ratioDivisors: shared.cloneNumericRatioDivisors(template.ratioDivisors), revision: 1 },
    buffs: { buffs: [], revision: 0 },
    techniques: { techniques: [] },
    combat: { cooldownReadyTickBySkillId: {} },
    craftSkills: {},
  };
}

function executeSkill(service, template, level, { woundedTarget = false, handlers = {} } = {}) {
  const skill = template.skills[0];
  return service.executeResolvedSkillCast(
    makeCombatant(template.realmLv),
    makeCombatant(template.realmLv, { target: true, wounded: woundedTarget }),
    { skill, level, readyTick: 0 },
    1,
    skill.range,
    handlers,
    {
      skipResourceAndCooldown: true,
      skipRangeValidation: true,
      targetCount: resolveMaxTargets(skill),
    },
  );
}

function createProjectionPlayer(attributes, realmLv = 125) {
  return {
    playerId: 'proof:buff-player',
    persistentRevision: 1,
    selfRevision: 1,
    luck: 0,
    fengShuiLuck: 0,
    realm: { stage: shared.DEFAULT_PLAYER_REALM_STAGE, realmLv },
    hp: 100,
    maxHp: 100,
    qi: 0,
    maxQi: 0,
    attrs: attributes.createInitialState(),
    equipment: { revision: 1, slots: [] },
    techniques: { revision: 1, techniques: [], cultivatingTechId: null },
    buffs: { revision: 1, buffs: [] },
    runtimeBonuses: [],
    bodyTraining: { level: 0, exp: 0, expToNext: 0 },
    combat: { cultivationActive: false },
    spiritualRoots: null,
    dirtyDomains: new Set(),
  };
}

function proveRuntimeBuffs(service, secretTechniques) {
  const findByBuff = (buffId, stat) => secretTechniques.find((template) => {
    const effect = template.skills[0].effects.find((candidate) => candidate.type === 'buff' && candidate.buffId === buffId);
    return effect?.stats?.[stat] !== undefined;
  });
  const view = findByBuff('lg.manual.wayfinding', 'viewRange');
  const move = findByBuff('lg.manual.wayfinding', 'moveSpeed');
  const breath = findByBuff('lg.manual.breath', 'maxQiOutputPerTick');
  const contemplation = findByBuff('lg.manual.contemplation', 'techniqueExpRate');
  assert.ok(view && move && breath && contemplation, '缺少秘術 buff 測試樣本');

  const attributes = new PlayerAttributesService();
  const player = createProjectionPlayer(attributes);
  attributes.recalculate(player, 'initialization');
  const runtime = {
    getPlayerOrThrow: (playerId) => {
      assert.equal(playerId, player.playerId);
      return player;
    },
    playerAttributesService: attributes,
    bumpPersistentRevision: (target) => { target.persistentRevision += 1; },
  };
  const apply = (buff) => PlayerRuntimeService.prototype.applyTemporaryBuff.call(runtime, player.playerId, buff);
  const cast = (template) => executeSkill(service, template, template.maxLayer, { handlers: { applySelfBuff: apply } });
  const baseline = { ...player.attrs.numericStats };

  cast(view);
  assert.equal(player.buffs.buffs.length, 1, '同族引路首次施放應只有一個 buff');
  assert.equal(player.buffs.buffs[0].realmLv, undefined, '技能 buff 不應虛構來源境界');
  assert.equal(player.attrs.numericStats.viewRange - baseline.viewRange, 1, 'flat viewRange:1 必須實際增加一格');
  const viewSource = player.buffs.buffs[0].sourceSkillId;

  cast(move);
  assert.equal(player.buffs.buffs.length, 1, '同 buffId 跨境施放不得堆疊');
  assert.equal(player.buffs.buffs[0].stacks, 1, 'maxStacks:1 必須維持一層');
  assert.notEqual(player.buffs.buffs[0].sourceSkillId, viewSource, '後施放技能必須刷新 buff 原型');
  assert.equal(player.buffs.buffs[0].sourceSkillId, move.skills[0].id, '後施放引路必須成為現行來源');
  assert.equal(player.buffs.buffs[0].realmLv, undefined, '跨境刷新後技能 buff 仍應沿用無境界全效規則');
  assert.equal(player.attrs.numericStats.viewRange, baseline.viewRange, '跨境互斥後舊視野效果必須移除');
  assert.equal(player.attrs.numericStats.moveSpeed - baseline.moveSpeed, 1, 'flat moveSpeed:1 必須實際增加一點');

  const proveIndependent = (template, stat, expected) => {
    player.buffs.buffs.length = 0;
    player.buffs.revision += 1;
    attributes.recalculate(player, 'buff');
    const before = player.attrs.numericStats[stat];
    cast(template);
    const after = player.attrs.numericStats[stat];
    assert.equal(player.buffs.buffs[0].realmLv, undefined, `${template.id} 技能 buff 應為無境界全效`);
    expected(before, after);
    return { before, after };
  };
  const contemplationStats = proveIndependent(contemplation, 'techniqueExpRate', (before, after) => {
    const expected = contemplation.skills[0].effects[0].stats.techniqueExpRate;
    assert.equal(after - before, expected, 'flat techniqueExpRate 應依境界增加對應萬分比');
  });
  const breathStats = proveIndependent(breath, 'maxQiOutputPerTick', (before, after) => {
    const expected = 1 + breath.skills[0].effects[0].stats.maxQiOutputPerTick / 100;
    assert.ok(Math.abs(after / before - expected) <= 0.001, 'percent maxQiOutputPerTick 應依境界增加對應百分比');
  });

  player.buffs.buffs.length = 0;
  player.buffs.revision += 1;
  attributes.recalculate(player, 'buff');
  const allBaseline = { ...player.attrs.numericStats };
  for (const template of secretTechniques) cast(template);
  assert.deepEqual(
    player.buffs.buffs.map((buff) => buff.buffId).sort(),
    ['lg.manual.breath', 'lg.manual.contemplation', 'lg.manual.wayfinding'],
    '14 部秘術輪替後應只保留三個互斥家族',
  );
  assert.ok(player.buffs.buffs.every((buff) => buff.stacks === 1 && buff.maxStacks === 1), '秘術全輪替不得累積層數');
  assert.ok(Math.abs(player.attrs.numericStats.maxQiOutputPerTick / allBaseline.maxQiOutputPerTick - 1.16) <= 0.001,
    '秘術全輪替的每息輸出增益不得超過一成六');
  assert.equal(player.attrs.numericStats.techniqueExpRate - allBaseline.techniqueExpRate, 750,
    '秘術全輪替的修煉增益不得超過七點五個百分點');
  assert.ok((player.attrs.numericStats.viewRange - allBaseline.viewRange === 3
      && player.attrs.numericStats.moveSpeed === allBaseline.moveSpeed)
    || (player.attrs.numericStats.moveSpeed - allBaseline.moveSpeed === 3
      && player.attrs.numericStats.viewRange === allBaseline.viewRange),
  '引路家族全輪替後只能保留視野或移速其一');
  return {
    sameIdMutualExclusion: true,
    simultaneousFamilies: player.buffs.buffs.length,
    maxStacks: Math.max(...player.buffs.buffs.map((buff) => buff.maxStacks)),
    skillBuffRealmLv: player.buffs.buffs.find((buff) => buff.realmLv !== undefined)?.realmLv ?? null,
    viewRangeFlatDelta: 1,
    moveSpeedFlatDelta: 1,
    techniqueExpRateFlatDelta: contemplationStats.after - contemplationStats.before,
    maxQiOutputMultiplier: breathStats.after / breathStats.before,
    simultaneousTechniqueExpRateFlatDelta: player.attrs.numericStats.techniqueExpRate - allBaseline.techniqueExpRate,
    simultaneousMaxQiOutputMultiplier: player.attrs.numericStats.maxQiOutputPerTick / allBaseline.maxQiOutputPerTick,
    simultaneousWayfindingDelta: Math.max(
      player.attrs.numericStats.viewRange - allBaseline.viewRange,
      player.attrs.numericStats.moveSpeed - allBaseline.moveSpeed,
    ),
  };
}
