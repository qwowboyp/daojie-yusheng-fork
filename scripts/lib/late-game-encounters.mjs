/**
 * 由後期劇情目錄衍生可直接載入的怪物、物品、功法與製作內容。
 * 本模組只回傳資料；寫檔、合併既有 catalog 與地圖配置由呼叫端負責。
 */

const ELEMENTS = ['metal', 'wood', 'water', 'fire', 'earth'];
const ELEMENT_COLORS = {
  metal: '#d7c27a', wood: '#77a867', water: '#6caed0', fire: '#dd6a45', earth: '#9b7851',
};
const ELEMENT_LABELS = {
  metal: '金', wood: '木', water: '水', fire: '火', earth: '土',
};
const ARMOR_SLOTS = [['head', '冠'], ['body', '衣'], ['legs', '履'], ['accessory', '佩']];
const MATERIAL_GRADE_MULTIPLIER = {
  mortal: 1, yellow: 1.35, mystic: 1.8, earth: 2.4, heaven: 3.2,
  spirit: 4.32, saint: 5.83, emperor: 7.87,
};
const MATERIAL_TYPE_MULTIPLIER = { herb: 1, ore: 1.35, exotic: 1.6 };
const MONSTER_STAT_KEYS = [
  'maxHp', 'maxQi', 'physAtk', 'spellAtk', 'physDef', 'spellDef', 'hit', 'dodge',
  'crit', 'antiCrit', 'breakPower', 'resolvePower', 'maxQiOutputPerTick', 'qiRegenRate',
  'hpRegenRate', 'cooldownSpeed', 'moveSpeed',
];
const ROLE_PROFILE = {
  normal: { hp: 0.4, reduction: 0.4, hitDamage: 0.04, hit: 0.95, dodge: 0.16, crit: 0.22, control: 0.58 },
  elite: { hp: 0.8, reduction: 0.5, hitDamage: 0.075, hit: 1.08, dodge: 0.22, crit: 0.3, control: 0.72 },
  boss: { hp: 2, reduction: 0.6, hitDamage: 0.12, hit: 1.22, dodge: 0.28, crit: 0.4, control: 0.9 },
};

function idPart(value) {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function requireText(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`late-game encounters: ${label} 不可為空`);
  return normalized;
}

function normalizeLevel(value, fallback = 1) {
  return Math.max(1, Math.min(126, Math.trunc(Number(value) || fallback)));
}

function gradeForLevel(level) {
  if (level >= 115) return 'emperor';
  if (level >= 91) return 'saint';
  if (level >= 67) return 'spirit';
  return 'heaven';
}

function normalizeElement(value, fallback = 'earth') {
  return ELEMENTS.includes(value) ? value : fallback;
}

function nextElement(element) {
  return ELEMENTS[(ELEMENTS.indexOf(element) + 1) % ELEMENTS.length];
}

function materialBudget(level, grade, category) {
  return Math.max(1, Math.round((level + 3) * (MATERIAL_GRADE_MULTIPLIER[grade] ?? 1) * (MATERIAL_TYPE_MULTIPLIER[category] ?? 1)));
}

function distributeElements(element, budget, secondaryRatio = 0) {
  const secondary = Math.max(0, Math.round(budget * secondaryRatio));
  const primary = Math.max(1, budget - secondary);
  return { elements: { [element]: primary, ...(secondary > 0 ? { [nextElement(element)]: secondary } : {}) } };
}

function makeMaterial({ itemId, name, level, grade, element, category, desc, tags, secondaryRatio = 0 }) {
  return {
    itemId, name, type: 'material', grade, level, materialCategory: category,
    materialValues: distributeElements(element, materialBudget(level, grade, category), secondaryRatio),
    desc, tags,
  };
}

function addElements(target, source, multiplier = 1) {
  for (const element of ELEMENTS) {
    const amount = Number(source?.[element] ?? 0) * multiplier;
    if (amount !== 0) target[element] = (target[element] ?? 0) + amount;
  }
  return target;
}

