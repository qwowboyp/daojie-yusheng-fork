import type {
  SpiritBeastContent, SpiritBeastElement, SpiritBeastFacilityKind, SpiritBeastFusionPreview,
  SpiritBeastGrade, SpiritBeastMastery, SpiritBeastRecord, SpiritBeastSkill, SpiritBeastSpecies, SpiritBeastStar,
} from './spirit-beast-types';

export const SPIRIT_BEAST_ELEMENTS: readonly SpiritBeastElement[] = ['metal', 'wood', 'water', 'fire', 'earth'];
export const SPIRIT_BEAST_GRADES: readonly SpiritBeastGrade[] = ['fan', 'human', 'heaven', 'saint', 'immortal'];
export const SPIRIT_BEAST_SKILLS: readonly SpiritBeastSkill[] = ['forging', 'alchemy', 'enhancement', 'building', 'mining', 'planting'];
export const SPIRIT_BEAST_GRADE_NAMES: Record<SpiritBeastGrade, string> = { fan: '凡品', human: '人品', heaven: '天品', saint: '聖品', immortal: '仙品' };
export const SPIRIT_BEAST_GRADE_COLORS: Record<SpiritBeastGrade, string> = { fan: '#e5e7eb', human: '#22c55e', heaven: '#ef4444', saint: '#a855f7', immortal: '#f97316' };
export const SPIRIT_BEAST_ELEMENT_NAMES: Record<SpiritBeastElement, string> = { metal: '金', wood: '木', water: '水', fire: '火', earth: '土' };
export const SPIRIT_BEAST_SKILL_NAMES: Record<SpiritBeastSkill, string> = { forging: '煉器', alchemy: '煉丹', enhancement: '強化', building: '營造', mining: '採礦', planting: '種植' };
export const SPIRIT_BEAST_STAR_WEIGHTS = [7000, 1500, 500, 800, 200] as const;
export const SPIRIT_BEAST_RULES = Object.freeze({
  version: 1, normalEggDropProbability: 0.00001, bossEggDropProbability: 0.0001,
  hatchBaseWorkTicks: 3600, evolutionMaterialCount: 10, evolutionSuccessBasisPoints: 2500,
  maxStar: 5, baseCombatGrowth: 1.3, skillLevelsPerStar: 5, speedBonusPerStar: 0.1,
  warehouseCapacity: 300, playerSummonLimit: 3, sectSummonLimit: 30, workSearchDistance: 16,
  cropGrowthTicks: 3600, cropOutputCount: 30, sowWorkTicks: 10, waterWorkTicks: 5, harvestWorkTicks: 10,
  ironMineWorkTicks: 120, spiritStoneMineWorkTicks: 600, playerStationSuccessBonus: 0.1,
  maximumOrders: 20, fertilizerEnabled: false as const,
});

const PRODUCES: Record<SpiritBeastElement, SpiritBeastElement> = { wood: 'fire', fire: 'earth', earth: 'metal', metal: 'water', water: 'wood' };
const CONTROLS: Record<SpiritBeastElement, SpiritBeastElement> = { wood: 'earth', earth: 'water', water: 'fire', fire: 'metal', metal: 'wood' };

export const SPIRIT_BEAST_FACILITIES: Readonly<Record<string, { kind: SpiritBeastFacilityKind; element?: SpiritBeastElement }>> = Object.freeze({
  spirit_incubator_metal: { kind: 'incubator', element: 'metal' },
  spirit_incubator_wood: { kind: 'incubator', element: 'wood' },
  spirit_incubator_water: { kind: 'incubator', element: 'water' },
  spirit_incubator_fire: { kind: 'incubator', element: 'fire' },
  spirit_incubator_earth: { kind: 'incubator', element: 'earth' },
  sect_iron_mine: { kind: 'iron_mine' }, sect_spirit_stone_mine: { kind: 'spirit_stone_mine' },
  sect_spirit_field: { kind: 'field' }, sect_forging_station: { kind: 'forging' },
  sect_enhancement_station: { kind: 'enhancement' }, sect_alchemy_station: { kind: 'alchemy' },
  spirit_egg_enhancement_station: { kind: 'egg_enhancement' },
  spirit_beast_cultivation_station: { kind: 'cultivation' }, spirit_beast_fusion_station: { kind: 'fusion' },
});

