/** 七境功法的創作目錄、數值配置與定向掉落；只產出資料，不改動執行期規則。 */
export const LATE_TECHNIQUE_PREFIX = 'lg_manual_';
const CATEGORIES = ['internal', 'arts', 'internal', 'secret', 'arts', 'divine', 'secret', 'divine'];
const OFFSETS = [0, 1, 3, 4, 6, 7, 9, 10];
const CATEGORY_LABELS = { internal: '內功', arts: '法術', divine: '神通', secret: '秘術' };
// 順序：初境內功、常用法術、中段內功、行旅秘術、進階法術、護持神通、修持秘術、決戰神通。
const NAMES = [
  ['餘燼守爐經', '燼燈點火訣', '懸燈照脈篇', '薪途識火錄', '熔渠斷流式', '百燈護命章', '殘爐養息法', '補天一炬'],
  ['沉鐘定魄經', '回瀾分潮訣', '千帆寄神篇', '漏聲辨潮錄', '骨帆歸汐式', '鎮海安魂章', '聽潮澄心法', '萬帆鎮淵'],
  ['望涯凝神經', '雷原穿雲訣', '古曜洗髓篇', '星臺觀路錄', '斷崖截風式', '定星護魂章', '引雷歸竅法', '九曜墜涯'],
  ['碎界固身經', '虛舟穿隙訣', '星骸藏息篇', '無光引航錄', '空巢迴刃式', '界舟固錨章', '虛海寂照法', '星港沉界'],
  ['天垣合身經', '法骸鎮門訣', '鏡我返真篇', '垣井辨影錄', '澤鏡返照式', '萬垣護生章', '法骸調息法', '一身撐天'],
  ['鎮涯負嶽經', '劫風破陣訣', '天痕納海篇', '雷原尋隙錄', '舊壘迴鋒式', '鎮關承劫章', '風劫定念法', '萬壘斷劫'],
  ['薪火不滅經', '劫雲引霆訣', '五衰歸真篇', '心鏡照途錄', '衰崖截命式', '薪城留命章', '九重息雷法', '天人續燈'],
];
const ORIGINS = [
  '燼燈坊守燈人將護爐與引火的心得藏在焦邊書頁裡',
  '殘響渡行舟者以鐘聲校正神魂，以潮痕記錄歸途',
  '望涯驛觀星者從雷律與斷崖風向中拆解行氣節奏',
  '虛舟市領航人將界隙的張合寫成可反覆演練的法式',
  '天垣城修士藉法骸與鏡我之試，校準肉身和神識',
  '鎮涯關守關者把獸潮前的守禦與破陣經驗留給後人',
  '薪火城倖存者將五衰之中保住一息的經驗編成法卷',
];
const RATIOS = [
  [{ constitution: 5, meridians: 3, strength: 2 }, { spirit: 5, perception: 3, talent: 2 }],
  [{ spirit: 4, constitution: 3, meridians: 3 }, { perception: 5, spirit: 3, talent: 2 }],
  [{ perception: 4, spirit: 4, constitution: 2 }, { strength: 4, meridians: 4, talent: 2 }],
  [{ constitution: 4, strength: 4, perception: 2 }, { meridians: 5, spirit: 3, talent: 2 }],
  [{ constitution: 4, strength: 3, meridians: 3 }, { spirit: 4, perception: 4, talent: 2 }],
  [{ constitution: 5, strength: 3, perception: 2 }, { meridians: 4, spirit: 4, talent: 2 }],
  [{ constitution: 4, meridians: 4, spirit: 2 }, { perception: 4, talent: 3, spirit: 3 }],
];
const ELEMENTS = ['fire', 'water', 'metal', 'metal', 'earth', 'earth', 'fire'];
const v = (name, scale = 1) => ({ var: name, scale });
const op = (name, ...args) => ({ op: name, args });
const round = (n) => Number(n.toFixed(6));
const levelScale = (maxLayer) => op('add', 0.55, v('techLevel', 0.45 / maxLayer));
const scaled = (basis, maxLayer) => op('mul', basis, levelScale(maxLayer));
const damage = (formula, damageKind = 'spell', element) => ({ type: 'damage', damageKind, ...(element ? { element } : {}), formula });
function gradeAt(level) {
  if (level >= 122) return 'emperor';
  if (level >= 98) return 'saint';
  if (level >= 64) return 'spirit';
  if (level >= 55) return 'heaven';
  return 'earth';
}
function buff(family, name, stats, duration, statMode = 'flat', target = 'self') {
  return { type: 'buff', target, buffId: `lg.manual.${family}`, name,
    category: target === 'target' ? 'debuff' : 'buff', visibility: 'public',
    duration, stacks: 1, maxStacks: 1, stats, statMode };
}
function skill(template, shared, suffix, { name, desc, cooldown, outputRatio, range = 0, targeting,
  effects, unlockLevel = 1, windup = 0 }) {
  const output = shared.getTechniqueStandardQiOutputBaseline(template.realmLv);
  const unit = shared.calculateTechniqueSkillQiCost(1, template.grade, template.realmLv);
  const costMultiplier = round(output * outputRatio / unit);
  return { id: `skill.${template.id}.${suffix}`, name, desc, cooldown,
    costMultiplier, cost: shared.calculateTechniqueSkillQiCost(costMultiplier, template.grade, template.realmLv),
    range, ...(targeting ? { targeting } : {}), requiresTarget: range > 0,
    effects, unlockLevel,
    ...(windup ? { playerCast: { windupTicks: windup, warningColor: '#c7a56c' } } : {}) };
}
function buildArts(t, realmIndex, advanced, shared) {
  const max = t.maxLayer;
  const element = ELEMENTS[realmIndex];
  let range = 4, targeting = { shape: 'single', maxTargets: 1 }, cooldown = 7, outputRatio = 0.5;
  let basis = v('caster.stat.spellAtk', 3.4), kind = 'spell';
  let desc = '集中靈力打擊單一目標，低耗靈、短冷卻，適合持續作戰。';
  let extra = [];
  if (!advanced && realmIndex === 1) {
    basis = v('caster.stat.spellAtk', 2.8);
    extra = [{ type: 'heal', target: 'self', formula: scaled(v('caster.maxHp', 0.025), max) }];
    cooldown = 10; outputRatio = 0.65;
    desc = '單體水行攻擊，並回復自身少量生命；以較低傷害換取續戰。';
  } else if (!advanced && realmIndex === 2) {
    range = 6; basis = v('caster.stat.spellAtk', 3.1); cooldown = 8;
    desc = '遠距離金行穿雲一擊，以略低傷害換取射程。';
  } else if (!advanced && realmIndex === 3) {
    kind = 'physical'; range = 6; cooldown = 9;
    basis = op('mul', v('caster.stat.physAtk', 2.7), op('add', 1,
      op('mul', 0.05, op('min', 5, v('target.distance')))));
    desc = '瞄準界隙作遠距物理一擊，距離加成最多計五格。';
  } else if (!advanced && realmIndex === 4) {
    kind = 'physical'; range = 2; cooldown = 8;
    basis = op('add', v('caster.stat.physAtk', 2.7),
      op('min', v('caster.stat.physDef', 0.7), v('caster.stat.physAtk', 0.7)));
    desc = '近距物理打擊，以自身物防補充威力；防禦轉傷最多為物攻的七成。';
  } else if (!advanced && realmIndex === 5) {
    kind = 'physical'; range = 3; basis = v('caster.stat.physAtk', 3.4);
    desc = '對單一目標作穩定物理破陣攻擊，適合近戰持續輸出。';
  } else if (!advanced && realmIndex === 6) {
    basis = op('add', v('caster.stat.spellAtk', 1.7), v('caster.stat.physAtk', 1.7));
    desc = '單體火行法術，威力各取物攻與法攻的一部分，適合雙修。';
  }
  if (advanced) {
    cooldown = 16; outputRatio = 0.85;
    if ([0, 2, 5].includes(realmIndex)) {
      range = 4; targeting = { shape: 'line', range: 4, maxTargets: 4 };
      kind = realmIndex === 5 ? 'physical' : 'spell';
      basis = v(`caster.stat.${kind === 'spell' ? 'spellAtk' : 'physAtk'}`, 2.2);
      desc = '沿直線掃過至多四名目標，單體威力低於專精點殺。';
    } else if (realmIndex === 1) {
      range = 0; targeting = { shape: 'ring', radius: 2, innerRadius: 1, maxTargets: 5 };
      basis = v('caster.stat.spellAtk', 1.8);
      desc = '以自身為中心的潮環打擊至多五名目標，中央與貼身內圈不受攻擊。';
    } else if (realmIndex === 3) {
      kind = 'physical'; range = 3; targeting = { shape: 'area', radius: 1, maxTargets: 3 };
      basis = v('caster.stat.physAtk', 2.1);
      desc = '在落點附近迴旋斬擊至多三名目標，適合小群敵人。';
    } else if (realmIndex === 4) {
      range = 4; cooldown = 18; basis = v('caster.stat.spellAtk', 2.4);
      extra = [buff('fracture', '照影破綻', { physDef: -8, spellDef: -8 }, 5, 'percent', 'target')];
      desc = '單體法術攻擊，並短暫削弱目標雙防；同類破綻不疊加。';
    } else {
      range = 4; cooldown = 15;
      basis = op('mul', v('caster.stat.spellAtk', 2.8), op('add', 1,
        op('mul', 0.4, op('max', 0, op('sub', 1, op('div', v('target.hp'), op('max', 1, v('target.maxHp'))))))));
      desc = '單體法術截擊，目標失去的生命比例提高威力，加成上限四成。';
    }
  }
  t.skills = [skill(t, shared, 'cast', { name: t.name.replace(/訣$|式$/, ''), desc, cooldown,
    outputRatio, range, targeting, effects: [damage(scaled(basis, max), kind, element), ...extra] })];
  t.desc += `。${desc}`;
}
function buildDivine(t, realmIndex, burst, shared) {
  const element = ELEMENTS[realmIndex];
  if (burst) {
    const single = [1, 3, 6].includes(realmIndex), physical = [3, 4, 5].includes(realmIndex);
    const kind = physical ? 'physical' : 'spell';
    const desc = single ? '蓄勢三息後重擊單一目標；長冷卻的決戰招式。' : '蓄勢三息後打擊落點周圍至多五名目標；長冷卻的清場招式。';
    t.skills = [skill(t, shared, 'manifest', { name: t.name, desc, cooldown: 600,
      outputRatio: 1.2, range: 5,
      targeting: single ? { shape: 'single', maxTargets: 1 } : { shape: 'area', radius: 2, maxTargets: 5 },
      effects: [damage(scaled(v(`caster.stat.${physical ? 'physAtk' : 'spellAtk'}`, single ? 12 : 6), t.maxLayer), kind, element)],
      unlockLevel: Math.ceil(t.maxLayer * 2 / 3), windup: 3 })];
    t.desc += `。${desc}`;
  } else {
    const healing = [0, 1, 4, 6].includes(realmIndex);
    const desc = healing ? '回復自身生命，並短暫提升雙防；同類護持不疊加。' : '短暫強化自身雙防與抗暴，以較長冷卻換取危急時的承傷能力。';
    const effects = [buff('divine_guard', '七境護持', { physDef: 18, spellDef: 18, ...(healing ? {} : { antiCrit: 15 }) }, 12, 'percent')];
    if (healing) effects.unshift({ type: 'heal', target: 'self', formula: scaled(v('caster.maxHp', 0.09), t.maxLayer) });
    t.skills = [skill(t, shared, 'guard', { name: t.name.replace(/章$/, ''), desc, cooldown: 300,
      outputRatio: 0.9, effects, unlockLevel: Math.ceil(t.maxLayer / 3), windup: 1 })];
    t.desc += `。${desc}`;
  }
}
function buildSecret(t, realmIndex, advanced, shared) {
  let effects, desc, cooldown, outputRatio;
  if (!advanced) {
    const sight = realmIndex % 2 === 0;
    const sightGain = 1 + Math.floor(realmIndex / 3), speedGain = 1 + Math.floor(realmIndex / 2);
    effects = [buff('wayfinding', '七境引路', sight ? { viewRange: sightGain } : { moveSpeed: speedGain }, 45)];
    desc = sight ? `四十五息內視野增加 ${sightGain} 格，同類引路狀態不疊加。` : `四十五息內移動速度增加 ${speedGain}，同類引路狀態不疊加。`;
    cooldown = 120; outputRatio = 0.25;
  } else if (realmIndex % 2 === 0) {
    const gain = 10 + realmIndex;
    effects = [buff('breath', '七境調息', { maxQiOutputPerTick: gain }, 20, 'percent')];
    desc = `二十息內靈力輸出提高 ${gain}%，同類調息狀態不疊加；適合短暫施法窗口。`;
    cooldown = 180; outputRatio = 0.4;
  } else {
    const gain = 500 + 50 * realmIndex;
    effects = [buff('contemplation', '七境澄心', { techniqueExpRate: gain }, 60)];
    desc = `六十息內功法經驗加成增加 ${gain / 100} 個百分點，亦依既有規則影響領悟速度；同類澄心不疊加。`;
    cooldown = 240; outputRatio = 0.3;
  }
  t.skills = [skill(t, shared, 'invoke', { name: t.name.replace(/錄$|法$/, ''), desc, cooldown,
    outputRatio, effects, unlockLevel: advanced ? Math.ceil(t.maxLayer / 3) : 1 })];
  t.desc += `。${desc} 不提供永久幸運或掉落加成。`;
}

