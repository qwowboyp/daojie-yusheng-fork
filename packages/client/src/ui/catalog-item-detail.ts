/**
 * 本文件是客户端 DOM UI 的 catalog item detail 模块，负责材料详情弹层。
 *
 * 使用独立 native dialog，避免占用 detailModalHost 而关闭炼器／炼丹工作台。
 */
import type { ItemStack } from '@mud/shared';
import {
  getItemSourceDisplayDetails,
  getItemSourceEntries,
  getItemSourceKindLabel,
  hasLoadedItemSourceCatalog,
  preloadItemSourceCatalog,
  type ItemSourceEntry,
} from '../content/item-sources';
import { resolveItemSourceNavigation } from '../content/item-source-navigation';
import { renderItemIcon } from '../content/item-art';
import { getLocalItemTemplate } from '../content/local-templates';
import { getItemTypeLabel } from '../domain-labels';
import { describeMaterialValueDetails } from './equipment-tooltip';
import { bindItemSourceLinks, renderItemSourceButton } from './item-source-links';
import { navigateToItemSource } from './item-source-navigation';
import './catalog-item-detail.css';

const UNKNOWN_ITEM_NAME = '未知物品';
const GO_LABEL = '前往目標';

type CatalogItemDetailOptions = {
  itemId: string;
  opener?: HTMLElement | null;
};

let dialog: HTMLDialogElement | null = null;
let currentItemId: string | null = null;
let currentEntries: ItemSourceEntry[] = [];
let openerEl: HTMLElement | null = null;
let restoreOpenerOnClose = true;
let dialogAbort: AbortController | null = null;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value);
}

function ensureDialog(): HTMLDialogElement {
  if (dialog?.isConnected) {
    return dialog;
  }
  const node = document.createElement('dialog');
  node.className = 'catalog-item-detail-dialog';
  node.setAttribute('aria-labelledby', 'catalog-item-detail-title');
  node.addEventListener('cancel', () => {
    restoreOpenerOnClose = true;
  });
  node.addEventListener('close', () => {
    dialogAbort?.abort();
    dialogAbort = null;
    currentItemId = null;
    currentEntries = [];
    const opener = openerEl;
    openerEl = null;
    if (restoreOpenerOnClose) {
      opener?.focus();
    }
    restoreOpenerOnClose = true;
  });
  document.body.append(node);
  dialog = node;
  return node;
}

function buildLocalItemStack(itemId: string): ItemStack | null {
  const template = getLocalItemTemplate(itemId);
  if (!template) {
    return null;
  }
  return {
    ...template,
    count: 1,
    desc: template.desc ?? '',
  };
}

function renderSourceRow(entry: ItemSourceEntry, index: number): string {
  const details = getItemSourceDisplayDetails(entry);
  const navigation = resolveItemSourceNavigation(entry);
  const canGo = navigation.kind !== 'unavailable';
  const title = canGo ? GO_LABEL : navigation.reason;
  const chips = details
    .map((detail) => `<span class="inventory-source-chip inventory-source-chip--${escapeHtmlAttr(detail.tone)}">${escapeHtml(detail.text)}</span>`)
    .join('');
  return `
    <li class="catalog-item-source-row">
      <div class="catalog-item-source-copy">
        <span class="inventory-source-kind">${escapeHtml(getItemSourceKindLabel(entry.kind))}</span>
        <span class="inventory-source-detail">${chips}</span>
      </div>
      <button
        type="button"
        class="small-btn catalog-item-source-go"
        data-catalog-item-source-go="${index}"
        ${canGo ? '' : 'disabled'}
        title="${escapeHtmlAttr(title)}"
      >${GO_LABEL}</button>
    </li>
  `;
}

