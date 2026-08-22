/**
 * 本文件是客户端全局 BGM 播放器模块，负责背景音乐的开启/关闭、播放与偏好持久化。
 *
 * 纯客户端表现层：不依赖登录状态、不参与协议，只维护本地音效偏好。
 * 浏览器自动播放政策要求首次播放必须发生在用户交互之后，因此启动时只注册一次性交互监听，
 * 等到第一次 pointerdown/keydown/touchstart 再真正开始播放。
 */

import { BGM_STORAGE_KEY, BGM_VOLUME_STORAGE_KEY } from '@mud/shared';
import { t } from './i18n';

/** BGM 资源地址（Vite public 目录，部署后由 nginx 静态伺服）。 */
const BGM_SRC = '/bgm/gameBGM-01.mp3';

/** BGM 預設音量（0~1），未設定過音量偏好時使用。 */
export const DEFAULT_BGM_VOLUME = 0.5;

/** BGM 音量調整刻度（0~1），對應 UI 上的 10%。 */
export const BGM_VOLUME_STEP = 0.1;

/** BGM 开关状态变更事件名，供 UI 组件订阅同步按钮状态。 */
export const BGM_STATE_CHANGED_EVENT = 'bgm-player-state-changed';

/** BGM 音量变更事件名，供 UI 组件订阅同步音量显示。detail 携带 { volume }（0~1）。 */
export const BGM_VOLUME_CHANGED_EVENT = 'bgm-player-volume-changed';

/** 音频元素单例。 */
let audio: HTMLAudioElement | null = null;
/** 当前是否开启 BGM（偏好值，不代表一定在播放）。 */
let enabled = true;
/** 当前 BGM 音量（0~1）。 */
let volume = DEFAULT_BGM_VOLUME;
/** 是否已完成初始化。 */
let initialized = false;

/** 读取当前 BGM 开启偏好。 */
export function isBgmEnabled(): boolean {
  return enabled;
}

/** 读取当前 BGM 音量（0~1）。 */
export function getBgmVolume(): number {
  return volume;
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
  const stored = readStoredEnabled();
  if (stored !== enabled) {
    enabled = stored;
    // 通知已掛載的按鈕（登入畫面 / HUD React 按鈕）同步實際偏好，避免初始顯示與持久化不一致
    window.dispatchEvent(new CustomEvent<{ enabled: boolean }>(BGM_STATE_CHANGED_EVENT, { detail: { enabled } }));
  }
  volume = readStoredVolume();

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

/** 设置 BGM 音量（0~1），越界值会被收敛并取整到整数百分比；立即套用到播放中的音频并持久化偏好。 */
export function setBgmVolume(value: number): number {
  const normalized = Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : DEFAULT_BGM_VOLUME;
  // 取整到整数百分比，避免 -/+ 步进累积浮点误差（如 0.6000000000000001）
  volume = Math.round(normalized * 100) / 100;
  if (audio) {
    audio.volume = normalized;
  }
  persistVolume(volume);
  window.dispatchEvent(new CustomEvent<{ volume: number }>(BGM_VOLUME_CHANGED_EVENT, { detail: { volume } }));
  return volume;
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

/**
 * 将一个音乐开关按钮绑定到 BGM 播放器：点击切换、样式/无障碍状态/提示文字随状态同步。
 * 供登入画面等非 React 静态按钮使用；React 按钮由组件自身管理状态。
 */
export function bindBgmToggleButton(button: HTMLButtonElement | null): void {
  if (!button) {
    return;
  }
  const sync = () => {
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.title = t(enabled ? 'shell.bgm.title.on' : 'shell.bgm.title.off', undefined);
  };
  sync();
  button.addEventListener('click', () => {
    toggleBgm();
    sync();
  });
  window.addEventListener(BGM_STATE_CHANGED_EVENT, sync);
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
    audio.volume = volume;
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

/** 读取持久化音量；未设置过、越界或本地存储不可用时回退默认音量。 */
function readStoredVolume(): number {
  try {
    const raw = Number.parseInt(localStorage.getItem(BGM_VOLUME_STORAGE_KEY) ?? '', 10);
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
      return DEFAULT_BGM_VOLUME;
    }
    return raw / 100;
  } catch {
    return DEFAULT_BGM_VOLUME;
  }
}

/** 持久化音量偏好（存 0~100 整数百分比）；本地存储不可用时静默忽略。 */
function persistVolume(value: number): void {
  try {
    localStorage.setItem(BGM_VOLUME_STORAGE_KEY, `${Math.round(value * 100)}`);
  } catch {
    // 忽略：localStorage 被禁用时不影响播放功能本身
  }
}