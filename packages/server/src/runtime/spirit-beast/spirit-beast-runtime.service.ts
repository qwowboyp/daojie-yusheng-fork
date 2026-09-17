/** 靈獸權威運行態：命令編排、低頻面板、到期佇列與地圖最小投影。 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import {
  SPIRIT_BEAST_CATALOG,
  SPIRIT_BEAST_FACILITIES,
  SPIRIT_BEAST_GRADES,
  SPIRIT_BEAST_RULES,
  SPIRIT_BEAST_SEEDS,
  SPIRIT_BEAST_STAR_WEIGHTS,
  computeSpiritBeastCombatPower,
  computeSpiritBeastMasteries,
  computeSpiritBeastSpeed,
  getSpiritBeastHatchSpeed,
  getSpiritBeastHatchWeights,
  getAlchemySpiritStoneCost,
  ALCHEMY_FURNACE_OUTPUT_COUNT,
  computeAlchemyBatchOutputCountWithSize,
  computeEnhancementAdjustedSuccessRate,
  computeEnhancementJobTicks,
  computeAlchemyAdjustedSuccessRate,
  getEnhancementSpiritStoneCost,
  MAX_ENHANCE_LEVEL,
  normalizeEnhanceLevel,
  getSpiritEggItemId,
  previewSpiritBeastFusion,
  selectSpiritBeastWeightedIndex,
  type SpiritBeastCommandResultView,
  type SpiritBeastCommandView,
  type SpiritBeastElement,
  type SpiritBeastFacilityKind,
  type SpiritBeastFacilityView,
  type SpiritBeastCraftOption,
  type SpiritBeastMapProjection,
  type SpiritBeastPanelView,
  type SpiritBeastRecord,
  type SpiritBeastSkill,
  type SpiritBeastSpecies,
  type SpiritBeastStar,
  type SpiritBeastView,
  type PlayerPlantingJob,
} from '@mud/shared';

import { PlayerRuntimeService } from '../player/player-runtime.service';
import { PlayerPersistenceFlushService } from '../../persistence/player-persistence-flush.service';
import { ContentTemplateRepository } from '../../content/content-template.repository';
import { CraftPanelRuntimeService } from '../craft/craft-panel-runtime.service';
import { resolveCraftSkillExpToNextByLevel } from '../craft/craft-skill-exp.helpers';
import { TechniqueActivityPipelineService } from '../craft/pipeline/technique-activity-pipeline.service';
import { SpiritBeastWorkStrategy, createSpiritBeastPipelineContext, type SpiritBeastPipelineWorker } from './spirit-beast-work.strategy';
import { findPathToTargetWithinRangeOnMap } from '../world/world-runtime.path-planning.helpers';
import type { PlantingWorkAssignment, PlantingWorkPort } from '../craft/planting-work.port';
import type { FacilityWorkAssignment, FacilityWorkPort } from './facility-work.port';
import {
  SpiritBeastPersistenceService,
  type SpiritBeastRow,
  type SpiritCropRow,
  type SpiritEggRow,
  type SpiritHatchRow,
  type SpiritWorkOrderRow,
} from '../../persistence/spirit-beast-persistence.service';

const FLUSH_INTERVAL_TICKS = 30;
const FACILITY_NAMES: Record<SpiritBeastFacilityKind, string> = {
  incubator: '五行孵蛋器', iron_mine: '玄鐵礦場', spirit_stone_mine: '靈石礦場', field: '靈田',
  forging: '煉器台', enhancement: '強化台', alchemy: '宗門煉丹爐', egg_enhancement: '靈蛋強化台',
  cultivation: '靈獸培養台', fusion: '靈獸融合台',
};

export interface SpiritBeastRuntimeContext {
  sectId: string | null;
  sectInstanceId: string | null;
  buildings: Array<{ id?: string; defId?: string; x?: number; y?: number; state?: string; revision?: number;
    buildRemainingTicks?: number; buildStrength?: number }>;
  canManage: boolean;
}

interface EggDropEvent {
  sourceRef: string;
  ownerPlayerId: string;
  boss: boolean;
}

export interface SpiritBeastMapInstance {
  template?: { width?: number; height?: number };
  occupancy?: { length?: number };
  tilePlane?: { getCellCapacity?(): number; getX?(index: number): number; getY?(index: number): number };
  isInBounds?(x: number, y: number): boolean;
  toTileIndex?(x: number, y: number): number;
  isCellIndexWalkable?(index: number): boolean;
  tick?: number;
  worldRevision?: number;
  persistentRevision?: number;
  buildingById?: Map<string, Record<string, unknown>>;
  markAoiViewChangedAt?(x: number, y: number): void;
  markPersistenceDirtyDomainsHighPriority?(domains: string[]): void;
  activatePlacedBuildingTopologyAndVisual?(building: Record<string, unknown>): string[];
}

@Injectable()
export class SpiritBeastRuntimeService implements OnModuleInit, OnModuleDestroy, PlantingWorkPort, FacilityWorkPort {
  private readonly logger = new Logger(SpiritBeastRuntimeService.name);
  private readonly speciesById = new Map<string, SpiritBeastSpecies>(SPIRIT_BEAST_CATALOG.map((entry) => [entry.id, entry]));
  private readonly hatches = new Map<string, SpiritHatchRow>();
  private readonly activeBeasts = new Map<string, SpiritBeastRow>();
  private readonly activeBeastIdsByInstance = new Map<string, Set<string>>();
  private readonly workOrders = new Map<string, SpiritWorkOrderRow>();
  private readonly crops = new Map<string, SpiritCropRow>();
  private readonly dirtyHatches = new Set<string>();
  private readonly dirtyBeasts = new Set<string>();
  private readonly dirtyOrders = new Set<string>();
  private readonly dirtyCrops = new Set<string>();
  private readonly workPipeline = new TechniqueActivityPipelineService();
  private readonly workPipelineContext = createSpiritBeastPipelineContext();
  private readonly workers = new Map<string, SpiritBeastPipelineWorker>();
  private readonly completedOrderIds = new Set<string>();
  private readonly movementPaths = new Map<string, Array<{ x: number; y: number }>>();
  private hydrationPromise: Promise<void> | null = null;
  private flushPromise: Promise<void> | null = null;
  private logicalTick = 0;
  private resolveMapInstance: ((instanceId: string) => SpiritBeastMapInstance | null | undefined) | null = null;
  private panelRevision = 1;

  constructor(
    @Inject(SpiritBeastPersistenceService) private readonly persistence: SpiritBeastPersistenceService,
    @Inject(PlayerRuntimeService) private readonly playerRuntimeService: PlayerRuntimeService,
    @Inject(PlayerPersistenceFlushService) private readonly playerPersistenceFlushService: PlayerPersistenceFlushService,
    @Inject(ContentTemplateRepository) private readonly contentTemplateRepository: ContentTemplateRepository,
    @Inject(CraftPanelRuntimeService) private readonly craftPanelRuntimeService: CraftPanelRuntimeService,
  ) {
    const port = {
      complete: (orderId: string) => this.completedOrderIds.add(orderId),
      release: (_orderId: string) => undefined,
    };
    for (const kind of ['alchemy', 'forging', 'enhancement', 'mining', 'building', 'planting'] as const) {
      this.workPipeline.register(new SpiritBeastWorkStrategy(kind, port));
    }
    (this.craftPanelRuntimeService as unknown as { plantingWorkPort?: PlantingWorkPort }).plantingWorkPort = this;
    (this.craftPanelRuntimeService as unknown as { facilityWorkPort?: FacilityWorkPort }).facilityWorkPort = this;
    (this.craftPanelRuntimeService as unknown as { stationSuccessBonusResolver?: (playerId: string, job: unknown) => number })
      .stationSuccessBonusResolver = (playerId, job) => this.isValidStationJob(playerId, job) ? 0.1 : 0;
  }

  onModuleInit(): void {
    this.hydrationPromise = this.hydrate().catch((error: unknown) => {
      this.logger.error('靈獸啟動恢復失敗，資產命令將 fail closed', error instanceof Error ? error.stack : String(error));
      throw error;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.flushDirtyProgress().catch((error: unknown) => {
      this.logger.error('靈獸關停 flush 失敗', error instanceof Error ? error.stack : String(error));
    });
  }

  private async hydrate(): Promise<void> {
    if (!this.persistence.isEnabled()) return;
    const recovered = await this.persistence.loadRecoveryState();
    this.hatches.clear(); this.activeBeasts.clear(); this.activeBeastIdsByInstance.clear(); this.workOrders.clear(); this.crops.clear();
    for (const entry of recovered.hatches) this.hatches.set(entry.hatchId, entry);
    for (const entry of recovered.beasts) this.trackActiveBeast(entry);
    for (const entry of recovered.workOrders) {
      // 進程失去時撤銷未完成 reservation；玩家人工工單也不重開舊 job，避免剩餘時間與產物脫節。
      if (entry.status === 'reserved' || (entry.status === 'running' && entry.workerKind === 'player')) {
        if (entry.status === 'running' && entry.remainingTicks === 0) {
          this.completedOrderIds.add(entry.orderId);
        } else {
          entry.status = 'waiting'; entry.workerKind = null; entry.workerId = null; entry.jobRunId = null; entry.revision += 1;
          this.dirtyOrders.add(entry.orderId);
        }
      }
      this.workOrders.set(entry.orderId, entry);
    }
    for (const entry of recovered.crops) this.crops.set(entry.cropId, entry);
    for (const entry of recovered.workOrders) {
      if (entry.status !== 'running' || entry.workerKind !== 'spirit_beast' || !entry.workerId) continue;
      this.startWorkerLifecycle(entry.workerId, entry, false);
    }
    for (const crop of recovered.crops.filter((entry) => entry.status === 'planned')) await this.ensureCropSowOrder(crop);
    for (const orderId of this.completedOrderIds) {
      const order = this.workOrders.get(orderId);
      if (order) void this.settleCompletedOrder(order);
    }
    this.kickScheduler();
  }

  private async ready(): Promise<void> {
    if (!this.persistence.isEnabled()) throw new Error('SPIRIT_BEAST_PERSISTENCE_UNAVAILABLE');
    await this.hydrationPromise;
  }

  /** 真死亡鏈呼叫；sourceRef 是 instance + runtime monster + kill tick 的唯一身份。 */
  async recordEligibleMonsterDeath(event: EggDropEvent): Promise<{ dropped: boolean; egg?: SpiritEggRow }> {
    const probability = event.boss ? SPIRIT_BEAST_RULES.bossEggDropProbability : SPIRIT_BEAST_RULES.normalEggDropProbability;
    if (this.randomSample() >= probability) return { dropped: false };
    await this.ready();
    const element = (['metal', 'wood', 'water', 'fire', 'earth'] as const)[randomInt(5)];
    const star = (selectSpiritBeastWeightedIndex(SPIRIT_BEAST_STAR_WEIGHTS, this.randomSample()) + 1) as SpiritBeastStar;
    const result = await this.persistence.awardEgg({ sourceRef: event.sourceRef, ownerPlayerId: event.ownerPlayerId, element, star });
    if (result.awarded) this.bumpPanelRevision();
    return { dropped: result.awarded, egg: result.egg };
  }

  async getPanel(ownerPlayerId: string, context: SpiritBeastRuntimeContext): Promise<SpiritBeastPanelView> {
    await this.ready();
    await this.ensureConstructionOrders(ownerPlayerId, context);
    const [eggs, beasts, hatches, storage] = await Promise.all([
      this.persistence.listPlayerEggs(ownerPlayerId), this.persistence.listPlayerBeasts(ownerPlayerId),
      this.persistence.listPlayerHatches(ownerPlayerId), this.persistence.listFacilityStorage(ownerPlayerId, context.sectInstanceId ?? undefined),
    ]);
    const currentHatches = new Map(hatches.map((entry) => [entry.hatchId, entry]));
    for (const hatch of this.hatches.values()) {
      if (hatch.ownerPlayerId === ownerPlayerId) currentHatches.set(hatch.hatchId, hatch);
    }
    const sectSummonedCount = Array.from(this.activeBeasts.values()).filter((entry) => entry.sectId === context.sectId && entry.state !== 'warehouse').length;
    const player = this.playerRuntimeService.getPlayer(ownerPlayerId);
    const plantingSkill = player?.plantingSkill;
    return {
      revision: this.panelRevision,
      sectId: context.sectId,
      ownerPlayerId,
      beasts: beasts.map((entry) => this.buildBeastView(entry, ownerPlayerId)),
      facilities: this.buildFacilities(ownerPlayerId, context, Array.from(currentHatches.values()), storage),
      eggs: eggs.filter((entry) => entry.state === 'warehouse').map((entry) => ({
        itemKey: entry.eggId,
        itemId: getSpiritEggItemId(entry.element, entry.star as SpiritBeastStar),
        name: `${resolveElementName(entry.element)}靈蛋`, element: entry.element, star: entry.star as SpiritBeastStar, count: 1,
        revision: entry.revision,
      })),
      inventory: (player?.inventory?.items ?? []).flatMap((item: Record<string, unknown>, index: number) => {
        const itemId = normalizeId(item.itemId);
        const count = Math.max(0, Math.trunc(Number(item.count) || 0));
        if (!itemId || count <= 0) return [];
        const itemKey = normalizeId(item.itemInstanceId) || `slot:${index}`;
        const type = normalizeItemType(item.type);
        const enhancementLevel = Math.max(0, Math.trunc(Number(item.enhanceLevel) || 0));
        return [{ itemKey, itemId, name: normalizeId(item.name) || this.contentTemplateRepository.getItemName(itemId) || itemId,
          count, ...(type ? { type } : {}), ...(enhancementLevel > 0 ? { enhancementLevel } : {}) }];
      }),
      craftOptions: this.buildCraftOptions(),
      ...(plantingSkill ? { plantingSkill: {
        level: Math.max(1, Math.trunc(Number(plantingSkill.level) || 1)),
        exp: Math.max(0, Math.trunc(Number(plantingSkill.exp) || 0)),
        expToNext: resolveCraftSkillExpToNextByLevel(this.playerRuntimeService, plantingSkill.level, plantingSkill.expToNext),
      } } : {}),
      warehouseCapacity: SPIRIT_BEAST_RULES.warehouseCapacity,
      summonLimit: SPIRIT_BEAST_RULES.playerSummonLimit,
      sectSummonLimit: SPIRIT_BEAST_RULES.sectSummonLimit,
      summonedCount: beasts.filter((entry) => entry.state !== 'warehouse').length,
      sectSummonedCount,
      fertilizerEnabled: false,
      canManage: context.canManage,
      ...(context.sectId ? {} : { reasonKey: 'spirit_beast_requires_sect' }),
    };
  }

  /** 建築放置成功事件；只有已有活動靈獸的宗門實例才立即建立冷工單。 */
  async registerConstructionBuilding(input: {
    ownerPlayerId: string; sectId: string; instanceId: string; buildingId: string;
    x: number; y: number; totalWork: number; buildingRevision: number;
  }): Promise<SpiritWorkOrderRow | null> {
    await this.ready();
    const activeIds = this.activeBeastIdsByInstance.get(input.instanceId);
    const hasActiveSectBeast = Boolean(activeIds && Array.from(activeIds).some((beastId) => {
      const beast = this.activeBeasts.get(beastId);
      return beast?.sectId === input.sectId && beast.state !== 'warehouse';
    }));
    if (!hasActiveSectBeast) return null;
    const existing = Array.from(this.workOrders.values()).find((order) => order.instanceId === input.instanceId
      && order.buildingId === input.buildingId && order.action === 'construct'
      && !['completed', 'cancelled'].includes(order.status));
    if (existing) return existing;
    const order = await this.persistence.ensureConstructionWorkOrder(input);
    this.workOrders.set(order.orderId, order);
    this.kickScheduler();
    return order;
  }

  async executeCommand(
    ownerPlayerId: string,
    command: SpiritBeastCommandView,
    context: SpiritBeastRuntimeContext,
  ): Promise<SpiritBeastCommandResultView> {
    await this.ready();
    const requestId = normalizeId(command?.requestId);
    if (!requestId) return this.failure('', 'spirit_beast_request_id_required');
    if (!context.sectId || !context.sectInstanceId) return this.failure(requestId, 'spirit_beast_requires_sect');
    try {
      switch (command.action) {
        case 'summon': {
          const result = await this.persistence.summonBeast({
            operationId: requestId, ownerPlayerId, beastId: command.beastId, expectedRevision: command.expectedRevision,
            sectId: context.sectId, instanceId: context.sectInstanceId, x: 0, y: 0, facing: 'down',
            ownerLimit: SPIRIT_BEAST_RULES.playerSummonLimit, sectLimit: SPIRIT_BEAST_RULES.sectSummonLimit,
          });
          this.trackActiveBeast(result.result); this.bumpPanelRevision(); this.kickScheduler(); break;
        }
        case 'recall': {
          await this.flushDirtyProgress();
          const before = this.activeBeasts.get(command.beastId);
          const result = await this.persistence.recallBeast({ operationId: requestId, ownerPlayerId, beastId: command.beastId });
          if (before?.activeJobId) {
            const order = this.workOrders.get(before.activeJobId);
            if (order) { order.status = 'waiting'; order.workerKind = null; order.workerId = null; order.jobRunId = null; order.revision += 1; }
            this.workers.delete(command.beastId);
            this.movementPaths.delete(command.beastId);
          }
          this.untrackActiveBeast(result.result.beastId); this.bumpPanelRevision(); break;
        }
        case 'protect': {
          await this.persistence.setBeastProtected({ operationId: requestId, ownerPlayerId, beastId: command.beastId,
            protected: command.protected, expectedRevision: command.expectedRevision });
          this.bumpPanelRevision(); break;
        }
        case 'incubate': {
          const egg = (await this.persistence.listPlayerEggs(ownerPlayerId)).find((entry) => entry.eggId === command.eggItemKey);
          if (!egg || (egg.state !== 'warehouse' && egg.state !== 'incubating')) throw new Error('SPIRIT_EGG_NOT_FOUND');
          const facility = this.requireFacility(context, command.buildingId, 'incubator');
          const speed = getSpiritBeastHatchSpeed(facility.definition.element as SpiritBeastElement, egg.element);
          const gradeIndex = selectSpiritBeastWeightedIndex(getSpiritBeastHatchWeights(egg.star as SpiritBeastStar), this.randomSample());
          const grade = SPIRIT_BEAST_GRADES[gradeIndex];
          const candidates = SPIRIT_BEAST_CATALOG.filter((entry) => entry.grade === grade && entry.element === egg.element);
          const species = candidates[randomInt(candidates.length)];
          const baseCombatPower = randomInclusive(species.baseCombatPowerMin, species.baseCombatPowerMax);
          const result = await this.persistence.startHatch({
            operationId: requestId, ownerPlayerId, eggId: egg.eggId, expectedEggRevision: command.expectedRevision ?? egg.revision,
            buildingInstanceId: context.sectInstanceId, buildingId: command.buildingId,
            incubatorElement: facility.definition.element as SpiritBeastElement, resultSpeciesId: species.id, resultGrade: grade,
            resultCombatPower: baseCombatPower, totalTicks: Math.max(1, Math.ceil(SPIRIT_BEAST_RULES.hatchBaseWorkTicks / speed)),
          });
          this.hatches.set(result.result.hatchId, result.result); this.bumpPanelRevision(); break;
        }
        case 'cancel_incubation': {
          await this.flushDirtyProgress();
          await this.persistence.cancelHatch({ operationId: requestId, ownerPlayerId, hatchId: command.hatchId });
          this.hatches.delete(command.hatchId); this.bumpPanelRevision(); break;
        }
        case 'adopt': {
          await this.flushDirtyProgress();
          const hatch = this.hatches.get(command.hatchId) ?? (await this.persistence.listPlayerHatches(ownerPlayerId)).find((entry) => entry.hatchId === command.hatchId);
          if (!hatch) throw new Error('SPIRIT_HATCH_NOT_FOUND');
          const species = this.requireSpecies(hatch.resultSpeciesId);
          await this.persistence.adoptHatch({ operationId: requestId, ownerPlayerId, hatchId: command.hatchId,
            expectedRevision: command.expectedRevision ?? hatch.revision, element: species.element,
            skillLevels: Object.fromEntries(species.masteries.map((entry) => [entry.skill, entry.level])),
          });
          this.hatches.delete(command.hatchId); this.bumpPanelRevision(); break;
        }
        case 'enhance_egg': {
          this.requireFacility(context, command.buildingId, 'egg_enhancement');
          const ids = expandEggMaterialIds(command.materials);
          const result = await this.persistence.enhanceEgg({ operationId: requestId, ownerPlayerId,
            targetEggId: command.eggItemKey, materialEggIds: ids, expectedTargetRevision: command.expectedRevision,
            success: this.rollPromotion(),
          });
          this.bumpPanelRevision();
          return { requestId, ok: true, revision: this.panelRevision, promoted: result.result.success };
        }
        case 'cultivate': {
          this.requireFacility(context, command.buildingId, 'cultivation');
          const result = await this.persistence.cultivateBeast({ operationId: requestId, ownerPlayerId,
            targetBeastId: command.beastId, materialBeastIds: command.materialBeastIds,
            expectedTargetRevision: command.expectedRevision, success: this.rollPromotion(),
          });
          this.bumpPanelRevision();
          return { requestId, ok: true, revision: this.panelRevision, promoted: result.result.success };
        }
        case 'preview_fusion':
        case 'fuse': {
          this.requireFacility(context, command.buildingId, 'fusion');
          if (command.action === 'fuse') {
            const replay = await this.persistence.findCompletedOperation<SpiritBeastRow>(requestId, ownerPlayerId, 'fuse_beasts', {
              operationId: requestId, ownerPlayerId, parentBeastIds: [...new Set(command.beastIds)].sort(),
            });
            if (replay) { this.bumpPanelRevision(); break; }
          }
          const beasts = await this.persistence.listPlayerBeasts(ownerPlayerId);
          const a = beasts.find((entry) => entry.beastId === command.beastIds[0]);
          const b = beasts.find((entry) => entry.beastId === command.beastIds[1]);
          if (!a || !b) throw new Error('SPIRIT_FUSION_PARENT_NOT_FOUND');
          const preview = previewSpiritBeastFusion(this.toRecord(a), this.toRecord(b), SPIRIT_BEAST_CATALOG);
          if (!preview) throw new Error('SPIRIT_FUSION_INVALID');
          if (command.action === 'preview_fusion') return { requestId, ok: true, revision: this.panelRevision, fusionPreview: preview };
          await this.persistence.fuseBeasts({ operationId: requestId, ownerPlayerId, parentBeastIds: command.beastIds,
            childSpeciesId: preview.speciesId, childGrade: preview.grade, childElement: preview.element,
            childCombatPower: preview.baseCombatPower,
            childSkillLevels: Object.fromEntries(preview.masteries.map((entry) => [entry.skill, entry.level])),
          });
          this.bumpPanelRevision(); break;
        }
        case 'queue_craft': {
          const facility = this.requireFacility(context, command.buildingId);
          const commandIdentity = buildQueueCraftIdentity(ownerPlayerId, command);
          const replay = await this.persistence.findCompletedOperation<SpiritWorkOrderRow>(requestId, ownerPlayerId,
            'create_work_order', commandIdentity);
          if (replay) {
            if (!['completed', 'cancelled'].includes(replay.status)) this.workOrders.set(replay.orderId, replay);
            this.bumpPanelRevision(); break;
          }
          const work = await this.resolveCraftWorkOrder(ownerPlayerId, context.sectInstanceId, command, facility.definition.kind);
          const orderId = randomUUID();
          const created = await this.persistence.createWorkOrder({
            operationId: requestId, orderId, ownerPlayerId, sectId: context.sectId,
            instanceId: context.sectInstanceId, buildingId: command.buildingId, skill: work.skill,
            action: work.action, payload: { ...work.payload, x: facility.building.x, y: facility.building.y }, priority: work.priority, totalTicks: work.totalTicks,
            requestIdentity: commandIdentity,
          });
          this.workOrders.set(created.result.orderId, created.result); this.bumpPanelRevision(); this.kickScheduler(); break;
        }
        case 'manual_work': {
          const facility = this.requireFacility(context, command.buildingId);
          const skill = facility.definition.kind === 'field' ? 'planting'
            : facility.definition.kind === 'iron_mine' || facility.definition.kind === 'spirit_stone_mine' ? 'mining'
              : facility.definition.kind === 'forging' ? 'forging'
                : facility.definition.kind === 'alchemy' ? 'alchemy'
                  : facility.definition.kind === 'enhancement' ? 'enhancement' : null;
          if (!skill) throw new Error('SPIRIT_WORK_ACTION_INVALID');
          const player = this.playerRuntimeService.getPlayer(ownerPlayerId);
          if (!player) throw new Error('SPIRIT_PLAYER_NOT_ONLINE');
          if (this.craftPanelRuntimeService.hasAnyActiveTechniqueActivity(player)) throw new Error('SPIRIT_PLAYER_WORKER_BUSY');
          let order = Array.from(this.workOrders.values()).filter((entry) => entry.ownerPlayerId === ownerPlayerId
            && entry.buildingId === command.buildingId && entry.skill === skill && ['queued', 'waiting'].includes(entry.status))
            .sort((a, b) => b.priority - a.priority || a.createdAtMs - b.createdAtMs)[0];
          if (!order && skill === 'mining') {
            const orderId = randomUUID();
            const action = facility.definition.kind === 'iron_mine' ? 'mine_iron' : 'mine_spirit_stone';
            const created = await this.persistence.createWorkOrder({ operationId: `${requestId}:order`, orderId, ownerPlayerId,
              sectId: context.sectId, instanceId: context.sectInstanceId, buildingId: command.buildingId,
              skill, action, payload: { x: facility.building.x, y: facility.building.y, manualPlayerId: ownerPlayerId, manualRepeat: true },
              priority: 100, totalTicks: action === 'mine_iron' ? SPIRIT_BEAST_RULES.ironMineWorkTicks : SPIRIT_BEAST_RULES.spiritStoneMineWorkTicks });
            order = created.result; this.workOrders.set(order.orderId, order);
          }
          if (!order) throw new Error('SPIRIT_WORK_ORDER_NOT_FOUND');
          const reserved = await this.persistence.reservePlayerWorkOrder({ orderId: order.orderId, ownerPlayerId, expectedRevision: order.revision });
          if (!reserved) throw new Error('SPIRIT_WORK_ORDER_RESERVATION_CONFLICT');
          const skillLevel = Math.max(1, Math.trunc(Number(player[`${skill}Skill`]?.level) || 1));
          const speed = 1 + skillLevel / 100;
          reserved.totalTicks = Math.max(1, Math.ceil(reserved.totalTicks / speed));
          reserved.remainingTicks = Math.max(1, Math.ceil(reserved.remainingTicks / speed));
          reserved.revision += 1;
          this.dirtyOrders.add(reserved.orderId);
          this.workOrders.set(order.orderId, reserved);
          const deps = { plantingWorkPort: this, facilityWorkPort: this };
          const payload = skill === 'planting' ? { orderId: order.orderId } : { facilityOrderId: order.orderId };
          const started = this.craftPanelRuntimeService.startTechniqueActivity(player, skill, payload, deps);
          if (!started?.ok || !('started' in started) || started.started !== true) {
            const released = await this.persistence.releasePlayerWorkOrder({ ownerPlayerId, orderId: order.orderId });
            if (released) this.workOrders.set(order.orderId, released);
            throw new Error(normalizeId(started?.error) || 'SPIRIT_MANUAL_WORK_START_FAILED');
          }
          this.bumpPanelRevision(); break;
        }
        case 'cancel_order': {
          await this.flushDirtyProgress();
          const result = await this.persistence.cancelWorkOrder({ operationId: requestId, ownerPlayerId, orderId: command.orderId });
          if (result.result.workerId) this.workers.delete(result.result.workerId);
          this.workOrders.delete(result.result.orderId); this.bumpPanelRevision(); break;
        }
        case 'deposit': {
          this.requireFacility(context, command.buildingId);
          await this.playerRuntimeService.runExclusiveAssetMutation([ownerPlayerId], async () => {
            const player = this.playerRuntimeService.getPlayer(ownerPlayerId);
            if (!player) throw new Error('SPIRIT_PLAYER_NOT_ONLINE');
            const entries = buildDepositEntries(player, command.entries, command.spiritStones);
            await this.playerPersistenceFlushService.flushPlayerDomains(ownerPlayerId, ['inventory'], { forceCurrentSnapshot: true });
            await this.persistence.depositInventory({ operationId: requestId, ownerPlayerId,
              instanceId: context.sectInstanceId!, buildingId: command.buildingId, entries });
            this.playerRuntimeService.replaceInventoryItems(ownerPlayerId,
              await this.persistence.listPlayerInventoryItems(ownerPlayerId));
          });
          for (const crop of this.crops.values()) {
            if (crop.ownerPlayerId === ownerPlayerId && crop.buildingId === command.buildingId && crop.status === 'planned') {
              await this.ensureCropSowOrder(crop);
            }
          }
          this.bumpPanelRevision(); break;
        }
        case 'withdraw': {
          this.requireFacility(context, command.buildingId);
          await this.playerRuntimeService.runExclusiveAssetMutation([ownerPlayerId], async () => {
            const player = this.playerRuntimeService.getPlayer(ownerPlayerId);
            if (!player) throw new Error('SPIRIT_PLAYER_NOT_ONLINE');
            await this.playerPersistenceFlushService.flushPlayerDomains(ownerPlayerId, ['inventory'], { forceCurrentSnapshot: true });
            await this.persistence.withdrawInventory({ operationId: requestId, ownerPlayerId,
              instanceId: context.sectInstanceId!, buildingId: command.buildingId, entries: command.entries,
              inventoryCapacity: Math.max(1, Math.trunc(Number(player.inventory.capacity) || 1)) });
            this.playerRuntimeService.replaceInventoryItems(ownerPlayerId,
              await this.persistence.listPlayerInventoryItems(ownerPlayerId));
          });
          this.bumpPanelRevision(); break;
        }
        case 'cancel_manual_work': {
          const player = this.playerRuntimeService.getPlayer(ownerPlayerId);
          const orders = Array.from(this.workOrders.values()).filter((entry) => entry.ownerPlayerId === ownerPlayerId
            && entry.buildingId === command.buildingId);
          const running = orders.find((entry) => entry.workerKind === 'player' && entry.status === 'running');
          const waiting = orders.find((entry) => entry.status === 'waiting' && entry.payload.manualRepeat === true);
          const order = running ?? waiting;
          if (!order) throw new Error('SPIRIT_MANUAL_WORK_NOT_FOUND');
          if (running) {
            if (!player) throw new Error('SPIRIT_MANUAL_WORK_NOT_FOUND');
            const cancelled = this.craftPanelRuntimeService.cancelTechniqueActivity(player, order.skill, { plantingWorkPort: this, facilityWorkPort: this });
            if (!cancelled?.ok) throw new Error(normalizeId(cancelled?.error) || 'SPIRIT_MANUAL_WORK_CANCEL_FAILED');
          }
          await this.flushDirtyProgress();
          await this.persistence.cancelWorkOrder({ operationId: requestId, ownerPlayerId, orderId: order.orderId });
          this.workOrders.delete(order.orderId); this.bumpPanelRevision(); break;
        }
        case 'set_crop_plan': {
          this.requireFacility(context, command.buildingId, 'field');
          if (command.seedItemId === null) {
            const existing = Array.from(this.crops.values()).find((entry) => entry.ownerPlayerId === ownerPlayerId
              && entry.buildingId === command.buildingId && entry.status === 'planned');
            if (existing) {
              await this.persistence.cancelCrop({ operationId: requestId, ownerPlayerId, cropId: existing.cropId });
              this.crops.delete(existing.cropId);
            }
            this.bumpPanelRevision(); break;
          }
          const seed = SPIRIT_BEAST_SEEDS.find((entry) => entry.itemId === command.seedItemId);
          if (!seed) throw new Error('SPIRIT_SEED_NOT_FOUND');
          const cropId = randomUUID();
          const player = this.playerRuntimeService.getPlayer(ownerPlayerId);
          if (!player) throw new Error('SPIRIT_PLAYER_NOT_ONLINE');
          const plantingLevel = Math.max(1, Math.trunc(Number(player.plantingSkill?.level) || 1));
          if (plantingLevel < seed.requiredLevel) throw new Error('SPIRIT_PLANTING_LEVEL_TOO_LOW');
          const result = await this.persistence.createCropPlan({ operationId: requestId, cropId, ownerPlayerId,
            sectId: context.sectId!, instanceId: context.sectInstanceId!, buildingId: command.buildingId,
            seedItemId: seed.itemId, outputItemId: seed.outputItemId, growthTicks: SPIRIT_BEAST_RULES.cropGrowthTicks,
            repeatEnabled: command.repeat });
          const crop = result.result;
          this.crops.set(crop.cropId, crop);
          await this.ensureCropSowOrder(crop);
          this.bumpPanelRevision(); break;
        }
        case 'cancel_crop': {
          this.requireFacility(context, command.buildingId, 'field');
          await this.flushDirtyProgress();
          await this.persistence.cancelCrop({ operationId: requestId, ownerPlayerId, cropId: command.cycleId });
          this.crops.delete(command.cycleId);
          for (const [orderId, order] of this.workOrders) {
            if (order.payload.cropId !== command.cycleId) continue;
            if (order.workerId) this.workers.delete(order.workerId);
            this.workOrders.delete(orderId);
          }
          this.bumpPanelRevision(); break;
        }
        case 'set_mine_enabled': {
          const facility = this.requireFacility(context, command.buildingId);
          if (facility.definition.kind !== 'iron_mine' && facility.definition.kind !== 'spirit_stone_mine') {
            throw new Error('SPIRIT_FACILITY_KIND_MISMATCH');
          }
          const active = Array.from(this.workOrders.values()).filter((entry) => entry.ownerPlayerId === ownerPlayerId
            && entry.buildingId === command.buildingId && entry.payload.repeat === true
            && !['completed', 'cancelled'].includes(entry.status));
          if (!command.enabled) {
            for (const [index, order] of active.entries()) {
              await this.persistence.cancelWorkOrder({ operationId: `${requestId}:${index}`, ownerPlayerId, orderId: order.orderId });
              if (order.workerId) this.workers.delete(order.workerId);
              this.workOrders.delete(order.orderId);
            }
          } else if (active.length === 0) {
            const action = facility.definition.kind === 'iron_mine' ? 'mine_iron' : 'mine_spirit_stone';
            const orderId = randomUUID();
            const created = await this.persistence.createWorkOrder({ operationId: requestId, orderId, ownerPlayerId,
              sectId: context.sectId, instanceId: context.sectInstanceId, buildingId: command.buildingId,
              skill: 'mining', action, payload: { repeat: true, x: facility.building.x, y: facility.building.y },
              priority: 10, totalTicks: action === 'mine_iron' ? SPIRIT_BEAST_RULES.ironMineWorkTicks : SPIRIT_BEAST_RULES.spiritStoneMineWorkTicks });
            this.workOrders.set(created.result.orderId, created.result); this.kickScheduler();
          }
          this.bumpPanelRevision(); break;
        }
        case 'buy_seed': {
          const seed = SPIRIT_BEAST_SEEDS.find((entry) => entry.itemId === command.itemId);
          const count = Math.max(1, Math.trunc(Number(command.count) || 1));
          if (!seed) throw new Error('SPIRIT_SEED_NOT_FOUND');
          await this.playerRuntimeService.runExclusiveAssetMutation([ownerPlayerId], async () => {
            const player = this.playerRuntimeService.getPlayer(ownerPlayerId);
            if (!player) throw new Error('SPIRIT_PLAYER_NOT_ONLINE');
            await this.playerPersistenceFlushService.flushPlayerDomains(ownerPlayerId, ['inventory'], { forceCurrentSnapshot: true });
            const template = this.contentTemplateRepository.createItem(seed.itemId, count);
            if (!template) throw new Error('SPIRIT_SEED_TEMPLATE_NOT_FOUND');
            await this.persistence.purchaseInventoryItem({ operationId: requestId, ownerPlayerId,
              itemId: seed.itemId, count, spiritStoneCost: seed.purchaseSpiritStones * count,
              rawPayload: template as Record<string, unknown>, inventoryCapacity: Math.max(1, Number(player.inventory.capacity) || 1) });
            this.playerRuntimeService.replaceInventoryItems(ownerPlayerId,
              await this.persistence.listPlayerInventoryItems(ownerPlayerId));
          });
          this.bumpPanelRevision(); break;
        }
        default:
          throw new Error('SPIRIT_BEAST_COMMAND_UNKNOWN');
      }
      return { requestId, ok: true, revision: this.panelRevision };
    } catch (error) {
      return this.failure(requestId, normalizeReason(error));
    }
  }

  /** 由 1Hz dispatcher 呼叫；只更新已恢復的 active maps，不查 DB、不掃玩家。 */
  advanceTicks(elapsedTicks: number, resolveInstance?: (instanceId: string) => SpiritBeastMapInstance | null | undefined): void {
    const ticks = Math.max(0, Math.trunc(elapsedTicks));
    if (ticks <= 0) return;
    if (resolveInstance) this.resolveMapInstance = resolveInstance;
    this.logicalTick += ticks;
    for (const hatch of this.hatches.values()) {
      if (hatch.status !== 'incubating') continue;
      hatch.remainingTicks = Math.max(0, hatch.remainingTicks - ticks);
      if (hatch.remainingTicks === 0) hatch.status = 'ready';
      hatch.revision += 1; this.dirtyHatches.add(hatch.hatchId);
    }
    for (const crop of this.crops.values()) {
      if (crop.status !== 'growing') continue;
      const firstWaterAt = Math.ceil(crop.growthTotalTicks * 2 / 3);
      const secondWaterAt = Math.ceil(crop.growthTotalTicks / 3);
      if ((crop.wateringMask === 0 && crop.growthRemainingTicks <= firstWaterAt)
        || (crop.wateringMask === 1 && crop.growthRemainingTicks <= secondWaterAt)) {
        void this.ensureCropActionOrder(crop, 'water');
      }
      crop.growthRemainingTicks = Math.max(0, crop.growthRemainingTicks - ticks);
      if (crop.growthRemainingTicks === 0) {
        crop.status = 'mature';
        void (crop.wateringMask >= 2 ? this.ensureCropActionOrder(crop, 'harvest') : this.ensureCropActionOrder(crop, 'water'));
      }
      crop.revision += 1; this.dirtyCrops.add(crop.cropId);
    }
    for (let step = 0; step < ticks; step += 1) {
      for (const order of this.workOrders.values()) {
        if (order.status !== 'running' || order.workerKind !== 'spirit_beast' || !order.workerId) continue;
        const beast = this.activeBeasts.get(order.workerId);
        const instance = resolveInstance?.(order.instanceId);
        if (beast && distance(beast, order) > 2) {
          if (instance && this.advanceBeastTowardOrder(beast, order, instance)) continue;
          if (instance) continue;
        }
        const worker = this.workers.get(order.workerId);
        if (!worker) continue;
        this.workPipeline.tick(worker, order.skill as never, this.workPipelineContext);
        order.remainingTicks = Math.max(0, Math.trunc(Number(worker.activeJob?.remainingTicks) || 0));
        if (order.action === 'construct' && instance) {
          const completed = this.applyConstructionProgress(instance, order);
          if (completed) {
            order.remainingTicks = 0;
            if (worker.activeJob) worker.activeJob.remainingTicks = 0;
            this.completedOrderIds.add(order.orderId);
          }
        }
        order.revision += 1; this.dirtyOrders.add(order.orderId);
      }
    }
    for (const orderId of this.completedOrderIds) {
      const order = this.workOrders.get(orderId);
      if (order) void this.settleCompletedOrder(order);
    }
    this.completedOrderIds.clear();
    if (this.logicalTick % FLUSH_INTERVAL_TICKS === 0) void this.flushDirtyProgress();
  }

  private advanceBeastTowardOrder(beast: SpiritBeastRow, order: SpiritWorkOrderRow, instance: SpiritBeastMapInstance): boolean {
    if (beast.x === null || beast.y === null || typeof instance.toTileIndex !== 'function'
      || typeof instance.isCellIndexWalkable !== 'function' || typeof instance.isInBounds !== 'function') return false;
    let path = this.movementPaths.get(beast.beastId) ?? [];
    const next = path[0];
    if (!next || instance.isCellIndexWalkable(instance.toTileIndex(next.x, next.y)) !== true) {
      const staticView = {
        template: instance.template ?? { width: 0, height: 0 }, occupancy: instance.occupancy, tilePlane: instance.tilePlane,
        isInBounds: (x: number, y: number) => instance.isInBounds!(x, y),
        toTileIndex: (x: number, y: number) => instance.toTileIndex!(x, y),
        isWalkable: (x: number, y: number) => instance.isCellIndexWalkable!(instance.toTileIndex!(x, y)) === true,
        getTileTraversalCost: () => 1,
        forEachPathingBlocker: (_playerId: unknown, _visit: unknown) => undefined,
      };
      const resolved = findPathToTargetWithinRangeOnMap(staticView, null, beast.x, beast.y,
        Math.trunc(Number(order.payload.x) || 0), Math.trunc(Number(order.payload.y) || 0), 2, false);
      path = resolved?.points ?? [];
      if (path.length === 0) { this.movementPaths.delete(beast.beastId); return false; }
      this.movementPaths.set(beast.beastId, path);
    }
    const step = path.shift();
    if (!step) return false;
    const fromX = beast.x; const fromY = beast.y;
    beast.x = step.x; beast.y = step.y; beast.facing = resolveFacing(fromX, fromY, step.x, step.y, beast.facing);
    beast.revision += 1; this.dirtyBeasts.add(beast.beastId);
    if (path.length === 0) this.movementPaths.delete(beast.beastId);
    return true;
  }

  private applyConstructionProgress(instance: SpiritBeastMapInstance, order: SpiritWorkOrderRow): boolean {
    const building = instance.buildingById?.get(order.buildingId);
    if (!building || building.state !== 'building') return true;
    const previous = Math.max(0, Number(building.buildRemainingTicks ?? building.buildStrength) || 0);
    if (previous <= 0) return true;
    const totalWork = Math.max(1, Number(order.payload.buildWorkTotal) || previous);
    const progress = Math.max(Number.MIN_VALUE, totalWork / Math.max(1, order.totalTicks));
    const remaining = Math.max(0, Number((previous - progress).toFixed(6)));
    building.buildRemainingTicks = remaining;
    building.buildCompleteTick = remaining > 0 ? Math.max(0, Number(instance.tick) || 0) + Math.ceil(remaining / progress) : Number(instance.tick) || 0;
    building.updatedAtTick = Number(instance.tick) || 0;
    building.revision = Math.max(1, Math.trunc(Number(building.revision) || 1)) + 1;
    instance.markAoiViewChangedAt?.(Number(building.x) || 0, Number(building.y) || 0);
    instance.worldRevision = Math.max(0, Math.trunc(Number(instance.worldRevision) || 0)) + 1;
    instance.persistentRevision = Math.max(0, Math.trunc(Number(instance.persistentRevision) || 0)) + 1;
    instance.markPersistenceDirtyDomainsHighPriority?.(['building']);
    if (remaining > 0) return false;
    building.state = 'active'; building.activeBuilderPlayerId = null;
    const domains = instance.activatePlacedBuildingTopologyAndVisual?.(building) ?? [];
    if (domains.length > 0) instance.markPersistenceDirtyDomainsHighPriority?.(domains);
    return true;
  }

  listMapProjections(instanceId: string): SpiritBeastMapProjection[] {
    const result: SpiritBeastMapProjection[] = [];
    for (const beastId of this.activeBeastIdsByInstance.get(instanceId) ?? []) {
      const beast = this.activeBeasts.get(beastId);
      if (!beast) continue;
      if (beast.instanceId !== instanceId || beast.x === null || beast.y === null || beast.state === 'warehouse') continue;
      result.push({ instanceId: beast.beastId, speciesId: beast.speciesId, ownerPlayerId: beast.ownerPlayerId,
        x: beast.x, y: beast.y, state: mapProjectionState(beast.state), ...(beast.activeJobId ? { buildingId: this.workOrders.get(beast.activeJobId)?.buildingId } : {}) });
    }
    return result.sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  }

  getAssignment(playerId: string, orderId: string): PlantingWorkAssignment | null {
    const order = this.workOrders.get(orderId);
    if (!order || order.ownerPlayerId !== playerId || order.workerKind !== 'player' || order.workerId !== playerId
      || order.skill !== 'planting' || order.status !== 'running') return null;
    return { orderId, instanceId: order.instanceId, buildingId: order.buildingId, buildingName: FACILITY_NAMES.field,
      x: Math.trunc(Number(order.payload.x) || 0), y: Math.trunc(Number(order.payload.y) || 0),
      action: order.action === 'water' || order.action === 'harvest' ? order.action : 'sow',
      totalTicks: order.totalTicks, remainingTicks: order.remainingTicks };
  }

  isCurrent(playerId: string, job: PlayerPlantingJob): boolean {
    const assignment = this.getAssignment(playerId, normalizeId(job.orderId));
    if (!assignment || assignment.instanceId !== normalizeId(job.instanceId)
      || assignment.buildingId !== normalizeId(job.buildingId)) return false;
    const player = this.playerRuntimeService.getPlayer(playerId);
    const instanceId = normalizeId(player?.instanceId ?? player?.location?.instanceId);
    const x = Math.trunc(Number(player?.x ?? player?.location?.x) || 0);
    const y = Math.trunc(Number(player?.y ?? player?.location?.y) || 0);
    const building = this.resolveMapInstance?.(assignment.instanceId)?.buildingById?.get(assignment.buildingId);
    return instanceId === assignment.instanceId && (!this.resolveMapInstance || building?.state === 'active')
      && Math.max(Math.abs(x - assignment.x), Math.abs(y - assignment.y)) <= 2;
  }

  complete(playerId: string, job: PlayerPlantingJob): void {
    const orderId = normalizeId(job.orderId);
    const order = this.workOrders.get(orderId);
    if (order?.ownerPlayerId === playerId && order.workerKind === 'player') {
      order.remainingTicks = 0; order.revision += 1; this.dirtyOrders.add(orderId); this.completedOrderIds.add(orderId);
      void this.settleCompletedOrder(order);
    }
  }

  release(playerId: string, job: PlayerPlantingJob): void {
    const order = this.workOrders.get(normalizeId(job.orderId));
    if (!order || order.ownerPlayerId !== playerId || order.workerKind !== 'player') return;
    order.status = 'waiting'; order.workerKind = null; order.workerId = null; order.jobRunId = null;
    order.revision += 1; this.dirtyOrders.add(order.orderId);
    queueMicrotask(() => void this.persistence.releasePlayerWorkOrder({ ownerPlayerId: playerId, orderId: order.orderId })
      .catch((error: unknown) => this.logger.warn(`人工靈田釋放將由進度 flush 重試：${order.orderId} ${normalizeReason(error)}`)));
  }

  getFacilityAssignment(playerId: string, orderId: string, skill: string): FacilityWorkAssignment | null {
    const order = this.workOrders.get(orderId);
    if (!order || order.ownerPlayerId !== playerId || order.skill !== skill || order.workerKind !== 'player'
      || order.workerId !== playerId || order.status !== 'running') return null;
    return { orderId, instanceId: order.instanceId, buildingId: order.buildingId,
      buildingName: FACILITY_NAMES[skill === 'mining' ? (order.action === 'mine_iron' ? 'iron_mine' : 'spirit_stone_mine') : skill as SpiritBeastFacilityKind],
      x: Math.trunc(Number(order.payload.x) || 0), y: Math.trunc(Number(order.payload.y) || 0),
      totalTicks: order.totalTicks, remainingTicks: order.remainingTicks };
  }

  isFacilityCurrent(playerId: string, orderId: string): boolean {
    const order = this.workOrders.get(orderId);
    return Boolean(order && this.getFacilityAssignment(playerId, orderId, order.skill)
      && this.isValidStationJob(playerId, { facilityOrderId: orderId, stationInstanceId: order.instanceId,
        stationBuildingId: order.buildingId }));
  }

  completeFacilityWork(playerId: string, orderId: string): void {
    const order = this.workOrders.get(orderId);
    if (!order || order.ownerPlayerId !== playerId || order.workerKind !== 'player') return;
    order.remainingTicks = 0; order.revision += 1; this.dirtyOrders.add(orderId); this.completedOrderIds.add(orderId);
    void this.settleCompletedOrder(order);
  }

  releaseFacilityWork(playerId: string, orderId: string): void {
    const order = this.workOrders.get(orderId);
    if (!order || order.ownerPlayerId !== playerId || order.workerKind !== 'player') return;
    order.status = 'waiting'; order.workerKind = null; order.workerId = null; order.jobRunId = null;
    order.revision += 1; this.dirtyOrders.add(orderId);
    queueMicrotask(() => void this.persistence.releasePlayerWorkOrder({ ownerPlayerId: playerId, orderId })
      .catch((error: unknown) => this.logger.warn(`人工工位釋放將由進度 flush 重試：${orderId} ${normalizeReason(error)}`)));
  }

  private isValidStationJob(playerId: string, job: unknown): boolean {
    const record = job && typeof job === 'object' ? job as Record<string, unknown> : {};
    const orderId = normalizeId(record.facilityOrderId ?? record.jobRunId);
    const order = this.workOrders.get(orderId);
    if (!order || order.ownerPlayerId !== playerId || order.workerKind !== 'player' || order.status !== 'running'
      || normalizeId(record.stationInstanceId) !== order.instanceId || normalizeId(record.stationBuildingId) !== order.buildingId) return false;
    const player = this.playerRuntimeService.getPlayer(playerId);
    const instanceId = normalizeId(player?.instanceId ?? player?.location?.instanceId);
    const x = Math.trunc(Number(player?.x ?? player?.location?.x) || 0);
    const y = Math.trunc(Number(player?.y ?? player?.location?.y) || 0);
    const building = this.resolveMapInstance?.(order.instanceId)?.buildingById?.get(order.buildingId);
    return instanceId === order.instanceId && (!this.resolveMapInstance || building?.state === 'active')
      && Math.max(Math.abs(x - Number(order.payload.x)), Math.abs(y - Number(order.payload.y))) <= 2;
  }

  private trackActiveBeast(beast: SpiritBeastRow): void {
    this.untrackActiveBeast(beast.beastId);
    this.activeBeasts.set(beast.beastId, beast);
    if (!beast.instanceId || beast.state === 'warehouse') return;
    let ids = this.activeBeastIdsByInstance.get(beast.instanceId);
    if (!ids) { ids = new Set<string>(); this.activeBeastIdsByInstance.set(beast.instanceId, ids); }
    ids.add(beast.beastId);
  }

  private untrackActiveBeast(beastId: string): void {
    const existing = this.activeBeasts.get(beastId);
    if (existing?.instanceId) {
      const ids = this.activeBeastIdsByInstance.get(existing.instanceId);
      ids?.delete(beastId);
      if (ids?.size === 0) this.activeBeastIdsByInstance.delete(existing.instanceId);
    }
    this.activeBeasts.delete(beastId);
  }

  private async settleCompletedOrder(order: SpiritWorkOrderRow): Promise<void> {
    if (order.status !== 'running' || order.remainingTicks !== 0) return;
    const output = resolveOrderOutput(order);
    try {
      await this.flushDirtyProgress();
      const outputRawPayload = output
        ? this.contentTemplateRepository.createItem(output.itemId, output.count) as Record<string, unknown> | null
        : null;
      const professionReward = this.resolveProfessionReward(order);
      const settled = await this.persistence.completeWorkOrder({ orderId: order.orderId, expectedRevision: order.revision,
        outputItemId: output?.itemId, outputCount: output?.count,
        ...(outputRawPayload ? { outputRawPayload } : {}),
        inputRequirements: normalizeOrderMaterials(order.payload.materials),
        ...(professionReward ? { professionReward } : {}),
        ...(order.action === 'enhance' ? { enhancementSuccessRate: this.resolveEnhancementSuccessRate(order) } : {}),
        ...(order.action === 'craft' ? { craftSuccessRate: this.resolveCraftSuccessRate(order),
          craftAttempts: Math.max(1, Math.trunc(Number(order.payload.quantity) || 1)),
          outputCountPerSuccess: Math.max(1, Math.trunc(Number(order.payload.outputCountPerBatch) || 1)) } : {}), });
      if (settled.order.status === 'waiting') this.workOrders.set(order.orderId, settled.order);
      else this.workOrders.delete(order.orderId);
      if (settled.beast) this.trackActiveBeast(settled.beast);
      if (order.workerId) this.movementPaths.delete(order.workerId);
      if (settled.crop) {
        if (settled.crop.status === 'harvested' || settled.crop.status === 'cancelled') this.crops.delete(settled.crop.cropId);
        else this.crops.set(settled.crop.cropId, settled.crop);
        if (settled.crop.status === 'planned') await this.ensureCropSowOrder(settled.crop);
        else if (settled.crop.status === 'mature' && settled.crop.wateringMask >= 2) await this.ensureCropActionOrder(settled.crop, 'harvest');
      }
      if (settled.professionState && order.workerKind === 'player' && order.workerId) {
        const player = this.playerRuntimeService.getPlayer(order.workerId);
        if (player) {
          player[`${order.skill}Skill`] = { ...settled.professionState };
          this.playerRuntimeService.markPersistenceDirtyDomains(player, ['profession']);
          this.playerRuntimeService.bumpPersistentRevision(player);
        }
      }
      this.dirtyOrders.delete(order.orderId); this.bumpPanelRevision();
      if (settled.order.status === 'waiting' && settled.order.payload.manualRepeat === true) {
        await this.tryContinueManualWork(settled.order);
      }
      this.kickScheduler();
    } catch (error) {
      this.logger.warn(`靈獸工單結算將重試：${order.orderId} ${normalizeReason(error)}`);
    }
  }

  private async tryContinueManualWork(order: SpiritWorkOrderRow): Promise<void> {
    const playerId = normalizeId(order.payload.manualPlayerId);
    if (!playerId || order.ownerPlayerId !== playerId) return;
    const player = this.playerRuntimeService.getPlayer(playerId);
    if (!player || this.craftPanelRuntimeService.hasAnyActiveTechniqueActivity(player)) return;
    const instanceId = normalizeId(player.instanceId ?? player.location?.instanceId);
    const x = Math.trunc(Number(player.x ?? player.location?.x) || 0);
    const y = Math.trunc(Number(player.y ?? player.location?.y) || 0);
    const building = this.resolveMapInstance?.(order.instanceId)?.buildingById?.get(order.buildingId);
    if (instanceId !== order.instanceId || (this.resolveMapInstance && building?.state !== 'active')
      || Math.max(Math.abs(x - Number(order.payload.x)), Math.abs(y - Number(order.payload.y))) > 2) return;
    const reserved = await this.persistence.reservePlayerWorkOrder({
      orderId: order.orderId, ownerPlayerId: playerId, expectedRevision: order.revision,
    });
    if (!reserved) return;
    const skillLevel = Math.max(1, Math.trunc(Number(player[`${reserved.skill}Skill`]?.level) || 1));
    const speed = 1 + skillLevel / 100;
    reserved.totalTicks = Math.max(1, Math.ceil(reserved.totalTicks / speed));
    reserved.remainingTicks = Math.max(1, Math.ceil(reserved.remainingTicks / speed));
    reserved.revision += 1;
    this.dirtyOrders.add(reserved.orderId);
    this.workOrders.set(reserved.orderId, reserved);
    const payload = reserved.skill === 'planting' ? { orderId: reserved.orderId } : { facilityOrderId: reserved.orderId };
    const started = this.craftPanelRuntimeService.startTechniqueActivity(player, reserved.skill, payload, {
      plantingWorkPort: this, facilityWorkPort: this,
    });
    if (!started?.ok || !('started' in started) || started.started !== true) {
      const released = await this.persistence.releasePlayerWorkOrder({ ownerPlayerId: playerId, orderId: reserved.orderId });
      if (released) this.workOrders.set(reserved.orderId, released);
    }
  }

  private kickScheduler(): void {
    queueMicrotask(() => void this.scheduleOne().catch((error: unknown) => {
      this.logger.warn(`靈獸派工失敗：${error instanceof Error ? error.message : String(error)}`);
    }));
  }

  private async scheduleOne(): Promise<void> {
    const orders = Array.from(this.workOrders.values())
      .filter((entry) => ['queued', 'waiting'].includes(entry.status) && entry.retryAfterTick <= this.logicalTick
        && entry.payload.manualRepeat !== true)
      .sort((a, b) => b.priority - a.priority || a.createdAtMs - b.createdAtMs || a.orderId.localeCompare(b.orderId));
    for (const order of orders) {
      const candidates = Array.from(this.activeBeasts.values())
        .filter((beast) => beast.state === 'summoned' && !beast.activeJobId && beast.sectId === order.sectId && beast.instanceId === order.instanceId)
        .map((beast) => ({ beast, species: this.speciesById.get(beast.speciesId) }))
        .filter((entry): entry is { beast: SpiritBeastRow; species: SpiritBeastSpecies } => Boolean(entry.species?.masteries.some((m) => m.skill === order.skill)))
        .sort((a, b) => resolveMastery(b.species, b.beast.star as SpiritBeastStar, order.skill)
          - resolveMastery(a.species, a.beast.star as SpiritBeastStar, order.skill)
          || computeSpiritBeastSpeed(b.species, b.beast.star as SpiritBeastStar, order.skill) - computeSpiritBeastSpeed(a.species, a.beast.star as SpiritBeastStar, order.skill)
          || distance(a.beast, order) - distance(b.beast, order) || a.beast.beastId.localeCompare(b.beast.beastId));
      for (const candidate of candidates) {
        const reserved = await this.persistence.reserveWorkOrder({ orderId: order.orderId, beastId: candidate.beast.beastId,
          jobRunId: randomUUID(), expectedOrderRevision: order.revision, expectedBeastRevision: candidate.beast.revision });
        if (!reserved) continue;
        this.workOrders.set(order.orderId, reserved.order); this.trackActiveBeast(reserved.beast);
        this.startWorkerLifecycle(candidate.beast.beastId, reserved.order, true);
        this.bumpPanelRevision(); return;
      }
    }
  }

  private async flushDirtyProgress(): Promise<void> {
    if (!this.persistence.isEnabled()) return;
    if (this.flushPromise) {
      await this.flushPromise;
      if (this.dirtyHatches.size || this.dirtyBeasts.size || this.dirtyOrders.size || this.dirtyCrops.size) {
        await this.flushDirtyProgress();
      }
      return;
    }
    const hatches = drainDirty(this.dirtyHatches, this.hatches);
    const beasts = drainDirty(this.dirtyBeasts, this.activeBeasts);
    const workOrders = drainDirty(this.dirtyOrders, this.workOrders);
    const crops = drainDirty(this.dirtyCrops, this.crops);
    if (!hatches.length && !beasts.length && !workOrders.length && !crops.length) return;
    this.flushPromise = this.persistence.flushProgress({ hatches, beasts, workOrders, crops })
      .catch((error: unknown) => {
        for (const row of hatches) this.dirtyHatches.add(row.hatchId);
        for (const row of beasts) this.dirtyBeasts.add(row.beastId);
        for (const row of workOrders) this.dirtyOrders.add(row.orderId);
        for (const row of crops) this.dirtyCrops.add(row.cropId);
        throw error;
      }).finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  private startWorkerLifecycle(beastId: string, order: SpiritWorkOrderRow, adjustForSpeed: boolean): void {
    if (adjustForSpeed) {
      const beast = this.activeBeasts.get(beastId);
      const species = beast ? this.speciesById.get(beast.speciesId) : null;
      const speed = beast && species ? computeSpiritBeastSpeed(species, beast.star as SpiritBeastStar, order.skill as SpiritBeastSkill) : 1;
      order.totalTicks = Math.max(1, Math.ceil(order.totalTicks / speed));
      order.remainingTicks = Math.max(1, Math.ceil(order.remainingTicks / speed));
      order.revision += 1;
      this.dirtyOrders.add(order.orderId);
    }
    const worker: SpiritBeastPipelineWorker = { playerId: order.ownerPlayerId, beastId, activeJob: null };
    const started = this.workPipeline.start(worker, order.skill as never, {
      orderId: order.orderId, totalTicks: order.totalTicks, remainingTicks: order.remainingTicks,
    }, this.workPipelineContext);
    if (!started.ok || !worker.activeJob) throw new Error('SPIRIT_WORK_PIPELINE_START_FAILED');
    this.workers.set(beastId, worker);
  }

  private buildFacilities(ownerPlayerId: string, context: SpiritBeastRuntimeContext, hatches: SpiritHatchRow[], storage: Array<{
    storageId: string; buildingId: string; itemId: string; count: number; rawPayload: Record<string, unknown>;
  }>): SpiritBeastFacilityView[] {
    return context.buildings.flatMap((building) => {
      const defId = normalizeId(building.defId);
      const definition = SPIRIT_BEAST_FACILITIES[defId];
      if (!definition) return [];
      const hatch = hatches.find((entry) => entry.buildingId === building.id && entry.status !== 'adopted' && entry.status !== 'cancelled');
      const crop = Array.from(this.crops.values()).find((entry) => entry.buildingId === building.id && entry.ownerPlayerId === ownerPlayerId);
      const orders = Array.from(this.workOrders.values()).filter((entry) => entry.buildingId === building.id && entry.ownerPlayerId === ownerPlayerId);
      const output = storage.filter((entry) => entry.buildingId === building.id)
        .map((entry) => {
          const type = normalizeItemType(entry.rawPayload.type);
          const enhancementLevel = normalizeEnhanceLevel(entry.rawPayload.enhanceLevel);
          return { itemKey: entry.storageId, itemId: entry.itemId,
            name: normalizeId(entry.rawPayload.name) || this.contentTemplateRepository.getItemName(entry.itemId) || entry.itemId,
            count: entry.count, ...(type ? { type } : {}), ...(enhancementLevel > 0 ? { enhancementLevel } : {}) };
        });
      const isMine = definition.kind === 'iron_mine' || definition.kind === 'spirit_stone_mine';
      const mineEnabled = orders.some((order) => order.payload.repeat === true && !['completed', 'cancelled'].includes(order.status));
      return [{ buildingId: normalizeId(building.id), buildingDefId: defId, name: FACILITY_NAMES[definition.kind], kind: definition.kind,
        ...(definition.element ? { element: definition.element } : {}), x: Math.trunc(Number(building.x) || 0), y: Math.trunc(Number(building.y) || 0),
        enabled: isMine ? mineEnabled : building.state === 'active', revision: Math.max(1, Math.trunc(Number(building.revision) || 1)),
        canOperate: Boolean(context.canManage && building.state === 'active'), canDeposit: context.canManage, canWithdraw: context.canManage,
        input: [], output, ...(hatch ? { hatch: this.buildHatchView(hatch, ownerPlayerId) } : {}),
        ...(crop ? { crop: this.buildCropView(crop), plannedSeedItemId: crop.seedItemId, repeatPlanting: crop.repeatEnabled } : {}),
        orders: orders.map(mapWorkOrderView) }];
    });
  }

  /** 共用既有啟動期配方 cache，避免面板另讀 JSON 或產生與實際製作不同的目錄。 */
  private buildCraftOptions(): SpiritBeastCraftOption[] {
    const build = (facilityKind: 'forging' | 'alchemy', catalog: ReadonlyArray<Record<string, unknown>>) => catalog.flatMap((raw) => {
      const recipeId = normalizeId(raw.recipeId);
      const outputItemId = normalizeId(raw.outputItemId);
      if (!recipeId || !outputItemId) return [];
      const requiredLevel = Math.max(1, Math.trunc(Number(raw.outputLevel ?? raw.level) || 1));
      const materials = (Array.isArray(raw.ingredients) ? raw.ingredients : []).flatMap((candidate) => {
        const ingredient = candidate as Record<string, unknown>;
        const itemId = normalizeId(ingredient.itemId);
        const count = Math.max(0, Math.trunc(Number(ingredient.count) || 0));
        if (!itemId || count <= 0) return [];
        return [{ itemId, name: normalizeId(ingredient.name) || this.contentTemplateRepository.getItemName(itemId) || itemId, count }];
      });
      if (materials.length === 0) return [];
      return [{ facilityKind, recipeId,
        name: normalizeId(raw.outputName) || this.contentTemplateRepository.getItemName(outputItemId) || outputItemId,
        outputItemId, requiredLevel, baseWorkTicks: Math.max(1, Math.trunc(Number(raw.baseBrewTicks) || 1)),
        materials, spiritStoneCost: getAlchemySpiritStoneCost(requiredLevel, true) }];
    });
    return [...build('forging', this.craftPanelRuntimeService.forgingCatalog),
      ...build('alchemy', this.craftPanelRuntimeService.alchemyCatalog)];
  }

  private async resolveCraftWorkOrder(
    ownerPlayerId: string,
    instanceId: string,
    command: Extract<SpiritBeastCommandView, { action: 'queue_craft' }>,
    kind: SpiritBeastFacilityKind,
  ) {
    if (kind === 'enhancement') return this.resolveEnhancementWorkOrder(ownerPlayerId, instanceId, command);
    if (kind !== 'forging' && kind !== 'alchemy') throw new Error('SPIRIT_WORK_ACTION_INVALID');
    const recipeId = normalizeId(command.recipeId);
    const option = this.buildCraftOptions().find((entry) => entry.facilityKind === kind && entry.recipeId === recipeId);
    if (!option) throw new Error('SPIRIT_CRAFT_RECIPE_NOT_FOUND');
    const quantity = Math.max(1, Math.trunc(Number(command.quantity) || 1));
    const materials = option.materials.map((entry) => ({ itemId: entry.itemId, count: entry.count * quantity }));
    const spiritStoneCost = option.spiritStoneCost * quantity;
    if (spiritStoneCost > 0) materials.push({ itemId: 'spirit_stone', count: spiritStoneCost });
    const storage = await this.persistence.listFacilityStorage(ownerPlayerId, instanceId);
    const available = new Map<string, number>();
    for (const entry of storage.filter((entry) => entry.buildingId === command.buildingId)) {
      available.set(entry.itemId, (available.get(entry.itemId) ?? 0) + entry.count);
    }
    if (materials.some((entry) => (available.get(entry.itemId) ?? 0) < entry.count)) {
      throw new Error('SPIRIT_WORK_ORDER_INPUT_SHORTAGE');
    }
    const catalog = kind === 'forging' ? this.craftPanelRuntimeService.forgingCatalog : this.craftPanelRuntimeService.alchemyCatalog;
    const rawRecipe = catalog.find((entry: Record<string, unknown>) => normalizeId(entry.recipeId) === recipeId) as Record<string, unknown> | undefined;
    const baseSuccessRate = Math.max(0, Math.min(1, Number(rawRecipe?.baseElementSuccessRate
      ?? (rawRecipe?.category === 'artifact' ? 0.1 : 1)) || 0));
    const outputCountPerBatch = kind === 'forging' ? 1 : computeAlchemyBatchOutputCountWithSize(
      Math.max(1, Math.trunc(Number(rawRecipe?.outputCount) || 1)),
      rawRecipe?.category === 'buff' ? 1 : ALCHEMY_FURNACE_OUTPUT_COUNT);
    return { skill: kind, action: 'craft',
      payload: { recipeId, quantity, materials, outputItemId: option.outputItemId, outputCount: quantity,
        outputCountPerBatch, requiredLevel: option.requiredLevel, baseSuccessRate, spiritStoneCost }, priority: 50,
      totalTicks: Math.max(1, option.baseWorkTicks * quantity) };
  }

  private async resolveEnhancementWorkOrder(
    ownerPlayerId: string,
    instanceId: string,
    command: Extract<SpiritBeastCommandView, { action: 'queue_craft' }>,
  ) {
    const targetStorageId = normalizeId(command.targetItemKey);
    if (!targetStorageId) throw new Error('SPIRIT_ENHANCEMENT_TARGET_REQUIRED');
    const target = await this.persistence.getFacilityStorageItem(ownerPlayerId, instanceId, command.buildingId, targetStorageId);
    if (!target || target.count !== 1) throw new Error('SPIRIT_ENHANCEMENT_TARGET_NOT_FOUND');
    const type = normalizeItemType(target.rawPayload.type);
    if (type !== 'equipment' && type !== 'artifact') throw new Error('SPIRIT_ENHANCEMENT_TARGET_INVALID');
    const currentLevel = normalizeEnhanceLevel(target.rawPayload.enhanceLevel);
    if (currentLevel >= MAX_ENHANCE_LEVEL) throw new Error('SPIRIT_ENHANCEMENT_MAX_LEVEL');
    const desiredTargetLevel = Math.min(MAX_ENHANCE_LEVEL,
      Math.max(currentLevel + 1, Math.trunc(Number(command.targetEnhancementLevel) || currentLevel + 1)));
    const maxAttempts = Math.max(1, Math.trunc(Number(command.maxAttempts) || desiredTargetLevel - currentLevel));
    const itemLevel = Math.max(1, Math.trunc(Number(target.rawPayload.level) || 1));
    const configs = (this.craftPanelRuntimeService as unknown as { enhancementConfigs?: Map<string, {
      steps?: Array<{ targetEnhanceLevel?: number; materials?: Array<{ itemId: string; count: number }> }>;
    }> }).enhancementConfigs;
    const config = configs?.get(target.itemId);
    const materialSchedule: Record<string, Array<{ itemId: string; count: number }>> = {};
    const spiritStoneSchedule: Record<string, number> = {};
    for (let level = 1; level <= desiredTargetLevel; level += 1) {
      const step = config?.steps?.find((entry) => Number(entry.targetEnhanceLevel) === level);
      materialSchedule[String(level)] = (step?.materials ?? []).flatMap((entry) => {
        const itemId = normalizeId(entry.itemId); const count = Math.max(0, Math.trunc(Number(entry.count) || 0));
        return itemId && count > 0 ? [{ itemId, count }] : [];
      });
      spiritStoneSchedule[String(level)] = getEnhancementSpiritStoneCost(itemLevel, materialSchedule[String(level)].length > 0);
    }
    const maxSpiritStones = Math.max(0, Math.trunc(Number(command.maxSpiritStones) || Number.MAX_SAFE_INTEGER));
    const firstTargetLevel = currentLevel + 1;
    const firstMaterials = materialSchedule[String(firstTargetLevel)] ?? [];
    const firstStoneCost = spiritStoneSchedule[String(firstTargetLevel)] ?? 1;
    if (firstStoneCost > maxSpiritStones) throw new Error('SPIRIT_ENHANCEMENT_SPIRIT_STONE_BUDGET');
    const storage = await this.persistence.listFacilityStorage(ownerPlayerId, instanceId);
    const available = new Map<string, number>();
    for (const entry of storage.filter((entry) => entry.buildingId === command.buildingId && entry.storageId !== targetStorageId)) {
      available.set(entry.itemId, (available.get(entry.itemId) ?? 0) + entry.count);
    }
    if (firstMaterials.some((entry) => (available.get(entry.itemId) ?? 0) < entry.count)
      || (available.get('spirit_stone') ?? 0) < firstStoneCost) throw new Error('SPIRIT_WORK_ORDER_INPUT_SHORTAGE');
    return { skill: 'enhancement' as const, action: 'enhance', priority: 60,
      payload: { targetStorageId, targetItemKey: targetStorageId, targetItemId: target.itemId, itemLevel, currentLevel, desiredTargetLevel,
        maxAttempts, attempts: 0, maxSpiritStones, spentSpiritStones: 0, materialSchedule, spiritStoneSchedule },
      totalTicks: computeEnhancementJobTicks(itemLevel, 0) };
  }

  private resolveEnhancementSuccessRate(order: SpiritWorkOrderRow): number {
    const targetLevel = Math.max(1, normalizeEnhanceLevel(order.payload.currentLevel) + 1);
    let skillLevel = 1;
    if (order.workerKind === 'player' && order.workerId) {
      const player = this.playerRuntimeService.getPlayer(order.workerId);
      skillLevel = Math.max(1, Math.trunc(Number(player?.enhancementSkill?.level) || 1));
    } else if (order.workerKind === 'spirit_beast' && order.workerId) {
      const beast = this.activeBeasts.get(order.workerId);
      const species = beast ? this.speciesById.get(beast.speciesId) : null;
      if (beast && species) skillLevel = Math.max(1, resolveMastery(species, beast.star as SpiritBeastStar, 'enhancement'));
    }
    const base = computeEnhancementAdjustedSuccessRate(targetLevel, skillLevel,
      Math.max(1, Math.trunc(Number(order.payload.itemLevel) || 1)), 0, 0);
    return Math.min(1, base + (order.workerKind === 'player' && order.workerId
      && this.isValidStationJob(order.workerId, { facilityOrderId: order.orderId,
        stationInstanceId: order.instanceId, stationBuildingId: order.buildingId }) ? 0.1 : 0));
  }

  private resolveCraftSuccessRate(order: SpiritWorkOrderRow): number {
    const base = Math.max(0, Math.min(1, Number(order.payload.baseSuccessRate) || 0));
    const targetLevel = Math.max(1, Math.trunc(Number(order.payload.requiredLevel) || 1));
    let skillLevel = 1;
    if (order.workerKind === 'player' && order.workerId) {
      const player = this.playerRuntimeService.getPlayer(order.workerId);
      skillLevel = Math.max(1, Math.trunc(Number(order.skill === 'forging'
        ? player?.forgingSkill?.level : player?.alchemySkill?.level) || 1));
    } else if (order.workerKind === 'spirit_beast' && order.workerId) {
      const beast = this.activeBeasts.get(order.workerId); const species = beast ? this.speciesById.get(beast.speciesId) : null;
      if (beast && species) skillLevel = Math.max(1, resolveMastery(species, beast.star as SpiritBeastStar, order.skill));
    }
    const adjusted = computeAlchemyAdjustedSuccessRate(base, targetLevel, skillLevel, 0, 0);
    return Math.min(1, adjusted + (order.skill === 'forging' && order.workerKind === 'player' && order.workerId
      && this.isValidStationJob(order.workerId, { facilityOrderId: order.orderId,
        stationInstanceId: order.instanceId, stationBuildingId: order.buildingId }) ? 0.1 : 0));
  }

  private resolveProfessionReward(order: SpiritWorkOrderRow): {
    professionType: SpiritBeastSkill; playerRealmLevel: number; skillLevel: number; targetLevel: number;
    baseActionTicks: number; fallbackExp: number; expToNextByLevel: Record<string, number>;
  } | null {
    if (order.workerKind !== 'player' || !order.workerId) return null;
    const player = this.playerRuntimeService.getPlayer(order.workerId);
    const skillState = player?.[`${order.skill}Skill`];
    if (!skillState) return null;
    const skillLevel = Math.max(1, Math.trunc(Number(skillState.level) || 1));
    const targetLevel = order.skill === 'planting'
      ? SPIRIT_BEAST_SEEDS.find((seed) => seed.itemId === order.payload.seedItemId)?.requiredLevel ?? skillLevel
      : order.skill === 'enhancement' ? Math.max(1, Math.trunc(Number(order.payload.itemLevel) || 1))
        : Math.max(1, Math.trunc(Number(order.payload.requiredLevel) || skillLevel));
    const expToNextByLevel: Record<string, number> = {};
    for (let level = skillLevel; level <= skillLevel + 8; level += 1) {
      expToNextByLevel[String(level)] = Math.max(1,
        resolveCraftSkillExpToNextByLevel(this.playerRuntimeService, level, skillState.expToNext));
    }
    return { professionType: order.skill, playerRealmLevel: Math.max(1, Math.trunc(Number(player.realmLv) || 1)),
      skillLevel, targetLevel, baseActionTicks: Math.max(1, order.totalTicks),
      fallbackExp: Math.max(0, Number(skillState.exp) || 0), expToNextByLevel };
  }

  private async ensureCropSowOrder(crop: SpiritCropRow): Promise<void> {
    if (Array.from(this.workOrders.values()).some((order) => order.payload.cropId === crop.cropId
      && !['completed', 'cancelled'].includes(order.status))) return;
    const storage = await this.persistence.listFacilityStorage(crop.ownerPlayerId, crop.instanceId);
    if (storage.filter((entry) => entry.buildingId === crop.buildingId && entry.itemId === crop.seedItemId)
      .reduce((sum, entry) => sum + entry.count, 0) < 1) return;
    const orderId = randomUUID();
    const created = await this.persistence.createWorkOrder({ operationId: `crop-sow:${crop.cropId}`, orderId,
      ownerPlayerId: crop.ownerPlayerId, sectId: crop.sectId, instanceId: crop.instanceId, buildingId: crop.buildingId,
      skill: 'planting', action: 'sow', payload: { cropId: crop.cropId, seedItemId: crop.seedItemId,
        materials: [{ itemId: crop.seedItemId, count: 1 }] }, priority: 80, totalTicks: SPIRIT_BEAST_RULES.sowWorkTicks });
    this.workOrders.set(created.result.orderId, created.result);
    this.kickScheduler();
  }

  private async ensureConstructionOrders(ownerPlayerId: string, context: SpiritBeastRuntimeContext): Promise<void> {
    if (!context.sectId || !context.sectInstanceId) return;
    for (const building of context.buildings) {
      const buildingId = normalizeId(building.id);
      if (!buildingId || building.state !== 'building') continue;
      if (Array.from(this.workOrders.values()).some((order) => order.instanceId === context.sectInstanceId
        && order.buildingId === buildingId && order.action === 'construct'
        && !['completed', 'cancelled'].includes(order.status))) continue;
      const order = await this.persistence.ensureConstructionWorkOrder({ ownerPlayerId, sectId: context.sectId,
        instanceId: context.sectInstanceId, buildingId, x: Math.trunc(Number(building.x) || 0),
        y: Math.trunc(Number(building.y) || 0), totalWork: Math.max(1,
          Number(building.buildRemainingTicks ?? building.buildStrength) || 1),
        buildingRevision: Math.max(1, Math.trunc(Number(building.revision) || 1)) });
      this.workOrders.set(order.orderId, order);
    }
    this.kickScheduler();
  }

  private async ensureCropActionOrder(crop: SpiritCropRow, action: 'water' | 'harvest'): Promise<void> {
    if (Array.from(this.workOrders.values()).some((order) => order.payload.cropId === crop.cropId
      && order.action === action && !['completed', 'cancelled'].includes(order.status))) return;
    const orderId = randomUUID();
    const created = await this.persistence.createWorkOrder({ operationId: `crop-${action}:${crop.cropId}:${crop.revision}`,
      orderId, ownerPlayerId: crop.ownerPlayerId, sectId: crop.sectId, instanceId: crop.instanceId,
      buildingId: crop.buildingId, skill: 'planting', action, payload: { cropId: crop.cropId,
        ...(action === 'harvest' ? { outputItemId: crop.outputItemId } : {}) }, priority: 90,
      totalTicks: action === 'water' ? SPIRIT_BEAST_RULES.waterWorkTicks : SPIRIT_BEAST_RULES.harvestWorkTicks });
    this.workOrders.set(created.result.orderId, created.result); this.kickScheduler();
  }

  private buildHatchView(hatch: SpiritHatchRow, ownerPlayerId: string) {
    const egg = { element: hatch.eggElement, star: hatch.eggStar as SpiritBeastStar };
    return { hatchId: hatch.hatchId, ownerPlayerId: hatch.ownerPlayerId, buildingId: hatch.buildingId,
      element: egg.element, eggStar: egg.star, state: hatch.status as 'incubating' | 'ready', workTotalTicks: hatch.totalTicks,
      workRemainingTicks: hatch.remainingTicks, speedMultiplier: hatch.totalTicks > 0 ? SPIRIT_BEAST_RULES.hatchBaseWorkTicks / hatch.totalTicks : 1,
      revision: hatch.revision,
      ...(hatch.status === 'ready' ? { offspring: this.buildBeastView({
        beastId: hatch.pendingBeastId, ownerPlayerId: hatch.ownerPlayerId, speciesId: hatch.resultSpeciesId,
        grade: hatch.resultGrade, element: egg.element, star: 1, baseCombatPower: hatch.resultCombatPower,
        skillLevels: {}, speedBonusPercent: 0, state: 'warehouse', sectId: null, instanceId: null, x: null, y: null,
        facing: null, activeJobId: null, favorite: false, revision: hatch.revision,
      }, ownerPlayerId) } : {}) };
  }

  private buildCropView(crop: SpiritCropRow) {
    const seed = SPIRIT_BEAST_SEEDS.find((entry) => entry.itemId === crop.seedItemId);
    const firstWaterAt = Math.ceil(crop.growthTotalTicks * 2 / 3);
    const secondWaterAt = Math.ceil(crop.growthTotalTicks / 3);
    const needsWater = (crop.wateringMask === 0 && crop.growthRemainingTicks <= firstWaterAt)
      || (crop.wateringMask === 1 && crop.growthRemainingTicks <= secondWaterAt)
      || (crop.status === 'mature' && crop.wateringMask < 2);
    const state = crop.status === 'planned' ? 'planned' as const
      : needsWater ? 'needs_water' as const : crop.status === 'mature' ? 'mature' as const : 'growing' as const;
    return { cycleId: crop.cropId, seedItemId: crop.seedItemId, outputItemId: crop.outputItemId,
      name: seed?.outputName ?? this.contentTemplateRepository.getItemName(crop.outputItemId) ?? crop.outputItemId,
      growthTotalTicks: crop.growthTotalTicks, growthRemainingTicks: crop.growthRemainingTicks,
      wateredCount: Math.min(2, crop.wateringMask), wateringRequired: 2,
      state };
  }

  private buildBeastView(beast: SpiritBeastRow, viewerPlayerId: string): SpiritBeastView {
    const species = this.requireSpecies(beast.speciesId);
    const star = beast.star as SpiritBeastStar;
    return { ...this.toRecord(beast), name: species.name, grade: species.grade, element: species.element,
      masteries: computeSpiritBeastMasteries(species, star), effectiveSpeed: computeSpiritBeastSpeed(species, star),
      combatPower: computeSpiritBeastCombatPower(beast.baseCombatPower, star), canManage: beast.ownerPlayerId === viewerPlayerId };
  }

  private toRecord(beast: SpiritBeastRow): SpiritBeastRecord {
    return { instanceId: beast.beastId, ownerPlayerId: beast.ownerPlayerId, speciesId: beast.speciesId,
      star: beast.star as SpiritBeastStar, baseCombatPower: beast.baseCombatPower,
      state: mapRecordState(beast.state), protected: beast.favorite, revision: beast.revision,
      summonedSectId: beast.sectId, instanceMapId: beast.instanceId, ...(beast.x === null ? {} : { x: beast.x }),
      ...(beast.y === null ? {} : { y: beast.y }), jobRunId: beast.activeJobId,
      buildingId: beast.activeJobId ? this.workOrders.get(beast.activeJobId)?.buildingId ?? null : null };
  }

  private requireFacility(context: SpiritBeastRuntimeContext, buildingId: string, expectedKind?: SpiritBeastFacilityKind) {
    const building = context.buildings.find((entry) => entry.id === buildingId);
    const definition = building ? SPIRIT_BEAST_FACILITIES[normalizeId(building.defId)] : null;
    if (!building || !definition || building.state !== 'active') throw new Error('SPIRIT_FACILITY_NOT_AVAILABLE');
    if (expectedKind && definition.kind !== expectedKind) throw new Error('SPIRIT_FACILITY_KIND_MISMATCH');
    return { definition, building };
  }

  private requireSpecies(speciesId: string): SpiritBeastSpecies {
    const species = this.speciesById.get(speciesId);
    if (!species) throw new Error('SPIRIT_SPECIES_NOT_FOUND');
    return species;
  }

  private randomSample(): number { return randomInt(0x1000000) / 0x1000000; }
  private rollPromotion(): boolean { return randomInt(10_000) < SPIRIT_BEAST_RULES.evolutionSuccessBasisPoints; }
  private bumpPanelRevision(): void { this.panelRevision += 1; }
  private failure(requestId: string, reasonKey: string): SpiritBeastCommandResultView {
    return { requestId, ok: false, revision: this.panelRevision, reasonKey };
  }
}

