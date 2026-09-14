/** 靈獸、宗門工作站與種植的唯一跨端契約。資產與工作狀態由服務端裁定。 */
export type SpiritBeastGrade = 'fan' | 'human' | 'heaven' | 'saint' | 'immortal';
export type SpiritBeastElement = 'metal' | 'wood' | 'water' | 'fire' | 'earth';
export type SpiritBeastSkill = 'forging' | 'alchemy' | 'enhancement' | 'building' | 'mining' | 'planting';
export type SpiritBeastStar = 1 | 2 | 3 | 4 | 5;
export type SpiritBeastState = 'stored' | 'idle' | 'moving' | 'working' | 'waiting' | 'recalling' | 'locked';
export type SpiritBeastFacilityKind = 'incubator' | 'iron_mine' | 'spirit_stone_mine' | 'field' | 'forging' | 'enhancement' | 'alchemy' | 'egg_enhancement' | 'cultivation' | 'fusion';

export interface SpiritBeastMastery {
  skill: SpiritBeastSkill;
  level: number;
}

export interface SpiritBeastSpecies {
  id: string;
  name: string;
  grade: SpiritBeastGrade;
  element: SpiritBeastElement;
  /** 穩定血系位置，0～5；供已版本化的融合配方生成使用。 */
  slot: number;
  masteries: SpiritBeastMastery[];
  baseCombatPowerMin: number;
  baseCombatPowerMax: number;
  baseSpeedBonusPercent: number;
  artKey: string;
}

export interface SpiritBeastRecord {
  instanceId: string;
  ownerPlayerId: string;
  speciesId: string;
  star: SpiritBeastStar;
  baseCombatPower: number;
  state: SpiritBeastState;
  protected: boolean;
  revision: number;
  summonedSectId?: string | null;
  instanceMapId?: string | null;
  x?: number;
  y?: number;
  jobRunId?: string | null;
  buildingId?: string | null;
}

export interface SpiritBeastView extends SpiritBeastRecord {
  name: string;
  grade: SpiritBeastGrade;
  element: SpiritBeastElement;
  masteries: SpiritBeastMastery[];
  /** 倍率，例如 2.5 表示基礎工作速度的 250%。 */
  effectiveSpeed: number;
  combatPower: number;
  jobLabelKey?: string;
  buildingName?: string;
  canManage: boolean;
}

export interface SpiritEggStackView {
  itemKey: string;
  revision: number;
  itemId: string;
  name: string;
  element: SpiritBeastElement;
  star: SpiritBeastStar;
  count: number;
}

export interface SpiritBeastItemView {
  itemKey: string;
  itemId: string;
  name: string;
  count: number;
  reservedCount?: number;
  ownerPlayerId?: string;
  type?: 'consumable' | 'equipment' | 'artifact' | 'material' | 'quest_item' | 'skill_book';
  enhancementLevel?: number;
}

export interface SpiritBeastHatchView {
  hatchId: string;
  revision: number;
  ownerPlayerId: string;
  buildingId: string;
  element: SpiritBeastElement;
  eggStar: SpiritBeastStar;
  state: 'incubating' | 'ready';
  workTotalTicks: number;
  workRemainingTicks: number;
  speedMultiplier: number;
  /** 未完成前必須省略，禁止向客戶端洩漏預抽結果。 */
  offspring?: SpiritBeastView;
}

export interface SpiritBeastCropView {
  cycleId: string;
  seedItemId: string;
  outputItemId: string;
  name: string;
  growthTotalTicks: number;
  growthRemainingTicks: number;
  wateredCount: number;
  wateringRequired: number;
  state: 'planned' | 'growing' | 'needs_water' | 'mature' | 'harvesting';
  fertilizerItemId?: string | null;
}

export interface SpiritBeastWorkOrderView {
  orderId: string;
  buildingId: string;
  ownerPlayerId: string;
  skill: SpiritBeastSkill;
  action: string;
  recipeId?: string;
  itemId?: string;
  targetItemKey?: string;
  quantity: number;
  completedCount: number;
  state: 'queued' | 'moving' | 'running' | 'waiting' | 'completed' | 'cancelled';
  workerKind?: 'player' | 'spirit_beast';
  workerId?: string;
  workTotalTicks?: number;
  workRemainingTicks?: number;
  waitReasonKey?: string;
  revision: number;
}

export interface SpiritBeastFacilityView {
  buildingId: string;
  buildingDefId: string;
  name: string;
  kind: SpiritBeastFacilityKind;
  element?: SpiritBeastElement;
  x: number;
  y: number;
  enabled: boolean;
  revision: number;
  canOperate: boolean;
  canDeposit: boolean;
  canWithdraw: boolean;
  input: SpiritBeastItemView[];
  output: SpiritBeastItemView[];
  outputSpiritStones?: number;
  hatch?: SpiritBeastHatchView;
  crop?: SpiritBeastCropView;
  plannedSeedItemId?: string | null;
  repeatPlanting?: boolean;
  selectedFertilizerItemId?: string | null;
  orders: SpiritBeastWorkOrderView[];
}

