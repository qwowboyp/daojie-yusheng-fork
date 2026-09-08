import { shouldUseMobileUi } from './responsive-viewport';

export type MobileSurface = 'hud' | 'chat' | 'actions' | 'nearby' | 'map-tools' | 'menu' | 'workspace';
const MOBILE_SURFACE_EVENT = 'mud:mobile-surface';

/** 手機一次展開一個輔助面板；桌面仍可同時操作多個視窗。 */
export function requestMobileSurface(surface: MobileSurface | null): void {
  if (shouldUseMobileUi(window)) {
    window.dispatchEvent(new CustomEvent(MOBILE_SURFACE_EVENT, { detail: surface }));
  }
}

export function subscribeMobileSurface(surface: MobileSurface, onDismiss: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as CustomEvent<MobileSurface | null>).detail !== surface) onDismiss();
  };
  window.addEventListener(MOBILE_SURFACE_EVENT, listener);
  return () => window.removeEventListener(MOBILE_SURFACE_EVENT, listener);
}
