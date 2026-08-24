/**
 * 本文件负责服务端侧的权威运行、网络、持久化或运维辅助逻辑，是生产主线的一部分。
 *
 * 维护时要保持鉴权、恢复、幂等和数据真源边界清晰，避免把冷路径工具或查询逻辑卷入 tick 热路径。
 */
import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';

import { buildDefaultRoleName, normalizeDisplayName, normalizeRoleName, normalizeUsername, resolveDisplayName, validateDisplayName, validatePassword, validateRoleName, validateUsername } from '../../auth/account-validation';
import { hashPassword, isPasswordHashUpgradeRequired, verifyPassword } from '../../auth/password-hash';
import { WorldPlayerSnapshotService } from '../../network/world-player-snapshot.service';
import { WorldPlayerTokenCodecService } from '../../network/world-player-token-codec.service';
import { PlayerIdentityPersistenceService } from '../../persistence/player-identity-persistence.service';
import { ActivityPersistenceService } from '../../persistence/activity-persistence.service';
import { PlayerRuntimeService } from '../../runtime/player/player-runtime.service';
import { NativePlayerAuthStoreService } from './native-player-auth-store.service';
import type { NativePlayerAuthUser } from './native-player-auth-store.service';
import { normalizeAvatarImage } from './avatar-image-normalizer';
import { MAX_PLAYER_AVATAR_BYTES, PLAYER_AVATAR_MIME_WHITELIST, PlayerAvatarStoreService } from './player-avatar-store.service';

/** 登录/注册成功后返回的令牌对。 */


interface AuthTokens {
/**
 * accessToken：accessToken标识。
 */

  accessToken: string;  
  /**
 * refreshToken：refreshToken标识。
 */

  refreshToken: string;
}
/**
 * DisplayNameAvailabilityResult：定义接口结构约束，明确可交付字段含义。
 */


interface DisplayNameAvailabilityResult {
/**
 * available：available相关字段。
 */

  available: boolean;  
  /**
 * message：message相关字段。
 */

  message?: string;
}
/**
 * TokenPayload：定义接口结构约束，明确可交付字段含义。
 */


interface TokenPayload {
/**
 * sub：sub相关字段。
 */

  sub?: unknown;  
  /**
 * username：username名称或显示文本。
 */

  username?: unknown;  
  /**
 * role：role相关字段。
 */

  role?: unknown;
}
/**
 * WorldPlayerTokenCodecPort：定义接口结构约束，明确可交付字段含义。
 */


interface WorldPlayerTokenCodecPort {
  validateRefreshToken(token: string): TokenPayload | null;
  validateAccessToken(token: string): TokenPayload | null;
  issueAccessToken(payload: Record<string, unknown>): string;
  issueRefreshToken(payload: Record<string, unknown>): string;
}
/**
 * PlayerIdentityPersistencePort：定义接口结构约束，明确可交付字段含义。
 */


interface PlayerIdentityPersistencePort {
  isEnabled(): boolean;
  savePlayerIdentity(identity: Record<string, unknown>): Promise<unknown>;
}
interface PlayerRuntimeIdentityProjection {
  displayName?: string;
}
/**
 * PlayerRuntimePort：定义接口结构约束，明确可交付字段含义。
 */


interface PlayerRuntimePort {
  getPlayerIdentityProjection(playerId: string): PlayerRuntimeIdentityProjection | null;
  setIdentity(playerId: string, input: {  
  /**
 * name：名称名称或显示文本。
 */
 name?: string;  
 /**
 * displayName：显示名称名称或显示文本。
 */
 displayName?: string }): unknown;
}
/**
 * WorldPlayerSnapshotPort：定义接口结构约束，明确可交付字段含义。
 */


interface WorldPlayerSnapshotPort {
  ensureNativeStarterSnapshot(playerId: string): Promise<{  
  /**
 * ok：ok相关字段。
 */
 ok?: boolean;  
 /**
 * failureStage：failureStage相关字段。
 */
 failureStage?: string | null }>;
}

interface ActivityPersistencePort {
  isEnabled(): boolean;
  createInvitationRecord(input: {
    inviterUserId: string;
    inviterPlayerId: string;
    inviteeUserId: string;
    inviteePlayerId: string;
    invitationCode: string;
  }): Promise<unknown>;
}