export interface SpiritBeastFusionPreview {
  recipeId: string;
  parentIds: [string, string];
  speciesId: string;
  star: 3;
  grade: SpiritBeastGrade;
  element: SpiritBeastElement;
  name: string;
  masteries: SpiritBeastMastery[];
  baseCombatPower: number;
  combatPower: number;
  effectiveSpeed: number;
}

export interface SpiritBeastSeedDefinition {
  itemId: string;
  name: string;
  outputItemId: string;
  outputName: string;
  growthTicks: number;
  outputCount: number;
  purchaseSpiritStones: number;
  requiredLevel: number;
}

export interface SpiritBeastPanelView {
  revision: number;
  sectId: string | null;
  ownerPlayerId: string;
  beasts: SpiritBeastView[];
  facilities: SpiritBeastFacilityView[];
  eggs: SpiritEggStackView[];
  inventory: SpiritBeastItemView[];
  craftOptions: SpiritBeastCraftOption[];
  plantingSkill?: { level: number; exp: number; expToNext: number };
  warehouseCapacity: number;
  summonLimit: number;
  sectSummonLimit: number;
  summonedCount: number;
  sectSummonedCount: number;
  fertilizerEnabled: false;
  canManage: boolean;
  reasonKey?: string;
  fusionPreview?: SpiritBeastFusionPreview;
}

export interface SpiritBeastCraftOption {
  facilityKind: 'forging' | 'alchemy';
  recipeId: string;
  name: string;
  outputItemId: string;
  requiredLevel: number;
  baseWorkTicks: number;
  materials: Array<{ itemId: string; name: string; count: number }>;
  spiritStoneCost: number;
}

export interface RequestSpiritBeastPanelView {
  buildingId?: string;
}

type SpiritBeastCommandBase = { requestId: string; expectedRevision?: number };
export type SpiritBeastCommandView = SpiritBeastCommandBase & (
  | { action: 'summon' | 'recall'; beastId: string }
  | { action: 'protect'; beastId: string; protected: boolean }
  | { action: 'incubate'; buildingId: string; eggItemKey: string }
  | { action: 'cancel_incubation' | 'adopt'; buildingId: string; hatchId: string }
  | { action: 'enhance_egg'; buildingId: string; eggItemKey: string; materials: Array<{ itemKey: string; count: number }> }
  | { action: 'cultivate'; buildingId: string; beastId: string; materialBeastIds: string[] }
  | { action: 'fuse' | 'preview_fusion'; buildingId: string; beastIds: [string, string] }
  | { action: 'set_mine_enabled'; buildingId: string; enabled: boolean }
  | { action: 'set_crop_plan'; buildingId: string; seedItemId: string | null; repeat: boolean; fertilizerItemId?: string | null }
  | { action: 'cancel_crop'; buildingId: string; cycleId: string }
  | { action: 'deposit' | 'withdraw'; buildingId: string; entries: Array<{ itemKey: string; count: number }>; spiritStones?: number }
  | { action: 'queue_craft'; buildingId: string; recipeId?: string; targetItemKey?: string; quantity: number; targetEnhancementLevel?: number; maxAttempts?: number; maxSpiritStones?: number }
  | { action: 'cancel_order'; buildingId: string; orderId: string }
  | { action: 'manual_work'; buildingId: string; workAction?: 'mine' | 'sow' | 'water' | 'harvest' | 'craft' }
  | { action: 'cancel_manual_work'; buildingId: string }
  | { action: 'buy_seed'; itemId: string; count: number }
);

export interface SpiritBeastCommandResultView {
  requestId: string;
  ok: boolean;
  revision: number;
  reasonKey?: string;
  variables?: Record<string, string | number | boolean>;
  /** 培養／強化中的機率結果；ok 表示操作結算成功，不等於進階成功。 */
  promoted?: boolean;
  fusionPreview?: SpiritBeastFusionPreview;
}

/** 地圖獸投影與面板詳情分開，避免高頻包攜带完整名冊。 */
export interface SpiritBeastMapProjection {
  instanceId: string;
  speciesId: string;
  ownerPlayerId: string;
  x: number;
  y: number;
  state: 'idle' | 'moving' | 'working' | 'waiting' | 'recalling';
  buildingId?: string;
}

export interface SpiritBeastContent {
  version: 1;
  species: SpiritBeastSpecies[];
  seeds: SpiritBeastSeedDefinition[];
}

/** 獨立AOI差量；只有新增投影帶物種，移動不重送靜態名冊。 */
export interface SpiritBeastMapDeltaView {
  mapInstanceId: string;
  revision: number;
  reset?: boolean;
  added: SpiritBeastMapProjection[];
  updated: Array<{ instanceId: string; x?: number; y?: number; state?: SpiritBeastMapProjection['state']; buildingId?: string | null }>;
  removed: string[];
}
