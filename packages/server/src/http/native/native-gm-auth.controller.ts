/**
 * 本文件属于服务端 HTTP 或 GM 辅助入口，负责把运维能力接入内部服务。
 *
 * 维护时要注意鉴权、审计和后台任务边界，避免把管理操作暴露成无保护公开接口。
 */
/**
 * GM 鉴权 HTTP 控制器。
 * 提供 GM 登录和修改 GM 密码两个端点，登录端点受限流保护，
 * 修改密码端点需要已有的 GM access token。
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';

import { RuntimeGmAuthService } from '../../runtime/gm/runtime-gm-auth.service';
import { NativeAuthRateLimitService } from './native-auth-rate-limit.service';
import { GM_HTTP_CONTRACT } from './native-gm-contract';
import { NativeGmAuthGuard } from './native-gm-auth.guard';

/** GM 登录请求体。 */
interface GmLoginBody {
  password?: string;
  scopes?: unknown;
  scope?: unknown;
  role?: unknown;
}

/** GM 修改密码请求体。 */
interface GmChangePasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

interface RequestLike {
  [key: string]: unknown;
}

/** 所有校验同一 GM 密码的公开入口共享主体失败预算，不能由调用方输入拆桶。 */
const GM_AUTH_RATE_LIMIT_SUBJECT = 'gm';

/** GM 鉴权服务端口：登录和修改密码。 */
interface RuntimeGmAuthServicePort {
  login(password: string, options?: { scopes?: unknown; scope?: unknown; role?: unknown }): Promise<unknown>;
  changePassword(currentPassword: string, newPassword: string): Promise<unknown>;
}

/** GM 鉴权控制器：提供 GM 登录和密码修改端点。 */
@Controller(GM_HTTP_CONTRACT.authBasePath)
export class NativeGmAuthController {
  constructor(
    @Inject(RuntimeGmAuthService) private readonly authService: RuntimeGmAuthServicePort,
    private readonly rateLimitService: NativeAuthRateLimitService,
  ) {}

  /** GM 登录，受限流保护；成功返回 access token。 */
  @Post('gm/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: GmLoginBody, @Req() request: RequestLike) {
    this.rateLimitService.assertAllowed('gmLogin', request, GM_AUTH_RATE_LIMIT_SUBJECT);
    try {
      const result = await this.authService.login(body?.password ?? '', {
        scopes: body?.scopes,
        scope: body?.scope,
        role: body?.role,
      });
      this.rateLimitService.recordSuccess('gmLogin', request, GM_AUTH_RATE_LIMIT_SUBJECT);
      return result;
    } catch (error) {
      this.rateLimitService.recordFailure('gmLogin', request, GM_AUTH_RATE_LIMIT_SUBJECT);
      throw error;
    }
  }

  /** 修改 GM 密码，需已有有效 GM token。 */
  @Post('gm/password')
  @UseGuards(NativeGmAuthGuard)
  async changePassword(@Body() body: GmChangePasswordBody) {
    await this.authService.changePassword(body?.currentPassword ?? '', body?.newPassword ?? '');
    return { ok: true };
  }
}