import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { detailModalHost } from '../../../ui/detail-modal-host';
import { isReactPanelEnabled } from '../../bridge/panel-flags';
import { SpiritBeastCodexPanel } from './SpiritBeastCodexPanel';

/** 圖鑑只讀取共用名錄，不依賴宗門、玩家倉庫或網路請求。 */
export function openSpiritBeastCodex(): void {
  if (!isReactPanelEnabled('spirit-beast-codex')) return;
  detailModalHost.open({
    ownerId: 'spirit-beast-codex',
    variantClass: 'detail-modal--spirit-beast-codex',
    title: '靈獸圖鑑',
    subtitle: '五行靈獸・宗門夥伴',
    renderBody: (body) => body.replaceChildren(),
    onAfterRender: (body, signal) => {
      const host = document.createElement('div');
      host.className = 'react-panel-host react-panel-host--spirit-beast';
      host.dataset.reactPanel = 'spirit-beast-codex';
      body.replaceChildren(host);
      const root = createRoot(host);
      root.render(<StrictMode><SpiritBeastCodexPanel /></StrictMode>);
      signal.addEventListener('abort', () => { root.unmount(); host.remove(); }, { once: true });
    },
  });
}
