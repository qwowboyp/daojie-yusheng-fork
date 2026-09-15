import type {
  SpiritBeastElement,
  SpiritBeastFacilityKind,
  SpiritBeastGrade,
  SpiritBeastSkill,
  SpiritBeastState,
  SpiritBeastWorkOrderView,
} from '@mud/shared';
import {
  SPIRIT_BEAST_ELEMENT_NAMES,
  SPIRIT_BEAST_GRADE_NAMES,
  SPIRIT_BEAST_SKILL_NAMES,
} from '@mud/shared';

export const gradeLabel = (grade: SpiritBeastGrade): string => SPIRIT_BEAST_GRADE_NAMES[grade];
export const elementLabel = (element: SpiritBeastElement): string => SPIRIT_BEAST_ELEMENT_NAMES[element];
export const skillLabel = (skill: SpiritBeastSkill): string => SPIRIT_BEAST_SKILL_NAMES[skill];
export const stars = (star: number): string => '★'.repeat(Math.max(0, Math.min(5, star)));
export const gradeClass = (grade: SpiritBeastGrade): string => `spirit-beast-grade spirit-beast-grade--${grade}`;
export { spiritBeastArtUrl as speciesArtUrl } from '../../../content/spirit-beast-art';

export function stateLabel(state: SpiritBeastState): string {
  return ({
    stored: '宗門倉庫', idle: '空閒', moving: '前往工位', working: '工作中', waiting: '等待條件',
    recalling: '收回中', locked: '操作鎖定',
  })[state];
}

export function facilityKindLabel(kind: SpiritBeastFacilityKind): string {
  return ({
    incubator: '孵蛋器', iron_mine: '玄鐵礦場', spirit_stone_mine: '靈石礦場', field: '靈田',
    forging: '煉器台', enhancement: '強化台', alchemy: '煉丹爐', egg_enhancement: '靈蛋強化台',
    cultivation: '靈獸培養台', fusion: '靈獸融合台',
  })[kind];
}

export function orderStateLabel(state: SpiritBeastWorkOrderView['state']): string {
  return ({ queued: '等待中', moving: '靈獸前往中', running: '進行中', waiting: '等待材料', completed: '已完成', cancelled: '已取消' })[state];
}

export function jobLabel(key?: string): string | null {
  if (!key) return null;
  const known: Record<string, string> = {
    mine_iron: '採集玄鐵', mine_spirit_stone: '採集靈石', sow: '播種', water: '澆水', harvest: '收割', craft: '製作',
    forging: '煉器', alchemy: '煉丹', enhancement: '強化', mining: '採礦', planting: '種植', building: '營造',
  };
  return known[key] ?? '宗門工作';
}

export function waitReasonLabel(key?: string): string | null {
  if (!key) return null;
  const known: Record<string, string> = {
    spirit_beast_no_worker: '等待可用靈獸', spirit_beast_material_missing: '材料不足',
    spirit_beast_inventory_full: '產物空間不足', spirit_beast_facility_disabled: '設備尚未啟用',
  };
  return known[key] ?? '等待條件完成';
}

export function formatSpiritBeastReason(reasonKey?: string): string {
  const normalized = reasonKey?.trim().toLowerCase() ?? '';
  const known: Record<string, string> = {
    spirit_beast_requires_sect: '加入宗門後才能管理靈獸。',
    spirit_beast_request_id_required: '操作資料不完整，請重新整理後再試。',
    spirit_beast_command_not_ready: '這項宗門功能目前尚未開放。',
    spirit_beast_invalid_target: '這隻靈獸目前不能培養，五星靈獸已達上限。',
    spirit_beast_target_unavailable: '請先收回主獸並解除收藏保護。',
    spirit_beast_requires_ten_materials: '培養需要正好十隻素材靈獸。',
    spirit_beast_duplicate_material: '素材靈獸不可重複選取。',
    spirit_beast_material_unavailable: '素材中有無法使用的靈獸，請重新選擇。',
    spirit_beast_material_grade_star_mismatch: '素材必須與主獸同品同星。',
    spirit_fusion_parent_not_found: '找不到其中一隻融合靈獸，請重新選擇。',
    spirit_fusion_invalid: '這組靈獸不符合融合條件。',
    spirit_egg_not_found: '找不到選取的靈蛋，請重新整理名冊。',
    spirit_hatch_not_found: '找不到這筆孵化紀錄，請重新整理。',
    spirit_work_action_invalid: '這座設備不支援目前的工作。',
    'spirit_beast.order_unavailable': '這筆工作已結束或無法再操作。',
    'spirit_beast.worker_busy': '目前已有親自進行的工作，請先完成或停止它。',
  };
  return known[normalized] ?? '目前無法完成此操作，請重新整理後再試。';
}
