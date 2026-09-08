/**
 * 可拖拽浮动列表宿主，供 HUD 级轻量列表复用。
 *
 * 只负责位置、折叠和可见性；业务内容和按钮事件仍由各自面板绑定。
 */
import { getResponsiveViewportMetrics, getViewportRoot, shouldUseMobileUi } from './responsive-viewport';
import { bindDesktopWindow } from './desktop-window';

export type FloatingListPanelState = {
  left: number | null;
  top: number | null;
  collapsed: boolean;
  closed: boolean;
};

export type FloatingListPanelOptions = {
  id: string;
  title: string;
  storageKey: string;
  className?: string;
  defaultLeft: number;
  defaultTop: number;
  defaultPosition?: () => { left: number; top: number };
  defaultCollapsed?: boolean;
  dismissible?: boolean;
  minWidth?: number;
  maxWidth?: number;
  onBeforeClose?: () => void;
  onClose?: () => void;
};

const DEFAULT_MIN_WIDTH = 240;
const DEFAULT_MAX_WIDTH = 420;
const VIEWPORT_MARGIN = 8;
const FLOATING_PANEL_BASE_Z_INDEX = 1800;
const floatingPanels = new Set<FloatingListPanel>();

/** 地圖摘要與工作區共用 shell 堆疊；詳情／確認視窗仍由原 host 管理。 */
export function mountFloatingListPanelLayer(shell: HTMLElement): void {
  let layer = shell.querySelector<HTMLElement>(':scope > #game-floating-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'game-floating-layer';
    shell.appendChild(layer);
  }
  for (const panel of floatingPanels) layer.appendChild(panel.root);
}

/** shell 首次顯示後才有實際尺寸，交回原實例校正位置與本地偏好。 */
export function refreshFloatingListPanelLayout(): void {
  for (const panel of floatingPanels) panel.refreshLayout();
}

function bringFloatingPanelToFront(root: HTMLElement): void {
  const ordered = [...floatingPanels].map((panel) => panel.root).filter((panel) => panel.isConnected && panel !== root);
  ordered.push(root);
  ordered.forEach((panel, index) => {
    panel.style.zIndex = String(FLOATING_PANEL_BASE_Z_INDEX + index);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readStoredState(storageKey: string, defaultCollapsed = false): FloatingListPanelState {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { left: null, top: null, collapsed: defaultCollapsed, closed: false };
    }
    const parsed = JSON.parse(raw) as Partial<FloatingListPanelState>;
    return {
      left: typeof parsed.left === 'number' && Number.isFinite(parsed.left) ? parsed.left : null,
      top: typeof parsed.top === 'number' && Number.isFinite(parsed.top) ? parsed.top : null,
      collapsed: parsed.collapsed === true,
      closed: parsed.closed === true,
    };
  } catch {
    return { left: null, top: null, collapsed: defaultCollapsed, closed: false };
  }
}

function writeStoredState(storageKey: string, state: FloatingListPanelState): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // localStorage 不可用时退化为本次会话状态，不影响主界面交互。
  }
}

export class FloatingListPanel {
  readonly root: HTMLElement;
  readonly body: HTMLElement;

