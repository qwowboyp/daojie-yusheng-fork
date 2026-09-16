import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SpiritBeastPanel, requestSpiritBeastPanel } from './SpiritBeastPanel';
import { detailModalHost } from '../../../ui/detail-modal-host';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export function mountReactSpiritBeastPanel(body: HTMLElement, signal?: AbortSignal, buildingId?: string): void {
  unmountReactSpiritBeastPanel();
  host = document.createElement('div');
  host.className = 'react-panel-host react-panel-host--spirit-beast';
  host.dataset.reactPanel = 'spirit-beast';
  body.replaceChildren(host);
  root = createRoot(host);
  root.render(<StrictMode><SpiritBeastPanel buildingId={buildingId} /></StrictMode>);
  requestSpiritBeastPanel();
  signal?.addEventListener('abort', unmountReactSpiritBeastPanel, { once: true });
}

/** 沿用宗門管理的面板與命令，只聚焦玩家點選的設施。 */
export function openSpiritBeastFacility(buildingId: string): void {
  detailModalHost.open({
    ownerId: 'spirit-beast-facility',
    variantClass: 'detail-modal--sect-management',
    title: '宗門設施',
    subtitle: '設施操作・工作排程・產物領取',
    renderBody: (body) => body.replaceChildren(),
    onAfterRender: (body, signal) => mountReactSpiritBeastPanel(body, signal, buildingId),
  });
}

export function unmountReactSpiritBeastPanel(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
