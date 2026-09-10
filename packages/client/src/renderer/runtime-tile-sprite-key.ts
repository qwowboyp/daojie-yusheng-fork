import type { Tile } from '@mud/shared';

/** Canvas 與 Pixi 共用的地塊圖片優先序。 */
export function resolveTopTileSpriteKey(tile: Tile, legacyTileKeys: ReadonlyMap<string, string>): string | null {
  const buildingDefId = typeof tile.buildingDefId === 'string' && tile.buildingDefId.length > 0 ? tile.buildingDefId : null;
  if (buildingDefId) return `building:${buildingDefId}`;
  const structureType = typeof tile.structureType === 'string' && tile.structureType.length > 0 ? tile.structureType : null;
  if (structureType) return `structure:${structureType}`;
  const interactable = Array.isArray(tile.interactableKinds)
    ? tile.interactableKinds.find((kind) => typeof kind === 'string' && kind.length > 0)
    : undefined;
  if (interactable) return `interactable:${interactable}`;
  const surfaceType = typeof tile.surfaceType === 'string' && tile.surfaceType.length > 0 ? tile.surfaceType : null;
  if (surfaceType) return `surface:${surfaceType}`;
  const terrainType = typeof tile.terrainType === 'string' && tile.terrainType.length > 0 ? tile.terrainType : null;
  if (terrainType) return `terrain:${terrainType}`;
  return legacyTileKeys.get(tile.type) ?? null;
}

/** 單格透明物件下方先畫既有地表；地表本身則露出基礎地形。 */
export function resolveTileUnderlaySpriteKey(tile: Tile, topKey: string): string | null {
  if (tile.surfaceType) {
    const key = `surface:${tile.surfaceType}`;
    if (key !== topKey) return key;
  }
  if (tile.terrainType) {
    const key = `terrain:${tile.terrainType}`;
    if (key !== topKey) return key;
  }
  return null;
}
