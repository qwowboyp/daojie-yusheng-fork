/**
 * 本文件属于服务端权威运行时，负责地图、玩家、世界、市场、邮件或后台运行态逻辑。
 *
 * 维护时要保持状态变更受控，所有影响资产或位置的结果都应能被持久化与恢复链覆盖。
 */
import { Injectable } from '@nestjs/common';

const MOVEMENT_FRAME_INTERVAL_MS = 100;
const PAUSED_MOVEMENT_RECHECK_INTERVAL_MS = 1000;

function resolveMiningJobTargetRef(job) {
    if (!job || !Number.isFinite(Number(job.targetX)) || !Number.isFinite(Number(job.targetY))) {
        return '';
    }
    return `tile:${Math.trunc(Number(job.targetX))}:${Math.trunc(Number(job.targetY))}`;
}

function hasMiningJobCommandMarker(command) {
    return typeof command?.miningJobRunId === 'string' && command.miningJobRunId.trim().length > 0;
}

function isMatchingMiningJobCommand(player, command) {
    const jobRunId = typeof command?.miningJobRunId === 'string' ? command.miningJobRunId.trim() : '';
    const targetRef = typeof command?.miningTargetRef === 'string' ? command.miningTargetRef.trim() : '';
    const job = player?.miningJob;
    return Boolean(jobRunId)
        && job?.jobRunId === jobRunId
        && targetRef === resolveMiningJobTargetRef(job);
}

function syncPlayerMovementStateToInstance(instance, playerId, player) {
    instance.setPlayerMoveSpeed(playerId, player.attrs.numericStats.moveSpeed);
    instance.setPlayerMovementCapabilities?.(playerId, player.movementCapabilities);
}

/** world-runtime movement orchestration：承接实例侧移动/传送执行编排。 */
@Injectable()
export class WorldRuntimeMovementService {
    /** 只保存仍有导航、移动队列或实例侧命令的玩家，禁止 100ms 扫全服。 */
    private readonly activePlayerIds = new Set<string>();
    private nextMovementDueAtMs: number | null = null;
    private scheduleChangedListener: (() => void) | null = null;

    setScheduleChangedListener(listener: (() => void) | null): void {
        this.scheduleChangedListener = typeof listener === 'function' ? listener : null;
    }

    reset(): void {
        this.activePlayerIds.clear();
        this.nextMovementDueAtMs = null;
    }

    activatePlayer(playerId: string, nowMs = performance.now()): void {
        const normalizedPlayerId = typeof playerId === 'string' ? playerId.trim() : '';
        if (!normalizedPlayerId) {
            return;
        }
        const wasInactive = this.activePlayerIds.size === 0;
        this.activePlayerIds.add(normalizedPlayerId);
        if (wasInactive || this.nextMovementDueAtMs === null || nowMs < this.nextMovementDueAtMs) {
            this.nextMovementDueAtMs = nowMs;
            this.scheduleChangedListener?.();
        }
    }

    resolveNextMovementDelayMs(nowMs: number): number | null {
        if (this.activePlayerIds.size === 0 || this.nextMovementDueAtMs === null) {
            return null;
        }
        return Math.max(0, this.nextMovementDueAtMs - nowMs);
    }

    getPlayerMovementMetadata(playerId: string, deps) {
        const location = deps.getPlayerLocation?.(playerId);
        const instance = location ? deps.getInstanceRuntime?.(location.instanceId) : null;
        return instance?.getPlayerMovementMetadata?.(playerId) ?? null;
    }

