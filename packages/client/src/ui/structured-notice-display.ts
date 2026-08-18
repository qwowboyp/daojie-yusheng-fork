/**
 * 本文件属于客户端展示层，负责把服务端结构化通知中的稳定 ID 转成人类可读文本。
 *
 * 维护时只做本地目录兜底显示，不在客户端裁定玩法、资产或任务结果。
 */
import type { StructuredNoticePayload } from '@mud/shared';
import { getLocalItemTemplate } from '../content/local-templates';
import { resolveNoticeTokenValue } from '../content/content-name-locale';
import { formatDisplayNumber } from '../utils/number';
import { hasI18nKey, tLoose } from './i18n';

type I18nValue = string | number | boolean | null | undefined;

export function resolveClientDisplayToken(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return value == null ? '' : String(value);
  }
  const template = getLocalItemTemplate(text);
  return template?.name?.trim() || text;
}

export function resolveStructuredNoticeText(
  rawText: string,
  structured?: unknown,
  structuredGroup?: unknown[],
): string {
  const payload = normalizeStructuredNotice(structured) ?? normalizeStructuredNotice(structuredGroup?.[0]);
  if (payload && hasI18nKey(payload.key)) {
    return tLoose(payload.key, normalizeStructuredNoticeVars(payload));
  }
  if (hasI18nKey(rawText)) {
    return tLoose(rawText);
  }
  return resolveClientDisplayToken(rawText);
}

export function normalizeStructuredNoticeVars(
  payload: StructuredNoticePayload | undefined,
): Record<string, I18nValue> | undefined {
  const vars = payload?.vars;
  if (!vars) {
    return undefined;
  }
  const tokenMap = new Map((payload?.displayTokens ?? []).map((token) => [token.key, token]));
  const resolved: Record<string, I18nValue> = {};
  for (const [key, value] of Object.entries(vars)) {
    resolved[key] = typeof value === 'string'
      ? resolveNoticeTokenValue(value, tokenMap.get(key))
      : typeof value === 'number'
        ? formatDisplayNumber(value)
        : value;
  }
  return resolved;
}

function normalizeStructuredNotice(value: unknown): StructuredNoticePayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const payload = value as Partial<StructuredNoticePayload>;
  return typeof payload.key === 'string' && payload.key.trim().length > 0
    ? payload as StructuredNoticePayload
    : null;
}
