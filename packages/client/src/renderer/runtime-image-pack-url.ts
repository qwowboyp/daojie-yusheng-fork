/**
 * 本文件属于运行时图包资源 URL 边界，负责按资源来源选择静态资源缓存版本。
 *
 * 维护时保持调用方无感知：图包资源沿用 manifest 版本，建築美術沿用 client build 版本。
 */

const RUNTIME_IMAGE_PACK_VERSION_PARAM = 'v';
const MAX_RUNTIME_IMAGE_PACK_VERSION_LENGTH = 96;

export function normalizeRuntimeImagePackVersion(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_RUNTIME_IMAGE_PACK_VERSION_LENGTH ? trimmed : '';
}

export function resolveRuntimeImagePackAssetUrl(manifestUrl: string, src: string, version: string): string {
  const trimmedSrc = src.trim();
  const resolvedUrl = resolveRuntimeImagePackRawAssetUrl(manifestUrl, trimmedSrc);
  return appendRuntimeImagePackVersion(resolvedUrl, resolveRuntimeImagePackAssetVersion(resolvedUrl, version));
}

function resolveRuntimeImagePackRawAssetUrl(manifestUrl: string, src: string): string {
  if (src.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return src;
  }
  try {
    return new URL(src, new URL(manifestUrl, window.location.href)).toString();
  } catch {
    const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
    return `${base}${src}`;
  }
}

/** 建築美術由 client build snapshot 管理；圖包內其他資源仍沿用 manifest 修訂。 */
function resolveRuntimeImagePackAssetVersion(url: string, manifestVersion: string): string {
  if (!isBuildingArtAssetUrl(url)) {
    return manifestVersion;
  }
  return __APP_BUILD_ID__;
}

function isBuildingArtAssetUrl(url: string): boolean {
  if (/^(?:data|blob):/i.test(url)) {
    return false;
  }
  try {
    return new URL(url, window.location.href).pathname.startsWith('/assets/building-art/');
  } catch {
    return url.split(/[?#]/, 1)[0]?.startsWith('/assets/building-art/') === true;
  }
}

function appendRuntimeImagePackVersion(url: string, version: string): string {
  if (!version || /^(?:data|blob):/i.test(url)) {
    return url;
  }

  const hashIndex = url.indexOf('#');
  const body = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const questionIndex = body.indexOf('?');
  const base = questionIndex >= 0 ? body.slice(0, questionIndex) : body;
  const rawQuery = questionIndex >= 0 ? body.slice(questionIndex + 1) : '';
  const params = new URLSearchParams(rawQuery);
  params.set(RUNTIME_IMAGE_PACK_VERSION_PARAM, version);
  const query = params.toString();
  return query ? `${base}?${query}${hash}` : `${base}${hash}`;
}