    /**
     * 在 WorldTickService 的单一 writer 内推进活动移动。
     * 异步寻路和队列派发会完整 await，之后才写实例位置与世界锚点。
     */
    async advanceMovementFrame(nowMs: number, deps): Promise<Set<string>> {
        const affectedPlayerIds = new Set<string>();
        if (this.activePlayerIds.size === 0) {
            this.nextMovementDueAtMs = null;
            return affectedPlayerIds;
        }
        if (this.nextMovementDueAtMs !== null && nowMs + 0.5 < this.nextMovementDueAtMs) {
            return affectedPlayerIds;
        }

        const candidates = Array.from(this.activePlayerIds);
        const runnablePlayerIds: string[] = [];
        const movementOriginByPlayerId = new Map<string, { instance: any; x: number; y: number }>();
        for (const playerId of candidates) {
            const player = deps.playerRuntimeService?.getPlayer?.(playerId);
            const location = deps.getPlayerLocation?.(playerId);
            const instance = location ? deps.getInstanceRuntime?.(location.instanceId) : null;
            if (!player || player.hp <= 0 || !instance) {
                instance?.cancelPendingCommand?.(playerId);
                deps.worldRuntimeNavigationService?.clearNavigationIntent?.(playerId);
                this.activePlayerIds.delete(playerId);
                continue;
            }
            if (typeof deps.isInstanceLeaseWritable === 'function' && !deps.isInstanceLeaseWritable(instance)) {
                deps.fenceInstanceRuntime?.(instance.meta?.instanceId, 'movement_frame_lease_check_failed');
                this.activePlayerIds.delete(playerId);
                continue;
            }
            const remainsActive = deps.worldRuntimeNavigationService?.hasNavigationIntent?.(playerId) === true
                || deps.worldRuntimePendingCommandService?.hasPendingMovementCommand?.(playerId) === true
                || instance.hasPendingCommand?.(playerId) === true;
            if (!remainsActive) {
                this.activePlayerIds.delete(playerId);
                continue;
            }
            if (instance.paused === true || Number(instance.tickSpeed) <= 0) {
                instance.suspendPlayerMovement?.(playerId, nowMs);
                continue;
            }
            const position = instance?.getPlayerPosition?.(playerId);
            if (!position) {
                continue;
            }
            movementOriginByPlayerId.set(playerId, { instance, x: position.x, y: position.y });
            runnablePlayerIds.push(playerId);
        }

        if (runnablePlayerIds.length > 0) {
            await deps.worldRuntimeNavigationService?.materializeNavigationCommandsForPlayerIds?.(runnablePlayerIds, deps);
            await deps.worldRuntimePendingCommandService?.dispatchPendingMovementCommands?.(deps, runnablePlayerIds);
        }

        let hasRunnableMovement = false;
        for (const playerId of runnablePlayerIds) {
            const player = deps.playerRuntimeService?.getPlayer?.(playerId);
            const location = deps.getPlayerLocation?.(playerId);
            const instance = location ? deps.getInstanceRuntime?.(location.instanceId) : null;
            if (!player || player.hp <= 0 || !instance) {
                instance?.cancelPendingCommand?.(playerId);
                deps.worldRuntimeNavigationService?.clearNavigationIntent?.(playerId);
                this.activePlayerIds.delete(playerId);
                continue;
            }
            if (typeof deps.isInstanceLeaseWritable === 'function' && !deps.isInstanceLeaseWritable(instance)) {
                deps.fenceInstanceRuntime?.(instance.meta?.instanceId, 'movement_frame_lease_check_failed');
                this.activePlayerIds.delete(playerId);
                continue;
            }
            const canAdvanceInstance = instance.paused !== true && Number(instance.tickSpeed) > 0;

            const result = canAdvanceInstance
                ? (instance.advancePlayerMovement?.(playerId, nowMs, instance.tickSpeed) ?? null)
                : null;
            for (const affectedPlayerId of result?.affectedPlayerIds ?? []) {
                affectedPlayerIds.add(affectedPlayerId);
            }
            if (result?.moved === true) {
                const position = instance.getPlayerPosition?.(playerId);
                if (position) {
                    deps.playerRuntimeService?.syncWorldAnchorFromInstanceTick?.(playerId, {
                        instanceId: instance.meta?.instanceId,
                        templateId: instance.meta?.templateId,
                        x: position.x,
                        y: position.y,
                        facing: result.facing,
                    });
                }
            }
            if (result?.transfer) {
                deps.applyTransfer(result.transfer);
            }

            const currentLocation = deps.getPlayerLocation?.(playerId);
            const currentInstance = currentLocation ? deps.getInstanceRuntime?.(currentLocation.instanceId) : null;
            const currentPosition = currentInstance?.getPlayerPosition?.(playerId);
            const origin = movementOriginByPlayerId.get(playerId);
            const transferred = Boolean(origin && currentInstance && currentPosition && (
                origin.instance !== currentInstance
                || origin.x !== currentPosition.x
                || origin.y !== currentPosition.y
            ));
            if (transferred && origin) {
                for (const observerId of origin.instance.collectMovementObserverPlayerIds?.(
                    origin.x,
                    origin.y,
                    origin.x,
                    origin.y,
                ) ?? []) {
                    affectedPlayerIds.add(observerId);
                }
            }
            if (transferred && currentPosition) {
                for (const observerId of currentInstance.collectMovementObserverPlayerIds?.(
                    currentPosition.x,
                    currentPosition.y,
                    currentPosition.x,
                    currentPosition.y,
                ) ?? []) {
                    affectedPlayerIds.add(observerId);
                }
            }
            if (transferred) {
                affectedPlayerIds.add(playerId);
            }

            const remainsActive = deps.worldRuntimeNavigationService?.hasNavigationIntent?.(playerId) === true
                || deps.worldRuntimePendingCommandService?.hasPendingMovementCommand?.(playerId) === true
                || currentInstance?.hasPendingCommand?.(playerId) === true;
            if (!remainsActive) {
                this.activePlayerIds.delete(playerId);
                continue;
            }
            if (currentInstance?.paused !== true && Number(currentInstance?.tickSpeed) > 0) {
                hasRunnableMovement = true;
            }
        }

        this.nextMovementDueAtMs = this.activePlayerIds.size > 0
            ? nowMs + (hasRunnableMovement ? MOVEMENT_FRAME_INTERVAL_MS : PAUSED_MOVEMENT_RECHECK_INTERVAL_MS)
            : null;
        return affectedPlayerIds;
    }

/**
 * dispatchInstanceCommand：判断InstanceCommand是否满足条件。
 * @param playerId 玩家 ID。
 * @param command 输入指令。
 * @param deps 运行时依赖。
 * @returns 无返回值，直接更新InstanceCommand相关状态。
 */

