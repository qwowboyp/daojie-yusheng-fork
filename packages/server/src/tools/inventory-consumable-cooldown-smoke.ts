import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { resolveTechniqueStandardMaxHpRecoveryAmount, SHENXING_PILL_TIERS } from '@mud/shared';
import { ContentTemplateRepository } from '../content/content-template.repository';
import { PlayerRuntimeService } from '../runtime/player/player-runtime.service';
import { WorldRuntimeUseItemService } from '../runtime/world/world-runtime-use-item.service';

const repo = new ContentTemplateRepository();
repo.onModuleInit();

const minorHeal = repo.createItem('pill.minor_heal', 2);
assert.equal(minorHeal.cooldown, 60, '瞬回生命药应使用 60 息通用冷却');
assert.equal(minorHeal.baselineHealPercent, 1, '回春散应按标准等级生命 100% 配置恢复');
const buffPill = repo.createItem('pill.crimson_bud_elixir', 2);
assert.equal(buffPill.cooldown, undefined, '增益丹药不应继承恢复药冷却');

const service = new PlayerRuntimeService(
  repo,
  {},
  { recalculate() {} },
  { refreshPreview() {} },
);

const playerId = 'player:consumable-cooldown-smoke';
const player: any = {
  playerId,
  persistentRevision: 1,
  hp: 50,
  maxHp: 10000,
  qi: 0,
  maxQi: 100,
  lifeElapsedTicks: 10,
  inventory: {
    revision: 1,
    capacity: 20,
    items: [
      repo.createItem('pill.minor_heal', 2),
      repo.createItem('frost_heart_paste', 1),
      repo.createItem('minor_qi_pill', 1),
      repo.createItem('pill.crimson_bud_elixir', 2),
    ],
  },
  wallet: { balances: [] },
  buffs: { revision: 1, buffs: [] },
  attrs: {
    revision: 1,
    baseAttrs: {},
    finalAttrs: {},
    bonuses: [],
    numericStats: {},
    ratioDivisors: {},
  },
};
service.players.set(playerId, player);

service.useItem(playerId, 0);
assert.equal(
  player.hp,
  50 + resolveTechniqueStandardMaxHpRecoveryAmount(10, 1),
  '首次使用回春散应按标准 10 级最大生命的 100% 恢复，而不是按当前玩家上限恢复',
);
assert.equal(player.inventory.items[0].count, 1, '首次使用应消耗一枚回春散');
assert.deepEqual(
  (player.inventory.cooldowns ?? []).map((entry: any) => entry.itemId).sort(),
  ['frost_heart_paste', 'pill.minor_heal'].sort(),
  '生命回复组冷却应覆盖当前背包内所有生命瞬回药',
);
assert.equal(player.inventory.serverTick, 10, '冷却同步应使用玩家 lifeElapsedTicks');

assert.throws(
  () => service.useItem(playerId, 1),
  (error: unknown) => error instanceof BadRequestException && /冷卻中/.test(error.message),
  '同一生命回复组冷却中应拒绝再次用药',
);
assert.equal(player.inventory.items[1].count, 1, '冷却拒绝不能消耗第二种生命药');

service.useItem(playerId, 2);
assert.equal(player.qi, 100, '生命回复组冷却不应阻塞灵力回复药，灵力恢复应封顶到当前最大灵力');

service.useItem(playerId, 2);
assert.equal(player.inventory.items[2].itemId, 'pill.crimson_bud_elixir', '灵力药消耗后增益丹药应位于当前槽位');
service.useItem(playerId, 2);
assert.equal(
  (player.inventory.cooldowns ?? []).some((entry: any) => entry.itemId === 'pill.crimson_bud_elixir'),
  false,
  '增益丹药连续使用不应写入冷却投影',
);

player.lifeElapsedTicks = 70;
service.useItem(playerId, 1);
assert.equal(player.hp, player.maxHp, '60 息冷却结束后生命回复药应可再次使用并封顶到当前最大气血');

const manualPlayerId = 'player:manual-use-item-cooldown-smoke';
async function testManualUseItemBranch() {
  const manualItem = repo.createItem('pill.crimson_bud_elixir', 2);
  manualItem.itemInstanceId = 'manual:buff-pill';
  const manualPlayer: any = {
    ...player,
    playerId: manualPlayerId,
    hp: 100,
    qi: 0,
    lifeElapsedTicks: 30,
    inventory: {
      revision: 1,
      capacity: 20,
      items: [manualItem],
    },
    buffs: { revision: 1, buffs: [] },
  };
  service.players.set(manualPlayerId, manualPlayer);
  const manualUseService = new WorldRuntimeUseItemService(repo, {}, service);
  const manualDeps = {
    refreshQuestStates() {},
    advanceLearnTechniqueQuest() {},
    queuePlayerNotice() {},
  };
  await manualUseService.dispatchUseItem(manualPlayerId, 'manual:buff-pill', manualDeps);
  await manualUseService.dispatchUseItem(manualPlayerId, 'manual:buff-pill', manualDeps);
  assert.equal(
    (manualPlayer.inventory.cooldowns ?? []).some((entry: any) => entry.itemId === 'pill.crimson_bud_elixir'),
    false,
    '手动 useItem 编排路径也不应让增益丹药产生冷却',
  );
}

