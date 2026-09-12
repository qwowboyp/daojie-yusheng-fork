/**
 * 本文件属于客户端地图模块，负责相机、交互、投影、渲染适配或地图运行态组织。
 *
 * 维护时要保证表现层只处理显示和输入命中，移动合法性、占位和地图权威状态仍以服务端为准。
 */
import { getCellSize, getZoom, MAX_ZOOM, MIN_ZOOM } from '../../display';
import type { CameraController } from '../camera/camera-controller';
import type { TopdownProjection } from '../projection/topdown-projection';
import type {
  MapInteractionTarget,
  MapRuntimeInteractionCallbacks,
  MapStoreSnapshot,
} from '../types';

/** 提供当前地图快照的读取函数。 */
type SnapshotProvider = () => MapStoreSnapshot;

type PointerPosition = { clientX: number; clientY: number };
const TOUCH_TAP_SLOP = 10;

/** 處理地圖點擊、懸停與雙指縮放，將點擊轉為交互目標座標。 */
export class InteractionController {
  /** 已绑定事件监听的画布引用。 */
  private canvas: HTMLCanvasElement | null = null;
  /** 交互回调集合。 */
  private callbacks: MapRuntimeInteractionCallbacks = {};
  /** 等待下一帧合并处理的悬停坐标。 */
  private pendingHoverPosition: PointerPosition | null = null;
  /** 当前悬停 rAF 句柄。 */
  private hoverRafHandle: number | null = null;
  /** 最近一次发给 UI 的悬停目标签名，用于同格去重。 */
  private lastHoverSignature: string | null = null;
  /** 绑定前的 touch-action 样式，解绑时恢复。 */
  private previousTouchAction = '';
  private readonly touchPointers = new Map<number, PointerPosition>();
  private touchTap: (PointerPosition & { pointerId: number }) | null = null;
  private pinchDistance = 0;
  private pinchZoom = 1;
  private pendingZoom: number | null = null;
  private zoomRafHandle: number | null = null;

  constructor(
    private readonly getSnapshot: SnapshotProvider,
    private readonly getCamera: () => CameraController,
    private readonly projection: TopdownProjection,
  ) {}

  /** 绑定 pointer 事件到画布，统一鼠标、触控与触控笔输入。 */
  attach(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas) {
      return;
    }
    this.detach();
    this.canvas = canvas;
    this.previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    canvas.addEventListener('lostpointercapture', this.handlePointerCancel);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /** 解绑 pointer 事件，避免内存泄漏和后台 rAF 残留。 */
  detach(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('lostpointercapture', this.handlePointerCancel);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.reset();
    this.canvas.style.touchAction = this.previousTouchAction;
    this.canvas = null;
    this.clearPendingHover();
    this.lastHoverSignature = null;
  }

  /** 替换交互回调。 */
  setCallbacks(callbacks: MapRuntimeInteractionCallbacks): void {
    this.callbacks = callbacks;
  }

  /** 销毁时清理监听。 */
  destroy(): void {
    this.detach();
  }