function renderSourceSection(itemId: string): string {
  currentEntries = getItemSourceEntries(itemId);
  if (currentEntries.length === 0) {
    const emptyText = hasLoadedItemSourceCatalog()
      ? '尚無靜態取得途徑。'
      : '靜態來源加載中，請稍候。';
    return `
      <section class="catalog-item-detail-sources" data-catalog-item-source-section="true">
        <h3>取得途徑</h3>
        <p class="catalog-item-detail-empty">${escapeHtml(emptyText)}</p>
        ${renderItemSourceButton(itemId)}
      </section>
    `;
  }
  return `
    <section class="catalog-item-detail-sources" data-catalog-item-source-section="true">
      <h3>取得途徑</h3>
      <ul class="catalog-item-source-list">
        ${currentEntries.map((entry, index) => renderSourceRow(entry, index)).join('')}
      </ul>
      <p class="catalog-item-detail-nav-error" data-catalog-item-nav-error hidden></p>
      ${renderItemSourceButton(itemId)}
    </section>
  `;
}

function renderDialogHtml(itemId: string): string {
  const stack = buildLocalItemStack(itemId);
  const name = stack?.name?.trim() && stack.name !== itemId ? stack.name : UNKNOWN_ITEM_NAME;
  const typeLabel = stack ? getItemTypeLabel(stack.type) : '未知';
  const desc = stack?.desc?.trim() || '尚無本地物品資料。';
  const materialLines = stack ? describeMaterialValueDetails(stack) : [];
  return `
    <div class="catalog-item-detail-panel">
      <header class="catalog-item-detail-titlebar">
        <div>
          <p>材料詳情</p>
          <h2 id="catalog-item-detail-title">${escapeHtml(name)}</h2>
        </div>
        <button type="button" class="small-btn ghost" data-catalog-item-detail-close="true">關閉</button>
      </header>
      <div class="catalog-item-detail-body">
        <div class="catalog-item-detail-head">
          ${renderItemIcon(itemId, 'detail')}
          <dl class="catalog-item-detail-meta">
            <div><dt>類型</dt><dd>${escapeHtml(typeLabel)}</dd></div>
          </dl>
        </div>
        <p class="catalog-item-detail-desc">${escapeHtml(desc)}</p>
        ${materialLines.length > 0 ? `<ul class="catalog-item-detail-stats">${materialLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}
        ${renderSourceSection(itemId)}
      </div>
    </div>
  `;
}

function setNavError(message: string | null): void {
  const errorNode = dialog?.querySelector<HTMLElement>('[data-catalog-item-nav-error]');
  if (!errorNode) {
    return;
  }
  if (!message) {
    errorNode.hidden = true;
    errorNode.textContent = '';
    return;
  }
  errorNode.hidden = false;
  errorNode.textContent = message;
}

function bindDialog(root: HTMLDialogElement): void {
  dialogAbort?.abort();
  dialogAbort = new AbortController();
  const { signal } = dialogAbort;
  root.addEventListener('keydown', (event) => {
    event.stopPropagation();
  }, { signal });
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null;
    if (!target || !root.contains(target)) {
      return;
    }
    if (target.dataset.catalogItemDetailClose === 'true') {
      event.preventDefault();
      closeCatalogItemDetail();
      return;
    }
    const goIndex = target.dataset.catalogItemSourceGo;
    if (goIndex === undefined) {
      return;
    }
    event.preventDefault();
    const entry = currentEntries[Number.parseInt(goIndex, 10)];
    if (!entry) {
      return;
    }
    const error = navigateToItemSource(entry);
    if (error) {
      setNavError(error);
      return;
    }
    restoreOpenerOnClose = false;
    closeCatalogItemDetail();
  }, { signal });
  bindItemSourceLinks(root, signal);
}

function paintDialog(itemId: string): void {
  const root = ensureDialog();
  currentItemId = itemId;
  root.innerHTML = renderDialogHtml(itemId);
  bindDialog(root);
}

/** 打开材料详情；不占用工作台的 detailModalHost。 */
export function openCatalogItemDetail(options: CatalogItemDetailOptions): void {
  const itemId = options.itemId.trim();
  if (!itemId) {
    return;
  }
  openerEl = options.opener ?? null;
  restoreOpenerOnClose = true;
  paintDialog(itemId);
  const root = ensureDialog();
  if (!root.open) {
    root.showModal();
  }
  void preloadItemSourceCatalog().then(() => {
    if (currentItemId === itemId && root.open) {
      paintDialog(itemId);
    }
  });
}

export function closeCatalogItemDetail(): void {
  dialog?.close();
}
