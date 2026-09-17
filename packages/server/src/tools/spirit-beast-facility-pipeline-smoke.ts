/** 用途：驗證人工靈獸設施工單經真實技藝 pipeline、reservation adapter 與權威結算入口的生命週期。 */
import { installSmokeTimeout } from './smoke-timeout';

installSmokeTimeout(__filename);

import assert from 'node:assert/strict';

import type { SpiritBeastSkill } from '@mud/shared';
import { CraftPanelRuntimeService } from '../runtime/craft/craft-panel-runtime.service';
import { TechniqueActivityPipelineService } from '../runtime/craft/pipeline/technique-activity-pipeline.service';
import type { PipelineContext } from '../runtime/craft/pipeline/technique-activity-strategy';
import { AlchemyStrategy } from '../runtime/craft/pipeline/strategies/alchemy.strategy';
import { EnhancementStrategy } from '../runtime/craft/pipeline/strategies/enhancement.strategy';
import { ForgingStrategy } from '../runtime/craft/pipeline/strategies/forging.strategy';
import { MiningStrategy } from '../runtime/craft/pipeline/strategies/mining.strategy';
import { SpiritBeastRuntimeService } from '../runtime/spirit-beast/spirit-beast-runtime.service';
import type { FacilityWorkPort } from '../runtime/spirit-beast/facility-work.port';
import type { SpiritWorkOrderRow } from '../persistence/spirit-beast-persistence.service';

type FacilityJob = {
  facilityOrderId: string;
  stationInstanceId?: string;
  stationBuildingId?: string;
  stationSuccessBonus?: number;
  phase: string;
  remainingTicks: number;
  workRemainingTicks: number;
  pausedTicks: number;
  interruptWaitRemainingTicks: number;
};

type SmokePlayer = {
  playerId: string;
  instanceId: string;
  x: number;
  y: number;
  dirtyDomains: Set<string>;
  persistentRevision: number;
  inventory: { items: unknown[] };
  miningSkill: { level: number; exp: number; expToNext: number };
  forgingSkill: { level: number; exp: number; expToNext: number };
  alchemySkill: { level: number; exp: number; expToNext: number };
  enhancementSkill: { level: number; exp: number; expToNext: number };
  miningJob?: FacilityJob | null;
  forgingJob?: FacilityJob | null;
  alchemyJob?: FacilityJob | null;
  enhancementJob?: FacilityJob | null;
};

type RuntimeHarness = FacilityWorkPort & {
  workOrders: Map<string, SpiritWorkOrderRow>;
  dirtyOrders: Set<string>;
  completedOrderIds: Set<string>;
  panelRevision: number;
  hydrationPromise: Promise<void>;
  playerRuntimeService: Record<string, unknown>;
  craftPanelRuntimeService: CraftPanelRuntimeService;
  persistence: Record<string, unknown>;
  contentTemplateRepository: { createItem(itemId: string, count: number): Record<string, unknown> };
  movementPaths: Map<string, unknown>;
  crops: Map<string, unknown>;
  hatches: Map<string, unknown>;
  activeBeasts: Map<string, unknown>;
  dirtyHatches: Set<string>;
  dirtyBeasts: Set<string>;
  dirtyCrops: Set<string>;
  kickScheduler: () => void;
  logger: { warn(message: string): void };
  executeCommand: SpiritBeastRuntimeService['executeCommand'];
};

type Probe = {
  tileReads: number;
  tileAttacks: number;
  reservationReads: Array<{ playerId: string; orderId: string; skill: string }>;
  releases: string[];
  completions: string[];
};

function createPlayer(): SmokePlayer {
  const skill = () => ({ level: 20, exp: 0, expToNext: 10_000 });
  return {
    playerId: 'player:facility-pipeline-smoke',
    instanceId: 'instance:sect-smoke',
    x: 5,
    y: 5,
    dirtyDomains: new Set<string>(),
    persistentRevision: 1,
    inventory: { items: [] },
    miningSkill: skill(),
    forgingSkill: skill(),
    alchemySkill: skill(),
    enhancementSkill: skill(),
  };
}

