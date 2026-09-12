/** 築基三圖功法內容與定向掉落；只生成本批 foundation_manual_* 資料。 */
export const FOUNDATION_TECHNIQUE_PREFIX = 'foundation_manual_';
const LEGACY_BOOK_DROPS = [
  { file: '焚木荒台.json', monsterId: 'm_blazewood_king', itemId: 'book.ningqi_chengji', name: '《凝氣成基法》', chance: 0.01 },
  { file: '玄壤深渊.json', monsterId: 'm_darksoil_dragon', itemId: 'book.xuesha_huanling_jue', name: '《血煞喚靈決》', chance: 0.03 },
  { file: '玄壤深渊.json', monsterId: 'm_fivephase_devourer', itemId: 'book.xuesha_huanling_jue', name: '《血煞喚靈決》', chance: 0.03 },
];

const MANUALS = [
  ['冰鱗凝脈經', 'internal', 31, 'mystic', '霜刃渊', { constitution: 5, meridians: 3, spirit: 2 }, 0.8],
  ['霜刃穿雲訣', 'arts', 32, 'mystic', '霜刃渊'],
  ['寒淵觀隙錄', 'secret', 33, 'mystic', '霜刃渊'],
  ['玄龜護元章', 'divine', 34, 'mystic', '霜刃渊'],
  ['焚木回春篇', 'internal', 35, 'mystic', '焚木荒台', { constitution: 4, spirit: 3, meridians: 3 }, 0.84],
  ['藤火纏枝訣', 'arts', 36, 'mystic', '焚木荒台'],
  ['燼息調元法', 'secret', 37, 'mystic', '焚木荒台'],
  ['焚林照夜印', 'divine', 38, 'mystic', '焚木荒台'],
  ['玄壤鎮嶽經', 'internal', 39, 'earth', '玄壤深渊', { constitution: 5, strength: 3, meridians: 2 }, 0.9],
  ['裂地迴鋒式', 'arts', 40, 'earth', '玄壤深渊'],
  ['五脈歸流錄', 'secret', 41, 'earth', '玄壤深渊'],
  ['五行鎮脈印', 'divine', 42, 'earth', '玄壤深渊'],
];
const PLAYER_DESCRIPTIONS = [
  '霜刃淵寒鱗一脈的內功，偏重體魄、經脈與神識的穩固。',
  '引霜成刃的遠距法術，命中後可短暫壓低敵手移速。',
  '觀察寒淵氣隙的行旅秘術，可在危險地形中拓展視野。',
  '借玄龜厚甲護住元氣的護持神通，適合承受危急一擊。',
  '焚木荒臺留傳的回春內功，兼顧體魄、神識與經脈。',
  '以藤火纏住敵手的法術，犧牲部分傷害換取短暫控場。',
  '收束燼火餘息的調元秘術，適合短時間強化靈力輸出。',
  '以焚林火光照破夜幕的清場神通，需蓄勢後才可施展。',
  '玄壤深淵鎮嶽一脈的內功，偏重體魄、力道與經脈。',
  '借地脈反震回斬的近距法術，可把物防轉為部分殺傷。',
  '調和五脈靈流的修持秘術，可短暫提高功法修煉收益。',
  '鎮住五行衝脈的護持神通，適合在長戰中維持防線。',
];
const MAPS = {
  '霜刃渊': { displayName: '霜刃淵', file: '霜刃渊.json', mapId: 'frostblade_abyss', maxLayer: 12, monsters: ['m_frost_scale_serpent', 'm_cold_iron_scorpion', 'm_ice_crystal_spider', 'm_ironshell_turtle'] },
  '焚木荒台': { displayName: '焚木荒臺', file: '焚木荒台.json', mapId: 'blazewood_waste', maxLayer: 14, monsters: ['m_flame_tail_fox', 'm_charwood_walker', 'm_blaze_lizard', 'm_vine_flame_serpent', 'm_blazewood_king'] },
  '玄壤深渊': { displayName: '玄壤深淵', file: '玄壤深渊.json', mapId: 'darksoil_abyss', maxLayer: 16, monsters: ['m_darksoil_beetle', 'm_earthsplit_centipede', 'm_mixed_stone_toad', 'm_darksoil_dragon', 'm_fivephase_devourer'] },
};
const LABELS = { internal: '內功', arts: '法術', secret: '秘術', divine: '神通' };
const v = (name, scale = 1) => ({ var: name, scale });
const op = (name, ...args) => ({ op: name, args });
const scaled = (basis, maxLayer) => op('mul', basis, op('add', 0.6, v('techLevel', 0.4 / maxLayer)));
const damage = (formula, damageKind, element) => ({ type: 'damage', damageKind, element, formula });
const buff = (buffId, name, stats, duration, statMode = 'flat', target = 'self') => ({
  type: 'buff', target, buffId, name, category: target === 'target' ? 'debuff' : 'buff', visibility: 'public',
  duration, stacks: 1, maxStacks: 1, stats, statMode,
});

