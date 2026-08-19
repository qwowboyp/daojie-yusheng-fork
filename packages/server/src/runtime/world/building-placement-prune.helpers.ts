/**
 * 本文件属于服务端权威运行时，负责启动自检摧毁违规建筑时的资产兜底与审计。
 *
 * hydrateBuildingRoomFengShuiState 会丢弃落在受保护点位或定义已删除的建筑，
 * 随后 prune 会把 instance_building_state 行物理删除。宝库的库存存在独立表
 * instance_building_storage_item，不随建筑行删除，且活实例期间 orphan 扫描
 * 覆盖不到，因此必须在 prune 之前把库存邮件返还给 owner。
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
 * @returns 返还失败、因而必须豁免摧毁的建筑 id 集合。定义已删除的宝库无法恢复
 *          运行态，即使返还失败也不能保留，只写 error 日志交由 GM 处理。
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

/** 定义已删除的宝库无法恢复运行态，不能靠豁免保留。 */
function markBlocked(blocked: Set<string>, vault: SkippedBuildingRecord): void {
  if (vault?.id && vault.reason !== 'unknown_def') {
    blocked.add(vault.id);
  }
}

function describeBlockOutcome(vault: SkippedBuildingRecord): string {
  return vault?.reason === 'unknown_def'
    ? '該寶庫定義已刪除、無法保留，庫存仍留在 instance_building_storage_item'
    : '已豁免摧毀並原地保留';
}

function describeChamberBlockOutcome(chamber: SkippedBuildingRecord): string {
  return chamber?.reason === 'unknown_def'
    ? '該密室定義已刪除、無法保留，獨立實例需由 GM 檢查'
    : '已豁免摧毀並原地保留';
}

function resolveSkippedBuildings(hydrateResult: unknown): SkippedBuildingRecord[] {
  const skipped = (hydrateResult as any)?.skippedBuildings;
  return Array.isArray(skipped) ? skipped : [];
}
