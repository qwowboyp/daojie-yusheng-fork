/**
 * 解析瀏覽器 AudioContext 建構子，並提供解鎖手勢事件清單。
 *
 * 舊版 iOS Safari 只暴露 webkitAudioContext；解鎖必須發生在使用者手勢內。
 */

declare global {
  interface Window {
    webkitAudioContext?: {
      new (): AudioContext;
    };
  }
}

/** 足以解鎖自動播放政策的使用者手勢（iOS 對 click/touchend 比 pointerdown 穩）。 */
export const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'click', 'touchend'] as const;

/** 解析標準或 webkit 前綴的 AudioContext 建構子；環境不支援時回傳 null。 */
export function resolveAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof AudioContext === 'function') {
    return AudioContext;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  const webkit = window.webkitAudioContext;
  return typeof webkit === 'function' ? webkit : null;
}
