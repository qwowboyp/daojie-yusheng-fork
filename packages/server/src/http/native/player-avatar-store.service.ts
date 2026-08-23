/**
 * 本文件属于服务端玩家头像存储层，负责自订头像的持久化与版本管理。
 *
 * 维护时注意：本服务只做存储与版本递增，鉴权与格式校验在 NativePlayerAuthService；
 * 无数据库时进入禁用模式，读写入口必须 fail-closed，不允许静默丢失上传。
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

import { resolveServerDatabaseUrl } from '../../config/env-alias';

/** 单张头像解码后的大小上限（1MB）。 */
export const MAX_PLAYER_AVATAR_BYTES = 1024 * 1024;

/** 允许上传的图片 MIME 白名单。 */
export const PLAYER_AVATAR_MIME_WHITELIST: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

const PLAYER_AVATAR_TABLE = 'server_player_avatar';

const CREATE_PLAYER_AVATAR_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${PLAYER_AVATAR_TABLE} (
    player_id varchar(100) PRIMARY KEY,
    mime varchar(32) NOT NULL,
    data bytea NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

/** 头像 manifest 条目：客户端据此拼版本化 URL 并注入 sprite 表。 */
export interface PlayerAvatarManifestEntry {
  playerId: string;
  version: number;
}

/** 单个头像的完整内容。 */
export interface StoredPlayerAvatar {
  mime: string;
  data: Buffer;
  version: number;
}

/** 头像表持久化行。 */
interface PersistedAvatarRow {
  mime?: unknown;
  data?: unknown;
  version?: unknown;
}

@Injectable()
export class PlayerAvatarStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlayerAvatarStoreService.name);
  private pool: Pool | null = null;

  /** 启动时建立连接池并幂等建表；未配置数据库时保持禁用。 */
  async onModuleInit(): Promise<void> {
    const databaseUrl = resolveServerDatabaseUrl();
    if (!databaseUrl.trim()) {
      this.logger.log('玩家頭像儲存運行在禁用模式：未提供 SERVER_DATABASE_URL/DATABASE_URL');
      return;
    }

    const pool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (error) => {
      this.logger.error(
        `玩家頭像儲存連接池捕獲錯誤：${error instanceof Error ? error.message : String(error)}`,
      );
    });

    try {
      await pool.query(CREATE_PLAYER_AVATAR_TABLE_SQL);
      this.pool = pool;
      this.logger.log('玩家頭像儲存已就緒');
    } catch (error) {
      await pool.end().catch(() => undefined);
      this.logger.error(
        '玩家頭像儲存初始化失敗，已進入禁用模式',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end().catch(() => undefined);
  }

  /** 头像存储是否可用（已连库且建表成功）。 */
  isEnabled(): boolean {
    return this.pool !== null;
  }

  /** 保存（或覆盖）玩家头像，版本号自增并返回新版本。 */
  async saveAvatar(playerId: string, mime: string, data: Buffer): Promise<number> {
    const pool = this.assertEnabled();
    const result = await pool.query<{ version?: unknown }>(`
      INSERT INTO ${PLAYER_AVATAR_TABLE}(player_id, mime, data, version, updated_at)
      VALUES ($1, $2, $3, 1, now())
      ON CONFLICT (player_id)
      DO UPDATE SET
        mime = EXCLUDED.mime,
        data = EXCLUDED.data,
        version = ${PLAYER_AVATAR_TABLE}.version + 1,
        updated_at = now()
      RETURNING version
    `, [playerId, mime, data]);
    const version = Number(result.rows[0]?.version);
    return Number.isFinite(version) && version > 0 ? version : 1;
  }

  /** 读取单个头像；不存在时返回 null。 */
  async getAvatar(playerId: string): Promise<StoredPlayerAvatar | null> {
    const pool = this.assertEnabled();
    const result = await pool.query<PersistedAvatarRow>(`
      SELECT mime, data, version
      FROM ${PLAYER_AVATAR_TABLE}
      WHERE player_id = $1
    `, [playerId]);
    const row = result.rows[0];
    if (!row || typeof row.mime !== 'string' || !Buffer.isBuffer(row.data)) {
      return null;
    }
    const version = Number(row.version);
    return {
      mime: row.mime,
      data: row.data,
      version: Number.isFinite(version) && version > 0 ? version : 1,
    };
  }

  /** 删除玩家头像；返回是否真的删除了一行。 */
  async deleteAvatar(playerId: string): Promise<boolean> {
    const pool = this.assertEnabled();
    const result = await pool.query(`
      DELETE FROM ${PLAYER_AVATAR_TABLE}
      WHERE player_id = $1
    `, [playerId]);
    return (result.rowCount ?? 0) > 0;
  }

  /** 列出全部头像的版本清单，供客户端 manifest 拉取。 */
  async listAvatarManifest(): Promise<PlayerAvatarManifestEntry[]> {
    const pool = this.assertEnabled();
    const result = await pool.query<{ player_id?: unknown; version?: unknown }>(`
      SELECT player_id, version
      FROM ${PLAYER_AVATAR_TABLE}
      ORDER BY player_id ASC
    `);
    const entries: PlayerAvatarManifestEntry[] = [];
    for (const row of result.rows) {
      const playerId = typeof row.player_id === 'string' ? row.player_id.trim() : '';
      const version = Number(row.version);
      if (playerId && Number.isFinite(version) && version > 0) {
        entries.push({ playerId, version });
      }
    }
    return entries;
  }

  /** 未连库时统一拒绝读写，避免上传被静默丢弃。 */
  private assertEnabled(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException('玩家頭像儲存暫不可用，請稍後重試');
    }
    return this.pool;
  }
}