function resolveManualWorkOrder(command: Extract<SpiritBeastCommandView, { action: 'manual_work' }>, kind: SpiritBeastFacilityKind) {
  if (kind === 'iron_mine') return { skill: 'mining' as const, action: 'mine_iron', payload: {}, priority: 10, totalTicks: SPIRIT_BEAST_RULES.ironMineWorkTicks };
  if (kind === 'spirit_stone_mine') return { skill: 'mining' as const, action: 'mine_spirit_stone', payload: {}, priority: 10, totalTicks: SPIRIT_BEAST_RULES.spiritStoneMineWorkTicks };
  if (kind === 'field') return { skill: 'planting' as const, action: command.workAction ?? 'sow', payload: {}, priority: 100, totalTicks: command.workAction === 'water' ? 5 : 10 };
  throw new Error('SPIRIT_WORK_ACTION_INVALID');
}

function resolveOrderOutput(order: SpiritWorkOrderRow): { itemId: string; count: number } | null {
  if (order.action === 'mine_iron') return { itemId: 'black_iron_chunk', count: 1 };
  if (order.action === 'mine_spirit_stone') return { itemId: 'spirit_stone', count: 1 };
  if (order.action === 'harvest') {
    const itemId = normalizeId(order.payload.outputItemId);
    return itemId ? { itemId, count: SPIRIT_BEAST_RULES.cropOutputCount } : null;
  }
  if (order.action === 'craft') {
    const itemId = normalizeId(order.payload.outputItemId);
    const count = Math.max(0, Math.trunc(Number(order.payload.outputCount) || 0));
    return itemId && count > 0 ? { itemId, count } : null;
  }
  // 製作/強化必須由既有 strategy adapter 結算；沒有合法回傳時不生成虛構產物。
  return null;
}

