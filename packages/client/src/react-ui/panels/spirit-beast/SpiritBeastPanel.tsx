/** 宗門核心中的靈獸管理分頁；只呈現服務端快照與收集玩家操作意圖。 */
import { memo, useState } from 'react';
import { SpiritBeastCollectionTab } from './SpiritBeastCollectionTab';
import { SpiritBeastCodexTab, SpiritBeastFusionTab, SpiritBeastGrowthTab } from './SpiritBeastGrowthTab';
import { SpiritBeastIncubationTab } from './SpiritBeastIncubationTab';
import { SpiritBeastWorkTab } from './SpiritBeastWorkTab';
import { formatSpiritBeastReason } from './spirit-beast-display';
import { requestSpiritBeastPanel, useSpiritBeastStore } from './spirit-beast-panel-model';

export { requestSpiritBeastPanel, setSpiritBeastCallbacks, spiritBeastStore } from './spirit-beast-panel-model';
export type { SpiritBeastCallbacks, SpiritBeastPanelState } from './spirit-beast-panel-model';

export type SpiritBeastTab = 'beasts' | 'work' | 'incubation' | 'growth' | 'fusion' | 'codex';

const TAB_LABELS: Array<{ id: SpiritBeastTab; label: string }> = [
  { id: 'beasts', label: '我的靈獸' },
  { id: 'work', label: '宗門工作' },
  { id: 'incubation', label: '孵蛋與強化' },
  { id: 'growth', label: '培養' },
  { id: 'fusion', label: '融合' },
  { id: 'codex', label: '靈獸圖鑑' },
];

export const SpiritBeastPanel = memo(function SpiritBeastPanel() {
  const { view, loading, pending, error, result } = useSpiritBeastStore();
  const [tab, setTab] = useState<SpiritBeastTab>('beasts');
  const busy = pending.length > 0;
  if (!view) {
    return (
      <div className="spirit-beast-empty">
        <p>{loading ? '正在讀取靈獸名冊…' : error || '尚未取得靈獸資料。'}</p>
        <button type="button" className="small-btn" onClick={requestSpiritBeastPanel} disabled={loading}>重新讀取</button>
      </div>
    );
  }
  return (
    <div className="spirit-beast-panel" data-spirit-beast-root="true" aria-busy={loading || busy}>
      <header className="spirit-beast-heading">
        <div><p>宗門核心</p><h2>靈獸</h2></div>
        <button type="button" className="small-btn ghost" onClick={requestSpiritBeastPanel} disabled={loading}>重新整理</button>
      </header>
      <nav className="spirit-beast-tabs" aria-label="靈獸管理">
        {TAB_LABELS.map((entry) => (
          <button
            type="button"
            key={entry.id}
            data-spirit-beast-tab={entry.id}
            aria-current={tab === entry.id ? 'page' : undefined}
            className={tab === entry.id ? 'active' : ''}
            onClick={() => setTab(entry.id)}
          >{entry.label}</button>
        ))}
      </nav>
      {!view.canManage && view.reasonKey ? <p className="spirit-beast-feedback is-error" role="alert">{formatSpiritBeastReason(view.reasonKey)}</p> : null}
      {error ? <p className="spirit-beast-feedback is-error" role="alert">{error}</p> : null}
      {result ? <p className="spirit-beast-feedback" role="status">{result}</p> : null}
      <div className="spirit-beast-content" data-spirit-beast-active-tab={tab}>
        {tab === 'beasts' ? <SpiritBeastCollectionTab view={view} busy={busy} /> : null}
        {tab === 'work' ? <SpiritBeastWorkTab view={view} busy={busy} /> : null}
        {tab === 'incubation' ? <SpiritBeastIncubationTab view={view} busy={busy} /> : null}
        {tab === 'growth' ? <SpiritBeastGrowthTab view={view} busy={busy} /> : null}
        {tab === 'fusion' ? <SpiritBeastFusionTab view={view} busy={busy} /> : null}
        {tab === 'codex' ? <SpiritBeastCodexTab /> : null}
      </div>
    </div>
  );
});
