/**
 * 靈獸領域的 PostgreSQL 真源。
 *
 * 資產操作以 operation_id 冪等，同一交易鎖定蛋／獸／工單後再扣除與建立產物。
 * tick 不呼叫本服務；運行態只在啟動恢復、命令及受控 flush 邊界使用。
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { computeCraftSkillExpGain, SPIRIT_BEAST_RULES } from '@mud/shared';

import { DatabasePoolProvider } from './database-pool.provider';

export type SpiritElement = 'metal' | 'wood' | 'water' | 'fire' | 'earth';
export type SpiritGrade = 'fan' | 'human' | 'heaven' | 'saint' | 'immortal';
export type SpiritSkill = 'alchemy' | 'forging' | 'enhancement' | 'mining' | 'building' | 'planting';
export type SpiritBeastState = 'warehouse' | 'summoned' | 'working' | 'recalling' | 'locked';

export interface SpiritEggRow {
  eggId: string;
  ownerPlayerId: string;
  element: SpiritElement;
  star: number;
  state: 'warehouse' | 'incubating' | 'locked';
  hatchId: string | null;
  sourceRef: string | null;
  revision: number;
}

export interface SpiritBeastRow {
  beastId: string;
  ownerPlayerId: string;
  speciesId: string;
  grade: SpiritGrade;
  element: SpiritElement;
  star: number;
  baseCombatPower: number;
  skillLevels: Partial<Record<SpiritSkill, number>>;
  speedBonusPercent: number;
  state: SpiritBeastState;
  sectId: string | null;
  instanceId: string | null;
  x: number | null;
  y: number | null;
  facing: string | null;
  activeJobId: string | null;
  favorite: boolean;
  revision: number;
}

export interface SpiritHatchRow {
  hatchId: string;
  ownerPlayerId: string;
  eggId: string;
  buildingInstanceId: string;
  buildingId: string;
  incubatorElement: SpiritElement;
  eggElement: SpiritElement;
  eggStar: number;
  resultSpeciesId: string;
  resultGrade: SpiritGrade;
  resultCombatPower: number;
  totalTicks: number;
  remainingTicks: number;
  status: 'incubating' | 'ready' | 'adopted' | 'cancelled';
  pendingBeastId: string;
  revision: number;
}

export interface SpiritWorkOrderRow {
  orderId: string;
  ownerPlayerId: string;
  sectId: string;
  instanceId: string;
  buildingId: string;
  skill: SpiritSkill;
  action: string;
  payload: Record<string, unknown>;
  priority: number;
  status: 'queued' | 'reserved' | 'running' | 'waiting' | 'completed' | 'cancelled';
  workerKind: 'player' | 'spirit_beast' | null;
  workerId: string | null;
  jobRunId: string | null;
  totalTicks: number;
  remainingTicks: number;
  retryAfterTick: number;
  revision: number;
  createdAtMs: number;
}

export interface SpiritCropRow {
  cropId: string;
  ownerPlayerId: string;
  sectId: string;
  instanceId: string;
  buildingId: string;
  seedItemId: string;
  outputItemId: string;
  status: 'planned' | 'growing' | 'mature' | 'harvested' | 'cancelled';
  growthRemainingTicks: number;
  growthTotalTicks: number;
  wateringMask: number;
  repeatEnabled: boolean;
  revision: number;
}

export interface SpiritBeastRecoveryState {
  hatches: SpiritHatchRow[];
  beasts: SpiritBeastRow[];
  workOrders: SpiritWorkOrderRow[];
  crops: SpiritCropRow[];
}

export interface IdempotentResult<T> {
  replayed: boolean;
  result: T;
}

@Injectable()
export class SpiritBeastPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpiritBeastPersistenceService.name);
  private pool: Pool | null = null;
  private enabled = false;

  constructor(@Inject(DatabasePoolProvider) private readonly databasePoolProvider: DatabasePoolProvider) {}

  async onModuleInit(): Promise<void> {
    this.pool = this.databasePoolProvider.getPool('spirit-beast');
    if (!this.pool) {
      this.logger.warn('靈獸持久化已停用：缺少 SERVER_DATABASE_URL/DATABASE_URL；所有資產命令將 fail closed');
      return;
    }
    await ensureSpiritBeastTables(this.pool);
    this.enabled = true;
    this.logger.log('靈獸持久化已啟用');
  }

  onModuleDestroy(): void {
    this.pool = null;
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled && this.pool !== null;
  }

  private requirePool(): Pool {
    if (!this.pool || !this.enabled) {
      throw new Error('SPIRIT_BEAST_PERSISTENCE_UNAVAILABLE');
    }
    return this.pool;
  }

  async awardEgg(input: {
    sourceRef: string;
    ownerPlayerId: string;
    element: SpiritElement;
    star: number;
  }): Promise<{ awarded: boolean; egg: SpiritEggRow }> {
    const pool = this.requirePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const eggId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO spirit_beast_egg
          (egg_id, owner_player_id, element, star, state, source_ref, revision)
         VALUES ($1, $2, $3, $4, 'warehouse', $5, 1)
         ON CONFLICT (source_ref) DO NOTHING
         RETURNING *`,
        [eggId, input.ownerPlayerId, input.element, normalizeStar(input.star), input.sourceRef],
      );
      if (!inserted.rows[0]) {
        const existing = await client.query(`SELECT * FROM spirit_beast_egg WHERE source_ref=$1`, [input.sourceRef]);
        if (!existing.rows[0]) throw new Error('SPIRIT_EGG_DEDUPE_READ_FAILED');
        await client.query('COMMIT');
        return { awarded: false, egg: mapEggRow(existing.rows[0]) };
      }
      await client.query('COMMIT');
      return { awarded: true, egg: mapEggRow(inserted.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listPlayerEggs(ownerPlayerId: string): Promise<SpiritEggRow[]> {
    const result = await this.requirePool().query(
      `SELECT * FROM spirit_beast_egg WHERE owner_player_id = $1 ORDER BY created_at, egg_id`,
      [ownerPlayerId],
    );
    return result.rows.map(mapEggRow);
  }

  async listPlayerBeasts(ownerPlayerId: string): Promise<SpiritBeastRow[]> {
    const result = await this.requirePool().query(
      `SELECT * FROM spirit_beast_instance WHERE owner_player_id = $1 ORDER BY created_at, beast_id`,
      [ownerPlayerId],
    );
    return result.rows.map(mapBeastRow);
  }

  async listPlayerHatches(ownerPlayerId: string): Promise<SpiritHatchRow[]> {
    const result = await this.requirePool().query(
      `SELECT * FROM spirit_beast_hatch WHERE owner_player_id = $1 AND status <> 'cancelled' ORDER BY created_at, hatch_id`,
      [ownerPlayerId],
    );
    return result.rows.map(mapHatchRow);
  }

  async findCompletedOperation<T>(operationId: string, playerId: string, kind: string, request: unknown): Promise<T | null> {
    const normalizedOperationId = normalizeRequiredId(operationId, 'SPIRIT_OPERATION_ID_REQUIRED');
    const result = await this.requirePool().query(`SELECT player_id,kind,request_hash,status,result_json
      FROM spirit_beast_operation WHERE operation_id=$1`, [normalizedOperationId]);
    const row = result.rows[0];
    if (!row) return null;
    if (row.player_id !== playerId || row.kind !== kind || row.request_hash !== hashRequest(request)) {
      throw new Error('SPIRIT_OPERATION_CONFLICT');
    }
    return row.status === 'completed' ? row.result_json as T : null;
  }

  async startHatch(input: {
    operationId: string;
    ownerPlayerId: string;
    eggId: string;
    expectedEggRevision?: number;
    buildingInstanceId: string;
    buildingId: string;
    incubatorElement: SpiritElement;
    resultSpeciesId: string;
    resultGrade: SpiritGrade;
    resultCombatPower: number;
    totalTicks: number;
  }): Promise<IdempotentResult<SpiritHatchRow>> {
    const requestIdentity = {
      operationId: input.operationId, ownerPlayerId: input.ownerPlayerId, eggId: input.eggId,
      expectedEggRevision: input.expectedEggRevision, buildingInstanceId: input.buildingInstanceId,
      buildingId: input.buildingId, incubatorElement: input.incubatorElement, totalTicks: input.totalTicks,
    };
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'start_hatch', requestIdentity, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`spirit-incubator:${input.buildingInstanceId}:${input.buildingId}`]);
      const occupied = await client.query(
        `SELECT 1 FROM spirit_beast_hatch WHERE building_instance_id=$1 AND building_id=$2
          AND status IN ('incubating','ready') LIMIT 1`, [input.buildingInstanceId, input.buildingId],
      );
      if ((occupied.rowCount ?? 0) > 0) throw new Error('SPIRIT_INCUBATOR_OCCUPIED');
      const eggResult = await client.query(
        `SELECT * FROM spirit_beast_egg WHERE egg_id = $1 FOR UPDATE`,
        [input.eggId],
      );
      const egg = eggResult.rows[0] ? mapEggRow(eggResult.rows[0]) : null;
      if (!egg || egg.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_EGG_NOT_FOUND');
      if (egg.state !== 'warehouse') throw new Error('SPIRIT_EGG_NOT_AVAILABLE');
      if (input.expectedEggRevision !== undefined && egg.revision !== input.expectedEggRevision) {
        throw new Error('SPIRIT_EGG_REVISION_CONFLICT');
      }
      const hatchId = randomUUID();
      const pendingBeastId = randomUUID();
      const totalTicks = Math.max(1, Math.trunc(input.totalTicks));
      const inserted = await client.query(
        `INSERT INTO spirit_beast_hatch
          (hatch_id, owner_player_id, egg_id, building_instance_id, building_id,
           incubator_element, egg_element, egg_star, result_species_id, result_grade, result_combat_power,
           total_ticks, remaining_ticks, status, pending_beast_id, revision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,'incubating',$13,1)
         RETURNING *`,
        [hatchId, input.ownerPlayerId, input.eggId, input.buildingInstanceId, input.buildingId,
          input.incubatorElement, egg.element, egg.star, input.resultSpeciesId, input.resultGrade,
          Math.max(1, Math.trunc(input.resultCombatPower)), totalTicks, pendingBeastId],
      );
      await client.query(
        `UPDATE spirit_beast_egg SET state='incubating', hatch_id=$2, revision=revision+1, updated_at=now()
          WHERE egg_id=$1`,
        [input.eggId, hatchId],
      );
      return mapHatchRow(inserted.rows[0]);
    });
  }

  async adoptHatch(input: {
    operationId: string;
    ownerPlayerId: string;
    hatchId: string;
    expectedRevision?: number;
    element: SpiritElement;
    skillLevels: Partial<Record<SpiritSkill, number>>;
  }): Promise<IdempotentResult<SpiritBeastRow>> {
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'adopt_hatch', input, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`spirit-owner:${input.ownerPlayerId}`]);
      const hatchResult = await client.query(
        `SELECT * FROM spirit_beast_hatch WHERE hatch_id=$1 FOR UPDATE`, [input.hatchId],
      );
      const hatch = hatchResult.rows[0] ? mapHatchRow(hatchResult.rows[0]) : null;
      if (!hatch || hatch.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_HATCH_NOT_FOUND');
      if (hatch.status !== 'ready') throw new Error('SPIRIT_HATCH_NOT_READY');
      if (input.expectedRevision !== undefined && hatch.revision !== input.expectedRevision) {
        throw new Error('SPIRIT_HATCH_REVISION_CONFLICT');
      }
      const warehouseCount = await client.query(
        `SELECT COUNT(*) AS count FROM spirit_beast_instance WHERE owner_player_id=$1 AND state='warehouse'`,
        [input.ownerPlayerId],
      );
      if (Number(warehouseCount.rows[0]?.count ?? 0) >= 300) throw new Error('SPIRIT_BEAST_WAREHOUSE_FULL');
      const inserted = await client.query(
        `INSERT INTO spirit_beast_instance
          (beast_id, owner_player_id, species_id, grade, element, star, base_combat_power,
           skill_levels, speed_bonus_percent, state, revision)
         VALUES ($1,$2,$3,$4,$5,1,$6,$7::jsonb,0,'warehouse',1)
         RETURNING *`,
        [hatch.pendingBeastId, input.ownerPlayerId, hatch.resultSpeciesId, hatch.resultGrade,
          input.element, hatch.resultCombatPower, JSON.stringify(input.skillLevels)],
      );
      await client.query(
        `UPDATE spirit_beast_hatch SET status='adopted', revision=revision+1, updated_at=now() WHERE hatch_id=$1`,
        [input.hatchId],
      );
      await client.query(`DELETE FROM spirit_beast_egg WHERE egg_id=$1`, [hatch.eggId]);
      return mapBeastRow(inserted.rows[0]);
    });
  }

  async enhanceEgg(input: {
    operationId: string;
    ownerPlayerId: string;
    targetEggId: string;
    materialEggIds: string[];
    expectedTargetRevision?: number;
    success: boolean;
  }): Promise<IdempotentResult<{ success: boolean; target: SpiritEggRow }>> {
    const materialIds = normalizeDistinctIds(input.materialEggIds);
    if (materialIds.length !== 10 || materialIds.includes(input.targetEggId)) throw new Error('SPIRIT_EGG_MATERIAL_COUNT_INVALID');
    const lockIds = [input.targetEggId, ...materialIds].sort();
    const requestIdentity = { operationId: input.operationId, ownerPlayerId: input.ownerPlayerId,
      targetEggId: input.targetEggId, materialEggIds: [...materialIds].sort(),
      expectedTargetRevision: input.expectedTargetRevision };
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'enhance_egg', requestIdentity, async (client) => {
      const rows = await lockEggs(client, lockIds);
      const byId = new Map(rows.map((row) => [row.eggId, row]));
      const target = byId.get(input.targetEggId);
      if (!target || target.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_EGG_NOT_FOUND');
      if (target.state !== 'warehouse' || target.star >= 5) throw new Error('SPIRIT_EGG_NOT_ENHANCEABLE');
      if (input.expectedTargetRevision !== undefined && target.revision !== input.expectedTargetRevision) {
        throw new Error('SPIRIT_EGG_REVISION_CONFLICT');
      }
      for (const materialId of materialIds) {
        const material = byId.get(materialId);
        if (!material || material.ownerPlayerId !== input.ownerPlayerId || material.state !== 'warehouse') {
          throw new Error('SPIRIT_EGG_MATERIAL_NOT_AVAILABLE');
        }
        if (material.star !== target.star) throw new Error('SPIRIT_EGG_MATERIAL_STAR_MISMATCH');
      }
      await client.query(`DELETE FROM spirit_beast_egg WHERE egg_id = ANY($1::uuid[])`, [materialIds]);
      const updated = await client.query(
        `UPDATE spirit_beast_egg
            SET star=CASE WHEN $2 THEN star+1 ELSE star END, revision=revision+1, updated_at=now()
          WHERE egg_id=$1 RETURNING *`,
        [target.eggId, input.success],
      );
      return { success: input.success, target: mapEggRow(updated.rows[0]) };
    });
  }

  async cultivateBeast(input: {
    operationId: string;
    ownerPlayerId: string;
    targetBeastId: string;
    materialBeastIds: string[];
    expectedTargetRevision?: number;
    success: boolean;
  }): Promise<IdempotentResult<{ success: boolean; target: SpiritBeastRow }>> {
    const materialIds = normalizeDistinctIds(input.materialBeastIds);
    if (materialIds.length !== 10 || materialIds.includes(input.targetBeastId)) throw new Error('SPIRIT_BEAST_MATERIAL_COUNT_INVALID');
    const lockIds = [input.targetBeastId, ...materialIds].sort();
    const requestIdentity = { operationId: input.operationId, ownerPlayerId: input.ownerPlayerId,
      targetBeastId: input.targetBeastId, materialBeastIds: [...materialIds].sort(),
      expectedTargetRevision: input.expectedTargetRevision };
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'cultivate_beast', requestIdentity, async (client) => {
      const rows = await lockBeasts(client, lockIds);
      const byId = new Map(rows.map((row) => [row.beastId, row]));
      const target = byId.get(input.targetBeastId);
      if (!target || target.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_BEAST_NOT_FOUND');
      if (target.state !== 'warehouse' || target.star >= 5) throw new Error('SPIRIT_BEAST_NOT_CULTIVATABLE');
      if (input.expectedTargetRevision !== undefined && target.revision !== input.expectedTargetRevision) {
        throw new Error('SPIRIT_BEAST_REVISION_CONFLICT');
      }
      for (const materialId of materialIds) {
        const material = byId.get(materialId);
        if (!material || material.ownerPlayerId !== input.ownerPlayerId || material.state !== 'warehouse' || material.favorite) {
          throw new Error('SPIRIT_BEAST_MATERIAL_NOT_AVAILABLE');
        }
        if (material.grade !== target.grade) throw new Error('SPIRIT_BEAST_MATERIAL_GRADE_MISMATCH');
        if (material.star !== target.star) throw new Error('SPIRIT_BEAST_MATERIAL_STAR_MISMATCH');
      }
      await client.query(`DELETE FROM spirit_beast_instance WHERE beast_id = ANY($1::uuid[])`, [materialIds]);
      const updated = await client.query(
        `UPDATE spirit_beast_instance
            SET star=CASE WHEN $2 THEN star+1 ELSE star END,
                base_combat_power=CASE WHEN $2 THEN GREATEST(1, ROUND(base_combat_power*1.3)) ELSE base_combat_power END,
                skill_levels=CASE WHEN $2 THEN spirit_beast_add_skill_levels(skill_levels, 5) ELSE skill_levels END,
                speed_bonus_percent=CASE WHEN $2 THEN speed_bonus_percent+10 ELSE speed_bonus_percent END,
                revision=revision+1, updated_at=now()
          WHERE beast_id=$1 RETURNING *`,
        [target.beastId, input.success],
      );
      return { success: input.success, target: mapBeastRow(updated.rows[0]) };
    });
  }

  async fuseBeasts(input: {
    operationId: string;
    ownerPlayerId: string;
    parentBeastIds: [string, string];
    childSpeciesId: string;
    childGrade: SpiritGrade;
    childElement: SpiritElement;
    childCombatPower: number;
    childSkillLevels: Partial<Record<SpiritSkill, number>>;
  }): Promise<IdempotentResult<SpiritBeastRow>> {
    const parentIds = normalizeDistinctIds(input.parentBeastIds);
    if (parentIds.length !== 2) throw new Error('SPIRIT_FUSION_PARENT_INVALID');
    const requestIdentity = { operationId: input.operationId, ownerPlayerId: input.ownerPlayerId,
      parentBeastIds: [...parentIds].sort() };
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'fuse_beasts', requestIdentity, async (client) => {
      const parents = await lockBeasts(client, parentIds.sort());
      if (parents.length !== 2) throw new Error('SPIRIT_FUSION_PARENT_NOT_FOUND');
      for (const parent of parents) {
        if (parent.ownerPlayerId !== input.ownerPlayerId || parent.state !== 'warehouse' || parent.favorite
          || parent.star !== SPIRIT_BEAST_RULES.fusionParentStar || parent.grade === 'immortal') {
          throw new Error('SPIRIT_FUSION_PARENT_NOT_AVAILABLE');
        }
      }
      if (parents[0].grade !== parents[1].grade) throw new Error('SPIRIT_FUSION_GRADE_MISMATCH');
      await client.query(`DELETE FROM spirit_beast_instance WHERE beast_id = ANY($1::uuid[])`, [parentIds]);
      const childId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO spirit_beast_instance
          (beast_id, owner_player_id, species_id, grade, element, star, base_combat_power,
           skill_levels, speed_bonus_percent, state, revision)
         VALUES ($1,$2,$3,$4,$5,$8,$6,$7::jsonb,0,'warehouse',1) RETURNING *`,
        [childId, input.ownerPlayerId, input.childSpeciesId, input.childGrade, input.childElement,
          Math.max(1, Math.trunc(input.childCombatPower)), JSON.stringify(input.childSkillLevels), SPIRIT_BEAST_RULES.fusionOutputStar],
      );
      return mapBeastRow(inserted.rows[0]);
    });
  }

  async summonBeast(input: {
    operationId: string;
    ownerPlayerId: string;
    beastId: string;
    expectedRevision?: number;
    sectId: string;
    instanceId: string;
    x: number;
    y: number;
    facing?: string;
    ownerLimit: number;
    sectLimit: number;
  }): Promise<IdempotentResult<SpiritBeastRow>> {
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'summon_beast', input, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`spirit-sect:${input.sectId}`]);
      const beastResult = await client.query(`SELECT * FROM spirit_beast_instance WHERE beast_id=$1 FOR UPDATE`, [input.beastId]);
      const beast = beastResult.rows[0] ? mapBeastRow(beastResult.rows[0]) : null;
      if (!beast || beast.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_BEAST_NOT_FOUND');
      if (beast.state !== 'warehouse') throw new Error('SPIRIT_BEAST_NOT_SUMMONABLE');
      if (input.expectedRevision !== undefined && beast.revision !== input.expectedRevision) throw new Error('SPIRIT_BEAST_REVISION_CONFLICT');
      const counts = await client.query(
        `SELECT COUNT(*) FILTER (WHERE owner_player_id=$1) AS owner_count, COUNT(*) AS sect_count
           FROM spirit_beast_instance WHERE sect_id=$2 AND state IN ('summoned','working','recalling')`,
        [input.ownerPlayerId, input.sectId],
      );
      if (Number(counts.rows[0]?.owner_count ?? 0) >= input.ownerLimit) throw new Error('SPIRIT_BEAST_OWNER_SUMMON_LIMIT');
      if (Number(counts.rows[0]?.sect_count ?? 0) >= input.sectLimit) throw new Error('SPIRIT_BEAST_SECT_SUMMON_LIMIT');
      const updated = await client.query(
        `UPDATE spirit_beast_instance SET state='summoned', sect_id=$2, instance_id=$3, x=$4, y=$5,
          facing=$6, revision=revision+1, updated_at=now() WHERE beast_id=$1 RETURNING *`,
        [input.beastId, input.sectId, input.instanceId, Math.trunc(input.x), Math.trunc(input.y), input.facing ?? 'down'],
      );
      return mapBeastRow(updated.rows[0]);
    });
  }

  async recallBeast(input: { operationId: string; ownerPlayerId: string; beastId: string }): Promise<IdempotentResult<SpiritBeastRow>> {
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'recall_beast', input, async (client) => {
      const locked = await client.query(`SELECT * FROM spirit_beast_instance WHERE beast_id=$1 FOR UPDATE`, [input.beastId]);
      const beast = locked.rows[0] ? mapBeastRow(locked.rows[0]) : null;
      if (!beast || beast.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_BEAST_NOT_FOUND');
      if (beast.activeJobId) {
        await client.query(
          `UPDATE spirit_beast_work_order SET status='waiting', worker_kind=NULL, worker_id=NULL,
             job_run_id=NULL, retry_after_tick=0, revision=revision+1, updated_at=now()
           WHERE order_id=$1 AND status IN ('reserved','running')`,
          [beast.activeJobId],
        );
      }
      const updated = await client.query(
        `UPDATE spirit_beast_instance SET state='warehouse', sect_id=NULL, instance_id=NULL, x=NULL, y=NULL,
          facing=NULL, active_job_id=NULL, revision=revision+1, updated_at=now() WHERE beast_id=$1 RETURNING *`,
        [input.beastId],
      );
      return mapBeastRow(updated.rows[0]);
    });
  }

  async setBeastProtected(input: {
    operationId: string;
    ownerPlayerId: string;
    beastId: string;
    protected: boolean;
    expectedRevision?: number;
  }): Promise<IdempotentResult<SpiritBeastRow>> {
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'protect_beast', input, async (client) => {
      const locked = await client.query(`SELECT * FROM spirit_beast_instance WHERE beast_id=$1 FOR UPDATE`, [input.beastId]);
      const beast = locked.rows[0] ? mapBeastRow(locked.rows[0]) : null;
      if (!beast || beast.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_BEAST_NOT_FOUND');
      if (beast.state === 'locked') throw new Error('SPIRIT_BEAST_NOT_AVAILABLE');
      if (input.expectedRevision !== undefined && beast.revision !== input.expectedRevision) throw new Error('SPIRIT_BEAST_REVISION_CONFLICT');
      const updated = await client.query(
        `UPDATE spirit_beast_instance SET favorite=$2, revision=revision+1, updated_at=now() WHERE beast_id=$1 RETURNING *`,
        [input.beastId, input.protected],
      );
      return mapBeastRow(updated.rows[0]);
    });
  }

  async cancelHatch(input: {
    operationId: string;
    ownerPlayerId: string;
    hatchId: string;
  }): Promise<IdempotentResult<SpiritEggRow>> {
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'cancel_hatch', input, async (client) => {
      const locked = await client.query(`SELECT * FROM spirit_beast_hatch WHERE hatch_id=$1 FOR UPDATE`, [input.hatchId]);
      const hatch = locked.rows[0] ? mapHatchRow(locked.rows[0]) : null;
      if (!hatch || hatch.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_HATCH_NOT_FOUND');
      if (hatch.status !== 'incubating') throw new Error('SPIRIT_HATCH_NOT_CANCELLABLE');
      const eggResult = await client.query(`DELETE FROM spirit_beast_egg WHERE egg_id=$1 AND owner_player_id=$2 RETURNING *`,
        [hatch.eggId, input.ownerPlayerId]);
      if (!eggResult.rows[0]) throw new Error('SPIRIT_EGG_NOT_FOUND');
      await client.query(`UPDATE spirit_beast_hatch SET status='cancelled', revision=revision+1, updated_at=now() WHERE hatch_id=$1`, [hatch.hatchId]);
      return mapEggRow(eggResult.rows[0]);
    });
  }

  async createWorkOrder(input: Omit<SpiritWorkOrderRow, 'status' | 'workerKind' | 'workerId' | 'jobRunId' | 'remainingTicks' | 'retryAfterTick' | 'revision' | 'createdAtMs'> & {
    operationId: string; requestIdentity?: unknown;
  }): Promise<IdempotentResult<SpiritWorkOrderRow>> {
    const { orderId: _generatedOrderId, requestIdentity: explicitIdentity, ...derivedIdentity } = input;
    const requestIdentity = explicitIdentity ?? derivedIdentity;
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'create_work_order', requestIdentity, async (client) => {
      const count = await client.query(
        `SELECT COUNT(*) AS count FROM spirit_beast_work_order WHERE building_id=$1 AND status IN ('queued','reserved','running','waiting')`,
        [input.buildingId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= 20) throw new Error('SPIRIT_WORK_ORDER_LIMIT');
      const inserted = await client.query(
        `INSERT INTO spirit_beast_work_order
          (order_id, owner_player_id, sect_id, instance_id, building_id, skill, action, payload,
           priority, status, total_ticks, remaining_ticks, revision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'queued',$10,$10,1) RETURNING *`,
        [input.orderId, input.ownerPlayerId, input.sectId, input.instanceId, input.buildingId,
          input.skill, input.action, JSON.stringify(input.payload), Math.trunc(input.priority), Math.max(1, Math.trunc(input.totalTicks))],
      );
      return mapWorkOrderRow(inserted.rows[0]);
    });
  }

  async ensureConstructionWorkOrder(input: {
    ownerPlayerId: string; sectId: string; instanceId: string; buildingId: string;
    x: number; y: number; totalWork: number; buildingRevision: number;
  }): Promise<SpiritWorkOrderRow> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`spirit-construction:${input.instanceId}:${input.buildingId}`]);
      const existing = await client.query(`SELECT * FROM spirit_beast_work_order WHERE instance_id=$1 AND building_id=$2
        AND action='construct' AND status IN ('queued','reserved','running','waiting') ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [input.instanceId, input.buildingId]);
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return mapWorkOrderRow(existing.rows[0]);
      }
      const totalTicks = Math.max(1, Math.ceil(Number(input.totalWork) || 1));
      const inserted = await client.query(`INSERT INTO spirit_beast_work_order
        (order_id,owner_player_id,sect_id,instance_id,building_id,skill,action,payload,priority,status,total_ticks,remaining_ticks,revision)
        VALUES ($1,$2,$3,$4,$5,'building','construct',$6::jsonb,70,'queued',$7,$7,1) RETURNING *`,
        [randomUUID(), input.ownerPlayerId, input.sectId, input.instanceId, input.buildingId,
          JSON.stringify({ x: input.x, y: input.y, targetBuildingId: input.buildingId,
            buildWorkTotal: totalTicks, buildingRevision: input.buildingRevision }), totalTicks]);
      await client.query('COMMIT');
      return mapWorkOrderRow(inserted.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createCropPlan(input: {
    operationId: string; cropId: string; ownerPlayerId: string; sectId: string; instanceId: string; buildingId: string;
    seedItemId: string; outputItemId: string; growthTicks: number; repeatEnabled: boolean;
  }): Promise<IdempotentResult<SpiritCropRow>> {
    const { cropId: _generatedCropId, ...requestIdentity } = input;
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'create_crop_plan', requestIdentity, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`spirit-field:${input.instanceId}:${input.buildingId}`]);
      const occupied = await client.query(`SELECT 1 FROM spirit_beast_crop WHERE instance_id=$1 AND building_id=$2
        AND status IN ('planned','growing','mature') LIMIT 1`, [input.instanceId, input.buildingId]);
      if ((occupied.rowCount ?? 0) > 0) throw new Error('SPIRIT_FIELD_OCCUPIED');
      const inserted = await client.query(
        `INSERT INTO spirit_beast_crop(crop_id,owner_player_id,sect_id,instance_id,building_id,seed_item_id,output_item_id,
          status,growth_remaining_ticks,growth_total_ticks,watering_mask,repeat_enabled,revision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',$8,$8,0,$9,1) RETURNING *`,
        [input.cropId, input.ownerPlayerId, input.sectId, input.instanceId, input.buildingId, input.seedItemId,
          input.outputItemId, Math.max(1, Math.trunc(input.growthTicks)), input.repeatEnabled],
      );
      return mapCropRow(inserted.rows[0]);
    });
  }

  async cancelCrop(input: { operationId: string; ownerPlayerId: string; cropId: string }): Promise<IdempotentResult<SpiritCropRow>> {
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'cancel_crop', input, async (client) => {
      const result = await client.query(`SELECT * FROM spirit_beast_crop WHERE crop_id=$1 FOR UPDATE`, [input.cropId]);
      const crop = result.rows[0] ? mapCropRow(result.rows[0]) : null;
      if (!crop || crop.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_CROP_NOT_FOUND');
      if (crop.status === 'cancelled' || crop.status === 'harvested') return crop;
      const orders = await client.query(`SELECT order_id,worker_id FROM spirit_beast_work_order WHERE payload->>'cropId'=$1
        AND status IN ('queued','waiting','reserved','running') FOR UPDATE`, [crop.cropId]);
      for (const order of orders.rows) {
        if (order.worker_id) await client.query(`UPDATE spirit_beast_instance SET state='summoned',active_job_id=NULL,
          revision=revision+1,updated_at=now() WHERE beast_id=$1 AND active_job_id=$2`, [order.worker_id, order.order_id]);
      }
      await client.query(`UPDATE spirit_beast_work_order SET status='cancelled',worker_kind=NULL,worker_id=NULL,job_run_id=NULL,
        revision=revision+1,updated_at=now() WHERE payload->>'cropId'=$1 AND status IN ('queued','waiting','reserved','running')`, [crop.cropId]);
      const updated = await client.query(`UPDATE spirit_beast_crop SET status='cancelled',revision=revision+1,updated_at=now()
        WHERE crop_id=$1 RETURNING *`, [crop.cropId]);
      return mapCropRow(updated.rows[0]);
    });
  }

  async reserveWorkOrder(input: {
    orderId: string;
    beastId: string;
    jobRunId: string;
    expectedOrderRevision: number;
    expectedBeastRevision: number;
  }): Promise<{ order: SpiritWorkOrderRow; beast: SpiritBeastRow } | null> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const [first, second] = [`beast:${input.beastId}`, `order:${input.orderId}`].sort();
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [first]);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [second]);
      const beastResult = await client.query(`SELECT * FROM spirit_beast_instance WHERE beast_id=$1 FOR UPDATE`, [input.beastId]);
      const orderResult = await client.query(`SELECT * FROM spirit_beast_work_order WHERE order_id=$1 FOR UPDATE`, [input.orderId]);
      const beast = beastResult.rows[0] ? mapBeastRow(beastResult.rows[0]) : null;
      const order = orderResult.rows[0] ? mapWorkOrderRow(orderResult.rows[0]) : null;
      if (!beast || !order || beast.revision !== input.expectedBeastRevision || order.revision !== input.expectedOrderRevision
        || beast.state !== 'summoned' || beast.activeJobId || !['queued', 'waiting'].includes(order.status)
        || beast.sectId !== order.sectId || beast.instanceId !== order.instanceId) {
        await client.query('ROLLBACK');
        return null;
      }
      const updatedBeast = await client.query(
        `UPDATE spirit_beast_instance SET state='working', active_job_id=$2, revision=revision+1, updated_at=now()
          WHERE beast_id=$1 RETURNING *`, [beast.beastId, order.orderId],
      );
      const updatedOrder = await client.query(
        `UPDATE spirit_beast_work_order SET status='running', worker_kind='spirit_beast', worker_id=$2,
          job_run_id=$3, revision=revision+1, updated_at=now() WHERE order_id=$1 RETURNING *`,
        [order.orderId, beast.beastId, input.jobRunId],
      );
      await client.query('COMMIT');
      return { beast: mapBeastRow(updatedBeast.rows[0]), order: mapWorkOrderRow(updatedOrder.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reservePlayerWorkOrder(input: {
    orderId: string;
    ownerPlayerId: string;
    expectedRevision: number;
  }): Promise<SpiritWorkOrderRow | null> {
    const result = await this.requirePool().query(
      `UPDATE spirit_beast_work_order SET status='running', worker_kind='player', worker_id=$2,
         job_run_id=$1, revision=revision+1, updated_at=now()
       WHERE order_id=$1 AND owner_player_id=$2 AND revision=$3 AND status IN ('queued','waiting')
       RETURNING *`, [input.orderId, input.ownerPlayerId, input.expectedRevision],
    );
    return result.rows[0] ? mapWorkOrderRow(result.rows[0]) : null;
  }

  async releasePlayerWorkOrder(input: { orderId: string; ownerPlayerId: string }): Promise<SpiritWorkOrderRow | null> {
    const result = await this.requirePool().query(
      `UPDATE spirit_beast_work_order SET status='waiting',worker_kind=NULL,worker_id=NULL,job_run_id=NULL,
        revision=revision+1,updated_at=now() WHERE order_id=$1 AND owner_player_id=$2 AND worker_kind='player' RETURNING *`,
      [input.orderId, input.ownerPlayerId],
    );
    return result.rows[0] ? mapWorkOrderRow(result.rows[0]) : null;
  }

  async cancelWorkOrder(input: {
    operationId: string;
    ownerPlayerId: string;
    orderId: string;
  }): Promise<IdempotentResult<SpiritWorkOrderRow>> {
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'cancel_work_order', input, async (client) => {
      const locked = await client.query(`SELECT * FROM spirit_beast_work_order WHERE order_id=$1 FOR UPDATE`, [input.orderId]);
      const order = locked.rows[0] ? mapWorkOrderRow(locked.rows[0]) : null;
      if (!order || order.ownerPlayerId !== input.ownerPlayerId) throw new Error('SPIRIT_WORK_ORDER_NOT_FOUND');
      if (['completed', 'cancelled'].includes(order.status)) return order;
      if (order.workerKind === 'spirit_beast' && order.workerId) {
        await client.query(
          `UPDATE spirit_beast_instance SET state='summoned', active_job_id=NULL, revision=revision+1, updated_at=now()
            WHERE beast_id=$1 AND active_job_id=$2`, [order.workerId, order.orderId],
        );
      }
      const updated = await client.query(
        `UPDATE spirit_beast_work_order SET status='cancelled', worker_kind=NULL, worker_id=NULL, job_run_id=NULL,
          revision=revision+1, updated_at=now() WHERE order_id=$1 RETURNING *`, [order.orderId],
      );
      return mapWorkOrderRow(updated.rows[0]);
    });
  }

  async completeWorkOrder(input: {
    orderId: string;
    expectedRevision: number;
    outputItemId?: string;
    outputCount?: number;
    outputRawPayload?: Record<string, unknown>;
    inputRequirements?: Array<{ itemId: string; count: number }>;
    enhancementSuccessRate?: number;
    craftSuccessRate?: number;
    craftAttempts?: number;
    outputCountPerSuccess?: number;
    professionReward?: { professionType: SpiritSkill; playerRealmLevel: number; skillLevel: number; targetLevel: number;
      baseActionTicks: number; fallbackExp: number; expToNextByLevel: Record<string, number> };
  }): Promise<{ order: SpiritWorkOrderRow; beast: SpiritBeastRow | null; crop: SpiritCropRow | null; settled: boolean;
    professionState: { level: number; exp: number; expToNext: number } | null }> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(`SELECT * FROM spirit_beast_work_order WHERE order_id=$1 FOR UPDATE`, [input.orderId]);
      const order = locked.rows[0] ? mapWorkOrderRow(locked.rows[0]) : null;
      if (!order) throw new Error('SPIRIT_WORK_ORDER_NOT_FOUND');
      if (input.professionReward) {
        await client.query(`SELECT pg_advisory_xact_lock($1::integer,hashtext($2))`, [7101, order.ownerPlayerId]);
      }
      if (Number(order.payload.lastSettledExpectedRevision) === input.expectedRevision
        && (order.status === 'completed' || order.status === 'waiting')) {
        let replayBeast: SpiritBeastRow | null = null;
        if (order.payload.lastWorkerKind === 'spirit_beast' && typeof order.payload.lastWorkerId === 'string') {
          const beastResult = await client.query(`SELECT * FROM spirit_beast_instance WHERE beast_id=$1`, [order.payload.lastWorkerId]);
          replayBeast = beastResult.rows[0] ? mapBeastRow(beastResult.rows[0]) : null;
        }
        let replayCrop: SpiritCropRow | null = null;
        if (typeof order.payload.cropId === 'string') {
          const cropResult = await client.query(`SELECT * FROM spirit_beast_crop WHERE crop_id=$1`, [order.payload.cropId]);
          replayCrop = cropResult.rows[0] ? mapCropRow(cropResult.rows[0]) : null;
        }
        let replayProfessionState: { level: number; exp: number; expToNext: number } | null = null;
        if (order.payload.lastWorkerKind === 'player') {
          const professionResult = await client.query(`SELECT level,exp,exp_to_next FROM player_profession_state
            WHERE player_id=$1 AND profession_type=$2`, [order.ownerPlayerId, order.skill]);
          const row = professionResult.rows[0];
          if (row) replayProfessionState = { level: Math.max(1, Number(row.level)), exp: Math.max(0, Number(row.exp) || 0),
            expToNext: Math.max(1, Number(row.exp_to_next) || 1) };
        }
        await client.query('COMMIT');
        return { order, beast: replayBeast, crop: replayCrop, settled: false, professionState: replayProfessionState };
      }
      if (order.status === 'completed') {
        await client.query('COMMIT');
        return { order, beast: null, crop: null, settled: false, professionState: null };
      }
      if (order.status !== 'running' || order.revision !== input.expectedRevision) throw new Error('SPIRIT_WORK_ORDER_REVISION_CONFLICT');
      let enhancementTarget: Record<string, unknown> | null = null;
      let enhancementRaw: Record<string, unknown> | null = null;
      let enhancementCurrentLevel = 0;
      let enhancementTargetLevel = 0;
      let enhancementStoneCost = 0;
      let requirements = input.inputRequirements ?? [];
      if (order.action === 'enhance') {
        const targetStorageId = String(order.payload.targetStorageId ?? '');
        const targetResult = await client.query(`SELECT * FROM spirit_beast_facility_storage WHERE storage_id=$1
          AND owner_player_id=$2 AND instance_id=$3 AND building_id=$4 AND claimed_at IS NULL FOR UPDATE`,
          [targetStorageId, order.ownerPlayerId, order.instanceId, order.buildingId]);
        enhancementTarget = targetResult.rows[0] ?? null;
        if (!enhancementTarget) throw new Error('SPIRIT_ENHANCEMENT_TARGET_NOT_FOUND');
        enhancementRaw = normalizeRecord(enhancementTarget.raw_payload);
        enhancementCurrentLevel = Math.max(0, Math.trunc(Number(enhancementRaw.enhanceLevel) || 0));
        enhancementTargetLevel = enhancementCurrentLevel + 1;
        const schedule = normalizeRecord(order.payload.materialSchedule);
        requirements = normalizeMaterialRequirements(schedule[String(enhancementTargetLevel)]);
        const stoneSchedule = normalizeRecord(order.payload.spiritStoneSchedule);
        enhancementStoneCost = Math.max(1, Math.trunc(Number(stoneSchedule[String(enhancementTargetLevel)]) || 1));
        const spent = Math.max(0, Math.trunc(Number(order.payload.spentSpiritStones) || 0));
        const max = Math.max(0, Math.trunc(Number(order.payload.maxSpiritStones) || Number.MAX_SAFE_INTEGER));
        if (spent + enhancementStoneCost > max) throw new Error('SPIRIT_ENHANCEMENT_SPIRIT_STONE_BUDGET');
      }
      for (const requirement of requirements) {
        let remaining = Math.max(0, Math.trunc(Number(requirement.count) || 0));
        if (remaining <= 0) continue;
        const rows = await client.query(
          `SELECT storage_id, count FROM spirit_beast_facility_storage
            WHERE owner_player_id=$1 AND instance_id=$2 AND building_id=$3 AND item_id=$4 AND claimed_at IS NULL
            ORDER BY created_at, storage_id FOR UPDATE`,
          [order.ownerPlayerId, order.instanceId, order.buildingId, requirement.itemId],
        );
        if (rows.rows.reduce((sum, row) => sum + Math.max(0, Number(row.count) || 0), 0) < remaining) {
          throw new Error('SPIRIT_WORK_ORDER_INPUT_SHORTAGE');
        }
        for (const row of rows.rows) {
          if (remaining <= 0) break;
          const available = Math.max(0, Math.trunc(Number(row.count) || 0));
          const consumed = Math.min(available, remaining);
          if (consumed === available) {
            await client.query(`UPDATE spirit_beast_facility_storage SET claimed_at=now() WHERE storage_id=$1`, [row.storage_id]);
          } else {
            await client.query(`UPDATE spirit_beast_facility_storage SET count=count-$2 WHERE storage_id=$1`, [row.storage_id, consumed]);
          }
          remaining -= consumed;
        }
      }
      let enhancementRepeat = false;
      let enhancementSucceeded: boolean | null = null;
      if (order.action === 'enhance') {
        const targetStorageId = String(order.payload.targetStorageId ?? '');
        const target = enhancementTarget!;
        const raw = enhancementRaw!;
        const currentLevel = enhancementCurrentLevel;
        const targetLevel = enhancementTargetLevel;
        const success = Math.random() < Math.max(0, Math.min(1, Number(input.enhancementSuccessRate) || 0));
        enhancementSucceeded = success;
        let resultingLevel = 0;
        let spentSpiritStones = Math.max(0, Math.trunc(Number(order.payload.spentSpiritStones) || 0));
        if (success) {
          const cost = enhancementStoneCost;
          let remaining = cost;
          const stones = await client.query(`SELECT storage_id,count FROM spirit_beast_facility_storage WHERE owner_player_id=$1
            AND instance_id=$2 AND building_id=$3 AND item_id='spirit_stone' AND claimed_at IS NULL ORDER BY created_at FOR UPDATE`,
            [order.ownerPlayerId, order.instanceId, order.buildingId]);
          if (stones.rows.reduce((sum, row) => sum + Number(row.count), 0) < cost) throw new Error('SPIRIT_STONE_SHORTAGE');
          for (const stone of stones.rows) {
            if (remaining <= 0) break;
            const consumed = Math.min(remaining, Number(stone.count)); remaining -= consumed;
            if (consumed === Number(stone.count)) await client.query(`UPDATE spirit_beast_facility_storage SET claimed_at=now() WHERE storage_id=$1`, [stone.storage_id]);
            else await client.query(`UPDATE spirit_beast_facility_storage SET count=count-$2 WHERE storage_id=$1`, [stone.storage_id, consumed]);
          }
          resultingLevel = targetLevel;
          spentSpiritStones += cost;
        }
        raw.enhanceLevel = resultingLevel;
        raw.name = String(raw.name ?? target.item_id).replace(/^\+\d+\s+/, '');
        if (resultingLevel > 0) raw.name = `+${resultingLevel} ${raw.name}`;
        await client.query(`UPDATE spirit_beast_facility_storage SET raw_payload=$2::jsonb WHERE storage_id=$1`,
          [targetStorageId, JSON.stringify(raw)]);
        const attempts = Math.max(0, Math.trunc(Number(order.payload.attempts) || 0)) + 1;
        const desired = Math.max(1, Math.trunc(Number(order.payload.desiredTargetLevel) || 1));
        const maxAttempts = Math.max(1, Math.trunc(Number(order.payload.maxAttempts) || 1));
        const nextTargetLevel = resultingLevel + 1;
        const stoneSchedule = normalizeRecord(order.payload.spiritStoneSchedule);
        const nextStoneCost = Math.max(1, Math.trunc(Number(stoneSchedule[String(nextTargetLevel)]) || 1));
        const maxSpiritStones = Math.max(0, Math.trunc(Number(order.payload.maxSpiritStones) || Number.MAX_SAFE_INTEGER));
        enhancementRepeat = resultingLevel < desired && attempts < maxAttempts
          && spentSpiritStones + nextStoneCost <= maxSpiritStones;
        order.payload = { ...order.payload, attempts, currentLevel: resultingLevel, spentSpiritStones,
          lastAttemptSucceeded: success };
        await client.query(`UPDATE spirit_beast_work_order SET payload=$2::jsonb WHERE order_id=$1`,
          [order.orderId, JSON.stringify(order.payload)]);
      }
      let settledOutputCount = Math.max(0, Math.trunc(Number(input.outputCount) || 0));
      let craftSuccesses: number | null = null;
      if (order.action === 'craft') {
        const attempts = Math.max(1, Math.trunc(Number(input.craftAttempts) || 1));
        const successRate = Math.max(0, Math.min(1, Number(input.craftSuccessRate) || 0));
        let successes = 0;
        for (let attempt = 0; attempt < attempts; attempt += 1) if (Math.random() < successRate) successes += 1;
        craftSuccesses = successes;
        settledOutputCount = successes * Math.max(1, Math.trunc(Number(input.outputCountPerSuccess) || 1));
      }
      if (input.outputItemId && settledOutputCount > 0) {
        await client.query(
          `INSERT INTO spirit_beast_facility_storage
            (storage_id, owner_player_id, instance_id, building_id, item_id, count, source_order_id, raw_payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
           ON CONFLICT (source_order_id, item_id) DO UPDATE SET
             count=spirit_beast_facility_storage.count+EXCLUDED.count, claimed_at=NULL,
             raw_payload=EXCLUDED.raw_payload`,
          [randomUUID(), order.ownerPlayerId, order.instanceId, order.buildingId, input.outputItemId,
            settledOutputCount, order.orderId,
            JSON.stringify({ ...(input.outputRawPayload ?? {}), itemId: input.outputItemId,
              count: settledOutputCount })],
        );
      }
      let beast: SpiritBeastRow | null = null;
      let crop: SpiritCropRow | null = null;
      if (order.workerKind === 'spirit_beast' && order.workerId) {
        const beastResult = await client.query(
          `UPDATE spirit_beast_instance SET state='summoned', active_job_id=NULL, revision=revision+1, updated_at=now()
            WHERE beast_id=$1 AND active_job_id=$2 RETURNING *`, [order.workerId, order.orderId],
        );
        beast = beastResult.rows[0] ? mapBeastRow(beastResult.rows[0]) : null;
      }
      const cropId = typeof order.payload.cropId === 'string' ? order.payload.cropId : '';
      if (cropId && ['sow','water','harvest'].includes(order.action)) {
        const cropResult = await client.query(
          `UPDATE spirit_beast_crop SET
             status=CASE WHEN $2='sow' THEN 'growing' WHEN $2='harvest' AND repeat_enabled THEN 'planned'
               WHEN $2='harvest' THEN 'harvested' ELSE status END,
             growth_remaining_ticks=CASE WHEN $2='harvest' AND repeat_enabled THEN growth_total_ticks ELSE growth_remaining_ticks END,
             watering_mask=CASE WHEN $2='harvest' AND repeat_enabled THEN 0
               WHEN $2='water' THEN LEAST(3,watering_mask+1) ELSE watering_mask END,
             revision=revision+1,updated_at=now()
           WHERE crop_id=$1 AND owner_player_id=$3 RETURNING *`, [cropId, order.action, order.ownerPlayerId],
        );
        crop = cropResult.rows[0] ? mapCropRow(cropResult.rows[0]) : null;
      }
      const repeat = order.payload.repeat === true || order.payload.manualRepeat === true || enhancementRepeat;
      order.payload = { ...order.payload, lastSettledExpectedRevision: input.expectedRevision,
        lastWorkerKind: order.workerKind, lastWorkerId: order.workerId };
      const updated = await client.query(
        `UPDATE spirit_beast_work_order SET status=$2, remaining_ticks=$3, worker_kind=NULL, worker_id=NULL,
          job_run_id=NULL, payload=$4::jsonb, revision=revision+1, updated_at=now() WHERE order_id=$1 RETURNING *`,
        [order.orderId, repeat ? 'waiting' : 'completed', repeat ? order.totalTicks : 0, JSON.stringify(order.payload)],
      );
      let professionState: { level: number; exp: number; expToNext: number } | null = null;
      if (input.professionReward) {
        const reward = input.professionReward;
        const attempts = order.action === 'craft' ? Math.max(1, Math.trunc(Number(input.craftAttempts) || 1)) : 1;
        const successCount = craftSuccesses ?? (enhancementSucceeded === false ? 0 : 1);
        const failureCount = order.action === 'craft' ? Math.max(0, attempts - successCount) : enhancementSucceeded === false ? 1 : 0;
        const gain = computeCraftSkillExpGain({ playerRealmLevel: reward.playerRealmLevel, skillLevel: reward.skillLevel,
          targetLevel: reward.targetLevel, successCount, failureCount, baseActionTicks: reward.baseActionTicks,
          getExpToNextByLevel: (level) => Math.max(1, Number(reward.expToNextByLevel[String(level)]) || 1) }).finalGain;
        const currentResult = await client.query(`SELECT level,exp,exp_to_next FROM player_profession_state
          WHERE player_id=$1 AND profession_type=$2 FOR UPDATE`, [order.ownerPlayerId, reward.professionType]);
        let level = Math.max(1, Math.trunc(Number(currentResult.rows[0]?.level) || reward.skillLevel));
        let exp = Math.max(0, Number(currentResult.rows[0]?.exp) || reward.fallbackExp) + Math.max(0, gain);
        let expToNext = Math.max(1, Number(currentResult.rows[0]?.exp_to_next)
          || reward.expToNextByLevel[String(level)] || 1);
        while (exp >= expToNext) {
          exp -= expToNext; level += 1;
          expToNext = Math.max(1, Number(reward.expToNextByLevel[String(level)]) || expToNext);
        }
        await client.query(`INSERT INTO player_profession_state(player_id,profession_type,level,exp,exp_to_next,updated_at)
          VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (player_id,profession_type) DO UPDATE SET
          level=EXCLUDED.level,exp=EXCLUDED.exp,exp_to_next=EXCLUDED.exp_to_next,updated_at=now()`,
          [order.ownerPlayerId, reward.professionType, level, exp, expToNext]);
        professionState = { level, exp, expToNext };
      }
      await client.query('COMMIT');
      return { order: mapWorkOrderRow(updated.rows[0]), beast, crop, settled: true, professionState };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listFacilityStorage(ownerPlayerId: string, instanceId?: string): Promise<Array<{
    storageId: string; buildingId: string; itemId: string; count: number; rawPayload: Record<string, unknown>;
  }>> {
    const result = instanceId
      ? await this.requirePool().query(
        `SELECT storage_id, building_id, item_id, count, raw_payload FROM spirit_beast_facility_storage
          WHERE owner_player_id=$1 AND instance_id=$2 AND claimed_at IS NULL ORDER BY created_at, storage_id`,
        [ownerPlayerId, instanceId],
      )
      : await this.requirePool().query(
        `SELECT storage_id, building_id, item_id, count, raw_payload FROM spirit_beast_facility_storage
          WHERE owner_player_id=$1 AND claimed_at IS NULL ORDER BY created_at, storage_id`, [ownerPlayerId],
      );
    return result.rows.map((row) => ({
      storageId: String(row.storage_id), buildingId: String(row.building_id), itemId: String(row.item_id),
      count: Math.max(1, Math.trunc(Number(row.count) || 1)), rawPayload: normalizeRecord(row.raw_payload),
    }));
  }

  async getFacilityStorageItem(ownerPlayerId: string, instanceId: string, buildingId: string, storageId: string): Promise<{
    storageId: string; itemId: string; count: number; rawPayload: Record<string, unknown>;
  } | null> {
    const result = await this.requirePool().query(`SELECT * FROM spirit_beast_facility_storage WHERE storage_id=$1
      AND owner_player_id=$2 AND instance_id=$3 AND building_id=$4 AND claimed_at IS NULL`,
      [storageId, ownerPlayerId, instanceId, buildingId]);
    const row = result.rows[0];
    return row ? { storageId: String(row.storage_id), itemId: String(row.item_id), count: Number(row.count),
      rawPayload: normalizeRecord(row.raw_payload) } : null;
  }

  async depositInventory(input: {
    operationId: string; ownerPlayerId: string; instanceId: string; buildingId: string;
    entries: Array<{ itemKey: string; count: number }>;
  }): Promise<IdempotentResult<Array<{ itemKey: string; itemId: string; count: number }>>> {
    const entries = input.entries.map((entry) => ({ itemKey: normalizeRequiredId(entry.itemKey, 'SPIRIT_ITEM_KEY_REQUIRED'),
      count: Math.max(1, Math.trunc(Number(entry.count) || 1)) }));
    if (entries.length === 0) throw new Error('SPIRIT_DEPOSIT_EMPTY');
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'facility_deposit', { ...input, entries }, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock($1::integer,hashtext($2))`, [7101, input.ownerPlayerId]);
      const deposited: Array<{ itemKey: string; itemId: string; count: number }> = [];
      for (const entry of entries) {
        const slot = entry.itemKey.startsWith('slot:') ? Number(entry.itemKey.slice(5)) : null;
        const rowResult = await client.query(
          `SELECT * FROM player_inventory_item WHERE player_id=$1
             AND (($2::bigint IS NOT NULL AND slot_index=$2) OR ($3::text IS NOT NULL AND item_instance_id=$3))
             AND locked_by IS NULL FOR UPDATE`,
          [input.ownerPlayerId, Number.isInteger(slot) && slot! >= 0 ? slot : null, slot === null ? entry.itemKey : null],
        );
        const row = rowResult.rows[0];
        if (!row || Number(row.count) < entry.count) throw new Error('SPIRIT_DEPOSIT_ITEM_SHORTAGE');
        const nextCount = Number(row.count) - entry.count;
        if (nextCount === 0) await client.query(`DELETE FROM player_inventory_item WHERE item_instance_id=$1`, [row.item_instance_id]);
        else await client.query(
          `UPDATE player_inventory_item SET count=$2, raw_payload=jsonb_set(raw_payload,'{count}',to_jsonb($2::bigint),true), updated_at=now()
            WHERE item_instance_id=$1`, [row.item_instance_id, nextCount],
        );
        const storageId = randomUUID();
        const sourceId = randomUUID();
        await client.query(
          `INSERT INTO spirit_beast_facility_storage
            (storage_id,owner_player_id,instance_id,building_id,item_id,count,source_order_id,raw_payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [storageId, input.ownerPlayerId, input.instanceId, input.buildingId, row.item_id, entry.count, sourceId,
            JSON.stringify({ ...(row.raw_payload ?? {}), count: entry.count })],
        );
        deposited.push({ itemKey: storageId, itemId: String(row.item_id), count: entry.count });
      }
      return deposited;
    });
  }

  async withdrawInventory(input: {
    operationId: string; ownerPlayerId: string; instanceId: string; buildingId: string;
    entries: Array<{ itemKey: string; count: number }>; inventoryCapacity: number;
  }): Promise<IdempotentResult<Array<{ itemId: string; count: number; rawPayload: Record<string, unknown> }>>> {
    const entries = input.entries.map((entry) => ({ storageId: normalizeRequiredId(entry.itemKey, 'SPIRIT_STORAGE_KEY_REQUIRED'),
      count: Math.max(1, Math.trunc(Number(entry.count) || 1)) }));
    if (entries.length === 0) throw new Error('SPIRIT_WITHDRAW_EMPTY');
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'facility_withdraw', { ...input, entries }, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock($1::integer,hashtext($2))`, [7101, input.ownerPlayerId]);
      const inventoryCount = await client.query(`SELECT COUNT(*) AS count FROM player_inventory_item WHERE player_id=$1`, [input.ownerPlayerId]);
      const occupiedSlots = Math.max(0, Math.trunc(Number(inventoryCount.rows[0]?.count) || 0));
      let insertedSlots = 0;
      const slotResult = await client.query(`SELECT COALESCE(MAX(slot_index),-1) AS slot FROM player_inventory_item WHERE player_id=$1`, [input.ownerPlayerId]);
      const highestSlot = Number(slotResult.rows[0]?.slot);
      let slot = Number.isFinite(highestSlot) ? Math.trunc(highestSlot) : -1;
      const withdrawn: Array<{ itemId: string; count: number; rawPayload: Record<string, unknown> }> = [];
      for (const entry of entries) {
        const rowResult = await client.query(
          `SELECT * FROM spirit_beast_facility_storage WHERE storage_id=$1 AND owner_player_id=$2
            AND instance_id=$3 AND building_id=$4 AND claimed_at IS NULL FOR UPDATE`,
          [entry.storageId, input.ownerPlayerId, input.instanceId, input.buildingId],
        );
        const row = rowResult.rows[0];
        if (!row || Number(row.count) < entry.count) throw new Error('SPIRIT_STORAGE_ITEM_SHORTAGE');
        const storedRawPayload = normalizeRecord(row.raw_payload);
        const splitInstances = isNonStackableItemPayload(storedRawPayload) ? entry.count : 1;
        if (occupiedSlots + insertedSlots + splitInstances > Math.max(1, input.inventoryCapacity)) {
          throw new Error('SPIRIT_INVENTORY_FULL');
        }
        const nextCount = Number(row.count) - entry.count;
        if (nextCount === 0) await client.query(`UPDATE spirit_beast_facility_storage SET claimed_at=now() WHERE storage_id=$1`, [entry.storageId]);
        else await client.query(`UPDATE spirit_beast_facility_storage SET count=$2 WHERE storage_id=$1`, [entry.storageId, nextCount]);
        for (let index = 0; index < splitInstances; index += 1) {
          const itemCount = splitInstances === 1 ? entry.count : 1;
          const itemInstanceId = randomUUID();
          const rawPayload: Record<string, unknown> = { ...storedRawPayload, itemInstanceId,
            itemId: String(row.item_id), count: itemCount };
          slot += 1;
          await client.query(
            `INSERT INTO player_inventory_item(item_instance_id,player_id,slot_index,item_id,count,raw_payload,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())`,
            [itemInstanceId, input.ownerPlayerId, slot, row.item_id, itemCount, JSON.stringify(rawPayload)],
          );
          withdrawn.push({ itemId: String(row.item_id), count: itemCount, rawPayload });
        }
        insertedSlots += splitInstances;
      }
      return withdrawn;
    });
  }

  async purchaseInventoryItem(input: {
    operationId: string; ownerPlayerId: string; itemId: string; count: number; spiritStoneCost: number;
    rawPayload: Record<string, unknown>; inventoryCapacity: number;
  }): Promise<IdempotentResult<{ itemId: string; count: number; spiritStoneCost: number }>> {
    return this.executeIdempotent(input.operationId, input.ownerPlayerId, 'facility_purchase', input, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock($1::integer,hashtext($2))`, [7101, input.ownerPlayerId]);
      let remainingCost = Math.max(0, Math.trunc(input.spiritStoneCost));
      const stones = await client.query(`SELECT * FROM player_inventory_item WHERE player_id=$1 AND item_id='spirit_stone'
        AND locked_by IS NULL ORDER BY slot_index FOR UPDATE`, [input.ownerPlayerId]);
      if (stones.rows.reduce((sum, row) => sum + Number(row.count), 0) < remainingCost) throw new Error('SPIRIT_STONE_SHORTAGE');
      for (const row of stones.rows) {
        if (remainingCost <= 0) break;
        const consumed = Math.min(Number(row.count), remainingCost);
        const next = Number(row.count) - consumed;
        if (next === 0) await client.query(`DELETE FROM player_inventory_item WHERE item_instance_id=$1`, [row.item_instance_id]);
        else await client.query(`UPDATE player_inventory_item SET count=$2,raw_payload=jsonb_set(raw_payload,'{count}',to_jsonb($2::bigint),true),updated_at=now()
          WHERE item_instance_id=$1`, [row.item_instance_id, next]);
        remainingCost -= consumed;
      }
      const target = await client.query(`SELECT * FROM player_inventory_item WHERE player_id=$1 AND item_id=$2 AND locked_by IS NULL
        ORDER BY slot_index LIMIT 1 FOR UPDATE`, [input.ownerPlayerId, input.itemId]);
      if (target.rows[0]) {
        await client.query(`UPDATE player_inventory_item SET count=count+$2,
          raw_payload=jsonb_set(raw_payload,'{count}',to_jsonb((count+$2)::bigint),true),updated_at=now()
          WHERE item_instance_id=$1`, [target.rows[0].item_instance_id, input.count]);
      } else {
        const occupied = await client.query(`SELECT COUNT(*) AS count,COALESCE(MAX(slot_index),-1) AS slot FROM player_inventory_item WHERE player_id=$1`, [input.ownerPlayerId]);
        if (Number(occupied.rows[0]?.count ?? 0) >= input.inventoryCapacity) throw new Error('SPIRIT_INVENTORY_FULL');
        const itemInstanceId = randomUUID();
        await client.query(`INSERT INTO player_inventory_item(item_instance_id,player_id,slot_index,item_id,count,raw_payload,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())`, [itemInstanceId, input.ownerPlayerId,
          Number(occupied.rows[0]?.slot ?? -1) + 1, input.itemId, input.count,
          JSON.stringify({ ...input.rawPayload, itemInstanceId, itemId: input.itemId, count: input.count })]);
      }
      return { itemId: input.itemId, count: input.count, spiritStoneCost: input.spiritStoneCost };
    });
  }

  async listPlayerInventoryItems(ownerPlayerId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.requirePool().query(`SELECT item_instance_id,item_id,count,raw_payload FROM player_inventory_item
      WHERE player_id=$1 ORDER BY slot_index,item_instance_id`, [ownerPlayerId]);
    return result.rows.map((row) => ({ ...normalizeRecord(row.raw_payload), itemInstanceId: String(row.item_instance_id),
      itemId: String(row.item_id), count: Math.max(1, Math.trunc(Number(row.count) || 1)) }));
  }

  /** 進程遺失後，把仍佔工位唯一鍵的玩家工單改回 waiting，讓親自採集可以再預約。 */
  async releaseOrphanedPlayerWorkOrders(input: {
    ownerPlayerId?: string;
    buildingId?: string;
    excludeOrderIds?: string[];
  } = {}): Promise<SpiritWorkOrderRow[]> {
    const ownerPlayerId = input.ownerPlayerId?.trim() || null;
    const buildingId = input.buildingId?.trim() || null;
    const excludeOrderIds = (input.excludeOrderIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
    const result = await this.requirePool().query(
      `UPDATE spirit_beast_work_order
          SET status='waiting', worker_kind=NULL, worker_id=NULL, job_run_id=NULL,
              revision=revision+1, updated_at=now()
        WHERE status IN ('reserved','running')
          AND worker_kind='player'
          AND remaining_ticks > 0
          AND (($1::text IS NULL AND $2::text IS NULL) OR owner_player_id=$1 OR building_id=$2)
          AND ($3::uuid[] IS NULL OR NOT (order_id = ANY($3::uuid[])))
        RETURNING *`,
      [ownerPlayerId, buildingId, excludeOrderIds.length > 0 ? excludeOrderIds : null],
    );
    return result.rows.map(mapWorkOrderRow);
  }

  async loadRecoveryState(): Promise<SpiritBeastRecoveryState> {
    const result = await Promise.all([
      this.requirePool().query(`SELECT * FROM spirit_beast_hatch WHERE status IN ('incubating','ready') ORDER BY hatch_id`),
      this.requirePool().query(`SELECT * FROM spirit_beast_instance WHERE state IN ('summoned','working','recalling') ORDER BY beast_id`),
      this.requirePool().query(`SELECT * FROM spirit_beast_work_order WHERE status IN ('queued','reserved','running','waiting') ORDER BY priority DESC, created_at, order_id`),
      this.requirePool().query(`SELECT * FROM spirit_beast_crop WHERE status IN ('planned','growing','mature') ORDER BY crop_id`),
    ]);
    return {
      hatches: result[0].rows.map(mapHatchRow),
      beasts: result[1].rows.map(mapBeastRow),
      workOrders: result[2].rows.map(mapWorkOrderRow),
      crops: result[3].rows.map(mapCropRow),
    };
  }

  async flushProgress(input: {
    hatches: SpiritHatchRow[];
    beasts: SpiritBeastRow[];
    workOrders: SpiritWorkOrderRow[];
    crops: SpiritCropRow[];
  }): Promise<void> {
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      for (const hatch of input.hatches) {
        await client.query(
          `UPDATE spirit_beast_hatch SET remaining_ticks=LEAST(remaining_ticks,$2),
             status=CASE WHEN status='ready' OR $3='ready' THEN 'ready' ELSE 'incubating' END,
             revision=GREATEST(revision,$4), updated_at=now()
            WHERE hatch_id=$1 AND status IN ('incubating','ready') AND revision <= $4`,
          [hatch.hatchId, hatch.remainingTicks, hatch.status, hatch.revision],
        );
      }
      for (const beast of input.beasts) {
        await client.query(
          `UPDATE spirit_beast_instance SET state=$2, active_job_id=$3, x=$4, y=$5, facing=$6,
             revision=GREATEST(revision,$7), updated_at=now() WHERE beast_id=$1
             AND state IN ('summoned','working','recalling') AND revision <= $7`,
          [beast.beastId, beast.state, beast.activeJobId, beast.x, beast.y, beast.facing, beast.revision],
        );
      }
      for (const order of input.workOrders) {
        await client.query(
          `UPDATE spirit_beast_work_order SET status=$2, worker_kind=$3, worker_id=$4, job_run_id=$5,
             remaining_ticks=$6, retry_after_tick=$7, revision=$8, total_ticks=$9, updated_at=now()
           WHERE order_id=$1 AND status IN ('queued','reserved','running','waiting')
             AND revision <= $8 AND NOT (status='waiting' AND $2='running')`,
          [order.orderId, order.status, order.workerKind, order.workerId, order.jobRunId,
            order.remainingTicks, order.retryAfterTick, order.revision, order.totalTicks],
        );
      }
      for (const crop of input.crops) {
        await client.query(
          `UPDATE spirit_beast_crop SET status=CASE
               WHEN status='mature' OR $2='mature' THEN 'mature'
               WHEN status='growing' OR $2='growing' THEN 'growing' ELSE 'planned' END,
             growth_remaining_ticks=LEAST(growth_remaining_ticks,$3), watering_mask=GREATEST(watering_mask,$4),
             revision=GREATEST(revision,$5), updated_at=now()
           WHERE crop_id=$1 AND status IN ('planned','growing','mature') AND revision <= $5`,
          [crop.cropId, crop.status, crop.growthRemainingTicks, crop.wateringMask, crop.revision],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async executeIdempotent<T>(
    operationId: string,
    playerId: string,
    kind: string,
    request: unknown,
    mutate: (client: PoolClient) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const normalizedOperationId = normalizeRequiredId(operationId, 'SPIRIT_OPERATION_ID_REQUIRED');
    const requestHash = hashRequest(request);
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO spirit_beast_operation (operation_id, player_id, kind, request_hash, status)
         VALUES ($1,$2,$3,$4,'pending') ON CONFLICT DO NOTHING RETURNING operation_id`,
        [normalizedOperationId, playerId, kind, requestHash],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query(
          `SELECT * FROM spirit_beast_operation WHERE operation_id=$1 FOR UPDATE`, [normalizedOperationId],
        );
        const row = existing.rows[0];
        if (!row || row.player_id !== playerId || row.kind !== kind || row.request_hash !== requestHash) {
          throw new Error('SPIRIT_OPERATION_CONFLICT');
        }
        if (row.status !== 'completed') throw new Error('SPIRIT_OPERATION_INCOMPLETE');
        await client.query('COMMIT');
        return { replayed: true, result: row.result_json as T };
      }
      const result = await mutate(client);
      await client.query(
        `UPDATE spirit_beast_operation SET status='completed', result_json=$2::jsonb, completed_at=now()
          WHERE operation_id=$1`,
        [normalizedOperationId, JSON.stringify(result)],
      );
      await client.query('COMMIT');
      return { replayed: false, result };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function ensureSpiritBeastTables(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS spirit_beast_operation (
        operation_id text PRIMARY KEY,
        player_id text NOT NULL,
        kind text NOT NULL,
        request_hash text NOT NULL,
        status text NOT NULL CHECK (status IN ('pending','completed')),
        result_json jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_spirit_beast_operation_player ON spirit_beast_operation(player_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS spirit_beast_egg (
        egg_id uuid PRIMARY KEY,
        owner_player_id text NOT NULL,
        element text NOT NULL CHECK (element IN ('metal','wood','water','fire','earth')),
        star smallint NOT NULL CHECK (star BETWEEN 1 AND 5),
        state text NOT NULL CHECK (state IN ('warehouse','incubating','locked')),
        hatch_id uuid,
        source_ref text UNIQUE,
        revision bigint NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_spirit_beast_egg_owner ON spirit_beast_egg(owner_player_id, state);

      CREATE TABLE IF NOT EXISTS spirit_beast_hatch (
        hatch_id uuid PRIMARY KEY,
        owner_player_id text NOT NULL,
        egg_id uuid NOT NULL UNIQUE,
        building_instance_id text NOT NULL,
        building_id text NOT NULL,
        incubator_element text NOT NULL CHECK (incubator_element IN ('metal','wood','water','fire','earth')),
        egg_element text NOT NULL CHECK (egg_element IN ('metal','wood','water','fire','earth')),
        egg_star smallint NOT NULL CHECK (egg_star BETWEEN 1 AND 5),
        result_species_id text NOT NULL,
        result_grade text NOT NULL CHECK (result_grade IN ('fan','human','heaven','saint','immortal')),
        result_combat_power integer NOT NULL CHECK (result_combat_power > 0),
        total_ticks integer NOT NULL CHECK (total_ticks > 0),
        remaining_ticks integer NOT NULL CHECK (remaining_ticks >= 0),
        status text NOT NULL CHECK (status IN ('incubating','ready','adopted','cancelled')),
        pending_beast_id uuid NOT NULL UNIQUE,
        revision bigint NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE spirit_beast_hatch ADD COLUMN IF NOT EXISTS egg_element text;
      ALTER TABLE spirit_beast_hatch ADD COLUMN IF NOT EXISTS egg_star smallint;
      CREATE INDEX IF NOT EXISTS idx_spirit_beast_hatch_active ON spirit_beast_hatch(status, building_instance_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spirit_beast_hatch_building_active
        ON spirit_beast_hatch(building_instance_id, building_id)
        WHERE status IN ('incubating','ready');

      CREATE OR REPLACE FUNCTION spirit_beast_add_skill_levels(source jsonb, amount integer)
      RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
        SELECT COALESCE(jsonb_object_agg(key, to_jsonb(GREATEST(1, LEAST(100, (value #>> '{}')::integer + amount)))), '{}'::jsonb)
        FROM jsonb_each(COALESCE(source, '{}'::jsonb));
      $$;

      CREATE TABLE IF NOT EXISTS spirit_beast_instance (
        beast_id uuid PRIMARY KEY,
        owner_player_id text NOT NULL,
        species_id text NOT NULL,
        grade text NOT NULL CHECK (grade IN ('fan','human','heaven','saint','immortal')),
        element text NOT NULL CHECK (element IN ('metal','wood','water','fire','earth')),
        star smallint NOT NULL CHECK (star BETWEEN 1 AND 5),
        base_combat_power integer NOT NULL CHECK (base_combat_power > 0),
        skill_levels jsonb NOT NULL DEFAULT '{}'::jsonb,
        speed_bonus_percent integer NOT NULL DEFAULT 0,
        state text NOT NULL CHECK (state IN ('warehouse','summoned','working','recalling','locked')),
        sect_id text,
        instance_id text,
        x integer,
        y integer,
        facing text,
        active_job_id uuid,
        favorite boolean NOT NULL DEFAULT false,
        revision bigint NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_spirit_beast_owner ON spirit_beast_instance(owner_player_id, state);
      CREATE INDEX IF NOT EXISTS idx_spirit_beast_sect_active ON spirit_beast_instance(sect_id, state) WHERE sect_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS spirit_beast_work_order (
        order_id uuid PRIMARY KEY,
        owner_player_id text NOT NULL,
        sect_id text NOT NULL,
        instance_id text NOT NULL,
        building_id text NOT NULL,
        skill text NOT NULL CHECK (skill IN ('alchemy','forging','enhancement','mining','building','planting')),
        action text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        priority integer NOT NULL DEFAULT 0,
        status text NOT NULL CHECK (status IN ('queued','reserved','running','waiting','completed','cancelled')),
        worker_kind text CHECK (worker_kind IN ('player','spirit_beast')),
        worker_id text,
        job_run_id uuid,
        total_ticks integer NOT NULL CHECK (total_ticks > 0),
        remaining_ticks integer NOT NULL CHECK (remaining_ticks >= 0),
        retry_after_tick bigint NOT NULL DEFAULT 0,
        revision bigint NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_spirit_beast_work_pending
        ON spirit_beast_work_order(sect_id, instance_id, status, priority DESC, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spirit_beast_station_exclusive
        ON spirit_beast_work_order(instance_id, building_id)
        WHERE status IN ('reserved','running') AND skill <> 'building';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spirit_beast_worker_active
        ON spirit_beast_work_order(worker_kind, worker_id)
        WHERE status IN ('reserved','running') AND worker_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS spirit_beast_crop (
        crop_id uuid PRIMARY KEY,
        owner_player_id text NOT NULL,
        sect_id text NOT NULL,
        instance_id text NOT NULL,
        building_id text NOT NULL,
        seed_item_id text NOT NULL,
        output_item_id text NOT NULL,
        status text NOT NULL CHECK (status IN ('planned','growing','mature','harvested','cancelled')),
        growth_remaining_ticks integer NOT NULL DEFAULT 3600 CHECK (growth_remaining_ticks >= 0),
        growth_total_ticks integer NOT NULL DEFAULT 3600 CHECK (growth_total_ticks > 0),
        watering_mask smallint NOT NULL DEFAULT 0 CHECK (watering_mask BETWEEN 0 AND 3),
        repeat_enabled boolean NOT NULL DEFAULT false,
        revision bigint NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spirit_beast_crop_active
        ON spirit_beast_crop(instance_id, building_id)
        WHERE status IN ('planned','growing','mature');
      ALTER TABLE spirit_beast_crop ADD COLUMN IF NOT EXISTS growth_total_ticks integer NOT NULL DEFAULT 3600;

      CREATE TABLE IF NOT EXISTS spirit_beast_facility_storage (
        storage_id uuid PRIMARY KEY,
        owner_player_id text NOT NULL,
        instance_id text NOT NULL,
        building_id text NOT NULL,
        item_id text NOT NULL,
        count integer NOT NULL CHECK (count > 0),
        source_order_id uuid NOT NULL,
        raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        claimed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(source_order_id, item_id)
      );
      ALTER TABLE spirit_beast_facility_storage ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb;
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function lockEggs(client: PoolClient, ids: string[]): Promise<SpiritEggRow[]> {
  const result = await client.query(
    `SELECT * FROM spirit_beast_egg WHERE egg_id = ANY($1::uuid[]) ORDER BY egg_id FOR UPDATE`, [ids],
  );
  return result.rows.map(mapEggRow);
}

async function lockBeasts(client: PoolClient, ids: string[]): Promise<SpiritBeastRow[]> {
  const result = await client.query(
    `SELECT * FROM spirit_beast_instance WHERE beast_id = ANY($1::uuid[]) ORDER BY beast_id FOR UPDATE`, [ids],
  );
  return result.rows.map(mapBeastRow);
}

function mapEggRow(row: Record<string, unknown>): SpiritEggRow {
  return {
    eggId: String(row.egg_id), ownerPlayerId: String(row.owner_player_id), element: row.element as SpiritElement,
    star: normalizeStar(row.star), state: row.state as SpiritEggRow['state'],
    hatchId: nullableString(row.hatch_id), sourceRef: nullableString(row.source_ref), revision: normalizeRevision(row.revision),
  };
}

function mapBeastRow(row: Record<string, unknown>): SpiritBeastRow {
  return {
    beastId: String(row.beast_id), ownerPlayerId: String(row.owner_player_id), speciesId: String(row.species_id),
    grade: row.grade as SpiritGrade, element: row.element as SpiritElement, star: normalizeStar(row.star),
    baseCombatPower: Math.max(1, Math.trunc(Number(row.base_combat_power) || 1)),
    skillLevels: normalizeSkillLevels(row.skill_levels), speedBonusPercent: Math.trunc(Number(row.speed_bonus_percent) || 0),
    state: row.state as SpiritBeastState, sectId: nullableString(row.sect_id), instanceId: nullableString(row.instance_id),
    x: nullableInteger(row.x), y: nullableInteger(row.y), facing: nullableString(row.facing),
    activeJobId: nullableString(row.active_job_id), favorite: row.favorite === true, revision: normalizeRevision(row.revision),
  };
}

function mapHatchRow(row: Record<string, unknown>): SpiritHatchRow {
  return {
    hatchId: String(row.hatch_id), ownerPlayerId: String(row.owner_player_id), eggId: String(row.egg_id),
    buildingInstanceId: String(row.building_instance_id), buildingId: String(row.building_id),
    incubatorElement: row.incubator_element as SpiritElement, resultSpeciesId: String(row.result_species_id),
    eggElement: row.egg_element as SpiritElement, eggStar: normalizeStar(row.egg_star),
    resultGrade: row.result_grade as SpiritGrade, resultCombatPower: Math.max(1, Math.trunc(Number(row.result_combat_power) || 1)),
    totalTicks: Math.max(1, Math.trunc(Number(row.total_ticks) || 1)), remainingTicks: Math.max(0, Math.trunc(Number(row.remaining_ticks) || 0)),
    status: row.status as SpiritHatchRow['status'], pendingBeastId: String(row.pending_beast_id), revision: normalizeRevision(row.revision),
  };
}

function mapWorkOrderRow(row: Record<string, unknown>): SpiritWorkOrderRow {
  return {
    orderId: String(row.order_id), ownerPlayerId: String(row.owner_player_id), sectId: String(row.sect_id),
    instanceId: String(row.instance_id), buildingId: String(row.building_id), skill: row.skill as SpiritSkill,
    action: String(row.action), payload: normalizeRecord(row.payload), priority: Math.trunc(Number(row.priority) || 0),
    status: row.status as SpiritWorkOrderRow['status'], workerKind: (row.worker_kind as SpiritWorkOrderRow['workerKind']) ?? null,
    workerId: nullableString(row.worker_id), jobRunId: nullableString(row.job_run_id),
    totalTicks: Math.max(1, Math.trunc(Number(row.total_ticks) || 1)), remainingTicks: Math.max(0, Math.trunc(Number(row.remaining_ticks) || 0)),
    retryAfterTick: Math.max(0, Math.trunc(Number(row.retry_after_tick) || 0)), revision: normalizeRevision(row.revision),
    createdAtMs: row.created_at instanceof Date ? row.created_at.getTime() : Date.parse(String(row.created_at ?? '')) || 0,
  };
}

function mapCropRow(row: Record<string, unknown>): SpiritCropRow {
  return {
    cropId: String(row.crop_id), ownerPlayerId: String(row.owner_player_id), sectId: String(row.sect_id),
    instanceId: String(row.instance_id), buildingId: String(row.building_id), seedItemId: String(row.seed_item_id),
    outputItemId: String(row.output_item_id), status: row.status as SpiritCropRow['status'],
    growthRemainingTicks: Math.max(0, Math.trunc(Number(row.growth_remaining_ticks) || 0)),
    growthTotalTicks: Math.max(1, Math.trunc(Number(row.growth_total_ticks) || 1)),
    wateringMask: Math.max(0, Math.min(3, Math.trunc(Number(row.watering_mask) || 0))), repeatEnabled: row.repeat_enabled === true,
    revision: normalizeRevision(row.revision),
  };
}

function normalizeSkillLevels(value: unknown): Partial<Record<SpiritSkill, number>> {
  const source = normalizeRecord(value);
  const result: Partial<Record<SpiritSkill, number>> = {};
  for (const skill of ['alchemy', 'forging', 'enhancement', 'mining', 'building', 'planting'] as SpiritSkill[]) {
    if (source[skill] !== undefined) result[skill] = Math.max(1, Math.min(100, Math.trunc(Number(source[skill]) || 1)));
  }
  return result;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isNonStackableItemPayload(value: Record<string, unknown>): boolean {
  return value.type === 'equipment' || value.type === 'artifact';
}

function normalizeMaterialRequirements(value: unknown): Array<{ itemId: string; count: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const entry = normalizeRecord(candidate);
    const itemId = typeof entry.itemId === 'string' ? entry.itemId.trim() : '';
    const count = Math.max(0, Math.trunc(Number(entry.count) || 0));
    return itemId && count > 0 ? [{ itemId, count }] : [];
  });
}

function normalizeDistinctIds(values: readonly string[]): string[] {
  return Array.from(new Set((values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function normalizeRequiredId(value: unknown, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeStar(value: unknown): number {
  return Math.max(1, Math.min(5, Math.trunc(Number(value) || 1)));
}

function normalizeRevision(value: unknown): number {
  return Math.max(1, Math.trunc(Number(value) || 1));
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : Math.trunc(Number(value));
}

function hashRequest(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(source[key])}`).join(',')}}`;
}
