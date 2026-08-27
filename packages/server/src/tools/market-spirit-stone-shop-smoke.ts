/** 用途：靈石商店目錄彙總與 buySpiritStoneShopItem 購買鏈路的冒煙驗證（純記憶體，無持久化對象）。 */
import assert from 'node:assert/strict';

import { MARKET_CURRENCY_ITEM_ID } from '../constants/gameplay/market';
import { MarketRuntimeService } from '../runtime/market/market-runtime.service';

type SmokeItem = {
  itemId: string;
  count: number;
  name?: string;
  type?: string;
};

type SmokePlayer = {
  playerId: string;
  runtimeOwnerId: string;
  sessionEpoch: number;
  inventory: { items: SmokeItem[]; capacity: number; revision?: number };
  wallet: { balances: Array<{ walletType: string; balance: number; frozenBalance?: number; version?: number }> };
};

function normalizeCount(value: unknown): number {
  const numeric = Number(value ?? 1);
  return Number.isFinite(numeric) ? Math.max(1, Math.trunc(numeric)) : 1;
}

function createContentRepository() {
  const names = new Map<string, string>([
    ['spirit_stone', '靈石'],
    ['rat_tail', '鼠尾'],
    ['quest_relic', '任務遺物'],
    ['pill.ningxiang', '凝相丹'],
  ]);
  return {
    normalizeItem(item: SmokeItem): SmokeItem {
      return { ...item, count: normalizeCount(item?.count), name: item?.name ?? names.get(item?.itemId) ?? item?.itemId };
    },
    createItem(itemId: string, count = 1): SmokeItem | null {
      const name = names.get(itemId);
      if (!name) {
        return null;
      }
      return { itemId, count: normalizeCount(count), name, type: itemId === 'quest_relic' ? 'quest_item' : 'consumable' };
    },
    getItemName(itemId: string): string {
      return names.get(itemId) ?? itemId;
    },
  };
}

function createPlayerRuntimeService(runtimePlayers: Map<string, SmokePlayer>) {
  function getPlayerOrThrow(playerId: string): SmokePlayer {
    const player = runtimePlayers.get(playerId);
    if (!player) {
      throw new Error(`unexpected player ${playerId}`);
    }
    return player;
  }
  function syncWalletFromInventory(player: SmokePlayer, itemId: string): void {
    const balance = player.inventory.items
      .filter((entry) => entry.itemId === itemId)
      .reduce((sum, entry) => sum + normalizeCount(entry.count), 0);
    const wallet = player.wallet.balances.find((entry) => entry.walletType === itemId);
    if (wallet) {
      wallet.balance = balance;
      return;
    }
    player.wallet.balances.push({ walletType: itemId, balance });
  }
  return {
    snapshot(playerId: string): SmokePlayer | null {
      const player = runtimePlayers.get(playerId);
      return player ? structuredClone(player) : null;
    },
    restoreSnapshot(snapshot: SmokePlayer): void {
      if (snapshot?.playerId && runtimePlayers.has(snapshot.playerId)) {
        runtimePlayers.set(snapshot.playerId, structuredClone(snapshot));
      }
    },
    getPlayer(playerId: string): SmokePlayer | null {
      return runtimePlayers.get(playerId) ?? null;
    },
    describePersistencePresence(playerId: string) {
      const player = runtimePlayers.get(playerId);
      return player
        ? { online: true, inWorld: true, runtimeOwnerId: player.runtimeOwnerId, sessionEpoch: player.sessionEpoch }
        : null;
    },
    canAffordWallet(playerId: string, walletType: string, amount: number): boolean {
      const player = getPlayerOrThrow(playerId);
      const balance = player.inventory.items
        .filter((entry) => entry.itemId === walletType)
        .reduce((sum, entry) => sum + normalizeCount(entry.count), 0);
      return balance >= Math.max(0, Math.trunc(Number(amount ?? 0)));
    },
    debitWallet(playerId: string, walletType: string, amount: number): SmokePlayer {
      const player = getPlayerOrThrow(playerId);
      let remaining = Math.max(0, Math.trunc(Number(amount ?? 0)));
      for (let index = player.inventory.items.length - 1; index >= 0 && remaining > 0; index -= 1) {
        const item = player.inventory.items[index];
        if (item?.itemId !== walletType) {
          continue;
        }
        const consumed = Math.min(normalizeCount(item.count), remaining);
        item.count = normalizeCount(item.count) - consumed;
        remaining -= consumed;
        if (item.count <= 0) {
          player.inventory.items.splice(index, 1);
        }
      }
      if (remaining > 0) {
        throw new Error(`${walletType} balance not enough`);
      }
      syncWalletFromInventory(player, walletType);
      return player;
    },
    canReceiveInventoryItem(playerId: string, itemId: string): boolean {
      const player = getPlayerOrThrow(playerId);
      return player.inventory.items.some((entry) => entry.itemId === itemId)
        || player.inventory.items.length < player.inventory.capacity;
    },
    receiveInventoryItem(playerId: string, item: SmokeItem): SmokePlayer {
      const player = getPlayerOrThrow(playerId);
      const count = normalizeCount(item?.count);
      const existing = player.inventory.items.find((entry) => entry.itemId === item.itemId);
      if (existing) {
        existing.count = normalizeCount(existing.count) + count;
      } else {
        player.inventory.items.push({ ...item, count });
      }
      syncWalletFromInventory(player, item.itemId);
      return player;
    },
  };
}