function createOrder(
  orderId: string,
  skill: SpiritBeastSkill,
  buildingId: string,
  overrides: Partial<SpiritWorkOrderRow> = {},
): SpiritWorkOrderRow {
  return {
    orderId,
    ownerPlayerId: 'player:facility-pipeline-smoke',
    sectId: 'sect:facility-pipeline-smoke',
    instanceId: 'instance:sect-smoke',
    buildingId,
    skill,
    action: skill === 'mining' ? 'mine_iron' : 'craft',
    payload: { x: 5, y: 5, materials: [{ itemId: 'mat:input', count: 2 }], outputItemId: 'item:output', outputCount: 1 },
    priority: 100,
    status: 'running',
    workerKind: 'player',
    workerId: 'player:facility-pipeline-smoke',
    jobRunId: orderId,
    totalTicks: 3,
    remainingTicks: 3,
    retryAfterTick: 0,
    revision: 2,
    createdAtMs: 1,
    ...overrides,
  };
}

function createLegacyCraftProbe(): Record<string, (...args: unknown[]) => unknown> {
  const fail = () => ({ ok: false, error: 'legacy path must not handle a reserved facility order' });
  return {
    validateAlchemyLikeStart: fail,
    validateEnhancementStart: fail,
    queueAlchemyLikeStart: fail,
    queueEnhancementStart: fail,
    consumeAlchemyLikeStartResources: fail,
    consumeEnhancementStartResources: fail,
    createAlchemyLikeStartJob: fail,
    createEnhancementStartJob: fail,
    finalizeAlchemyLikeStart: fail,
    finalizeEnhancementStart: fail,
    buildAlchemyLikeStartMessages: fail,
    buildEnhancementStartMessages: fail,
  };
}

function createPipeline(): TechniqueActivityPipelineService {
  const legacy = createLegacyCraftProbe();
  const pipeline = new TechniqueActivityPipelineService();
  pipeline.register(new MiningStrategy());
  pipeline.register(new ForgingStrategy(legacy));
  pipeline.register(new AlchemyStrategy(legacy));
  pipeline.register(new EnhancementStrategy(legacy));
  return pipeline;
}

function createRuntimeHarness(player: SmokePlayer, orders: SpiritWorkOrderRow[], probe: Probe): RuntimeHarness {
  const runtime = Object.create(SpiritBeastRuntimeService.prototype) as RuntimeHarness;
  runtime.workOrders = new Map(orders.map((order) => [order.orderId, order]));
  runtime.dirtyOrders = new Set<string>();
  runtime.completedOrderIds = new Set<string>();
  runtime.panelRevision = 1;
  runtime.movementPaths = new Map();
  runtime.contentTemplateRepository = {
    createItem(itemId: string, count: number): Record<string, unknown> {
      return { itemId, count, type: 'equipment', name: '測試產物', level: 10 };
    },
  };
  runtime.hydrationPromise = Promise.resolve();
  runtime.logger = { warn(message: string): void { throw new Error(message); } };
  runtime.playerRuntimeService = {
    getPlayer(playerId: string): SmokePlayer | null {
      return playerId === player.playerId ? player : null;
    },
    captureOfflineGainBeforeTick(): void {},
    markPersistenceDirtyDomains(activePlayer: SmokePlayer, domains: string[]): void {
      for (const domain of domains) activePlayer.dirtyDomains.add(domain);
    },
    bumpPersistentRevision(activePlayer: SmokePlayer): void {
      activePlayer.persistentRevision += 1;
    },
  };
  runtime.crops = new Map();
  runtime.hatches = new Map();
  runtime.activeBeasts = new Map();
  runtime.dirtyHatches = new Set();
  runtime.dirtyBeasts = new Set();
  runtime.dirtyCrops = new Set();
  runtime.kickScheduler = (): void => {};
  runtime.persistence = {
    isEnabled(): boolean { return true; },
    async flushProgress(): Promise<void> {},
    async releasePlayerWorkOrder(input: { ownerPlayerId: string; orderId: string }): Promise<SpiritWorkOrderRow | null> {
      probe.releases.push(input.orderId);
      return runtime.workOrders.get(input.orderId) ?? null;
    },
    async completeWorkOrder(input: { orderId: string }) {
      const current = runtime.workOrders.get(input.orderId);
      if (!current) throw new Error(`missing order ${input.orderId}`);
      const repeat = current.payload.repeat === true || current.payload.manualRepeat === true;
      const next = {
        ...current,
        status: repeat ? 'waiting' as const : 'completed' as const,
        remainingTicks: repeat ? current.totalTicks : 0,
        workerKind: null,
        workerId: null,
        jobRunId: null,
        revision: current.revision + 1,
      };
      return { settled: true, order: next, beast: null, crop: null };
    },
    async reservePlayerWorkOrder(input: { orderId: string; ownerPlayerId: string; expectedRevision: number }): Promise<SpiritWorkOrderRow | null> {
      const current = runtime.workOrders.get(input.orderId);
      if (!current || current.ownerPlayerId !== input.ownerPlayerId || current.revision !== input.expectedRevision
        || !['queued', 'waiting'].includes(current.status)) return null;
      const reserved = { ...current, status: 'running' as const, workerKind: 'player' as const,
        workerId: input.ownerPlayerId, jobRunId: input.orderId, revision: current.revision + 1 };
      runtime.workOrders.set(input.orderId, reserved);
      return reserved;
    },
  };
  return runtime;
}

