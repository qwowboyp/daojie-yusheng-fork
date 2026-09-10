/** 地圖礦脈設定在模板建置期編譯為座標索引，供實例熱路徑直接讀取。 */
import type { GmMapDocument, GmMapMineralNodeRecord } from '@mud/shared';

export type RuntimeMineralNode = Readonly<{
  name: string;
  itemId: string;
  level: number;
  damageChanceBps: number;
  destroyCount: number;
}>;

/** 以線性地塊索引保存已驗證礦脈，避免每次掉落結算掃描設定陣列。 */
export function buildMapMineralNodeIndex(document: GmMapDocument): ReadonlyMap<number, RuntimeMineralNode> {
  const mineralNodeByTile = new Map<number, RuntimeMineralNode>();
  for (const rawNode of document.mineralNodes ?? []) {
    const node = rawNode as GmMapMineralNodeRecord;
    const tileIndex = node.y * document.width + node.x;
    mineralNodeByTile.set(tileIndex, Object.freeze({
      name: node.name,
      itemId: node.itemId,
      level: node.level,
      damageChanceBps: node.damageChanceBps ?? 50,
      destroyCount: node.destroyCount ?? 1,
    }));
  }
  return mineralNodeByTile;
}

/** 啟動期確認地圖礦脈掉落必須能生成既有內容物品。 */
export function validateMapMineralNodeItemReferences(
  document: GmMapDocument,
  itemIds: ReadonlyMap<string, unknown>,
): string | null {
  for (let index = 0; index < (document.mineralNodes?.length ?? 0); index += 1) {
    const node = document.mineralNodes![index]!;
    if (!itemIds.has(node.itemId)) {
      return `礦脈 ${index + 1} 的掉落物品不存在: ${node.itemId}`;
    }
  }
  return null;
}
