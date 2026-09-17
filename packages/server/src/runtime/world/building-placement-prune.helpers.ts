/**
 * 本文件属于服务端权威运行时，负责启动自检摧毁违规建筑时的资产兜底与审计。
 *
 * 定义缺失（unknown_def）的建筑必须在启动阶段 fail closed：任何持久化写入或
 * 占格释放之前就抛出致命错误，让数据保持原样等待人工修定义，绝不能把剪除后的
 * 快照写回而变相删除玩家资料。assertNoUnknownBuildingDefinitions 负责该前置检查，
 * persistBuildingRoomStateAfterStartupRecovery 作为最后一道写回闸门再次拦截。
 *
 * 仅当建筑定义仍然存在时，hydrateBuildingRoomFengShuiState 才会丢弃落在受保护
 * 点位的建筑，随后 prune 把 instance_building_state 行物理删除。宝库的库存存在
 * 独立表 instance_building_storage_item，不随建筑行删除，且活实例期间 orphan
 * 扫描覆盖不到，因此必须在 prune 之前把库存邮件返还给 owner。
 *
 * 与玩家主动拆除一致：宝库库存返还失败时不摧毁宝库，原地保留等待下次启动或 GM 处理。
 */

/** 摧毁审计日志逐条打印上限，超出只汇总计数，避免启动期刷屏。 */
const PRUNE_AUDIT_LOG_LIMIT = 50;

interface SkippedBuildingRecord {
  id?: string;
  defId?: string;
  ownerPlayerId?: string | null;
  reason?: string;
}

/**
 * recoverVaultsBeforePlacementPrune：返还即将被启动自检摧毁的宝库库存。
 *
 * 必须在 saveBuildingRoomFengShuiState 删除 instance_building_state 之前调用，
 * 否则宝库的 owner_player_id 无法从建筑行回退取得。
 *
 * @returns 返还失败、因而必须豁免摧毁的建筑 id 集合。定义缺失的宝库应由调用方的
 *          前置 fail-closed 检查拦下，不会走到这里。
 */
export async function recoverVaultsBeforePlacementPrune(
  runtime: any,
  instanceId: string,
  instance: any,
  state: unknown,
  logger: any,
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (typeof instance?.listPrunableVaultBuildings !== 'function') {
    return blocked;
  }
  const vaults: SkippedBuildingRecord[] = instance.listPrunableVaultBuildings(state) ?? [];
  if (vaults.length === 0) {
    return blocked;
  }
  const service = runtime?.treasureVaultRuntimeService;
  if (typeof service?.recoverVaultItemsToOwnerMail !== 'function') {
    logger?.error?.(`啟動摧毀違規寶庫時返還服務不可用，全部豁免摧毀：${instanceId}`);
    for (const vault of vaults) {
      markBlocked(blocked, vault);
    }
    return blocked;
  }
  for (const vault of vaults) {
    const buildingId = vault?.id;
    if (!buildingId) {
      continue;
    }
    try {
      const result = await service.recoverVaultItemsToOwnerMail({
        instanceId,
        buildingId,
        ownerPlayerId: vault?.ownerPlayerId ?? null,
        reason: 'startup_placement_prune',
      });
      if (result?.ok === true) {
        if (result.itemCount > 0) {
          logger?.warn?.(`啟動摧毀違規寶庫前返還了 ${result.itemCount} 件物品 instance=${instanceId} building=${buildingId} owner=${vault?.ownerPlayerId ?? ''}`);
        }
        continue;
      }
      logger?.error?.(`啟動摧毀違規寶庫時庫存無法返還，${describeBlockOutcome(vault)} instance=${instanceId} building=${buildingId} reason=${result?.reason ?? ''}`);
      markBlocked(blocked, vault);
    } catch (error) {
      logger?.error?.(`啟動摧毀違規寶庫時返還庫存異常，${describeBlockOutcome(vault)} instance=${instanceId} building=${buildingId} ${(error as Error)?.message ?? error}`);
      markBlocked(blocked, vault);
    }
  }
  return blocked;
}