function sumIngredientElements(ingredients, itemById) {
  const total = {};
  for (const ingredient of ingredients) {
    const item = itemById.get(ingredient.itemId);
    if (!item?.materialValues?.elements) throw new Error(`late-game encounters: 配方引用非材料或無五行值 ${ingredient.itemId}`);
    addElements(total, item.materialValues.elements, ingredient.count);
  }
  return total;
}

function assertSharedApi(shared) {
  const required = [
    'resolveMonsterTemplateRecord', 'getTechniqueStandardMaxHpBaseline', 'getTechniqueStandardMaxQiBaseline',
    'getTechniqueStandardQiOutputBaseline', 'getRealmAttributeMultiplier', 'calculateTechniqueSkillQiCost',
    'compileEquipmentBaselinePercentsToActualStats', 'getEquipmentRealmEffectiveness', 'computeFivePhaseElementMatch',
  ];
  const missing = required.filter((key) => typeof shared?.[key] !== 'function');
  if (missing.length > 0) throw new Error(`late-game encounters: shared 缺少真實規則 API：${missing.join(', ')}`);
}

function playerBaseline(shared, level) {
  return {
    maxHp: shared.getTechniqueStandardMaxHpBaseline(level),
    maxQi: shared.getTechniqueStandardMaxQiBaseline(level),
    output: shared.getTechniqueStandardQiOutputBaseline(level),
  };
}

function solveAttackForPostDefenseDamage(targetDamage, playerDefense, playerLevel, realmGapMultiplier, shared) {
  const damageBeforeGap = targetDamage / Math.max(0.01, realmGapMultiplier);
  const scaledDefense = playerDefense * shared.getRealmAttributeMultiplier(playerLevel);
  return Math.max(1, (damageBeforeGap + Math.sqrt(damageBeforeGap ** 2 + 4 * damageBeforeGap * (scaledDefense + 100))) / 2);
}

function desiredMonsterStats(shared, { monsterLevel, playerLevel, role }) {
  const profile = ROLE_PROFILE[role];
  const player = playerBaseline(shared, playerLevel);
  const monsterRealmGapMultiplier = monsterLevel > playerLevel ? 1.2 ** (monsterLevel - playerLevel) : 1;
  // 玩家最終防禦、化解與怪物等級壓制在 43–126 級間並非固定比例；
  // 用平滑修正維持真傷害管線中的實際受傷比例，避免跨境突然變成刮痧。
  const attackCurveCorrection = Math.min(1.82, Math.max(0.82, 0.82 + (playerLevel - 43) / 81));
  const desiredHit = player.maxHp * profile.hitDamage * attackCurveCorrection;
  const playerDefenseProxy = player.output * 0.95;
  const attack = solveAttackForPostDefenseDamage(desiredHit, playerDefenseProxy, playerLevel, monsterRealmGapMultiplier, shared);
  const defense = profile.reduction / (1 - profile.reduction)
    * (player.output + 100) / shared.getRealmAttributeMultiplier(monsterLevel);
  const maxHp = player.maxHp * profile.hp;
  return {
    maxHp,
    maxQi: player.maxQi * (role === 'boss' ? 1.5 : role === 'elite' ? 0.8 : 0.5),
    physAtk: attack, spellAtk: attack * 0.96, physDef: defense, spellDef: defense * 0.96,
    hit: player.output * profile.hit, dodge: player.output * profile.dodge,
    crit: player.output * profile.crit, antiCrit: player.output * profile.crit,
    breakPower: player.output * profile.control, resolvePower: player.output * profile.control,
    maxQiOutputPerTick: player.output * (role === 'boss' ? 1.25 : role === 'elite' ? 0.8 : 0.55),
    qiRegenRate: player.maxQi * (role === 'boss' ? 0.015 : 0.008),
    hpRegenRate: maxHp * (role === 'boss' ? 0.00002 : role === 'elite' ? 0.00005 : 0.00004),
    cooldownSpeed: 100, moveSpeed: 100,
  };
}

