import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildLateGameEncounters } from './late-game-encounters.mjs';

const require = createRequire(import.meta.url);
const story = require('./late-game-story.json');
const playerBaselines = require('../../packages/shared/src/constants/gameplay/player-final-attr-baselines.json');
const shared = require('../../packages/shared/dist/index.js');
const { resolveCombatDamage } = require('../../packages/server/dist/runtime/combat/combat-pipeline-compose.js');

const SAMPLE_COUNT = 2_000;
const CHECKPOINTS = [
  { monsterLevel: 43, role: 'normal' },
  { monsterLevel: 54, playerLevel: 52, role: 'boss' },
  { monsterLevel: 55, role: 'normal' },
  { monsterLevel: 78, playerLevel: 76, role: 'boss' },
  { monsterLevel: 102, playerLevel: 100, role: 'boss' },
  { monsterLevel: 126, playerLevel: 124, role: 'boss' },
];

const generated = buildLateGameEncounters(story, shared);
const exactPlayerStats = new Map(playerBaselines.levels.map((entry) => [entry.realmLv, entry.stats]));
const level78Stats = exactPlayerStats.get(78);
const level78Output = level78Stats.maxQiOutputPerTick;
const maps = story.realms.flatMap((realm) => realm.maps);
const itemById = new Map(generated.items.map((item) => [item.itemId, item]));
const failures = [];

function extrapolatePlayerStats(level) {
  const exact = exactPlayerStats.get(level);
  if (exact) return structuredClone(exact);
  const output = shared.getTechniqueStandardQiOutputBaseline(level);
  const scale = (key) => level78Stats[key] / level78Output * output;
  return {
    maxHp: shared.getTechniqueStandardMaxHpBaseline(level),
    maxQi: shared.getTechniqueStandardMaxQiBaseline(level),
    physAtk: scale('physAtk'), spellAtk: scale('spellAtk'),
    physDef: scale('physDef'), spellDef: scale('spellDef'),
    hit: scale('hit'), dodge: scale('dodge'), crit: scale('crit'), antiCrit: scale('antiCrit'),
    breakPower: scale('breakPower'), resolvePower: scale('resolvePower'),
    maxQiOutputPerTick: output,
    hpRegenRate: shared.getTechniqueStandardMaxHpBaseline(level) * level78Stats.hpRegenRate / level78Stats.maxHp,
    qiRegenRate: shared.getTechniqueStandardMaxQiBaseline(level) * level78Stats.qiRegenRate / level78Stats.maxQi,
  };
}

function applyCraftedEquipment(stats, mapContent) {
  const equipment = mapContent.equipmentIds.map((itemId) => itemById.get(itemId));
  const equipped = [
    equipment.find((item) => item.equipSlot === 'weapon' && item.itemId.endsWith('_war_blade')),
    ...equipment.filter((item) => item.equipSlot !== 'weapon'),
  ];
  for (const item of equipped) {
    const effectiveness = shared.getEquipmentRealmEffectiveness(stats.realmLv, item.level);
    const actual = shared.compileEquipmentBaselinePercentsToActualStats(item.equipBaselinePercents, {
      grade: item.grade,
      level: item.level,
    }) ?? {};
    for (const [key, value] of Object.entries(actual)) {
      if (typeof value === 'number') stats[key] = (stats[key] ?? 0) + value * effectiveness;
    }
  }
  return stats;
}

function averageDamage(input) {
  let totalDamage = 0;
  let hits = 0;
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const outcome = resolveCombatDamage(input);
    totalDamage += outcome.damage;
    if (outcome.hit) hits += 1;
  }
  return { damage: totalDamage / SAMPLE_COUNT, hitRate: hits / SAMPLE_COUNT };
}

function percentileSummary(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: Number(sorted[0].toFixed(2)),
    median: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
    max: Number(sorted.at(-1).toFixed(2)),
  };
}

function assertRange(label, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    failures.push(`${label}: ${value.toFixed(3)} 不在 ${min}..${max}`);
  }
}