function makeSkill(template, shared, suffix, data) {
  const baseline = shared.getTechniqueStandardQiOutputBaseline(template.realmLv);
  const unit = shared.calculateTechniqueSkillQiCost(1, template.grade, template.realmLv);
  const costMultiplier = Number((baseline * data.outputRatio / unit).toFixed(6));
  return { id: `skill.${template.id}.${suffix}`, name: data.name, desc: data.desc, cooldown: data.cooldown,
    costMultiplier, cost: shared.calculateTechniqueSkillQiCost(costMultiplier, template.grade, template.realmLv),
    range: data.range ?? 0, ...(data.targeting ? { targeting: data.targeting } : {}),
    requiresTarget: (data.range ?? 0) > 0, effects: data.effects, unlockLevel: data.unlockLevel ?? 1,
    ...(data.windup ? { playerCast: { windupTicks: data.windup, warningColor: '#80a9c7' } } : {}) };
}

function addSkill(template, shared) {
  const max = template.maxLayer;
  if (template.id.endsWith('_2')) {
    template.skills = [makeSkill(template, shared, 'cast', { name: '霜刃穿雲', desc: '遠距冰行點殺，並短暫減慢目標；同類寒滯不疊加。', cooldown: 8, outputRatio: 0.52, range: 5,
      targeting: { shape: 'single', maxTargets: 1 }, effects: [damage(scaled(v('caster.stat.spellAtk', 3.1), max), 'spell', 'water'), buff('foundation.frost_slow', '寒滯', { moveSpeed: -20 }, 3, 'percent', 'target')] })];
  } else if (template.id.endsWith('_6')) {
    template.skills = [makeSkill(template, shared, 'cast', { name: '藤火纏枝', desc: '藤火束縛單一敵手，短暫限制移速，以有限控場換取較低傷害。', cooldown: 10, outputRatio: 0.58, range: 4,
      targeting: { shape: 'single', maxTargets: 1 }, effects: [damage(scaled(v('caster.stat.spellAtk', 2.8), max), 'spell', 'fire'), buff('foundation.root_bind', '藤火纏身', { moveSpeed: -45 }, 2, 'percent', 'target')] })];
  } else if (template.id.endsWith('_10')) {
    template.skills = [makeSkill(template, shared, 'cast', { name: '裂地迴鋒', desc: '以迴鋒借地脈反震，物理點殺可從自身物防取得部分威力。', cooldown: 9, outputRatio: 0.56, range: 3,
      targeting: { shape: 'single', maxTargets: 1 }, effects: [damage(scaled(op('add', v('caster.stat.physAtk', 2.7), op('min', v('caster.stat.physDef', 0.55), v('caster.stat.physAtk', 0.55))), max), 'physical', 'earth')] })];
  } else if (template.id.endsWith('_4')) {
    template.skills = [makeSkill(template, shared, 'guard', { name: '玄龜護元', desc: '長冷卻護持，回復少量生命並提升雙防；與後期護持神通共用狀態。', cooldown: 240, outputRatio: 0.7, windup: 1,
      effects: [{ type: 'heal', target: 'self', formula: scaled(v('caster.maxHp', 0.05), max) }, buff('lg.manual.divine_guard', '七境護持', { physDef: 12, spellDef: 12 }, 10, 'percent')] })];
  } else if (template.id.endsWith('_8')) {
    template.skills = [makeSkill(template, shared, 'manifest', { name: '焚林照夜', desc: '蓄勢兩息後焚照落點周圍，長冷卻的清場神通。', cooldown: 420, outputRatio: 1.05, range: 5, windup: 2,
      targeting: { shape: 'area', radius: 1, maxTargets: 3 }, effects: [damage(scaled(v('caster.stat.spellAtk', 4.4), max), 'spell', 'fire')], unlockLevel: Math.ceil(max * 2 / 3) })];
  } else if (template.id.endsWith('_12')) {
    template.skills = [makeSkill(template, shared, 'guard', { name: '五行鎮脈', desc: '長冷卻鎮脈護持，提升雙防與抗暴；與後期護持神通共用狀態。', cooldown: 300, outputRatio: 0.82, windup: 1,
      effects: [buff('lg.manual.divine_guard', '七境護持', { physDef: 16, spellDef: 16, antiCrit: 12 }, 12, 'percent')], unlockLevel: Math.ceil(max / 3) })];
  } else if (template.id.endsWith('_3')) {
    template.skills = [makeSkill(template, shared, 'invoke', { name: '寒淵觀隙', desc: '短暫拓展視野，與後期引路秘術互斥，避免跨境疊加。', cooldown: 120, outputRatio: 0.22,
      effects: [buff('lg.manual.wayfinding', '七境引路', { viewRange: 1 }, 45)] })];
  } else if (template.id.endsWith('_7')) {
    template.skills = [makeSkill(template, shared, 'invoke', { name: '燼息調元', desc: '短暫提高靈力輸出，與後期調息秘術互斥，適合施法窗口。', cooldown: 180, outputRatio: 0.35,
      effects: [buff('lg.manual.breath', '七境調息', { maxQiOutputPerTick: 8 }, 18, 'percent')] })];
  } else if (template.id.endsWith('_11')) {
    template.skills = [makeSkill(template, shared, 'invoke', { name: '五脈歸流', desc: '短暫提升修煉經驗與領悟速度，與後期澄心秘術互斥。', cooldown: 240, outputRatio: 0.3,
      effects: [buff('lg.manual.contemplation', '七境澄心', { techniqueExpRate: 400 }, 50)] })];
  }
}

