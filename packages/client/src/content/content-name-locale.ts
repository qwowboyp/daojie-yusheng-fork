/**
 * 本文件负责客户端内容名称的本地化解析（简体真源 + 繁体目录）。
 *
 * 简体（zh-CN）为默认语言，直接使用服务端下发的简体名称；繁体（zh-TW）时，
 * 优先查 content-name-catalog.generated.json（由 server 内容真源经 opencc-js 生成），
 * 查不到时回退到原值。仅处理展示，不改变服务端权威 id/数值。
 */
import type { ClientLocale } from '../constants/ui/i18n.generated';
import type { NoticeContentDomain, NoticeDisplayToken } from '@mud/shared';
import { getLanguagePreference } from '../ui/language-preferences';
import contentNameCatalog from '../constants/world/content-name-catalog.generated.json';

/** 内容目录 domain。 */
export type ContentNameDomain = NoticeContentDomain;

interface ContentNameCatalog {
  version?: number;
  items?: Record<string, Record<string, string>>;
  monsters?: Record<string, Record<string, string>>;
  techniques?: Record<string, Record<string, string>>;
  quests?: Record<string, Record<string, string>>;
  realmLevels?: Record<string, Record<string, string>>;
  buffs?: Record<string, Record<string, string>>;
}

const CATALOG = contentNameCatalog as ContentNameCatalog;

/** 从目录中解析某 domain 下 id 的指定字段繁体值，无则返回 undefined。 */
function lookupTwValue(domain: ContentNameDomain, id: string, field: string): string | undefined {
  const domainEntry = CATALOG[domain];
  if (!domainEntry) {
    return undefined;
  }
  const entry = domainEntry[id];
  if (!entry) {
    return undefined;
  }
  return entry[field];
}

/**
 * 解析内容展示名称：繁体语言下查目录，简体或查不到时返回 fallback。
 * @param domain 内容 domain
 * @param id 内容模板 id（realmLevels 传字符串化数值）
 * @param field 展示字段（name/desc/title/story/review 等）
 * @param fallback 简体原值或默认值
 */
export function resolveContentDisplayName(
  domain: ContentNameDomain,
  id: string | undefined,
  field: string,
  fallback: string,
): string {
  if (!id) {
    return fallback;
  }
  if (getLanguagePreference() === 'zh-CN') {
    return fallback;
  }
  const twValue = lookupTwValue(domain, id, field);
  return twValue && twValue.length > 0 ? twValue : fallback;
}

/** 判断当前是否为繁体语言。 */
export function isTraditionalChineseLocale(): boolean {
  return getLanguagePreference() === 'zh-TW';
}

/**
 * 依据展示 token 解析变量值：繁体且 token 携带 domain+id 时查目录，否则回退原值。
 * @param value 变量原始值（可能是简中名称或 id）
 * @param token 展示 token（可为 undefined）
 * @param field 展示字段（name/title 等，默认 name）
 */
export function resolveNoticeTokenValue(
  value: string | number,
  token: NoticeDisplayToken | undefined,
  field = 'name',
): string {
  const rawText = String(value);
  if (token?.domain && token.id) {
    return resolveContentDisplayName(token.domain, token.id, field, rawText);
  }
  return rawText;
}

export type { ClientLocale };
