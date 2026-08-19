/**
 * 本文件负责客户端内容名称的本地化解析（单一繁体中文 locale）。
 *
 * 服务端内容真源已全部转换为繁体中文，客户端直接使用服务端下发的名称，
 * 不再需要本地目录查表。仅处理展示，不改变服务端权威 id/数值。
 */
import type { ClientLocale } from '../constants/ui/i18n.generated';
import type { NoticeContentDomain, NoticeDisplayToken } from '@mud/shared';

/** 内容目录 domain。 */
export type ContentNameDomain = NoticeContentDomain;

/**
 * 解析内容展示名称：直接返回服务端下发的繁体原值（fallback）。
 * @param domain 内容 domain（保留参数以维持调用方契约，不再参与查表）
 * @param id 内容模板 id（保留参数以维持调用方契约）
 * @param field 展示字段（保留参数以维持调用方契约）
 * @param fallback 服务端下发的繁体原值
 */
export function resolveContentDisplayName(
  _domain: ContentNameDomain,
  _id: string | undefined,
  _field: string,
  fallback: string,
): string {
  return fallback;
}

/**
 * 依据展示 token 解析变量值：直接返回变量原始值的字符串形态。
 * @param value 变量原始值（服务端已下发繁体）
 * @param token 展示 token（保留参数以维持调用方契约）
 * @param field 展示字段（保留参数以维持调用方契约）
 */
export function resolveNoticeTokenValue(
  value: string | number,
  _token: NoticeDisplayToken | undefined,
  _field = 'name',
): string {
  return String(value);
}

export type { ClientLocale };