function probeMonsterCoefficients(shared, level) {
  const probeValue = 1_000_000;
  const probeStats = Object.fromEntries(MONSTER_STAT_KEYS.map((key) => [key, probeValue]));
  const resolved = shared.resolveMonsterTemplateRecord({
    id: 'late_game_calibration_probe', name: '校準探針', char: '校', color: '#ffffff',
    level, grade: 'mortal', tier: 'mortal_blood', count: 1, valueStats: probeStats, drops: [],
  }).computedStats;
  return Object.fromEntries(MONSTER_STAT_KEYS.map((key) => [key, Math.max(Number.EPSILON, resolved[key] / probeValue)]));
}

function findMoveSpeedPercent(shared, level, target) {
  const resolve = (percent) => shared.resolveMonsterTemplateRecord({
    id: 'late_game_move_probe', name: '移速探針', char: '速', color: '#ffffff', level,
    grade: 'mortal', tier: 'mortal_blood', count: 1, valueStats: { moveSpeed: 1 },
    statPercents: { moveSpeed: percent }, drops: [],
  }).computedStats.moveSpeed;
  let low = 0;
  let high = 100;
  while (resolve(high) < target && high < 1e12) high *= 10;
  for (let index = 0; index < 48; index += 1) {
    const middle = (low + high) / 2;
    if (resolve(middle) < target) low = middle;
    else high = middle;
  }
  return Number(high.toFixed(8));
}

function buildMonsterStatOverride(shared, options) {
  const desired = desiredMonsterStats(shared, options);
  const coefficients = probeMonsterCoefficients(shared, options.monsterLevel);
  const valueStats = {};
  for (const key of MONSTER_STAT_KEYS) {
    if (key === 'moveSpeed') {
      valueStats.moveSpeed = 1;
      continue;
    }
    const rawValue = desired[key] / coefficients[key];
    valueStats[key] = Math.max(1, Math.ceil(rawValue));
  }
  const draftResolved = shared.resolveMonsterTemplateRecord({
    id: 'late_game_draft_probe', name: '整數探針', char: '整', color: '#ffffff', level: options.monsterLevel,
    grade: 'mortal', tier: 'mortal_blood', count: 1, valueStats, drops: [],
  }).computedStats;
  const statPercents = {};
  for (const key of MONSTER_STAT_KEYS) {
    if (key === 'moveSpeed') {
      statPercents.moveSpeed = findMoveSpeedPercent(shared, options.monsterLevel, desired.moveSpeed);
      continue;
    }
    statPercents[key] = Number((desired[key] / draftResolved[key] * 100).toFixed(8));
  }
  return { valueStats, statPercents };
}

function damageFormula(stat, scale) {
  return { op: 'mul', args: [{ var: `caster.stat.${stat}`, scale }, { op: 'add', args: [1, { var: 'techLevel', scale: 0.01 }] }] };
}

function classifySkill(rawSkill) {
  const text = `${rawSkill?.name ?? ''} ${rawSkill?.description ?? ''}`;
  if (/回復|回覆|回補|回魂|回血|療|再生|續命|補血|修補|恢復/.test(text)) return 'heal';
  if (/護體|護身|守勢|格擋|減傷|代擋|反傷|不受傷|無傷|閉目|蛻殼|石化|硬化|架盾|護盾|防禦/.test(text)) return 'guard';
  if (/全場|範圍|環形|聲場|落雷|雷林|爆發|橫掃|風壓|席捲|雨|霧|潮|多段|整片|八方|群/.test(text)) return 'area';
  if (/壓低|降低|減速|定身|遲滯|封|沉默|干擾|下沉|牽引|拉|推|鎖|纏|標記|剝奪|亂|禁|盲/.test(text)) return 'debuff';
  return 'strike';
}

function makeBuff({ id, name, desc, shortMark, category, color, target, duration, valueStats }) {
  return {
    type: 'buff', target, buffId: id, name, desc, shortMark, category,
    visibility: 'public', color, duration, maxStacks: 1, statMode: 'percent', valueStats,
  };
}