function normalizeOrderMaterials(value: unknown): Array<{ itemId: string; count: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const entry = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
    const itemId = normalizeId(entry.itemId);
    const count = Math.max(0, Math.trunc(Number(entry.count) || 0));
    return itemId && count > 0 ? [{ itemId, count }] : [];
  });
}

function buildQueueCraftIdentity(ownerPlayerId: string, command: Extract<SpiritBeastCommandView, { action: 'queue_craft' }>) {
  return { action: command.action, ownerPlayerId, buildingId: normalizeId(command.buildingId),
    recipeId: normalizeId(command.recipeId), targetItemKey: normalizeId(command.targetItemKey),
    quantity: Math.max(1, Math.trunc(Number(command.quantity) || 1)),
    targetEnhancementLevel: Math.max(0, Math.trunc(Number(command.targetEnhancementLevel) || 0)),
    maxAttempts: Math.max(0, Math.trunc(Number(command.maxAttempts) || 0)),
    maxSpiritStones: Math.max(0, Math.trunc(Number(command.maxSpiritStones) || 0)) };
}

function buildDepositEntries(
  player: { inventory?: { items?: Array<Record<string, unknown>> } },
  requested: Array<{ itemKey: string; count: number }>,
  spiritStones?: number,
): Array<{ itemKey: string; count: number }> {
  const result = (requested ?? []).map((entry) => ({ itemKey: normalizeId(entry.itemKey), count: Math.max(1, Math.trunc(Number(entry.count) || 1)) }));
  let remaining = Math.max(0, Math.trunc(Number(spiritStones) || 0));
  for (const [index, item] of (player.inventory?.items ?? []).entries()) {
    if (remaining <= 0) break;
    if (normalizeId(item.itemId) !== 'spirit_stone') continue;
    const available = Math.max(0, Math.trunc(Number(item.count) || 0));
    const count = Math.min(remaining, available);
    if (count > 0) result.push({ itemKey: normalizeId(item.itemInstanceId) || `slot:${index}`, count });
    remaining -= count;
  }
  if (remaining > 0) throw new Error('SPIRIT_DEPOSIT_SPIRIT_STONE_SHORTAGE');
  if (result.some((entry) => !entry.itemKey)) throw new Error('SPIRIT_ITEM_KEY_REQUIRED');
  return result;
}

