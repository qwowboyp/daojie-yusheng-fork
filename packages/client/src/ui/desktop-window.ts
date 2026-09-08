import {
  clientToViewportPoint,
  getResponsiveViewportMetrics,
  getViewportRoot,
  RESPONSIVE_VIEWPORT_CHANGE_EVENT,
  shouldUseMobileUi,
} from './responsive-viewport';

export type DesktopWindowStorageKey = string | (() => string);

export type DesktopWindowOptions = {
  storageKey: DesktopWindowStorageKey;
  handleSelector: string;
  minWidth: number;
  minHeight: number;
  isCollapsed?: () => boolean;
  drag?: boolean;
  onResize?: () => void;
};

export type DesktopWindowController = {
  refresh: () => void;
  destroy: () => void;
};

type FrameProperty = 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height' | 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight' | 'position' | 'margin' | 'transform';

type Geometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type StoredGeometry = Partial<Geometry>;

type PointerState = {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
};

const FRAME_PROPERTIES: readonly FrameProperty[] = [
  'left', 'right', 'top', 'bottom', 'width', 'height',
  'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'position', 'margin', 'transform',
];
const VIEWPORT_MARGIN = 8;
const KEYBOARD_RESIZE_STEP = 8;

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStorage(storageKey: string): StoredGeometry {
  try {
    const raw = window.localStorage.getItem(`desktop-window:${storageKey}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      left: finiteNumber(parsed.left) ?? undefined,
      top: finiteNumber(parsed.top) ?? undefined,
      width: finitePositive(parsed.width) ?? undefined,
      height: finitePositive(parsed.height) ?? undefined,
    };
  } catch {
    return {};
  }
}

function writeStorage(storageKey: string, geometry: Geometry): void {
  try {
    window.localStorage.setItem(`desktop-window:${storageKey}`, JSON.stringify({
      left: geometry.left,
      top: geometry.top,
      width: geometry.width,
      height: geometry.height,
    }));
  } catch {
    // 儲存空間不可用時維持本次頁面工作階段的幾何狀態。
  }
}

function readStyleNumber(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getLogicalSpace(element: HTMLElement): { width: number; height: number } {
  const metrics = getResponsiveViewportMetrics(window);
  if (getViewportRoot()?.contains(element)) {
    return { width: Math.max(1, metrics.viewportWidth), height: Math.max(1, metrics.viewportHeight) };
  }
  return { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) };
}

function readElementSize(element: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(element);
  const width = element.offsetWidth || readStyleNumber(style.width) || 0;
  const height = element.offsetHeight || readStyleNumber(style.height) || 0;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function readLogicalGeometry(element: HTMLElement): Geometry {
  const space = getLogicalSpace(element);
  const style = getComputedStyle(element);
  const { width, height } = readElementSize(element);
  const leftValue = readStyleNumber(style.left);
  const rightValue = readStyleNumber(style.right);
  const topValue = readStyleNumber(style.top);
  const bottomValue = readStyleNumber(style.bottom);
  const left = leftValue ?? (rightValue === null ? element.offsetLeft : space.width - rightValue - width);
  const top = topValue ?? (bottomValue === null ? element.offsetTop : space.height - bottomValue - height);
  return { left, top, width, height };
}

function clampGeometry(
  element: HTMLElement,
  geometry: Geometry,
  minWidth: number,
  minHeight: number,
): Geometry {
  const space = getLogicalSpace(element);
  const availableWidth = Math.max(1, space.width - VIEWPORT_MARGIN * 2);
  const availableHeight = Math.max(1, space.height - VIEWPORT_MARGIN * 2);
  const minW = Math.min(Math.max(1, minWidth), availableWidth);
  const minH = Math.min(Math.max(1, minHeight), availableHeight);
  const width = Math.min(Math.max(minW, geometry.width), availableWidth);
  const height = Math.min(Math.max(minH, geometry.height), availableHeight);
  const left = Math.min(Math.max(VIEWPORT_MARGIN, geometry.left), Math.max(VIEWPORT_MARGIN, space.width - width - VIEWPORT_MARGIN));
  const top = Math.min(Math.max(VIEWPORT_MARGIN, geometry.top), Math.max(VIEWPORT_MARGIN, space.height - height - VIEWPORT_MARGIN));
  return { left, top, width, height };
}

function setFrameProperty(element: HTMLElement, property: FrameProperty, value: string): void {
  element.style[property] = value;
}

export function bindDesktopWindow(
  element: HTMLElement,
  options: DesktopWindowOptions,
): DesktopWindowController {
  const dragEnabled = options.drag !== false;
  const originalInline = Object.fromEntries(FRAME_PROPERTIES.map((property) => [property, element.style[property]])) as Record<FrameProperty, string>;
  const resizeGrip = document.createElement('button');
  resizeGrip.type = 'button';
  resizeGrip.className = 'desktop-window-resize';
  resizeGrip.setAttribute('aria-label', '調整視窗大小');
  resizeGrip.dataset.desktopWindowResize = 'true';
  resizeGrip.title = '調整視窗大小';
  resizeGrip.textContent = '↘';
  resizeGrip.style.position = 'absolute';
  resizeGrip.style.right = '4px';
  resizeGrip.style.bottom = '4px';
  resizeGrip.style.width = '24px';
  resizeGrip.style.height = '24px';
  resizeGrip.style.cursor = 'nwse-resize';
  element.appendChild(resizeGrip);

  let active = false;
  let activeStorageKey: string | null = null;
  let expandedSize: { width: number; height: number } | null = null;
  let collapsed = false;
  let pointerState: PointerState | null = null;

  const resolveStorageKey = (): string => {
    try {
      const value = typeof options.storageKey === 'function' ? options.storageKey() : options.storageKey;
      return String(value ?? '').trim();
    } catch {
      return '';
    }
  };

  const restoreOriginalInline = (): void => {
    for (const property of FRAME_PROPERTIES) setFrameProperty(element, property, originalInline[property]);
  };

  const setActiveFrame = (enabled: boolean): void => {
    element.dataset.desktopWindow = enabled ? 'true' : 'false';
    element.classList.toggle('desktop-window--active', enabled);
    if (!enabled) {
      element.classList.remove('desktop-window--dragging', 'desktop-window--resizing', 'desktop-window--collapsed');
      delete element.dataset.desktopWindowCollapsed;
      resizeGrip.hidden = true;
      restoreOriginalInline();
      active = false;
      pointerState = null;
    } else {
      active = true;
      setFrameProperty(element, 'maxWidth', 'none');
      setFrameProperty(element, 'maxHeight', 'none');
      if (dragEnabled) {
        setFrameProperty(element, 'position', 'fixed');
        setFrameProperty(element, 'margin', '0');
        setFrameProperty(element, 'transform', 'none');
      }
    }
  };

  const applyGeometry = (geometry: Geometry, applyPosition: boolean): Geometry => {
    const clamped = clampGeometry(element, geometry, options.minWidth, collapsed ? 1 : options.minHeight);
    setFrameProperty(element, 'width', `${clamped.width}px`);
    if (collapsed) {
      setFrameProperty(element, 'height', 'auto');
      setFrameProperty(element, 'minHeight', '0px');
    } else {
      setFrameProperty(element, 'height', `${clamped.height}px`);
    }
    if (applyPosition) {
      setFrameProperty(element, 'left', `${clamped.left}px`);
      setFrameProperty(element, 'top', `${clamped.top}px`);
      setFrameProperty(element, 'right', 'auto');
      setFrameProperty(element, 'bottom', 'auto');
    }
    return clamped;
  };

  const updateCollapsedState = (): void => {
    const nextCollapsed = options.isCollapsed?.() ?? false;
    const wasCollapsed = collapsed;
    if (nextCollapsed && !collapsed) {
      const current = readElementSize(element);
      expandedSize = { width: current.width, height: current.height };
    }
    collapsed = nextCollapsed;
    if (!nextCollapsed && wasCollapsed) {
      setFrameProperty(element, 'height', originalInline.height);
      setFrameProperty(element, 'minHeight', originalInline.minHeight);
      applyGeometry({ ...readLogicalGeometry(element), ...expandedSize }, dragEnabled);
    }
    collapsed = nextCollapsed;
    element.dataset.desktopWindowCollapsed = nextCollapsed ? 'true' : 'false';
    element.classList.toggle('desktop-window--collapsed', nextCollapsed);
    resizeGrip.hidden = !active || nextCollapsed;
    if (nextCollapsed) {
      setFrameProperty(element, 'height', 'auto');
      setFrameProperty(element, 'minHeight', '0px');
    } else {
      setFrameProperty(element, 'minHeight', originalInline.minHeight);
    }
  };

  const refresh = (): void => {
    const mobile = shouldUseMobileUi(window);
    if (mobile) {
      setActiveFrame(false);
      activeStorageKey = null;
      expandedSize = null;
      collapsed = false;
      return;
    }

    if (!element.getClientRects().length) {
      resizeGrip.hidden = true;
      return;
    }
    const storageKey = resolveStorageKey();
    if (storageKey !== activeStorageKey) {
      restoreOriginalInline();
      element.dataset.desktopWindow = 'false';
      const defaultGeometry = readLogicalGeometry(element);
      setActiveFrame(true);
      activeStorageKey = storageKey;
      expandedSize = null;
      collapsed = false;
      const stored = storageKey ? readStorage(storageKey) : {};
      const restored: Geometry = {
        left: stored.left ?? defaultGeometry.left,
        top: stored.top ?? defaultGeometry.top,
        width: stored.width ?? defaultGeometry.width,
        height: stored.height ?? defaultGeometry.height,
      };
      collapsed = options.isCollapsed?.() ?? false;
      // 初始收合時尚未量到完整內容，展開後再從 CSS 取得預設高度。
      if (collapsed && stored.height !== undefined) expandedSize = { width: restored.width, height: restored.height };
      applyGeometry(restored, dragEnabled);
    }
    const current = readLogicalGeometry(element);
    const clamped = applyGeometry(current, false);
    if (dragEnabled && (element.style.left !== '' || element.style.top !== '')) {
      applyGeometry(clamped, true);
    }
    updateCollapsedState();
  };

  const pointerToLogical = (event: PointerEvent): { x: number; y: number } => {
    if (getViewportRoot()?.contains(element)) return clientToViewportPoint(window, event.clientX, event.clientY);
    return { x: event.clientX, y: event.clientY };
  };

  const resizeGeometry = (geometry: Geometry): void => {
    const space = getLogicalSpace(element);
    applyGeometry({ ...geometry,
      width: Math.min(geometry.width, space.width - geometry.left - VIEWPORT_MARGIN),
      height: Math.min(geometry.height, space.height - geometry.top - VIEWPORT_MARGIN),
    }, false);
  };

  const finishPointer = (event: PointerEvent): void => {
    if (!pointerState || pointerState.pointerId !== event.pointerId) return;
    const resized = element.classList.contains('desktop-window--resizing');
    const current = readLogicalGeometry(element);
    const finalGeometry = collapsed && expandedSize ? { ...current, ...expandedSize } : current;
    if (activeStorageKey) writeStorage(activeStorageKey, finalGeometry);
    pointerState = null;
    element.classList.remove('desktop-window--dragging', 'desktop-window--resizing');
    if (resized) options.onResize?.();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!active || shouldUseMobileUi(window) || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.desktop-window-resize')) {
      if (collapsed) return;
      const point = pointerToLogical(event);
      const geometry = readLogicalGeometry(element);
      pointerState = { pointerId: event.pointerId, startX: point.x, startY: point.y,
        startLeft: geometry.left, startTop: geometry.top, startWidth: geometry.width, startHeight: geometry.height };
      resizeGrip.setPointerCapture(event.pointerId);
      element.classList.add('desktop-window--resizing');
      event.preventDefault();
      return;
    }
    if (!dragEnabled) return;
    const handle = target.closest(options.handleSelector);
    if (!(handle instanceof HTMLElement) || !element.contains(handle)) return;
    if (target.closest('button, input, select, textarea, a')) return;
    const point = pointerToLogical(event);
    const geometry = readLogicalGeometry(element);
    pointerState = { pointerId: event.pointerId, startX: point.x, startY: point.y,
      startLeft: geometry.left, startTop: geometry.top, startWidth: geometry.width, startHeight: geometry.height };
    handle.setPointerCapture(event.pointerId);
    element.classList.add('desktop-window--dragging');
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!pointerState || pointerState.pointerId !== event.pointerId) return;
    const point = pointerToLogical(event);
    const geometry = readLogicalGeometry(element);
    if (element.classList.contains('desktop-window--resizing')) {
      resizeGeometry({ ...geometry, width: pointerState.startWidth + point.x - pointerState.startX,
        height: pointerState.startHeight + point.y - pointerState.startY });
    } else {
      applyGeometry({ ...geometry, left: pointerState.startLeft + point.x - pointerState.startX,
        top: pointerState.startTop + point.y - pointerState.startY,
        width: pointerState.startWidth, height: pointerState.startHeight }, true);
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!active || collapsed) return;
    let widthDelta = 0;
    let heightDelta = 0;
    if (event.key === 'ArrowRight') widthDelta = KEYBOARD_RESIZE_STEP;
    if (event.key === 'ArrowLeft') widthDelta = -KEYBOARD_RESIZE_STEP;
    if (event.key === 'ArrowDown') heightDelta = KEYBOARD_RESIZE_STEP;
    if (event.key === 'ArrowUp') heightDelta = -KEYBOARD_RESIZE_STEP;
    if (widthDelta === 0 && heightDelta === 0) return;
    const current = readLogicalGeometry(element);
    resizeGeometry({ ...current, width: current.width + widthDelta, height: current.height + heightDelta });
    options.onResize?.();
    event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!active || !activeStorageKey || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const current = readLogicalGeometry(element);
    const geometry = collapsed && expandedSize ? { ...current, ...expandedSize } : current;
    writeStorage(activeStorageKey, geometry);
  };

  const onPointerUp = (event: PointerEvent): void => finishPointer(event);
  const onResponsiveChange = (): void => refresh();
  const onResize = (): void => refresh();
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  resizeGrip.addEventListener('keydown', onKeyDown);
  resizeGrip.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
  window.addEventListener(RESPONSIVE_VIEWPORT_CHANGE_EVENT, onResponsiveChange);
  refresh();

  return {
    refresh,
    destroy: () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener(RESPONSIVE_VIEWPORT_CHANGE_EVENT, onResponsiveChange);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      resizeGrip.removeEventListener('keydown', onKeyDown);
      resizeGrip.removeEventListener('keyup', onKeyUp);
      resizeGrip.remove();
      restoreOriginalInline();
      element.classList.remove('desktop-window--active', 'desktop-window--dragging', 'desktop-window--resizing', 'desktop-window--collapsed');
      delete element.dataset.desktopWindow;
      delete element.dataset.desktopWindowCollapsed;
    },
  };
}