/** 启动自检摧毁密室外部建筑前，先原子释放对应独立实例与开启状态。 */
export async function releaseTimeChambersBeforePlacementPrune(
  runtime: any,
  instanceId: string,
  instance: any,
  state: unknown,
  logger: any,
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (typeof instance?.listPrunableTimeChamberBuildings !== 'function') {
    return blocked;
  }
  const chambers: SkippedBuildingRecord[] = instance.listPrunableTimeChamberBuildings(state) ?? [];
  if (chambers.length === 0) {
    return blocked;
  }
  const service = runtime?.timeChamberRuntimeService;
  if (typeof service?.prepareDeconstruct !== 'function') {
    logger?.error?.(`啟動摧毀違規密室時釋放服務不可用，全部可恢復密室豁免摧毀：${instanceId}`);
    for (const chamber of chambers) {
      markBlocked(blocked, chamber);
    }
    return blocked;
  }
  for (const chamber of chambers) {
    if (!chamber.id) {
      continue;
    }
    try {
      const result = await service.prepareDeconstruct(instanceId, chamber.id, runtime);
      if (result?.ok === true) {
        continue;
      }
      logger?.error?.(`啟動摧毀違規密室時無法釋放獨立實例，${describeChamberBlockOutcome(chamber)} instance=${instanceId} building=${chamber.id} reason=${result?.reason ?? ''}`);
      markBlocked(blocked, chamber);
    } catch (error) {
      logger?.error?.(`啟動摧毀違規密室時釋放異常，${describeChamberBlockOutcome(chamber)} instance=${instanceId} building=${chamber.id} ${(error as Error)?.message ?? error}`);
      markBlocked(blocked, chamber);
    }
  }
  return blocked;
}

/** logPrunedBuildingAudit：逐条记录被启动自检摧毁的建筑，供事后回读与申诉。 */
export function logPrunedBuildingAudit(instanceId: string, hydrateResult: unknown, logger: any): void {
  const skipped = resolveSkippedBuildings(hydrateResult);
  for (const entry of skipped.slice(0, PRUNE_AUDIT_LOG_LIMIT)) {
    logger?.warn?.(
      `啟動摧毀違規建築 instance=${instanceId} building=${entry?.id ?? ''} def=${entry?.defId ?? ''} owner=${entry?.ownerPlayerId ?? ''} reason=${entry?.reason ?? ''}`,
    );
  }
  if (skipped.length > PRUNE_AUDIT_LOG_LIMIT) {
    logger?.warn?.(`啟動摧毀違規建築共 ${skipped.length} 個，已省略 ${skipped.length - PRUNE_AUDIT_LOG_LIMIT} 條明細：${instanceId}`);
  }
  const kept = Math.max(0, Math.trunc(Number((hydrateResult as any)?.keptProtectedPlacementCount) || 0));
  if (kept > 0) {
    logger?.error?.(`有 ${kept} 個違規寶庫因庫存無法返還而豁免摧毀，仍佔據禁建區，需要 GM 處理：${instanceId}`);
  }
}

/**
 * unknown_def 正常會被前置 fail-closed 檢查攔下；此分支僅在檢查被繞過時作為兜底，
 * 確保定義缺失的寶庫無論如何都不會以「豁免保留」的形式留在運行態。
 */
function markBlocked(blocked: Set<string>, vault: SkippedBuildingRecord): void {
  if (vault?.id && vault.reason !== 'unknown_def') {
    blocked.add(vault.id);
  }
}

function describeBlockOutcome(vault: SkippedBuildingRecord): string {
  return vault?.reason === 'unknown_def'
    ? '該寶庫定義缺失，啟動應已中止，庫存仍留在 instance_building_storage_item'
    : '已豁免摧毀並原地保留';
}