function mapWorkOrderView(order: SpiritWorkOrderRow) {
  return { orderId: order.orderId, buildingId: order.buildingId, ownerPlayerId: order.ownerPlayerId,
    skill: order.skill as SpiritBeastSkill, action: order.action, recipeId: normalizeId(order.payload.recipeId) || undefined,
    targetItemKey: normalizeId(order.payload.targetItemKey) || undefined,
    quantity: Math.max(1, Math.trunc(Number(order.payload.quantity) || 1)), completedCount: order.status === 'completed' ? 1 : 0,
    state: order.status === 'reserved' ? 'moving' as const : order.status,
    ...(order.workerKind ? { workerKind: order.workerKind } : {}), ...(order.workerId ? { workerId: order.workerId } : {}),
    workTotalTicks: order.totalTicks, workRemainingTicks: order.remainingTicks, revision: order.revision };
}

function expandEggMaterialIds(entries: Array<{ itemKey: string; count: number }>): string[] {
  const result: string[] = [];
  for (const entry of entries ?? []) {
    const count = Math.max(0, Math.trunc(Number(entry.count) || 0));
    for (let index = 0; index < count; index += 1) result.push(entry.itemKey);
  }
  return result;
}

function mapRecordState(state: SpiritBeastRow['state']): SpiritBeastRecord['state'] {
  if (state === 'warehouse') return 'stored';
  if (state === 'summoned') return 'idle';
  return state === 'working' ? 'working' : state === 'recalling' ? 'recalling' : 'locked';
}