const specialPlayerId = 'player:special-consumable-cooldown-smoke';
const specialPlayer: any = {
  ...player,
  playerId: specialPlayerId,
  hp: 100,
  qi: 100,
  lifeElapsedTicks: 35,
  inventory: {
    revision: 1,
    capacity: 20,
    items: [{
      itemId: 'pill.special_no_recovery',
      count: 1,
      name: '特殊丹',
      type: 'consumable',
      cooldown: 99,
      consumeBuffs: [{
        buffId: 'item_buff.special_no_recovery',
        name: '特殊丹效',
        desc: '非恢复特殊丹效',
        duration: 10,
        attrs: { attack: 1 },
      }],
    }],
  },
  buffs: { revision: 1, buffs: [] },
};
service.players.set(specialPlayerId, specialPlayer);
service.useItem(specialPlayerId, 0);
assert.deepEqual(specialPlayer.inventory.cooldowns ?? [], [], '显式 cooldown 的非恢复特殊药也不应写入冷却');

const realmBuffPlayerId = 'player:realm-pill-family-smoke';
const foundationArcane = repo.createItem('pill.realm.foundation.arcane_surge', 2);
const goldenCoreArcane = repo.createItem('pill.realm.golden_core.arcane_surge', 1);
const foundationIronGuard = repo.createItem('pill.realm.foundation.iron_guard', 1);
const realmBuffPlayer: any = {
  ...player,
  playerId: realmBuffPlayerId,
  inventory: {
    revision: 1,
    capacity: 20,
    items: [foundationArcane, goldenCoreArcane, foundationIronGuard],
  },
  buffs: { revision: 1, buffs: [] },
};
service.players.set(realmBuffPlayerId, realmBuffPlayer);
service.useItem(realmBuffPlayerId, 0);
let arcaneBuff = realmBuffPlayer.buffs.buffs.find(
  (entry: any) => entry.buffId === 'item_buff.realm_arcane_surge',
);
assert.equal(arcaneBuff?.realmLv, foundationArcane.level, '築基丹 Buff 來源境界必須取 item.level');
assert.equal(arcaneBuff?.duration, 120, '築基丹初次使用應寫入正式內容的 120 息時長');
assert.equal(arcaneBuff?.remainingTicks, 121, '初次 Buff 應保留完整 120 息，不提前消耗當前息');

service.useItem(realmBuffPlayerId, 1);
arcaneBuff = realmBuffPlayer.buffs.buffs.find(
  (entry: any) => entry.buffId === 'item_buff.realm_arcane_surge',
);
assert.equal(
  realmBuffPlayer.buffs.buffs.filter((entry: any) => entry.buffId === 'item_buff.realm_arcane_surge').length,
  1,
  '築基玄元丹再服金丹玄元丹，同族 Buff 只能保留一層',
);
assert.equal(arcaneBuff?.realmLv, goldenCoreArcane.level, '跨境界替換後來源境界必須更新為金丹 item.level');
assert.equal(arcaneBuff?.duration, 150, '跨境界替換必須刷新為金丹正式時長，不可與舊時長累加');
assert.equal(arcaneBuff?.remainingTicks, 151, '跨境界替換後應由完整 150 息重新開始');
assert.equal(arcaneBuff?.stats?.spellAtk, 11, '跨境界替換後應使用金丹玄元丹數值');

service.useItem(realmBuffPlayerId, 1);
assert.deepEqual(
  realmBuffPlayer.buffs.buffs.map((entry: any) => entry.buffId).sort(),
  ['item_buff.realm_arcane_surge', 'item_buff.realm_iron_guard'],
  '玄元丹與金剛丹屬不同家族，兩者 Buff 必須共存',
);
const ironGuardBuff = realmBuffPlayer.buffs.buffs.find(
  (entry: any) => entry.buffId === 'item_buff.realm_iron_guard',
);
assert.equal(ironGuardBuff?.realmLv, foundationIronGuard.level, '異族 Buff 來源境界也必須取各自 item.level');