function describeChamberBlockOutcome(chamber: SkippedBuildingRecord): string {
  return chamber?.reason === 'unknown_def'
    ? '該密室定義缺失，啟動應已中止，獨立實例需由 GM 檢查'
    : '已豁免摧毀並原地保留';
}

function resolveSkippedBuildings(hydrateResult: unknown): SkippedBuildingRecord[] {
  const skipped = (hydrateResult as any)?.skippedBuildings;
  return Array.isArray(skipped) ? skipped : [];
}

/** 未知定義建築的一筆記錄，供啟動 fail-closed 診斷輸出。 */
export interface UnknownBuildingDefinitionRecord {
  id: string;
  defId: string;
  ownerPlayerId: string | null;
}

/**
 * collectUnknownBuildingDefinitions：列出持久化建築中 defId 已無法解析的條目。
 *
 * 判定與 hydrateBuildingRoomFengShuiState 的 unknown_def 分支一致：只要建築有
 * 非空 id 與 defId、但 buildingCatalog.defById 查不到該 defId，即視為未知定義。
 */
export function collectUnknownBuildingDefinitions(
  instance: any,
  state: unknown,
): UnknownBuildingDefinitionRecord[] {
  const defById = instance?.buildingCatalog?.defById;
  if (!defById || typeof defById.get !== 'function') {
    return [];
  }
  const buildings = (state as any)?.buildings;
  if (!Array.isArray(buildings)) {
    return [];
  }
  const unknown: UnknownBuildingDefinitionRecord[] = [];
  for (const entry of buildings) {
    const id = normalizeStartupBuildingId(entry?.id ?? entry?.buildingId);
    const defId = normalizeStartupBuildingId(entry?.defId);
    if (!id || !defId) {
      continue;
    }
    if (!defById.get(defId)) {
      unknown.push({
        id,
        defId,
        ownerPlayerId: typeof entry?.ownerPlayerId === 'string' ? entry.ownerPlayerId : null,
      });
    }
  }
  return unknown;
}

/**
 * assertNoUnknownBuildingDefinitions：啟動恢復前的最終閘門。
 *
 * 只要存在任何未知定義建築就拋出致命錯誤，且必須在任何持久化寫入或佔格釋放之前
 * 呼叫。錯誤訊息帶 instanceId、建築數、定義種類數與明細，讓運維能直接定位缺失的
 * defId，但不夾帶任何快照 payload 或憑證。
 */
export function assertNoUnknownBuildingDefinitions(
  instance: any,
  state: unknown,
  instanceId: string,
  logger: any,
): void {
  const unknown = collectUnknownBuildingDefinitions(instance, state);
  if (unknown.length === 0) {
    return;
  }
  const distinctDefIds = new Set(unknown.map((entry) => entry.defId));
  const ownerCount = new Set(
    unknown.map((entry) => entry.ownerPlayerId).filter((owner): owner is string => !!owner),
  ).size;
  const details = unknown
    .slice(0, PRUNE_AUDIT_LOG_LIMIT)
    .map((entry) => `${entry.id}:${entry.defId}:owner=${entry.ownerPlayerId ?? ''}`)
    .join(' ');
  const omitted = unknown.length > PRUNE_AUDIT_LOG_LIMIT
    ? ` omitted=${unknown.length - PRUNE_AUDIT_LOG_LIMIT}`
    : '';
  const message = `[startup_building_unknown_def_fail_closed] instance=${instanceId} buildings=${unknown.length} defs=${distinctDefIds.size} owners=${ownerCount} defIds=${[...distinctDefIds].join(',')}${omitted} details=${details}`;
  logger?.error?.(message);
  throw new Error(message);
}

/**
 * persistBuildingRoomStateAfterStartupRecovery：啟動自檢後的統一寫回入口。
 *
 * 兩個啟動恢復路徑（lifecycle restorePublicInstancePersistence 與
 * instance-lease hydratePersistentInstanceSnapshot）共用這一份實作，避免行為漂移。
 * 未知定義建築一律在此再次攔截，確保沒有任何路徑能把剪除後的快照寫回而刪除資料。
 */
