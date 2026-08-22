/**
 * 本文件是客户端全局 BGM 播放器模块，负责背景音乐的开启/关闭、播放与偏好持久化。
 *
 * 纯客户端表现层：不依赖登录状态、不参与协议，只维护本地音效偏好。
 * 浏览器自动播放政策要求首次播放必须发生在用户交互之后，因此启动时只注册一次性交互监听，
 * 等到第一次 pointerdown/keydown/touchstart 再真正开始播放。
 */

import { BGM_STORAGE_KEY } from '@mud/shared';

/** BGM 资源地址（Vite public 目录，部署后由 nginx 静态伺服）。 */
const BGM_SRC = '/bgm/gameBGM-01.mp3';

/** BGM 音量（0~1），固定值；如需音量调节再扩展。 */
const BGM_VOLUME = 0.5;

/** BGM 开关状态变更事件名，供 UI 组件订阅同步按钮状态。 */
export const BGM_STATE_CHANGED_EVENT = 'bgm-player-state-changed';

/** 音频元素单例。 */
let audio: HTMLAudioElement | null = null;
/** 当前是否开启 BGM（偏好值，不代表一定在播放）。 */
let enabled = true;
/** 是否已完成初始化。 */
let initialized = false;

/** 读取当前 BGM 开启偏好。 */
export function isBgmEnabled(): boolean {
  return enabled;
}

/**
 * 初始化 BGM 播放器：读取持久化偏好，并注册首次用户交互监听以绕过自动播放限制。
 * 幂等，可在启动链中安全重复调用。
 */
export function initializeBgmPlayer(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  enabled = readStoredEnabled();

  const tryStart = () => {
    window.removeEventListener('pointerdown', tryStart);
    window.removeEventListener('keydown', tryStart);
    window.removeEventListener('touchstart', tryStart);
    if (enabled) {
      void startPlayback();
    }
  };
  window.addEventListener('pointerdown', tryStart);
  window.addEventListener('keydown', tryStart);
  window.addEventListener('touchstart', tryStart);
}

/** 切换 BGM 开关，返回切换后的状态，并派发 BGM_STATE_CHANGED_EVENT 供 UI 同步。 */
export function toggleBgm(): boolean {
  enabled = !enabled;
  persistEnabled(enabled);
  if (enabled) {
    void startPlayback();
  } else {
    audio?.pause();
  }
  window.dispatchEvent(new CustomEvent<{ enabled: boolean }>(BGM_STATE_CHANGED_EVENT, { detail: { enabled } }));
  return enabled;
}

/** 启动播放；资源不可用或被自动播放政策拦截时静默失败，等待下次交互/切换重试。 */
function startPlayback(): Promise<void> {
  const player = ensureAudio();
  return player.play().catch(() => undefined);
}

/** 懒创建音频元素单例（loop 循环播放）。 */
function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(BGM_SRC);
    audio.loop = true;
    audio.volume = BGM_VOLUME;
    audio.preload = 'auto';
  }
  return audio;
}

/** 读取持久化偏好；未设置过或本地存储不可用时默认开启。 */
function readStoredEnabled(): boolean {
  try {
    return localStorage.getItem(BGM_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** 持久化开关偏好；本地存储不可用时静默忽略（仅本次会话生效）。 */
function persistEnabled(value: boolean): void {
  try {
    localStorage.setItem(BGM_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // 忽略：localStorage 被禁用时不影响播放功能本身
  }
}