interface AuthRequestContext {
/**
 * deviceId：客户端设备标识。
 */
  deviceId?: string;
  ip?: string;
  userAgent?: string;
}

interface RegisterOptions {
  invitationCode?: string;
}

/** 主线玩家鉴权编排服务：负责注册、登录、刷新和身份同步。 */
@Injectable()
export class NativePlayerAuthService {
  /** 记录账号生命周期关键操作。 */
  private readonly logger = new Logger(NativePlayerAuthService.name);  
  /**
 * worldPlayerTokenCodecService：世界玩家TokenCodec服务引用。
 */


  private readonly worldPlayerTokenCodecService: WorldPlayerTokenCodecPort;  
  /**
 * playerIdentityPersistenceService：玩家IdentityPersistence服务引用。
 */


  private readonly playerIdentityPersistenceService: PlayerIdentityPersistencePort;  
  /**
 * playerRuntimeService：玩家运行态服务引用。
 */


  private readonly playerRuntimeService: PlayerRuntimePort;  
  /**
 * worldPlayerSnapshotService：世界玩家快照服务引用。
 */


  private readonly worldPlayerSnapshotService: WorldPlayerSnapshotPort;

  /** 账号索引与唯一性检查入口。 */
  constructor(
    private readonly authStore: NativePlayerAuthStoreService,
    private readonly avatarStore: PlayerAvatarStoreService,
    @Inject(WorldPlayerTokenCodecService)
    worldPlayerTokenCodecService: unknown,
    @Inject(PlayerIdentityPersistenceService)
    playerIdentityPersistenceService: unknown,
    @Inject(PlayerRuntimeService)
    playerRuntimeService: unknown,
    @Inject(WorldPlayerSnapshotService)
    worldPlayerSnapshotService: unknown,
    @Optional()
    @Inject(ActivityPersistenceService)
    private readonly activityPersistenceService: ActivityPersistencePort | null = null,
  ) {
    this.worldPlayerTokenCodecService = worldPlayerTokenCodecService as WorldPlayerTokenCodecPort;
    this.playerIdentityPersistenceService = playerIdentityPersistenceService as PlayerIdentityPersistencePort;
    this.playerRuntimeService = playerRuntimeService as PlayerRuntimePort;
    this.worldPlayerSnapshotService = worldPlayerSnapshotService as WorldPlayerSnapshotPort;
  }

  /** 注册新账号，并完成建档、持久化与令牌签发。 */
  async register(
    accountName: string,
    password: string,
    displayName: string,
    roleName: string,
    context: AuthRequestContext = {},
    options: RegisterOptions = {},
  ): Promise<AuthTokens> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    this.authStore.assertOperational();
    const normalizedUsername = normalizeUsername(accountName);
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const normalizedRoleName = normalizeRoleName(roleName) || buildDefaultRoleName(normalizedUsername);

    const usernameError = validateUsername(normalizedUsername);
    if (usernameError) {
      throw new BadRequestException(usernameError);
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new BadRequestException(passwordError);
    }

    const displayNameError = validateDisplayName(normalizedDisplayName);
    if (displayNameError) {
      throw new BadRequestException(displayNameError);
    }

    const roleNameError = validateRoleName(normalizedRoleName);
    if (roleNameError) {
      throw new BadRequestException(roleNameError);
    }

    const usernameConflict = await this.authStore.ensureAvailable(normalizedUsername, 'account');
    if (usernameConflict) {
      throw new BadRequestException(usernameConflict);
    }

    const displayNameConflict = await this.authStore.ensureAvailable(normalizedDisplayName, 'display');
    if (displayNameConflict) {
      throw new BadRequestException(displayNameConflict);
    }

    const roleNameConflict = await this.authStore.ensureAvailable(normalizedRoleName, 'role');
    if (roleNameConflict) {
      throw new BadRequestException(roleNameConflict);
    }

    const registerIp = normalizeContextString(context.ip, 64);