    dispatchInstanceCommand(playerId, command, deps) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

        const location = deps.getPlayerLocation(playerId);
        if (!location) {
            return;
        }
        const player = deps.playerRuntimeService.getPlayer(playerId);
        if (!player || player.hp <= 0) {
            return;
        }
        const instance = deps.getInstanceRuntime(location.instanceId);
        if (!instance) {
            return;
        }
        if (command.kind === 'move') {
            this.dispatchMoveCommand(playerId, command, player, instance, deps);
            return;
        }
        this.dispatchPortalCommand(playerId, player, instance, deps);
    }
    /**
 * dispatchMoveCommand：判断MoveCommand是否满足条件。
 * @param playerId 玩家 ID。
 * @param command 输入指令。
 * @param player 玩家对象。
 * @param instance 地图实例。
 * @param deps 运行时依赖。
 * @returns 无返回值，直接更新MoveCommand相关状态。
 */

    dispatchMoveCommand(playerId, command, player, instance, deps) {
        if (hasMiningJobCommandMarker(command) && !isMatchingMiningJobCommand(player, command)) {
            return;
        }
        syncPlayerMovementStateToInstance(instance, playerId, player);
        deps.worldRuntimePlayerSkillDispatchService?.interruptPendingPlayerSkillCast?.(playerId, '你移動了身形。', deps);
        deps.playerRuntimeService.recordActivity(playerId, deps.resolveCurrentTickForPlayerId(playerId), {
            interruptCultivation: true,
            reason: 'move',
        });
        if (!isMatchingMiningJobCommand(player, command)) {
            deps.worldRuntimeCraftInterruptService.interruptCraftForReason(playerId, player, 'move', deps);
        }
        const enqueued = instance.enqueueMove({
            playerId,
            direction: command.direction,
            continuous: command.continuous === true,
            maxSteps: command.maxSteps,
            path: Array.isArray(command.path)
                ? command.path.map((entry) => ({ x: entry.x, y: entry.y }))
                : undefined,
            resetBudget: command.resetBudget === true,
        });
        if (enqueued) {
            this.activatePlayer(playerId);
        }
    }
    /**
 * dispatchPortalCommand：判断传送门Command是否满足条件。
 * @param playerId 玩家 ID。
 * @param player 玩家对象。
 * @param instance 地图实例。
 * @param deps 运行时依赖。
 * @returns 无返回值，直接更新PortalCommand相关状态。
 */

    dispatchPortalCommand(playerId, player, instance, deps) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

        deps.playerRuntimeService.recordActivity(playerId, deps.resolveCurrentTickForPlayerId(playerId), {
            interruptCultivation: true,
            reason: 'move',
        });
        deps.worldRuntimePlayerSkillDispatchService?.interruptPendingPlayerSkillCast?.(playerId, '你移動了身形。', deps);
        deps.worldRuntimeCraftInterruptService.interruptCraftForReason(playerId, player, 'move', deps);
        const manualTransfer = instance.tryPortalTransfer(playerId, 'manual_portal');
        if (manualTransfer) {
            deps.applyTransfer(manualTransfer);
            return;
        }
        if (instance.enqueuePortalUse({ playerId })) {
            this.activatePlayer(playerId);
        }
    }
};
