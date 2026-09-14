/** 將靈獸工人接到共用技藝生命週期；DB reservation 仍負責跨程序唯一性。 */
import type {
  RuntimeTechniqueActivityKind,
  TechniqueActivityJobBase,
  TechniqueActivityResolveResult,
  TechniqueActivityStartValidationResult,
} from '@mud/shared';
import type { PipelineContext, TechniqueActivityStrategy } from '../craft/pipeline/technique-activity-strategy';

export interface SpiritBeastWorkerJob extends TechniqueActivityJobBase {
  jobRunId: string;
  jobType: RuntimeTechniqueActivityKind;
  jobVersion: number;
  orderId: string;
  phase: 'working';
}

export interface SpiritBeastPipelineWorker {
  playerId: string;
  beastId: string;
  activeJob: SpiritBeastWorkerJob | null;
}

interface ValidatedOrder { orderId: string; totalTicks: number; remainingTicks: number }
interface Port { complete(orderId: string): void; release(orderId: string): void }

export class SpiritBeastWorkStrategy implements TechniqueActivityStrategy<SpiritBeastWorkerJob, ValidatedOrder> {
  readonly jobSlot = 'activeJob';
  readonly skillSlot = 'unusedSpiritBeastSkill';
  readonly activityLabel = '靈獸工作';
  readonly pauseTicks = 0;
  readonly conditional = false;

  constructor(readonly kind: RuntimeTechniqueActivityKind, private readonly port: Port) {}

  getActiveJob(worker: unknown): SpiritBeastWorkerJob | null {
    return (worker as SpiritBeastPipelineWorker).activeJob ?? null;
  }

  setActiveJob(worker: unknown, job: SpiritBeastWorkerJob | null): void {
    (worker as SpiritBeastPipelineWorker).activeJob = job;
  }

  validateStart(_worker: unknown, payload: unknown): TechniqueActivityStartValidationResult<ValidatedOrder> {
    const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const orderId = typeof raw.orderId === 'string' ? raw.orderId.trim() : '';
    const totalTicks = Math.max(1, Math.trunc(Number(raw.totalTicks) || 1));
    const remainingTicks = Math.max(1, Math.min(totalTicks, Math.trunc(Number(raw.remainingTicks) || totalTicks)));
    return orderId ? { ok: true, validated: { orderId, totalTicks, remainingTicks } }
      : { ok: false, error: 'SPIRIT_WORK_ORDER_NOT_FOUND' };
  }

  consumeResources(): void {}

  createJob(_worker: unknown, validated: ValidatedOrder): SpiritBeastWorkerJob {
    return { jobRunId: `spirit:${validated.orderId}`, jobType: this.kind, jobVersion: 1,
      orderId: validated.orderId, phase: 'working', totalTicks: validated.totalTicks,
      remainingTicks: validated.remainingTicks, startedAt: Date.now(), pausedTicks: 0,
      interruptWaitRemainingTicks: 0, interruptState: null, successRate: 1, spiritStoneCost: 0 };
  }

  resolveResumePhase(): string { return 'working'; }
  isResolvePoint(job: SpiritBeastWorkerJob): boolean { return job.remainingTicks <= 0; }

  resolve(_worker: unknown, job: SpiritBeastWorkerJob): TechniqueActivityResolveResult {
    this.port.complete(job.orderId);
    return { successCount: 1, failureCount: 0, outputs: [], completed: true, messages: [],
      expParams: { playerRealmLevel: 1, skillLevel: 1, targetLevel: 1, baseActionTicks: 1,
        getExpToNextByLevel: () => 1 } };
  }

  computeRefund(_worker: unknown, job: SpiritBeastWorkerJob) {
    this.port.release(job.orderId);
    return { items: [], spiritStones: 0, messages: [] };
  }

  dirtyDomains() { return [] as []; }
}

export function createSpiritBeastPipelineContext(): PipelineContext {
  return { contentTemplateRepository: { getItemName: () => null, normalizeItem: (item) => item },
    resolveExpToNextByLevel: () => 0, getInstanceRuntime: () => null, deps: null };
}