export async function persistBuildingRoomStateAfterStartupRecovery(
  runtime: any,
  domainPersistenceService: any,
  instanceId: string,
  instance: any,
  hydrateResult: unknown,
): Promise<void> {
  const result = (hydrateResult ?? {}) as any;
  const skippedCount = Math.max(0, Math.trunc(Number(result?.skippedUnknownDefCount) || 0));
  if (skippedCount > 0) {
    const unknownDefIds = new Set(
      resolveSkippedBuildings(result)
        .filter((entry) => entry?.reason === 'unknown_def')
        .map((entry) => String(entry?.defId ?? '')),
    );
    const message = `[startup_building_unknown_def_fail_closed] instance=${instanceId} buildings=${skippedCount} defs=${unknownDefIds.size} defIds=${[...unknownDefIds].join(',')} stage=persist`;
    runtime?.logger?.error?.(message);
    throw new Error(message);
  }
  const skippedProtectedPlacementCount = Math.max(0, Math.trunc(Number(result?.skippedProtectedPlacementCount) || 0));
  const restoredSkippedBuildingTileCellCount = Math.max(0, Math.trunc(Number(result?.restoredSkippedBuildingTileCellCount) || 0));
  const repairedBuildingCellCount = Math.max(0, Math.trunc(Number(result?.repairedBuildingCellCount) || 0));
  const repairedBuildingVisualCellCount = Math.max(0, Math.trunc(Number(result?.repairedBuildingVisualCellCount) || 0));
  const restoredStaleBuildingVisualCellCount = Math.max(0, Math.trunc(Number(result?.restoredStaleBuildingVisualCellCount) || 0));
  const runtimeTileCellRecoveryCount = restoredSkippedBuildingTileCellCount
    + repairedBuildingVisualCellCount
    + restoredStaleBuildingVisualCellCount;
  if (skippedProtectedPlacementCount <= 0
    && restoredSkippedBuildingTileCellCount <= 0
    && repairedBuildingCellCount <= 0) {
    return;
  }
  if (typeof domainPersistenceService?.saveBuildingRoomFengShuiState === 'function') {
    const state = typeof instance?.buildBuildingRoomFengShuiPersistenceState === 'function'
      ? instance.buildBuildingRoomFengShuiPersistenceState()
      : {
        buildings: typeof instance?.buildBuildingPersistenceEntries === 'function' ? instance.buildBuildingPersistenceEntries() : [],
        rooms: typeof instance?.listRoomSummaries === 'function' ? instance.listRoomSummaries() : [],
        roomCells: [],
        fengShui: [],
      };
    await domainPersistenceService.saveBuildingRoomFengShuiState(instanceId, state);
  }
  if (runtimeTileCellRecoveryCount > 0 && typeof domainPersistenceService?.replaceRuntimeTileCells === 'function') {
    await domainPersistenceService.replaceRuntimeTileCells(
      instanceId,
      typeof instance?.buildRuntimeTilePersistenceEntries === 'function' ? instance.buildRuntimeTilePersistenceEntries() : [],
    );
  }
  if (skippedProtectedPlacementCount > 0) {
    runtime?.logger?.warn?.(`啟動清理了 ${skippedProtectedPlacementCount} 個違規保護點位建築：${instanceId}`);
  }
  if (restoredSkippedBuildingTileCellCount > 0) {
    runtime?.logger?.warn?.(`啟動恢復了 ${restoredSkippedBuildingTileCellCount} 個違規建築佔用地塊：${instanceId}`);
  }
  if (repairedBuildingCellCount > 0) {
    runtime?.logger?.warn?.(`啟動修復了 ${repairedBuildingCellCount} 個失配建築佔格：${instanceId}`);
  }
}

/** normalizeStartupBuildingId：與 MapInstanceRuntime.normalizeBuildingId 保持同一判定。 */
function normalizeStartupBuildingId(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}
