/**
 * 本文件是客户端 DOM UI 的 i18n 模块，负责具体面板、弹层或渲染片段。
 *
 * 维护时优先保持局部更新和原有焦点/滚动状态，不在 UI 层裁定资产、战斗或移动合法性。
 */
import {
  CLIENT_I18N_MESSAGES,
  SUPPORTED_CLIENT_LOCALES,
  type ClientI18nKey,
  type ClientLocale,
} from '../constants/ui/i18n.generated';
import { getLanguagePreference } from './language-preferences';

export type { ClientLocale };
export { SUPPORTED_CLIENT_LOCALES };

type I18nValue = string | number | boolean | null | undefined;
type I18nValues = Readonly<Record<string, I18nValue>>;

const PLACEHOLDER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

function stringifyI18nValue(value: I18nValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

/** 取得当前活跃 locale 对应的文案表。 */
function activeMessages(): Record<string, string> {
  return CLIENT_I18N_MESSAGES[getLanguagePreference()];
}

export function hasI18nKey(key: string): key is ClientI18nKey {
  return Object.prototype.hasOwnProperty.call(activeMessages(), key);
}

export function t(key: ClientI18nKey | string, values?: I18nValues, fallback?: string): string {
  const messages = activeMessages();
  const template = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : fallback ?? key;
  if (!values) {
    return template;
  }
  return template.replace(PLACEHOLDER_PATTERN, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? stringifyI18nValue(values[name]) : match
  ));
}

export function tLoose(key: string, values?: I18nValues, fallback?: string): string {
  return t(key, values, fallback);
}

export function formatI18nList(items: readonly string[], emptyText = ''): string {
  return items.length > 0 ? items.join('、') : emptyText;
}

function applyI18nAttribute(node: Element, sourceAttr: string, targetAttr: string): void {
  const key = node.getAttribute(sourceAttr);
  if (!key || !hasI18nKey(key)) {
    return;
  }
  node.setAttribute(targetAttr, t(key));
}

export function applyStaticI18n(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (key && hasI18nKey(key)) {
      node.textContent = t(key);
    }
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    applyI18nAttribute(node, 'data-i18n-placeholder', 'placeholder');
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    applyI18nAttribute(node, 'data-i18n-aria-label', 'aria-label');
  });
  root.querySelectorAll('[data-i18n-alt]').forEach((node) => {
    applyI18nAttribute(node, 'data-i18n-alt', 'alt');
  });
}