  /** 切圖、失焦或卸載時丟棄未完成手勢，避免延後點擊與縮放。 */
  reset(): void {
    this.touchTap = null;
    this.pinchDistance = 0;
    this.clearPendingZoom();
    for (const pointerId of this.touchPointers.keys()) {
      if (this.canvas?.hasPointerCapture(pointerId)) {
        this.canvas.releasePointerCapture(pointerId);
      }
    }
    this.touchPointers.clear();
    this.clearPendingHover();
    this.emitHoverIfChanged(null);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.clearPendingHover();
      this.emitHoverIfChanged(null);
      this.touchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      this.canvas?.setPointerCapture(event.pointerId);
      this.touchTap = this.touchPointers.size === 1
        ? { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }
        : null;
      this.rebasePinch();
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const target = this.resolveTarget(event);
    if (target) {
      this.callbacks.onTarget?.(target);
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      const position = this.touchPointers.get(event.pointerId);
      if (!position) return;
      position.clientX = event.clientX;
      position.clientY = event.clientY;
      if (this.touchTap && Math.hypot(
        event.clientX - this.touchTap.clientX,
        event.clientY - this.touchTap.clientY,
      ) > TOUCH_TAP_SLOP) {
        this.touchTap = null;
      }
      const distance = this.getPinchDistance();
      if (distance > 0 && this.pinchDistance > 0) {
        this.pinchZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchZoom * distance / this.pinchDistance));
        this.pendingZoom = this.pinchZoom;
        if (this.zoomRafHandle === null) {
          this.zoomRafHandle = window.requestAnimationFrame(this.flushPendingZoom);
        }
      }
      this.pinchDistance = distance;
      return;
    }
    this.pendingHoverPosition = { clientX: event.clientX, clientY: event.clientY };
    if (this.hoverRafHandle !== null) {
      return;
    }
    this.hoverRafHandle = window.requestAnimationFrame(this.flushPendingHover);
  };

  private readonly handlePointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' && !this.canvas?.hasPointerCapture(event.pointerId)) {
      this.finishTouch(event, true);
    }
    this.clearPendingHover();
    this.emitHoverIfChanged(null);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.finishTouch(event, false);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.finishTouch(event, true);
    this.clearPendingHover();
    this.emitHoverIfChanged(null);
  };

  private readonly handleBlur = (): void => this.reset();

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.reset();
  };

  private finishTouch(event: PointerEvent, cancelled: boolean): void {
    if (!this.touchPointers.has(event.pointerId)) return;
    const tap = this.touchTap;
    this.touchTap = null;
    if (cancelled) this.clearPendingZoom();
    else this.flushPendingZoom();
    this.touchPointers.delete(event.pointerId);
    if (this.canvas?.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.rebasePinch();
    const rect = this.canvas?.getBoundingClientRect();
    if (!cancelled && tap?.pointerId === event.pointerId && rect
      && Math.hypot(event.clientX - tap.clientX, event.clientY - tap.clientY) <= TOUCH_TAP_SLOP
      && event.clientX >= rect.left && event.clientX < rect.right
      && event.clientY >= rect.top && event.clientY < rect.bottom) {
      const target = this.resolveTarget(event);
      if (target) this.callbacks.onTarget?.(target);
    }
  }

  private getPinchDistance(): number {
    if (this.touchPointers.size !== 2) return 0;
    const pointers = this.touchPointers.values();
    const first = pointers.next().value;
    const second = pointers.next().value;
    return first && second ? Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY) : 0;
  }

  private rebasePinch(): void {
    this.flushPendingZoom();
    this.pinchDistance = this.getPinchDistance();
    this.pinchZoom = getZoom();
  }

  private readonly flushPendingZoom = (): void => {
    const zoom = this.pendingZoom;
    this.clearPendingZoom();
    if (zoom !== null && Number(zoom.toFixed(2)) !== getZoom()) {
      this.callbacks.onZoom?.(zoom);
    }
  };

  private clearPendingZoom(): void {
    if (this.zoomRafHandle !== null) window.cancelAnimationFrame(this.zoomRafHandle);
    this.zoomRafHandle = null;
    this.pendingZoom = null;
  }

  private readonly flushPendingHover = (): void => {
    this.hoverRafHandle = null;
    const position = this.pendingHoverPosition;
    this.pendingHoverPosition = null;
    this.emitHoverIfChanged(position ? this.resolveTarget(position) : null);
  };

  private clearPendingHover(): void {
    this.pendingHoverPosition = null;
    if (this.hoverRafHandle === null) {
      return;
    }
    window.cancelAnimationFrame(this.hoverRafHandle);
    this.hoverRafHandle = null;
  }

  private emitHoverIfChanged(target: MapInteractionTarget | null): void {
    const signature = target
      ? `${target.x},${target.y}|${target.entityId ?? ''}|${target.entityKind ?? ''}|${target.walkable ? 1 : 0}|${target.visible ? 1 : 0}|${target.known ? 1 : 0}`
      : 'none';
    if (signature === this.lastHoverSignature) {
      return;
    }
    this.lastHoverSignature = signature;
    this.callbacks.onHover?.(target);
  }

  /** 根据 pointer 坐标反查地图坐标与命中实体/地块。 */
  private resolveTarget(event: PointerPosition): MapInteractionTarget | null {
    if (!this.canvas) {
      return null;
    }

    const snapshot = this.getSnapshot();
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const screenX = (event.clientX - rect.left) * (this.canvas.width / rect.width);
    const screenY = (event.clientY - rect.top) * (this.canvas.height / rect.height);
    const world = this.projection.screenToWorld(
      screenX,
      screenY,
      this.getCamera().getState(),
      this.canvas.width,
      this.canvas.height,
    );
    const cellSize = Math.max(1, getCellSize());
    const x = Math.floor(world.x / cellSize);
    const y = Math.floor(world.y / cellSize);
    const key = `${x},${y}`;
    const tile = snapshot.tileCache.get(key) ?? null;
    const entity = snapshot.entities.find((entry) => entry.wx === x && entry.wy === y);
    const inMapBounds = snapshot.mapMeta
      ? x >= 0 && x < snapshot.mapMeta.width && y >= 0 && y < snapshot.mapMeta.height
      : false;

    if (!inMapBounds && !tile && !entity) {
      return null;
    }

    return {
      x,
      y,
      entityId: entity?.id,
      entityKind: entity?.kind,
      walkable: tile?.walkable ?? false,
      visible: snapshot.visibleTiles.has(key),
      known: tile !== null,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }
}
