/**
 * 本文件属于服务端 HTTP 或 GM 辅助入口，负责把运维能力接入内部服务。
 *
 * 维护时要注意鉴权、审计和后台任务边界，避免把管理操作暴露成无保护公开接口。
 */
/**
 * GM 功法生成 HTTP 服务。
 * 提供绕过玩家物品与境界门槛直接触发 AI 功法生成的能力，仅限 GM 鉴权调用。
 * 不消耗悟道玉简，不参与玩家背包与领悟进度，仅把生成结果写入 generated_technique 表。
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { TechniqueCategory } from '@mud/shared';
import { TechniqueGenerationService } from '../../runtime/technique-generation/technique-generation.service';
import { TECHNIQUE_GENERATION_UNLOCK_REALM_LV } from '../../runtime/technique-generation/technique-generation-constants';
import { PlayerRuntimeService } from '../../runtime/player/player-runtime.service';

const GM_BYPASS_REALM_LV = 999;

export type GmTechniqueGenerationMode = 'single' | 'batch';

export interface GmTechniqueGenerationRunReq {
  playerId?: unknown;
  mode?: unknown;
  category?: unknown;
  playerContext?: unknown;
  bypassRealmCheck?: unknown;
}

export interface GmTechniqueGenerationRunRes {
  success: boolean;
  jobId?: string;
  batchId?: string;
  mode: GmTechniqueGenerationMode;
  category?: TechniqueCategory;
  error?: string;
  errorCode?: string;
}

export interface GmTechniqueGenerationForceDiscardReq {
  jobId?: unknown;
  reason?: unknown;
}

export interface GmTechniqueGenerationForceDiscardRes {
  success: boolean;
  jobId: string;
  previousStatus?: string;
  newStatus?: string;
  error?: string;
  errorCode?: 'JOB_NOT_FOUND' | 'JOB_STATE_INVALID' | string;
}

interface SessionFenceLike {
  runtimeOwnerId?: string | null;
  sessionEpoch?: number | null;
}

interface PlayerRuntimeServiceLike {
  getPlayerRealmLv(playerId: string): number | null;
  getPlayerHighestRealmLv(playerId: string): number | null;
  getSessionFence(playerId: string): SessionFenceLike | null;
}

@Injectable()
export class NativeGmTechniqueGenerationService {
  constructor(
    @Inject(TechniqueGenerationService) private readonly techniqueGenerationService: TechniqueGenerationService,
    @Inject(PlayerRuntimeService) private readonly playerRuntimeService: PlayerRuntimeServiceLike,
  ) {}

  /** GM 直接触发一次 AI 功法生成；不校验背包、不结算领悟进度。 */
  async runTechniqueGeneration(body: GmTechniqueGenerationRunReq): Promise<GmTechniqueGenerationRunRes> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('请求体不能为空');
    }
    const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
    if (!playerId) {
      throw new BadRequestException('playerId 必填');
    }
    const mode: GmTechniqueGenerationMode = body.mode === 'single' ? 'single' : 'batch';
    const category = this.parseCategory(body.category);
    if (mode === 'single' && !category) {
      throw new BadRequestException('single 模式必须指定 category 为 internal/arts/divine/secret');
    }
    const playerContext = typeof body.playerContext === 'string' ? body.playerContext : undefined;
    const bypassRealmCheck = body.bypassRealmCheck === true;

    const playerRealmLv = this.playerRuntimeService.getPlayerRealmLv(playerId);
    const playerHighestRealmLv = this.playerRuntimeService.getPlayerHighestRealmLv(playerId) ?? playerRealmLv;
    if (playerHighestRealmLv === null) {
      throw new NotFoundException(`找不到玩家 ${playerId} 的境界数据`);
    }

    const realmLv = playerRealmLv ?? playerHighestRealmLv;
    const effectiveHighest = bypassRealmCheck ? GM_BYPASS_REALM_LV : playerHighestRealmLv;
    if (effectiveHighest < TECHNIQUE_GENERATION_UNLOCK_REALM_LV) {
      throw new BadRequestException(
        `玩家境界 ${playerHighestRealmLv} 低于解锁门槛 ${TECHNIQUE_GENERATION_UNLOCK_REALM_LV}；如需绕过请设置 bypassRealmCheck=true`,
      );
    }

    const fence = this.playerRuntimeService.getSessionFence(playerId);
    const runtimeOwnerId = fence?.runtimeOwnerId ?? 'gm-bypass';
    const sessionEpoch = fence?.sessionEpoch ?? 1;
    const common = {
      playerId,
      playerRealmLv: realmLv,
      playerHighestRealmLv: effectiveHighest,
      playerContext,
      expectedRuntimeOwnerId: runtimeOwnerId,
      expectedSessionEpoch: sessionEpoch,
      applyInventorySnapshot: async () => undefined,
      settleFailedRefund: async () => false,
      bypassInventoryCheck: true,
    };
    const result = mode === 'batch'
      ? await this.techniqueGenerationService.requestBatchGeneration(common)
      : await this.techniqueGenerationService.requestGeneration({ ...common, category: category as TechniqueCategory });
    return {
      success: result.success,
      jobId: result.jobId,
      batchId: result.batchId,
      mode,
      category: mode === 'single' ? category : undefined,
      error: result.error,
      errorCode: result.errorCode,
    };
  }

  /**
   * GM 强制丢弃一个功法生成任务（含 batch 內任一 job）。
   * 對應 GM 觸發 AI 生成的 force-run，給 GM 一條對稱的清理路徑。
   * 限制：僅允許把 pending/running/generated_draft 推進到 discarded；终态拒绝。
   */
  async forceDiscardJob(body: GmTechniqueGenerationForceDiscardReq): Promise<GmTechniqueGenerationForceDiscardRes> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('请求体不能为空');
    }
    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
    if (!jobId) {
      throw new BadRequestException('jobId 必填');
    }
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 200)
      : 'GM 强制丢弃';
    const result = await this.techniqueGenerationService.gmForceDiscardJob(jobId, reason);
    return {
      success: result.success,
      jobId: result.jobId,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      error: result.errorCode === 'JOB_NOT_FOUND'
        ? 'job_not_found'
        : result.errorCode === 'JOB_STATE_INVALID'
          ? 'job_state_invalid'
          : undefined,
      errorCode: result.errorCode,
    };
  }

  private parseCategory(raw: unknown): TechniqueCategory | undefined {
    if (raw === 'internal' || raw === 'arts' || raw === 'divine' || raw === 'secret') return raw;
    return undefined;
  }
}
