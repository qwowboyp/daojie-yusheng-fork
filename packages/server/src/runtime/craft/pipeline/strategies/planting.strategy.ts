import type {
  PlayerPlantingJob,
  TechniqueActivityConditionCheckResult,
  TechniqueActivityRefundResult,
  TechniqueActivityResolveResult,
  TechniqueActivityStartValidationResult,
} from '@mud/shared';
import type { PlantingWorkAssignment } from '../../planting-work.port';
import type { PipelineContext, PersistenceDomain, TechniqueActivityStrategy } from '../technique-activity-strategy';

const JOB_SLOTS = ['alchemyJob', 'forgingJob', 'enhancementJob', 'transmissionJob', 'gatherJob',
  'miningJob', 'buildingJob', 'formationJob', 'plantingJob'] as const;
type PlantingPlayer = Record<string, unknown> & {
  playerId?: string;
  plantingJob?: PlayerPlantingJob | null;
  dirtyDomains?: Set<string>;
};

/** 播種、澆水、收割共用技藝 start/tick/interrupt/cancel/resolve；作物生長由靈田管理。 */
export class PlantingStrategy implements TechniqueActivityStrategy<PlayerPlantingJob, PlantingWorkAssignment> {
  readonly kind = 'planting' as const;
  readonly jobSlot = 'plantingJob';
  readonly skillSlot = 'plantingSkill';
  readonly activityLabel = '種植';
  readonly pauseTicks = 0;
  readonly conditional = true;

  getActiveJob(player: unknown): PlayerPlantingJob | null {
    return (player as PlantingPlayer)?.plantingJob ?? null;
  }
  setActiveJob(player: unknown, job: PlayerPlantingJob | null): void {
    (player as PlantingPlayer).plantingJob = job;
  }
  validateStart(player: unknown, payload: unknown, ctx: PipelineContext): TechniqueActivityStartValidationResult<PlantingWorkAssignment> {
    const record = player as PlantingPlayer;
    const orderId = (payload as { orderId?: unknown } | null)?.orderId;
    if (!record?.playerId || typeof orderId !== 'string' || !ctx.plantingWorkPort) {
      return { ok: false, error: 'spirit_beast.order_unavailable' };
    }
    if (JOB_SLOTS.some((slot) => Boolean(record[slot])) || (record.combat as { pendingSkillCast?: unknown } | undefined)?.pendingSkillCast) {
      return { ok: false, error: 'spirit_beast.worker_busy' };
    }
    const assignment = ctx.plantingWorkPort.getAssignment(record.playerId, orderId);
    if (!assignment || assignment.orderId !== orderId || !Number.isFinite(assignment.totalTicks) || assignment.totalTicks <= 0) {
      return { ok: false, error: 'spirit_beast.order_unavailable' };
    }
    return { ok: true, validated: assignment };
  }
  consumeResources(): void {
    // 工單的種子及工位預約已由宗門資產交易完成；此處不得再次扣除。
  }
  createJob(_player: unknown, assignment: PlantingWorkAssignment): PlayerPlantingJob {
    const totalTicks = Math.max(1, Math.ceil(assignment.totalTicks));
    const remainingTicks = Math.min(totalTicks, Math.max(1, Math.ceil(assignment.remainingTicks)));
    return {
      jobRunId: assignment.orderId, jobType: 'planting', jobVersion: 1, orderId: assignment.orderId,
      buildingId: assignment.buildingId, buildingName: assignment.buildingName, instanceId: assignment.instanceId,
      targetX: assignment.x, targetY: assignment.y, action: assignment.action, phase: 'planting',
      startedAt: Date.now(), totalTicks, remainingTicks, workTotalTicks: totalTicks, workRemainingTicks: remainingTicks,
      pausedTicks: 0, successRate: 1, spiritStoneCost: 0, interruptState: null, interruptWaitRemainingTicks: 0,
    };
  }
  startDirtyDomains(player: unknown): PersistenceDomain[] {
    (player as PlantingPlayer).dirtyDomains?.add('active_job');
    return ['active_job'];
  }
  resolveResumePhase(): string { return 'planting'; }
  isResolvePoint(job: PlayerPlantingJob): boolean {
    job.workRemainingTicks = job.remainingTicks;
    return job.remainingTicks <= 0;
  }
  checkContinueCondition(player: unknown, job: PlayerPlantingJob, ctx: PipelineContext): TechniqueActivityConditionCheckResult {
    const playerId = (player as PlantingPlayer).playerId ?? '';
    return ctx.plantingWorkPort?.isCurrent(playerId, job)
      ? { satisfied: true }
      : { satisfied: false, shouldCancel: true };
  }
  onConditionFailed(player: unknown, job: PlayerPlantingJob, ctx: PipelineContext): void {
    ctx.plantingWorkPort?.release((player as PlantingPlayer).playerId ?? '', job);
  }
  resolve(player: unknown, job: PlayerPlantingJob, ctx: PipelineContext): TechniqueActivityResolveResult {
    ctx.plantingWorkPort?.complete((player as PlantingPlayer).playerId ?? '', job);
    return {
      successCount: 0, failureCount: 0, outputs: [], completed: true, messages: [],
      // 經驗隨工單的持久化結算發放；此刻不可因重試重複取得。
      expParams: { playerRealmLevel: 1, skillLevel: 1, targetLevel: 1, baseActionTicks: 0,
        successCount: 0, failureCount: 0, getExpToNextByLevel: ctx.resolveExpToNextByLevel },
    };
  }
  computeRefund(): TechniqueActivityRefundResult { return { items: [], spiritStones: 0 }; }
  dirtyDomains(): PersistenceDomain[] { return ['active_job']; }
}