export function isSpiritBeastStar(value: unknown): value is SpiritBeastStar {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

export function getSpiritEggItemId(element: SpiritBeastElement, star: SpiritBeastStar): string {
  return `spirit_egg.${element}.star${star}`;
}

export function parseSpiritEggItemId(itemId: string): { element: SpiritBeastElement; star: SpiritBeastStar } | null {
  const match = /^spirit_egg\.(metal|wood|water|fire|earth)\.star([1-5])$/.exec(itemId);
  return match ? { element: match[1] as SpiritBeastElement, star: Number(match[2]) as SpiritBeastStar } : null;
}

/** 僅回傳已編譯的機率表；順序為凡、人、天、聖、仙，萬分比總和10000。 */
const HATCH_WEIGHTS: readonly (readonly number[])[] = [
  [7100, 1500, 500, 800, 100], [6600, 1500, 850, 900, 150], [6100, 1500, 1200, 1000, 200],
  [5600, 1500, 1550, 1100, 250], [5100, 1500, 1900, 1200, 300],
];
export function getSpiritBeastHatchWeights(star: SpiritBeastStar): readonly number[] {
  if (!isSpiritBeastStar(star)) throw new RangeError('spirit_beast_invalid_star');
  return HATCH_WEIGHTS[star - 1];
}

/** 接受外部可重現RNG的一次取樣；不在shared內建立隨機來源。 */
export function selectSpiritBeastWeightedIndex(weights: readonly number[], sample: number): number {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError('spirit_beast_invalid_random_sample');
  let total = 0;
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError('spirit_beast_invalid_weight');
    total += weight;
  }
  if (!(total > 0)) throw new RangeError('spirit_beast_empty_weights');
  const target = sample * total;
  let cursor = 0;
  for (let i = 0; i < weights.length; i += 1) {
    cursor += weights[i];
    if (target < cursor) return i;
  }
  return weights.length - 1;
}

export function getSpiritBeastHatchSpeed(incubator: SpiritBeastElement, egg: SpiritBeastElement): number {
  if (incubator === egg) return 1.5;
  if (PRODUCES[incubator] === egg) return 2;
  if (PRODUCES[egg] === incubator) return 1;
  if (CONTROLS[incubator] === egg) return 0.5;
  return 0.75;
}

export function computeSpiritBeastMasteries(species: SpiritBeastSpecies, star: SpiritBeastStar): SpiritBeastMastery[] {
  return species.masteries.map((entry) => ({ skill: entry.skill, level: entry.level + 5 * (star - 1) }));
}

export function computeSpiritBeastSkillLevel(species: SpiritBeastSpecies, star: SpiritBeastStar, skill: SpiritBeastSkill): number {
  const mastery = species.masteries.find((entry) => entry.skill === skill);
  return mastery ? mastery.level + 5 * (star - 1) : 0;
}

export function computeSpiritBeastSpeed(species: SpiritBeastSpecies, star: SpiritBeastStar, skill?: SpiritBeastSkill): number {
  const level = skill ? computeSpiritBeastSkillLevel(species, star, skill) : species.masteries[0].level + 5 * (star - 1);
  if (level <= 0) return 0;
  return 1 + level / 100 + species.baseSpeedBonusPercent / 100 + 0.1 * (star - 1);
}

export function computeSpiritBeastCombatPower(basePower: number, star: SpiritBeastStar): number {
  return Math.round(basePower * 1.3 ** (star - 1));
}

