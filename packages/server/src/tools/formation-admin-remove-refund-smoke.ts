// @ts-nocheck
/**
 * 用途：GM 拆除玩家陣法並退還剩餘靈石（WorldRuntimeFormationService.removeFormationWithRefund）的冒煙驗證。
 * 覆蓋：正常退款（先刪後退）、免退款、各類前置拒絕、維護檢查點拒絕、堆疊容量、
 * 期望值核對、持久刪除未確認回滾（不退款）、退款入帳失敗回滾、持久刪除確認成功。
 */
import assert from 'node:assert/strict';

import { FORMATION_SPIRIT_STONE_ITEM_ID } from '@mud/shared';

import { WorldRuntimeFormationService } from '../runtime/world/world-runtime-formation.service';
import { installSmokeTimeout } from './smoke-timeout';

installSmokeTimeout(__filename);

async function main(): Promise<void> {
  const credits: Array<{ playerId: string; walletType: string; amount: number }> = [];
  const notices: Array<{ playerId: string; notice: unknown }> = [];
  let getPlayerOrThrowImpl: (playerId: string) => unknown = () => ({
    inventory: { items: [{ itemId: FORMATION_SPIRIT_STONE_ITEM_ID, count: 100_000 }] },
  });
  const playerRuntimeService = {
    getPlayerOrThrow(playerId: string) {
      return getPlayerOrThrowImpl(playerId);
    },
    creditWallet(playerId: string, walletType: string, amount: number) {
      credits.push({ playerId, walletType, amount });
    },
    debitWallet(playerId: string, walletType: string, amount: number) {
      credits.push({ playerId, walletType, amount: -amount });
    },
    enqueueNotice(playerId: string, notice: unknown) {
      notices.push({ playerId, notice });
    },
  };
  const service = new WorldRuntimeFormationService({}, playerRuntimeService, {});
  const instanceId = 'instance:formation-admin-remove:smoke';
  const instance = {
    meta: { instanceId, assignedNodeId: 'node:smoke', leaseToken: 'lease:smoke', ownershipEpoch: 7 },
    worldRevision: 0,
  };
  const deps = {
    getInstanceRuntime: (id: string) => (id === instanceId ? instance : null),
    isInstanceLeaseWritable: () => true,
  };
  const buildFormation = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    instanceId,
    ownerPlayerId: 'p_smoke_owner',
    formationId: 'spirit_gathering',
    name: '聚靈陣',
    lifecycle: 'deployed',
    active: true,
    x: -4,
    y: 3,
    eyeX: -4,
    eyeY: 3,
    eyeInstanceId: instanceId,
    remainingAuraBudget: 1_000,
    remainingQiBudget: 1_000,
    remainingSpiritStoneBudget: 176_562.59068574058,
    updatedAt: Date.now(),
    template: { id: 'spirit_gathering', lifecycle: 'deployed' },
    ...overrides,
  });
  const formationsInInstance = () => service.formationsByInstanceId.get(instanceId) ?? [];
  if (!service.formationMaintenanceCheckpointById) {
    service.formationMaintenanceCheckpointById = new Map();
  }

  try {
    // 1) 正常路徑：退還整數靈石（無條件捨去）＋移除運行態＋通知擁有者（無持久庫時以 fire-and-forget 記為已確認）。
    const formation = buildFormation(`formation:${instanceId}:1`);
    service.formationsByInstanceId.set(instanceId, [formation]);
    const result = await service.removeFormationWithRefund(instanceId, formation.id, deps);
    assert.equal(result.refundedSpiritStones, 176_562);
    assert.equal(result.remainingSpiritStoneBudgetBefore, 176_562);
    assert.equal(result.persistenceConfirmed, true);
    assert.equal(formationsInInstance().length, 0);
    assert.deepEqual(credits, [{ playerId: 'p_smoke_owner', walletType: FORMATION_SPIRIT_STONE_ITEM_ID, amount: 176_562 }]);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].playerId, 'p_smoke_owner');

    // 2) refundSpiritStones=false：只拆除、不退款。
    const noRefundFormation = buildFormation(`formation:${instanceId}:2`);
    service.formationsByInstanceId.set(instanceId, [noRefundFormation]);
    const noRefund = await service.removeFormationWithRefund(instanceId, noRefundFormation.id, deps, { refundSpiritStones: false });
    assert.equal(noRefund.refundedSpiritStones, 0);
    assert.equal(credits.length, 1);
    assert.equal(formationsInInstance().length, 0);

    // 3) 持續性陣法拒絕移除。
    const persistentFormation = buildFormation(`formation:${instanceId}:3`, { lifecycle: 'persistent' });
    service.formationsByInstanceId.set(instanceId, [persistentFormation]);
    await assert.rejects(() => service.removeFormationWithRefund(instanceId, persistentFormation.id, deps), /持續性陣法/);
    assert.equal(formationsInInstance().length, 1);

    // 4) 不存在的陣法回報錯誤。
    await assert.rejects(() => service.removeFormationWithRefund(instanceId, `formation:${instanceId}:999`, deps), /陣法不存在/);

    // 5) 缺擁有者且有餘額時拒絕，且不觸發退款。
    const orphanFormation = buildFormation(`formation:${instanceId}:4`, { ownerPlayerId: '' });
    service.formationsByInstanceId.set(instanceId, [orphanFormation]);
    await assert.rejects(() => service.removeFormationWithRefund(instanceId, orphanFormation.id, deps), /缺少擁有者/);
    assert.equal(formationsInInstance().length, 1);
    assert.equal(credits.length, 1);

    // 6) 擁有者不在運行態（getPlayerOrThrow 拋錯）：整筆中止且陣法保留。
    getPlayerOrThrowImpl = () => {
      throw new Error('player_not_found');
    };
    const runtimeMissingFormation = buildFormation(`formation:${instanceId}:5`);
    service.formationsByInstanceId.set(instanceId, [runtimeMissingFormation]);
    await assert.rejects(() => service.removeFormationWithRefund(instanceId, runtimeMissingFormation.id, deps), /player_not_found/);
    assert.equal(formationsInInstance().length, 1);
    assert.equal(credits.length, 1);

    // 7) 退還後超過堆疊上限：拒絕，不退款不移除。
    getPlayerOrThrowImpl = () => ({
      inventory: { items: [{ itemId: FORMATION_SPIRIT_STONE_ITEM_ID, count: 2_147_483_600 }] },
    });
    const overflowFormation = buildFormation(`formation:${instanceId}:6`);
    service.formationsByInstanceId.set(instanceId, [overflowFormation]);
    await assert.rejects(() => service.removeFormationWithRefund(instanceId, overflowFormation.id, deps), /堆疊上限/);
    assert.equal(formationsInInstance().length, 1);
    assert.equal(credits.length, 1);
    getPlayerOrThrowImpl = () => ({
      inventory: { items: [{ itemId: FORMATION_SPIRIT_STONE_ITEM_ID, count: 100_000 }] },
    });

    // 8) 期望值核對：陣法類型／擁有者不符時拒絕。
    const expectedFormation = buildFormation(`formation:${instanceId}:7`);
    service.formationsByInstanceId.set(instanceId, [expectedFormation]);
    await assert.rejects(
      () => service.removeFormationWithRefund(instanceId, expectedFormation.id, deps, { expectedFormationId: 'warding_barrier' }),
      /類型/,
    );
    await assert.rejects(
      () => service.removeFormationWithRefund(instanceId, expectedFormation.id, deps, { expectedOwnerPlayerId: 'p_other' }),
      /擁有者/,
    );
    assert.equal(formationsInInstance().length, 1);

    // 9) 維護檢查點存在：拒絕，不退款不移除。
    const checkpointFormation = buildFormation(`formation:${instanceId}:8`);
    service.formationsByInstanceId.set(instanceId, [checkpointFormation]);
    service.formationMaintenanceCheckpointById.set(checkpointFormation.id, true);
    await assert.rejects(() => service.removeFormationWithRefund(instanceId, checkpointFormation.id, deps), /維護檢查點/);
    service.formationMaintenanceCheckpointById.delete(checkpointFormation.id);
    assert.equal(formationsInInstance().length, 1);
    assert.equal(credits.length, 1);

    // 10) 持久刪除未確認：回滾（還原運行態、重排持久化）且「不退款」。
    const rollbackFormation = buildFormation(`formation:${instanceId}:9`);
    service.formationsByInstanceId.set(instanceId, [rollbackFormation]);
    service.requiresFormationPersistenceFence = () => true;
    service.confirmFormationRemovalPersisted = async () => false;
    let rePersistRequested = false;
    service.persistInstanceFormationsSoon = () => {
      rePersistRequested = true;
    };
    await assert.rejects(() => service.removeFormationWithRefund(instanceId, rollbackFormation.id, deps), /持久刪除未確認/);
    assert.equal(formationsInInstance().length, 1);
    assert.equal(formationsInInstance()[0].id, rollbackFormation.id);
    assert.equal(rePersistRequested, true);
    assert.equal(credits.length, 1);

    // 11) 退款入帳失敗（持久刪除已確認後）：回滾運行態並回報失敗。
    const creditFailFormation = buildFormation(`formation:${instanceId}:10`);
    service.formationsByInstanceId.set(instanceId, [creditFailFormation]);
    service.confirmFormationRemovalPersisted = async () => true;
    playerRuntimeService.creditWallet = () => {
      throw new Error('credit_failed');
    };
    rePersistRequested = false;
    await assert.rejects(() => service.removeFormationWithRefund(instanceId, creditFailFormation.id, deps), /退款入帳失敗/);
    assert.equal(formationsInInstance().length, 1);
    assert.equal(rePersistRequested, true);
    assert.equal(credits.length, 1);

    // 12) 持久刪除已確認：成功移除並退款，不再回滾。
    const confirmedFormation = buildFormation(`formation:${instanceId}:11`);
    service.formationsByInstanceId.set(instanceId, [confirmedFormation]);
    playerRuntimeService.creditWallet = (playerId: string, walletType: string, amount: number) => {
      credits.push({ playerId, walletType, amount });
    };
    const confirmed = await service.removeFormationWithRefund(instanceId, confirmedFormation.id, deps);
    assert.equal(confirmed.persistenceConfirmed, true);
    assert.equal(formationsInInstance().length, 0);
    assert.deepEqual(credits.slice(1), [{ playerId: 'p_smoke_owner', walletType: FORMATION_SPIRIT_STONE_ITEM_ID, amount: 176_562 }]);

    console.log(JSON.stringify({
      ok: true,
      case: 'formation-admin-remove-refund',
      answers: [
        '先刪後退：持久列確認刪除後才入帳退款，運行態與退款同步完成。',
        '持續性陣法、查無陣法、缺擁有者、堆疊超限、期望值不符、維護檢查點皆在移除前失敗關閉。',
        '持久刪除未確認或退款入帳失敗時回滾運行態、不重複退款並回報失敗。',
      ],
    }, null, 2));
  } finally {
    await service.closePersistencePool?.().catch?.(() => undefined);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