function buildBossSkill({ shared, id, rawSkill, element, index, grade, realmLv }) {
  const kind = classifySkill(rawSkill);
  const name = requireText(rawSkill?.name, `${id} 技能名稱`);
  const spell = index % 2 === 1;
  const stat = spell ? 'spellAtk' : 'physAtk';
  const damageKind = spell ? 'spell' : 'physical';
  const costMultiplier = kind === 'heal' || kind === 'guard' ? 2.4 : kind === 'area' ? 4 : kind === 'debuff' ? 3.4 : 3;
  const base = {
    id, name, cooldown: kind === 'heal' ? 70 : kind === 'guard' ? 42 : kind === 'area' ? 30 : kind === 'debuff' ? 26 : 18,
    costMultiplier, cost: shared.calculateTechniqueSkillQiCost(costMultiplier, grade, realmLv), unlockLevel: 1,
  };
  if (kind === 'heal') {
    return {
      ...base, range: 0, requiresTarget: false,
      desc: `${name}回復自身 0.6% 最大生命，並在 12 息內提高雙防 8%。`,
      effects: [
        { type: 'heal', target: 'self', formula: { var: 'caster.maxHp', scale: 0.006 } },
        makeBuff({ id: `lg_buff_${idPart(id)}`, name, desc: '氣機回穩，物理與法術防禦提高 8%。', shortMark: '復', category: 'buff', color: ELEMENT_COLORS[element], target: 'self', duration: 12, valueStats: { physDef: 8, spellDef: 8 } }),
      ],
    };
  }
  if (kind === 'guard') {
    return {
      ...base, range: 0, requiresTarget: false,
      desc: `${name}凝聚護勢，14 息內提高雙防 12% 與化解 8%。`,
      effects: [makeBuff({ id: `lg_buff_${idPart(id)}`, name, desc: '護勢凝聚，雙防提高 12%、化解提高 8%。', shortMark: '護', category: 'buff', color: ELEMENT_COLORS[element], target: 'self', duration: 14, valueStats: { physDef: 12, spellDef: 12, resolvePower: 8 } })],
    };
  }
  if (kind === 'area') {
    return {
      ...base, range: 5,
      desc: `${name}在預警區域造成 4.2 倍法術攻擊的${ELEMENT_LABELS[element]}行傷害。`,
      targeting: { shape: index % 3 === 0 ? 'ring' : 'box', ...(index % 3 === 0 ? { radius: 3, innerRadius: 1 } : { width: 3, height: 3 }), maxTargets: 9 },
      monsterCast: { windupTicks: 3, warningColor: ELEMENT_COLORS[element] },
      effects: [{ type: 'damage', damageKind: 'spell', element, formula: damageFormula('spellAtk', 4.2) }],
    };
  }
  if (kind === 'debuff') {
    return {
      ...base, range: 4,
      desc: `${name}造成 1.8 倍${spell ? '法術' : '物理'}攻擊傷害，並使目標 14 息內命中與移速降低 12%。`,
      effects: [
        { type: 'damage', damageKind, element, formula: damageFormula(stat, 1.8) },
        makeBuff({ id: `lg_buff_${idPart(id)}`, name, desc: '氣機受擾，命中與移速降低 12%。', shortMark: '滯', category: 'debuff', color: ELEMENT_COLORS[element], target: 'target', duration: 14, valueStats: { hit: -12, moveSpeed: -12 } }),
      ],
    };
  }
  return {
    ...base, range: 3, desc: `${name}造成 2.4 倍${spell ? '法術' : '物理'}攻擊的${ELEMENT_LABELS[element]}行傷害。`,
    effects: [{ type: 'damage', damageKind, element, formula: damageFormula(stat, 2.4) }],
  };
}

