/**
 * 本文件定义前后端共享的玩法常量，是协议和运行规则共同依赖的稳定来源。
 *
 * 维护时要同步检查客户端展示、服务端结算和配置编辑器，避免同一数值在多端分叉。
 */
import type { ElementKey, NumericScalarStatKey } from '../../numeric';
import { Direction, TileType } from '../../world-core-types';
import { InteractableKind, StructureType, SurfaceType, TerrainType } from '../../map-layer-types';
import { TechniqueRealm } from '../../cultivation-types';
import { HOUSE_DECOR_TILE_LABELS } from '../gameplay/house-terrain';
import type { ActionType } from '../../action-combat-types';
import type { AttrKey } from '../../attribute-types';
import type { TechniqueCategory, TechniqueGrade } from '../../cultivation-types';
import type { EntityKind, MonsterTier } from '../../world-core-types';
import type { EquipSlot, ItemType } from '../../item-runtime-types';
import type { MapMinimapMarkerKind } from '../../world-view-types';
import type { QuestLine, QuestObjectiveType, QuestStatus } from '../../quest-types';
import type { SkillFormulaVar } from '../../skill-types';

/**
 * UI 标签映射常量（共享文案层）。
 */

/** 地形类型中文标签 */
export const TILE_TYPE_LABELS: Record<TileType, string> = {
  [TileType.Floor]: '地面',
  [TileType.FormationGlyph]: '法陣紋',
  [TileType.Road]: '大路',
  [TileType.Trail]: '小路',
  [TileType.Wall]: '牆體',
  [TileType.Door]: '門扉',
  [TileType.Window]: '窗戶',
  [TileType.Portal]: '傳送陣',
  [TileType.Stairs]: '樓梯',
  [TileType.StoneStairs]: '石梯',
  [TileType.Grass]: '草地',
  [TileType.Hill]: '山地',
  [TileType.Cliff]: '山崖',
  [TileType.Mud]: '泥地',
  [TileType.Swamp]: '沼澤',
  [TileType.ColdBog]: '寒沼',
  [TileType.MoltenPool]: '熔池',
  [TileType.Water]: '水域',
  [TileType.Cloud]: '雲牆',
  [TileType.CloudFloor]: '雲地',
  [TileType.Void]: '虛空',
  [TileType.Tree]: '樹木',
  [TileType.Bamboo]: '竹林',
  [TileType.Stone]: '岩石',
  [TileType.SpiritOre]: '靈石礦',
  [TileType.BlackIronOre]: '玄鐵礦',
  [TileType.BrokenSwordHeap]: '斷劍堆',
  ...HOUSE_DECOR_TILE_LABELS,
};

/** 底层地形中文标签。 */
export const TERRAIN_TYPE_LABELS: Record<TerrainType, string> = {
  [TerrainType.Floor]: '地基',
  [TerrainType.Grass]: '草地',
  [TerrainType.Hill]: '山地',
  [TerrainType.Cliff]: '山崖',
  [TerrainType.Mud]: '泥地',
  [TerrainType.Swamp]: '沼澤',
  [TerrainType.ColdBog]: '寒沼',
  [TerrainType.MoltenPool]: '熔池',
  [TerrainType.Water]: '水域',
  [TerrainType.Cloud]: '雲障',
  [TerrainType.CloudFloor]: '雲地',
  [TerrainType.Void]: '虛空',
};

/** 地表铺装中文标签。 */
export const SURFACE_TYPE_LABELS: Record<SurfaceType, string> = {
  [SurfaceType.Floor]: '地板',
  [SurfaceType.Road]: '大路',
  [SurfaceType.Trail]: '小路',
  [SurfaceType.Veranda]: '迴廊',
  [SurfaceType.StoneStairs]: '石梯',
  [SurfaceType.FormationGlyph]: '法陣紋',
};

