/**
 * 本文件是客户端 DOM UI 的语言偏好模块，负责语言 locale 的选择与持久化。
 *
 * 维护时优先保持局部更新和原有交互状态，不在 UI 层裁定资产、战斗或移动合法性。
 */
/**
 * 语言偏好配置
 * 统一管理客户端显示语言（简体中文 / 繁体中文），并持久化到本地存储。
 */

import { DEFAULT_CLIENT_LOCALE, LANGUAGE_STORAGE_KEY, SUPPORTED_LOCALES, type ClientLocale } from '@mud/shared';

export type { ClientLocale };
export { SUPPORTED_LOCALES };

/** 语言切换事件名。切换后调用方应刷新整页以重载所有面板。 */
export const LANGUAGE_CHANGE_EVENT = 'mud:language-change';

/** currentLocale：当前语言 locale。 */
let currentLocale: ClientLocale = DEFAULT_CLIENT_LOCALE;
/** initialized：是否已初始化。 */
let initialized = false;

/** initializeLanguagePreference：初始化语言偏好。 */
export function initializeLanguagePreference(): ClientLocale {
  if (initialized) {
    return currentLocale;
  }
  currentLocale = normalizeLocale(readStoredLocale());
  applyLocale(currentLocale);
  initialized = true;
  return currentLocale;
}

/** getLanguagePreference：读取当前语言 locale。 */
export function getLanguagePreference(): ClientLocale {
  if (!initialized) {
    return initializeLanguagePreference();
  }
  return currentLocale;
}

/** updateLanguagePreference：更新语言 locale 并持久化。 */
export function updateLanguagePreference(locale: ClientLocale): ClientLocale {
  currentLocale = normalizeLocale(locale);
  persistLocale(currentLocale);
  window.dispatchEvent(new CustomEvent<ClientLocale>(LANGUAGE_CHANGE_EVENT, { detail: currentLocale }));
  return currentLocale;
}

/** resetLanguagePreference：重置语言为默认值。 */
export function resetLanguagePreference(): ClientLocale {
  currentLocale = DEFAULT_CLIENT_LOCALE;
  persistLocale(currentLocale);
  window.dispatchEvent(new CustomEvent<ClientLocale>(LANGUAGE_CHANGE_EVENT, { detail: currentLocale }));
  return currentLocale;
}

/** applyLocale：应用语言到文档。 */
function applyLocale(locale: ClientLocale): void {
  document.documentElement.lang = locale;
}

/** normalizeLocale：规范化 locale，仅接受白名单值，非法值回退默认。 */
function normalizeLocale(value: unknown): ClientLocale {
  return SUPPORTED_LOCALES.includes(value as ClientLocale) ? (value as ClientLocale) : DEFAULT_CLIENT_LOCALE;
}

/** persistLocale：持久化语言 locale。 */
function persistLocale(locale: ClientLocale): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // 本地存储不可用时静默跳过，保留当前会话内语言
  }
}

/** readStoredLocale：读取存储的语言 locale。 */
function readStoredLocale(): ClientLocale | null {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return SUPPORTED_LOCALES.includes(raw as ClientLocale) ? (raw as ClientLocale) : null;
  } catch {
    return null;
  }
}