function buildEquipment(map, element, grade) {
  const prefix = `lg_equip_${idPart(map.id)}`;
  const level = Math.min(126, map.startLevel + 2);
  const elementLabel = ELEMENT_LABELS[element];
  return [
    { itemId: `${prefix}_war_blade`, name: `${map.name}${elementLabel}煞戰刃`, type: 'equipment', grade, level, desc: `以${map.name}礦材鑄成，強化物理攻擊、命中與破招。`, equipSlot: 'weapon', equipBaselinePercents: { physAtk: 105, hit: 45, breakPower: 45 } },
    { itemId: `${prefix}_spirit_staff`, name: `${map.name}${elementLabel}紋法杖`, type: 'equipment', grade, level, desc: `杖芯刻入${elementLabel}行回路，強化法術攻擊、命中與靈力輸出。`, equipSlot: 'weapon', equipBaselinePercents: { spellAtk: 105, hit: 40, maxQiOutputPerTick: 45 } },
    ...ARMOR_SLOTS.map(([equipSlot, suffix], index) => ({
      itemId: `${prefix}_${equipSlot}`, name: `${map.name}${elementLabel}紋${suffix}`, type: 'equipment', grade, level, equipSlot,
      desc: `以${map.name}礦材與首領部件鍛成的${suffix}位護具。`,
      equipBaselinePercents: index === 0 ? { maxHp: 42, physDef: 72, antiCrit: 30 }
        : index === 1 ? { maxHp: 58, physDef: 62, spellDef: 62 }
          : index === 2 ? { spellDef: 70, dodge: 20, moveSpeed: 12 }
            : { maxQi: 45, spellDef: 50, resolvePower: 42 },
    })),
  ];
}

function dropEntry(item, count, chance) {
  return { itemId: item.itemId, name: item.name, type: item.type, count, chance };
}

function validateEquipment(shared, equipment) {
  for (const item of equipment) {
    const actual = shared.compileEquipmentBaselinePercentsToActualStats(item.equipBaselinePercents, { grade: item.grade, level: item.level });
    if (!actual || Object.keys(actual).length === 0) throw new Error(`late-game encounters: 裝備無有效屬性 ${item.itemId}`);
    if (shared.getEquipmentRealmEffectiveness(126, item.level) <= 0) throw new Error(`late-game encounters: 裝備 126 級失效 ${item.itemId}`);
  }
}

function validateRecipeElementClosure(shared, recipe, itemById) {
  const inputElements = sumIngredientElements(recipe.ingredients, itemById);
  const mainElements = sumIngredientElements(recipe.mainIngredients, itemById);
  const targetElements = addElements(mainElements, recipe.requiredAuxElements);
  const match = shared.computeFivePhaseElementMatch(inputElements, targetElements);
  if (Math.abs(match.baseElementSuccessRate - 1) > 1e-9) throw new Error(`late-game encounters: ${recipe.recipeId} 標準投入五行匹配率不是 100%`);
}

function validateResolvedMonster(shared, monster) {
  const resolved = shared.resolveMonsterTemplateRecord(monster).computedStats;
  for (const key of ['maxHp', 'maxQi', 'physAtk', 'spellAtk', 'physDef', 'spellDef', 'hit']) {
    if (!Number.isFinite(resolved[key]) || resolved[key] <= 0) throw new Error(`late-game encounters: ${monster.id}.${key} 無法解析`);
  }
}