/** 地上结构中文标签。 */
export const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = {
  [StructureType.Wall]: '牆體',
  [StructureType.Door]: '門扉',
  [StructureType.Window]: '窗戶',
  [StructureType.HouseEave]: '屋簷',
  [StructureType.HouseCorner]: '屋角',
  [StructureType.ScreenWall]: '影壁',
  [StructureType.Tree]: '樹木',
  [StructureType.Bamboo]: '竹林',
  [StructureType.Stone]: '岩石',
  [StructureType.SpiritOre]: '靈石礦',
  [StructureType.BlackIronOre]: '玄鐵礦',
  [StructureType.BrokenSwordHeap]: '斷劍堆',
};

/** 交互对象中文标签。 */
export const INTERACTABLE_KIND_LABELS: Record<InteractableKind, string> = {
  [InteractableKind.Portal]: '傳送陣',
  [InteractableKind.Stairs]: '樓梯',
  [InteractableKind.Container]: '箱子',
  [InteractableKind.Formation]: '陣法',
  [InteractableKind.Mechanism]: '機關',
};

/** 六维属性中文标签 */
export const ATTR_KEY_LABELS: Record<AttrKey, string> = {
  constitution: '體魄',
  spirit: '神識',
  perception: '身法',
  talent: '根骨',
  strength: '力道',
  meridians: '經脈',
};

/** 五行属性中文标签 */
export const ELEMENT_KEY_LABELS: Record<ElementKey, string> = {
  metal: '金',
  wood: '木',
  water: '水',
  fire: '火',
  earth: '土',
};

/** 标量数值属性中文标签 */
export const NUMERIC_SCALAR_STAT_LABELS: Record<NumericScalarStatKey, string> = {
  maxHp: '最大生命',
  maxQi: '最大靈力',
  physAtk: '物理攻擊',
  spellAtk: '法術攻擊',
  physDef: '物理防禦',
  spellDef: '法術防禦',
  hit: '命中',
  dodge: '閃避',
  crit: '暴擊',
  antiCrit: '免爆',
  critDamage: '暴擊傷害',
  breakPower: '破招',
  resolvePower: '化解',
  maxQiOutputPerTick: '靈力輸出',
  qiRegenRate: '靈力回覆',
  hpRegenRate: '生命回覆',
  cooldownSpeed: '冷卻速度',
  auraCostReduce: '靈耗減免',
  auraPowerRate: '術法增幅',
  playerExpRate: '境界修為',
  techniqueExpRate: '功法經驗',
  realmExpPerTick: '每息境界修為',
  techniqueExpPerTick: '每息功法經驗',
  lootRate: '掉落增幅',
  rareLootRate: '稀有掉落',
  viewRange: '視野',
  moveSpeed: '移動速度',
  extraAggroRate: '額外仇恨值',
  extraRange: '額外射程格數',
  extraArea: '額外範圍格數',
  actionsPerTurn: '每回合行動次數',
};

/** 实体类型中文标签 */
export const ENTITY_KIND_LABELS: Record<EntityKind, string> = {
  player: '修士',
  monster: '妖獸',
  npc: '人物',
  container: '容器',
  crowd: '人群',
  formation: '陣法',
  building: '建築',
  portal: '傳送點',
  mechanism: '機關',
};

/** 妖兽血脉层次中文标签 */
export const MONSTER_TIER_LABELS: Record<MonsterTier, string> = {
  mortal_blood: '凡血',
  variant: '異種',
  demon_king: '妖王',
};

/** 小地图标记类型中文标签 */
export const MAP_MINIMAP_MARKER_KIND_LABELS: Record<MapMinimapMarkerKind, string> = {
  landmark: '地標',
  container: '容器',
  npc: '人物',
  monster_spawn: '怪物',
  portal: '傳送',
  stairs: '樓梯',
};

/** 方向中文标签 */
export const DIRECTION_LABELS: Record<Direction, string> = {
  [Direction.North]: '北',
  [Direction.South]: '南',
  [Direction.East]: '東',
  [Direction.West]: '西',
};

/** 行动类型中文标签 */
export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  skill: '技能',
  gather: '採集',
  craft: '技藝',
  interact: '交互',
  quest: '任務',
  toggle: '行動',
  battle: '戰鬥',
  travel: '傳送',
  breakthrough: '突破',
};