/** 回傳拒絕原因key；同品同星的十隻材料必須已收回且沒有保護。 */
export function validateSpiritBeastCultivation(
  target: SpiritBeastRecord, materials: readonly SpiritBeastRecord[], catalog: ReadonlyMap<string, SpiritBeastSpecies>,
): string | null {
  const species = catalog.get(target.speciesId);
  if (!species || !isSpiritBeastStar(target.star) || target.star === 5) return 'spirit_beast_invalid_target';
  if (target.state !== 'stored' || target.protected) return 'spirit_beast_target_unavailable';
  if (materials.length !== 10) return 'spirit_beast_requires_ten_materials';
  const seen = new Set([target.instanceId]);
  for (const item of materials) {
    if (seen.has(item.instanceId)) return 'spirit_beast_duplicate_material';
    seen.add(item.instanceId);
    if (item.ownerPlayerId !== target.ownerPlayerId || item.state !== 'stored' || item.protected) return 'spirit_beast_material_unavailable';
    if (item.star !== target.star || catalog.get(item.speciesId)?.grade !== species.grade) return 'spirit_beast_material_grade_star_mismatch';
  }
  return null;
}

export function resolveSpiritBeastFusionSpecies(
  a: SpiritBeastSpecies, b: SpiritBeastSpecies, catalog: readonly SpiritBeastSpecies[],
): SpiritBeastSpecies | null {
  if (a.grade !== b.grade) return null;
  const index = SPIRIT_BEAST_GRADES.indexOf(a.grade);
  const grade = SPIRIT_BEAST_GRADES[Math.min(index + 1, 4)];
  let element = a.element;
  let slot = a.slot;
  if (a.id !== b.id) {
    const low = Math.min(a.slot, b.slot);
    const high = Math.max(a.slot, b.slot);
    const namedSlot = a.element === b.element && (high - low === 1 || (low === 0 && high === 5))
      ? (low === 0 && high === 5 ? 5 : low) : null;
    if (namedSlot !== null) slot = index === 4 ? (namedSlot + 2) % 6 : namedSlot;
    else {
      if (a.element === b.element) element = a.element;
      else if (PRODUCES[a.element] === b.element) element = b.element;
      else if (PRODUCES[b.element] === a.element) element = a.element;
      else element = CONTROLS[a.element] === b.element ? a.element : b.element;
      slot = (a.slot + b.slot) % 6;
    }
  }
  return catalog.find((entry) => entry.grade === grade && entry.element === element && entry.slot === slot) ?? null;
}

export function previewSpiritBeastFusion(
  a: SpiritBeastRecord, b: SpiritBeastRecord, catalog: readonly SpiritBeastSpecies[],
): SpiritBeastFusionPreview | null {
  if (a.instanceId === b.instanceId || a.ownerPlayerId !== b.ownerPlayerId || a.star !== 5 || b.star !== 5
    || a.state !== 'stored' || b.state !== 'stored' || a.protected || b.protected) return null;
  const sa = catalog.find((entry) => entry.id === a.speciesId);
  const sb = catalog.find((entry) => entry.id === b.speciesId);
  if (!sa || !sb) return null;
  const child = resolveSpiritBeastFusionSpecies(sa, sb, catalog);
  if (!child) return null;
  const potential = (record: SpiritBeastRecord, species: SpiritBeastSpecies) => species.baseCombatPowerMax === species.baseCombatPowerMin
    ? 1 : Math.max(0, Math.min(1, (record.baseCombatPower - species.baseCombatPowerMin)
      / (species.baseCombatPowerMax - species.baseCombatPowerMin)));
  const baseCombatPower = Math.round(child.baseCombatPowerMin + Math.max(potential(a, sa), potential(b, sb))
    * (child.baseCombatPowerMax - child.baseCombatPowerMin));
  const parents = [a.speciesId, b.speciesId].sort();
  return {
    recipeId: `spirit_fusion.v1:${parents[0]}:${parents[1]}`, parentIds: [a.instanceId, b.instanceId],
    speciesId: child.id, star: 3, grade: child.grade, element: child.element, name: child.name,
    masteries: computeSpiritBeastMasteries(child, 3), baseCombatPower,
    combatPower: computeSpiritBeastCombatPower(baseCombatPower, 3), effectiveSpeed: computeSpiritBeastSpeed(child, 3),
  };
}

