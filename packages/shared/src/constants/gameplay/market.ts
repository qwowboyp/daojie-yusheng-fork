/**
 * 本文件定义前后端共享的玩法常量，是协议和运行规则共同依赖的稳定来源。
 *
 * 维护时要同步检查客户端展示、服务端结算和配置编辑器，避免同一数值在多端分叉。
 */
import { TECHNIQUE_FRAGMENT_ITEM_ID } from './technique';
/**
 * 市场交易系统常量。
 */

/** 市场价格预设值 */
export const MARKET_PRICE_PRESET_VALUES = [0.01, 1, 100, 10_000, 1_000_000] as const;

/** 市场最低单价 */
export const MARKET_MIN_UNIT_PRICE = MARKET_PRICE_PRESET_VALUES[0];

/** 市场最高单价 */
export const MARKET_MAX_UNIT_PRICE = 10_000_000_000;

/** 天道商店消耗的专属货币物品 ID */
export const HEAVENLY_DAO_SHOP_CURRENCY_ITEM_ID = 'merit';

/** 天道商店固定商品表；价格由服务端按此表权威结算。 */
export const HEAVENLY_DAO_SHOP_ITEMS = [
  { itemId: 'spirit_stone', count: 240, price: 100 },
  { itemId: 'root_seed.heaven', count: 1, price: 2_000 },
  { itemId: 'root_seed.divine', count: 1, price: 10_000 },
  { itemId: 'sect_founding_token', count: 1, price: 2_000 },
  { itemId: 'sect_entrance_relocation_token', count: 1, price: 100 },
  { itemId: 'wudao_yujian', count: 1, price: 1_000 },
  { itemId: 'pill.ningxiang', count: 1, price: 1 },
  { itemId: 'pill.wangsheng', count: 1, price: 100 },
  { itemId: 'pill.shatter_spirit', count: 1, price: 10 },
] as const;

/** 永恒权益下天道商店折扣百分比。 */
export const HEAVENLY_DAO_SHOP_ETERNAL_DISCOUNT_PERCENT = 10;

/** 回收商回收折扣百分比：以 NPC 商店售價為基準的回收比例。 */
export const VENDOR_RECYCLE_RATE_PERCENT = 25;

/** 回收商單件回收價下限（靈石）。 */
export const VENDOR_RECYCLE_MIN_UNIT_PRICE = 1;

/**
 * 回收商自訂單價表（itemId → 每組回收價，靈石）。
 * 與 NPC 商店貨架彙總合併：貨架已有的物品以貨架最低售價折算優先，
 * 自訂表負責「商店沒賣、但回收商願意收」的物品（如功法殘頁）。
 * 組裝物品（見 VENDOR_RECYCLE_BATCH_SIZE_BY_ITEM_ID）以「組」為結算單位，
 * 數量必須是組大小的倍數，每組按本表價格結算。
 */
export const VENDOR_RECYCLE_CUSTOM_UNIT_PRICES: Record<string, number> = {
  // 功法殘頁：4 張 1 組，每組 1 靈石
  [TECHNIQUE_FRAGMENT_ITEM_ID]: 1,
};

/**
 * 回收商按組回收的物品：itemId → 每組張數。
 * 組裝物品以「組」為最小結算單位，數量必須是組大小的倍數，每組按單件回收價結算。
 * 例如功法殘頁 4 張 1 組、每組 1 靈石 → 回收 4/8/12 張，得 1/2/3 靈石。
 */
export const VENDOR_RECYCLE_BATCH_SIZE_BY_ITEM_ID: Record<string, number> = {
  [TECHNIQUE_FRAGMENT_ITEM_ID]: 4,
};

/** 回收商絕不回收的特殊物品：貨幣與權益類物品本身不得進入回收鏈路。 */
export const VENDOR_RECYCLE_EXCLUDED_ITEM_IDS = [
  'spirit_stone',
  'merit',
  'merit_eternal',
  'merit_month_card',
] as const;

/** 回收商不收的物品類型：任務物品回收會卡死任務進度。 */
export const VENDOR_RECYCLE_EXCLUDED_ITEM_TYPES = ['quest_item'] as const;

/**
 * 計算回收商單件回收價：NPC 商店售價按比例折扣，無條件捨去小數，最低 1 靈石。
 * 買價小於等於 0 視為配置異常，返回 0 由呼叫端拒絕回收。
 */
export function calculateVendorRecycleUnitPrice(shopPrice: number): number {
  const normalizedShopPrice = Math.trunc(Number(shopPrice) || 0);
  if (normalizedShopPrice <= 0) {
    return 0;
  }
  const recycled = Math.floor(normalizedShopPrice * VENDOR_RECYCLE_RATE_PERCENT / 100);
  return Math.max(VENDOR_RECYCLE_MIN_UNIT_PRICE, recycled);
}

export function calculateHeavenlyDaoShopDiscountedPrice(price: number, discountPercent = 0): number {
  const normalizedPrice = Math.max(1, Math.trunc(Number(price) || 0));
  const normalizedDiscount = Math.min(99, Math.max(0, Math.trunc(Number(discountPercent) || 0)));
  if (normalizedDiscount <= 0) {
    return normalizedPrice;
  }
  return Math.max(1, Math.floor(normalizedPrice * (100 - normalizedDiscount) / 100));
}

/** 拍卖上架费基础值 */
export const AUCTION_LISTING_FEE_BASE = 10;

/** 拍卖上架费费率（起拍总价的百分比） */
export const AUCTION_LISTING_FEE_RATE = 0.01;

/** 拍卖最短持续时间（小时） */
export const AUCTION_MIN_DURATION_HOURS = 1;

/** 拍卖最长持续时间（小时） */
export const AUCTION_MAX_DURATION_HOURS = 48;

/** 拍卖默认持续时间（小时） */
export const AUCTION_DEFAULT_DURATION_HOURS = 12;
