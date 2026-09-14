import { useState } from 'react';
import type { S2C_ShenxingDestinations } from '@mud/shared';

export interface ShenxingTravelView {
  itemName: string;
  data: S2C_ShenxingDestinations | null;
  pending: 'loading' | 'confirming' | null;
  error: string;
  confirmedMapId: string | null;
}

export function ShenxingTravelPanel({ view, onConfirm, onReload, onClose }: {
  view: ShenxingTravelView;
  onConfirm(mapId: string): void;
  onReload(): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | 'town' | 'wild'>('all');
  const [selected, setSelected] = useState('');
  const maps = view.data?.destinations ?? [];
  const visible = maps.filter((map) => (category === 'all' || category === map.category) && map.name.includes(query.trim()));
  const selectedMap = maps.find((map) => map.mapId === (view.confirmedMapId ?? selected));
  const locked = view.pending !== null || view.confirmedMapId !== null;
  const remaining = view.data?.cooldownRemainingTicks ?? 0;
  return <section className="shenxing-panel" aria-labelledby="shenxing-title">
    <header className="shenxing-header">
      <div><h2 id="shenxing-title">神行 · 選擇目的地</h2><p>{view.itemName}</p></div>
      <button type="button" onClick={onClose} aria-label="關閉神行選單">關閉</button>
    </header>
    <p className="shenxing-note">選好城鎮或野外後確認傳送，成功後才消耗一枚丹藥。</p>
    {view.data && <p className="shenxing-cooldown">使用後共用冷卻 {view.data.cooldownTicks} 秒{remaining > 0 ? ` · 目前尚餘 ${remaining} 秒，請稍後重新載入` : ''}</p>}
    <div className="shenxing-filters">
      <label>搜尋地圖<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="輸入地圖名稱" disabled={locked} /></label>
      <label>地圖類型<select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} disabled={locked}>
        <option value="all">全部</option><option value="town">城鎮</option><option value="wild">野外</option>
      </select></label>
    </div>
    <div className="shenxing-map-list" role="group" aria-label="可傳送地圖" aria-busy={view.pending === 'loading'}>
      {view.pending === 'loading' && <p role="status">正在確認可前往的地圖…</p>}
      {view.pending !== 'loading' && visible.length === 0 && <p>目前沒有符合條件的目的地。</p>}
      {visible.map((map) => <button key={map.mapId} type="button" data-shenxing-map={map.mapId}
        className={`shenxing-map${selectedMap?.mapId === map.mapId ? ' is-selected' : ''}`}
        aria-pressed={selectedMap?.mapId === map.mapId} disabled={locked} onClick={() => setSelected(map.mapId)}>
        <strong>{map.name}</strong><span>{map.category === 'town' ? '城鎮' : '野外'} · 地圖等級 {map.mapLv}</span>
      </button>)}
    </div>
    <footer className="shenxing-footer">
      <p className="shenxing-feedback" role={view.error ? 'alert' : 'status'}>{view.error || (view.pending === 'confirming' ? '正在傳送，請稍候…' : selectedMap ? `目的地：${selectedMap.name}` : '請選擇一處目的地。')}</p>
      <div className="shenxing-actions">
        <button type="button" onClick={onReload} disabled={view.pending !== null || view.confirmedMapId !== null}>重新載入</button>
        <button type="button" className="shenxing-confirm" data-shenxing-confirm="true"
          disabled={!selectedMap || view.pending !== null || remaining > 0}
          onClick={() => selectedMap && onConfirm(selectedMap.mapId)}>{view.confirmedMapId ? '重試確認' : '消耗一枚並傳送'}</button>
      </div>
    </footer>
  </section>;
}
