/**
 * 將舊版倉庫制靈蛋（spirit_beast_egg.state='warehouse'）併入玩家背包。
 *
 * 靈蛋已改為普通背包道具，倉庫蛋列不再被運行時讀取。轉換依 (owner, element, star) 聚合，
 * 併入同 item_id 的未鎖堆疊或新增一格堆疊，成功後刪除原列。
 *
 * 安全邊界：
 * - 已載入運行態的玩家（線上或離線掛機）持資產互斥鎖、先強制刷盤背包，提交後以 DB 回讀覆蓋記憶體背包；
 *   缺少同步所需服務時才跳過並回報；任何情況都不刪除尚未入包的蛋列。
 * - 逐玩家獨立事務，新增堆疊依序配置空槽位。
 * - 背包已滿且無同 item_id 堆疊時整組跳過，不丟棄資產。
 * - 只在 GM 冷路徑執行，禁止進 tick 熱路徑。
 */
import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DEFAULT_INVENTORY_CAPACITY, getSpiritEggItemId, type SpiritBeastElement, type SpiritBeastStar } from '@mud/shared';

import { DatabasePoolProvider } from '../../../../persistence/database-pool.provider';
import { GmAuditLogPersistenceService } from '../../../../persistence/gm-audit-log-persistence.service';
import { PlayerPersistenceFlushService } from '../../../../persistence/player-persistence-flush.service';
import { SpiritBeastPersistenceService } from '../../../../persistence/spirit-beast-persistence.service';
import { PlayerRuntimeService } from '../../../../runtime/player/player-runtime.service';
import type {
  GmCompatConversionRunOptions,
  GmCompatConversionRunResult,
  GmCompatConversionSample,
} from '../../types';

export const SPIRIT_BEAST_WAREHOUSE_EGGS_TO_INVENTORY_CONVERSION_ID = 'spirit_beast_warehouse_eggs_to_inventory';

const SAMPLE_LIMIT = 10;
const EGG_ITEM_TYPE = 'material';

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

interface EggGroupPlan {
  ownerPlayerId: string;
  element: SpiritBeastElement;
  star: SpiritBeastStar;
  itemId: string;
  eggIds: string[];
  eggRows: number;
  stackItemInstanceId: string | null;
  existingCount: number;
  nextSlotIndex: number;
  /** 搬遷前背包已佔格數。 */
  occupied: number;
  blockedReason: string | null;
}

interface AppliedGroup {
  plan: EggGroupPlan;
  expectedTotal: number;
}

function createEmptyResult(mode: GmCompatConversionRunOptions['mode']): GmCompatConversionRunResult {
  return {
    ok: true,
    conversionId: SPIRIT_BEAST_WAREHOUSE_EGGS_TO_INVENTORY_CONVERSION_ID,
    mode,
    matchedRows: 0,
    convertedRows: 0,
    skippedRows: 0,
    failedRows: 0,
    verifiedRows: 0,
    samples: [],
    errors: [],
  };
}

@Injectable()
export class SpiritBeastWarehouseEggsToInventoryConversion {
  private readonly logger = new Logger(SpiritBeastWarehouseEggsToInventoryConversion.name);

  constructor(
    @Inject(DatabasePoolProvider) private readonly databasePoolProvider: DatabasePoolProvider,
    @Optional() @Inject(PlayerRuntimeService) private readonly playerRuntimeService: PlayerRuntimeService | null = null,
    @Optional() @Inject(GmAuditLogPersistenceService)
    private readonly gmAuditLogPersistenceService: GmAuditLogPersistenceService | null = null,
    @Optional() @Inject(PlayerPersistenceFlushService)
    private readonly playerPersistenceFlushService: PlayerPersistenceFlushService | null = null,
    @Optional() @Inject(SpiritBeastPersistenceService)
    private readonly spiritBeastPersistenceService: SpiritBeastPersistenceService | null = null,
  ) {}

  private canSyncLoadedPlayer(): boolean {
    return Boolean(this.playerRuntimeService && this.playerPersistenceFlushService && this.spiritBeastPersistenceService);
  }