/** 將完整後期故事 catalog 轉為生產內容集合。 */
export function buildLateGameEncounters(catalog, shared) {
  assertSharedApi(shared);
  const result = {
    items: [], monsters: [], techniques: [], forging: [], alchemy: [], mapContent: {}, townShops: {},
    huanlingStats: buildMonsterStatOverride(shared, { monsterLevel: 43, playerLevel: 43, role: 'boss' }),
  };
  const itemById = new Map();
  const itemByName = new Map();
  const realms = Array.isArray(catalog?.realms) ? catalog.realms : [];
  function addItem(item) {
    if (itemById.has(item.itemId)) throw new Error(`late-game encounters: 重複物品 ID ${item.itemId}`);
    if (itemByName.has(item.name)) throw new Error(`late-game encounters: 重複物品名稱 ${item.name}`);
    itemById.set(item.itemId, item);
    itemByName.set(item.name, item);
    result.items.push(item);
    return item;
  }

  for (const realm of realms) {
    const townId = requireText(realm?.town?.id, `${realm?.id ?? 'realm'} 城鎮 ID`);
    const townShopItems = [];
    for (const map of Array.isArray(realm?.maps) ? realm.maps : []) {
      const mapId = requireText(map?.id, '地圖 ID');
      const mapName = requireText(map?.name, `${mapId} 地圖名稱`);
      const level = normalizeLevel(map?.startLevel, realm?.startLevel);
      const grade = gradeForLevel(level);
      const resources = Array.isArray(map?.resources) ? map.resources : [];
      const storyMonsters = Array.isArray(map?.monsters) ? map.monsters : [];
      if (resources.length === 0 || storyMonsters.length < 2) throw new Error(`late-game encounters: ${mapId} 至少需要資源與普通/精英怪`);
      const primaryElement = normalizeElement(resources.find((entry) => ELEMENTS.includes(entry?.element))?.element);
      const resourceItems = resources.map((resource) => {
        const category = resource?.kind === 'herb' ? 'herb' : resource?.kind === 'ore' ? 'ore' : 'exotic';
        const element = normalizeElement(resource?.element, primaryElement);
        return addItem(makeMaterial({
          itemId: requireText(resource?.id, `${mapId} 資源 ID`), name: requireText(resource?.name, `${mapId} 資源名稱`),
          level, grade, element, category, desc: requireText(resource?.description, `${resource?.name ?? mapId} 資源描述`),
          tags: category === 'herb' ? ['藥材', '靈植'] : category === 'ore' ? ['礦石', '礦材'] : ['異材', '妖材'],
          secondaryRatio: category === 'exotic' ? 0.25 : 0,
        }));
      });
      const herbItems = resourceItems.filter((item) => item.materialCategory === 'herb');
      const oreItems = resourceItems.filter((item) => item.materialCategory === 'ore');
      const exoticItems = resourceItems.filter((item) => item.materialCategory === 'exotic');
      if (herbItems.length === 0 || oreItems.length === 0) throw new Error(`late-game encounters: ${mapId} 缺少煉丹草藥或鍛造礦材`);

      const commonMaterial = addItem(makeMaterial({
        itemId: `lg_mat_${idPart(mapId)}_beast_remnant`, name: `${mapName}妖獸遺材`, level, grade,
        element: primaryElement, category: 'exotic', secondaryRatio: 0.35,
        desc: `${mapName}妖獸身上取得的通用異材，可作同地圖丹器配方的輔材。`, tags: ['異材', '妖材'],
      }));
      const boss = map?.boss ?? {};
      const bossId = requireText(boss?.id, `${mapId} 首領 ID`);
      const bossName = requireText(boss?.name, `${mapId} 首領名稱`);
      const bossComponent = addItem(makeMaterial({
        itemId: `lg_mat_${idPart(mapId)}_boss_component`, name: requireText(boss?.componentName, `${bossId} 定向部件`),
        level: Math.min(126, level + 2), grade, element: primaryElement, category: 'exotic', secondaryRatio: 0.35,
        desc: `${bossName}掉落的定向部件，是${mapName}六件裝備的核心主材。`, tags: ['首領素材', '異材'],
      }));
      const additionalBossMaterials = [];
      for (const [index, dropNameRaw] of (Array.isArray(boss?.dropNames) ? boss.dropNames : []).entries()) {
        const dropName = requireText(dropNameRaw, `${bossId} 掉落名稱`);
        if (itemByName.has(dropName)) continue;
        additionalBossMaterials.push(addItem(makeMaterial({
          itemId: `lg_mat_${idPart(mapId)}_boss_drop_${index + 1}`, name: dropName,
          level: Math.min(126, level + 2), grade, element: primaryElement, category: 'exotic', secondaryRatio: 0.35,
          desc: `${bossName}掉落的定向異材，可供${mapName}裝備鍛造。`, tags: ['首領素材', '異材'],
        })));
      }
      const equipment = buildEquipment({ id: mapId, name: mapName, startLevel: level }, primaryElement, grade);
      validateEquipment(shared, equipment);
      equipment.forEach(addItem);

      const monsterIds = [];
      for (const [index, storyMonster] of storyMonsters.entries()) {
        const role = index === storyMonsters.length - 1 ? 'elite' : 'normal';
        const monsterLevel = Math.min(126, level + (role === 'elite' ? 1 : 0));
        const monsterId = requireText(storyMonster?.id, `${mapId} 妖獸 ID`);
        const monsterName = requireText(storyMonster?.name, `${monsterId} 妖獸名稱`);
        const rotatingExotic = exoticItems[index % Math.max(1, exoticItems.length)];
        const drops = [dropEntry(commonMaterial, 1, role === 'elite' ? 1 : 0.72)];
        if (rotatingExotic) drops.push(dropEntry(rotatingExotic, 1, role === 'elite' ? 0.45 : 0.2));
        const monster = {
          id: monsterId, name: monsterName, desc: requireText(storyMonster?.description, `${monsterName} 描述`),
          char: monsterName.slice(0, 1), color: ELEMENT_COLORS[primaryElement], radius: 4,
          respawnSec: role === 'elite' ? 30 : 20, level: monsterLevel, grade,
          tier: role === 'elite' ? 'variant' : 'mortal_blood', count: role === 'elite' ? 1 : 2,
          drops, ...buildMonsterStatOverride(shared, { monsterLevel, playerLevel: level, role }),
        };
        validateResolvedMonster(shared, monster);
        result.monsters.push(monster);
        monsterIds.push(monsterId);
      }

      const rawSkills = Array.isArray(boss?.skills) ? boss.skills : [];
      if (rawSkills.length < 3 || rawSkills.length > 4) throw new Error(`late-game encounters: ${bossId} 必須有 3–4 招故事技能`);
      const bossLevel = Math.min(126, level + 2);
      const skillEntries = rawSkills.map((rawSkill, index) => buildBossSkill({
        shared, rawSkill, id: `lg_skill_${idPart(bossId)}_${index + 1}`, element: primaryElement, index, grade, realmLv: bossLevel,
      }));
      const artId = `lg_arts_${idPart(bossId)}`;
      result.techniques.push({
        id: artId, name: `${bossName}妖術`, desc: `${bossName}實際使用的${ELEMENT_LABELS[primaryElement]}行術式。`,
        grade, category: 'arts', realmLv: bossLevel, maxLayer: 1, expDifficulty: 1, skills: skillEntries,
      });
      const namedBossDrops = (Array.isArray(boss?.dropNames) ? boss.dropNames : []).map((name) => {
        const item = itemByName.get(String(name ?? '').trim());
        if (!item) throw new Error(`late-game encounters: ${bossId} 掉落名稱無對應物品：${name}`);
        return item;
      });
      if (!namedBossDrops.some((item) => item.itemId === bossComponent.itemId)) namedBossDrops.push(bossComponent);
      const bossDrops = [];
      for (const item of namedBossDrops) {
        if (bossDrops.some((drop) => drop.itemId === item.itemId)) continue;
        const guaranteed = item.itemId === bossComponent.itemId;
        bossDrops.push(dropEntry(item, guaranteed ? 1 : item.materialCategory === 'herb' ? 2 : 1, guaranteed ? 1 : 0.6));
      }
      bossDrops.push(dropEntry(commonMaterial, 2, 1));
      const bossMonster = {
        id: bossId, name: bossName, desc: requireText(boss?.description, `${bossName} 描述`),
        char: bossName.slice(0, 1), color: '#e6a45b', radius: 2, respawnSec: 120,
        level: bossLevel, grade, tier: 'demon_king', count: 1, maxAlive: 1,
        aggroRange: 6, aggroMode: 'always', skills: skillEntries.map((skill) => skill.id), drops: bossDrops,
        ...buildMonsterStatOverride(shared, { monsterLevel: bossLevel, playerLevel: level, role: 'boss' }),
      };
      validateResolvedMonster(shared, bossMonster);
      result.monsters.push(bossMonster);

      const potion = addItem({
        itemId: `lg_pill_${idPart(mapId)}_recovery`, name: `${mapName}回元丹`, type: 'consumable', grade, level,
        desc: `服用後按 ${level} 級標準基線回復 60% 氣血與 40% 靈力，冷卻 60 息。`,
        cooldown: 60, baselineHealPercent: 0.6, baselineQiPercent: 0.4,
      });
      const alchemyMain = [{ itemId: herbItems[0].itemId, count: 2 }];
      const alchemyAux = [...herbItems.slice(1).map((item) => ({ itemId: item.itemId, count: 1 })), { itemId: commonMaterial.itemId, count: 1 }];
      const alchemyRecipe = {
        recipeId: `lg_alchemy_${idPart(mapId)}_recovery`, outputItemId: potion.itemId, outputCount: 1,
        baseBrewTicks: 36, level, grade,
        ingredients: [...alchemyMain.map((entry) => ({ ...entry, role: 'main' })), ...alchemyAux.map((entry) => ({ ...entry, role: 'aux' }))],
        mainIngredients: alchemyMain, requiredAuxElements: sumIngredientElements(alchemyAux, itemById),
      };
      validateRecipeElementClosure(shared, alchemyRecipe, itemById);
      result.alchemy.push(alchemyRecipe);

      const forgingRecipeIds = [];
      const forgeSources = [...oreItems, ...exoticItems, ...additionalBossMaterials];
      for (const [index, outputItem] of equipment.entries()) {
        const sourceItem = forgeSources[index % forgeSources.length];
        const mainIngredients = [{ itemId: sourceItem.itemId, count: 3 }, { itemId: bossComponent.itemId, count: 1 }];
        const auxiliaryIngredients = [{ itemId: commonMaterial.itemId, count: 2 }];
        const recipe = {
          recipeId: `lg_forging_${idPart(mapId)}_${index + 1}`, outputItemId: outputItem.itemId,
          outputCount: 1, baseBrewTicks: 48 + index * 4, level: outputItem.level, grade, category: 'equipment',
          ingredients: [...mainIngredients.map((entry) => ({ ...entry, role: 'main' })), ...auxiliaryIngredients.map((entry) => ({ ...entry, role: 'aux' }))],
          mainIngredients, requiredAuxElements: sumIngredientElements(auxiliaryIngredients, itemById),
        };
        validateRecipeElementClosure(shared, recipe, itemById);
        result.forging.push(recipe);
        forgingRecipeIds.push(recipe.recipeId);
      }

      const herbNodeTemplates = herbItems.map((item, index) => ({
        id: `lg_landmark_${idPart(mapId)}_herb_${index + 1}`, kind: 'landmark_container', name: item.name,
        container: {
          variant: 'herb', grade, refreshTicksMin: 100 + index * 10, refreshTicksMax: 160 + index * 10,
          char: '草', color: ELEMENT_COLORS[normalizeElement(resources.find((entry) => entry?.id === item.itemId)?.element, primaryElement)],
          drops: [dropEntry(item, 1, 1)],
        },
      }));
      result.mapContent[mapId] = {
        monsterIds, bossId, herbNodeTemplates,
        oreItems: oreItems.map((item) => ({ ...item, materialValues: { elements: { ...item.materialValues.elements } }, tags: [...item.tags] })),
        equipmentIds: equipment.map((item) => item.itemId),
        materialIds: [...resourceItems.map((item) => item.itemId), commonMaterial.itemId, bossComponent.itemId, ...additionalBossMaterials.map((item) => item.itemId)],
        alchemyRecipeIds: [alchemyRecipe.recipeId], forgingRecipeIds,
      };
      townShopItems.push({ itemId: potion.itemId, price: Math.max(300, level * level * 4), count: 1 });
    }
    result.townShops[townId] = townShopItems;
  }
  return result;
}