function resolveSkillDamageBase(skill, monsterStats) {
  const effect = skill.effects.find((entry) => entry.type === 'damage');
  if (!effect || effect.formula?.op !== 'mul' || !Array.isArray(effect.formula.args)) return null;
  const stat = effect.damageKind === 'spell' ? 'spellAtk' : 'physAtk';
  const scale = Number(effect.formula.args[0]?.scale);
  if (!Number.isFinite(scale)) return null;
  return { damageKind: effect.damageKind, baseDamage: monsterStats[stat] * scale * 1.01 };
}

const roleRows = { normal: [], elite: [], boss: [] };
const warnedSkillPercents = [];
let maxSkillQiRatio = 0;
let worstHealRecoveryShare = 0;

for (const map of maps) {
  const mapContent = generated.mapContent[map.id];
  const playerStats = extrapolatePlayerStats(map.startLevel);
  playerStats.realmLv = map.startLevel;
  applyCraftedEquipment(playerStats, mapContent);
  const regularMonsters = mapContent.monsterIds.map((monsterId) => generated.monsters.find((monster) => monster.id === monsterId));
  const encounters = [
    ['normal', regularMonsters[0]],
    ['elite', regularMonsters.at(-1)],
    ['boss', generated.monsters.find((monster) => monster.id === mapContent.bossId)],
  ];
  for (const [role, monster] of encounters) {
    const monsterStats = shared.resolveMonsterTemplateRecord(monster).computedStats;
    const playerAttack = averageDamage({
      attackerStats: playerStats, attackerRatios: {}, attackerRealmLv: map.startLevel,
      targetStats: monsterStats, targetRatios: {}, targetRealmLv: monster.level,
      baseDamage: playerStats.physAtk, damageKind: 'physical',
    });
    const monsterBasic = averageDamage({
      attackerStats: monsterStats, attackerRatios: {}, attackerRealmLv: monster.level,
      targetStats: playerStats, targetRatios: {}, targetRealmLv: map.startLevel,
      baseDamage: monsterStats.physAtk, damageKind: 'physical',
    });
    const technique = role === 'boss'
      ? generated.techniques.find((entry) => monster.skills.includes(entry.skills[0].id))
      : null;
    const hasHeal = technique?.skills.some((skill) => skill.effects.some((effect) => effect.type === 'heal')) ?? false;
    const recoveryPerTick = monsterStats.hpRegenRate + (hasHeal ? monsterStats.maxHp * 0.006 / 70 : 0);
    const soloNetDps = playerAttack.damage - recoveryPerTick;
    const partyNetDps = playerAttack.damage * 5 - recoveryPerTick;
    const row = {
      mapId: map.id, monsterId: monster.id, playerLevel: map.startLevel, monsterLevel: monster.level,
      role, hpRatio: monsterStats.maxHp / playerStats.maxHp,
      playerHitRate: playerAttack.hitRate,
      oneAttackPerTickSoloEstimateTicks: monsterStats.maxHp / Math.max(1, soloNetDps),
      oneAttackPerTickParty5EstimateTicks: monsterStats.maxHp / Math.max(1, partyNetDps),
      monsterBasicDamagePercent: monsterBasic.damage / playerStats.maxHp * 100,
      passiveRegenPercent: monsterStats.hpRegenRate / monsterStats.maxHp * 100,
      moveSpeed: monsterStats.moveSpeed,
    };
    roleRows[role].push(row);
    assertRange(`${monster.id} moveSpeed`, monsterStats.moveSpeed, 90, 110);
    if (role === 'normal') assertRange(`${monster.id} 每息一擊模型`, row.oneAttackPerTickSoloEstimateTicks, 8, 20);
    if (role === 'elite') assertRange(`${monster.id} 每息一擊模型`, row.oneAttackPerTickSoloEstimateTicks, 25, 60);
    if (role === 'boss') {
      assertRange(`${monster.id} 單人每息一擊模型`, row.oneAttackPerTickSoloEstimateTicks, 120, 300);
      assertRange(`${monster.id} 五人每息一擊模型`, row.oneAttackPerTickParty5EstimateTicks, 30, 90);
      assertRange(`${monster.id} basic damage`, row.monsterBasicDamagePercent, 2, 4.5);
      if (soloNetDps <= 0) failures.push(`${monster.id} 單人輸出無法突破回血`);
      worstHealRecoveryShare = Math.max(worstHealRecoveryShare, recoveryPerTick / playerAttack.damage);
      for (const skill of technique.skills) {
        maxSkillQiRatio = Math.max(maxSkillQiRatio, skill.cost / monsterStats.maxQi);
        if (!skill.monsterCast) continue;
        const damageBase = resolveSkillDamageBase(skill, monsterStats);
        if (!damageBase) continue;
        const warnedDamage = averageDamage({
          attackerStats: monsterStats, attackerRatios: {}, attackerRealmLv: monster.level,
          targetStats: playerStats, targetRatios: {}, targetRealmLv: map.startLevel,
          ...damageBase,
        }).damage / playerStats.maxHp * 100;
        warnedSkillPercents.push(warnedDamage);
        assertRange(`${skill.id} warned damage`, warnedDamage, 8, 18);
      }
    }
  }
}