/** 冷路徑內容schema：編輯器保存及服務端啟動必須使用同一驗證。 */
export function validateSpiritBeastContent(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return ['content_must_be_object'];
  const content = value as Partial<SpiritBeastContent>;
  if (content.version !== 1) errors.push('version_must_be_1');
  if (!Array.isArray(content.species) || content.species.length !== 150) return [...errors, 'species_must_have_150_entries'];
  const ids = new Set<string>();
  const positions = new Set<string>();
  const counts = new Map<string, number>();
  for (const entry of content.species) {
    if (!entry || typeof entry !== 'object') { errors.push('invalid_species'); continue; }
    if (typeof entry.id !== 'string' || !entry.id.startsWith('spirit_beast.') || ids.has(entry.id)) errors.push('invalid_or_duplicate_species_id');
    ids.add(entry.id);
    if (typeof entry.name !== 'string' || !entry.name.trim() || !SPIRIT_BEAST_GRADES.includes(entry.grade)
      || !SPIRIT_BEAST_ELEMENTS.includes(entry.element) || !Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot > 5) errors.push(`invalid_species_identity:${entry.id}`);
    const position = `${entry.grade}:${entry.element}:${entry.slot}`;
    if (positions.has(position)) errors.push(`duplicate_species_position:${position}`);
    positions.add(position);
    const bucket = `${entry.grade}:${entry.element}`;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    if (!Array.isArray(entry.masteries) || entry.masteries.length < 1 || entry.masteries.length > 2) errors.push(`invalid_masteries:${entry.id}`);
    else {
      const seen = new Set<SpiritBeastSkill>();
      for (const mastery of entry.masteries) {
        if (!mastery || !SPIRIT_BEAST_SKILLS.includes(mastery.skill) || seen.has(mastery.skill)
          || !Number.isInteger(mastery.level) || mastery.level < 1 || mastery.level > 100) errors.push(`invalid_mastery:${entry.id}`);
        if (mastery) seen.add(mastery.skill);
      }
    }
    if (!Number.isInteger(entry.baseCombatPowerMin) || !Number.isInteger(entry.baseCombatPowerMax)
      || entry.baseCombatPowerMin < 1 || entry.baseCombatPowerMax < entry.baseCombatPowerMin
      || !Number.isFinite(entry.baseSpeedBonusPercent) || entry.baseSpeedBonusPercent < 0) errors.push(`invalid_species_stats:${entry.id}`);
    if (typeof entry.artKey !== 'string' || !entry.artKey.trim()) errors.push(`missing_art_key:${entry.id}`);
  }
  for (const grade of SPIRIT_BEAST_GRADES) for (const element of SPIRIT_BEAST_ELEMENTS) {
    if (counts.get(`${grade}:${element}`) !== 6) errors.push(`species_group_must_have_six:${grade}:${element}`);
  }
  if (!Array.isArray(content.seeds) || content.seeds.length === 0) errors.push('missing_seeds');
  else {
    const seedIds = new Set<string>();
    for (const seed of content.seeds) {
      if (!seed || typeof seed.itemId !== 'string' || !seed.itemId.startsWith('seed.') || seedIds.has(seed.itemId)
        || typeof seed.outputItemId !== 'string' || !seed.outputItemId || seed.growthTicks !== 3600 || seed.outputCount !== 30
        || !Number.isInteger(seed.purchaseSpiritStones) || seed.purchaseSpiritStones < 1
        || !Number.isInteger(seed.requiredLevel) || seed.requiredLevel < 1) errors.push('invalid_seed');
      if (seed) seedIds.add(seed.itemId);
    }
  }
  return errors;
}