    const requestedInvitationCode = normalizeInviteCode(options.invitationCode);
    const inviterUser = requestedInvitationCode
      ? await this.authStore.findUserByInviteCode(requestedInvitationCode)
      : null;
    if (requestedInvitationCode && !inviterUser) {
      throw new BadRequestException('邀請碼無效');
    }
    if (requestedInvitationCode && this.activityPersistenceService && !this.activityPersistenceService.isEnabled()) {
      throw new BadRequestException('活動服務暫不可用，暫不能使用邀請碼');
    }

    const userId = randomUUID();
    const playerId = buildPlayerId(userId);
    const createdAt = new Date().toISOString();
    const inviteCode = await this.generateUniqueInviteCode();
    const userCandidate = {
      id: userId,
      userId,
      username: normalizedUsername,
      displayName: normalizedDisplayName,
      pendingRoleName: normalizedRoleName,
      playerId,
      playerName: normalizedRoleName,
      passwordHash: await hashPassword(password),
      totalOnlineSeconds: 0,
      currentOnlineStartedAt: null,
      registerIp,
      lastLoginIp: registerIp,
      lastLoginAt: createdAt,
      inviteCode,
      registerInvitationCode: requestedInvitationCode || null,
      registerDeviceId: normalizeContextString(context.deviceId, 64),
      lastLoginDeviceId: normalizeContextString(context.deviceId, 64),
      lastUserAgent: normalizeContextString(context.userAgent, 255),
      bannedAt: null,
      banReason: null,
      bannedBy: null,
      createdAt,
      updatedAt: Date.now(),
    };
    const user = await this.authStore.saveUser(userCandidate);
    if (!user) {
      throw new InternalServerErrorException('註冊儲存失敗');
    }

