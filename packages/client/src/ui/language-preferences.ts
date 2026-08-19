/**
 * 本文件是客户端 DOM UI 的语言偏好模块。
 *
 * 客户端已收敛为单一繁体中文（zh-TW）locale：不再读取/写入本地存储、
 * 不再支持语言切换事件，getLanguagePreference 恒返回 'zh-TW'。
 * 保留本模块与导出函数签名，是为了让既有调用方（i18n.ts / main.ts）无需改动；
 * 既有玩家 localStorage 中的 'zh-CN' 残留自动落到默认 'zh-TW'，无需迁移。
 */

import { DEFAULT_CLIENT_LOCALE, SUPPORTED_LOCALES, type ClientLocale } from '@mud/shared';

export type { ClientLocale };
export { SUPPORTED_LOCALES };

/** initializeLanguagePreference：初始化语言偏好（单语系下为无操作）。 */
export function initializeLanguagePreference(): ClientLocale {
  return DEFAULT_CLIENT_LOCALE;
}

/** getLanguagePreference：读取当前语言 locale（恒为 'zh-TW'）。 */
export function getLanguagePreference(): ClientLocale {
  return DEFAULT_CLIENT_LOCALE;
}