export function buildFoundationTechniques(shared) {
  const techniques = MANUALS.map(([name, category, realmLv, grade, mapName, attrRatio, budgetPercent], index) => {
    const map = MAPS[mapName];
    const template = { id: `${FOUNDATION_TECHNIQUE_PREFIX}${index + 1}`, name,
      desc: PLAYER_DESCRIPTIONS[index], grade, category, realmLv, maxLayer: map.maxLayer,
      expDifficulty: category === 'divine' ? 1.1 : category === 'secret' ? 0.9 : 1 };
    if (category === 'internal') {
      template.attrRatio = attrRatio;
      template.budgetPercent = budgetPercent;
    } else addSkill(template, shared);
    return template;
  });
  const books = techniques.map((template) => ({ itemId: `book.${template.id}`, name: `《${template.name}》`, type: 'skill_book', grade: template.grade,
    level: template.realmLv, learnTechniqueId: template.id, desc: `${template.realmLv}級${LABELS[template.category]}全卷，可修至${template.maxLayer}層。${template.desc}`,
    tags: ['功法書', LABELS[template.category], '築基期'] }));
  return { techniques, books, maps: MAPS };
}

export function applyFoundationTechniqueDrops(monstersByFile, books) {
  const ownBookIds = new Set(books.map((book) => book.itemId));
  for (const monsters of monstersByFile.values()) {
    for (const monster of monsters) monster.drops = (monster.drops ?? []).filter((drop) => !ownBookIds.has(drop.itemId));
  }
  const acquisition = [];
  for (const [index, book] of books.entries()) {
    const manual = MANUALS[index], map = MAPS[manual[4]], monsters = monstersByFile.get(map.file);
    if (!monsters) throw new Error(`缺少怪物檔：${map.file}`);
    const category = manual[1], sources = [];
    for (const monster of monsters) {
      const role = monster.tier === 'demon_king' ? 'boss' : monster.tier === 'variant' ? 'elite' : 'normal';
      const isEntry = category === 'internal' || category === 'arts';
      const chance = category === 'divine'
        ? (role === 'boss' ? 0.06 : role === 'elite' ? 0.02 : 0)
        : (isEntry ? ({ normal: 0.008, elite: 0.04, boss: 0.1 }[role]) : ({ normal: 0, elite: 0.04, boss: 0.1 }[role]));
      if (!chance) continue;
      if (role === 'normal' && monster.level !== manual[2]) continue;
      if (category === 'divine' && manual[2] === 34 && monster.id !== 'm_ironshell_turtle') continue;
      monster.drops.push({ itemId: book.itemId, name: book.name, type: 'skill_book', count: 1, chance });
      sources.push({ monsterId: monster.id, monsterName: monster.name, role, chance, respawnSec: monster.respawnSec });
    }
    if (!sources.length) throw new Error(`${book.itemId}沒有掉落來源`);
    acquisition.push({ techniqueId: book.learnTechniqueId, bookId: book.itemId, name: book.name, category, grade: manual[3], realmLv: manual[2], maxLayer: map.maxLayer, mapId: map.mapId, mapName: map.displayName ?? manual[4], sources });
  }
  for (const legacy of LEGACY_BOOK_DROPS) {
    const monster = monstersByFile.get(legacy.file)?.find((entry) => entry.id === legacy.monsterId);
    if (!monster) throw new Error(`既有天階掉落缺少來源：${legacy.monsterId}`);
    monster.drops = (monster.drops ?? []).filter((drop) => drop.itemId !== legacy.itemId);
    monster.drops.push({ itemId: legacy.itemId, name: legacy.name, type: 'skill_book', count: 1, chance: legacy.chance });
  }
  return acquisition;
}

export { LEGACY_BOOK_DROPS };