    await this.persistIdentity(user);
    await this.ensureStarterSnapshot(user.playerId);
    if (inviterUser && requestedInvitationCode && this.activityPersistenceService?.isEnabled()) {
      await this.activityPersistenceService.createInvitationRecord({
        inviterUserId: inviterUser.userId,
        inviterPlayerId: inviterUser.playerId,
        inviteeUserId: user.userId,
        inviteePlayerId: user.playerId,
        invitationCode: requestedInvitationCode,
      });
    }
    return this.issueTokens(user);
  }

  private async generateUniqueInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateInviteCode();
      if (!await this.authStore.findUserByInviteCode(code)) {
        return code;
      }
    }
    return `${generateInviteCode()}${Date.now().toString(36).toUpperCase().slice(-4)}`.slice(0, 32);
  }

  /** 登录现有账号，兼容账号名、角色名和旧 username 入口。 */
  async login(loginName: string, password: string, context: AuthRequestContext = {}): Promise<AuthTokens> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    this.authStore.assertOperational();
    const normalizedLoginName = normalizeUsername(loginName).trim();
    const directUser = await this.authStore.findUserByUsername(normalizedLoginName);
    const roleMatchedUsers = await this.authStore.findUsersByRoleName(normalizedLoginName);
    const candidates = new Map<string, NativePlayerAuthUser>();
    if (directUser) {
      candidates.set(directUser.id, directUser);
    }
    for (const user of roleMatchedUsers) {
      candidates.set(user.id, user);
    }

    if (candidates.size === 0) {
      throw new UnauthorizedException('使用者不存在');
    }

    const matchResults = await Promise.all(
      [...candidates.values()].map(async (user) => ({
        user,
        matched: await verifyPassword(password, user.passwordHash),
      })),
    );
    const matchedUsers: NativePlayerAuthUser[] = matchResults
      .filter((entry) => entry.matched)
      .map((entry) => entry.user);

    if (matchedUsers.length === 0) {
      throw new UnauthorizedException('密碼錯誤');
    }

    let user = directUser && matchedUsers.some((entry) => entry.id === directUser.id)
      ? directUser
      : matchedUsers.length === 1
        ? matchedUsers[0]
        : null;
    if (!user) {
      throw new BadRequestException('該角色名對應多個帳號，請改用帳號登入');
    }

    this.assertUserNotBanned(user);
    user = await this.upgradePasswordHashIfNeeded(user, password);
    user = await this.touchLoginMetadata(user, context);
    await this.persistIdentity(user);
    await this.ensureStarterSnapshot(user.playerId);
    return this.issueTokens(user);
  }

  /** 刷新登录态，但只接受普通玩家令牌。 */
  async refresh(refreshToken: string, context: AuthRequestContext = {}): Promise<AuthTokens> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    this.authStore.assertOperational();
    const payload = this.worldPlayerTokenCodecService.validateRefreshToken(typeof refreshToken === 'string' ? refreshToken.trim() : '');
    if (!payload || payload.role === 'gm' || typeof payload.sub !== 'string' || typeof payload.username !== 'string') {
      throw new UnauthorizedException('重新整理令牌無效或已過期');
    }

    const user = await this.authStore.findUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('使用者不存在');
    }

    this.assertUserNotBanned(user);
    await this.touchLoginMetadata(user, context);
    await this.persistIdentity(user);
    await this.ensureStarterSnapshot(user.playerId);
    return this.issueTokens(user);
  }

  /** 检查显示名可用性，供注册页和 GM 修改前复用。 */
  async checkDisplayName(displayName = ''): Promise<DisplayNameAvailabilityResult> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    this.authStore.assertOperational();
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const error = validateDisplayName(normalizedDisplayName);
    if (error) {
      return { available: false, message: error };
    }

    const conflict = await this.authStore.ensureAvailable(normalizedDisplayName, 'display');
    if (conflict) {
      return { available: false, message: conflict };
    }

    return { available: true };
  }

  /** 修改当前账号密码。 */
  async updatePassword(accessToken: string, currentPassword: string, newPassword: string): Promise<{  
  /**
 * ok：ok相关字段。
 */
 ok: true }> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    this.authStore.assertOperational();
    const user = await this.requireUser(accessToken);
    if (!await verifyPassword(currentPassword, user.passwordHash)) {
      throw new BadRequestException('目前密碼錯誤');
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      throw new BadRequestException(passwordError);
    }

    await this.authStore.saveUser({
      ...user,
      passwordHash: await hashPassword(newPassword),
      updatedAt: Date.now(),
    });
    return { ok: true };
  }

  /** 修改当前账号显示名，并同步回持久化和 runtime。 */
  async updateDisplayName(accessToken: string, displayName: string): Promise<{  
  /**
 * displayName：显示名称名称或显示文本。
 */
 displayName: string }> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    this.authStore.assertOperational();
    const user = await this.requireUser(accessToken);
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const displayNameError = validateDisplayName(normalizedDisplayName);
    if (displayNameError) {
      throw new BadRequestException(displayNameError);
    }

    const currentDisplayName = resolveDisplayName(user.displayName, user.username);
    if (normalizedDisplayName === currentDisplayName) {
      return { displayName: normalizedDisplayName };
    }

    const displayNameConflict = await this.authStore.ensureAvailable(normalizedDisplayName, 'display', {
      exclude: [{ userId: user.id, kind: 'display' }],
    });
    if (displayNameConflict) {
      throw new BadRequestException(displayNameConflict);
    }

    const nextUser = await this.authStore.saveUser({
      ...user,
      displayName: normalizedDisplayName,
      updatedAt: Date.now(),
    });
    await this.persistIdentity(nextUser);
    this.syncRuntimeDisplayName(nextUser);
    return { displayName: normalizedDisplayName };
  }

  /** 修改当前账号角色名，并同步回持久化和 runtime。 */
  async updateRoleName(accessToken: string, roleName: string): Promise<{  
  /**
 * roleName：role名称名称或显示文本。
 */
 roleName: string }> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    this.authStore.assertOperational();
    const user = await this.requireUser(accessToken);
    const normalizedRoleName = normalizeRoleName(roleName);
    const roleNameError = validateRoleName(normalizedRoleName);
    if (roleNameError) {
      throw new BadRequestException(roleNameError);
    }

    if (normalizeRoleName(user.pendingRoleName) === normalizedRoleName) {
      return { roleName: normalizedRoleName };
    }

    const roleNameConflict = await this.authStore.ensureAvailable(normalizedRoleName, 'role', {
      exclude: [{ userId: user.id, kind: 'role' }],
    });
    if (roleNameConflict) {
      throw new BadRequestException(roleNameConflict);
    }

    const nextUser = await this.authStore.saveUser({
      ...user,
      pendingRoleName: normalizedRoleName,
      playerName: normalizedRoleName,
      updatedAt: Date.now(),
    });
    await this.persistIdentity(nextUser);
    this.syncRuntimeRoleName(nextUser);
    return { roleName: normalizedRoleName };
  }

  /** 上传（覆盖）当前玩家头像；白名单内、不超过上限的 base64 data URL。
   * 收取后统一正规化：真实解码验证 → 等比缩到最长边 ≤128（保持长宽比，16:9/9:16 不裁不补边）→ 重编码 WebP 压缩存储。 */
  async uploadAvatar(accessToken: string, dataUrl: string): Promise<{ version: number }> {
    this.authStore.assertOperational();
    const user = await this.requireUser(accessToken);

    const match = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(
      typeof dataUrl === 'string' ? dataUrl.trim() : '',
    );
    if (!match) {
      throw new BadRequestException('頭像格式無效，請上傳 base64 圖片');
    }
    const mime = match[1] ?? '';
    if (!PLAYER_AVATAR_MIME_WHITELIST.includes(mime)) {
      throw new BadRequestException('頭像僅支援 PNG / JPEG / GIF / WebP 格式');
    }
    const data = Buffer.from(match[2] ?? '', 'base64');
    if (data.byteLength <= 0) {
      throw new BadRequestException('頭像內容為空');
    }
    if (data.byteLength > MAX_PLAYER_AVATAR_BYTES) {
      throw new BadRequestException('頭像檔案過大，請上傳 4MB 內的圖片');
    }

    const normalized = await normalizeAvatarImage(data);
    const version = await this.avatarStore.saveAvatar(user.playerId, normalized.mime, normalized.data);
    return { version };
  }

  /** 移除当前玩家头像，回退默认形象；未设置过也算成功（幂等）。 */
  async removeAvatar(accessToken: string): Promise<{ ok: true }> {
    this.authStore.assertOperational();
    const user = await this.requireUser(accessToken);
    await this.avatarStore.deleteAvatar(user.playerId);
    return { ok: true };
  }
  /**
 * requireUser：执行requireUser相关逻辑。
 * @param accessToken string 参数说明。
 * @returns 返回 Promise，完成后得到requireUser。
 */


  private async requireUser(accessToken: string): Promise<NativePlayerAuthUser> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const token = typeof accessToken === 'string' ? accessToken.trim() : '';
    if (!token) {
      throw new UnauthorizedException('未登入');
    }

    const payload = this.worldPlayerTokenCodecService.validateAccessToken(token);
    if (typeof payload?.sub !== 'string') {
      throw new UnauthorizedException('登入已失效');
    }

    const user = await this.authStore.findUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('使用者不存在');
    }
    this.assertUserNotBanned(user);
    return user;
  }  
  /**
 * issueTokens：判断issueToken是否满足条件。
 * @param user NativePlayerAuthUser 参数说明。
 * @returns 返回issueToken。
 */


  private issueTokens(user: NativePlayerAuthUser): AuthTokens {
    const displayName = resolveDisplayName(user.displayName, user.username);
    const playerName = user.pendingRoleName?.trim() || user.username;
    const payload = {
      sub: user.id,
      username: user.username,
      displayName,
      playerId: user.playerId,
      playerNo: user.playerNo,
      playerName,
    };

    return {
      accessToken: this.worldPlayerTokenCodecService.issueAccessToken(payload),
      refreshToken: this.worldPlayerTokenCodecService.issueRefreshToken(payload),
    };
  }  
  /**
 * persistIdentity：判断persistIdentity是否满足条件。
 * @param user NativePlayerAuthUser 参数说明。
 * @returns 返回 Promise，完成后得到persistIdentity。
 */


  private async persistIdentity(user: NativePlayerAuthUser): Promise<void> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (!this.playerIdentityPersistenceService.isEnabled()) {
      return;
    }

    try {
      await this.playerIdentityPersistenceService.savePlayerIdentity({
        version: 1,
        userId: user.id,
        username: user.username,
        displayName: resolveDisplayName(user.displayName, user.username),
        playerId: user.playerId,
        playerNo: user.playerNo,
        playerName: user.pendingRoleName?.trim() || user.username,
        persistedSource: 'native',
        updatedAt: Date.now(),
      });
    } catch (error) {
      this.logger.warn(`持久化主线玩家身份失败：userId=${user.id} error=${error instanceof Error ? error.message : String(error)}`);
    }
  }  
  /**
 * ensureStarterSnapshot：执行ensureStarter快照相关逻辑。
 * @param playerId string 玩家 ID。
 * @returns 返回 Promise，完成后得到ensureStarter快照。
 */


  private async ensureStarterSnapshot(playerId: string): Promise<void> {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (!this.worldPlayerSnapshotService || typeof this.worldPlayerSnapshotService.ensureNativeStarterSnapshot !== 'function') {
      return;
    }

    const result = await this.worldPlayerSnapshotService.ensureNativeStarterSnapshot(playerId).catch((error: unknown) => ({
      ok: false,
      failureStage: error instanceof Error ? error.message : String(error),
    }));

    if (result?.ok === false && result.failureStage !== 'native_snapshot_recovery_persistence_disabled') {
      this.logger.warn(`补建原生初始快照已跳过：playerId=${playerId} reason=${result.failureStage ?? '未知'}`);
    }
  }

  private async upgradePasswordHashIfNeeded(user: NativePlayerAuthUser, password: string): Promise<NativePlayerAuthUser> {
    if (!isPasswordHashUpgradeRequired(user.passwordHash)) {
      return user;
    }

    return this.authStore.saveUser({
      ...user,
      passwordHash: await hashPassword(password),
      updatedAt: Date.now(),
    });
  }

  private async touchLoginMetadata(user: NativePlayerAuthUser, context: AuthRequestContext): Promise<NativePlayerAuthUser> {
    const lastLoginIp = normalizeContextString(context.ip, 64) ?? user.lastLoginIp;
    const lastLoginDeviceId = normalizeContextString(context.deviceId, 64) ?? user.lastLoginDeviceId;
    const lastUserAgent = normalizeContextString(context.userAgent, 255) ?? user.lastUserAgent;
    const nextUser = await this.authStore.saveUser({
      ...user,
      lastLoginIp,
      lastLoginAt: new Date().toISOString(),
      lastLoginDeviceId,
      lastUserAgent,
      updatedAt: Date.now(),
    });
    return nextUser;
  }

  private assertUserNotBanned(user: NativePlayerAuthUser): void {
    if (!user.bannedAt) {
      return;
    }
    const reason = typeof user.banReason === 'string' && user.banReason.trim()
      ? user.banReason.trim()
      : '';
    throw new UnauthorizedException(reason ? `帳號已封鎖：${reason}` : '帳號已封鎖，請聯繫 GM 處理');
  }

  /**
 * syncRuntimeDisplayName：判断运行态显示名称是否满足条件。
 * @param user NativePlayerAuthUser 参数说明。
 * @returns 无返回值，直接更新运行态显示名称相关状态。
 */


  private syncRuntimeDisplayName(user: NativePlayerAuthUser): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (!this.playerRuntimeService.getPlayerIdentityProjection(user.playerId)) {
      return;
    }

    this.playerRuntimeService.setIdentity(user.playerId, {
      displayName: resolveDisplayName(user.displayName, user.username),
    });
  }  
  /**
 * syncRuntimeRoleName：处理运行态Role名称并更新相关状态。
 * @param user NativePlayerAuthUser 参数说明。
 * @returns 无返回值，直接更新运行态Role名称相关状态。
 */


  private syncRuntimeRoleName(user: NativePlayerAuthUser): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const runtime = this.playerRuntimeService.getPlayerIdentityProjection(user.playerId);
    if (!runtime) {
      return;
    }

    this.playerRuntimeService.setIdentity(user.playerId, {
      name: user.pendingRoleName?.trim() || user.username,
      displayName: runtime.displayName,
    });
  }
}
/**
 * buildPlayerId：构建并返回目标对象。
 * @param userId string user ID。
 * @returns 返回玩家ID。
 */


function buildPlayerId(userId: string): string {
  return `p_${String(userId ?? '').trim()}`;
}

function normalizeContextString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeInviteCode(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 32)
    : '';
}

function generateInviteCode(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = randomBytes(10);
  let code = '';
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return code;
}