function createContext(runtime: RuntimeHarness, probe: Probe): PipelineContext {
  const deps = {
    facilityWorkPort: {
      getFacilityAssignment(playerId: string, orderId: string, skill: string) {
        probe.reservationReads.push({ playerId, orderId, skill });
        return runtime.getFacilityAssignment(playerId, orderId, skill);
      },
      isFacilityCurrent(playerId: string, orderId: string) {
        return runtime.isFacilityCurrent(playerId, orderId);
      },
      completeFacilityWork(playerId: string, orderId: string) {
        probe.completions.push(orderId);
        runtime.completeFacilityWork(playerId, orderId);
      },
      releaseFacilityWork(playerId: string, orderId: string) {
        runtime.releaseFacilityWork(playerId, orderId);
      },
    },
    getInstanceRuntime(): unknown {
      probe.tileReads += 1;
      return {
        getTileCombatState(): never { throw new Error('facility mining must not read tile combat state'); },
        damageTile(): never {
          probe.tileAttacks += 1;
          throw new Error('facility mining must not attack a map tile');
        },
      };
    },
    getPlayerLocation() {
      return { instanceId: 'instance:sect-smoke', x: 5, y: 5 };
    },
    hasPendingCommand(): boolean { return false; },
    enqueuePendingCommand(): void { probe.tileAttacks += 1; },
    playerRuntimeService: runtime.playerRuntimeService,
  };
  const { facilityWorkPort, ...worldDeps } = deps;
  return {
    facilityWorkPort,
    contentTemplateRepository: {
      getItemName(itemId: string): string { return itemId; },
      normalizeItem(item: { itemId: string; count: number }): unknown { return item; },
    },
    resolveExpToNextByLevel(): number { return 10_000; },
    getInstanceRuntime(): unknown {
      probe.tileReads += 1;
      throw new Error('facility mining must not resolve a map instance');
    },
    deps: worldDeps,
  };
}

function createProbe(): Probe {
  return { tileReads: 0, tileAttacks: 0, reservationReads: [], releases: [], completions: [] };
}

async function testMiningLifecycle(): Promise<void> {
  const probe = createProbe();
  const player = createPlayer();
  const order = createOrder('order:mining:lifecycle', 'mining', 'building:iron-mine');
  const runtime = createRuntimeHarness(player, [order], probe);
  const pipeline = createPipeline();
  const ctx = createContext(runtime, probe);

  const started = pipeline.startLifecycle(player, 'mining', { facilityOrderId: order.orderId }, ctx);
  assert.equal(started.ok, true);
  assert.equal(started.started, true);
  assert.equal(player.miningJob?.facilityOrderId, order.orderId);
  assert.equal(player.miningJob?.stationInstanceId, order.instanceId);
  assert.equal(player.miningJob?.stationBuildingId, order.buildingId);
  assert.equal(player.miningJob?.stationSuccessBonus, 0.1);
  assert.deepEqual(probe.reservationReads, [{ playerId: player.playerId, orderId: order.orderId, skill: 'mining' }]);

  const interrupted = pipeline.interrupt(player, 'mining', 'attack', ctx);
  assert.equal(interrupted.ok, true);
  assert.equal(player.miningJob?.phase, 'paused');
  const remainingBeforeWait = player.miningJob?.remainingTicks;
  for (let tick = 0; tick < 10; tick += 1) pipeline.tickLifecycle(player, 'mining', ctx);
  assert.equal(player.miningJob?.remainingTicks, remainingBeforeWait);
  assert.equal(player.miningJob?.phase, 'working');

  pipeline.tickLifecycle(player, 'mining', ctx);
  assert.equal(player.miningJob?.remainingTicks, Number(remainingBeforeWait) - 1);
  assert.equal(probe.tileReads, 0);
  assert.equal(probe.tileAttacks, 0);

  const cancelled = pipeline.cancelLifecycle(player, 'mining', ctx);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.cancelled, true);
  assert.equal(player.miningJob, null);
  assert.equal(order.status, 'waiting');
  assert.equal(order.workerKind, null);
  assert.equal(order.workerId, null);
  await Promise.resolve();
  assert.deepEqual(probe.releases, [order.orderId]);
}

