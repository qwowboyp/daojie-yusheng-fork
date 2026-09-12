/** 道具來源入口共用事件，保持原介面的輸入與捲動狀態。 */
import { openItemSourcesPanel } from '../react-ui/panels/item-sources/mount-item-sources-panel';
import { getItemSourceEntryCount } from '../content/item-sources';
import { isReactPanelEnabled } from '../react-ui/bridge/panel-flags';

export function renderItemSourceButton(itemId: string): string {
  if (!isReactPanelEnabled('item-sources')) return '';
  const escapedId = itemId.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const count = getItemSourceEntryCount(itemId);
  return `<button class="small-btn ghost item-source-open" style="min-height:44px" type="button" data-item-source-open="${escapedId}">查看全部取得途徑${count > 0 ? `（${count}）` : ''}</button>`;
}

export function bindItemSourceLinks(root: HTMLElement, signal: AbortSignal): void {
  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-item-source-open]')
      : null;
    if (!button || !root.contains(button)) return;
    event.stopPropagation();
    openItemSourcesPanel({ itemId: button.dataset.itemSourceOpen, opener: button });
  }, { signal, capture: true });
}
