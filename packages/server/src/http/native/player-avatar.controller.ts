/**
 * 本文件属于服务端 HTTP 公开入口，负责玩家自订头像的下发。
 *
 * 维护时注意：manifest 与图片 GET 为公开只读（私服口径，无个人资料敏感性）；
 * 图片 URL 带版本号，可安全使用 immutable 长缓存；上传/移除走 /api/account/avatar 鉴权端点。
 */
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';

import { PlayerAvatarStoreService } from './player-avatar-store.service';

/** 最小化的 HTTP 回应形状（Express/Fastify 皆满足），避免绑定具体平台类型。 */
interface AvatarResponseLike {
  setHeader(name: string, value: string): void;
  end(chunk?: Buffer): void;
}

/** 玩家头像公开下发控制器：manifest + 版本化图片。 */
@Controller('api/avatar')
export class PlayerAvatarController {
  constructor(private readonly avatarStore: PlayerAvatarStoreService) {}

  /** 全服头像版本清单；存储禁用时返回空清单而不是报错，客户端可正常回退默认形象。 */
  @Get('manifest')
  async getAvatarManifest() {
    if (!this.avatarStore.isEnabled()) {
      return { avatars: [] };
    }
    const avatars = await this.avatarStore.listAvatarManifest();
    return { avatars };
  }

  /** 下发单个头像图片；URL 携带版本参数，可永久缓存。 */
  @Get(':playerId')
  async getAvatar(@Param('playerId') playerId: string, @Res() response: AvatarResponseLike) {
    if (!this.avatarStore.isEnabled()) {
      throw new NotFoundException('頭像不存在');
    }
    const trimmedPlayerId = typeof playerId === 'string' ? playerId.trim() : '';
    const avatar = trimmedPlayerId
      ? await this.avatarStore.getAvatar(trimmedPlayerId)
      : null;
    if (!avatar) {
      throw new NotFoundException('頭像不存在');
    }
    response.setHeader('Content-Type', avatar.mime);
    response.setHeader('Content-Length', String(avatar.data.length));
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.end(avatar.data);
  }
}