async function testInvalidFacilityReleasesReservation(): Promise<void> {
  const probe = createProbe();
  const player = createPlayer();
  const order = createOrder('order:mining:invalid', 'mining', 'building:iron-mine');
  const runtime = createRuntimeHarness(player, [order], probe);
  const pipeline = createPipeline();
  const ctx = createContext(runtime, probe);
  assert.equal(pipeline.startLifecycle(player, 'mining', { facilityOrderId: order.orderId }, ctx).ok, true);

  player.x = 99;
  const stopped = pipeline.tickLifecycle(player, 'mining', ctx);
  assert.equal((stopped as { ok: boolean }).ok, true);
  assert.equal(player.miningJob, null);
  assert.equal(order.status, 'waiting');
  assert.equal(order.workerKind, null);
  await Promise.resolve();
  assert.deepEqual(probe.releases, [order.orderId]);

  const removedProbe = createProbe();
  const removedPlayer = createPlayer();
  const removedOrder = createOrder('order:forging:removed', 'forging', 'building:forging');
  const removedRuntime = createRuntimeHarness(removedPlayer, [removedOrder], removedProbe);
  const removedPipeline = createPipeline();
  const removedContext = createContext(removedRuntime, removedProbe);
  assert.equal(removedPipeline.startLifecycle(removedPlayer, 'forging', { facilityOrderId: removedOrder.orderId }, removedContext).ok, true);
  removedRuntime.workOrders.delete(removedOrder.orderId);
  removedPipeline.tickLifecycle(removedPlayer, 'forging', removedContext);
  assert.equal(removedPlayer.forgingJob, null);
  assert.equal(removedProbe.completions.length, 0);
}

async function testManufacturingStrategiesUseSamePipeline(): Promise<void> {
  for (const kind of ['forging', 'alchemy', 'enhancement'] as const) {
    const probe = createProbe();
    const player = createPlayer();
    const order = createOrder(`order:${kind}:complete`, kind, `building:${kind}`, { totalTicks: 1, remainingTicks: 1 });
    const runtime = createRuntimeHarness(player, [order], probe);
    const pipeline = createPipeline();
    const ctx = createContext(runtime, probe);
    const inventoryBefore = [...player.inventory.items];
    const started = pipeline.startLifecycle(player, kind, { facilityOrderId: order.orderId }, ctx);
    assert.equal(started.ok, true, `${kind} should start from its reserved facility order`);
    assert.equal(started.started, true);
    const ticked = pipeline.tickLifecycle(player, kind, ctx) as { inventoryChanged?: boolean; equipmentChanged?: boolean };
    assert.equal(ticked.inventoryChanged, false);
    assert.equal(ticked.equipmentChanged, false);
    assert.deepEqual(player.inventory.items, inventoryBefore, `${kind} pipeline must leave external assets to the authority port`);
    assert.deepEqual(probe.completions, [order.orderId]);
    assert.equal(order.remainingTicks, 0);
    assert.equal(runtime.completedOrderIds.has(order.orderId), true);
    const slot = `${kind}Job` as 'forgingJob' | 'alchemyJob' | 'enhancementJob';
    assert.equal(player[slot], null);
    assert.deepEqual(probe.reservationReads, [{ playerId: player.playerId, orderId: order.orderId, skill: kind }]);
    await Promise.resolve();
    await Promise.resolve();
  }
}

function attachCraftPanel(runtime: RuntimeHarness, pipeline: TechniqueActivityPipelineService): void {
  const craft = Object.create(CraftPanelRuntimeService.prototype) as CraftPanelRuntimeService & Record<string, unknown>;
  craft.pipeline = pipeline;
  craft.facilityWorkPort = runtime;
  craft.contentTemplateRepository = {
    getItemName(itemId: string): string { return itemId; },
    normalizeItem(item: unknown): unknown { return item; },
  };
  craft.playerRuntimeService = runtime.playerRuntimeService;
  craft.recordTechniqueActivityStatisticMutation = (): void => {};
  runtime.craftPanelRuntimeService = craft;
}

