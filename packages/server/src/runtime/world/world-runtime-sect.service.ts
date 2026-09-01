/**
 * 本文件属于服务端权威运行时，负责地图、玩家、世界、市场、邮件或后台运行态逻辑。
 *
 * 维护时要保持状态变更受控，所有影响资产或位置的结果都应能被持久化与恢复链覆盖。
 */
import { BadRequestException, ForbiddenException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
    FORMATION_AURA_PER_SPIRIT_STONE,
    SECT_APPLICATION_PAGE_DEFAULT_LIMIT,
    SECT_APPLICATION_PAGE_MAX_LIMIT,
    SECT_APPLICATION_SEARCH_MAX_LENGTH,
    SECT_DIRECTORY_PAGE_DEFAULT_LIMIT,
    SECT_DIRECTORY_PAGE_MAX_LIMIT,
    SECT_DIRECTORY_SEARCH_MAX_LENGTH,
    SECT_ENTRANCE_RELOCATION_COOLDOWN_MS,
    TileType,
    isSectMemberRoleLowerThan,
    resolvePlayerFacingContentName,
} from '@mud/shared';
import { resolveServerDatabaseUrl } from '../../config/env-alias';
import {
    SECT_BASE_CLEAR_RADIUS,
    SECT_CORE_CHAR,
    SECT_CORE_X,
    SECT_CORE_Y,
    SECT_ENTRANCE_CHAR,
    SECT_ENTRANCE_INTERACTION_RADIUS,
    SECT_EXPAND_CHUNK,
    SECT_FOUNDING_CLEAR_RADIUS,
    SECT_GUARDIAN_INITIAL_AURA,
    SECT_INITIAL_STONE_MARGIN,
    SECT_INNATE_STABILIZER_RADIUS,
    SECT_TEMPLATE_PREFIX,
} from '../../constants/gameplay/sect';
import {
    ensureSectTable,
    persistDurableSectMutationUntilSettled,
    persistSectSnapshotsWithClient,
    repairPersistedSectCoreState,
    repairPersistedSectCoreStateWithClient,
    SECT_TABLE,
    SectDurableCommitOutcomeUnknownError,
} from '../../persistence/sect-durable-persistence';
import { loadSectMemberProfiles } from '../../persistence/sect-member-profile-read-model';
import { buildStructuredNotice } from './structured-notice.helpers';
import { destroyManagedInstance } from './world-runtime-instance-lease.helpers';
import * as world_runtime_normalization_helpers_1 from './world-runtime.normalization.helpers';
import { findProtectedPlacementConflict, formatProtectedPlacementConflictReason, iterateSquareProtectedPlacementPoints } from './protected-placement.helpers';
import {
    SECT_PERMISSIONS,
    SECT_ROLES,
    assertSectLeader,
    assertSectLeaderOrDeputy,
    assertSectMarkAvailable,
    assertSectMemberRoleChange,
    assertSectPermission,
    buildDefaultSectRolePermissions,
    buildSectGuardianManagementData,
    buildSectId,
    buildSectInstanceId,
    buildSectMemberEntry,
    buildSectTemplateId,
    canChangeSectMemberRole,
    dispatchSectGuardianTechniqueActivity,
    ensureSectState,
    findPendingSectApplication,
    formatInteger,
    formatSectGuardianAuraLabel,
    formatSectGuardianStatusLabel,
    getSectRoleLabel,
    hasSectPermission,
    isSectMember,
    normalizeIntegerWithDefault,
    normalizeNonNegativeInteger,
    normalizePositiveInteger,
    normalizeSectApplications,
    normalizeSectMark,
    normalizeSectMembers,
    normalizeSectName,
    normalizeSectPermissionId,
    normalizeSectRoleId,
    normalizeSectRolePermissions,
    resolveFormationQiBudget,
    resolvePlayerDisplayName,
    resolveSectGuardianFormation,
    resolveSectMemberPresenceLabel,
    resolveSectMemberRealmLv,
    resolveSectTemplateIdForBounds,
    upsertSectApplication,
} from './world-runtime-sect-domain.helpers';

const SECT_MANAGEMENT_DATA_MARKER = '@@sect:';
const SECT_MANAGEMENT_DATA_MARKER_END = '@@';

/** 遠端遞帖防灌水：跨宗同時 pending 申請上限。 */
const SECT_REMOTE_APPLICATION_MAX_PENDING = 3;
/** 遠端遞帖防灌水：成功遞帖後的下次可再遠端遞帖冷卻（毫秒）。 */
const SECT_REMOTE_APPLICATION_COOLDOWN_MS = 30_000;

const { buildPublicInstanceId, parseRuntimeInstanceDescriptor } = world_runtime_normalization_helpers_1;

/** world-runtime sect：宗门地图、入口、核心与护宗大阵运行时编排。 */
class WorldRuntimeSectService {
    logger = new Logger(WorldRuntimeSectService.name);
    contentTemplateRepository;
    templateRepository;
    playerRuntimeService;
    _mailRuntimeService;
    sectsById = new Map();
    playerSectId = new Map();
    deletedSectSnapshotsById = new Map();
    restored = false;
    persistencePool = null;
    persistenceReady = false;
    persistenceInitPromise = null;
    databasePoolProvider = null;
    durableOperationService = null;
    worldRuntimeFormationService = null;
    sectMemberProfilesByPlayerId = new Map<string, { name: string | null; realmLv: number | null }>();
    sectMutationQueueBySectId = new Map<string, Promise<void>>();
    directoryRequestAtByPlayerId = new Map();
    /** 远端遞帖冷卻：玩家下次可再遠端遞交拜帖的時刻（in-memory，重啟即重置）。 */
    nextRemoteApplyAllowedAtByPlayerId = new Map();
    sectDurableCommitQueue = Promise.resolve();
    persistenceClosing = false;
    sectShutdownSignal = createSectShutdownSignal();
    unresolvedDurableCommitOutcome = false;

    constructor(contentTemplateRepository, templateRepository, playerRuntimeService, mailRuntimeService = null, databasePoolProvider = null, durableOperationService = null, worldRuntimeFormationService = null) {
        this.contentTemplateRepository = contentTemplateRepository;
        this.templateRepository = templateRepository;
        this.playerRuntimeService = playerRuntimeService;
        this._mailRuntimeService = mailRuntimeService;
        this.databasePoolProvider = databasePoolProvider;
        this.durableOperationService = durableOperationService;
        this.worldRuntimeFormationService = worldRuntimeFormationService;
    }

    async runExclusiveSectPlayerMutation(sectIds, playerIds, action) {
        const normalizedSectIds = Array.from(new Set((Array.isArray(sectIds) ? sectIds : [])
            .map((sectId) => normalizeOptionalString(sectId))
            .filter(Boolean))).sort();
        const tickets = normalizedSectIds.map((sectId) => {
            const previous = this.sectMutationQueueBySectId.get(sectId) ?? Promise.resolve();
            let release;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const tail = previous.catch(() => undefined).then(() => gate);
            this.sectMutationQueueBySectId.set(sectId, tail);
            return { sectId, previous, release, tail };
        });
        await Promise.all(tickets.map((ticket) => ticket.previous.catch(() => undefined)));
        try {
            const coordinator = this.playerRuntimeService?.runExclusiveAssetMutation;
            if (typeof coordinator === 'function') {
                return await coordinator.call(this.playerRuntimeService, playerIds, action);
            }
            return await action();
        } finally {
            for (const ticket of tickets) {
                ticket.release?.();
            }
            for (const ticket of tickets) {
                void ticket.tail.finally(() => {
                    if (this.sectMutationQueueBySectId.get(ticket.sectId) === ticket.tail) {
                        this.sectMutationQueueBySectId.delete(ticket.sectId);
                    }
                });
            }
        }
    }

