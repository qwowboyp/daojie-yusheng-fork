/**
 * 本文件负责客户端侧的配置、视图、网络或运行态辅助逻辑，服务于正式前端主线的展示与意图收集。
 *
 * 维护时要保持前端只处理表现和派生状态，避免复制服务端权威真源或让多套 UI 状态互相分叉。
 */
import { GroundItemPileView } from '@mud/shared';

/** EMPTY_VISIBLE_TILES：EMPTY可见TILES。 */
export const EMPTY_VISIBLE_TILES = new Set<string>();
/** EMPTY_GROUND_PILES：EMPTY地面PILES。 */
export const EMPTY_GROUND_PILES = new Map<string, GroundItemPileView>();
/** MIN_MODAL_ZOOM：弹窗缩放下限。 */
export const MIN_MODAL_ZOOM = 1;
/** MAX_MODAL_ZOOM：弹窗缩放上限。 */
export const MAX_MODAL_ZOOM = 8;
/** MODAL_MARKER_LABEL_MAX_FONT_CSS：弹窗 NPC/怪物等标记名称字号上限（CSS 像素，绘制时按 devicePixelRatio 换算成画布像素）。 */
export const MODAL_MARKER_LABEL_MAX_FONT_CSS = 28;
/** MODAL_LANDMARK_LABEL_MAX_FONT_CSS：弹窗地标名称字号上限（CSS 像素，绘制时按 devicePixelRatio 换算成画布像素）。 */
export const MODAL_LANDMARK_LABEL_MAX_FONT_CSS = 32;