async function main(): Promise<void> {
  const playerId = 'player:spirit-stone-shop';
  const runtimePlayer: SmokePlayer = {
    playerId,
    runtimeOwnerId: 'smoke-runtime-owner',
    sessionEpoch: 1,
    inventory: {
      capacity: 10,
      items: [{ itemId: MARKET_CURRENCY_ITEM_ID, count: 10, name: '靈石', type: 'consumable' }],
    },
    wallet: { balances: [{ walletType: MARKET_CURRENCY_ITEM_ID, balance: 10 }] },
  };
  const runtimePlayers = new Map([[playerId, runtimePlayer]]);
  const service = new MarketRuntimeService(
    createContentRepository() as never,
    createPlayerRuntimeService(runtimePlayers) as never,
    {
      async loadStorageForPlayer() {
        return { items: [] };
      },
      async persistMutation() {
        return undefined;
      },
    } as never,
    { isEnabled() { return false; } } as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    // NPC 商店貨架：npc_a 與 npc_b 同售 rat_tail 但價不同（取最低 4）；quest_item 也上架
    {
      listIds() {
        return ['npc_a', 'npc_b'];
      },
      tryGetRef(npcId: string) {
        if (npcId === 'npc_a') {
          return { shopItems: [{ itemId: 'rat_tail', price: 4 }, { itemId: 'quest_relic', price: 10 }] };
        }
        return { shopItems: [{ itemId: 'rat_tail', price: 6 }, { itemId: 'pill.ningxiang', price: 2 }, { itemId: 'ghost_item', price: 1 }] };
      },
    } as never,
  );

  // 目錄彙總：同一物品取最低售價，quest_item 不排除
  const catalog = service.getSpiritStoneShopUnitPriceByItemId();
  assert.equal(catalog.get('rat_tail'), 4, '同一物品必須取 NPC 最低售價');
  assert.equal(catalog.get('quest_relic'), 10, 'quest_item 也上架');
  assert.equal(catalog.get('pill.ningxiang'), 2);
  assert.equal(catalog.get('ghost_item'), 1);

  const marketUpdate = service.buildMarketUpdate(playerId);
  assert.deepEqual(
    marketUpdate.spiritStoneShopItems,
    [
      { itemId: 'ghost_item', unitPrice: 1 },
      { itemId: 'pill.ningxiang', unitPrice: 2 },
      { itemId: 'quest_relic', unitPrice: 10 },
      { itemId: 'rat_tail', unitPrice: 4 },
    ],
    'buildMarketUpdate 必須下發靈石商店目錄且按 itemId 排序',
  );

  // 購買成功：扣靈石、得物品
  const success = await service.buySpiritStoneShopItem(playerId, { itemId: 'rat_tail', quantity: 2 });
  const playerAfterSuccess = runtimePlayers.get(playerId)!;
  assert.equal(playerAfterSuccess.inventory.items.find((entry) => entry.itemId === MARKET_CURRENCY_ITEM_ID)?.count, 2);
  assert.equal(playerAfterSuccess.wallet.balances.find((entry) => entry.walletType === MARKET_CURRENCY_ITEM_ID)?.balance, 2);
  assert.equal(playerAfterSuccess.inventory.items.find((entry) => entry.itemId === 'rat_tail')?.count, 2);
  assert.equal(success.notices[0]?.structured?.key, 'notice.market.spirit-stone-shop.purchased');
  assert.equal(success.notices[0]?.structured?.vars?.itemLabel, '鼠尾 x2');
  assert.equal(success.notices[0]?.structured?.vars?.currency, '靈石');
  assert.equal(success.notices[0]?.structured?.vars?.cost, 8);

  // 餘額不足被拒：quest_relic 售價 10 > 餘 2
  const rejectedByBalance = await service.buySpiritStoneShopItem(playerId, { itemId: 'quest_relic', quantity: 1 });
  const playerAfterBalanceReject = runtimePlayers.get(playerId)!;
  assert.equal(rejectedByBalance.notices[0]?.text, '靈石不足，無法購買。');
  assert.equal(playerAfterBalanceReject.inventory.items.find((entry) => entry.itemId === MARKET_CURRENCY_ITEM_ID)?.count, 2);
  assert.equal(playerAfterBalanceReject.inventory.items.find((entry) => entry.itemId === 'quest_relic'), undefined);

  // 商品配置不存在被拒：目錄有 ghost_item 但 createItem 返回 null
  const rejectedByConfig = await service.buySpiritStoneShopItem(playerId, { itemId: 'ghost_item', quantity: 1 });
  assert.equal(rejectedByConfig.notices[0]?.text, '靈石商店商品配置不存在。');
  assert.equal(runtimePlayers.get(playerId)!.inventory.items.find((entry) => entry.itemId === MARKET_CURRENCY_ITEM_ID)?.count, 2);

  // 第二次成功購買：花完靈石
  const pillResult = await service.buySpiritStoneShopItem(playerId, { itemId: 'pill.ningxiang', quantity: 1 });
  const playerAfterPill = runtimePlayers.get(playerId)!;
  // fake debitWallet 扣至 0 時會移除庫存條目，故以 ?? 0 斷言餘額歸零
  assert.equal(playerAfterPill.inventory.items.find((entry) => entry.itemId === MARKET_CURRENCY_ITEM_ID)?.count ?? 0, 0);
  assert.equal(playerAfterPill.wallet.balances.find((entry) => entry.walletType === MARKET_CURRENCY_ITEM_ID)?.balance, 0);
  assert.equal(playerAfterPill.inventory.items.find((entry) => entry.itemId === 'pill.ningxiang')?.count, 1);
  assert.equal(pillResult.notices[0]?.structured?.vars?.cost, 2);

  // 不存在的 itemId 被拒
  const rejectedByUnknownItem = await service.buySpiritStoneShopItem(playerId, { itemId: 'no_such_item', quantity: 1 });
  assert.equal(rejectedByUnknownItem.notices[0]?.text, '靈石商店商品不存在。');

  // 非法 quantity（0 / 負數 / 歸一後非正的小數）被拒
  for (const invalidQuantity of [0, -1, 0.5]) {
    const rejectedByQuantity = await service.buySpiritStoneShopItem(playerId, { itemId: 'rat_tail', quantity: invalidQuantity });
    assert.equal(rejectedByQuantity.notices[0]?.text, '靈石商店商品不存在。', `quantity=${invalidQuantity} 必須被拒`);
  }
  assert.equal(runtimePlayers.get(playerId)!.inventory.items.find((entry) => entry.itemId === 'rat_tail')?.count, 2, '拒絕路徑不得改動資產');

  console.log(JSON.stringify({ ok: true, case: 'market-spirit-stone-shop' }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
