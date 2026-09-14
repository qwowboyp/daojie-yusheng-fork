/**
 * 本文件属于服务端权威运行时，负责地图、玩家、世界、市场、邮件或后台运行态逻辑。
 *
 * 维护时要保持状态变更受控，所有影响资产或位置的结果都应能被持久化与恢复链覆盖。
 */
/**
 * 强化策略。
 * start/cancel 已拆入 pipeline strategy；tick/interrupt 仍在迁移期委托旧 service。
 */
import type {
  TechniqueActivityResolveResult,
  TechniqueActivityRefundResult,
  TechniqueActivityStartValidationResult,
} from '@mud/shared';
import type { TechniqueActivityStrategy, PipelineContext, PersistenceDomain } from '../technique-activity-strategy';
import { computeEnhancementCancelRefund } from './enhancement-cancel.helpers';
import { executeEnhancementTick } from './enhancement-tick.helpers';
import { createFacilityWorkJob, releaseFacilityWork, tickFacilityWork, validateFacilityWork } from './facility-work-pipeline.helpers';

export class EnhancementStrategy implements TechniqueActivityStrategy {
  readonly kind = 'enhancement' as const;
  readonly jobSlot = 'enhancementJob';
  readonly skillSlot = 'enhancementSkill';
  readonly activityLabel = '強化';
  readonly pauseTicks = 10;
  readonly conditional = false;

  constructor(private craftService: any) {}

  getActiveJob(player: unknown): any {
    return (player as any).enhancementJob ?? null;
  }

  setActiveJob(player: unknown, job: any | null): void {
    (player as any).enhancementJob = job;
  }

  executeTick(player: unknown, ctx: PipelineContext): unknown {
    const facility = tickFacilityWork(player, this.getActiveJob(player), ctx, () => this.setActiveJob(player, null));
    if (facility) return facility;
    return executeEnhancementTick(this.craftService, player, ctx);
  }

  // ─── Start 生命周期插槽 ───

  validateStart(player: unknown, payload: unknown, ctx: PipelineContext): TechniqueActivityStartValidationResult {
    const facility = validateFacilityWork(player, payload, 'enhancement', ctx);
    if (facility) return { ok: true, validated: facility };
    return this.craftService.validateEnhancementStart(player, payload);
  }

  queueStart(player: unknown, validated: unknown, payload: unknown, _ctx: PipelineContext): unknown | null {
    if ((validated as any)?.facilityAssignment) return null;
    return this.craftService.queueEnhancementStart(player, validated, payload);
  }

  consumeResources(player: unknown, validated: unknown, _ctx: PipelineContext): { ok: true } | { ok: false; error?: string } | void {
    if ((validated as any)?.facilityAssignment) return;
    return this.craftService.consumeEnhancementStartResources(player, validated);
  }

  createJob(player: unknown, validated: unknown, _ctx: PipelineContext): any {
    if ((validated as any)?.facilityAssignment) return createFacilityWorkJob(validated, 'enhancement');
    const job = this.craftService.createEnhancementStartJob(player, validated);
    this.craftService.finalizeEnhancementStart(player);
    return job;
  }

  buildStartMessages(_player: unknown, validated: unknown, job: any, _ctx: PipelineContext): any[] {
    if ((validated as any)?.facilityAssignment) return [];
    return this.craftService.buildEnhancementStartMessages(validated, job);
  }

  // ─── Tick/resolve 接口占位（executeTick 优先时不会被调用） ───

  resolveResumePhase(): string { return 'enhancing'; }

  isResolvePoint(job: any): boolean { return job.remainingTicks <= 0; }

  resolve(): TechniqueActivityResolveResult {
    return { successCount: 0, failureCount: 0, outputs: [], expParams: { playerRealmLevel: 1, skillLevel: 1, targetLevel: 1, baseActionTicks: 1, getExpToNextByLevel: () => 100 }, completed: true };
  }

  computeRefund(player: unknown, job: any, ctx: PipelineContext): TechniqueActivityRefundResult {
    if (releaseFacilityWork(player, job, ctx)) return { items: [], spiritStones: 0 };
    return computeEnhancementCancelRefund(this.craftService, player);
  }

  dirtyDomains(): PersistenceDomain[] {
    return ['active_job', 'equipment', 'enhancement_record', 'profession'];
  }
}