async function testMiningCompletionSettlesAndContinues(): Promise<void> {
  const probe = createProbe();
  const player = createPlayer();
  const order = createOrder('order:mining:repeat', 'mining', 'building:iron-mine', {
    totalTicks: 1,
    remainingTicks: 1,
    payload: { x: 5, y: 5, manualPlayerId: player.playerId, manualRepeat: true },
  });
  const runtime = createRuntimeHarness(player, [order], probe);
  const pipeline = createPipeline();
  attachCraftPanel(runtime, pipeline);
  const ctx = createContext(runtime, probe);
  assert.equal(pipeline.startLifecycle(player, 'mining', { facilityOrderId: order.orderId }, ctx).ok, true);
  pipeline.tickLifecycle(player, 'mining', ctx);
  assert.deepEqual(probe.completions, [order.orderId]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (runtime.workOrders.get(order.orderId)?.status === 'running' && player.miningJob) break;
    await Promise.resolve();
  }
  const continued = runtime.workOrders.get(order.orderId);
  assert.equal(continued?.status, 'running');
  assert.equal(continued?.payload.manualRepeat, true);
  assert.equal(continued?.workerKind, 'player');
  assert.ok(player.miningJob);
  assert.equal(player.miningJob?.facilityOrderId, order.orderId);
}

async function testCompletionDelegatesExternalAssetsToAuthority(): Promise<void> {
  for (const action of ['craft', 'enhance'] as const) {
    const probe = createProbe();
    const player = createPlayer();
    const order = createOrder(`order:settlement:${action}`, action === 'enhance' ? 'enhancement' : 'forging',
      action === 'enhance' ? 'building:enhancement' : 'building:forging', {
        action,
        remainingTicks: 0,
        payload: action === 'enhance'
          ? { x: 5, y: 5, targetStorageId: 'storage:equipment', targetItemId: 'equipment:test', itemLevel: 10,
            currentLevel: 0, desiredTargetLevel: 1, maxAttempts: 1, attempts: 0, maxSpiritStones: 100,
            spentSpiritStones: 0, materialSchedule: { 1: [{ itemId: 'mat:enhance', count: 2 }] },
            spiritStoneSchedule: { 1: 10 }, materials: [{ itemId: 'mat:enhance', count: 2 }] }
          : { x: 5, y: 5, materials: [{ itemId: 'mat:ore', count: 3 }], outputItemId: 'equipment:blade', outputCount: 1 },
      });
    const runtime = createRuntimeHarness(player, [order], probe);
    const settlements: Array<Record<string, unknown>> = [];
    (runtime as unknown as Record<string, unknown>).flushDirtyProgress = async (): Promise<void> => {};
    (runtime as unknown as Record<string, unknown>).activeBeasts = new Map();
    (runtime as unknown as Record<string, unknown>).crops = new Map();
    (runtime as unknown as Record<string, unknown>).kickScheduler = (): void => {};
    runtime.persistence = {
      isEnabled(): boolean { return true; },
      async completeWorkOrder(input: Record<string, unknown>) {
        settlements.push(input);
        return { order: { ...order, status: 'completed' as const }, beast: null, crop: null, settled: true };
      },
    };

    await (runtime as unknown as { settleCompletedOrder(activeOrder: SpiritWorkOrderRow): Promise<void> })
      .settleCompletedOrder(order);
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]?.orderId, order.orderId);
    assert.deepEqual(settlements[0]?.inputRequirements, order.payload.materials);
    if (action === 'craft') {
      assert.equal(settlements[0]?.outputItemId, 'equipment:blade');
      assert.equal(settlements[0]?.outputCount, 1);
      assert.deepEqual(settlements[0]?.outputRawPayload, { itemId: 'equipment:blade', count: 1, type: 'equipment', name: '測試產物', level: 10 });
      assert.equal('enhancementSuccessRate' in settlements[0], false);
    } else {
      assert.equal(settlements[0]?.outputItemId, undefined);
      assert.equal(typeof settlements[0]?.enhancementSuccessRate, 'number');
      assert.equal(Number(settlements[0]?.enhancementSuccessRate) > 0, true);
      assert.equal(Number(settlements[0]?.enhancementSuccessRate) <= 1, true);
    }
    assert.equal(runtime.workOrders.has(order.orderId), false);
  }
}

