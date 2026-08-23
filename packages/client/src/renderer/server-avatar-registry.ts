/**
 * 本文件负责客户端的服务器头像清单（manifest）拉取与 sprite 条目供给。
 *
 * 服务器头像是全服可见的玩家自订形象：manifest 提供 playerId → version，
 * 本模块把它转成 `player:<id>` → `/api/avatar/<id>?v=<version>` 的 sprite 条目，
 * 由渲染层注入 sprite 查找表（注入顺序在本地覆盖之前，本机预览仍优先）。
 */

import type { PlayerAvatarManifestEntry, PlayerAvatarManifestRes } from '@mud/shared';

/** 服务器头像清单变化时派发的 window 事件，渲染层据此重载 sprite 表。 */
export const SERVER_AVATARS_CHANGED_EVENT = 'mud:server-avatars-changed';

/** manifest 轮询间隔（毫秒）；私服口径，玩家少、清单小，60 秒足够新鲜。 */
const SERVER_AVATAR_REFRESH_INTERVAL_MS = 60_000;

/** 服务器头像 sprite 条目：key 形如 player:p_xxx，src 为版本化 URL。 */
export interface ServerAvatarSpriteEntry {
  key: string;
  src: string;
}

let manifest: PlayerAvatarManifestEntry[] = [];
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let inFlightRefresh: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 拉取 manifest 并 diff；有变化（增删改版本）才更新内存快照并派发事件。 */
export async function refreshServerAvatars(): Promise<void> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const response = await fetch('/api/avatar/manifest', { cache: 'no-cache' });
      if (!response.ok) return;
      const payload: unknown = await response.json();
      const rawEntries = isRecord(payload) && Array.isArray(payload.avatars) ? payload.avatars : [];
      const next: PlayerAvatarManifestEntry[] = [];
      for (const item of rawEntries) {
        if (!isRecord(item)) continue;
        const playerId = typeof item.playerId === 'string' ? item.playerId.trim() : '';
        const version = Number(item.version);
        if (playerId && Number.isFinite(version) && version > 0) {
          next.push({ playerId, version });
        }
      }
      next.sort((left, right) => left.playerId.localeCompare(right.playerId));
      const changed = next.length !== manifest.length
        || next.some((entry, index) =>
          entry.playerId !== manifest[index]?.playerId || entry.version !== manifest[index]?.version);
      if (!changed) return;
      manifest = next;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SERVER_AVATARS_CHANGED_EVENT));
      }
    } catch {
      // 拉取失败保持旧快照，下轮轮询重试；头像只是表现层增强，不该打断游戏。
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

/** 当前服务器头像 sprite 条目（key 为 player:<id>，src 带版本参数可长缓存）。 */
export function getServerAvatarSpriteEntries(): ServerAvatarSpriteEntry[] {
  return manifest.map((entry) => ({
    key: `player:${entry.playerId}`,
    src: `/api/avatar/${encodeURIComponent(entry.playerId)}?v=${entry.version}`,
  }));
}

/** 读取单个玩家的版本化头像 URL；未设置时返回 null。 */
export function getServerAvatarUrl(playerId: string): string | null {
  const trimmed = playerId.trim();
  if (!trimmed) return null;
  const entry = manifest.find((item) => item.playerId === trimmed);
  return entry ? `/api/avatar/${encodeURIComponent(trimmed)}?v=${entry.version}` : null;
}

/** 启动定时轮询；重复调用幂等（先清旧定时器）。 */
export function startServerAvatarAutoRefresh(): void {
  if (typeof window === 'undefined') return;
  stopServerAvatarAutoRefresh();
  void refreshServerAvatars();
  refreshTimer = setInterval(() => {
    void refreshServerAvatars();
  }, SERVER_AVATAR_REFRESH_INTERVAL_MS);
}

/** 停止轮询（登出时调用）。 */
export function stopServerAvatarAutoRefresh(): void {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