function mapProjectionState(state: SpiritBeastRow['state']): SpiritBeastMapProjection['state'] {
  return state === 'working' ? 'working' : state === 'recalling' ? 'recalling' : state === 'summoned' ? 'idle' : 'waiting';
}

function resolveMastery(species: SpiritBeastSpecies, star: SpiritBeastStar, skill: string): number {
  return computeSpiritBeastMasteries(species, star).find((entry) => entry.skill === skill)?.level ?? 0;
}

function distance(beast: SpiritBeastRow, order: SpiritWorkOrderRow): number {
  const tx = Math.trunc(Number(order.payload.x) || 0); const ty = Math.trunc(Number(order.payload.y) || 0);
  return Math.max(Math.abs((beast.x ?? 0) - tx), Math.abs((beast.y ?? 0) - ty));
}

function resolveFacing(fromX: number, fromY: number, toX: number, toY: number, fallback: string | null): string {
  const dx = toX - fromX; const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 'right' : 'left';
  if (dy !== 0) return dy > 0 ? 'down' : 'up';
  return fallback ?? 'down';
}

function drainDirty<T>(ids: Set<string>, source: Map<string, T>): T[] {
  const result: T[] = [];
  for (const id of ids) { const row = source.get(id); if (row) result.push({ ...row }); }
  ids.clear(); return result;
}

function randomInclusive(min: number, max: number): number {
  const floor = Math.ceil(min); const ceiling = Math.floor(max);
  return ceiling <= floor ? floor : randomInt(floor, ceiling + 1);
}

function normalizeId(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function normalizeItemType(value: unknown): 'consumable' | 'equipment' | 'artifact' | 'material' | 'quest_item' | 'skill_book' | null {
  return value === 'consumable' || value === 'equipment' || value === 'artifact' || value === 'material'
    || value === 'quest_item' || value === 'skill_book' ? value : null;
}
function normalizeReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === 'SPIRIT_PLAYER_WORKER_BUSY') return 'spirit_beast.worker_busy';
  return raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'spirit_beast_command_failed';
}
function resolveElementName(element: SpiritBeastElement): string {
  return ({ metal: '金', wood: '木', water: '水', fire: '火', earth: '土' })[element];
}