  async run(options: GmCompatConversionRunOptions): Promise<GmCompatConversionRunResult> {
    const pool = this.databasePoolProvider.getPool('gm-compat-spirit-beast-warehouse-eggs-to-inventory');
    if (!pool) {
      throw new ServiceUnavailableException('database_unavailable');
    }
    const result = createEmptyResult(options.mode);

    if (options.mode === 'dry-run') {
      const plans = await this.loadPlans(pool as unknown as Queryable, false);
      this.populateScanResult(result, plans);
      result.convertedRows = plans.filter((plan) => !plan.blockedReason).reduce((sum, plan) => sum + plan.eggRows, 0);
      await this.recordAudit(result, options);
      return result;
    }

    // 逐玩家獨立事務：單一玩家失敗只回滾該玩家，不影響其他玩家。
    const owners = await pool.query(
      `SELECT DISTINCT owner_player_id FROM spirit_beast_egg WHERE state = 'warehouse' ORDER BY owner_player_id ASC`,
    );
    const applied: AppliedGroup[] = [];
    const allPlans: EggGroupPlan[] = [];
    for (const row of owners.rows) {
      const ownerPlayerId = String(row.owner_player_id);
      const loaded = Boolean(this.playerRuntimeService?.getPlayer(ownerPlayerId)) && this.canSyncLoadedPlayer();
      const migrate = () => this.applyOwner(pool, ownerPlayerId, loaded, allPlans, applied, result);
      if (loaded && this.playerRuntimeService) {
        await this.playerRuntimeService.runExclusiveAssetMutation([ownerPlayerId], migrate);
      } else {
        await migrate();
      }
    }
    this.populateScanResult(result, allPlans);

    result.convertedRows = applied.reduce((sum, entry) => sum + entry.plan.eggRows, 0);
    result.verifiedRows = await this.verifyAppliedRows(pool, applied, result);
    const unverifiedRows = result.convertedRows - result.verifiedRows;
    if (unverifiedRows > 0) {
      result.failedRows += unverifiedRows;
      result.errors.push(`回讀有 ${unverifiedRows} 列倉庫靈蛋未通過驗證`);
    }
    result.appliedAt = new Date().toISOString();
    this.logger.log(
      `倉庫靈蛋轉背包完成：命中 ${result.matchedRows}，轉換 ${result.convertedRows}，`
      + `跳過 ${result.skippedRows}，驗證 ${result.verifiedRows}`,
    );
    await this.recordAudit(result, options);
    return result;
  }

