/** 取得途徑百科的 React 顯示層。 */
import { useEffect, useMemo, useState } from 'react';
import { getItemIconSources, ITEM_ICON_DETAIL_SIZES, ITEM_ICON_LIST_SIZES } from '../../../content/item-art';
import { getItemTypeLabel } from '../../../domain-labels';
import {
  getItemSourceDisplayDetails,
  getItemSourceKindLabel,
  type ItemSourceEntry,
  type ItemSourceKind,
} from '../../../content/item-sources';
import { loadItemSourcePanelData, type ItemSourceCatalogItem, type ItemSourcePanelData } from './model';
import { resolveItemSourceNavigation } from '../../../content/item-source-navigation';
import { navigateToItemSource } from '../../../ui/item-source-navigation';

const PAGE_SIZE = 50;

export interface ItemSourcesPanelProps {
  active: boolean;
  initialItemId?: string;
  onClose: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: ItemSourcePanelData }
  | { status: 'error' };

function ItemArt({ itemId, detail = false }: { itemId: string; detail?: boolean }) {
  const icon = getItemIconSources(itemId);
  if (!icon) return null;
  const pixels = detail ? 80 : 48;
  return (
    <img
      className={`item-art item-art--${detail ? 'detail' : 'list'}`}
      src={icon.src}
      srcSet={icon.srcSet}
      sizes={detail ? ITEM_ICON_DETAIL_SIZES : ITEM_ICON_LIST_SIZES}
      width={pixels}
      height={pixels}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

function SourceRoute({ entry, onNavigate }: { entry: ItemSourceEntry; onNavigate: () => void }) {
  const destination = resolveItemSourceNavigation(entry);
  const [error, setError] = useState<string | null>(null);
  const unavailable = destination.kind === 'unavailable';
  return <li>
    <div className="item-sources-route-details">
      {getItemSourceDisplayDetails(entry).filter((part) => part.tone !== 'map').map((part, index) => (
        <span className={`item-sources-detail-chip item-sources-detail-chip--${part.tone}`} key={`${part.tone}:${index}`}>{part.text}</span>
      ))}
      {unavailable && <span className="item-sources-route-status">{destination.reason}</span>}
      {error && <span className="item-sources-route-status" role="alert">{error}</span>}
    </div>
    <div className="item-sources-route-action">
      <button type="button" className="item-sources-go" data-item-source-go={entry.kind} disabled={unavailable}
        title={unavailable ? destination.reason : destination.label}
        aria-label={unavailable ? '無法自動前往' : destination.label}
        onClick={() => {
          const reason = navigateToItemSource(entry);
          setError(reason);
          if (!reason) onNavigate();
        }}>前往</button>
      {!unavailable && entry.kind === 'monster_drop' && <small>出沒地</small>}
    </div>
  </li>;
}

function ItemSourceDetails({ entries, onNavigate }: { entries: readonly ItemSourceEntry[]; onNavigate: () => void }) {
  const groups = useMemo(() => {
    const byKind = new Map<ItemSourceKind, Map<string, ItemSourceEntry[]>>();
    for (const entry of entries) {
      const mapLabel = entry.mapName || '其他途徑';
      const maps = byKind.get(entry.kind) ?? new Map<string, ItemSourceEntry[]>();
      const groupedEntries = maps.get(mapLabel) ?? [];
      groupedEntries.push(entry);
      maps.set(mapLabel, groupedEntries);
      byKind.set(entry.kind, maps);
    }
    return [...byKind.entries()];
  }, [entries]);

  if (entries.length === 0) {
    return <p className="item-sources-empty-detail">尚未收錄取得途徑</p>;
  }

  return (
    <div className="item-sources-detail-groups">
      {groups.map(([kind, maps]) => (
        <section className="item-sources-source-kind" key={kind}>
          <h3>{getItemSourceKindLabel(kind)}</h3>
          {[...maps.entries()].map(([mapName, mapEntries]) => (
            <div className="item-sources-map-group" key={`${kind}:${mapName}`}>
              <h4>{mapName}</h4>
              <ul>
                {mapEntries.map((entry, index) => (
                  <SourceRoute key={`${kind}:${mapName}:${index}`} entry={entry} onNavigate={onNavigate} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function ItemDetail({ item, entries, onBack, onNavigate }: { item: ItemSourceCatalogItem; entries: readonly ItemSourceEntry[]; onBack: () => void; onNavigate: () => void }) {
  return (
    <aside className="item-sources-detail" aria-live="polite">
      <button className="item-sources-back" type="button" onClick={onBack}>返回清單</button>
      <header className="item-sources-detail-head">
        <ItemArt itemId={item.itemId} detail />
        <div>
          <p>{getItemTypeLabel(item.type)}</p>
          <h2>{item.name}</h2>
          {item.desc && <span>{item.desc}</span>}
        </div>
      </header>
      <p className="item-sources-source-count">已收錄 {entries.length} 項取得途徑</p>
      <ItemSourceDetails entries={entries} onNavigate={onNavigate} />
    </aside>
  );
}

export function ItemSourcesPanel({ active, initialItemId, onClose }: ItemSourcesPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [itemType, setItemType] = useState('');
  const [sourceKind, setSourceKind] = useState('');
  const [mapId, setMapId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setLoadState({ status: 'loading' });
    void loadItemSourcePanelData()
      .then((data) => {
        if (!cancelled) {
          setLoadState({ status: 'ready', data });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState({ status: 'error' });
      });
    return () => { cancelled = true; };
  }, [active, reloadKey]);

  useEffect(() => {
    if (!active || !initialItemId || loadState.status !== 'ready') return;
    if (!loadState.data.items.some((item) => item.itemId === initialItemId)) return;
    setQuery('');
    setItemType('');
    setSourceKind('');
    setMapId('');
    setSelectedItemId(initialItemId);
    setMobileDetail(true);
    setPage(0);
  }, [active, initialItemId, loadState]);

  const data = loadState.status === 'ready' ? loadState.data : null;
  const filteredItems = useMemo(() => {
    if (!data) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hant');
    return data.items.filter((item) => {
      if (normalizedQuery && !`${item.name} ${item.itemId}`.toLocaleLowerCase('zh-Hant').includes(normalizedQuery)) return false;
      if (itemType && item.type !== itemType) return false;
      if (!sourceKind && !mapId) return true;
      const entries = data.entriesByItemId.get(item.itemId) ?? [];
      return entries.some((entry) => (!sourceKind || entry.kind === sourceKind) && (!mapId || entry.mapId === mapId));
    });
  }, [data, itemType, mapId, query, sourceKind]);
  const selectedItem = data?.items.find((item) => item.itemId === selectedItemId) ?? null;
  const selectedEntries = selectedItem && data ? data.entriesByItemId.get(selectedItem.itemId) ?? [] : [];
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const visibleItems = filteredItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    if (page >= totalPages) setPage(totalPages - 1);
  }, [page, totalPages]);

  if (!active) return null;
  if (loadState.status === 'loading') return <div className="item-sources-loading" role="status">正在載入取得途徑…</div>;
  if (loadState.status === 'error') {
    return <div className="item-sources-loading" role="alert"><p>取得途徑載入失敗。</p><button type="button" onClick={() => setReloadKey((value) => value + 1)}>重新載入</button></div>;
  }
  if (!data) return null;

  const itemTypes = [...new Set(data.items.map((item) => item.type))].sort();
  const chooseItem = (itemId: string) => {
    setSelectedItemId(itemId);
    setMobileDetail(true);
  };
  const returnToList = () => setMobileDetail(false);

  return (
    <div className={`item-sources-panel${mobileDetail ? ' item-sources-panel--mobile-detail' : ''}`}>
      <header className="item-sources-titlebar">
        <div><p>百科</p><h1>取得途徑</h1></div>
        <button type="button" data-item-sources-close onClick={onClose} aria-label="返回原介面">返回原介面</button>
      </header>
      <div className="item-sources-filters" aria-label="取得途徑篩選">
        <label>名稱搜尋<input data-item-sources-search value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="搜尋道具名稱" /></label>
        <label>物品類型<select data-item-sources-type-filter value={itemType} onChange={(event) => { setItemType(event.target.value); setPage(0); }}><option value="">全部類型</option>{itemTypes.map((type) => <option value={type} key={type}>{getItemTypeLabel(type)}</option>)}</select></label>
        <label>來源方式<select data-item-sources-kind-filter value={sourceKind} onChange={(event) => { setSourceKind(event.target.value); setPage(0); }}><option value="">全部方式</option>{data.sourceKinds.map((kind) => <option value={kind} key={kind}>{getItemSourceKindLabel(kind)}</option>)}</select></label>
        <label>地圖<select data-item-sources-map-filter value={mapId} onChange={(event) => { setMapId(event.target.value); setPage(0); }}><option value="">全部地圖</option>{data.maps.map((map) => <option value={map.id} key={map.id}>{map.name}</option>)}</select></label>
      </div>
      <div className="item-sources-body">
        <section className="item-sources-list" aria-label="物品清單">
          <p className="item-sources-match-count" data-item-sources-match-count>符合 {filteredItems.length} 項</p>
          {visibleItems.length === 0 ? <p className="item-sources-empty-list">沒有符合條件的物品</p> : visibleItems.map((item) => (
            <button className={`item-sources-item${item.itemId === selectedItemId ? ' is-selected' : ''}`} data-item-sources-item={item.itemId} type="button" key={item.itemId} onClick={() => chooseItem(item.itemId)} aria-pressed={item.itemId === selectedItemId}>
              <ItemArt itemId={item.itemId} />
              <span><strong>{item.name}</strong><small>{getItemTypeLabel(item.type)}</small></span>
            </button>
          ))}
          {filteredItems.length > PAGE_SIZE && <nav className="item-sources-pagination" aria-label="清單分頁"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一頁</button><span>{page + 1} / {totalPages}</span><button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>下一頁</button></nav>}
        </section>
        {selectedItem ? <ItemDetail key={selectedItem.itemId} item={selectedItem} entries={selectedEntries} onBack={returnToList} onNavigate={onClose} /> : <aside className="item-sources-detail item-sources-detail--placeholder"><p>選擇物品即可查看完整取得途徑。</p></aside>}
      </div>
    </div>
  );
}
