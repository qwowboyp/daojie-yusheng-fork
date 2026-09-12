/**
 * 取得途徑百科的純展示模型；資料只來自本機內容快照與靜態來源目錄。
 */
import { getLocalRealmLevelEntry, resolveTechniqueIdFromBookItem } from '../../../content/local-templates';
import { getTechniqueGradeLabel } from '../../../domain-labels';
import type { ItemSourceEntry, ItemSourceKind } from '../../../content/item-sources';

export interface ItemSourceCatalogItem {
  itemId: string;
  name: string;
  type: string;
  desc?: string;
  techniqueId?: string;
  techniqueLabel?: string;
}

export interface ItemSourcePanelData {
  items: ItemSourceCatalogItem[];
  entriesByItemId: ReadonlyMap<string, readonly ItemSourceEntry[]>;
  sourceKinds: readonly ItemSourceKind[];
  maps: readonly { id: string; name: string }[];
}

export async function loadItemSourcePanelData(): Promise<ItemSourcePanelData> {
  const [{ preloadItemSourceCatalog, getItemSourceEntries }, { LOCAL_EDITOR_CATALOG }] = await Promise.all([
    import('../../../content/item-sources'),
    import('../../../content/editor-catalog'),
  ]);
  await preloadItemSourceCatalog();

  const entriesByItemId = new Map<string, readonly ItemSourceEntry[]>();
  const sourceKinds = new Set<ItemSourceKind>();
  const maps = new Map<string, string>();
  const techniques = new Map(LOCAL_EDITOR_CATALOG.techniques.map((technique) => [technique.id, technique]));
  const items = LOCAL_EDITOR_CATALOG.items
    .filter((item) => item.itemId !== 'mat.technique_unification_test')
    .map((item) => {
      const techniqueId = item.type === 'skill_book' ? resolveTechniqueIdFromBookItem(item) : null;
      const technique = techniqueId ? techniques.get(techniqueId) : undefined;
      const realmLv = technique?.realmLv;
      return {
        itemId: item.itemId,
        name: item.name,
        type: item.type,
        desc: item.desc,
        techniqueId: techniqueId ?? undefined,
        techniqueLabel: technique ? `${getTechniqueGradeLabel(technique.grade)} · 功法境界 ${realmLv ? `${getLocalRealmLevelEntry(realmLv)?.displayName ?? '未知境界'} Lv.${realmLv}` : '未標示'}` : undefined,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));

  for (const item of items) {
    const entries = getItemSourceEntries(item.itemId);
    entriesByItemId.set(item.itemId, entries);
    for (const entry of entries) {
      sourceKinds.add(entry.kind);
      if (entry.mapId && entry.mapName) {
        maps.set(entry.mapId, entry.mapName);
      }
    }
  }

  return {
    items,
    entriesByItemId,
    sourceKinds: [...sourceKinds].sort(),
    maps: [...maps.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant')),
  };
}
