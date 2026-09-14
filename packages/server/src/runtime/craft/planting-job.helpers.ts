import type { PlayerPlantingJob } from '@mud/shared';

/** 新種植任務的持久化讀取邊界；身份或動作不完整就不恢復工作。 */
export function normalizePlantingJob(value: unknown): PlayerPlantingJob | null {
  if (!value || typeof value !== 'object') return null;
  const job = value as Partial<PlayerPlantingJob>;
  if (typeof job.orderId !== 'string' || !job.orderId || typeof job.buildingId !== 'string' || !job.buildingId
    || typeof job.instanceId !== 'string' || !job.instanceId
    || !['sow', 'water', 'harvest'].includes(job.action ?? '')
    || !Number.isFinite(job.targetX) || !Number.isFinite(job.targetY)) return null;
  const totalTicks = Math.max(1, Math.trunc(Number(job.totalTicks) || 1));
  const remainingTicks = Math.max(0, Math.min(totalTicks, Math.trunc(Number(job.remainingTicks) || 0)));
  return {
    jobRunId: job.orderId, jobType: 'planting', jobVersion: Math.max(1, Math.trunc(Number(job.jobVersion) || 1)),
    orderId: job.orderId, buildingId: job.buildingId, buildingName: job.buildingName || '靈田', instanceId: job.instanceId,
    targetX: job.targetX!, targetY: job.targetY!, action: job.action!, phase: job.phase === 'paused' ? 'paused' : 'planting',
    totalTicks, remainingTicks, workTotalTicks: totalTicks, workRemainingTicks: remainingTicks,
    startedAt: Math.max(0, Math.trunc(Number(job.startedAt) || 0)),
    pausedTicks: Math.max(0, Math.trunc(Number(job.pausedTicks) || 0)),
    interruptWaitRemainingTicks: Math.max(0, Math.trunc(Number(job.interruptWaitRemainingTicks) || 0)),
    interruptState: job.interruptState ? { ...job.interruptState } : null,
    successRate: 1, spiritStoneCost: 0,
  };
}