async function testManualWorkRejectsSecondActiveStation(): Promise<void> {
  const probe = createProbe();
  const player = createPlayer();
  const mining = createOrder('order:manual:mining', 'mining', 'building:iron-mine', { status: 'queued', workerKind: null, workerId: null });
  const forging = createOrder('order:manual:forging', 'forging', 'building:forging', { status: 'queued', workerKind: null, workerId: null });
  const runtime = createRuntimeHarness(player, [mining, forging], probe);
  const pipeline = createPipeline();
  const craft = Object.create(CraftPanelRuntimeService.prototype) as CraftPanelRuntimeService & Record<string, unknown>;
  craft.pipeline = pipeline;
  craft.facilityWorkPort = runtime;
  (craft as Record<string, unknown>).contentTemplateRepository = {
    getItemName(itemId: string): string { return itemId; },
    normalizeItem(item: unknown): unknown { return item; },
  };
  (craft as Record<string, unknown>).playerRuntimeService = runtime.playerRuntimeService;
  (craft as Record<string, unknown>).recordTechniqueActivityStatisticMutation = (): void => {};
  runtime.craftPanelRuntimeService = craft;
  let reserveCalls = 0;
  runtime.persistence = {
    isEnabled(): boolean { return true; },
    async reservePlayerWorkOrder(input: { orderId: string; ownerPlayerId: string; expectedRevision: number }): Promise<SpiritWorkOrderRow | null> {
      reserveCalls += 1;
      const current = runtime.workOrders.get(input.orderId);
      if (!current || current.ownerPlayerId !== input.ownerPlayerId || current.revision !== input.expectedRevision
        || !['queued', 'waiting'].includes(current.status)) return null;
      const reserved = { ...current, status: 'running' as const, workerKind: 'player' as const,
        workerId: input.ownerPlayerId, jobRunId: input.orderId, revision: current.revision + 1 };
      runtime.workOrders.set(input.orderId, reserved);
      return reserved;
    },
    async releasePlayerWorkOrder(): Promise<null> { return null; },
  };
  const context = {
    sectId: 'sect:facility-pipeline-smoke',
    sectInstanceId: 'instance:sect-smoke',
    canManage: true,
    buildings: [
      { id: 'building:iron-mine', defId: 'sect_iron_mine', x: 5, y: 5, state: 'active', revision: 1 },
      { id: 'building:forging', defId: 'sect_forging_station', x: 5, y: 5, state: 'active', revision: 1 },
    ],
  };
  const first = await runtime.executeCommand(player.playerId, {
    action: 'manual_work', requestId: 'request:manual:mining', buildingId: mining.buildingId, workAction: 'mine', expectedRevision: 1,
  }, context);
  assert.equal(first.ok, true);
  assert.ok(player.miningJob);
  assert.equal(reserveCalls, 1);

  const second = await runtime.executeCommand(player.playerId, {
    action: 'manual_work', requestId: 'request:manual:forging', buildingId: forging.buildingId, expectedRevision: 1,
  }, context);
  assert.equal(second.ok, false);
  assert.equal(second.reasonKey, 'spirit_beast.worker_busy');
  assert.equal(reserveCalls, 1, 'busy guard must run before DB reservation');
  assert.equal(runtime.workOrders.get(forging.orderId)?.status, 'queued');
  assert.equal(player.forgingJob ?? null, null);
}

async function main(): Promise<void> {
  await testMiningLifecycle();
  await testInvalidFacilityReleasesReservation();
  await testManufacturingStrategiesUseSamePipeline();
  await testCompletionDelegatesExternalAssetsToAuthority();
  await testManualWorkRejectsSecondActiveStation();
  await testMiningCompletionSettlesAndContinues();
  console.log(JSON.stringify({
    ok: true,
    answers: [
      '人工礦場以 reservation 建立標準 mining job，start/tick/interrupt/cancel 均經共用 pipeline。',
      '工位挖礦不讀地圖 tile、不建立強攻命令，中斷等待不扣實際工時。',
      '玩家離位或工單／工位消失會停止 job 並釋放 player reservation。',
      '煉器、煉丹與強化工位以同一 pipeline 讀 reservation，完成只呼叫服務端權威 port，不在 strategy 內改外部資產。',
      '製作輸出、材料扣除與強化成功率均由服務端 persistence 完成，strategy 不自行複製公式或改裝備。',
      '玩家已有工位 job 時，第二個人工工位在 DB reservation 前即以正式 busy key 拒絕。',
      '親自採礦完成後立即結算產物，並在玩家仍在工位時自動續採。',
    ],
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