/** 物品类型中文标签 */
export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  consumable: '消耗品',
  equipment: '裝備',
  artifact: '法寶',
  material: '材料',
  quest_item: '任務物',
  skill_book: '功法書',
};

/** 装备槽位中文标签 */
export const EQUIP_SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: '武器',
  head: '頭部',
  body: '身體',
  legs: '腿部',
  accessory: '飾品',
  technique_alchemy: '丹爐',
  technique_forging: '煉器工具',
  technique_enhancement: '強化錘',
  technique_mining: '礦鎬',
  technique_building: '營造錘',
};

/** 功法品阶中文标签 */
export const TECHNIQUE_GRADE_LABELS: Record<TechniqueGrade, string> = {
  mortal: '凡階',
  yellow: '黃階',
  mystic: '玄階',
  earth: '地階',
  heaven: '天階',
  spirit: '靈階',
  saint: '聖階',
  emperor: '帝階',
};

/** 功法分类中文标签 */
export const TECHNIQUE_CATEGORY_LABELS: Record<TechniqueCategory, string> = {
  arts: '術法',
  internal: '內功',
  divine: '神通',
  secret: '秘術',
};

/** 任务状态中文标签 */
export const QUEST_STATUS_LABELS: Record<QuestStatus, string> = {
  available: '可接取',
  active: '進行中',
  ready: '可交付',
  completed: '已完成',
};

/** 任务线中文标签 */
export const QUEST_LINE_LABELS: Record<QuestLine, string> = {
  main: '主線',
  side: '支線',
  daily: '日常',
  encounter: '奇遇',
};

/** 任务目标类型中文标签 */
export const QUEST_OBJECTIVE_TYPE_LABELS: Record<QuestObjectiveType, string> = {
  kill: '擊殺目標',
  talk: '對話送信',
  submit_item: '提交物品',
  learn_technique: '習得功法',
  realm_progress: '境界推進',
  realm_stage: '境界等級',
};

/** 功法境界中文标签 */
export const TECHNIQUE_REALM_LABELS: Record<TechniqueRealm, string> = {
  [TechniqueRealm.Entry]: '入門',
  [TechniqueRealm.Minor]: '小成',
  [TechniqueRealm.Major]: '大成',
  [TechniqueRealm.Perfection]: '圓滿',
};

/** 技能公式基础变量中文标签（不含动态 caster/target.stat 与 buff 层数字段） */
export const SKILL_FORMULA_BASE_VAR_LABELS: Partial<Record<SkillFormulaVar, string>> = {
  techLevel: '功法層數',
  'caster.realmLv': '自身境界等級',
  'caster.craft.alchemy.level': '自身煉丹等級',
  'caster.craft.forging.level': '自身煉器等級',
  'caster.craft.enhancement.level': '自身強化等級',
  'caster.craft.transmission.level': '自身傳法等級',
  'caster.craft.gather.level': '自身採集等級',
  'caster.craft.mining.level': '自身挖礦等級',
  'caster.craft.building.level': '自身營造等級',
  'caster.craft.formation.level': '自身陣法等級',
  targetCount: '目標數量',
  'caster.hp': '自身當前生命',
  'caster.maxHp': '自身最大生命',
  'caster.qi': '自身當前靈力',
  'caster.maxQi': '自身最大靈力',
  'target.debuffCount': '目標減益數量',
  'target.distance': '目標距離',
  'caster.attr.constitution': '自身體魄',
  'caster.attr.spirit': '自身神識',
  'caster.attr.perception': '自身身法',
  'caster.attr.talent': '自身根骨',
  'caster.attr.strength': '自身力道',
  'caster.attr.meridians': '自身經脈',
  'target.hp': '目標當前生命',
  'target.maxHp': '目標最大生命',
  'target.qi': '目標當前靈力',
  'target.maxQi': '目標最大靈力',
  'target.attr.constitution': '目標體魄',
  'target.attr.spirit': '目標神識',
  'target.attr.perception': '目標身法',
  'target.attr.talent': '目標根骨',
  'target.attr.strength': '目標力道',
  'target.attr.meridians': '目標經脈',
};
