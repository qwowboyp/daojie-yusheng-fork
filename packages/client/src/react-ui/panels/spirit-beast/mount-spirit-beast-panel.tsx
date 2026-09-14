import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SpiritBeastPanel, requestSpiritBeastPanel } from './SpiritBeastPanel';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export function mountReactSpiritBeastPanel(body: HTMLElement, signal?: AbortSignal): void {
  unmountReactSpiritBeastPanel();
  host = document.createElement('div');
  host.className = 'react-panel-host react-panel-host--spirit-beast';
  host.dataset.reactPanel = 'spirit-beast';
  body.replaceChildren(host);
  root = createRoot(host);
  root.render(<StrictMode><SpiritBeastPanel /></StrictMode>);
  requestSpiritBeastPanel();
  signal?.addEventListener('abort', unmountReactSpiritBeastPanel, { once: true });
}

export function unmountReactSpiritBeastPanel(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
