import type { PipelineContext } from '../technique-activity-strategy';
import type { FacilityWorkPort } from '../../../spirit-beast/facility-work.port';

export function validateFacilityWork(player: any, payload: any, skill: string, ctx: PipelineContext) {
  const orderId = typeof payload?.facilityOrderId === 'string' ? payload.facilityOrderId.trim() : '';
  const port = resolveFacilityPort(ctx);
  if (!orderId || !player?.playerId || !port) return null;
  const assignment = port.getFacilityAssignment(player.playerId, orderId, skill);
  return assignment ? { facilityAssignment: true, ...assignment } : null;
}

export function createFacilityWorkJob(assignment: any, kind: string) {
  const totalTicks = Math.max(1, Math.trunc(Number(assignment.totalTicks) || 1));
  const remainingTicks = Math.max(1, Math.min(totalTicks, Math.trunc(Number(assignment.remainingTicks) || totalTicks)));
  return { jobRunId: assignment.orderId, jobType: kind, jobVersion: 1, facilityOrderId: assignment.orderId,
    stationInstanceId: assignment.instanceId, stationBuildingId: assignment.buildingId, stationSuccessBonus: 0.1,
    phase: 'working', startedAt: Date.now(), totalTicks, remainingTicks, workTotalTicks: totalTicks,
    workRemainingTicks: remainingTicks, pausedTicks: 0, interruptWaitRemainingTicks: 0, interruptState: null,
    successRate: 1, spiritStoneCost: 0 };
}

export function tickFacilityWork(player: any, job: any, ctx: PipelineContext, clear: () => void) {
  const port = resolveFacilityPort(ctx);
  const playerId = typeof player?.playerId === 'string' ? player.playerId : '';
  if (!job?.facilityOrderId) return null;
  if (job.phase === 'paused') {
    job.pausedTicks = Math.max(0, Math.trunc(Number(job.pausedTicks) || 0) - 1);
    job.interruptWaitRemainingTicks = job.pausedTicks;
    if (job.interruptState) job.interruptState = { ...job.interruptState, waitRemainingTicks: job.pausedTicks };
    if (job.pausedTicks <= 0) {
      job.phase = 'working'; job.interruptState = null; job.interruptWaitRemainingTicks = 0;
    }
    player?.dirtyDomains?.add?.('active_job');
    return empty(true);
  }
  if (!port?.isFacilityCurrent(playerId, job.facilityOrderId)) {
    port?.releaseFacilityWork(playerId, job.facilityOrderId);
    clear();
    return empty(true);
  }
  job.remainingTicks = Math.max(0, Math.trunc(Number(job.remainingTicks) || 0) - 1);
  job.workRemainingTicks = job.remainingTicks;
  player?.dirtyDomains?.add?.('active_job');
  if (job.remainingTicks <= 0) {
    port.completeFacilityWork(playerId, job.facilityOrderId);
    clear();
  }
  return empty(true);
}

export function releaseFacilityWork(player: any, job: any, ctx: PipelineContext): boolean {
  if (!job?.facilityOrderId) return false;
  resolveFacilityPort(ctx)?.releaseFacilityWork(player?.playerId ?? '', job.facilityOrderId);
  return true;
}

export function resolveFacilityPort(ctx: PipelineContext): FacilityWorkPort | null {
  return ctx.facilityWorkPort ?? ((ctx.deps as { facilityWorkPort?: FacilityWorkPort } | null)?.facilityWorkPort) ?? null;
}

function empty(panelChanged: boolean) {
  return { ok: true, panelChanged, inventoryChanged: false, equipmentChanged: false, attrChanged: false,
    messages: [], groundDrops: [], craftRealmExpGain: 0 };
}
