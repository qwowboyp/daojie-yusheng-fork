/** 真 PostgreSQL：工位材料、批量裝備、種子、收成及經驗的原子結算與重放。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SpiritBeastSkill } from '@mud/shared';
import { resolveServerDatabaseUrl } from '../config/env-alias';
import { DatabasePoolProvider } from '../persistence/database-pool.provider';
import { PlayerDomainPersistenceService } from '../persistence/player-domain-persistence.service';
import { SpiritBeastPersistenceService, type SpiritWorkOrderRow } from '../persistence/spirit-beast-persistence.service';

async function main(): Promise<void> {
  assert.ok(resolveServerDatabaseUrl(), '此案例需要獨立測試資料庫');
  const owner = `smoke_spirit_production_${randomUUID()}`;
  const instanceId = `${owner}:instance`;
  const provider = new DatabasePoolProvider();
  const domain = new PlayerDomainPersistenceService(null, provider, null);
  const service = new SpiritBeastPersistenceService(provider);
  const pool = provider.getPool('spirit-beast')!;
  const common = { ownerPlayerId: owner, sectId: `${owner}:sect`, instanceId };
  type Completion = Parameters<SpiritBeastPersistenceService['completeWorkOrder']>[0];
  async function stock(buildingId: string, itemId: string, count: number, raw: Record<string, unknown> = {}): Promise<string> {
    const storageId = randomUUID();
    await pool.query(`INSERT INTO spirit_beast_facility_storage
      (storage_id,owner_player_id,instance_id,building_id,item_id,count,source_order_id,raw_payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [storageId, owner, instanceId, buildingId, itemId, count,
      randomUUID(), JSON.stringify({ itemId, count, type: 'material', ...raw })]);
    return storageId;
  }
  async function ready(skill: SpiritBeastSkill, action: string, buildingId: string, payload: Record<string, unknown>): Promise<SpiritWorkOrderRow> {
    const created = await service.createWorkOrder({ ...common, operationId: randomUUID(), orderId: randomUUID(),
      buildingId, skill, action, payload, priority: 1, totalTicks: 10 });
    const reserved = await service.reservePlayerWorkOrder({ orderId: created.result.orderId, ownerPlayerId: owner,
      expectedRevision: created.result.revision });
    assert.ok(reserved);
    const completed = { ...reserved, remainingTicks: 0, revision: reserved.revision + 1 };
    await service.flushProgress({ hatches: [], beasts: [], crops: [], workOrders: [completed] });
    return completed;
  }
  const complete = (order: SpiritWorkOrderRow, values: Omit<Completion, 'orderId' | 'expectedRevision'> = {}) =>
    service.completeWorkOrder({ orderId: order.orderId, expectedRevision: order.revision, ...values });
  const storage = () => service.listFacilityStorage(owner, instanceId);
  try {
    await domain.onModuleInit();
    await service.onModuleInit();
    const forge = `${owner}:forge`;
    await stock(forge, 'black_iron_chunk', 6);
    const forgeOrder = await ready('forging', 'craft', forge, { quantity: 2 });
    const forgeValues = { inputRequirements: [{ itemId: 'black_iron_chunk', count: 6 }],
      outputItemId: 'smoke_equipment', outputCount: 2, craftAttempts: 2, craftSuccessRate: 1,
      outputCountPerSuccess: 1, outputRawPayload: { itemId: 'smoke_equipment', type: 'equipment', name: '試驗劍', level: 1 } };
    assert.equal((await complete(forgeOrder, forgeValues)).settled, true);
    assert.equal((await complete(forgeOrder, forgeValues)).settled, false);
    const forged = (await storage()).find((entry) => entry.itemId === 'smoke_equipment')!;
    assert.equal(forged.count, 2);
    assert.equal((await storage()).some((entry) => entry.itemId === 'black_iron_chunk'), false);
    const withdraw = { ...common, operationId: randomUUID(), buildingId: forge,
      entries: [{ itemKey: forged.storageId, count: 2 }], inventoryCapacity: 40 };
    const withdrawalResults = await Promise.all([service.withdrawInventory(withdraw), service.withdrawInventory(withdraw)]);
    assert.deepEqual(withdrawalResults.map((result) => result.replayed).sort(), [false, true]);
    const equipment = await pool.query(`SELECT item_instance_id,count,raw_payload FROM player_inventory_item WHERE player_id=$1`, [owner]);
    assert.equal(equipment.rowCount, 2, '兩件非堆疊裝備必須形成兩個獨立 instance');
    assert.equal(new Set(equipment.rows.map((row) => row.item_instance_id)).size, 2);
    assert.ok(equipment.rows.every((row) => Number(row.count) === 1 && Number(row.raw_payload.count) === 1));

    const enhance = `${owner}:enhance`;
    const deposited = await service.depositInventory({ ...common, operationId: randomUUID(), buildingId: enhance,
      entries: [{ itemKey: equipment.rows[0].item_instance_id, count: 1 }] });
    const targetKey = deposited.result[0].itemKey;
    await stock(enhance, 'black_iron_chunk', 1);
    await stock(enhance, 'spirit_stone', 5);
    const enhanceOrder = await ready('enhancement', 'enhance', enhance, { targetStorageId: targetKey,
      targetItemId: 'smoke_equipment', itemLevel: 1, currentLevel: 0, desiredTargetLevel: 1, maxAttempts: 1,
      maxSpiritStones: 5, spentSpiritStones: 0, materialSchedule: { 1: [{ itemId: 'black_iron_chunk', count: 1 }] },
      spiritStoneSchedule: { 1: 5 } });
    await complete(enhanceOrder, { enhancementSuccessRate: 1 });
    assert.equal((await complete(enhanceOrder, { enhancementSuccessRate: 0 })).settled, false);
    const enhanced = await service.getFacilityStorageItem(owner, instanceId, enhance, targetKey);
    assert.equal(enhanced?.rawPayload.enhanceLevel, 1);
    assert.equal((await storage()).filter((entry) => entry.buildingId === enhance).length, 1, '強化材料與靈石只扣一次');

    const field = `${owner}:field`;
    const crop = (await service.createCropPlan({ ...common, operationId: randomUUID(), cropId: randomUUID(),
      buildingId: field, seedItemId: 'seed.returnspring_leaf', outputItemId: 'mat.returnspring_leaf',
      growthTicks: 3600, repeatEnabled: false })).result;
    assert.equal(crop.status, 'planned', '沒有種子也能儲存種植計畫');
    const sow = await ready('planting', 'sow', field, { cropId: crop.cropId });
    const sowValues = { inputRequirements: [{ itemId: 'seed.returnspring_leaf', count: 1 }] };
    await assert.rejects(complete(sow, sowValues), /SPIRIT_WORK_ORDER_INPUT_SHORTAGE/);
    await stock(field, 'seed.returnspring_leaf', 1);
    const growing = (await complete(sow, sowValues)).crop!;
    assert.equal(growing.status, 'growing');
    assert.equal(growing.growthTotalTicks, 3600);
    assert.equal((await storage()).some((entry) => entry.itemId === 'seed.returnspring_leaf'), false);
    for (let water = 0; water < 2; water += 1) {
      const order = await ready('planting', 'water', field, { cropId: crop.cropId });
      const watered = (await complete(order)).crop!;
      assert.equal(watered.wateringMask, water + 1);
      Object.assign(growing, watered);
    }
    await service.flushProgress({ hatches: [], beasts: [], workOrders: [],
      crops: [{ ...growing, status: 'mature', growthRemainingTicks: 0, revision: growing.revision + 1 }] });
    const harvest = await ready('planting', 'harvest', field, { cropId: crop.cropId });
    const harvestValues: Omit<Completion, 'orderId' | 'expectedRevision'> = { outputItemId: 'mat.returnspring_leaf', outputCount: 30,
      outputRawPayload: { itemId: 'mat.returnspring_leaf', type: 'material', name: '回春葉' },
      professionReward: { professionType: 'planting', playerRealmLevel: 1, skillLevel: 1, targetLevel: 1,
        baseActionTicks: 10, fallbackExp: 0, expToNextByLevel: { 1: 100, 2: 100 } } };
    const harvested = await complete(harvest, harvestValues);
    assert.equal(harvested.crop?.status, 'harvested');
    assert.ok(harvested.professionState);
    const replay = await complete(harvest, harvestValues);
    assert.equal(replay.settled, false);
    assert.deepEqual(replay.professionState, harvested.professionState, '重放不能重發經驗');
    assert.equal((await storage()).find((entry) => entry.itemId === 'mat.returnspring_leaf')?.count, 30);
    const herbsInBag = await pool.query(`SELECT count FROM player_inventory_item WHERE player_id=$1 AND item_id='mat.returnspring_leaf'`, [owner]);
    assert.equal(herbsInBag.rowCount, 0, '收成先留在靈田，不能自動塞入背包');
    console.log(JSON.stringify({ ok: true, case: 'spirit-beast-production-assets', batchEquipment: 2,
      enhancement: 1, harvest: 30, seedShortageRollback: true, replayNoExtraReward: true }));
  } finally {
    for (const table of ['spirit_beast_facility_storage', 'spirit_beast_work_order', 'spirit_beast_crop']) {
      await pool.query(`DELETE FROM ${table} WHERE owner_player_id=$1`, [owner]);
    }
    for (const table of ['spirit_beast_operation', 'player_inventory_item', 'player_profession_state']) {
      await pool.query(`DELETE FROM ${table} WHERE player_id=$1`, [owner]);
    }
    await domain.onModuleDestroy();
    service.onModuleDestroy();
    await provider.onModuleDestroy();
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