/** 與buildLateGameEncounters同一輸入；在原生成器寫出怪物前套用，重建不會抹掉功法掉落。 */
export function buildLateGameTechniques(catalog, encounters, shared) {
  const techniques = [], books = [], acquisition = [];
  for (const [realmIndex, realm] of catalog.realms.entries()) {
    for (let slot = 0; slot < 8; slot++) {
      const category = CATEGORIES[slot], realmLv = realm.startLevel + OFFSETS[slot];
      const id = `${LATE_TECHNIQUE_PREFIX}${realm.key}_${slot + 1}`;
      const template = { id, name: NAMES[realmIndex][slot], desc: ORIGINS[realmIndex],
        grade: gradeAt(realmLv), category, realmLv, maxLayer: 18 + realmIndex * 2,
        expDifficulty: category === 'divine' ? 1.15 : category === 'secret' ? 0.9 : 1 };
      if (category === 'internal') {
        template.attrRatio = RATIOS[realmIndex][slot === 0 ? 0 : 1];
        template.budgetPercent = slot === 0 ? 0.9 : 1;
        template.desc += `。側重${Object.keys(template.attrRatio).map(k => shared.ATTR_KEY_LABELS[k]).join('、')}，滿層總量遵循同品階、同境界內功基準。`;
      } else if (category === 'arts') buildArts(template, realmIndex, slot === 4, shared);
      else if (category === 'divine') buildDivine(template, realmIndex, slot === 7, shared);
      else buildSecret(template, realmIndex, slot === 6, shared);
      const book = { itemId: `book.${id}`, name: `《${template.name}》`, type: 'skill_book',
        grade: template.grade, level: realmLv, learnTechniqueId: id, learnTechniqueMaxLevel: template.maxLayer,
        desc: `${CATEGORY_LABELS[category]}全卷，可修至${template.maxLayer}層。${template.desc}`, tags: ['功法書', CATEGORY_LABELS[category], realm.name] };
      const info = realm.maps[Math.floor(slot / 2)];
      const monsters = encounters.monsters.filter(m => m.id.startsWith(`${info.id}_mob_`) || m.id === info.boss.id);
      if (!monsters.some(m => m.tier === 'demon_king')) throw new Error(`${info.id}缺少可掉書頭目`);
      const sources = [];
      // 每圖兩本，普通怪只分攤入門卷；精英與頭目定向提供珍本，不稀釋原材料掉落。
      for (const monster of monsters) {
        const role = monster.tier === 'demon_king' ? 'boss' : monster.tier === 'variant' ? 'elite' : 'normal';
        const common = category === 'internal' || (category === 'arts' && slot === 1);
        const chance = category === 'divine' ? (role === 'boss' ? 0.08 : 0)
          : common ? ({ normal: 0.008, elite: 0.045, boss: 0.12 }[role])
          : ({ normal: 0, elite: 0.03, boss: 0.1 }[role]);
        if (chance === 0) continue;
        // 同圖普通怪交錯分攤兩本入門卷，避免一隻怪承載全部常用功法。
        if (role === 'normal' && Number(monster.id.match(/_mob_(\d+)$/)?.[1]) % 2 !== slot % 2) continue;
        monster.drops ??= [];
        monster.drops.push({ itemId: book.itemId, name: book.name, type: 'skill_book', count: 1, chance });
        sources.push({ monsterId: monster.id, monsterName: monster.name, role, chance, respawnSec: monster.respawnSec });
      }
      if (sources.length === 0) throw new Error(`${id}沒有取得來源`);
      techniques.push(template); books.push(book);
      acquisition.push({ techniqueId: id, bookId: book.itemId, name: template.name, category,
        grade: template.grade, realmLv, maxLayer: template.maxLayer, mapId: info.id, mapName: info.name, sources });
    }
  }
  return { techniques, books, acquisition };
}
