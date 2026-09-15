// @ts-nocheck
/** 用途：以真 PostgreSQL 驗證靈蛋冪等、十顆原子扣除、孵化恢復與收養。 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { SPIRIT_BEAST_CATALOG } from '@mud/shared';
import { resolveServerDatabasePoolerUrl, resolveServerDatabaseUrl } from '../config/env-alias';
import { DatabasePoolProvider } from '../persistence/database-pool.provider';
import { PlayerDomainPersistenceService } from '../persistence/player-domain-persistence.service';
import { SpiritBeastPersistenceService } from '../persistence/spirit-beast-persistence.service';
import { SpiritBeastRuntimeService } from '../runtime/spirit-beast/spirit-beast-runtime.service';

async function main(): Promise<void> {
  if (!(resolveServerDatabasePoolerUrl() || resolveServerDatabaseUrl()).trim()) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'no_db_spirit_beast_persistence' }, null, 2));
    return;
  }
  const suffix = randomUUID();
  const playerId = `smoke_player_spirit_beast_${suffix}`;
  const runtimePlayerId = `smoke_player_spirit_beast_runtime_${suffix}`;
  const sourcePrefix = `smoke:spirit-beast:${suffix}`;
  const provider = new DatabasePoolProvider();
  const playerDomain = new PlayerDomainPersistenceService(null, provider, null);
  const service = new SpiritBeastPersistenceService(provider);
  const pool = provider.getPool('spirit-beast');
  let runtime: SpiritBeastRuntimeService | null = null;
  try {
    await playerDomain.onModuleInit();
    assert.equal(playerDomain.isEnabled(), true, '必須以正式 PlayerDomain schema 初始化資產表');
    await service.onModuleInit();
    const awards = [];
    for (let index = 0; index < 11; index += 1) {
      awards.push(await service.awardEgg({ sourceRef: `${sourcePrefix}:egg:${index}`, ownerPlayerId: playerId, element: 'metal', star: 1 }));
    }
    const duplicate = await service.awardEgg({ sourceRef: `${sourcePrefix}:egg:0`, ownerPlayerId: playerId, element: 'metal', star: 1 });
    assert.equal(duplicate.awarded, false);
    const operationId = `${sourcePrefix}:enhance`;
    const request = { operationId, ownerPlayerId: playerId, targetEggId: awards[0].egg.eggId,
      materialEggIds: awards.slice(1).map((entry) => entry.egg.eggId), expectedTargetRevision: 1, success: false };
    const first = await service.enhanceEgg(request);
    const replay = await service.enhanceEgg({ ...request, materialEggIds: [...request.materialEggIds].reverse(), success: true });
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal((await service.listPlayerEggs(playerId)).length, 1, '失敗仍必須原子扣除十顆素材且保留主蛋');

    const species = SPIRIT_BEAST_CATALOG.find((entry) => entry.element === 'metal');
    assert.ok(species);
    const started = await service.startHatch({ operationId: `${sourcePrefix}:hatch`, ownerPlayerId: playerId,
      eggId: first.result.target.eggId, expectedEggRevision: first.result.target.revision,
      buildingInstanceId: `smoke:instance:${suffix}`, buildingId: `smoke:incubator:${suffix}`,
      incubatorElement: 'metal', resultSpeciesId: species.id, resultGrade: species.grade,
      resultCombatPower: species.baseCombatPowerMin, totalTicks: 1 });
    const alternateSpecies = SPIRIT_BEAST_CATALOG.find((entry) => entry.id !== species.id && entry.element === 'metal')!;
    const hatchReplay = await service.startHatch({ operationId: `${sourcePrefix}:hatch`, ownerPlayerId: playerId,
      eggId: first.result.target.eggId, expectedEggRevision: first.result.target.revision,
      buildingInstanceId: `smoke:instance:${suffix}`, buildingId: `smoke:incubator:${suffix}`,
      incubatorElement: 'metal', resultSpeciesId: alternateSpecies.id, resultGrade: alternateSpecies.grade,
      resultCombatPower: alternateSpecies.baseCombatPowerMax, totalTicks: 1 });
    assert.equal(hatchReplay.replayed, true);
    assert.equal(hatchReplay.result.resultSpeciesId, species.id, '同孵化命令重放不得重抽物種或戰力');
    const ready = { ...started.result, remainingTicks: 0, status: 'ready', revision: started.result.revision + 1 };
    await service.flushProgress({ hatches: [ready], beasts: [], workOrders: [], crops: [] });
    const adopted = await service.adoptHatch({ operationId: `${sourcePrefix}:adopt`, ownerPlayerId: playerId,
      hatchId: ready.hatchId, expectedRevision: ready.revision, element: species.element,
      skillLevels: Object.fromEntries(species.masteries.map((entry) => [entry.skill, entry.level])) });
    assert.equal(adopted.result.speciesId, species.id);
    await service.flushProgress({ hatches: [{ ...ready, revision: ready.revision + 100 }], beasts: [], workOrders: [], crops: [] });
    const adoptedHatch = (await service.listPlayerHatches(playerId)).find((entry) => entry.hatchId === ready.hatchId);
    assert.equal(adoptedHatch?.status, 'adopted', '晚到孵化 flush 不得覆寫已收養終態');

    const summoned = await service.summonBeast({ operationId: `${sourcePrefix}:summon`, ownerPlayerId: playerId,
      beastId: adopted.result.beastId, expectedRevision: adopted.result.revision, sectId: `smoke:sect:${suffix}`,
      instanceId: `smoke:instance:${suffix}`, x: 1, y: 1, facing: 'down', ownerLimit: 5, sectLimit: 20 });
    await service.recallBeast({ operationId: `${sourcePrefix}:recall`, ownerPlayerId: playerId, beastId: adopted.result.beastId });
    await service.flushProgress({ hatches: [], beasts: [{ ...summoned.result, state: 'working', revision: summoned.result.revision + 100 }],
      workOrders: [], crops: [] });
    assert.equal((await service.listPlayerBeasts(playerId))[0]?.state, 'warehouse', '晚到 active beast flush 不得復活已回收靈獸');

    const orderCreated = await service.createWorkOrder({ operationId: `${sourcePrefix}:order-create`,
      orderId: randomUUID(), ownerPlayerId: playerId, sectId: `smoke:sect:${suffix}`, instanceId: `smoke:instance:${suffix}`,
      buildingId: `smoke:mine:${suffix}`, skill: 'mining', action: 'mine_iron', payload: {}, priority: 1, totalTicks: 5 });
    const reservedOrder = await service.reservePlayerWorkOrder({ orderId: orderCreated.result.orderId, ownerPlayerId: playerId,
      expectedRevision: orderCreated.result.revision });
    assert.ok(reservedOrder);
    await service.cancelWorkOrder({ operationId: `${sourcePrefix}:order-cancel`, ownerPlayerId: playerId, orderId: reservedOrder.orderId });
    await service.flushProgress({ hatches: [], beasts: [], workOrders: [{ ...reservedOrder, revision: reservedOrder.revision + 100 }], crops: [] });
    const cancelledOrder = await pool.query(`SELECT status FROM spirit_beast_work_order WHERE order_id=$1`, [reservedOrder.orderId]);
    assert.equal(cancelledOrder.rows[0]?.status, 'cancelled', '晚到工單 flush 不得覆寫取消終態');

    const slotZeroId = randomUUID();
    await pool.query(`INSERT INTO player_inventory_item(item_instance_id,player_id,slot_index,item_id,count,raw_payload,updated_at)
      VALUES ($1,$2,0,'black_iron_chunk',1,$3::jsonb,now())`, [slotZeroId, playerId,
      JSON.stringify({ itemInstanceId: slotZeroId, itemId: 'black_iron_chunk', type: 'material', count: 1 })]);
    const storageId = randomUUID();
    await pool.query(`INSERT INTO spirit_beast_facility_storage
      (storage_id,owner_player_id,instance_id,building_id,item_id,count,source_order_id,raw_payload)
      VALUES ($1,$2,$3,$4,'spirit_stone',1,$5,$6::jsonb)`, [storageId, playerId, `smoke:instance:${suffix}`,
      `smoke:storage:${suffix}`, randomUUID(), JSON.stringify({ itemId: 'spirit_stone', type: 'material', count: 1 })]);
    await service.withdrawInventory({ operationId: `${sourcePrefix}:withdraw-slot`, ownerPlayerId: playerId,
      instanceId: `smoke:instance:${suffix}`, buildingId: `smoke:storage:${suffix}`,
      entries: [{ itemKey: storageId, count: 1 }], inventoryCapacity: 10 });
    const slots = await pool.query(`SELECT slot_index FROM player_inventory_item WHERE player_id=$1 ORDER BY slot_index`, [playerId]);
    assert.deepEqual(slots.rows.map((row) => Number(row.slot_index)), [0, 1], 'slot0 已佔用時領取必須寫入 slot1');

    const cultivateIds: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      const beastId = randomUUID(); cultivateIds.push(beastId);
      await pool.query(`INSERT INTO spirit_beast_instance
        (beast_id,owner_player_id,species_id,grade,element,star,base_combat_power,skill_levels,state,revision)
        VALUES ($1,$2,$3,$4,$5,1,$6,$7::jsonb,'warehouse',1)`, [beastId, playerId, species.id, species.grade,
        species.element, species.baseCombatPowerMin, JSON.stringify({ mining: 1 })]);
    }
    const cultivationRequest = { operationId: `${sourcePrefix}:cultivate`, ownerPlayerId: playerId,
      targetBeastId: cultivateIds[0], materialBeastIds: cultivateIds.slice(1), expectedTargetRevision: 1, success: false };
    const cultivated = await service.cultivateBeast(cultivationRequest);
    const cultivationReplay = await service.cultivateBeast({ ...cultivationRequest,
      materialBeastIds: [...cultivationRequest.materialBeastIds].reverse(), success: true });
    assert.equal(cultivationReplay.replayed, true);
    assert.equal(cultivated.result.success, false);
    assert.equal(cultivationReplay.result.success, false, '同培養命令重放不得重擲成功率');
    assert.equal((await service.listPlayerEggs(playerId)).length, 0);
    assert.deepEqual(new Set((await service.listPlayerBeasts(playerId)).map((entry) => entry.beastId)),
      new Set([adopted.result.beastId, cultivateIds[0]]), '收養獸與培養失敗保留的主獸都必須存在，十隻素材必須消耗');
    const runtimeInstanceId = `smoke:runtime-instance:${suffix}`;
    const incubatorId = `smoke:runtime-incubator:${suffix}`;
    const enhancementId = `smoke:runtime-egg-enhancement:${suffix}`;
    const playerView = { playerId: runtimePlayerId, inventory: { capacity: 40, items: [] },
      plantingSkill: { level: 1, exp: 0, expToNext: 100 } };
    const playerRuntime = { getPlayer: (id: string) => id === runtimePlayerId ? playerView : null,
      replaceInventoryItems: (_id: string, items: unknown[]) => { playerView.inventory.items = items; },
      markPlayerPersistentDirty: () => undefined };
    const flush = { flushPlayerDomains: async () => undefined };
    const content = { getItemName: (itemId: string) => itemId,
      createItem: (itemId: string, count: number) => ({ itemId, count, type: 'material' }) };
    const craft = { forgingCatalog: [], alchemyCatalog: [], plantingWorkPort: null,
      facilityWorkPort: null, stationSuccessBonusResolver: null };
    runtime = new SpiritBeastRuntimeService(service, playerRuntime as never, flush as never, content as never, craft as never);
    runtime.onModuleInit();
    const runtimeContext = { sectId: `smoke:runtime-sect:${suffix}`, sectInstanceId: runtimeInstanceId, canManage: true,
      buildings: [
        { id: incubatorId, defId: 'spirit_incubator_metal', x: 0, y: 0, state: 'active', revision: 7 },
        { id: enhancementId, defId: 'spirit_egg_enhancement_station', x: 1, y: 0, state: 'active', revision: 9 },
        { id: 'fusion', defId: 'spirit_beast_fusion_station', x: 2, y: 0, state: 'active', revision: 1 },
      ] };
    for (let index = 0; index < 12; index += 1) {
      await service.awardEgg({ sourceRef: `${sourcePrefix}:runtime-egg:${index}`,
        ownerPlayerId: runtimePlayerId, element: 'metal', star: 1 });
    }
    const initialPanel = await runtime.getPanel(runtimePlayerId, runtimeContext);
    assert.equal(initialPanel.eggs.length, 12);
    assert.ok(initialPanel.eggs.every((entry) => entry.revision === 1), '面板必須投影每顆蛋自己的 revision');
    const hatchEgg = initialPanel.eggs[0];
    const incubated = await runtime.executeCommand(runtimePlayerId, { requestId: `${sourcePrefix}:runtime-incubate`,
      action: 'incubate', buildingId: incubatorId, eggItemKey: hatchEgg.itemKey,
      expectedRevision: hatchEgg.revision }, runtimeContext);
    assert.equal(incubated.ok, true, incubated.reasonKey);
    const incubatingPanel = await runtime.getPanel(runtimePlayerId, runtimeContext);
    const hatch = incubatingPanel.facilities.find((entry) => entry.buildingId === incubatorId)?.hatch;
    assert.ok(hatch && hatch.revision >= 1, '面板必須投影孵化紀錄自己的 revision');
    for (let tick = 0; tick < hatch.workRemainingTicks; tick += 1) runtime.advanceTicks(1);
    const readyPanel = await runtime.getPanel(runtimePlayerId, runtimeContext);
    const readyHatch = readyPanel.facilities.find((entry) => entry.buildingId === incubatorId)?.hatch;
    assert.equal(readyHatch?.state, 'ready');
    const adoptedViaRuntime = await runtime.executeCommand(runtimePlayerId, { requestId: `${sourcePrefix}:runtime-adopt`,
      action: 'adopt', buildingId: incubatorId, hatchId: readyHatch.hatchId,
      expectedRevision: readyHatch.revision }, runtimeContext);
    assert.equal(adoptedViaRuntime.ok, true, adoptedViaRuntime.reasonKey);

    const enhancementPanel = await runtime.getPanel(runtimePlayerId, runtimeContext);
    const targetEgg = enhancementPanel.eggs[0];
    const enhancedViaRuntime = await runtime.executeCommand(runtimePlayerId, { requestId: `${sourcePrefix}:runtime-enhance`,
      action: 'enhance_egg', buildingId: enhancementId, eggItemKey: targetEgg.itemKey,
      expectedRevision: targetEgg.revision,
      materials: enhancementPanel.eggs.slice(1, 11).map((entry) => ({ itemKey: entry.itemKey, count: 1 })) }, runtimeContext);
    assert.equal(enhancedViaRuntime.ok, true, enhancedViaRuntime.reasonKey);
    assert.equal((await service.listPlayerEggs(runtimePlayerId)).length, 1,
      '真 command 路徑須以蛋 revision 原子扣除十顆素材');

    const beforeFusionIds = new Set((await service.listPlayerBeasts(runtimePlayerId)).map((beast) => beast.beastId));
    const fusionIds = [randomUUID(), randomUUID()];
    for (const beastId of fusionIds) {
      await pool.query(`INSERT INTO spirit_beast_instance
        (beast_id,owner_player_id,species_id,grade,element,star,base_combat_power,skill_levels,state,revision)
        VALUES ($1,$2,$3,$4,$5,3,260,$6::jsonb,'warehouse',1)`,
      [beastId, runtimePlayerId, species.id, species.grade, species.element,
        JSON.stringify(Object.fromEntries(species.masteries.map((entry) => [entry.skill, entry.level + 10])))]);
    }
    const fusionCommand = { action: 'fuse', buildingId: 'fusion', beastIds: fusionIds };
    const previewResult = await runtime.executeCommand(runtimePlayerId,
      { ...fusionCommand, action: 'preview_fusion', requestId: `${sourcePrefix}:preview` }, runtimeContext);
    assert.equal(previewResult.ok, true, previewResult.reasonKey);
    const preview = previewResult.fusionPreview;
    assert.equal(preview.star, 1);
    assert.equal(preview.baseCombatPower, 540);
    // 預覽後親代變動：交易必須再次校驗，不能消耗四／五星或受保護素材。
    const persistenceRequest = { operationId: `${sourcePrefix}:fusion-invalid`, ownerPlayerId: runtimePlayerId,
      parentBeastIds: fusionIds, childSpeciesId: preview.speciesId, childGrade: preview.grade,
      childElement: preview.element, childCombatPower: preview.baseCombatPower,
      childSkillLevels: Object.fromEntries(preview.masteries.map((entry) => [entry.skill, entry.level])) };
    for (const star of [1, 2, 4, 5]) {
      await pool.query('UPDATE spirit_beast_instance SET star=$2 WHERE beast_id=$1', [fusionIds[0], star]);
      await assert.rejects(service.fuseBeasts(persistenceRequest), /SPIRIT_FUSION_PARENT_NOT_AVAILABLE/);
    }
    await pool.query("UPDATE spirit_beast_instance SET star=3,grade='immortal' WHERE beast_id=ANY($1::uuid[])", [fusionIds]);
    await assert.rejects(service.fuseBeasts(persistenceRequest), /SPIRIT_FUSION_PARENT_NOT_AVAILABLE/);
    await pool.query('UPDATE spirit_beast_instance SET grade=$2 WHERE beast_id=ANY($1::uuid[])', [fusionIds, species.grade]);
    const concurrent = await Promise.all(['fusion-a', 'fusion-b'].map((id) => runtime!.executeCommand(runtimePlayerId,
      { ...fusionCommand, requestId: `${sourcePrefix}:${id}` }, runtimeContext)));
    assert.equal(concurrent.filter((result) => result.ok).length, 1, '競爭融合只能產出一隻後代');
    const successful = concurrent.find((result) => result.ok)!;
    const fusionReplay = await runtime.executeCommand(runtimePlayerId,
      { ...fusionCommand, beastIds: [...fusionIds].reverse(), requestId: successful.requestId }, runtimeContext);
    assert.equal(fusionReplay.ok, true, '親代刪除後相同請求仍應重放成功');
    const fusionPanel = await runtime.getPanel(runtimePlayerId, runtimeContext);
    assert.ok(fusionIds.every((id) => !fusionPanel.beasts.some((beast) => beast.instanceId === id)));
    const offspring = fusionPanel.beasts.filter((beast) => !beforeFusionIds.has(beast.instanceId));
    assert.equal(offspring.length, 1);
    assert.equal(offspring[0].speciesId, preview.speciesId);
    assert.equal(offspring[0].star, 1);
    assert.equal(offspring[0].combatPower, preview.combatPower);
    assert.deepEqual(offspring[0].masteries, preview.masteries);
    assert.equal(offspring[0].effectiveSpeed, preview.effectiveSpeed);
    const recovered = await service.loadRecoveryState();
    const recoveredChild = recovered.beasts.find((beast) => beast.beastId === offspring[0].instanceId);
    // 倉庫獸由 listPlayerBeasts 回讀；恢復清單若含倉庫也必須保持一星。
    if (recoveredChild) assert.equal(recoveredChild.star, 1);
    const persistedChild = (await service.listPlayerBeasts(runtimePlayerId)).find((beast) => beast.beastId === offspring[0].instanceId)!;
    assert.equal(persistedChild.star, 1);
    assert.equal(persistedChild.baseCombatPower, 540);
    assert.deepEqual(persistedChild.skillLevels, persistenceRequest.childSkillLevels);

    console.log(JSON.stringify({ ok: true, case: 'spirit-beast-persistence', sourceDedupe: true,
      fusionThreeToOne: true, fusionConcurrentAndReplay: true, fusionPreviewMatchesReadback: true,
      atomicTenMaterialConsume: true, idempotentRandomReplay: true, hatchAdopted: true,
      lateFlushTerminalSafe: true, inventorySlotAndSharedLock: true,
      commandRevisionBindings: ['incubate', 'adopt', 'enhance_egg'] }, null, 2));
  } finally {
    if (runtime) await runtime.onModuleDestroy();
    if (pool) {
      for (const cleanupPlayerId of [playerId, runtimePlayerId]) {
        await pool.query('DELETE FROM spirit_beast_facility_storage WHERE owner_player_id=$1', [cleanupPlayerId]).catch(() => undefined);
        await pool.query('DELETE FROM spirit_beast_work_order WHERE owner_player_id=$1', [cleanupPlayerId]).catch(() => undefined);
        await pool.query('DELETE FROM spirit_beast_crop WHERE owner_player_id=$1', [cleanupPlayerId]).catch(() => undefined);
        await pool.query('DELETE FROM spirit_beast_hatch WHERE owner_player_id=$1', [cleanupPlayerId]).catch(() => undefined);
        await pool.query('DELETE FROM spirit_beast_instance WHERE owner_player_id=$1', [cleanupPlayerId]).catch(() => undefined);
        await pool.query('DELETE FROM spirit_beast_egg WHERE owner_player_id=$1 OR source_ref LIKE $2', [cleanupPlayerId, `${sourcePrefix}%`]).catch(() => undefined);
        await pool.query('DELETE FROM spirit_beast_operation WHERE player_id=$1', [cleanupPlayerId]).catch(() => undefined);
        await pool.query('DELETE FROM player_inventory_item WHERE player_id=$1', [cleanupPlayerId]).catch(() => undefined);
      }
    }
    await playerDomain.onModuleDestroy();
    service.onModuleDestroy();
    await provider.onModuleDestroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