  /**
   * 單一玩家搬遷。已載入運行態的玩家（含離線掛機）由呼叫端持資產互斥鎖，
   * 先強制刷盤背包，事務提交後以 DB 回讀覆蓋記憶體背包，避免後續刷盤蓋掉新堆疊。
   */
  private async applyOwner(
    pool: Pool,
    ownerPlayerId: string,
    loaded: boolean,
    allPlans: EggGroupPlan[],
    applied: AppliedGroup[],
    result: GmCompatConversionRunResult,
  ): Promise<void> {
    if (loaded) {
      await this.playerPersistenceFlushService!.flushPlayerDomains(ownerPlayerId, ['inventory'], { forceCurrentSnapshot: true });
    }
    const client = await pool.connect();
    const ownerApplied: AppliedGroup[] = [];
    let plans: EggGroupPlan[] = [];
    try {
      await client.query('BEGIN');
      plans = await this.loadPlans(client as unknown as Queryable, true, ownerPlayerId);
      let nextSlotIndex = plans[0]?.nextSlotIndex ?? 0;
      let occupied = plans[0]?.occupied ?? 0;
      for (const plan of plans) {
        if (plan.blockedReason) continue;
        if (!plan.stackItemInstanceId) {
          // 同一玩家多組新堆疊需累計佔格，超出容量的組別保留原列。
          if (occupied >= DEFAULT_INVENTORY_CAPACITY) {
            plan.blockedReason = 'inventory_full';
            continue;
          }
          occupied += 1;
          plan.nextSlotIndex = nextSlotIndex++;
        }
        await this.mergeIntoInventory(client, plan);
        const deleted = await client.query(
          `DELETE FROM spirit_beast_egg
            WHERE egg_id = ANY($1::uuid[]) AND owner_player_id = $2 AND state = 'warehouse'`,
          [plan.eggIds, plan.ownerPlayerId],
        );
        if ((deleted.rowCount ?? 0) !== plan.eggIds.length) {
          throw new Error(`spirit_egg_delete_cas_failed:${plan.ownerPlayerId}:${plan.itemId}`);
        }
        ownerApplied.push({ plan, expectedTotal: plan.existingCount + plan.eggRows });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      result.failedRows += plans.filter((plan) => !plan.blockedReason).reduce((sum, plan) => sum + plan.eggRows, 0);
      result.errors.push(`${ownerPlayerId}:${error instanceof Error ? error.message : String(error)}`);
      this.logger.error(`倉庫靈蛋轉背包失敗並已回滾（${ownerPlayerId}）：${result.errors[result.errors.length - 1]}`);
      for (const plan of plans) plan.blockedReason ??= 'apply_failed';
      allPlans.push(...plans);
      return;
    } finally {
      client.release();
    }
    allPlans.push(...plans);
    applied.push(...ownerApplied);
    if (loaded && ownerApplied.length > 0) {
      this.playerRuntimeService!.replaceInventoryItems(
        ownerPlayerId,
        await this.spiritBeastPersistenceService!.listPlayerInventoryItems(ownerPlayerId),
      );
    }
  }

  /** 只在冷路徑載入聚合方案；apply 時鎖定蛋列與背包堆疊。 */
  private async loadPlans(queryable: Queryable, lockRows: boolean, ownerPlayerId: string | null = null): Promise<EggGroupPlan[]> {
    const groups = await queryable.query(
      `SELECT owner_player_id, element, star,
              array_agg(egg_id::text ORDER BY egg_id) AS egg_ids,
              COUNT(*)::int AS egg_rows
         FROM spirit_beast_egg
        WHERE state = 'warehouse' AND ($1::text IS NULL OR owner_player_id = $1)
        GROUP BY owner_player_id, element, star
        ORDER BY owner_player_id ASC, element ASC, star ASC`,
      [ownerPlayerId],
    );
    const plans: EggGroupPlan[] = [];
    for (const row of groups.rows) {
      const ownerPlayerId = String(row.owner_player_id);
      const element = String(row.element) as SpiritBeastElement;
      const star = Number(row.star) as SpiritBeastStar;
      const itemId = getSpiritEggItemId(element, star);
      const eggIds = (row.egg_ids as string[] | null) ?? [];
      const eggRows = Math.max(0, Math.trunc(Number(row.egg_rows) || 0));
      const online = Boolean(this.playerRuntimeService?.getPlayer(ownerPlayerId));
      const stack = await queryable.query(
        `SELECT item_instance_id, count FROM player_inventory_item
          WHERE player_id = $1 AND item_id = $2 AND locked_by IS NULL
          ORDER BY slot_index ASC LIMIT 1
          ${lockRows ? 'FOR UPDATE' : ''}`,
        [ownerPlayerId, itemId],
      );
      const stats = await queryable.query(
        `SELECT COUNT(*)::int AS occupied, COALESCE(MAX(slot_index), -1)::int AS max_slot
           FROM player_inventory_item WHERE player_id = $1`,
        [ownerPlayerId],
      );
      const occupied = Math.max(0, Math.trunc(Number(stats.rows[0]?.occupied) || 0));
      const maxSlot = Math.trunc(Number(stats.rows[0]?.max_slot) || -1);
      const hasStack = Boolean(stack.rows[0]);
      // 已載入運行態但缺少刷盤/回讀服務時無法安全同步記憶體背包，才需等玩家下線。
      const blockedReason = online && !this.canSyncLoadedPlayer()
        ? 'online_player_requires_logout'
        : hasStack || occupied < DEFAULT_INVENTORY_CAPACITY ? null : 'inventory_full';
      plans.push({
        ownerPlayerId,
        element,
        star,
        itemId,
        eggIds,
        eggRows,
        stackItemInstanceId: hasStack ? String(stack.rows[0].item_instance_id) : null,
        existingCount: hasStack ? Math.max(0, Math.trunc(Number(stack.rows[0].count) || 0)) : 0,
        nextSlotIndex: maxSlot + 1,
        occupied,
        blockedReason,
      });
    }
    return plans;
  }

  private async mergeIntoInventory(client: { query: Queryable['query'] }, plan: EggGroupPlan): Promise<void> {
    if (plan.stackItemInstanceId) {
      await client.query(
        `UPDATE player_inventory_item
            SET count = count + $2,
                raw_payload = jsonb_set(raw_payload, '{count}', to_jsonb((count + $2)::bigint), true),
                updated_at = now()
          WHERE item_instance_id = $1`,
        [plan.stackItemInstanceId, plan.eggRows],
      );
      return;
    }
    const itemInstanceId = randomUUID();
    await client.query(
      `INSERT INTO player_inventory_item
        (item_instance_id, player_id, slot_index, item_id, count, raw_payload, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())`,
      [
        itemInstanceId,
        plan.ownerPlayerId,
        plan.nextSlotIndex,
        plan.itemId,
        plan.eggRows,
        JSON.stringify({ itemInstanceId, itemId: plan.itemId, count: plan.eggRows, type: EGG_ITEM_TYPE }),
      ],
    );
  }

  private populateScanResult(result: GmCompatConversionRunResult, plans: EggGroupPlan[]): void {
    result.matchedRows = plans.reduce((sum, plan) => sum + plan.eggRows, 0);
    result.skippedRows = plans.filter((plan) => plan.blockedReason).reduce((sum, plan) => sum + plan.eggRows, 0);
    for (const plan of plans) {
      if (plan.blockedReason && !result.errors.includes(`${plan.blockedReason}:${plan.ownerPlayerId}`)) {
        result.errors.push(`${plan.blockedReason}:${plan.ownerPlayerId}`);
      }
      if (result.samples.length >= SAMPLE_LIMIT) continue;
      result.samples.push(buildSample(plan));
    }
  }

  private async verifyAppliedRows(
    pool: Pool,
    applied: AppliedGroup[],
    result: GmCompatConversionRunResult,
  ): Promise<number> {
    let verified = 0;
    for (const { plan, expectedTotal } of applied) {
      const remaining = await pool.query(
        `SELECT COUNT(*)::int AS count FROM spirit_beast_egg
          WHERE owner_player_id = $1 AND element = $2 AND star = $3 AND state = 'warehouse'`,
        [plan.ownerPlayerId, plan.element, plan.star],
      );
      const total = await pool.query(
        `SELECT COALESCE(SUM(count), 0)::bigint AS total FROM player_inventory_item
          WHERE player_id = $1 AND item_id = $2`,
        [plan.ownerPlayerId, plan.itemId],
      );
      const remainingRows = Math.trunc(Number(remaining.rows[0]?.count) || 0);
      const inventoryTotal = Math.trunc(Number(total.rows[0]?.total) || 0);
      if (remainingRows === 0 && inventoryTotal >= expectedTotal) {
        verified += plan.eggRows;
      } else {
        result.errors.push(`spirit_egg_migrate_verify_failed:${plan.ownerPlayerId}:${plan.itemId}`);
      }
    }
    return verified;
  }

  private async recordAudit(result: GmCompatConversionRunResult, options: GmCompatConversionRunOptions): Promise<void> {
    if (!this.gmAuditLogPersistenceService) {
      return;
    }
    try {
      await this.gmAuditLogPersistenceService.recordEntry({
        op: `gm.compat.${SPIRIT_BEAST_WAREHOUSE_EGGS_TO_INVENTORY_CONVERSION_ID}.${options.mode}`,
        targetType: 'compat_conversion',
        targetId: SPIRIT_BEAST_WAREHOUSE_EGGS_TO_INVENTORY_CONVERSION_ID,
        actor: options.actor ?? { tokenRev: null, ip: null, userAgent: null, receivedAt: Date.now() },
        before: { mode: options.mode, eggState: 'warehouse' },
        after: {
          itemType: EGG_ITEM_TYPE,
          matchedRows: result.matchedRows,
          convertedRows: result.convertedRows,
          skippedRows: result.skippedRows,
          failedRows: result.failedRows,
          verifiedRows: result.verifiedRows,
        },
        delta: { sampleIds: result.samples.map((sample) => sample.id), errors: result.errors.slice(0, 20) },
        success: result.failedRows === 0,
        errorMessage: result.failedRows === 0 ? null : result.errors.slice(0, 3).join('; '),
      });
    } catch (error) {
      this.logger.warn(`倉庫靈蛋轉背包審計寫入失敗：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function buildSample(plan: EggGroupPlan): GmCompatConversionSample {
  return {
    id: `${plan.ownerPlayerId}:${plan.itemId}`,
    name: plan.itemId,
    status: plan.blockedReason ?? 'convertible',
    before: { eggRows: plan.eggRows, stackCount: plan.existingCount },
    after: plan.blockedReason
      ? { eggRows: plan.eggRows }
      : { eggRows: 0, stackCount: plan.existingCount + plan.eggRows },
  };
}