    async runExclusiveStableSectMembershipMutation(sectIds, playerIds, membershipPlayerId, action) {
        const normalizedMembershipPlayerId = normalizeOptionalString(membershipPlayerId);
        let hintedMembershipSectId = normalizedMembershipPlayerId
            ? this.resolvePlayerSectId(normalizedMembershipPlayerId)
            : null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const lockedSectIds = Array.from(new Set([
                ...(Array.isArray(sectIds) ? sectIds : []),
                hintedMembershipSectId,
            ].map((entry) => normalizeOptionalString(entry)).filter(Boolean)));
            const result = await this.runExclusiveSectPlayerMutation(lockedSectIds, playerIds, async () => {
                const currentMembershipSectId = normalizedMembershipPlayerId
                    ? this.resolvePlayerSectId(normalizedMembershipPlayerId)
                    : null;
                if (currentMembershipSectId && !lockedSectIds.includes(currentMembershipSectId)) {
                    return { retryMembershipSectId: currentMembershipSectId };
                }
                return { value: await action() };
            });
            if (!result?.retryMembershipSectId) {
                return result?.value;
            }
            hintedMembershipSectId = result.retryMembershipSectId;
        }
        throw new BadRequestException('成員宗門歸屬正在變化，請稍後重試');
    }

    /** 先锁定宗门再读取当前成员集合，随后一次性持有所有成员资产锁。 */
    async runExclusiveSectCurrentMembersMutation(sectId, playerIds, action) {
        return this.runExclusiveSectPlayerMutation([sectId], [], async () => {
            const currentSect = this.findSectById(sectId);
            const currentMemberIds = Array.isArray(currentSect?.members)
                ? currentSect.members.map((entry) => normalizeOptionalString(entry?.playerId)).filter(Boolean)
                : [];
            const lockedPlayerIds = Array.from(new Set([
                ...(Array.isArray(playerIds) ? playerIds : []),
                ...currentMemberIds,
            ].map((entry) => normalizeOptionalString(entry)).filter(Boolean)));
            const coordinator = this.playerRuntimeService?.runExclusiveAssetMutation;
            if (typeof coordinator === 'function') {
                return coordinator.call(this.playerRuntimeService, lockedPlayerIds, () => action(currentSect, currentMemberIds));
            }
            return action(currentSect, currentMemberIds);
        });
    }

    buildDurablePlayerProjectionWrite(playerId, domains) {
        const normalizedPlayerId = normalizeOptionalString(playerId);
        if (!normalizedPlayerId) {
            return null;
        }
        const normalizedDomains = Array.from(new Set((Array.isArray(domains) ? domains : [])
            .map((domain) => normalizeOptionalString(domain))
            .filter(Boolean))).sort();
        const snapshot = this.playerRuntimeService.buildPersistenceSnapshot?.(
            normalizedPlayerId,
            new Set(normalizedDomains),
        );
        if (!snapshot) {
            return null;
        }
        const player = this.playerRuntimeService.getPlayer?.(normalizedPlayerId) ?? null;
        return {
            playerId: normalizedPlayerId,
            snapshot,
            domains: normalizedDomains,
            options: {
                allowInventoryEmptyOverwrite: normalizedDomains.includes('inventory'),
            },
            expectedRuntimeOwnerId: normalizeOptionalString(player?.runtimeOwnerId),
            expectedSessionEpoch: normalizeIntegerWithDefault(player?.sessionEpoch, 0),
            persistentRevision: this.playerRuntimeService.getPersistenceRevision?.(normalizedPlayerId) ?? null,
        };
    }

    commitDurableSectMutation(input) {
        const formationIds = (input?.formationWrites ?? [])
            .map((write) => normalizeOptionalString(write?.formationInstanceId))
            .filter(Boolean);
        const commit = () => this.runExclusiveDurableSectCommit(() => this.commitDurableSectMutationLocked(input));
        if (formationIds.length > 0 && typeof this.worldRuntimeFormationService?.runExclusiveFormationPersistence === 'function') {
            // runExclusiveFormationPersistence 在首次 await 前同步安装 ticket，禁止普通阵法 writer 抢到宗门后态前面。
            return this.worldRuntimeFormationService.runExclusiveFormationPersistence(formationIds, commit);
        }
        return commit();
    }

    async commitDurableSectMutationLocked(input) {
        const pool = await this.ensurePersistencePool();
        if (!pool) {
            if (resolveServerDatabaseUrl().trim()) {
                throw new ServiceUnavailableException('宗門持久化暫不可用');
            }
            return false;
        }
        const playerProjectionWrites = (Array.isArray(input?.playerProjectionWrites)
            ? input.playerProjectionWrites
            : []).filter(Boolean);
        const projectionPlayerIds = new Set(playerProjectionWrites.map((write) => write.playerId));
        for (const requiredPlayerId of input?.requirePlayerProjectionIds ?? []) {
            if (!projectionPlayerIds.has(requiredPlayerId)) {
                throw new Error(`sect_mutation_player_snapshot_missing:${requiredPlayerId}`);
            }
        }
        const durableInput = {
            sectWrites: input?.sectWrites ?? [],
            playerProjectionWrites,
            membershipWrites: input?.membershipWrites ?? [],
            formationWrites: input?.formationWrites ?? [],
        };
        const affectedPlayerIds = Array.from(new Set([
            ...playerProjectionWrites.map((write) => normalizeOptionalString(write?.playerId)),
            ...durableInput.membershipWrites.map((write) => normalizeOptionalString(write?.playerId)),
        ].filter(Boolean))).sort();
        const affectedInstanceIds = collectDurableSectAffectedInstanceIds(durableInput, input?.affectedInstanceIds);
        const persist = async () => {
            try {
                await persistDurableSectMutationUntilSettled(pool, durableInput, {
                shouldContinue: () => !this.persistenceClosing,
                stopSignal: this.sectShutdownSignal.promise,
                onReadbackError: (error, attempt) => {
                    if (attempt === 1 || attempt % 20 === 0) {
                        this.logger.error(
                            `宗門事務 COMMIT 結果回讀失敗，繼續持鎖重試 attempt=${attempt}：${error instanceof Error ? error.stack : String(error)}`,
                        );
                    }
                },
                });
            } catch (error) {
                if (error instanceof SectDurableCommitOutcomeUnknownError) {
                    this.unresolvedDurableCommitOutcome = true;
                    this.durableOperationService?.registerUnresolvedCommitOutcome?.({
                        affectedPlayerIds,
                        affectedInstanceIds,
                    });
                }
                throw error;
            }
        };
        await persist();
        for (const write of playerProjectionWrites) {
            this.playerRuntimeService.markPersisted?.(
                write.playerId,
                new Set(write.domains),
                write.persistentRevision,
            );
        }
        return true;
    }

    runExclusiveDurableSectCommit(action) {
        const run = this.sectDurableCommitQueue.catch(() => undefined).then(action);
        this.sectDurableCommitQueue = run.then(() => undefined, () => undefined);
        return run;
    }

    async commitDurableSectMembershipMutation(beforeSectSnapshots, membershipByPlayerId, formationWrites = []) {
        const sectWrites = [];
        for (const before of beforeSectSnapshots ?? []) {
            const sectId = normalizeOptionalString(before?.sectId);
            if (!sectId) {
                continue;
            }
            const current = this.sectsById.get(sectId) ?? null;
            sectWrites.push({
                sectId,
                expectedUpdatedAtMs: normalizeIntegerWithDefault(before.updatedAt, 0),
                snapshot: current ? normalizeSectEntry(current) : null,
            });
        }
        const playerProjectionWrites = [];
        const membershipWrites = [];
        for (const [playerId, sectId] of membershipByPlayerId ?? []) {
            const playerWrite = this.buildDurablePlayerProjectionWrite(playerId, ['sect_membership']);
            if (playerWrite) {
                playerProjectionWrites.push(playerWrite);
            }
            membershipWrites.push({
                playerId,
                sectId: normalizeOptionalString(sectId),
                updatedAtMs: Date.now(),
            });
        }
        const committed = await this.commitDurableSectMutation({
            sectWrites,
            playerProjectionWrites,
            membershipWrites,
            formationWrites,
            affectedInstanceIds: (beforeSectSnapshots ?? []).flatMap((sect) => [
                sect?.entranceInstanceId,
                sect?.sectInstanceId,
            ]),
        });
        if (!committed) {
            this.persistSectsSoon();
        }
        return committed;
    }

    dispatchCreateSect(playerId, itemInstanceId, item, deps, payload = null) {
        const sectId = buildSectId(playerId);
        return this.runExclusiveSectPlayerMutation([sectId], [playerId], async () => {
            const player = this.playerRuntimeService.getPlayerOrThrow(playerId);
            if (normalizeOptionalString(player.sectId)) {
                throw new BadRequestException('你已經有所屬宗門');
            }
            const sectName = normalizeSectName(payload?.sectName, player);
            const sectMark = normalizeSectMark(payload?.sectMark, sectName);
            assertSectMarkAvailable(this.sectsById.values(), sectMark);
            const location = deps.getPlayerLocationOrThrow(playerId);
            const entranceInstance = deps.getInstanceRuntimeOrThrow(location.instanceId);
            const descriptor = parseRuntimeInstanceDescriptor(location.instanceId);
            assertCanCreateSectAtInstance(entranceInstance, descriptor);
            if (entranceInstance.meta.kind !== 'public' && descriptor?.instanceOrigin !== 'public') {
                throw new BadRequestException('當前地點無法開闢宗門入口');
            }
            assertSectFoundingAreaClear(Array.from(this.sectsById.values()), entranceInstance, location.instanceId, player.x, player.y);
            const bounds = buildInitialSectBounds();
            const templateId = buildSectTemplateId(sectId);
            const instanceId = buildSectInstanceId(sectId);
            const coreX = SECT_CORE_X;
            const coreY = SECT_CORE_Y;
            const now = Date.now();
            const sect = {
                sectId,
                name: sectName,
                mark: sectMark,
                founderPlayerId: playerId,
                leaderPlayerId: playerId,
                status: 'active',
                entranceInstanceId: location.instanceId,
                entranceTemplateId: entranceInstance.template.id,
                entranceX: player.x,
                entranceY: player.y,
                sectInstanceId: instanceId,
                sectTemplateId: templateId,
                coreX,
                coreY,
                expansionRadius: Math.max(
                    Math.abs(bounds.minX),
                    Math.abs(bounds.maxX),
                    Math.abs(bounds.minY),
                    Math.abs(bounds.maxY),
                ),
                mapMinX: bounds.minX,
                mapMaxX: bounds.maxX,
                mapMinY: bounds.minY,
                mapMaxY: bounds.maxY,
                members: [buildSectMemberEntry(player, 'leader', now)],
                rolePermissions: buildDefaultSectRolePermissions(),
                createdAt: now,
                updatedAt: now,
            };
            const rollback = captureSectCreationRollback(this, playerId, player, entranceInstance, instanceId, deps);
            try {
                this.registerSectTemplate(sect);
                const sectInstance = this.ensureSectRuntimeInstance(sect, deps);
                await waitForSectInstancesLeaseReady([entranceInstance, sectInstance], deps);
                this.ensureSectPortalsAttached(sect, entranceInstance, sectInstance);
                this.sectsById.set(sectId, sect);
                this.playerSectId.set(playerId, sectId);
                this.playerRuntimeService.consumeInventoryItemByInstanceId(playerId, itemInstanceId, 1);
                if (typeof this.playerRuntimeService.setPlayerSectId === 'function') {
                    this.playerRuntimeService.setPlayerSectId(playerId, sectId);
                } else {
                    player.sectId = sectId;
                }
                const guardian = this.ensureGuardianFormation(sect, deps, null, { deferPersistence: true });
                touchRuntimeInstanceRevision(deps, entranceInstance.meta.instanceId);
                touchRuntimeInstanceRevision(deps, sectInstance.meta.instanceId);
                const normalizedSect = normalizeSectEntry(sect);
                const playerWrite = this.buildDurablePlayerProjectionWrite(playerId, ['inventory', 'sect_membership']);
                const committed = await this.commitDurableSectMutation({
                    sectWrites: [{ sectId, expectedUpdatedAtMs: null, snapshot: normalizedSect }],
                    playerProjectionWrites: [playerWrite],
                    formationWrites: [this.buildDurableGuardianFormationWrite(guardian, deps)].filter(Boolean),
                    requirePlayerProjectionIds: [playerId],
                });
                if (!committed) {
                    this.persistSectsSoon();
                    deps.worldRuntimeFormationService?.persistFormationSnapshotSoon?.(guardian);
                }
                const nFounded = buildStructuredNotice('success', 'notice.sect.founded', `建宗令化作山門，你開闢了${sect.name}。`, {
                    vars: { sectName: sect.name },
                    pills: [{ key: 'sectName', style: 'target' }],
                });
                deps.queuePlayerNotice(playerId, nFounded.text, nFounded.kind, undefined, undefined, nFounded.structured);
                deps.refreshQuestStates?.(playerId);
                return sect;
            } catch (error) {
                await restoreSectCreationRollback({
                    service: this,
                    playerId,
                    player,
                    sectId,
                    instanceId,
                    entranceInstance,
                    rollback,
                    deps,
                });
                throw error;
            }
        });
    }

    dispatchRelocateSectEntrance(playerId, itemInstanceId, item, deps) {
        const initialPlayer = this.playerRuntimeService.getPlayerOrThrow(playerId);
        const initialSectId = this.reconcilePlayerSectId(playerId) || normalizeOptionalString(initialPlayer.sectId);
        if (!initialSectId) {
            throw new BadRequestException('你當前沒有宗門');
        }
        return this.runExclusiveSectPlayerMutation([initialSectId], [playerId], async () => {
        const player = this.playerRuntimeService.getPlayerOrThrow(playerId);
        const sectId = this.reconcilePlayerSectId(playerId) || normalizeOptionalString(player.sectId);
        if (!sectId || sectId !== initialSectId) {
            throw new BadRequestException('你當前沒有有效宗門');
        }
        const sect = this.findSectById(sectId);
        if (!sect || sect.status === 'dissolved') {
            throw new BadRequestException('你當前沒有有效宗門');
        }
        ensureSectState(sect, this.playerRuntimeService);
        assertSectLeaderOrDeputy(sect, playerId);
        const now = Date.now();
        const cooldownUntil = normalizeIntegerWithDefault(sect.entranceRelocationCooldownUntil, 0);
        if (cooldownUntil > now) {
            throw new BadRequestException(`宗門遷移冷卻尚未結束，剩餘 ${formatDurationMs(cooldownUntil - now)}`);
        }
        const location = deps.getPlayerLocationOrThrow(playerId);
        const entranceInstance = deps.getInstanceRuntimeOrThrow(location.instanceId);
        const descriptor = parseRuntimeInstanceDescriptor(location.instanceId);
        assertCanCreateSectAtInstance(entranceInstance, descriptor);
        const targetX = Math.trunc(Number(player.x));
        const targetY = Math.trunc(Number(player.y));
        if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
            throw new BadRequestException('當前位置無法遷移宗門山門');
        }
        if (sect.entranceInstanceId === location.instanceId && sect.entranceX === targetX && sect.entranceY === targetY) {
            throw new BadRequestException('宗門山門已經位於當前位置');
        }
        assertSectFoundingAreaClear(
            Array.from(this.sectsById.values()),
            entranceInstance,
            location.instanceId,
            targetX,
            targetY,
            sect.sectId,
        );
        const previousEntranceInstanceId = sect.entranceInstanceId;
        const previousEntranceInstance = deps.getInstanceRuntime?.(previousEntranceInstanceId);
        if (!previousEntranceInstance) {
            throw new ServiceUnavailableException('原宗門山門實例尚未就緒');
        }
        const sectInstance = this.ensureSectRuntimeInstance(sect, deps);
        await waitForSectInstancesLeaseReady([previousEntranceInstance, entranceInstance, sectInstance], deps);
        const guardianId = `formation:sect_guardian:${sect.sectId}`;
        const previousGuardian = deps.worldRuntimeFormationService?.findFormationInInstance?.(previousEntranceInstanceId, guardianId) ?? null;
        const expectedUpdatedAtMs = normalizeIntegerWithDefault(sect.updatedAt, 0);
        const rollback = captureSectRelocationRollback({
            player,
            sect,
            previousEntranceInstance,
            entranceInstance,
            sectInstance,
            previousGuardian,
        });
        try {
        if (previousEntranceInstance && previousEntranceInstance !== entranceInstance) {
            removeSectRuntimePortals(previousEntranceInstance, sect.sectId);
            touchRuntimeInstanceRevision(deps, previousEntranceInstanceId);
        }
        if (previousGuardian && previousEntranceInstanceId !== location.instanceId) {
            deps.worldRuntimeFormationService?.removeFormationFromInstance?.(
                previousEntranceInstanceId,
                guardianId,
                deps,
                { deferPersistence: true },
            );
        }
        sect.entranceInstanceId = location.instanceId;
        sect.entranceTemplateId = entranceInstance.template.id;
        sect.entranceX = targetX;
        sect.entranceY = targetY;
        sect.lastEntranceRelocatedAt = now;
        sect.entranceRelocationCooldownUntil = now + SECT_ENTRANCE_RELOCATION_COOLDOWN_MS;
        advanceSectUpdatedAt(sect, now);
        this.ensureSectPortalsAttached(sect, entranceInstance, sectInstance);
        const relocatedGuardian = this.ensureGuardianFormation(
            sect,
            deps,
            previousGuardian,
            { deferPersistence: true },
        );
        this.playerRuntimeService.consumeInventoryItemByInstanceId(playerId, itemInstanceId, 1);
        touchRuntimeInstanceRevision(deps, entranceInstance.meta.instanceId);
        touchRuntimeInstanceRevision(deps, sectInstance.meta.instanceId);
        const normalizedSect = normalizeSectEntry(sect);
        const playerWrite = this.buildDurablePlayerProjectionWrite(playerId, ['inventory']);
        const committed = await this.commitDurableSectMutation({
            sectWrites: [{ sectId, expectedUpdatedAtMs, snapshot: normalizedSect }],
            playerProjectionWrites: [playerWrite],
            formationWrites: [this.buildDurableGuardianFormationWrite(
                relocatedGuardian,
                deps,
                [previousEntranceInstanceId],
            )].filter(Boolean),
            requirePlayerProjectionIds: [playerId],
            affectedInstanceIds: [previousEntranceInstanceId],
        });
        if (!committed) {
            this.persistSectsSoon();
            if (previousGuardian && previousEntranceInstanceId !== location.instanceId) {
                deps.worldRuntimeFormationService?.persistFormationRemovalSoon?.(previousGuardian);
            }
            deps.worldRuntimeFormationService?.persistFormationSnapshotSoon?.(relocatedGuardian);
        }
        deps.refreshQuestStates?.(playerId);
        deps.refreshPlayerContextActions?.(playerId);
        const itemName = normalizeOptionalString(item?.name) || '遷宗令';
        const nRelocated = buildStructuredNotice('success', 'notice.sect.entrance-relocated', `${itemName}化作新山門，${sect.name}入口已遷至當前位置。`, {
            vars: { itemName, sectName: sect.name, cooldownDays: 3 },
            pills: [
                { key: 'itemName', style: 'target' },
                { key: 'sectName', style: 'target' },
            ],
        });
        deps.queuePlayerNotice(playerId, nRelocated.text, nRelocated.kind, undefined, undefined, nRelocated.structured);
        return sect;
        } catch (error) {
            restoreSectRelocationRollback({
                service: this,
                playerId,
                player,
                sect,
                rollback,
                deps,
            });
            throw error;
        }
        });
    }

    ensureSectRuntimeInstanceById(instanceId, deps) {
        const sect = this.findSectByInstanceId(instanceId);
        return sect ? this.ensureSectRuntimeInstance(sect, deps) : null;
    }

    ensureSectRuntimeInstanceByTemplateId(templateId, deps, options: { allowCreate?: boolean } = {}) {
        const normalized = normalizeOptionalString(templateId);
        if (!normalized || !normalized.startsWith(SECT_TEMPLATE_PREFIX)) {
            return null;
        }
        const parsed = parseSectTemplateDescriptor(normalized);
        const sect = this.findSectByTemplateId(normalized) || this.findSectById(parsed?.sectId);
        if (!sect) {
            return null;
        }
        if (options.allowCreate === false) {
            return deps.getInstanceRuntime?.(sect.sectInstanceId) ?? null;
        }
        return this.ensureSectRuntimeInstance(sect, deps);
    }

    ensureSectRuntimeInstance(sect, deps, options: { allowCreate?: boolean } = {}) {
        const existing = deps.getInstanceRuntime(sect.sectInstanceId);
        if (existing) {
            const template = this.registerSectTemplate(sect);
            if (existing.meta?.templateId !== template.id && typeof existing.rebaseSectTemplateToStableCoordinates === 'function') {
                existing.rebaseSectTemplateToStableCoordinates(template);
            }
            syncSectRuntimeDomainTiles(sect, existing);
            this.ensureSectPortalsAttached(sect, deps.getInstanceRuntime?.(sect.entranceInstanceId), existing);
            return existing;
        }
        if (options.allowCreate === false) {
            return null;
        }
        this.registerSectTemplate(sect);
        const instance = deps.createInstance({
            instanceId: sect.sectInstanceId,
            templateId: sect.sectTemplateId,
            kind: 'sect',
            persistent: true,
            linePreset: 'peaceful',
            lineIndex: 1,
            instanceOrigin: 'sect',
            defaultEntry: false,
            supportsPvp: true,
            canDamageTile: true,
            ownerSectId: sect.sectId,
            displayName: sect.name,
            routeDomain: `sect:${sect.sectId}`,
            shardKey: sect.sectInstanceId,
        });
        syncSectRuntimeDomainTiles(sect, instance);
        return instance;
    }

    registerSectTemplate(sect) {
        const stableTemplateId = buildSectTemplateId(sect.sectId);
        if (sect.sectTemplateId !== stableTemplateId) {
            sect.sectTemplateId = stableTemplateId;
        }
        sect.coreX = SECT_CORE_X;
        sect.coreY = SECT_CORE_Y;
        const currentTemplate = this.templateRepository.has(sect.sectTemplateId)
            ? this.templateRepository.getOrThrow(sect.sectTemplateId)
            : null;
        if (currentTemplate && areSectTemplateBoundsEqual(currentTemplate, normalizeSectBounds(sect))) {
            return this.templateRepository.getOrThrow(sect.sectTemplateId);
        }
        return this.templateRepository.registerRuntimeMapTemplate(buildSectMapDocument(sect));
    }

    refreshSectTemplateForBounds(sect, deps) {
        const previousTemplate = this.templateRepository.has(sect.sectTemplateId)
            ? this.templateRepository.getOrThrow(sect.sectTemplateId)
            : null;
        const template = this.registerSectTemplate(sect);
        const sectInstance = deps.getInstanceRuntime?.(sect.sectInstanceId);
        if (sectInstance) {
            const boundsChanged = !areSectTemplateBoundsEqual(previousTemplate, normalizeSectBounds(sect))
                || !areSectTemplateBoundsEqual(sectInstance.template, normalizeSectBounds(sect));
            if (boundsChanged && typeof sectInstance.replaceTemplateForSectExpansion === 'function') {
                sectInstance.replaceTemplateForSectExpansion(template);
            } else if (sectInstance.meta?.templateId !== template.id && typeof sectInstance.rebaseSectTemplateToStableCoordinates === 'function') {
                sectInstance.rebaseSectTemplateToStableCoordinates(template);
            }
            syncSectRuntimeDomainTiles(sect, sectInstance);
        }
        return template;
    }

    attachSectPortals(sect, entranceInstance, sectInstance) {
        removeSectRuntimePortals(entranceInstance, sect.sectId);
        removeSectRuntimePortals(sectInstance, sect.sectId);
        entranceInstance.addRuntimePortal?.({
            x: sect.entranceX,
            y: sect.entranceY,
            kind: 'sect_entrance',
            trigger: 'manual',
            targetMapId: sect.sectTemplateId,
            targetInstanceId: sect.sectInstanceId,
            targetX: sect.coreX,
            targetY: sect.coreY,
            name: `${sect.name}山門`,
            char: normalizeOptionalString(sect.mark) || SECT_ENTRANCE_CHAR,
            color: '#c8a15a',
            sectId: sect.sectId,
        });
        sectInstance.addRuntimePortal?.({
            x: sect.coreX,
            y: sect.coreY,
            kind: 'sect_core',
            trigger: 'manual',
            targetMapId: sect.entranceTemplateId,
            targetInstanceId: sect.entranceInstanceId,
            targetX: sect.entranceX,
            targetY: sect.entranceY,
            name: `${sect.name}宗門核心`,
            char: SECT_CORE_CHAR,
            color: '#d8c37a',
            sectId: sect.sectId,
        });
    }

    ensureSectPortalsAttached(sect, entranceInstance, sectInstance) {
        if (!entranceInstance || !sectInstance) {
            return false;
        }
        const entranceReady = hasExpectedSectRuntimePortal(entranceInstance, {
            sectId: sect.sectId,
            kind: 'sect_entrance',
            x: sect.entranceX,
            y: sect.entranceY,
            targetMapId: sect.sectTemplateId,
            targetInstanceId: sect.sectInstanceId,
            targetX: sect.coreX,
            targetY: sect.coreY,
        });
        const coreReady = hasExpectedSectRuntimePortal(sectInstance, {
            sectId: sect.sectId,
            kind: 'sect_core',
            x: sect.coreX,
            y: sect.coreY,
            targetMapId: sect.entranceTemplateId,
            targetInstanceId: sect.entranceInstanceId,
            targetX: sect.entranceX,
            targetY: sect.entranceY,
        });
        if (entranceReady && coreReady) {
            return false;
        }
        this.attachSectPortals(sect, entranceInstance, sectInstance);
        return true;
    }

    ensureGuardianFormation(sect, deps, previousGuardian = null, options = {}) {
        if (typeof deps.worldRuntimeFormationService?.upsertSectGuardianFormation !== 'function') {
            return null;
        }
        ensureSectState(sect, this.playerRuntimeService);
        const guardianId = `formation:sect_guardian:${sect.sectId}`;
        const existingGuardian = previousGuardian
            ?? deps.worldRuntimeFormationService?.findFormationInInstance?.(sect.entranceInstanceId, guardianId)
            ?? null;
        const fallbackSpiritStoneCount = Math.ceil(SECT_GUARDIAN_INITIAL_AURA / FORMATION_AURA_PER_SPIRIT_STONE);
        return deps.worldRuntimeFormationService.upsertSectGuardianFormation({
            formationId: 'sect_guardian_barrier',
            id: guardianId,
            ownerSectId: sect.sectId,
            ownerPlayerId: sect.leaderPlayerId,
            instanceId: sect.entranceInstanceId,
            x: sect.entranceX,
            y: sect.entranceY,
            eyeInstanceId: sect.sectInstanceId,
            eyeX: sect.coreX,
            eyeY: sect.coreY,
            radius: Math.max(1, Math.trunc(Number(existingGuardian?.stats?.radius ?? existingGuardian?.radius ?? 1) || 1)),
            allocation: existingGuardian?.allocation,
            spiritStoneCount: Math.max(1, Math.trunc(Number(existingGuardian?.spiritStoneCount ?? fallbackSpiritStoneCount) || fallbackSpiritStoneCount)),
            remainingQiBudget: Number.isFinite(Number(existingGuardian?.remainingQiBudget ?? existingGuardian?.remainingAuraBudget))
                ? Math.max(0, Number(existingGuardian.remainingQiBudget ?? existingGuardian.remainingAuraBudget))
                : SECT_GUARDIAN_INITIAL_AURA,
            remainingSpiritStoneBudget: Number.isFinite(Number(existingGuardian?.remainingSpiritStoneBudget))
                ? Math.max(0, Number(existingGuardian.remainingSpiritStoneBudget))
                : fallbackSpiritStoneCount,
            active: existingGuardian ? existingGuardian.active !== false : true,
        }, deps, options);
    }

    buildDurableGuardianFormationWrite(formation, deps, additionalInstanceIds = []) {
        if (!formation?.id || !formation?.instanceId) {
            return null;
        }
        const snapshot = deps.worldRuntimeFormationService?.serializeFormationForDurableMutation?.(formation) ?? null;
        if (!snapshot) {
            return null;
        }
        return {
            instanceId: formation.instanceId,
            formationInstanceId: formation.id,
            snapshot,
            instanceFences: deps.worldRuntimeFormationService?.captureFormationPersistenceFences?.([
                formation.instanceId,
                formation.eyeInstanceId,
                ...additionalInstanceIds,
            ], deps) ?? [],
        };
    }

    buildSectCoreActions(view, deps = null) {
        const sect = this.findSectByInstanceId(view?.instance?.instanceId);
        if (!sect || sect.status === 'dissolved' || chebyshevDistance(view.self.x, view.self.y, sect.coreX, sect.coreY) > 1) {
            return [];
        }
        ensureSectState(sect, this.playerRuntimeService);
        const player = this.playerRuntimeService.getPlayer(view.playerId);
        const sameSect = isSectMember(sect, view.playerId);
        if (!sameSect) {
            return [];
        }
        if (player && normalizeOptionalString(player.sectId) !== sect.sectId) {
            this.playerRuntimeService.setPlayerSectId?.(view.playerId, sect.sectId);
            this.playerSectId.set(view.playerId, sect.sectId);
        }
        const guardian = resolveSectGuardianFormation(sect, deps);
        const actions = [{
            id: 'sect:manage',
            name: '管理宗門',
            type: 'interact',
            desc: buildSectManagementActionDesc(sect, view, deps, guardian, this.sectMemberProfilesByPlayerId),
            cooldownLeft: 0,
        }];
        const hasUsableCorePortal = Array.isArray(view?.localPortals) && view.localPortals.some((portal) => portal?.sectId === sect.sectId
            && portal?.kind === 'sect_core'
            && portal?.trigger === 'manual'
            && normalizeOptionalString(portal?.targetMapId) === sect.entranceTemplateId
            && normalizeOptionalString(portal?.targetInstanceId) === sect.entranceInstanceId
            && Math.trunc(Number(portal?.targetX)) === sect.entranceX
            && Math.trunc(Number(portal?.targetY)) === sect.entranceY
            && chebyshevDistance(view.self.x, view.self.y, portal.x, portal.y) <= 1);
        if (!hasUsableCorePortal) {
            actions.push({
                id: 'sect:exit',
                name: '離開宗門領地',
                type: 'travel',
                desc: `返回${sect.name}山門入口，不會退出宗門成員關係。`,
                cooldownLeft: 0,
            });
        }
        const maintainingGuardian = player?.formationJob
            && Number(player.formationJob.remainingTicks) > 0
            && player.formationJob.formationInstanceId === `formation:sect_guardian:${sect.sectId}`;
        actions.push({
            id: maintainingGuardian ? 'sect:guardian:cancel_maintain' : 'sect:guardian:maintain',
            name: maintainingGuardian ? '停止補充：護宗大陣' : '補充靈力：護宗大陣',
            type: 'interact',
            desc: maintainingGuardian
                ? `停止持續向護宗大陣注入自身靈力。當前大陣靈力 ${formatInteger(resolveFormationQiBudget(guardian))}。`
                : `持續向護宗大陣注入自身靈力，每息獲得陣法技藝經驗。當前大陣靈力 ${formatInteger(resolveFormationQiBudget(guardian))}。`,
            cooldownLeft: 0,
        });
        return actions;
    }

    /** 按当前玩家的权威宗门身份返回待审批申请分页，不允许客户端指定任意宗门。 */
    buildSectApplicationPage(playerId, payload = null) {
        const normalizedPlayerId = normalizeOptionalString(playerId);
        if (!normalizedPlayerId) {
            throw new BadRequestException('玩家身份無效');
        }
        this.playerRuntimeService.getPlayerOrThrow(normalizedPlayerId);
        const sectId = this.resolvePlayerSectId(normalizedPlayerId);
        const sect = sectId ? this.findSectById(sectId) : null;
        if (!sect || sect.status === 'dissolved') {
            throw new NotFoundException('宗門已不存在');
        }
        ensureSectState(sect, this.playerRuntimeService);
        if (!isSectMember(sect, normalizedPlayerId)) {
            throw new ForbiddenException('你不在該宗門成員名冊中');
        }
        assertSectPermission(sect, normalizedPlayerId, 'member_approve');
        return buildSectApplicationPageView(sect, payload);
    }

    consumeSectDirectoryRateLimit(playerId, now = Date.now()) {
        const normalizedPlayerId = normalizeOptionalString(playerId);
        if (!normalizedPlayerId) {
            throw new BadRequestException('玩家身份無效');
        }
        const cutoff = Math.trunc(Number(now)) - SECT_DIRECTORY_RATE_LIMIT_WINDOW_MS;
        const recent = (this.directoryRequestAtByPlayerId.get(normalizedPlayerId) ?? [])
            .filter((timestamp) => timestamp > cutoff);
        if (recent.length >= SECT_DIRECTORY_RATE_LIMIT_MAX) {
            return false;
        }
        recent.push(Math.max(0, Math.trunc(Number(now)) || 0));
        this.directoryRequestAtByPlayerId.set(normalizedPlayerId, recent);
        return true;
    }

    buildSectDirectoryView(playerId, payload = null) {
        const normalizedPlayerId = normalizeOptionalString(playerId);
        if (!normalizedPlayerId) {
            throw new BadRequestException('玩家身份無效');
        }
        this.playerRuntimeService.getPlayerOrThrow(normalizedPlayerId);
        const requestId = normalizeSectDirectoryPageRequestId(payload?.requestId);
        const search = normalizeSectDirectoryPageSearch(payload?.search);
        const offset = normalizeSectDirectoryPageOffset(payload?.offset);
        const limit = normalizeSectDirectoryPageLimit(payload?.limit);
        const ledSect = this.findSectLedByPlayer(normalizedPlayerId);
        const matching = [];
        let revision = 0;
        for (const sect of this.sectsById.values()) {
            if (sect?.status !== 'active' || !Array.isArray(sect.members) || sect.members.length <= 0) {
                continue;
            }
            ensureSectState(sect, this.playerRuntimeService);
            const updatedAt = Number.isFinite(Number(sect.updatedAt))
                ? Math.max(0, Math.trunc(Number(sect.updatedAt)))
                : 0;
            if (updatedAt > revision) {
                revision = updatedAt;
            }
            if (!matchesSectDirectorySearch(sect, search)) {
                continue;
            }
            matching.push(sect);
        }
        matching.sort((left, right) => {
            const memberDelta = (right.members?.length ?? 0) - (left.members?.length ?? 0);
            if (memberDelta !== 0) {
                return memberDelta;
            }
            const createdDelta = (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0);
            if (createdDelta !== 0) {
                return createdDelta;
            }
            return String(left.sectId ?? '').localeCompare(String(right.sectId ?? ''));
        });
        const total = matching.length;
        const items = matching.slice(offset, offset + limit).map((sect) => (
            projectSectDirectoryEntry(sect, {
                playerId: normalizedPlayerId,
                ledSectId: ledSect?.sectId ?? null,
                templateRepository: this.templateRepository,
                playerRuntimeService: this.playerRuntimeService,
            })
        ));
        return {
            requestId,
            search,
            offset,
            limit,
            total,
            revision,
            items,
        };
    }

    async executeSectAction(playerId, actionId, deps) {
        const player = this.playerRuntimeService.getPlayerOrThrow(playerId);
        if (actionId.startsWith('sect:apply-remote:')) {
            return this.applyJoinSectRemote(playerId, actionId.slice('sect:apply-remote:'.length), deps);
        }
        if (actionId.startsWith('sect:apply:')) {
            return this.applyJoinSect(playerId, actionId.slice('sect:apply:'.length), deps);
        }
        if (actionId.startsWith('sect:enter:')) {
            return this.enterSectFromEntrance(playerId, actionId.slice('sect:enter:'.length), deps);
        }
        const sect = this.findSectById(player.sectId);
        if (!sect || sect.status === 'dissolved') {
            throw new BadRequestException('你尚未加入宗門');
        }
        ensureSectState(sect, this.playerRuntimeService);
        if (!isSectMember(sect, playerId)) {
            throw new ForbiddenException('你不在該宗門成員名冊中');
        }
        if (actionId === 'sect:exit') {
            return this.exitSectToEntrance(playerId, sect, deps);
        }
        if (actionId === 'sect:manage') {
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId === 'sect:leave') {
            await this.leaveSect(sect, playerId, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        const guardianId = `formation:sect_guardian:${sect.sectId}`;
        if (actionId === 'sect:guardian:toggle') {
            assertSectPermission(sect, playerId, 'guardian');
            const formation = deps.worldRuntimeFormationService.findFormationInInstance(sect.entranceInstanceId, guardianId);
            deps.worldRuntimeFormationService.dispatchSetPersistentFormationActive(playerId, {
                instanceId: sect.entranceInstanceId,
                formationInstanceId: guardianId,
                active: !(formation?.active !== false),
            }, deps);
            const nToggled = buildStructuredNotice('success', 'notice.sect.formation-toggled', '護宗大陣狀態已切換。');
            deps.queuePlayerNotice(playerId, nToggled.text, nToggled.kind, undefined, undefined, nToggled.structured);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId.startsWith('sect:guardian:active:')) {
            assertSectPermission(sect, playerId, 'guardian');
            const activeText = actionId.slice('sect:guardian:active:'.length);
            const active = activeText === '1' || activeText === 'true' || activeText === 'on';
            const formation = deps.worldRuntimeFormationService.findFormationInInstance(sect.entranceInstanceId, guardianId)
                ?? this.ensureGuardianFormation(sect, deps);
            deps.worldRuntimeFormationService.dispatchSetPersistentFormationActive(playerId, {
                instanceId: sect.entranceInstanceId,
                formationInstanceId: formation?.id ?? guardianId,
                active,
            }, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId === 'sect:guardian:maintain') {
            const formation = deps.worldRuntimeFormationService.findFormationInInstance(sect.entranceInstanceId, guardianId)
                ?? this.ensureGuardianFormation(sect, deps);
            dispatchSectGuardianTechniqueActivity(playerId, 'start', formation?.id ?? guardianId, deps);
            deps.refreshPlayerContextActions?.(playerId);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId === 'sect:guardian:cancel_maintain') {
            dispatchSectGuardianTechniqueActivity(playerId, 'cancel', guardianId, deps);
            deps.refreshPlayerContextActions?.(playerId);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId.startsWith('sect:guardian:inject:')) {
            assertSectPermission(sect, playerId, 'guardian');
            const [, , , stoneText = '0', qiText = '0'] = actionId.split(':');
            const formation = deps.worldRuntimeFormationService.findFormationInInstance(sect.entranceInstanceId, guardianId)
                ?? this.ensureGuardianFormation(sect, deps);
            await deps.worldRuntimeFormationService.dispatchInjectPersistentFormationEnergy(playerId, {
                instanceId: sect.entranceInstanceId,
                formationInstanceId: formation?.id ?? guardianId,
                spiritStoneCount: normalizeNonNegativeInteger(stoneText),
                qiAmount: normalizeNonNegativeInteger(qiText),
            }, deps);
            const nCharged = buildStructuredNotice('success', 'notice.sect.formation-charged', '護宗大陣靈力已注入。');
            deps.queuePlayerNotice(playerId, nCharged.text, nCharged.kind, undefined, undefined, nCharged.structured);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId.startsWith('sect:guardian:strength:')) {
            assertSectPermission(sect, playerId, 'guardian');
            const strengthText = actionId.slice('sect:guardian:strength:'.length);
            const formation = deps.worldRuntimeFormationService.findFormationInInstance(sect.entranceInstanceId, guardianId)
                ?? this.ensureGuardianFormation(sect, deps);
            deps.worldRuntimeFormationService.dispatchSetPersistentFormationStrength(playerId, {
                instanceId: sect.entranceInstanceId,
                formationInstanceId: formation?.id ?? guardianId,
                strength: normalizePositiveInteger(strengthText, '大陣強度'),
            }, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId === 'sect:guardian:refill') {
            assertSectPermission(sect, playerId, 'guardian');
            const formation = deps.worldRuntimeFormationService.findFormationInInstance(sect.entranceInstanceId, guardianId);
            if (!formation) {
                this.ensureGuardianFormation(sect, deps);
            } else {
                await deps.worldRuntimeFormationService.dispatchInjectPersistentFormationEnergy(playerId, {
                    instanceId: sect.entranceInstanceId,
                    formationInstanceId: guardianId,
                    spiritStoneCount: Math.ceil(SECT_GUARDIAN_INITIAL_AURA / FORMATION_AURA_PER_SPIRIT_STONE),
                    qiAmount: SECT_GUARDIAN_INITIAL_AURA,
                }, deps);
            }
            const nReplenished = buildStructuredNotice('success', 'notice.sect.formation-replenished', '護宗大陣已補充靈力。');
            deps.queuePlayerNotice(playerId, nReplenished.text, nReplenished.kind, undefined, undefined, nReplenished.structured);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId.startsWith('sect:member:remove:')) {
            assertSectPermission(sect, playerId, 'member_remove');
            const targetPlayerId = decodeActionPart(actionId.slice('sect:member:remove:'.length));
            await this.removeSectMember(sect, targetPlayerId, playerId, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId.startsWith('sect:application:approve:')) {
            assertSectPermission(sect, playerId, 'member_approve');
            const targetPlayerId = decodeActionPart(actionId.slice('sect:application:approve:'.length));
            await this.approveSectApplication(sect, targetPlayerId, playerId, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId.startsWith('sect:application:reject:')) {
            assertSectPermission(sect, playerId, 'member_approve');
            const targetPlayerId = decodeActionPart(actionId.slice('sect:application:reject:'.length));
            await this.rejectSectApplication(sect, targetPlayerId, playerId, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId.startsWith('sect:member:role:')) {
            assertSectPermission(sect, playerId, 'member_role');
            const parts = actionId.split(':');
            const targetPlayerId = decodeActionPart(parts[3] ?? '');
            const roleId = normalizeSectRoleId(parts[4], { requireAssignable: true });
            await this.changeSectMemberRole(sect, targetPlayerId, roleId, playerId, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId.startsWith('sect:transfer:')) {
            assertSectLeader(sect, playerId);
            const targetPlayerId = decodeActionPart(actionId.slice('sect:transfer:'.length));
            await this.transferSectLeadership(sect, targetPlayerId, playerId, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId === 'sect:dissolve') {
            assertSectLeader(sect, playerId);
            await this.dissolveSect(sect, playerId, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        if (actionId.startsWith('sect:permission:toggle:')) {
            assertSectLeader(sect, playerId);
            const parts = actionId.split(':');
            const roleId = normalizeSectRoleId(parts[3], { allowSupreme: true });
            const permissionId = normalizeSectPermissionId(parts[4]);
            await this.toggleSectRolePermission(sect, roleId, permissionId, playerId, deps);
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        throw new BadRequestException(`不支持的宗門動作：${actionId}`);
    }

    buildSectEntranceActions(view, deps = null) {
        const player = this.playerRuntimeService.getPlayer(view?.playerId);
        if (!player) {
            return [];
        }
        const playerSectId = normalizeOptionalString(player.sectId);
        const instanceId = normalizeOptionalString(view?.instance?.instanceId);
        if (!instanceId || !Array.isArray(view?.localPortals)) {
            return [];
        }
        const ledSect = this.findSectLedByPlayer(view?.playerId);
        const actions = [];
        const seen = new Set();
        for (const portal of view.localPortals) {
            const sectId = normalizeOptionalString(portal?.sectId);
            if (!sectId || portal?.kind !== 'sect_entrance' || seen.has(sectId)) {
                continue;
            }
            const portalDistance = chebyshevDistance(view.self?.x, view.self?.y, portal.x, portal.y);
            if (portalDistance > SECT_ENTRANCE_INTERACTION_RADIUS) {
                continue;
            }
            const sect = this.findSectById(sectId);
            if (!sect || sect.status === 'dissolved' || sect.entranceInstanceId !== instanceId) {
                continue;
            }
            ensureSectState(sect, this.playerRuntimeService);
            if (playerSectId === sect.sectId || isSectMember(sect, view.playerId)) {
                if (normalizeOptionalString(player.sectId) !== sect.sectId) {
                    this.playerRuntimeService.setPlayerSectId?.(view.playerId, sect.sectId);
                    this.playerSectId.set(view.playerId, sect.sectId);
                }
            }
            if (portalDistance <= 1) {
                actions.push({
                    id: `sect:enter:${encodeURIComponent(sect.sectId)}`,
                    name: `進入宗門：${sect.name}`,
                    type: 'travel',
                    desc: `從${sect.name}山門進入宗門核心。`,
                    cooldownLeft: 0,
                });
            }
            seen.add(sectId);
            if (playerSectId === sect.sectId || isSectMember(sect, view.playerId)) {
                continue;
            }
            if (ledSect && ledSect.sectId !== sect.sectId) {
                continue;
            }
            actions.push({
                id: `sect:apply:${encodeURIComponent(sect.sectId)}`,
                name: `遞拜帖：申請加入${sect.name}`,
                type: 'interact',
                desc: `你在${sect.name}護宗大陣前整理衣冠，向守陣執事遞上拜帖。若願受門規，便以外門弟子身份入山。`,
                cooldownLeft: 0,
            });
        }
        return actions;
    }

    enterSectFromEntrance(playerId, encodedSectId, deps) {
        const player = this.playerRuntimeService.getPlayerOrThrow(playerId);
        const sectId = decodeActionPart(encodedSectId);
        const sect = this.findSectById(sectId);
        if (!sect || sect.status === 'dissolved') {
            throw new NotFoundException('山門氣機已散，無法返回宗門');
        }
        ensureSectState(sect, this.playerRuntimeService);
        const location = deps.getPlayerLocationOrThrow(playerId);
        if (location.instanceId !== sect.entranceInstanceId) {
            throw new BadRequestException('需要在該宗門山門前返回宗門');
        }
        if (chebyshevDistance(player.x, player.y, sect.entranceX, sect.entranceY) > 1) {
            throw new BadRequestException('需要靠近護宗大陣前的山門傳送點');
        }
        if (isSectMember(sect, playerId)) {
            if (typeof this.playerRuntimeService.setPlayerSectId === 'function') {
                this.playerRuntimeService.setPlayerSectId(playerId, sect.sectId);
            } else {
                player.sectId = sect.sectId;
            }
            this.playerSectId.set(playerId, sect.sectId);
        }
        deps.applyTransfer?.({
            playerId,
            sessionId: location.sessionId,
            fromInstanceId: sect.entranceInstanceId,
            targetMapId: sect.sectTemplateId,
            targetInstanceId: sect.sectInstanceId,
            targetX: sect.coreX,
            targetY: sect.coreY,
            reason: 'manual_portal',
        });
        queueStructuredSectNotice(deps, playerId, 'travel', 'notice.sect.entered-core', `你穿過${sect.name}山門，返回宗門核心。`, {
            vars: { sectName: sect.name },
            pills: [{ key: 'sectName', style: 'target' }],
        });
        return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
    }

    async exitSectToEntrance(playerId, sect, deps) {
        const player = this.playerRuntimeService.getPlayerOrThrow(playerId);
        const location = deps.getPlayerLocationOrThrow(playerId);
        if (location.instanceId !== sect.sectInstanceId) {
            throw new BadRequestException('需要在宗門領地內離開');
        }
        if (chebyshevDistance(player.x, player.y, sect.coreX, sect.coreY) > 1) {
            throw new BadRequestException('需要靠近宗門核心才能離開宗門領地');
        }
        const sourceInstance = deps.getInstanceRuntime?.(sect.sectInstanceId);
        const entranceInstance = deps.getInstanceRuntime?.(sect.entranceInstanceId);
        await waitForSectInstancesLeaseReady([sourceInstance, entranceInstance], deps);
        if (typeof deps.applyTransfer !== 'function') {
            throw new ServiceUnavailableException('宗門傳送服務尚未就緒');
        }
        deps.applyTransfer({
            playerId,
            sessionId: location.sessionId,
            fromInstanceId: sect.sectInstanceId,
            targetMapId: sect.entranceTemplateId,
            targetInstanceId: sect.entranceInstanceId,
            targetX: sect.entranceX,
            targetY: sect.entranceY,
            reason: 'manual_portal',
        });
        queueStructuredSectNotice(deps, playerId, 'travel', 'notice.sect.exited-core', `你離開${sect.name}宗門領地，返回山門入口。`, {
            vars: { sectName: sect.name },
            pills: [{ key: 'sectName', style: 'target' }],
        });
        return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
    }

    /**
     * 遞交拜帖共用核心：宗門存在且未解散 → 成員自動歸位 → 他宗宗主拒絕 → gateFn →
     * rollback capture → upsert → advanceSectUpdatedAt → durable commit → 郵件 × 2 + 通知 × 2 + refresh。
     * 走路與遠端兩入口唯一差異是中段 gateFn（走路 = 位置閘，遠端 = 防灌水三閘）。
     */
    applyJoinSectWithGate(playerId, encodedSectId, deps, gateFn) {
        const sectId = decodeActionPart(encodedSectId);
        return this.runExclusiveSectPlayerMutation([sectId], [playerId], async () => {
        let afterCommit = null;
        const player = this.playerRuntimeService.getPlayerOrThrow(playerId);
        const sect = this.findSectById(sectId);
        if (!sect || sect.status === 'dissolved') {
            throw new NotFoundException('山門氣機已散，無法遞交拜帖');
        }
        ensureSectState(sect, this.playerRuntimeService);
        if (isSectMember(sect, playerId)) {
            if (typeof this.playerRuntimeService.setPlayerSectId === 'function') {
                this.playerRuntimeService.setPlayerSectId(playerId, sect.sectId);
            } else {
                player.sectId = sect.sectId;
            }
            return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        }
        const ledSect = this.findSectLedByPlayer(playerId);
        if (ledSect && ledSect.sectId !== sect.sectId) {
            throw new BadRequestException(`你身為${ledSect.name}宗主，不能加入其他宗門，請先轉讓宗主之位或解散原宗門`);
        }
        if (typeof gateFn === 'function') {
            const gateOutcome = await gateFn(player, sect, deps);
            if (gateOutcome?.shortCircuit) {
                return gateOutcome.result;
            }
            if (gateOutcome?.afterCommit) {
                afterCommit = gateOutcome.afterCommit;
            }
        }
        const rollback = captureSectMembershipRollback(this, [sect.sectId], []);
        const beforeSnapshots = rollback.sects.map((entry) => entry.snapshot);
        try {
        const application = upsertSectApplication(sect, player, Date.now());
        this.rememberSectMemberRuntimeProfile(player);
        advanceSectUpdatedAt(sect);
        await this.commitDurableSectMembershipMutation(beforeSnapshots, new Map());
        if (typeof afterCommit === 'function') {
            afterCommit();
        }
        this.deliverSectMail(playerId, {
            senderLabel: sect.name,
            fallbackTitle: `已向${sect.name}遞交拜帖`,
            fallbackBody: `你的入宗申請已遞交給${sect.name}宗主審批。審批通過後，你會收到入宗郵件並獲得山門通行權限。`,
        }, deps);
        if (sect.leaderPlayerId !== playerId && this.playerRuntimeService.getPlayer?.(sect.leaderPlayerId)) {
            queueStructuredSectNotice(deps, sect.leaderPlayerId, 'info', 'notice.sect.application-received', `${application.name}遞交了加入${sect.name}的拜帖，待審批。`, {
                vars: { applicantName: application.name, sectName: sect.name },
                pills: [
                    { key: 'applicantName', style: 'target' },
                    { key: 'sectName', style: 'target' },
                ],
            });
        }
        this.deliverSectMail(sect.leaderPlayerId, {
            senderLabel: '宗門執事',
            fallbackTitle: `${application.name}申請加入${sect.name}`,
            fallbackBody: `${application.name}在山門前遞交拜帖。請前往宗門核心的“管理宗門 -> 管理事務”審批。`,
        }, deps);
        queueStructuredSectNotice(deps, playerId, 'success', 'notice.sect.application-submitted', `拜帖已遞交給${sect.name}宗主審批。`, {
            vars: { sectName: sect.name },
            pills: [{ key: 'sectName', style: 'target' }],
        });
        deps.refreshPlayerContextActions?.(playerId);
        return { kind: 'queued', view: deps.getPlayerViewOrThrow(playerId) };
        } catch (error) {
            restoreSectMembershipRollback(this, rollback);
            throw error;
        }
        });
    }

    /** 走路入口：共用核心 + 原位置閘（錯誤文案逐字保留）。 */
    applyJoinSect(playerId, encodedSectId, deps) {
        return this.applyJoinSectWithGate(playerId, encodedSectId, deps, async (player, sect, actionDeps) => {
            const location = actionDeps.getPlayerLocationOrThrow(playerId);
            if (location.instanceId !== sect.entranceInstanceId) {
                throw new BadRequestException('需要在該宗門山門前遞交拜帖');
            }
            if (chebyshevDistance(player.x, player.y, sect.entranceX, sect.entranceY) > SECT_ENTRANCE_INTERACTION_RADIUS) {
                throw new BadRequestException('需要靠近護宗大陣前的山門傳送點');
            }
            return null;
        });
    }

    /**
     * 遠端入口：共用核心 + 防灌水三閘（順序不可調換，全部在 exclusive mutation 內部）：
     * ①同宗 pending 短路（不重發宗主郵件、不重置 appliedAt、不占冷卻）→ ②冷卻 → ③跨宗 pending 上限 →
     * ④成功後設冷卻。
     */
    applyJoinSectRemote(playerId, encodedSectId, deps) {
        return this.applyJoinSectWithGate(playerId, encodedSectId, deps, async (player, sect, actionDeps) => {
            const now = Date.now();
            const pending = findPendingSectApplication(sect, playerId);
            if (pending) {
                queueStructuredSectNotice(actionDeps, playerId, 'info', 'notice.sect.application-already-pending', '拜帖已在審批中');
                return { shortCircuit: true, result: { kind: 'queued', view: actionDeps.getPlayerViewOrThrow(playerId) } };
            }
            const allowedAt = this.nextRemoteApplyAllowedAtByPlayerId.get(playerId) ?? 0;
            if (now < allowedAt) {
                throw new BadRequestException('拜帖剛遞出，請稍後再試');
            }
            let crossSectPendingCount = 0;
            for (const candidate of this.sectsById.values()) {
                if (!candidate || candidate.status === 'dissolved') {
                    continue;
                }
                if (findPendingSectApplication(candidate, playerId)) {
                    crossSectPendingCount += 1;
                    if (crossSectPendingCount >= SECT_REMOTE_APPLICATION_MAX_PENDING) {
                        break;
                    }
                }
            }
            if (crossSectPendingCount >= SECT_REMOTE_APPLICATION_MAX_PENDING) {
                throw new BadRequestException('你已有太多待審拜帖，請等待宗主批示');
            }
            return { afterCommit: () => {
                this.nextRemoteApplyAllowedAtByPlayerId.set(playerId, now + SECT_REMOTE_APPLICATION_COOLDOWN_MS);
            } };
        });
    }

    approveSectApplication(sect, targetPlayerId, operatorPlayerId, deps) {
        const targetId = normalizeOptionalString(targetPlayerId);
        return this.runExclusiveStableSectMembershipMutation(
            [sect?.sectId],
            [operatorPlayerId, targetId].filter(Boolean),
            targetId,
            async () => {
        const currentSect = this.findSectById(sect?.sectId);
        if (!currentSect || currentSect.status === 'dissolved') {
            throw new NotFoundException('宗門已不存在');
        }
        assertSectPermission(currentSect, operatorPlayerId, 'member_approve');
        const application = targetId ? findPendingSectApplication(currentSect, targetId) : null;
        if (!application) {
            throw new NotFoundException('未找到待審批拜帖');
        }
        const ledSect = this.findSectLedByPlayer(targetId);
        if (ledSect && ledSect.sectId !== currentSect.sectId) {
            throw new BadRequestException(`${application.name}是${ledSect.name}宗主，無法直接入宗，請其先轉讓宗主之位或解散原宗門`);
        }
        const applicant = this.playerRuntimeService.getPlayer?.(targetId) ?? null;
        if (applicant) {
            this.rememberSectMemberRuntimeProfile(applicant);
        }
        const currentMembershipSectId = this.resolvePlayerSectId(targetId);
        const affectedSectIds = [currentSect.sectId, currentMembershipSectId].filter(Boolean);
        const rollback = captureSectMembershipRollback(this, affectedSectIds, [targetId]);
        const beforeSnapshots = rollback.sects.map((entry) => entry.snapshot);
        try {
        this.leaveCurrentSectBeforeJoin(targetId, currentSect.sectId, deps);
        if (!isSectMember(currentSect, targetId)) {
            currentSect.members.push(buildSectMemberEntry(applicant ?? { playerId: targetId, name: application.name }, 'outer', Date.now()));
            currentSect.members = normalizeSectMembers(currentSect.members, {
                sectId: currentSect.sectId,
                leaderPlayerId: currentSect.leaderPlayerId,
                leaderName: currentSect.leaderPlayerId,
                createdAt: currentSect.createdAt,
            });
        }
        application.status = 'approved';
        application.reviewedAt = Date.now();
        application.reviewerPlayerId = operatorPlayerId;
        advanceSectUpdatedAt(currentSect);
        this.playerSectId.set(targetId, currentSect.sectId);
        if (applicant && typeof this.playerRuntimeService.setPlayerSectId === 'function') {
            this.playerRuntimeService.setPlayerSectId(targetId, currentSect.sectId);
        }
        await this.commitDurableSectMembershipMutation(
            beforeSnapshots,
            new Map([[targetId, currentSect.sectId]]),
        );
        if (applicant) {
            deps.refreshQuestStates?.(targetId);
            deps.refreshPlayerContextActions?.(targetId);
            queueStructuredSectNotice(deps, targetId, 'success', 'notice.sect.application-approved', `${currentSect.name}已準你入山，護宗大陣會放行同門。`, {
                vars: { sectName: currentSect.name },
                pills: [{ key: 'sectName', style: 'target' }],
            });
        }
        this.deliverSectMail(targetId, {
            senderLabel: currentSect.name,
            fallbackTitle: `${currentSect.name}已準你入山`,
            fallbackBody: `你的拜帖已通過審批，現列為${currentSect.name}外門弟子。前往山門附近即可返回宗門核心，護宗大陣會識別你的同門身份。`,
        }, deps);
        queueStructuredSectNotice(deps, operatorPlayerId, 'success', 'notice.sect.application-approved-operator', `已準 ${application.name} 入宗。`, {
            vars: { applicantName: application.name },
            pills: [{ key: 'applicantName', style: 'target' }],
        });
        } catch (error) {
            restoreSectMembershipRollback(this, rollback);
            throw error;
        }
            },
        );
    }

    rejectSectApplication(sect, targetPlayerId, operatorPlayerId, deps) {
        const targetId = normalizeOptionalString(targetPlayerId);
        return this.runExclusiveSectPlayerMutation([sect?.sectId], [operatorPlayerId], async () => {
        const currentSect = this.findSectById(sect?.sectId);
        if (!currentSect || currentSect.status === 'dissolved') {
            throw new NotFoundException('宗門已不存在');
        }
        assertSectPermission(currentSect, operatorPlayerId, 'member_approve');
        const application = targetId ? findPendingSectApplication(currentSect, targetId) : null;
        if (!application) {
            throw new NotFoundException('未找到待審批拜帖');
        }
        const rollback = captureSectMembershipRollback(this, [currentSect.sectId], []);
        const beforeSnapshots = rollback.sects.map((entry) => entry.snapshot);
        try {
        application.status = 'rejected';
        application.reviewedAt = Date.now();
        application.reviewerPlayerId = operatorPlayerId;
        advanceSectUpdatedAt(currentSect);
        await this.commitDurableSectMembershipMutation(beforeSnapshots, new Map());
        this.releaseSectMemberProfileIfUnused(targetId);
        this.deliverSectMail(targetId, {
            senderLabel: currentSect.name,
            fallbackTitle: `${currentSect.name}退回了你的拜帖`,
            fallbackBody: `你的入宗申請未通過審批，可稍後重新遞交拜帖。`,
        }, deps);
        queueStructuredSectNotice(deps, operatorPlayerId, 'success', 'notice.sect.application-rejected-operator', `已退回 ${application.name} 的拜帖。`, {
            vars: { applicantName: application.name },
            pills: [{ key: 'applicantName', style: 'target' }],
        });
        } catch (error) {
            restoreSectMembershipRollback(this, rollback);
            throw error;
        }
        });
    }

    leaveSect(sect, playerId, deps) {
        return this.runExclusiveStableSectMembershipMutation([sect?.sectId], [playerId], playerId, async () => {
        const currentSect = this.findSectById(sect?.sectId);
        if (!currentSect || currentSect.status === 'dissolved') {
            throw new NotFoundException('宗門已不存在');
        }
        if (this.resolvePlayerSectId(playerId) !== currentSect.sectId) {
            throw new BadRequestException('你的宗門歸屬已經變化，請刷新後重試');
        }
        if (currentSect.leaderPlayerId === playerId) {
            throw new BadRequestException('宗主不能直接離開宗門，請先轉讓宗主之位或解散宗門');
        }
        const rollback = captureSectMembershipRollback(this, [currentSect.sectId], [playerId]);
        const beforeSnapshots = rollback.sects.map((entry) => entry.snapshot);
        try {
        const before = currentSect.members.length;
        currentSect.members = currentSect.members.filter((entry) => entry.playerId !== playerId);
        if (currentSect.members.length === before) {
            throw new NotFoundException('你不在該宗門成員名冊中');
        }
        const player = this.playerRuntimeService.getPlayer?.(playerId);
        if (typeof this.playerRuntimeService.setPlayerSectId === 'function') {
            this.playerRuntimeService.setPlayerSectId(playerId, null);
        } else if (player) {
            player.sectId = null;
        }
        this.playerSectId.delete(playerId);
        advanceSectUpdatedAt(currentSect);
        await this.commitDurableSectMembershipMutation(
            beforeSnapshots,
            new Map([[playerId, null]]),
        );
        this.releaseSectMemberProfileIfUnused(playerId);
        deps.refreshQuestStates?.(playerId);
        deps.refreshPlayerContextActions?.(playerId);
        queueStructuredSectNotice(deps, playerId, 'success', 'notice.sect.left', `你已離開${currentSect.name}。`, {
            vars: { sectName: currentSect.name },
            pills: [{ key: 'sectName', style: 'target' }],
        });
        if (currentSect.leaderPlayerId && this.playerRuntimeService.getPlayer?.(currentSect.leaderPlayerId)) {
            const memberName = resolvePlayerDisplayName(player, playerId);
            queueStructuredSectNotice(deps, currentSect.leaderPlayerId, 'info', 'notice.sect.member-left', `${memberName}已離開${currentSect.name}。`, {
                vars: { memberName, sectName: currentSect.name },
                pills: [
                    { key: 'memberName', style: 'target' },
                    { key: 'sectName', style: 'target' },
                ],
            });
        }
        } catch (error) {
            restoreSectMembershipRollback(this, rollback);
            throw error;
        }
        });
    }

    deliverSectMail(playerId, input, deps = null) {
        if (!normalizeOptionalString(playerId) || typeof this._mailRuntimeService?.createDirectMail !== 'function') {
            return;
        }
        void this._mailRuntimeService.createDirectMail(playerId, {
            senderLabel: input.senderLabel,
            fallbackTitle: input.fallbackTitle,
            fallbackBody: input.fallbackBody,
            attachments: [],
        }).then(() => {
            const socket = deps?.worldSessionService?.getSocketByPlayerId?.(playerId);
            if (socket && typeof deps?.worldClientEventService?.emitMailSummaryForPlayer === 'function') {
                return deps.worldClientEventService.emitMailSummaryForPlayer(socket, playerId);
            }
            return undefined;
        }).catch((error) => {
            this.logger.warn(`宗門郵件發送失敗：${error instanceof Error ? error.message : String(error)}`);
        });
    }

    leaveCurrentSectBeforeJoin(playerId, targetSectId, deps) {
        const player = this.playerRuntimeService.getPlayer?.(playerId) ?? null;
        const currentSectId = normalizeOptionalString(player?.sectId) || normalizeOptionalString(this.playerSectId.get(playerId));
        if (!currentSectId || currentSectId === targetSectId) {
            return null;
        }
        const currentSect = this.findSectById(currentSectId);
        if (!currentSect || currentSect.status === 'dissolved') {
            this.playerSectId.delete(playerId);
            return null;
        }
        ensureSectState(currentSect, this.playerRuntimeService);
        if (currentSect.leaderPlayerId === playerId || currentSect.members.some((entry) => entry.playerId === playerId && entry.roleId === 'leader')) {
            throw new BadRequestException('宗主不能直接改投其他宗門，請先轉讓宗主之位或解散原宗門');
        }
        const before = currentSect.members.length;
        currentSect.members = currentSect.members.filter((entry) => entry.playerId !== playerId);
        if (currentSect.members.length !== before) {
            advanceSectUpdatedAt(currentSect);
            if (this.playerRuntimeService.getPlayer?.(currentSect.leaderPlayerId)) {
                const memberName = resolvePlayerDisplayName(player, playerId);
                queueStructuredSectNotice(deps, currentSect.leaderPlayerId, 'info', 'notice.sect.member-left', `${memberName}已離開${currentSect.name}。`, {
                    vars: { memberName, sectName: currentSect.name },
                    pills: [
                        { key: 'memberName', style: 'target' },
                        { key: 'sectName', style: 'target' },
                    ],
                });
            }
        }
        this.playerSectId.delete(playerId);
        return currentSect;
    }

    removeSectMember(sect, targetPlayerId, operatorPlayerId, deps) {
        const targetId = normalizeOptionalString(targetPlayerId);
        return this.runExclusiveStableSectMembershipMutation(
            [sect?.sectId],
            [operatorPlayerId, targetId].filter(Boolean),
            targetId,
            async () => {
        const currentSect = this.findSectById(sect?.sectId);
        if (!currentSect || currentSect.status === 'dissolved') {
            throw new NotFoundException('宗門已不存在');
        }
        assertSectPermission(currentSect, operatorPlayerId, 'member_remove');
        if (!targetId || targetId === currentSect.leaderPlayerId) {
            throw new BadRequestException('不能移除宗主');
        }
        if (targetId === operatorPlayerId) {
            throw new BadRequestException('不能移除自己');
        }
        if (this.resolvePlayerSectId(targetId) !== currentSect.sectId) {
            throw new BadRequestException('該成員宗門歸屬已經變化，請刷新後重試');
        }
        const rollback = captureSectMembershipRollback(this, [currentSect.sectId], [targetId]);
        const beforeSnapshots = rollback.sects.map((entry) => entry.snapshot);
        try {
        const before = currentSect.members.length;
        currentSect.members = currentSect.members.filter((entry) => entry.playerId !== targetId);
        if (currentSect.members.length === before) {
            throw new NotFoundException('該成員不在宗門名冊中');
        }
        this.playerSectId.delete(targetId);
        this.clearPlayerSectIdIfLoaded(targetId, currentSect.sectId);
        advanceSectUpdatedAt(currentSect);
        await this.commitDurableSectMembershipMutation(
            beforeSnapshots,
            new Map([[targetId, null]]),
        );
        this.releaseSectMemberProfileIfUnused(targetId);
        queueStructuredSectNotice(deps, operatorPlayerId, 'success', 'notice.sect.member-removed-operator', '已移除宗門成員。');
        deps.refreshQuestStates?.(targetId);
        } catch (error) {
            restoreSectMembershipRollback(this, rollback);
            throw error;
        }
        },
        );
    }

    changeSectMemberRole(sect, targetPlayerId, roleId, operatorPlayerId, deps) {
        const targetId = normalizeOptionalString(targetPlayerId);
        return this.runExclusiveSectPlayerMutation([sect?.sectId], [operatorPlayerId], async () => {
        const currentSect = this.findSectById(sect?.sectId);
        if (!currentSect || currentSect.status === 'dissolved') {
            throw new NotFoundException('宗門已不存在');
        }
        assertSectPermission(currentSect, operatorPlayerId, 'member_role');
        const member = targetId ? currentSect.members.find((entry) => entry.playerId === targetId) : null;
        if (!member) {
            throw new NotFoundException('該成員不在宗門名冊中');
        }
        if (targetId === currentSect.leaderPlayerId || member.roleId === 'leader') {
            throw new BadRequestException('宗主職位只能通過轉讓改變');
        }
        assertSectMemberRoleChange(currentSect, operatorPlayerId, member, roleId);
        const rollback = captureSectMembershipRollback(this, [currentSect.sectId], []);
        const beforeSnapshots = rollback.sects.map((entry) => entry.snapshot);
        try {
        member.roleId = roleId;
        member.name = resolvePlayerDisplayName(this.playerRuntimeService.getPlayer?.(targetId), member.name || targetId);
        advanceSectUpdatedAt(currentSect);
        await this.commitDurableSectMembershipMutation(beforeSnapshots, new Map());
        const roleName = getSectRoleLabel(roleId);
        queueStructuredSectNotice(deps, operatorPlayerId, 'success', 'notice.sect.role-changed-operator', `已將 ${member.name} 調整為 ${roleName}。`, {
            vars: { memberName: member.name, roleName },
            pills: [{ key: 'memberName', style: 'target' }],
        });
        } catch (error) {
            restoreSectMembershipRollback(this, rollback);
            throw error;
        }
        });
    }

    transferSectLeadership(sect, targetPlayerId, operatorPlayerId, deps) {
        const targetId = normalizeOptionalString(targetPlayerId);
        return this.runExclusiveSectPlayerMutation(
            [sect?.sectId],
            [operatorPlayerId, targetId].filter(Boolean),
            async () => {
        const currentSect = this.findSectById(sect?.sectId);
        if (!currentSect || currentSect.status === 'dissolved') {
            throw new NotFoundException('宗門已不存在');
        }
        assertSectLeader(currentSect, operatorPlayerId);
        if (!targetId || targetId === operatorPlayerId) {
            throw new BadRequestException('請選擇其他成員接任宗主');
        }
        const target = currentSect.members.find((entry) => entry.playerId === targetId);
        if (!target) {
            throw new NotFoundException('接任者不在宗門名冊中');
        }
        const rollback = captureSectMembershipRollback(this, [currentSect.sectId], []);
        const beforeSnapshots = rollback.sects.map((entry) => entry.snapshot);
        const previousGuardian = cloneSectGuardian(resolveSectGuardianFormation(currentSect, deps));
        try {
        const previousLeader = currentSect.members.find((entry) => entry.playerId === operatorPlayerId);
        if (previousLeader) {
            previousLeader.roleId = 'deputy';
        }
        target.roleId = 'leader';
        target.name = resolvePlayerDisplayName(this.playerRuntimeService.getPlayer?.(targetId), target.name || targetId);
        currentSect.leaderPlayerId = targetId;
        advanceSectUpdatedAt(currentSect);
        const guardian = this.ensureGuardianFormation(currentSect, deps, null, { deferPersistence: true });
        await this.commitDurableSectMembershipMutation(
            beforeSnapshots,
            new Map(),
            [this.buildDurableGuardianFormationWrite(guardian, deps)].filter(Boolean),
        );
        queueStructuredSectNotice(deps, operatorPlayerId, 'success', 'notice.sect.leadership-transferred-operator', `已將宗主之位轉讓給 ${target.name}。`, {
            vars: { memberName: target.name },
            pills: [{ key: 'memberName', style: 'target' }],
        });
        queueStructuredSectNotice(deps, targetId, 'success', 'notice.sect.leadership-received', `你已接任 ${currentSect.name} 宗主。`, {
            vars: { sectName: currentSect.name },
            pills: [{ key: 'sectName', style: 'target' }],
        });
        } catch (error) {
            restoreSectMembershipRollback(this, rollback);
            if (previousGuardian) {
                const restoredSect = this.findSectById(currentSect.sectId) ?? currentSect;
                this.ensureGuardianFormation(restoredSect, deps, previousGuardian, { deferPersistence: true });
            }
            throw error;
        }
        },
        );
    }

    dissolveSect(sect, operatorPlayerId, deps) {
        return this.runExclusiveSectCurrentMembersMutation(
            sect?.sectId,
            [operatorPlayerId],
            async (lockedSect, lockedMemberIds) => {
        const currentSect = lockedSect;
        if (!currentSect || currentSect.status === 'dissolved') {
            throw new NotFoundException('宗門已不存在');
        }
        assertSectLeader(currentSect, operatorPlayerId);
        const memberIds = currentSect.members.map((entry) => entry.playerId);
        if (memberIds.length !== lockedMemberIds.length
            || memberIds.some((memberId) => !lockedMemberIds.includes(memberId))) {
            throw new BadRequestException('宗門成員正在變化，請稍後重試解散');
        }
        const membershipRollback = captureSectMembershipRollback(this, [currentSect.sectId], memberIds);
        const beforeSnapshots = membershipRollback.sects.map((entry) => entry.snapshot);
        const entranceInstance = deps.getInstanceRuntime?.(currentSect.entranceInstanceId);
        const sectInstance = deps.getInstanceRuntime?.(currentSect.sectInstanceId);
        const guardianId = `formation:sect_guardian:${currentSect.sectId}`;
        const guardian = deps.worldRuntimeFormationService?.findFormationInInstance?.(
            currentSect.entranceInstanceId,
            guardianId,
        ) ?? null;
        const runtimeRollback = {
            entranceInstance: captureSectPortalInstanceRollback(entranceInstance),
            sectInstance: captureSectPortalInstanceRollback(sectInstance),
            guardian: cloneSectGuardian(guardian),
        };
        try {
        for (const memberId of memberIds) {
            this.playerSectId.delete(memberId);
            this.clearPlayerSectIdIfLoaded(memberId, currentSect.sectId);
        }
        removeSectRuntimePortals(entranceInstance, currentSect.sectId);
        removeSectRuntimePortals(sectInstance, currentSect.sectId);
        const removedGuardian = deps.worldRuntimeFormationService?.removeFormationFromInstance?.(
            currentSect.entranceInstanceId,
            guardianId,
            deps,
            { deferPersistence: true },
        ) ?? guardian;
        const tombstone = normalizeSectEntry({
            ...currentSect,
            status: 'dissolved',
            members: [],
            applications: [],
            updatedAt: resolveNextSectUpdatedAt(currentSect),
        });
        if (tombstone) {
            this.deletedSectSnapshotsById.set(tombstone.sectId, tombstone);
        }
        this.sectsById.delete(currentSect.sectId);
        const committed = await this.commitDurableSectMembershipMutation(
            beforeSnapshots,
            new Map(memberIds.map((memberId) => [memberId, null])),
            [{
                instanceId: currentSect.entranceInstanceId,
                formationInstanceId: guardianId,
                removedAtMs: normalizeIntegerWithDefault(removedGuardian?.updatedAt, Date.now()),
                snapshot: null,
                instanceFences: deps.worldRuntimeFormationService?.captureFormationPersistenceFences?.([
                    currentSect.entranceInstanceId,
                    currentSect.sectInstanceId,
                ], deps) ?? [],
            }],
        );
        for (const memberId of memberIds) {
            this.releaseSectMemberProfileIfUnused(memberId);
        }
        if (!committed) {
            deps.worldRuntimeFormationService?.persistFormationRemovalSoon?.(removedGuardian);
        }
        for (const memberId of memberIds) {
            deps.refreshQuestStates?.(memberId);
            deps.refreshPlayerContextActions?.(memberId);
        }
        queueStructuredSectNotice(deps, operatorPlayerId, 'warning', 'notice.sect.dissolved', `${currentSect.name}已解散。`, {
            vars: { sectName: currentSect.name },
            pills: [{ key: 'sectName', style: 'target' }],
        });
        } catch (error) {
            restoreSectMembershipRollback(this, membershipRollback);
            restoreSectPortalInstanceRollback(entranceInstance, runtimeRollback.entranceInstance);
            restoreSectPortalInstanceRollback(sectInstance, runtimeRollback.sectInstance);
            if (runtimeRollback.guardian) {
                this.ensureGuardianFormation(currentSect, deps, runtimeRollback.guardian, { deferPersistence: true });
            }
            throw error;
        }
        },
        );
    }

    toggleSectRolePermission(sect, roleId, permissionId, playerId, deps) {
        return this.runExclusiveSectPlayerMutation([sect?.sectId], [playerId], async () => {
            const currentSect = this.findSectById(sect?.sectId);
            if (!currentSect || currentSect.status === 'dissolved') {
                throw new NotFoundException('宗門已不存在');
            }
            assertSectLeader(currentSect, playerId);
            if (roleId === 'leader' || roleId === 'supreme_elder') {
                throw new BadRequestException('宗主與太上長老固定擁有全部職位權限');
            }
            const rollback = captureSectMembershipRollback(this, [currentSect.sectId], []);
            const beforeSnapshots = rollback.sects.map((entry) => entry.snapshot);
            try {
                const rolePermissions = normalizeSectRolePermissions(currentSect.rolePermissions);
                const nextRolePermissions = rolePermissions[roleId] ?? {};
                nextRolePermissions[permissionId] = !nextRolePermissions[permissionId];
                rolePermissions[roleId] = nextRolePermissions;
                currentSect.rolePermissions = rolePermissions;
                advanceSectUpdatedAt(currentSect);
                await this.commitDurableSectMembershipMutation(beforeSnapshots, new Map());
                const roleName = getSectRoleLabel(roleId);
                queueStructuredSectNotice(deps, playerId, 'success', 'notice.sect.permission-updated', `${roleName}權限已更新。`, {
                    vars: { roleName },
                });
            }
            catch (error) {
                restoreSectMembershipRollback(this, rollback);
                throw error;
            }
        });
    }

    clearPlayerSectIdIfLoaded(playerId, sectId) {
        const loaded = this.playerRuntimeService.getPlayer?.(playerId);
        if (!loaded || normalizeOptionalString(loaded.sectId) !== sectId) {
            return;
        }
        if (typeof this.playerRuntimeService.setPlayerSectId === 'function') {
            this.playerRuntimeService.setPlayerSectId(playerId, null);
        } else {
            loaded.sectId = null;
        }
    }

    expandSectBounds(sect, dirs, deps) {
        if (this.isSectMutationBlocked()) {
            return false;
        }
        if (!sect || !dirs || typeof dirs !== 'object') {
            return false;
        }
        const sectId = normalizeOptionalString(sect.sectId);
        const hasRequestedExpansion = ['left', 'right', 'up', 'down']
            .some((key) => Math.max(0, Math.trunc(Number(dirs[key]) || 0)) > 0);
        if (!sectId || !hasRequestedExpansion) {
            return false;
        }
        if (!this.sectMutationQueueBySectId.has(sectId)) {
            return this.expandSectBoundsLocked(sect, dirs, deps);
        }
        void this.runExclusiveSectPlayerMutation([sectId], [], () => {
            const currentSect = this.findSectById(sectId);
            return currentSect ? this.expandSectBoundsLocked(currentSect, dirs, deps) : false;
        }).catch((error) => {
            this.logger.warn(`宗門邊界擴張排隊失敗 sectId=${sectId}：${error instanceof Error ? error.message : String(error)}`);
        });
        return true;
    }

    expandSectBoundsLocked(sect, dirs, deps) {
        if (this.isSectMutationBlocked()) {
            return false;
        }
        const previousBounds = normalizeSectBounds(sect);
        const nextBounds = {
            minX: previousBounds.minX - Math.max(0, Math.trunc(Number(dirs.left) || 0)),
            maxX: previousBounds.maxX + Math.max(0, Math.trunc(Number(dirs.right) || 0)),
            minY: previousBounds.minY - Math.max(0, Math.trunc(Number(dirs.up) || 0)),
            maxY: previousBounds.maxY + Math.max(0, Math.trunc(Number(dirs.down) || 0)),
        };
        if (nextBounds.minX === previousBounds.minX
            && nextBounds.maxX === previousBounds.maxX
            && nextBounds.minY === previousBounds.minY
            && nextBounds.maxY === previousBounds.maxY) {
            return false;
        }
        sect.mapMinX = nextBounds.minX;
        sect.mapMaxX = nextBounds.maxX;
        sect.mapMinY = nextBounds.minY;
        sect.mapMaxY = nextBounds.maxY;
        sect.expansionRadius = Math.max(
            Math.abs(nextBounds.minX),
            Math.abs(nextBounds.maxX),
            Math.abs(nextBounds.minY),
            Math.abs(nextBounds.maxY),
        );
        advanceSectUpdatedAt(sect);
        this.refreshSectTemplateForBounds(sect, deps);
        const sectInstance = deps.getInstanceRuntime(sect.sectInstanceId);
        if (sectInstance) {
            const entranceInstance = deps.getInstanceRuntime(sect.entranceInstanceId);
            if (entranceInstance) {
                this.ensureSectPortalsAttached(sect, entranceInstance, sectInstance);
            }
        }
        this.persistSectsSoon();
        return true;
    }

    expandSectForDestroyedTile(instanceId, x, y, deps) {
        if (this.isSectMutationBlocked()) {
            return false;
        }
        const target = this.resolveDestroyedTileSectExpansionTarget(instanceId, x, y, deps);
        if (!target) {
            return false;
        }
        if (!this.sectMutationQueueBySectId.has(target.sect.sectId)) {
            return this.expandSectForDestroyedTileLocked(instanceId, x, y, deps);
        }
        void this.runExclusiveSectPlayerMutation([target.sect.sectId], [], () => (
            this.expandSectForDestroyedTileLocked(instanceId, x, y, deps)
        )).catch((error) => {
            this.logger.warn(`宗門地塊擴張排隊失敗 sectId=${target.sect.sectId}：${error instanceof Error ? error.message : String(error)}`);
        });
        return true;
    }

    resolveDestroyedTileSectExpansionTarget(instanceId, x, y, deps) {
        const sect = this.findSectByInstanceId(instanceId);
        if (!sect) {
            return null;
        }
        const instance = deps.getInstanceRuntime?.(sect.sectInstanceId);
        if (!instance || instance.meta?.instanceId !== instanceId) {
            return null;
        }
        const tx = Math.trunc(Number(x));
        const ty = Math.trunc(Number(y));
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
            return null;
        }
        const tileState = typeof instance.getTileCombatState === 'function'
            ? instance.getTileCombatState(tx, ty)
            : null;
        const openedBoundaryFloor = tileState === null
            && typeof instance.getEffectiveTileType === 'function'
            && instance.getEffectiveTileType(tx, ty) === TileType.Floor
            && typeof instance.getTileLayerState === 'function'
            && (instance.getTileLayerState(tx, ty)?.structure ?? null) === null;
        const destroyedBoundaryStone = tileState?.destroyed === true && tileState?.tileType === TileType.Stone;
        if (!destroyedBoundaryStone && !openedBoundaryFloor) {
            return null;
        }
        if (!isRuntimeBoundaryTile(instance, tx, ty)) {
            return null;
        }
        return { sect, instance, tx, ty };
    }

    expandSectForDestroyedTileLocked(instanceId, x, y, deps) {
        if (this.isSectMutationBlocked()) {
            return false;
        }
        const target = this.resolveDestroyedTileSectExpansionTarget(instanceId, x, y, deps);
        if (!target) {
            return false;
        }
        const { sect, instance, tx, ty } = target;
        const previousBounds = normalizeSectBounds(sect);
        forEachRuntimeBoundaryGap(instance, tx, ty, (gapX, gapY) => {
            updateSectRuntimeBoundsForTile(sect, gapX, gapY);
        });
        const nextBounds = normalizeSectBounds(sect);
        if (areSectBoundsEqual(previousBounds, nextBounds)) {
            return false;
        }
        advanceSectUpdatedAt(sect);
        this.refreshSectTemplateForBounds(sect, deps);
        markSectExpansionTilesForSync(instance, previousBounds, nextBounds, tx, ty);
        const entranceInstance = deps.getInstanceRuntime?.(sect.entranceInstanceId);
        if (entranceInstance) {
            this.ensureSectPortalsAttached(sect, entranceInstance, instance);
        }
        this.persistSectsSoon();
        queueStructuredSectNotice(deps, sect.leaderPlayerId, 'info', 'notice.sect.boundary-expanded', `${sect.name}邊界被鑿開，地脈向外擴展了。`, {
            vars: { sectName: sect.name },
            pills: [{ key: 'sectName', style: 'target' }],
        });
        return true;
    }

    expandSect(sect, deps) {
        const expanded = this.expandSectBounds(sect, {
            left: SECT_EXPAND_CHUNK,
            right: SECT_EXPAND_CHUNK,
            up: SECT_EXPAND_CHUNK,
            down: SECT_EXPAND_CHUNK,
        }, deps);
        if (expanded) {
            queueStructuredSectNotice(deps, sect.leaderPlayerId, 'info', 'notice.sect.terrain-manifested', '宗門地脈已向四方顯化。');
        }
        return expanded;
    }

    isSectInnateStabilized(instanceId, x, y) {
        const sect = this.findSectByInstanceId(instanceId);
        if (!sect) {
            return false;
        }
        return Math.abs(Math.trunc(Number(x)) - sect.coreX) <= SECT_INNATE_STABILIZER_RADIUS
            && Math.abs(Math.trunc(Number(y)) - sect.coreY) <= SECT_INNATE_STABILIZER_RADIUS;
    }

    buildSectMemberCountLeaderboard(limit = 10, excludedPlayerIds = new Set()) {
        const effectiveLimit = Number.isFinite(Number(limit))
            ? Math.max(1, Math.floor(Number(limit)))
            : 10;
        const excluded = excludedPlayerIds instanceof Set
            ? excludedPlayerIds
            : new Set(Array.isArray(excludedPlayerIds) ? excludedPlayerIds : []);
        return Array.from(this.sectsById.values())
            .filter((sect) => sect?.status === 'active')
            .map((sect) => {
                ensureSectState(sect, this.playerRuntimeService);
                const visibleMembers = Array.isArray(sect.members)
                    ? sect.members.filter((member) => !excluded.has(member.playerId))
                    : [];
                const leader = visibleMembers.find((member) => member.playerId === sect.leaderPlayerId) ?? visibleMembers[0] ?? null;
                return {
                    rank: 0,
                    sectId: sect.sectId,
                    sectName: resolvePlayerFacingContentName(sect.sectId, '未知宗門', sect.name),
                    mark: normalizeOptionalString(sect.mark),
                    memberCount: visibleMembers.length,
                    leaderPlayerId: normalizeOptionalString(leader?.playerId),
                    leaderName: resolvePlayerDisplayName(leader ?? { playerId: sect.leaderPlayerId }, '未知宗主'),
                    createdAt: Number.isFinite(Number(sect.createdAt)) ? Number(sect.createdAt) : 0,
                };
            })
            .filter((entry) => entry.memberCount > 0)
            .sort((left, right) => (right.memberCount - left.memberCount
                || left.createdAt - right.createdAt
                || left.sectName.localeCompare(right.sectName, 'zh-Hans-CN')
                || left.sectId.localeCompare(right.sectId)))
            .slice(0, effectiveLimit)
            .map((entry, index) => ({
                rank: index + 1,
                sectId: entry.sectId,
                sectName: entry.sectName,
                mark: entry.mark,
                memberCount: entry.memberCount,
                leaderPlayerId: entry.leaderPlayerId,
                leaderName: entry.leaderName,
            }));
    }

    findSectById(sectId) {
        const normalized = normalizeOptionalString(sectId);
        return normalized ? this.sectsById.get(normalized) ?? null : null;
    }

    findSectLedByPlayer(playerId) {
        const normalized = normalizeOptionalString(playerId);
        if (!normalized) {
            return null;
        }
        for (const sect of this.sectsById.values()) {
            if (sect.status === 'dissolved') {
                continue;
            }
            if (normalizeOptionalString(sect.leaderPlayerId) === normalized) {
                return sect;
            }
            if (Array.isArray(sect.members)
                && sect.members.some((entry) => entry?.playerId === normalized && entry?.roleId === 'leader')) {
                return sect;
            }
        }
        return null;
    }

    findSectByInstanceId(instanceId) {
        const normalized = normalizeOptionalString(instanceId);
        if (!normalized) {
            return null;
        }
        for (const sect of this.sectsById.values()) {
            if (sect.sectInstanceId === normalized) {
                return sect;
            }
        }
        return null;
    }

    /**
     * 查询职位权限在指定宗门实例是否生效。
     * 非宗门实例返回 null，调用方应继续使用自身领域的原有权限规则。
     */
    resolveSectInstancePermission(playerId, instanceId, permissionId) {
        const sect = this.findSectByInstanceId(instanceId);
        if (!sect || sect.status === 'dissolved') {
            return null;
        }
        ensureSectState(sect, this.playerRuntimeService);
        return hasSectPermission(sect, playerId, permissionId);
    }

    findSectByTemplateId(templateId) {
        const normalized = normalizeOptionalString(templateId);
        if (!normalized) {
            return null;
        }
        const parsed = parseSectTemplateDescriptor(normalized);
        for (const sect of this.sectsById.values()) {
            if (sect.sectTemplateId === normalized || (parsed?.sectId && sect.sectId === parsed.sectId)) {
                return sect;
            }
        }
        return null;
    }

    resolvePlayerSectId(playerId) {
        const normalizedPlayerId = normalizeOptionalString(playerId);
        if (!normalizedPlayerId) {
            return null;
        }
        const runtimePlayer = this.playerRuntimeService.getPlayer?.(normalizedPlayerId) ?? null;
        const runtimeSectId = normalizeOptionalString(runtimePlayer?.sectId);
        if (runtimeSectId) {
            const runtimeSect = this.findSectById(runtimeSectId);
            if (runtimeSect && runtimeSect.status !== 'dissolved' && isSectMember(runtimeSect, normalizedPlayerId)) {
                this.playerSectId.set(normalizedPlayerId, runtimeSectId);
                return runtimeSectId;
            }
        }
        const mappedSectId = normalizeOptionalString(this.playerSectId.get(normalizedPlayerId));
        if (mappedSectId) {
            const mappedSect = this.findSectById(mappedSectId);
            if (mappedSect && mappedSect.status !== 'dissolved' && isSectMember(mappedSect, normalizedPlayerId)) {
                return mappedSectId;
            }
            this.playerSectId.delete(normalizedPlayerId);
        }
        for (const sect of this.sectsById.values()) {
            if (sect.status === 'dissolved' || !isSectMember(sect, normalizedPlayerId)) {
                continue;
            }
            this.playerSectId.set(normalizedPlayerId, sect.sectId);
            return sect.sectId;
        }
        return null;
    }

    reconcilePlayerSectId(playerId) {
        const normalizedPlayerId = normalizeOptionalString(playerId);
        if (!normalizedPlayerId) {
            return null;
        }
        const sectId = this.resolvePlayerSectId(normalizedPlayerId);
        const runtimePlayer = this.playerRuntimeService.getPlayer?.(normalizedPlayerId) ?? null;
        if (runtimePlayer && sectId && normalizeOptionalString(runtimePlayer.sectId) !== sectId) {
            if (typeof this.playerRuntimeService.setPlayerSectId === 'function') {
                this.playerRuntimeService.setPlayerSectId(normalizedPlayerId, sectId);
            } else {
                runtimePlayer.sectId = sectId;
            }
        }
        return sectId;
    }

    /** 记录已水合玩家的轻量资料，供其完全离线后继续展示宗门成员信息。 */
    rememberSectMemberRuntimeProfile(player) {
        const playerId = normalizeOptionalString(player?.playerId ?? player?.id);
        if (!playerId) {
            return;
        }
        const previous = this.sectMemberProfilesByPlayerId.get(playerId) ?? { name: null, realmLv: null };
        const name = resolveOptionalSectMemberName(player, playerId) ?? previous.name;
        const realmLv = resolveSectMemberRealmLv(player) ?? previous.realmLv;
        if (name || realmLv !== null) {
            this.sectMemberProfilesByPlayerId.set(playerId, { name, realmLv });
        }
    }

    /** 仅保留仍属于成员或待审批申请人的缓存，避免长时间运行后累积历史玩家。 */
    releaseSectMemberProfileIfUnused(playerId) {
        const normalizedPlayerId = normalizeOptionalString(playerId);
        if (!normalizedPlayerId) {
            return;
        }
        for (const sect of this.sectsById.values()) {
            if (sect?.status === 'dissolved') {
                continue;
            }
            if (Array.isArray(sect?.members)
                && sect.members.some((member) => member?.playerId === normalizedPlayerId)) {
                return;
            }
            if (Array.isArray(sect?.applications)
                && sect.applications.some((application) => application?.playerId === normalizedPlayerId && application?.status === 'pending')) {
                return;
            }
        }
        this.sectMemberProfilesByPlayerId.delete(normalizedPlayerId);
    }

    /**
     * 启动恢复时批量水合宗门成员资料。
     * 身份与境界通过一个低频读模型一次取回，不在 tick 或成员循环中逐条访问数据库。
     */
    async hydrateSectMemberProfiles(sectsInput) {
        const sects = (Array.isArray(sectsInput) ? sectsInput : []).filter(Boolean);
        const playerIds = new Set<string>();
        for (const sect of sects) {
            for (const member of Array.isArray(sect?.members) ? sect.members : []) {
                const playerId = normalizeOptionalString(member?.playerId);
                if (playerId) playerIds.add(playerId);
            }
            for (const application of Array.isArray(sect?.applications) ? sect.applications : []) {
                if (application?.status !== 'pending') {
                    continue;
                }
                const playerId = normalizeOptionalString(application?.playerId);
                if (playerId) playerIds.add(playerId);
            }
        }
        const normalizedPlayerIds = [...playerIds];
        if (normalizedPlayerIds.length === 0) {
            return;
        }

        const profileResult = await this.loadPersistedSectMemberProfiles(normalizedPlayerIds).catch((error) => {
            this.logger.warn(`宗門成員資料批量水合失敗：${error instanceof Error ? error.message : String(error)}`);
            return new Map();
        });
        const profiles = profileResult instanceof Map ? profileResult : new Map();

        for (const playerId of normalizedPlayerIds) {
            const previous = this.sectMemberProfilesByPlayerId.get(playerId) ?? { name: null, realmLv: null };
            const persisted = profiles.get(playerId);
            const name = resolveOptionalSectMemberName(persisted, playerId) ?? previous.name;
            const realmLv = resolveSectMemberRealmLv(persisted) ?? previous.realmLv;
            if (name || realmLv !== null) {
                this.sectMemberProfilesByPlayerId.set(playerId, { name, realmLv });
            }
        }

        for (const sect of sects) {
            for (const member of Array.isArray(sect?.members) ? sect.members : []) {
                const runtimePlayer = this.playerRuntimeService?.getPlayer?.(member.playerId) ?? null;
                const profile = resolveSectMemberManagementProfile(
                    member,
                    runtimePlayer,
                    this.sectMemberProfilesByPlayerId,
                );
                member.name = profile.name;
            }
            for (const application of Array.isArray(sect?.applications) ? sect.applications : []) {
                if (application?.status !== 'pending') {
                    continue;
                }
                const runtimePlayer = this.playerRuntimeService?.getPlayer?.(application.playerId) ?? null;
                const profile = resolveSectMemberManagementProfile(
                    application,
                    runtimePlayer,
                    this.sectMemberProfilesByPlayerId,
                );
                application.name = profile.name;
            }
        }
    }

    async loadPersistedSectMemberProfiles(playerIds) {
        const pool = await this.ensurePersistencePool();
        return loadSectMemberProfiles(pool, playerIds);
    }

    async restoreSectTemplates(deps) {
        const document = await this.loadSectDocument();
        const entries = Array.isArray(document?.sects) ? document.sects : [];
        const sects = entries
            .map((entry) => normalizeSectEntry(entry))
            .filter((sect) => sect && sect.status !== 'dissolved');
        this.sectMemberProfilesByPlayerId.clear();
        await this.hydrateSectMemberProfiles(sects);
        for (const sect of sects) {
            ensureSectState(sect, this.playerRuntimeService);
            this.sectsById.set(sect.sectId, sect);
            for (const member of sect.members) {
                this.playerSectId.set(member.playerId, sect.sectId);
            }
            this.registerSectTemplate(sect);
        }
        this.restored = true;
        return this.sectsById.size;
    }

    restoreCatalogSectTemplate(entry) {
        const templateId = normalizeOptionalString(entry?.template_id);
        if (!templateId || !templateId.startsWith(SECT_TEMPLATE_PREFIX)) {
            return false;
        }
        if (this.templateRepository.has(templateId)) {
            return true;
        }
        const parsed = parseSectTemplateDescriptor(templateId);
        if (!parsed) {
            return false;
        }
        const existing = this.findSectById(parsed.sectId);
        const sect = existing ?? {
            sectId: parsed.sectId,
            name: '未知宗門',
            mark: SECT_CORE_CHAR,
            founderPlayerId: '',
            leaderPlayerId: '',
            status: 'active',
            entranceInstanceId: '',
            entranceTemplateId: 'yunlai_town',
            entranceX: 0,
            entranceY: 0,
            sectInstanceId: normalizeOptionalString(entry?.instance_id) || buildSectInstanceId(parsed.sectId),
            sectTemplateId: templateId,
            coreX: SECT_CORE_X,
            coreY: SECT_CORE_Y,
            expansionRadius: Math.max(Math.abs(parsed.bounds.minX), Math.abs(parsed.bounds.maxX), Math.abs(parsed.bounds.minY), Math.abs(parsed.bounds.maxY)),
            mapMinX: parsed.bounds.minX,
            mapMaxX: parsed.bounds.maxX,
            mapMinY: parsed.bounds.minY,
            mapMaxY: parsed.bounds.maxY,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.templateRepository.registerRuntimeMapTemplate(buildSectMapDocument({
            ...sect,
            sectTemplateId: buildSectTemplateId(parsed.sectId),
            mapMinX: parsed.bounds.minX,
            mapMaxX: parsed.bounds.maxX,
            mapMinY: parsed.bounds.minY,
            mapMaxY: parsed.bounds.maxY,
            coreX: SECT_CORE_X,
            coreY: SECT_CORE_Y,
        }));
        return true;
    }

    async restoreSects(deps, options = {}) {
        if (!this.restored) {
            await this.restoreSectTemplates(deps);
        }
        const restoreOptions = options as { ensureGuardianFormations?: boolean; applyRuntimeState?: boolean };
        const ensureGuardianFormations = restoreOptions.ensureGuardianFormations !== false;
        const applyRuntimeState = restoreOptions.applyRuntimeState !== false;
        for (const sect of this.sectsById.values()) {
            this.registerSectTemplate(sect);
            const entranceInstance = deps.getInstanceRuntime(sect.entranceInstanceId);
            const sectInstance = this.ensureSectRuntimeInstance(sect, deps);
            if (applyRuntimeState && !(await prepareSectRuntimeApply(sect, entranceInstance, sectInstance, deps, this.logger))) {
                continue;
            }
            if (applyRuntimeState && entranceInstance) {
                logSectEntranceProtectedPlacementConflict(this.logger, sect, entranceInstance);
            }
            if (applyRuntimeState && sectInstance) {
                syncSectRuntimeDomainTiles(sect, sectInstance);
            }
            if (applyRuntimeState && entranceInstance && sectInstance) {
                this.ensureSectPortalsAttached(sect, entranceInstance, sectInstance);
                if (ensureGuardianFormations) {
                    this.ensureGuardianFormation(sect, deps);
                }
            }
        }
        return this.sectsById.size;
    }

    private _sectPersistTimer: ReturnType<typeof setTimeout> | null = null;

    persistSectsSoon() {
        if (this.isSectMutationBlocked()) return;
        if (this._sectPersistTimer) return;
        this._sectPersistTimer = setTimeout(() => {
            this._sectPersistTimer = null;
            if (this.isSectMutationBlocked()) return;
            void this.saveSectDocument().catch((error) => {
                this.logger.warn(`宗門持久化失敗：${error instanceof Error ? error.message : String(error)}`);
            });
        }, 5000);
    }

    async flushAllNow(_options: { deadlineAt?: number; signal?: AbortSignal } = {}) {
        if (this._sectPersistTimer) {
            clearTimeout(this._sectPersistTimer);
            this._sectPersistTimer = null;
        }
        await this.saveSectDocument({ allowDuringShutdown: true });
    }

    async saveSectDocument(options: { allowDuringShutdown?: boolean } = {}) {
        if (this.unresolvedDurableCommitOutcome) {
            throw new Error('sect_persistence_blocked_by_unresolved_commit');
        }
        if (this.persistenceClosing && options?.allowDuringShutdown !== true) {
            return;
        }
        const lockedSectIds = Array.from(new Set([
            ...this.sectsById.keys(),
            ...this.deletedSectSnapshotsById.keys(),
        ])).sort();
        return this.runExclusiveSectPlayerMutation(lockedSectIds, [], () => (
            this.runExclusiveDurableSectCommit(() => this.saveSectDocumentLocked(lockedSectIds, options))
        ));
    }

    async saveSectDocumentLocked(lockedSectIds, options: { allowDuringShutdown?: boolean } = {}) {
        if (this.unresolvedDurableCommitOutcome) {
            throw new Error('sect_persistence_blocked_by_unresolved_commit');
        }
        if (this.persistenceClosing && options?.allowDuringShutdown !== true) {
            return;
        }
        const pool = await this.ensurePersistencePool();
        if (!pool) {
            return;
        }
        const sects = lockedSectIds.map((sectId) => normalizeSectEntry(this.sectsById.get(sectId)))
            .filter((sect) => sect !== null)
            .sort((left, right) => left.sectId.localeCompare(right.sectId, 'zh-Hans-CN'));
        const deletedSects = lockedSectIds.map((sectId) => normalizeSectEntry(this.deletedSectSnapshotsById.get(sectId)))
            .filter((sect) => sect !== null)
            .sort((left, right) => left.sectId.localeCompare(right.sectId, 'zh-Hans-CN'));
        const client = await pool.connect();
        let commitAttempted = false;
        let clientReleased = false;
        try {
            await client.query('BEGIN');
            await persistSectSnapshotsWithClient(client, sects);
            for (const sect of deletedSects) {
                await client.query(`
                    DELETE FROM ${SECT_TABLE}
                    WHERE sect_id = $1
                      AND updated_at_ms <= $2
                `, [
                    sect.sectId,
                    normalizeIntegerWithDefault(sect.updatedAt, Date.now()),
                ]);
            }
            commitAttempted = true;
            await client.query('COMMIT');
            commitAttempted = false;
            for (const sect of deletedSects) {
                this.deletedSectSnapshotsById.delete(sect.sectId);
            }
        } catch (error) {
            if (commitAttempted) {
                client.release(true);
                clientReleased = true;
            } else {
                try {
                    await client.query('ROLLBACK');
                } catch {
                    client.release(true);
                    clientReleased = true;
                }
            }
            throw error;
        } finally {
            if (!clientReleased) {
                client.release();
            }
        }
    }

    async loadSectDocument() {
        const pool = await this.ensurePersistencePool();
        if (!pool) {
            return null;
        }
        const result = await pool.query(`
            SELECT raw_payload
            FROM ${SECT_TABLE}
            ORDER BY created_at_ms ASC, sect_id ASC
        `);
        const sects = (result.rows ?? [])
            .map((row) => row?.raw_payload)
            .filter((entry) => entry && typeof entry === 'object');
        return sects.length > 0 ? { sects } : null;
    }

    async ensurePersistencePool() {
        if (this.persistenceReady && this.persistencePool) {
            return this.persistencePool;
        }
        if (this.persistenceInitPromise) {
            await this.persistenceInitPromise;
            return this.persistenceReady ? this.persistencePool : null;
        }
        const initPromise = this.initializePersistencePool();
        this.persistenceInitPromise = initPromise;
        try {
            await initPromise;
        } finally {
            if (this.persistenceInitPromise === initPromise) {
                this.persistenceInitPromise = null;
            }
        }
        return this.persistenceReady ? this.persistencePool : null;
    }

    async initializePersistencePool() {
        const databaseUrl = resolveServerDatabaseUrl();
        if (!databaseUrl.trim()) {
            return;
        }
        const sharedPool = this.databasePoolProvider?.getPool?.('sect') ?? null;
        if (!sharedPool) {
            throw new ServiceUnavailableException('宗門持久化連接池不可用');
        }
        try {
            await ensureSectTable(sharedPool);
            const repairReport = await repairPersistedSectCoreState(sharedPool);
            if (repairReport.sectRowsUpdated > 0 || repairReport.overlayRowsUpdated > 0) {
                this.logger.log(`宗門核心座標持久化自愈完成：sects=${repairReport.sectRowsUpdated}, overlays=${repairReport.overlayRowsUpdated}`);
            }
            this.persistencePool = sharedPool;
            this.persistenceReady = true;
            this.persistenceClosing = false;
            this.sectShutdownSignal = createSectShutdownSignal();
            this.unresolvedDurableCommitOutcome = false;
        } catch (error) {
            this.persistencePool = null;
            this.persistenceReady = false;
            this.logger.error(`宗門持久化初始化失敗：${error instanceof Error ? error.stack : String(error)}`);
            throw error;
        }
    }

    async closePersistencePool() {
        this.beginShutdown();
        // 清理 pending persist timer，避免 pool 释放后回调执行报错
        if (this._sectPersistTimer) {
            clearTimeout(this._sectPersistTimer);
            this._sectPersistTimer = null;
        }
        // 共享连接池由 DatabasePoolProvider 统一关闭，此处只释放引用。
        this.persistencePool = null;
        this.persistenceReady = false;
    }

    /** 在关停 drain 等待宗门队列前先让未决 COMMIT 收敛退出。 */
    beginShutdown() {
        this.persistenceClosing = true;
        if (this._sectPersistTimer) {
            clearTimeout(this._sectPersistTimer);
            this._sectPersistTimer = null;
        }
        this.sectShutdownSignal.resolve();
    }

    isSectMutationBlocked() {
        return this.persistenceClosing || this.unresolvedDurableCommitOutcome;
    }

    hasUnresolvedCommitOutcomes() {
        return this.unresolvedDurableCommitOutcome;
    }

    canPlayerMaintainGuardianFormation(playerId, formation) {
        if (!formation || formation.formationId !== 'sect_guardian_barrier') {
            return false;
        }
        const sectId = normalizeOptionalString(formation.ownerSectId);
        if (!sectId) {
            return false;
        }
        const sect = this.sectsById.get(sectId);
        if (!sect || sect.status === 'dissolved') {
            return false;
        }
        ensureSectState(sect, this.playerRuntimeService);
        return isSectMember(sect, playerId);
    }
}
export { WorldRuntimeSectService, repairPersistedSectCoreStateWithClient };

function resolveOptionalSectMemberName(source, playerId) {
    const name = resolvePlayerDisplayName(source, '未知成員');
    return name === normalizeOptionalString(playerId)
        || name === '未知成員' || name === '未知玩家' || name === '未知申請人'
        ? null
        : name;
}

function resolveSectMemberManagementProfile(member, runtimePlayer, profilesByPlayerId) {
    const playerId = normalizeOptionalString(member?.playerId) || '';
    const cached = profilesByPlayerId?.get?.(playerId) ?? null;
    const runtimeName = resolveOptionalSectMemberName(runtimePlayer, playerId);
    const storedName = resolveOptionalSectMemberName(member, playerId);
    const name = runtimeName || cached?.name || storedName || '未知成員';
    const runtimeRealmLv = resolveSectMemberRealmLv(runtimePlayer);
    const cachedRealmLv = resolveSectMemberRealmLv(cached);
    const realmLv = runtimeRealmLv ?? cachedRealmLv;
    if (playerId && profilesByPlayerId?.set && (name !== '未知成員' || realmLv !== null)) {
        profilesByPlayerId.set(playerId, {
            name: name !== '未知成員' ? name : null,
            realmLv,
        });
    }
    return { name, realmLv };
}

function buildSectManagementActionDesc(sect, view, deps, guardian, profilesByPlayerId = null) {
    const sectName = resolvePlayerFacingContentName(sect?.sectId, '未知宗門', sect?.name);
    const base = `${sectName} · 印記 ${normalizeOptionalString(sect.mark) || '無'} · 地域 ${formatSectTileCountLabel(sect, view, deps)} · 大陣 ${formatSectGuardianStatusLabel(guardian)} · 靈力 ${formatSectGuardianAuraLabel(guardian)}。`;
    const data = buildSectManagementData(sect, view?.playerId, deps?.playerRuntimeService, guardian, deps?.worldRuntimeFormationService, profilesByPlayerId);
    return `${base}\n${SECT_MANAGEMENT_DATA_MARKER}${encodeURIComponent(JSON.stringify(data))}${SECT_MANAGEMENT_DATA_MARKER_END}`;
}

function buildSectManagementData(sect, playerId, playerRuntimeService = null, guardian = null, formationService = null, profilesByPlayerId = null) {
    ensureSectState(sect, playerRuntimeService);
    const selfPlayerId = normalizeOptionalString(playerId) || '';
    const canEditPermissions = sect.leaderPlayerId === selfPlayerId;
    const canReviewApplications = hasSectPermission(sect, selfPlayerId, 'member_approve');
    const canChangeRoles = hasSectPermission(sect, selfPlayerId, 'member_role');
    const canLeave = selfPlayerId !== '' && sect.leaderPlayerId !== selfPlayerId && isSectMember(sect, selfPlayerId);
    const selfPlayer = selfPlayerId ? playerRuntimeService?.getPlayer?.(selfPlayerId) : null;
    const selfMember = sect.members.find((member) => member.playerId === selfPlayerId) ?? null;
    const projectedRoles = SECT_ROLES.map((role) => ({
        ...role,
        assignable: role.assignable
            && Boolean(selfMember)
            && isSectMemberRoleLowerThan(role.id, selfMember?.roleId),
    }));
    return {
        v: 4,
        sectId: sect.sectId,
        selfPlayerId,
        canEditPermissions,
        canTransfer: canEditPermissions,
        canDissolve: canEditPermissions,
        canLeave,
        canReviewApplications,
        canManageGuardian: hasSectPermission(sect, selfPlayerId, 'guardian'),
        guardian: buildSectGuardianManagementData(guardian, formationService, selfPlayer),
        canRemoveMembers: hasSectPermission(sect, selfPlayerId, 'member_remove'),
        canChangeRoles,
        roles: projectedRoles,
        permissions: SECT_PERMISSIONS,
        rolePermissions: normalizeSectRolePermissions(sect.rolePermissions),
        members: sect.members.map((member) => {
            const runtimePlayer = playerRuntimeService?.getPlayer?.(member.playerId);
            const profile = resolveSectMemberManagementProfile(member, runtimePlayer, profilesByPlayerId);
            return {
                playerId: member.playerId,
                name: profile.name,
                roleId: member.roleId,
                roleLabel: getSectRoleLabel(member.roleId),
                realmLv: profile.realmLv,
                statusLabel: resolveSectMemberPresenceLabel(runtimePlayer),
                self: member.playerId === selfPlayerId,
                leader: member.playerId === sect.leaderPlayerId,
                canChangeRole: canChangeRoles && canChangeSectMemberRole(sect, selfPlayerId, member),
            };
        }),
        applicationTotal: countPendingSectApplications(sect),
        applicationRevision: normalizeSectApplicationRevision(sect.updatedAt),
    };
}

function buildSectApplicationPageView(sect, payload) {
    const requestId = normalizeSectApplicationPageRequestId(payload?.requestId);
    const search = normalizeSectApplicationPageSearch(payload?.search);
    const offset = normalizeSectApplicationPageOffset(payload?.offset);
    const limit = normalizeSectApplicationPageLimit(payload?.limit);
    const items = [];
    let total = 0;
    for (const application of Array.isArray(sect?.applications) ? sect.applications : []) {
        if (application?.status !== 'pending' || !matchesSectApplicationPageSearch(application, search)) {
            continue;
        }
        if (total >= offset && items.length < limit) {
            items.push({
                playerId: normalizeOptionalString(application.playerId),
                name: resolvePlayerDisplayName({
                    playerId: application.playerId,
                    name: application.name,
                }, '未知申請人'),
                appliedAt: Number.isFinite(Number(application.appliedAt))
                    ? Math.max(0, Math.trunc(Number(application.appliedAt)))
                    : 0,
            });
        }
        total += 1;
    }
    return {
        requestId,
        sectId: sect.sectId,
        search,
        offset,
        limit,
        total,
        revision: normalizeSectApplicationRevision(sect.updatedAt),
        items,
    };
}

function countPendingSectApplications(sect) {
    let total = 0;
    for (const application of Array.isArray(sect?.applications) ? sect.applications : []) {
        if (application?.status === 'pending') {
            total += 1;
        }
    }
    return total;
}

function normalizeSectApplicationRevision(value) {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeSectApplicationPageRequestId(value) {
    const requestId = typeof value === 'string' ? value.trim() : '';
    if (!requestId || requestId.length > 80) {
        throw new BadRequestException('宗門申請分頁請求 ID 無效');
    }
    return requestId;
}

function normalizeSectApplicationPageSearch(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/\s+/g, ' ').trim().slice(0, SECT_APPLICATION_SEARCH_MAX_LENGTH).toLowerCase();
}

function normalizeSectApplicationPageOffset(value) {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeSectApplicationPageLimit(value) {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return SECT_APPLICATION_PAGE_DEFAULT_LIMIT;
    }
    return Math.max(1, Math.min(SECT_APPLICATION_PAGE_MAX_LIMIT, parsed));
}

function matchesSectApplicationPageSearch(application, search) {
    if (!search) {
        return true;
    }
    const playerId = normalizeOptionalString(application?.playerId).toLowerCase();
    const name = normalizeOptionalString(application?.name).toLowerCase();
    return playerId.includes(search) || name.includes(search);
}

const SECT_DIRECTORY_RATE_LIMIT_MAX = 2;
const SECT_DIRECTORY_RATE_LIMIT_WINDOW_MS = 10_000;

function normalizeSectDirectoryPageRequestId(value) {
    const requestId = typeof value === 'string' ? value.trim() : '';
    if (!requestId || requestId.length > 80) {
        throw new BadRequestException('宗門目錄請求 ID 無效');
    }
    return requestId;
}

function normalizeSectDirectoryPageSearch(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/\s+/g, ' ').trim().slice(0, SECT_DIRECTORY_SEARCH_MAX_LENGTH).toLowerCase();
}

function normalizeSectDirectoryPageOffset(value) {
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeSectDirectoryPageLimit(value) {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return SECT_DIRECTORY_PAGE_DEFAULT_LIMIT;
    }
    return Math.max(1, Math.min(SECT_DIRECTORY_PAGE_MAX_LIMIT, parsed));
}

function matchesSectDirectorySearch(sect, search) {
    if (!search) {
        return true;
    }
    return normalizeOptionalString(sect?.name).toLowerCase().includes(search);
}

function resolveSectDirectoryEntranceMapName(templateRepository, mapId) {
    const normalizedMapId = normalizeOptionalString(mapId);
    if (!normalizedMapId) {
        return '';
    }
    try {
        if (typeof templateRepository?.has === 'function' && !templateRepository.has(normalizedMapId)) {
            return normalizedMapId;
        }
        const template = typeof templateRepository?.getOrThrow === 'function'
            ? templateRepository.getOrThrow(normalizedMapId)
            : null;
        const name = typeof template?.name === 'string' ? template.name.trim() : '';
        return name || normalizedMapId;
    } catch {
        return normalizedMapId;
    }
}

function resolveSectDirectoryRelation(sect, playerId) {
    if (normalizeOptionalString(sect?.leaderPlayerId) === playerId || (sect?.members ?? []).some((member) => (
        member?.playerId === playerId && member?.roleId === 'leader'
    ))) {
        return 'leader';
    }
    if (isSectMember(sect, playerId)) {
        return 'member';
    }
    if (findPendingSectApplication(sect, playerId)) {
        return 'pending';
    }
    return 'none';
}

function projectSectDirectoryEntry(sect, context) {
    const playerId = context.playerId;
    const relation = resolveSectDirectoryRelation(sect, playerId);
    const leadsOtherSect = Boolean(context.ledSectId && context.ledSectId !== sect.sectId);
    const canApply = relation === 'none' && !leadsOtherSect;
    const leaderPlayerId = normalizeOptionalString(sect.leaderPlayerId);
    const leaderMember = (sect.members ?? []).find((member) => member?.playerId === leaderPlayerId) ?? null;
    const runtimeLeader = context.playerRuntimeService?.getPlayer?.(leaderPlayerId) ?? null;
    return {
        sectId: normalizeOptionalString(sect.sectId),
        name: normalizeOptionalString(sect.name),
        mark: normalizeOptionalString(sect.mark),
        memberCount: Array.isArray(sect.members) ? sect.members.length : 0,
        leaderPlayerId,
        leaderName: resolvePlayerDisplayName({
            playerId: leaderPlayerId,
            name: runtimeLeader?.name || leaderMember?.name,
        }, '未知宗主'),
        entranceMapName: resolveSectDirectoryEntranceMapName(context.templateRepository, sect.entranceTemplateId),
        entranceX: Number.isFinite(Number(sect.entranceX)) ? Math.trunc(Number(sect.entranceX)) : 0,
        entranceY: Number.isFinite(Number(sect.entranceY)) ? Math.trunc(Number(sect.entranceY)) : 0,
        createdAt: Number.isFinite(Number(sect.createdAt)) ? Math.max(0, Math.trunc(Number(sect.createdAt))) : 0,
        relation,
        canApply,
    };
}

function decodeActionPart(value) {
    try {
        return decodeURIComponent(String(value ?? ''));
    }
    catch (_error) {
        return String(value ?? '');
    }
}

function collectDurableSectAffectedInstanceIds(input, additionalInstanceIds = []) {
    const instanceIds = [...(Array.isArray(additionalInstanceIds) ? additionalInstanceIds : [])];
    for (const write of input?.sectWrites ?? []) {
        if (write?.snapshot) {
            instanceIds.push(write.snapshot.entranceInstanceId, write.snapshot.sectInstanceId);
        }
    }
    for (const write of input?.formationWrites ?? []) {
        instanceIds.push(write?.instanceId, write?.snapshot?.eyeInstanceId);
    }
    return Array.from(new Set(instanceIds.map(normalizeOptionalString).filter(Boolean))).sort();
}

function captureSectCreationRollback(service, playerId, player, entranceInstance, sectInstanceId, deps) {
    return {
        player: captureSectPlayerRollback(player),
        mappedSectId: normalizeOptionalString(service.playerSectId.get(playerId)),
        entranceInstance: captureSectPortalInstanceRollback(entranceInstance),
        sectInstanceExisted: Boolean(deps.getInstanceRuntime?.(sectInstanceId)),
    };
}

function captureSectMembershipRollback(service, sectIds, playerIds) {
    const sects = [];
    for (const sectId of Array.from(new Set(sectIds ?? []))) {
        const sect = service.findSectById(sectId);
        const snapshot = normalizeSectEntry(sect);
        if (snapshot) {
            sects.push({ sect, snapshot });
        }
    }
    const players = [];
    for (const playerId of Array.from(new Set(playerIds ?? []))) {
        const player = service.playerRuntimeService.getPlayer?.(playerId) ?? null;
        players.push({
            playerId,
            player,
            rollback: player ? captureSectPlayerRollback(player) : null,
            mappedSectId: normalizeOptionalString(service.playerSectId.get(playerId)),
        });
    }
    return { sects, players };
}

function restoreSectMembershipRollback(service, rollback) {
    for (const entry of rollback.sects) {
        for (const key of Object.keys(entry.sect)) {
            delete entry.sect[key];
        }
        Object.assign(entry.sect, entry.snapshot);
        service.sectsById.set(entry.snapshot.sectId, entry.sect);
        service.deletedSectSnapshotsById.delete(entry.snapshot.sectId);
    }
    for (const entry of rollback.players) {
        if (entry.player && entry.rollback) {
            restoreSectPlayerRollback(
                entry.playerId,
                entry.player,
                entry.rollback,
                service.playerRuntimeService,
            );
        }
        if (entry.mappedSectId) {
            service.playerSectId.set(entry.playerId, entry.mappedSectId);
        } else {
            service.playerSectId.delete(entry.playerId);
        }
    }
}

async function restoreSectCreationRollback(input) {
    const formationId = `formation:sect_guardian:${input.sectId}`;
    input.deps.worldRuntimeFormationService?.removeFormationFromInstance?.(
        input.entranceInstance?.meta?.instanceId,
        formationId,
        input.deps,
        { deferPersistence: true },
    );
    restoreSectPortalInstanceRollback(input.entranceInstance, input.rollback.entranceInstance);
    if (!input.rollback.sectInstanceExisted) {
        try {
            const destroyed = await destroyManagedInstance(input.deps, input.instanceId, 'sect_creation_rollback');
            if (destroyed?.ok !== true && destroyed?.reason !== 'instance_not_found') {
                input.service.logger.warn(`建宗失敗後的實例銷燬被拒絕：${input.instanceId} reason=${destroyed?.reason ?? 'unknown'}`);
            }
        } catch (error) {
            input.service.logger.warn(`建宗失敗後的實例銷燬異常：${input.instanceId} ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    input.service.sectsById.delete(input.sectId);
    restoreSectPlayerRollback(input.playerId, input.player, input.rollback.player, input.service.playerRuntimeService);
    if (input.rollback.mappedSectId) {
        input.service.playerSectId.set(input.playerId, input.rollback.mappedSectId);
    } else {
        input.service.playerSectId.delete(input.playerId);
    }
}

function captureSectRelocationRollback(input) {
    const instances = [];
    const seen = new Set();
    for (const instance of [input.previousEntranceInstance, input.entranceInstance, input.sectInstance]) {
        const instanceId = normalizeOptionalString(instance?.meta?.instanceId);
        if (!instanceId || seen.has(instanceId)) {
            continue;
        }
        seen.add(instanceId);
        instances.push({ instance, rollback: captureSectPortalInstanceRollback(instance) });
    }
    return {
        player: captureSectPlayerRollback(input.player),
        sect: normalizeSectEntry(input.sect),
        instances,
        previousGuardian: cloneSectGuardian(input.previousGuardian),
    };
}

function restoreSectRelocationRollback(input) {
    const snapshot = input.rollback.sect;
    if (snapshot) {
        for (const key of Object.keys(input.sect)) {
            delete input.sect[key];
        }
        Object.assign(input.sect, snapshot);
        input.service.sectsById.set(snapshot.sectId, input.sect);
    }
    restoreSectPlayerRollback(input.playerId, input.player, input.rollback.player, input.service.playerRuntimeService);
    for (const entry of input.rollback.instances) {
        restoreSectPortalInstanceRollback(entry.instance, entry.rollback);
    }
    const formationId = `formation:sect_guardian:${input.sect.sectId}`;
    for (const entry of input.rollback.instances) {
        input.deps.worldRuntimeFormationService?.removeFormationFromInstance?.(
            entry.instance?.meta?.instanceId,
            formationId,
            input.deps,
            { deferPersistence: true },
        );
    }
    if (input.rollback.previousGuardian && snapshot) {
        input.service.ensureGuardianFormation(snapshot, input.deps, input.rollback.previousGuardian, { deferPersistence: true });
    }
}

function captureSectPlayerRollback(player) {
    return {
        sectId: normalizeOptionalString(player?.sectId),
        inventoryItems: Array.isArray(player?.inventory?.items)
            ? player.inventory.items.map((item) => ({ ...item }))
            : [],
        inventoryRevision: Math.max(0, Math.trunc(Number(player?.inventory?.revision ?? 0))),
        persistentRevision: Math.max(0, Math.trunc(Number(player?.persistentRevision ?? 0))),
        persistedRevision: Math.max(0, Math.trunc(Number(player?.persistedRevision ?? 0))),
        selfRevision: Math.max(0, Math.trunc(Number(player?.selfRevision ?? 0))),
        dirtyDomains: player?.dirtyDomains instanceof Set ? Array.from(player.dirtyDomains) : [],
    };
}

function restoreSectPlayerRollback(playerId, player, rollback, playerRuntimeService) {
    playerRuntimeService.replaceInventoryItems?.(playerId, rollback.inventoryItems);
    player.inventory.revision = rollback.inventoryRevision;
    player.sectId = rollback.sectId;
    player.persistentRevision = rollback.persistentRevision;
    player.persistedRevision = rollback.persistedRevision;
    player.selfRevision = rollback.selfRevision;
    player.dirtyDomains = new Set(rollback.dirtyDomains);
}

function captureSectPortalInstanceRollback(instance) {
    if (!instance) {
        return null;
    }
    return {
        runtimePortals: Array.isArray(instance.runtimePortals)
            ? instance.runtimePortals.map((portal) => ({ ...portal }))
            : [],
        worldRevision: Math.max(0, Math.trunc(Number(instance.worldRevision ?? 0))),
        persistentRevision: Math.max(0, Math.trunc(Number(instance.persistentRevision ?? 0))),
        dirtyDomains: instance.dirtyDomains instanceof Set ? Array.from(instance.dirtyDomains) : [],
    };
}

function restoreSectPortalInstanceRollback(instance, rollback) {
    if (!instance || !rollback) {
        return;
    }
    instance.runtimePortals = rollback.runtimePortals.map((portal) => ({ ...portal }));
    instance.worldRevision = rollback.worldRevision;
    instance.persistentRevision = rollback.persistentRevision;
    instance.dirtyDomains = new Set(rollback.dirtyDomains);
    instance.markAoiViewChangedGlobally?.();
}

function cloneSectGuardian(formation) {
    if (!formation || typeof formation !== 'object') {
        return null;
    }
    return {
        ...formation,
        allocation: formation.allocation && typeof formation.allocation === 'object'
            ? { ...formation.allocation }
            : formation.allocation,
        stats: formation.stats && typeof formation.stats === 'object'
            ? { ...formation.stats }
            : formation.stats,
    };
}

function removeSectRuntimePortals(instance, sectId) {
    if (!instance || !Array.isArray(instance.runtimePortals)) {
        return false;
    }
    const removedPortals = instance.runtimePortals.filter((portal) => portal?.sectId === sectId);
    if (removedPortals.length === 0) {
        return false;
    }
    instance.runtimePortals = instance.runtimePortals.filter((portal) => portal?.sectId !== sectId);
    for (const portal of removedPortals) {
        instance.markAoiViewChangedAt?.(portal.x, portal.y);
    }
    instance.worldRevision += 1;
    instance.persistentRevision += 1;
    instance.markPersistenceDirtyDomains?.(['overlay']);
    return true;
}

function hasExpectedSectRuntimePortal(instance, expected) {
    if (!instance || !Array.isArray(instance.runtimePortals)) {
        return false;
    }
    return instance.runtimePortals.some((portal) => portal?.sectId === expected.sectId
        && portal?.kind === expected.kind
        && portal?.trigger === 'manual'
        && Math.trunc(Number(portal?.x)) === Math.trunc(Number(expected.x))
        && Math.trunc(Number(portal?.y)) === Math.trunc(Number(expected.y))
        && normalizeOptionalString(portal?.targetMapId) === normalizeOptionalString(expected.targetMapId)
        && normalizeOptionalString(portal?.targetInstanceId) === normalizeOptionalString(expected.targetInstanceId)
        && Math.trunc(Number(portal?.targetX)) === Math.trunc(Number(expected.targetX))
        && Math.trunc(Number(portal?.targetY)) === Math.trunc(Number(expected.targetY)));
}

function syncSectRuntimeDomainTiles(sect, instance) {
    if (!sect || !instance || typeof instance.activateRuntimeTile !== 'function') {
        return false;
    }
    const bounds = normalizeSectBounds(sect);
    let changed = false;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
            const tileType = Math.abs(x - SECT_CORE_X) <= SECT_BASE_CLEAR_RADIUS
                && Math.abs(y - SECT_CORE_Y) <= SECT_BASE_CLEAR_RADIUS
                ? TileType.Floor
                : TileType.Stone;
            const activated = instance.activateRuntimeTile(x, y, tileType);
            if (activated?.created === true && activated.tileIndex >= 0 && typeof instance.markStaticTileSyncDirtyByIndex === 'function') {
                instance.markStaticTileSyncDirtyByIndex(activated.tileIndex, { sightBlockingChanged: activated.created === true && tileType === TileType.Stone });
            }
            if (activated?.created === true) {
                changed = true;
            }
        }
    }
    return changed;
}

function buildSectMapDocument(sect) {
    const bounds = normalizeSectBounds(sect);
    return {
        id: resolveSectTemplateIdForBounds(sect.sectId, sect.sectTemplateId, bounds),
        name: sect.name,
        width: 1,
        height: 1,
        routeDomain: `sect:${sect.sectId}`,
        terrainProfileId: 'sect_stone_domain',
        mapLv: 1,
        sectMap: true,
        sectId: sect.sectId,
        sectMark: normalizeOptionalString(sect.mark) || SECT_CORE_CHAR,
        sectCoreX: SECT_CORE_X,
        sectCoreY: SECT_CORE_Y,
        sectMapMinX: bounds.minX,
        sectMapMaxX: bounds.maxX,
        sectMapMinY: bounds.minY,
        sectMapMaxY: bounds.maxY,
        tiles: ['P'],
        spawnPoint: { x: SECT_CORE_X, y: SECT_CORE_Y },
        portals: [],
        npcs: [],
        monsters: [],
        safeZones: [],
        landmarks: [],
        containers: [],
        auras: [],
    };
}

function normalizeSectEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const sectId = normalizeOptionalString(entry.sectId);
    const leaderPlayerId = normalizeOptionalString(entry.leaderPlayerId);
    const entranceInstanceId = normalizeOptionalString(entry.entranceInstanceId);
    const sectInstanceId = normalizeOptionalString(entry.sectInstanceId);
    if (!sectId || !leaderPlayerId || !entranceInstanceId || !sectInstanceId) {
        return null;
    }
    const parsedTemplate = parseSectTemplateDescriptor(normalizeOptionalString(entry.sectTemplateId) || '');
    const fallbackRadius = Math.max(1, Math.trunc(Number(entry.expansionRadius) || 1));
    const fallbackBounds = parsedTemplate?.bounds ?? {
        minX: -fallbackRadius,
        maxX: fallbackRadius,
        minY: -fallbackRadius,
        maxY: fallbackRadius,
    };
    const bounds = normalizeBoundsObject({
        minX: entry.mapMinX,
        maxX: entry.mapMaxX,
        minY: entry.mapMinY,
        maxY: entry.mapMaxY,
    }) ?? fallbackBounds;
    const templateId = resolveSectTemplateIdForBounds(sectId, entry.sectTemplateId, bounds);
    const sectName = resolvePlayerFacingContentName(sectId, '未知宗門', entry.name);
    const leaderName = resolvePlayerDisplayName(null, normalizeOptionalString(entry.leaderName) || leaderPlayerId);
        return {
            sectId,
            name: sectName,
            mark: normalizeSectMark(entry.mark, sectName),
            founderPlayerId: normalizeOptionalString(entry.founderPlayerId) || leaderPlayerId,
        leaderPlayerId,
        status: entry.status === 'dissolved' || entry.status === 'locked' ? entry.status : 'active',
        entranceInstanceId,
        entranceTemplateId: normalizeOptionalString(entry.entranceTemplateId) || 'yunlai_town',
        entranceX: Math.trunc(Number(entry.entranceX) || 0),
        entranceY: Math.trunc(Number(entry.entranceY) || 0),
        sectInstanceId,
        sectTemplateId: templateId,
        coreX: SECT_CORE_X,
        coreY: SECT_CORE_Y,
        expansionRadius: Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY)),
        mapMinX: bounds.minX,
        mapMaxX: bounds.maxX,
        mapMinY: bounds.minY,
        mapMaxY: bounds.maxY,
        members: normalizeSectMembers(entry.members, {
            sectId,
            leaderPlayerId,
            leaderName,
            createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
        }),
        applications: normalizeSectApplications(entry.applications, normalizeSectMembers(entry.members, {
            sectId,
            leaderPlayerId,
            leaderName,
            createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
        })),
        rolePermissions: normalizeSectRolePermissions(entry.rolePermissions),
        lastEntranceRelocatedAt: normalizeIntegerWithDefault(entry.lastEntranceRelocatedAt, 0),
        entranceRelocationCooldownUntil: normalizeIntegerWithDefault(entry.entranceRelocationCooldownUntil, 0),
        createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
        updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : Date.now(),
    };
}

function buildInitialSectBounds() {
    const radius = SECT_BASE_CLEAR_RADIUS + SECT_INITIAL_STONE_MARGIN;
    return { minX: -radius, maxX: radius, minY: -radius, maxY: radius };
}

function normalizeSectBounds(sect) {
    const parsedTemplate = parseSectTemplateDescriptor(normalizeOptionalString(sect?.sectTemplateId) || '');
    const fallbackRadius = Math.max(SECT_BASE_CLEAR_RADIUS + SECT_INITIAL_STONE_MARGIN, Math.trunc(Number(sect?.expansionRadius) || 0));
    return normalizeBoundsObject({
        minX: sect?.mapMinX,
        maxX: sect?.mapMaxX,
        minY: sect?.mapMinY,
        maxY: sect?.mapMaxY,
    }) ?? parsedTemplate?.bounds ?? {
        minX: -fallbackRadius,
        maxX: fallbackRadius,
        minY: -fallbackRadius,
        maxY: fallbackRadius,
    };
}

function normalizeBoundsObject(input) {
    if (!input || typeof input !== 'object') {
        return null;
    }
    const minX = Math.trunc(Number(input.minX));
    const maxX = Math.trunc(Number(input.maxX));
    const minY = Math.trunc(Number(input.minY));
    const maxY = Math.trunc(Number(input.maxY));
    if (![minX, maxX, minY, maxY].every(Number.isFinite) || minX > maxX || minY > maxY) {
        return null;
    }
    return { minX, maxX, minY, maxY };
}

function parseSectTemplateDescriptor(templateId) {
    const normalized = normalizeOptionalString(templateId);
    if (!normalized || !normalized.startsWith(SECT_TEMPLATE_PREFIX)) {
        return null;
    }
    const body = normalized.slice(SECT_TEMPLATE_PREFIX.length);
    const boundsMatch = /:x(-?\d+)_(-?\d+):y(-?\d+)_(-?\d+)$/.exec(body);
    if (boundsMatch) {
        const sectId = body.slice(0, boundsMatch.index);
        const bounds = normalizeBoundsObject({
            minX: boundsMatch[1],
            maxX: boundsMatch[2],
            minY: boundsMatch[3],
            maxY: boundsMatch[4],
        });
        return sectId && bounds ? { sectId, bounds } : null;
    }
    const radiusMatch = /:r(\d+)$/.exec(body);
    if (radiusMatch) {
        const sectId = body.slice(0, radiusMatch.index);
        const radius = Math.max(1, Math.trunc(Number(radiusMatch[1]) || 1));
        return sectId ? { sectId, bounds: { minX: -radius, maxX: radius, minY: -radius, maxY: radius } } : null;
    }
    return body ? { sectId: body, bounds: buildInitialSectBounds() } : null;
}

function formatSectTileCountLabel(sect, view, deps) {
    const instanceId = normalizeOptionalString(view?.instance?.instanceId) || normalizeOptionalString(sect?.sectInstanceId);
    const instance = instanceId && typeof deps?.getInstanceRuntime === 'function'
        ? deps.getInstanceRuntime(instanceId)
        : null;
    const count = getRuntimeTileCount(instance);
    if (count > 0) {
        return `${count}格`;
    }
    const bounds = normalizeSectBounds(sect);
    return `${Math.max(0, (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1))}格`;
}

function getRuntimeTileCount(instance) {
    if (!instance) {
        return 0;
    }
    if (instance.tilePlane && typeof instance.tilePlane.getCellCount === 'function') {
        return Math.max(0, Math.trunc(Number(instance.tilePlane.getCellCount()) || 0));
    }
    if (typeof instance.forEachRuntimeTile === 'function') {
        let count = 0;
        instance.forEachRuntimeTile(() => { count += 1; });
        return count;
    }
    return 0;
}

function assertCanCreateSectAtInstance(instance, descriptor) {
    const meta = instance?.meta ?? {};
    const kind = normalizeOptionalString(meta.kind ?? instance?.kind);
    const linePreset = normalizeOptionalString(meta.linePreset ?? instance?.linePreset ?? descriptor?.linePreset);
    if (kind === 'public' && linePreset === 'real') {
        return;
    }
    throw new BadRequestException('只能在大地圖現世線建立宗門。');
}

function assertSectFoundingAreaClear(sects, instance, instanceId, centerX, centerY, ignoredSectId = null) {
    const x0 = Math.trunc(Number(centerX));
    const y0 = Math.trunc(Number(centerY));
    const ignored = normalizeOptionalString(ignoredSectId);
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) {
        throw new BadRequestException('當前位置無法開闢宗門入口');
    }
    const conflict = findProtectedPlacementConflict(
        instance,
        iterateSquareProtectedPlacementPoints(x0, y0, SECT_FOUNDING_CLEAR_RADIUS),
        { ignoredPortalSectId: ignored },
    );
    if (conflict.ok !== true) {
        throw new BadRequestException(`宗門山門五格陣基內${formatProtectedPlacementConflictReason(conflict.reason)}`);
    }
    const normalizedInstanceId = normalizeOptionalString(instanceId);
    for (const sect of Array.isArray(sects) ? sects : []) {
        if (!sect || sect.status === 'dissolved' || normalizeOptionalString(sect.entranceInstanceId) !== normalizedInstanceId) {
            continue;
        }
        if (ignored && normalizeOptionalString(sect.sectId) === ignored) {
            continue;
        }
        if (chebyshevDistance(x0, y0, sect.entranceX, sect.entranceY) <= SECT_FOUNDING_CLEAR_RADIUS) {
            throw new BadRequestException('宗門山門五格陣基內不能有其他宗門');
        }
    }
}

function logSectEntranceProtectedPlacementConflict(logger, sect, instance) {
    if (!sect || !instance) {
        return;
    }
    const x = Math.trunc(Number(sect.entranceX));
    const y = Math.trunc(Number(sect.entranceY));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
    }
    const conflict = findProtectedPlacementConflict(
        instance,
        iterateSquareProtectedPlacementPoints(x, y, SECT_FOUNDING_CLEAR_RADIUS),
        { ignoredPortalSectId: normalizeOptionalString(sect.sectId) },
    );
    if (conflict.ok !== true) {
        logger?.warn?.(`啟動發現宗門山門五格陣基保護點位衝突，暫不清理：${normalizeOptionalString(sect.sectId) ?? ''} ${formatProtectedPlacementConflictReason(conflict.reason)} (${conflict.x},${conflict.y})`);
    }
}

function normalizeOptionalString(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    return normalized ? normalized : null;
}

function createSectShutdownSignal(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

function resolveNextSectUpdatedAt(sect, now = Date.now()) {
    const previous = normalizeIntegerWithDefault(sect?.updatedAt, 0);
    const wallClock = normalizeIntegerWithDefault(now, Date.now());
    return Math.max(previous + 1, wallClock);
}

function advanceSectUpdatedAt(sect, now = Date.now()) {
    if (!sect || typeof sect !== 'object') {
        return 0;
    }
    const next = resolveNextSectUpdatedAt(sect, now);
    sect.updatedAt = next;
    return next;
}

function chebyshevDistance(ax, ay, bx, by) {
    return Math.max(Math.abs(Math.trunc(Number(ax)) - Math.trunc(Number(bx))), Math.abs(Math.trunc(Number(ay)) - Math.trunc(Number(by))));
}

function formatDurationMs(ms) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms) / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (days > 0) {
        return hours > 0 ? `${days}天${hours}小時` : `${days}天`;
    }
    if (hours > 0) {
        return minutes > 0 ? `${hours}小時${minutes}分鐘` : `${hours}小時`;
    }
    return `${Math.max(1, minutes)}分鐘`;
}

function touchRuntimeInstanceRevision(deps, instanceId) {
    const instance = deps.getInstanceRuntime?.(instanceId);
    if (instance) {
        instance.worldRevision += 1;
    }
}

function queueStructuredSectNotice(deps, playerId, kind, key, fallbackText, opts = undefined) {
    if (!normalizeOptionalString(playerId)) {
        return;
    }
    const notice = buildStructuredNotice(kind, key, fallbackText, opts);
    deps.queuePlayerNotice?.(playerId, notice.text, notice.kind, undefined, undefined, notice.structured);
}

function isRuntimeBoundaryTile(instance, x, y) {
    if (!instance || typeof instance.isInBounds !== 'function') {
        return false;
    }
    const tx = Math.trunc(Number(x));
    const ty = Math.trunc(Number(y));
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || instance.isInBounds(tx, ty) !== true) {
        return false;
    }
    let boundary = false;
    forEachRuntimeBoundaryGap(instance, tx, ty, () => {
        boundary = true;
    });
    return boundary;
}

function forEachRuntimeBoundaryGap(instance, x, y, visitor) {
    if (!instance || typeof instance.isInBounds !== 'function' || typeof visitor !== 'function') {
        return;
    }
    const tx = Math.trunc(Number(x));
    const ty = Math.trunc(Number(y));
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || instance.isInBounds(tx, ty) !== true) {
        return;
    }
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const nextX = tx + dx;
            const nextY = ty + dy;
            if (instance.isInBounds(nextX, nextY) !== true) {
                visitor(nextX, nextY);
            }
        }
    }
}

function updateSectRuntimeBoundsForTile(sect, x, y) {
    const coreX = Math.trunc(Number(sect?.coreX) || 0);
    const coreY = Math.trunc(Number(sect?.coreY) || 0);
    const logicalX = Math.trunc(Number(x)) - coreX;
    const logicalY = Math.trunc(Number(y)) - coreY;
    const bounds = normalizeSectBounds(sect);
    sect.mapMinX = Math.min(bounds.minX, logicalX);
    sect.mapMaxX = Math.max(bounds.maxX, logicalX);
    sect.mapMinY = Math.min(bounds.minY, logicalY);
    sect.mapMaxY = Math.max(bounds.maxY, logicalY);
    sect.expansionRadius = Math.max(
        Math.abs(sect.mapMinX),
        Math.abs(sect.mapMaxX),
        Math.abs(sect.mapMinY),
        Math.abs(sect.mapMaxY),
    );
}

function markSectExpansionTilesForSync(instance, previousBounds, nextBounds, openedX, openedY) {
    if (!instance || typeof instance.markStaticTileSyncDirtyByIndex !== 'function' || typeof instance.toTileIndex !== 'function') {
        return;
    }
    markRuntimeTileForStaticSync(instance, openedX, openedY, true);
    for (let y = nextBounds.minY; y <= nextBounds.maxY; y += 1) {
        for (let x = nextBounds.minX; x <= nextBounds.maxX; x += 1) {
            if (x >= previousBounds.minX && x <= previousBounds.maxX && y >= previousBounds.minY && y <= previousBounds.maxY) {
                continue;
            }
            markRuntimeTileForStaticSync(instance, x, y, true);
        }
    }
}

function markRuntimeTileForStaticSync(instance, x, y, sightBlockingChanged = false) {
    const tileIndex = instance.toTileIndex(Math.trunc(Number(x)), Math.trunc(Number(y)));
    if (!Number.isFinite(tileIndex) || tileIndex < 0) {
        return;
    }
    instance.markStaticTileSyncDirtyByIndex(tileIndex, { sightBlockingChanged });
}

function areSectBoundsEqual(left, right) {
    return left?.minX === right?.minX
        && left?.maxX === right?.maxX
        && left?.minY === right?.minY
        && left?.maxY === right?.maxY;
}

function readSectTemplateBounds(template) {
    const source = template?.source && typeof template.source === 'object' ? template.source : null;
    return normalizeBoundsObject({
        minX: source?.sectMapMinX,
        maxX: source?.sectMapMaxX,
        minY: source?.sectMapMinY,
        maxY: source?.sectMapMaxY,
    });
}

function areSectTemplateBoundsEqual(template, bounds) {
    const normalizedBounds = normalizeBoundsObject(bounds);
    const templateBounds = readSectTemplateBounds(template);
    return Boolean(templateBounds && normalizedBounds && areSectBoundsEqual(templateBounds, normalizedBounds));
}

async function waitForSectInstancesLeaseReady(instances, deps) {
    const currentInstances: any[] = [];
    const seenInstanceIds = new Set<string>();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const instanceId = normalizeOptionalString(instance?.meta?.instanceId);
        if (!instanceId || seenInstanceIds.has(instanceId)) {
            continue;
        }
        seenInstanceIds.add(instanceId);
        currentInstances.push(instance);
        await deps.waitForInstanceLeaseReady?.(instanceId);
    }
    if (currentInstances.length === 0) {
        throw new ServiceUnavailableException('宗門實例尚未就緒');
    }
    const writable = currentInstances.every((instance) => {
        const instanceId = normalizeOptionalString(instance?.meta?.instanceId);
        return deps.getInstanceRuntime?.(instanceId) === instance
            && (typeof deps.isInstanceLeaseWritable !== 'function' || deps.isInstanceLeaseWritable(instance));
    });
    if (!writable) {
        throw new ServiceUnavailableException('宗門實例租約尚未就緒');
    }
}

async function prepareSectRuntimeApply(sect, entranceInstance, sectInstance, deps, logger) {
    if (!entranceInstance || !sectInstance) {
        logger.warn(`宗門運行態應用跳過：${sect.sectId} 入口或宗門實例不存在`);
        return false;
    }
    const instances: any[] = [];
    const seenInstanceIds = new Set<string>();
    for (const instance of [entranceInstance, sectInstance]) {
        const instanceId = normalizeOptionalString(instance?.meta?.instanceId);
        if (!instanceId || seenInstanceIds.has(instanceId)) {
            continue;
        }
        seenInstanceIds.add(instanceId);
        instances.push(instance);
    }
    try {
        for (const instance of instances) {
            const instanceId = normalizeOptionalString(instance?.meta?.instanceId);
            await deps.waitForInstanceLeaseReady?.(instanceId);
            if (deps.instanceCatalogService?.isEnabled?.()) {
                if (typeof deps.syncInstanceLease !== 'function') {
                    return false;
                }
                await deps.syncInstanceLease(instanceId, { hydratePersistentSnapshot: false });
            }
        }
    } catch (error) {
        logger.warn(`宗門運行態應用前續租失敗：${sect.sectId} ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
    const writable = instances.every((instance) => {
        const instanceId = normalizeOptionalString(instance?.meta?.instanceId);
        return deps.getInstanceRuntime?.(instanceId) === instance
            && (typeof deps.isInstanceLeaseWritable !== 'function' || deps.isInstanceLeaseWritable(instance));
    });
    if (!writable) {
        logger.warn(`宗門運行態應用跳過：${sect.sectId} 入口或宗門實例租約不可寫`);
    }
    return writable;
}