  private readonly state: FloatingListPanelState;
  private readonly storageKey: string;
  private readonly defaultLeft: number;
  private readonly defaultTop: number;
  private readonly defaultPosition?: FloatingListPanelOptions['defaultPosition'];
  private readonly dismissible: boolean;
  private positionCustomized: boolean;
  private readonly minWidth: number;
  private readonly maxWidth: number;
  private readonly onBeforeClose: (() => void) | null;
  private readonly onClose: (() => void) | null;
  private readonly eventAbort = new AbortController();
  private transientHidden = false;
  private readonly desktopWindow: ReturnType<typeof bindDesktopWindow>;
  private dragState: {
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null = null;

  constructor(options: FloatingListPanelOptions) {
    this.storageKey = options.storageKey;
    this.defaultLeft = options.defaultLeft;
    this.defaultTop = options.defaultTop;
    this.defaultPosition = options.defaultPosition;
    this.dismissible = options.dismissible !== false;
    this.minWidth = options.minWidth ?? DEFAULT_MIN_WIDTH;
    this.maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
    this.onBeforeClose = options.onBeforeClose ?? null;
    this.onClose = options.onClose ?? null;
    this.state = readStoredState(this.storageKey, options.defaultCollapsed);
    this.positionCustomized = !this.defaultPosition || this.state.left !== null || this.state.top !== null;
    if (!this.dismissible) this.state.closed = false;

    this.root = document.createElement('section');
    this.root.id = options.id;
    this.root.className = `floating-list-panel ${options.className ?? ''}`.trim();
    this.root.setAttribute('aria-label', options.title);
    this.root.style.minWidth = `${this.minWidth}px`;
    this.root.style.maxWidth = `${this.maxWidth}px`;
    this.root.innerHTML = `
      <div class="floating-list-panel__bar" data-floating-list-drag-handle="true">
        <span class="floating-list-panel__title">${options.title}</span>
        <div class="floating-list-panel__tools">
          <button class="floating-list-panel__tool" data-floating-list-collapse="true" type="button" aria-label="摺疊"></button>
          ${this.dismissible ? '<button class="floating-list-panel__tool" data-floating-list-close="true" type="button" aria-label="關閉">×</button>' : ''}
        </div>
      </div>
      <div class="floating-list-panel__body" data-floating-list-body="true"></div>
    `;
    this.body = this.root.querySelector<HTMLElement>('[data-floating-list-body="true"]')!;
    (document.getElementById('game-floating-layer') ?? document.body).appendChild(this.root);
    floatingPanels.add(this);
    bringFloatingPanelToFront(this.root);
    this.bindEvents();
    this.desktopWindow = bindDesktopWindow(this.root, {
      storageKey: this.storageKey, handleSelector: '[data-floating-list-drag-handle]',
      minWidth: this.minWidth, minHeight: 140, drag: false,
      isCollapsed: () => this.state.collapsed,
      onResize: () => this.repositionWithinViewport(),
    });
    this.applyState();
    window.addEventListener('resize', () => this.refreshLayout(), { signal: this.eventAbort.signal });
  }

  updateContent(html: string): void {
    this.body.innerHTML = html.trim();
    this.applyState();
  }

  setTitle(title: string): void {
    const normalized = title.trim() || '浮動列表';
    const titleNode = this.root.querySelector<HTMLElement>('.floating-list-panel__title');
    if (titleNode && titleNode.textContent !== normalized) {
      titleNode.textContent = normalized;
    }
    this.root.setAttribute('aria-label', normalized);
  }

  /** 业务内容尺寸变化后重新把浮窗约束到当前视口。 */
  refreshLayout(): void {
    if (this.root.hidden) {
      return;
    }
    this.desktopWindow.refresh();
    this.repositionWithinViewport();
  }

  setBodyKey(value: string): void {
    this.body.dataset.floatingListBodyKey = value;
  }

  getBodyKey(): string {
    return this.body.dataset.floatingListBodyKey ?? '';
  }

  focusCloseButton(): void {
    this.root.querySelector<HTMLButtonElement>('[data-floating-list-close="true"]')?.focus({ preventScroll: true });
  }

  destroy(): void {
    this.desktopWindow.destroy();
    this.eventAbort.abort();
    floatingPanels.delete(this);
    this.root.remove();
  }

  setTransientHidden(hidden: boolean): void {
    this.transientHidden = hidden;
    if (!hidden) bringFloatingPanelToFront(this.root);
    this.applyState();
  }

  setClosed(closed: boolean): void {
    if (this.state.closed === closed) {
      return;
    }
    this.state.closed = closed;
    if (!closed) bringFloatingPanelToFront(this.root);
    this.persist();
    this.applyState();
  }

  private bindEvents(): void {
    const signal = this.eventAbort.signal;
    const dragHandle = this.root.querySelector<HTMLElement>('[data-floating-list-drag-handle="true"]');
    const collapseButton = this.root.querySelector<HTMLButtonElement>('[data-floating-list-collapse="true"]');
    const closeButton = this.root.querySelector<HTMLButtonElement>('[data-floating-list-close="true"]');

    this.root.addEventListener('pointerdown', () => bringFloatingPanelToFront(this.root), { signal });
    this.root.addEventListener('focusin', () => bringFloatingPanelToFront(this.root), { signal });
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.root.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }, { signal });

