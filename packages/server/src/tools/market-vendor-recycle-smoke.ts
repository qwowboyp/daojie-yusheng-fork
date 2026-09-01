// @ts-nocheck
/** 用途：回收商單價表與 vendorRecycleItem 資產鏈路的冒煙驗證。 */
import assert from 'node:assert/strict';

import { MarketRuntimeService } from '../runtime/market/market-runtime.service';

type RuntimeItem = Record<string, unknown> & { itemId: string; count: number; itemInstanceId?: string };

async function main(): Promise<void> {
  const playerId = 'player:vendor-recycle';
  const ratTailInstanceId = 'vendor-recycle-rat-tail';
  const unknownInstanceId = 'vendor-recycle-unknown-ore';
  const fragmentInstanceId = 'vendor-recycle-technique-fragment';
  const durableCommits: Array<{ operationType: string; payload: Record<string, unknown> }> = [];
  const player = {
    playerId,
    runtimeOwnerId: 'smoke-runtime-owner',
    sessionEpoch: 1,
    inventory: {
      items: [
        { itemId: 'rat_tail', count: 5, name: '鼠尾', type: 'material', itemInstanceId: ratTailInstanceId },
        { itemId: 'unknown_ore', count: 2, name: '未知礦石', type: 'material', itemInstanceId: unknownInstanceId },
        { itemId: 'mat.technique_fragment', count: 6, name: '功法殘頁', type: 'material', itemInstanceId: fragmentInstanceId },
      ] as RuntimeItem[],
    },
    wallet: { balances: [] as Array<Record<string, unknown>> },
  };

  const service = new MarketRuntimeService(
    {
      normalizeItem(item: RuntimeItem) {
        return {
          ...item,
          count: Number.isFinite(Number(item?.count ?? 0)) ? Math.max(1, Math.trunc(Number(item.count))) : 1,
          name: typeof item?.name === 'string' ? item.name : item.itemId,
        };
      },
      getItemName(itemId: string) {
        if (itemId === 'spirit_stone') {
          return '靈石';
        }
        if (itemId === 'rat_tail') {
          return '鼠尾';
        }
        return itemId;
      },
      createItem(itemId: string, count = 1) {
        if (itemId === 'quest_relic') {
          return { itemId, count, name: '任務遺物', type: 'quest_item' };
        }
        if (itemId === 'rat_tail') {
          return { itemId, count, name: '鼠尾', type: 'material' };
        }
        if (itemId === 'mat.technique_fragment') {
          return { itemId, count, name: '功法殘頁', type: 'material' };
        }
        if (itemId === 'spirit_stone') {
          return { itemId, count, name: '靈石', type: 'consumable' };
        }
        return { itemId, count, name: itemId, type: 'material' };
      },
    } as never,
    {
      getPlayer(requestedPlayerId: string) {
        return requestedPlayerId === playerId ? player : null;
      },
      describePersistencePresence(requestedPlayerId: string) {
        return requestedPlayerId === playerId
          ? {
              online: true,
              inWorld: true,
              runtimeOwnerId: player.runtimeOwnerId,
              sessionEpoch: player.sessionEpoch,
            }
          : null;
      },
      snapshot(requestedPlayerId: string) {
        return requestedPlayerId === playerId ? structuredClone(player) : null;
      },
      restoreSnapshot(snapshot: { playerId?: string }) {
        if (snapshot?.playerId !== playerId) {
          return;
        }
        player.inventory.items = structuredClone((snapshot as typeof player).inventory.items);
        player.wallet.balances = structuredClone((snapshot as typeof player).wallet.balances);
      },
      peekInventoryItemByInstanceId(requestedPlayerId: string, itemInstanceId: string) {
        if (requestedPlayerId !== playerId) {
          return null;
        }
        return player.inventory.items.find((entry) => entry.itemInstanceId === itemInstanceId) ?? null;
      },
      splitInventoryItemByInstanceId(requestedPlayerId: string, itemInstanceId: string, quantity: number) {
        if (requestedPlayerId !== playerId) {
          throw new Error(`unexpected split player: ${requestedPlayerId}`);
        }
        const item = player.inventory.items.find((entry) => entry.itemInstanceId === itemInstanceId);
        if (!item || Number(item.count ?? 0) < quantity) {
          throw new Error(`unexpected split args: ${JSON.stringify({ itemInstanceId, quantity })}`);
        }
        item.count = Number(item.count) - Number(quantity);
        return { ...item, count: quantity };
      },
      canReceiveInventoryItem() {
        return true;
      },
      receiveInventoryItem(requestedPlayerId: string, item: RuntimeItem) {
        if (requestedPlayerId !== playerId) {
          throw new Error(`unexpected receiveInventoryItem player: ${requestedPlayerId}`);
        }
        const existing = player.inventory.items.find((entry) => entry.itemId === item.itemId);
        if (existing) {
          existing.count += item.count;
        }
        else {
          player.inventory.items.push({ ...item });
        }
      },
    } as never,
    {
      async loadStorageForPlayer() {
        return { items: [] };
      },
      async persistMutation() {
        return undefined;
      },
    } as never,
    {
      isEnabled() {
        return false;
      },
    } as never,
    {
      isEnabled() {
        return false;
      },
    } as never,
    null,
    null,
    null,
    null,
    {
      listIds() {
        return ['npc_a'];
      },
      tryGetRef() {
        return {
          shopItems: [
            { itemId: 'rat_tail', price: 4 },
            { itemId: 'quest_relic', price: 10 },
          ],
        };
      },
    } as never,
  );

  const originalCommit = service.commitDurableMarketMutationIfAvailable.bind(service);
  service.commitDurableMarketMutationIfAvailable = async (
    context: unknown,
    requestedPlayerId: string,
    operationType: string,
    payload: Record<string, unknown> = {},
  ) => {
    durableCommits.push({ operationType, payload: { ...payload } });
    return originalCommit(context, requestedPlayerId, operationType, payload);
  };

  const recyclePrices = service.getVendorRecycleUnitPriceByItemId();
  assert.equal(recyclePrices.get('rat_tail'), 1, 'rat_tail recycle price should be floor(4 * 0.25) = 1');
  assert.equal(recyclePrices.has('quest_relic'), false, 'quest_item must be excluded from recycle table');
  assert.equal(recyclePrices.get('mat.technique_fragment'), 1, 'technique fragment recycle price should be custom 1 per batch');

  const marketUpdate = service.buildMarketUpdate(playerId);
  assert.deepEqual(marketUpdate.vendorRecycleItems, [
    { itemId: 'mat.technique_fragment', unitRecyclePrice: 1, batchSize: 4 },
    { itemId: 'rat_tail', unitRecyclePrice: 1, batchSize: 1 },
  ]);

  const success = await service.vendorRecycleItem(playerId, {
    itemRef: { itemInstanceId: ratTailInstanceId },
    quantity: 3,
  });
  assert.equal(success.notices.some((entry) => entry.playerId === playerId), true);
  assert.equal(player.inventory.items.find((entry) => entry.itemInstanceId === ratTailInstanceId)?.count, 2);
  assert.equal(player.inventory.items.find((entry) => entry.itemId === 'spirit_stone')?.count ?? 0, 3);
  assert.equal(durableCommits.length, 1);
  assert.equal(durableCommits[0]?.operationType, 'market_vendor_recycle');
  assert.equal(durableCommits[0]?.payload.itemId, 'rat_tail');
  assert.equal(durableCommits[0]?.payload.quantity, 3);
  assert.equal(durableCommits[0]?.payload.unitRecyclePrice, 1);
  assert.equal(durableCommits[0]?.payload.totalIncome, 3);

  const rejected = await service.vendorRecycleItem(playerId, {
    itemRef: { itemInstanceId: unknownInstanceId },
    quantity: 1,
  });
  assert.equal(rejected.notices.some((entry) => entry.text === '回收商不收這件物品。'), true);
  assert.equal(player.inventory.items.find((entry) => entry.itemInstanceId === unknownInstanceId)?.count, 2);

  // 功法殘頁：4 張 1 組，回收 4 張得 1 靈石
  const fragmentSuccess = await service.vendorRecycleItem(playerId, {
    itemRef: { itemInstanceId: fragmentInstanceId },
    quantity: 4,
  });
  assert.equal(fragmentSuccess.notices.some((entry) => entry.playerId === playerId), true);
  assert.equal(player.inventory.items.find((entry) => entry.itemInstanceId === fragmentInstanceId)?.count, 2);
  assert.equal(player.inventory.items.find((entry) => entry.itemId === 'spirit_stone')?.count ?? 0, 4);
  assert.equal(durableCommits[1]?.operationType, 'market_vendor_recycle');
  assert.equal(durableCommits[1]?.payload.itemId, 'mat.technique_fragment');
  assert.equal(durableCommits[1]?.payload.quantity, 4);
  assert.equal(durableCommits[1]?.payload.batchSize, 4);
  assert.equal(durableCommits[1]?.payload.totalIncome, 1);

  // 功法殘頁：非組倍數數量必須拒絕
  const fragmentInvalid = await service.vendorRecycleItem(playerId, {
    itemRef: { itemInstanceId: fragmentInstanceId },
    quantity: 1,
  });
  assert.equal(fragmentInvalid.notices.some((entry) => entry.text === '回收數量必須是 4 的倍數。'), true);
  assert.equal(player.inventory.items.find((entry) => entry.itemInstanceId === fragmentInstanceId)?.count, 2);

  const overflow = await service.vendorRecycleItem(playerId, {
    itemRef: { itemInstanceId: ratTailInstanceId },
    quantity: 10,
  });
  assert.equal(overflow.notices.some((entry) => entry.text === '回收數量超過了當前持有數量。'), true);
  assert.equal(player.inventory.items.find((entry) => entry.itemInstanceId === ratTailInstanceId)?.count, 2);

  console.log(JSON.stringify({ ok: true, case: 'market-vendor-recycle' }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