assertRange('最大技能耗靈比例', maxSkillQiRatio, 0, 0.35);
assertRange('最差回血/單人輸出比例', worstHealRecoveryShare, 0, 0.25);

const checkpointRows = CHECKPOINTS.map((point) => {
  const source = roleRows[point.role].find((row) => row.monsterLevel === point.monsterLevel && row.playerLevel === (point.playerLevel ?? point.monsterLevel));
  if (!source) failures.push(`缺少 ${point.monsterLevel} 級 ${point.role} 檢查點`);
  return source;
});
const report = {
  ok: failures.length === 0,
  sampleCountPerDirection: SAMPLE_COUNT,
  assumptions: [
    '伺服器世界 tick 為 1Hz；玩家待執行指令每次 tick 每人只取隊首，玩家普攻本身 cooldownTicks 為 0。',
    '擊殺時間欄位是假設每位玩家不中斷、每息成功送達一次普攻的歸一化 tick 預估；未模擬移動、技能輪替、控制、延遲與操作空窗。',
    '頭目普攻與預警招百分比是單次命中管線的平均傷害，不是按怪物普攻 2 tick 冷卻與技能 AI 輪替換算的長期 DPS。',
    '玩家裝備該地圖一把物理武器與四件防具；裝備高玩家 2 級，逐件乘 getEquipmentRealmEffectiveness 的 0.9025。',
    '79–126 級玩家屬性以 shared 標準 HP/Qi/輸出函式，延續 78 級最終屬性比例外推；需由真人長期戰鬥資料再校正。',
  ],
  counts: {
    items: generated.items.length, monsters: generated.monsters.length, techniques: generated.techniques.length,
    skills: generated.techniques.reduce((total, technique) => total + technique.skills.length, 0),
    forgingRecipes: generated.forging.length, alchemyRecipes: generated.alchemy.length,
  },
  ranges: {
    normalOneAttackPerTickSoloEstimateTicks: percentileSummary(roleRows.normal.map((row) => row.oneAttackPerTickSoloEstimateTicks)),
    eliteOneAttackPerTickSoloEstimateTicks: percentileSummary(roleRows.elite.map((row) => row.oneAttackPerTickSoloEstimateTicks)),
    bossOneAttackPerTickSoloEstimateTicks: percentileSummary(roleRows.boss.map((row) => row.oneAttackPerTickSoloEstimateTicks)),
    bossOneAttackPerTickParty5EstimateTicks: percentileSummary(roleRows.boss.map((row) => row.oneAttackPerTickParty5EstimateTicks)),
    bossBasicDamagePercent: percentileSummary(roleRows.boss.map((row) => row.monsterBasicDamagePercent)),
    warnedSkillDamagePercent: percentileSummary(warnedSkillPercents),
    maxSkillQiRatio: Number(maxSkillQiRatio.toFixed(4)),
    worstHealRecoveryShare: Number(worstHealRecoveryShare.toFixed(4)),
  },
  checkpoints: checkpointRows,
  failures,
};

const outputPath = path.resolve('.runtime', 'late-game', 'balance-proof.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
