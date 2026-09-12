/** 獨立原生 dialog 的取得途徑百科掛載點，不共用 detailModalHost。 */
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isReactPanelEnabled } from '../../bridge/panel-flags';
import { ItemSourcesPanel } from './ItemSourcesPanel';
import './item-sources.css';

let root: Root | null = null;
let dialog: HTMLDialogElement | null = null;
let host: HTMLDivElement | null = null;
let opener: HTMLElement | null = null;
let isOpen = false;

function render(active: boolean, itemId?: string): void {
  root?.render(<StrictMode><ItemSourcesPanel active={active} initialItemId={itemId} onClose={closeItemSourcesPanel} /></StrictMode>);
}

function restoreOpener(): void {
  const target = opener;
  opener = null;
  requestAnimationFrame(() => {
    if (!isOpen && target?.isConnected) target.focus({ preventScroll: true });
  });
}

function ensureDialog(): HTMLDialogElement {
  if (dialog?.isConnected && root) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'item-sources-dialog';
  dialog.dataset.itemSourcesDialog = 'true';
  dialog.setAttribute('aria-label', '取得途徑百科');
  host = document.createElement('div');
  host.className = 'item-sources-dialog-host';
  dialog.append(host);
  document.body.append(dialog);
  root = createRoot(host);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeItemSourcesPanel();
  });
  dialog.addEventListener('keydown', (event) => {
    // 保留表單與原生 dialog 的預設操作，避免方向鍵與 Esc 傳到遊戲。
    event.stopPropagation();
  });
  dialog.addEventListener('keyup', (event) => event.stopPropagation());
  // 原生 modal 的背景為 inert，無法操作地圖；使用明確返回鈕或 Esc 關閉。
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) event.stopPropagation();
  });
  dialog.addEventListener('close', () => {
    if (!isOpen || dialog?.open) return;
    isOpen = false;
    render(false);
    restoreOpener();
  });
  return dialog;
}

export function shouldUseReactItemSourcesPanel(): boolean {
  return isReactPanelEnabled('item-sources');
}

export function openItemSourcesPanel(options: { itemId?: string; opener?: HTMLElement | null } = {}): void {
  if (!shouldUseReactItemSourcesPanel()) return;
  const nextDialog = ensureDialog();
  opener = options.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  isOpen = true;
  render(true, options.itemId);
  if (!nextDialog.open) nextDialog.showModal();
}

export function closeItemSourcesPanel(): void {
  if (!dialog?.open) return;
  isOpen = false;
  dialog.close();
  render(false);
  restoreOpener();
}