service.useItem(realmBuffPlayerId, 0);
arcaneBuff = realmBuffPlayer.buffs.buffs.find(
  (entry: any) => entry.buffId === 'item_buff.realm_arcane_surge',
);
assert.equal(
  realmBuffPlayer.buffs.buffs.filter((entry: any) => entry.buffId === 'item_buff.realm_arcane_surge').length,
  1,
  '重服低階同族丹後仍只能保留一層',
);
assert.equal(arcaneBuff?.realmLv, foundationArcane.level, '重服低階丹必須把來源境界替換回築基 item.level');
assert.equal(arcaneBuff?.duration, 120, '重服低階丹應刷新為 120 息，不保留高階時長');
assert.equal(arcaneBuff?.remainingTicks, 121, '重服低階丹不可累加先前高階丹剩餘時間');
assert.equal(arcaneBuff?.stats?.spellAtk, 9, '重服低階丹後不可殘留高階玄元丹數值');
assert.equal(
  realmBuffPlayer.buffs.buffs.some((entry: any) => entry.buffId === 'item_buff.realm_iron_guard'),
  true,
  '替換玄元丹時不可移除不同家族的金剛丹 Buff',
);

const legacyPlayerId = 'player:legacy-consumable-cooldown-smoke';
const legacyPlayer: any = {
  ...player,
  playerId: legacyPlayerId,
  hp: 50,
  maxHp: 100,
  lifeElapsedTicks: 40,
  inventory: {
    revision: 1,
    capacity: 20,
    items: [{
      itemId: 'pill.minor_heal',
      count: 2,
      name: '回春散',
      healAmount: 22,
    }],
  },
  buffs: { revision: 1, buffs: [] },
};
service.players.set(legacyPlayerId, legacyPlayer);
service.useItem(legacyPlayerId, 0);
assert.equal(legacyPlayer.inventory.items[0].count, 1, '旧实例首次使用应照常消耗');
assert.deepEqual(
  legacyPlayer.inventory.cooldowns,
  [{ itemId: 'pill.minor_heal', cooldown: 60, startedAtTick: 40 }],
  '缺少 type 的旧瞬回药实例也必须写入 60 息冷却投影',
);
assert.throws(
  () => service.useItem(legacyPlayerId, 0),
  (error: unknown) => error instanceof BadRequestException && /冷卻中/.test(error.message),
  '缺少 type 的旧瞬回药实例也必须被冷却拦截',
);

const shenxingPlayerId = 'player:shenxing-shared-cooldown-smoke';
const lowShenxing = {
  itemId: SHENXING_PILL_TIERS[0].itemId,
  itemInstanceId: 'shenxing:low',
  count: 1,
  level: SHENXING_PILL_TIERS[0].minRealmLv,
};
const highShenxing = {
  itemId: SHENXING_PILL_TIERS[8].itemId,
  itemInstanceId: 'shenxing:high',
  count: 1,
  level: SHENXING_PILL_TIERS[8].minRealmLv,
};
const shenxingPlayer: any = {
  ...player,
  playerId: shenxingPlayerId,
  lifeElapsedTicks: 100,
  inventory: {
    revision: 1,
    capacity: 20,
    items: [lowShenxing, highShenxing],
  },
  buffs: { revision: 1, buffs: [] },
};
service.players.set(shenxingPlayerId, shenxingPlayer);
service.markConsumableItemCooldown(shenxingPlayerId, lowShenxing);
assert.equal(
  service.getConsumableItemCooldownRemainingTicks(shenxingPlayerId, highShenxing),
  SHENXING_PILL_TIERS[0].cooldownTicks,
  '先服低階丹後查高階丹，必須沿用已服丹的完整共用冷卻',
);
assert.equal(
  shenxingPlayer.inventory.cooldowns.length === 2
    && shenxingPlayer.inventory.cooldowns.every(
      (entry: any) => entry.cooldown === SHENXING_PILL_TIERS[0].cooldownTicks,
    ),
  true,
  '所有神行丹的背包投影必須顯示同一個實際共用冷卻',
);
shenxingPlayer.buffs = { revision: 1, buffs: [] };
shenxingPlayer.inventory.consumableCooldownStartedAtByGroup = {};
service.markConsumableItemCooldown(shenxingPlayerId, highShenxing);
assert.equal(
  service.getConsumableItemCooldownRemainingTicks(shenxingPlayerId, lowShenxing),
  SHENXING_PILL_TIERS[8].cooldownTicks,
  '先服高階丹後查低階丹，不可改用低階丹自身的較長冷卻重算',
);
assert.equal(
  shenxingPlayer.inventory.cooldowns.every(
    (entry: any) => entry.cooldown === SHENXING_PILL_TIERS[8].cooldownTicks,
  ),
  true,
  '高階丹啟動的短冷卻不得被任一品階查詢刪除或改長',
);

async function main() {
  await testManualUseItemBranch();
  console.log('inventory-consumable-cooldown-smoke ok');
}

void main();