    dragHandle?.addEventListener('pointerdown', (event) => {
      if (this.defaultPosition && shouldUseMobileUi(window)) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('button, a, input, select, textarea')) {
        return;
      }
      const rect = this.root.getBoundingClientRect();
      this.dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      dragHandle.setPointerCapture(event.pointerId);
      this.root.classList.add('is-dragging');
      event.preventDefault();
    }, { signal });

    dragHandle?.addEventListener('pointermove', (event) => {
      if (!this.dragState || this.dragState.pointerId !== event.pointerId) {
        return;
      }
      const space = this.getPositionSpace();
      this.positionCustomized = true;
      this.moveTo(
        (event.clientX - this.dragState.offsetX - space.offsetX) / space.scale,
        (event.clientY - this.dragState.offsetY - space.offsetY) / space.scale,
      );
    }, { signal });

    const finishDrag = (event: PointerEvent) => {
      if (!this.dragState || this.dragState.pointerId !== event.pointerId) {
        return;
      }
      this.dragState = null;
      this.root.classList.remove('is-dragging');
      this.persist();
    };
    dragHandle?.addEventListener('pointerup', finishDrag, { signal });
    dragHandle?.addEventListener('pointercancel', finishDrag, { signal });

    collapseButton?.addEventListener('click', () => {
      this.state.collapsed = !this.state.collapsed;
      if (this.state.closed) {
        this.state.closed = false;
      }
      this.persist();
      this.applyState();
    }, { signal });

    closeButton?.addEventListener('click', () => this.close(), { signal });
    dragHandle?.addEventListener('click', (event) => {
      if (!this.defaultPosition || !shouldUseMobileUi(window)) return;
      if (event.target instanceof Element && event.target.closest('button')) return;
      collapseButton?.click();
    }, { signal });
  }

  private close(): void {
    if (!this.dismissible) {
      this.state.collapsed = true;
      this.persist();
      this.applyState();
      return;
    }
    if (this.state.closed) return;
    this.onBeforeClose?.();
    this.state.closed = true;
    this.persist();
    this.applyState();
    this.onClose?.();
  }

  /** 浮窗移入設計畫布後使用畫布座標；尚未掛入的 body 浮窗使用視窗座標。 */
  private getPositionSpace() {
    if (getViewportRoot(document)?.contains(this.root)) {
      const metrics = getResponsiveViewportMetrics();
      return { width: metrics.viewportWidth, height: metrics.viewportHeight,
        scale: metrics.scale, offsetX: metrics.offsetX, offsetY: metrics.offsetY };
    }
    return { width: window.innerWidth, height: window.innerHeight, scale: 1, offsetX: 0, offsetY: 0 };
  }

  private moveTo(left: number, top: number): void {
    const space = this.getPositionSpace();
    const maxLeft = Math.max(VIEWPORT_MARGIN, space.width - this.root.offsetWidth - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, space.height - this.root.offsetHeight - VIEWPORT_MARGIN);
    const boundedLeft = clamp(left, VIEWPORT_MARGIN, maxLeft);
    const boundedTop = clamp(top, VIEWPORT_MARGIN, maxTop);
    if (!(this.defaultPosition && shouldUseMobileUi(window))) {
      this.state.left = boundedLeft;
      this.state.top = boundedTop;
    }
    this.root.style.left = `${boundedLeft}px`;
    this.root.style.top = `${boundedTop}px`;
    this.root.style.right = 'auto';
  }

  private applyState(): void {
    this.root.classList.toggle('is-collapsed', this.state.collapsed);
    this.root.classList.toggle('is-closed', this.state.closed);
    this.root.hidden = this.state.closed || this.transientHidden;
    const collapseButton = this.root.querySelector<HTMLButtonElement>('[data-floating-list-collapse="true"]');
    if (collapseButton) {
      collapseButton.textContent = this.state.collapsed ? '+' : '−';
      collapseButton.setAttribute('aria-label', this.state.collapsed ? '展開' : '摺疊');
      collapseButton.setAttribute('aria-expanded', String(!this.state.collapsed));
    }
    const { left, top } = this.getPreferredPosition();
    this.moveTo(left, top);
    this.desktopWindow.refresh();
    this.moveTo(left, top);
  }

  private repositionWithinViewport(): void {
    const { left, top } = this.getPreferredPosition();
    this.moveTo(left, top);
    this.persist();
  }

  private getPreferredPosition(): { left: number; top: number } {
    if (this.defaultPosition && (!this.positionCustomized || shouldUseMobileUi(window))) return this.defaultPosition();
    return { left: this.state.left ?? this.defaultLeft, top: this.state.top ?? this.defaultTop };
  }

  private persist(): void {
    writeStoredState(this.storageKey, this.positionCustomized ? this.state : { ...this.state, left: null, top: null });
  }
}
