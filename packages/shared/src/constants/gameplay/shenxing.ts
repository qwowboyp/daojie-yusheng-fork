/** 神行丹權威配置。 */
export type ShenxingPillTierKey =
  | 'foundation'
  | 'golden_core'
  | 'nascent_soul'
  | 'spirit_transformation'
  | 'void_refinement'
  | 'body_integration'
  | 'great_vehicle'
  | 'tribulation'
  | 'ascension';

export interface ShenxingPillTierConfig {
  tier: ShenxingPillTierKey;
  itemId: string;
  minRealmLv: number;
  maxRealmLv: number;
  cooldownTicks: number;
}

export const SHENXING_USE_BEHAVIOR = 'shenxing_travel' as const;
export const SHENXING_COOLDOWN_GROUP = 'shenxing' as const;
export const SHENXING_COOLDOWN_BUFF_ID = 'system.consumable_cooldown.shenxing' as const;
export const SHENXING_COOLDOWN_SOURCE_SKILL_ID = 'system:consumable-cooldown:shenxing' as const;

const SHENXING_REALM_BANDS = [
  ['foundation', 31, 42],
  ['golden_core', 43, 54],
  ['nascent_soul', 55, 66],
  ['spirit_transformation', 67, 78],
  ['void_refinement', 79, 90],
  ['body_integration', 91, 102],
  ['great_vehicle', 103, 114],
  ['tribulation', 115, 126],
  ['ascension', 127, 127],
] as const;

/**
 * 冷卻真源沿用 1Hz 整數 Buff tick，因此分數息一律向上取整，
 * 避免高階丹比設計值更早可再次使用。
 */
export const SHENXING_PILL_TIERS: readonly ShenxingPillTierConfig[] = Object.freeze(
  SHENXING_REALM_BANDS.map(([tier, minRealmLv, maxRealmLv], index) => Object.freeze({
    tier,
    itemId: `pill.realm.${tier}.swiftwind`,
    minRealmLv,
    maxRealmLv,
    cooldownTicks: Math.ceil(1800 / (2 ** index)),
  })),
);

const SHENXING_PILL_TIER_BY_ITEM_ID = new Map(
  SHENXING_PILL_TIERS.map((entry) => [entry.itemId, entry] as const),
);

export function getShenxingPillTier(itemId: unknown): ShenxingPillTierConfig | null {
  const normalized = typeof itemId === 'string' ? itemId.trim() : '';
  return SHENXING_PILL_TIER_BY_ITEM_ID.get(normalized) ?? null;
}

export function isShenxingPillItemId(itemId: unknown): boolean {
  return getShenxingPillTier(itemId) !== null;
}
