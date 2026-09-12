/**
 * 將物品取得途徑轉成既有導航入口可消費的純資料。
 * 此處不發送 Socket、不判斷連線，也不裁定伺服器尋路結果。
 */
import type { ItemSourceEntry } from './item-sources';

export type ItemSourceNavigation =
  | {
    kind: 'point';
    mapId: string;
    x: number;
    y: number;
    label: string;
  }
  | {
    kind: 'quest';
    questId: string;
    label: string;
  }
  | {
    kind: 'unavailable';
    reason: string;
  };

function resolvePoint(entry: ItemSourceEntry, label: string, missingReason: string): ItemSourceNavigation {
  const { navigationX, navigationY } = entry;
  if (
    typeof navigationX === 'number'
    && typeof navigationY === 'number'
    && Number.isInteger(navigationX)
    && Number.isInteger(navigationY)
  ) {
    return {
      kind: 'point',
      mapId: entry.mapId,
      x: navigationX,
      y: navigationY,
      label,
    };
  }
  return { kind: 'unavailable', reason: missingReason };
}

/** 解析單一取得途徑的可導航目標，未有權威座標時明確回傳不可導航原因。 */
export function resolveItemSourceNavigation(entry: ItemSourceEntry): ItemSourceNavigation {
  switch (entry.kind) {
    case 'quest':
      return entry.questId.trim()
        ? { kind: 'quest', questId: entry.questId, label: `前往任務「${entry.questTitle}」` }
        : { kind: 'unavailable', reason: '此任務缺少可導航的任務識別。' };
    case 'monster_drop':
      return resolvePoint(entry, `前往${entry.monsterName}出沒地`, '尚未收錄此怪物出沒地的精確座標。');
    case 'shop':
      return resolvePoint(entry, `前往${entry.npcName}`, '尚未收錄此商店 NPC 的精確座標。');
    case 'mining':
    case 'search':
      return resolvePoint(entry, `前往${entry.landmarkName}`, '尚未收錄此資源地標的精確座標。');
    case 'alchemy':
      return { kind: 'unavailable', reason: '煉丹需從煉丹面板操作，沒有可自動移動的地圖目標。' };
    case 'forging':
      return { kind: 'unavailable', reason: '煉器需從煉器面板操作，沒有可自動移動的地圖目標。' };
    case 'heavenly_dao_shop':
      return { kind: 'unavailable', reason: '天道商店屬於坊市介面，沒有可自動移動的地圖目標。' };
    case 'runtime_pvp_reward':
      return { kind: 'unavailable', reason: '此戰鬥規則沒有固定可前往的位置。' };
    case 'acquisition_rule':
      return { kind: 'unavailable', reason: '此為通用取得規則，沒有固定可自動移動的位置。' };
  }
}
