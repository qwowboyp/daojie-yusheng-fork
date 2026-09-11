#!/usr/bin/env node
/** 以正式坊市服務驗證後期物品的零掛單目錄、分類、分頁與求購身份；不連資料庫。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { ContentTemplateRepository } = require(path.join(root, 'packages/server/dist/content/content-template.repository.js'));
const { MarketRuntimeService } = require(path.join(root, 'packages/server/dist/runtime/market/market-runtime.service.js'));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const items = [...read('packages/server/data/content/items/後期七境/內容.json'),
  ...read('packages/server/data/content/items/後期七境/功法書.json')];
const icons = read('packages/client/src/constants/world/item-art.generated.json');
const content = new ContentTemplateRepository();
content.loadAll();
const market = new MarketRuntimeService(content);
assert.equal(market.openOrders.length, 0);
const rows = market.buildMarketListingEntries();
const byId = new Map(rows.map(row => [row.itemId, row]));
assert.equal(items.length, 471);
for (const item of items) {
  const row = byId.get(item.itemId);
  assert.ok(row, `零掛單坊市缺少 ${item.itemId}`);
  assert.equal(row.sellQuantity, 0);
  assert.equal(row.buyQuantity, 0);
  const resolved = market.resolveMarketItemForBuy({ itemKey: row.itemKey });
  assert.equal(resolved?.itemId, item.itemId, `求購身份錯誤 ${item.itemId}`);
  if (item.type === 'skill_book') {
    assert.equal(resolved.learnTechniqueId, item.learnTechniqueId);
    // 正式全卷沒有殘卷層數限制；未設定上限時可修至功法本身的最高層。
    assert.equal(resolved.learnTechniqueMaxLevel ?? content.techniqueTemplates.get(item.learnTechniqueId).maxLayer,
      item.learnTechniqueMaxLevel);
    assert.equal(row.itemSubType, content.techniqueTemplates.get(item.learnTechniqueId).category);
  }
  for (const size of [96, 192]) {
    assert.ok(icons[item.itemId], `圖示映射缺少 ${item.itemId}`);
    assert.ok(fs.existsSync(path.join(root, 'packages/client/public', `${icons[item.itemId]}-${size}.webp`)));
  }
}

function collectPages(filter) {
  const found = new Map();
  let page = 1;
  let response;
  do {
    response = market.buildMarketListingsPage({ ...filter, page, pageSize: 40 });
    assert.equal(response.page, page);
    for (const row of response.items) found.set(row.itemId, row);
    page += 1;
  } while ((page - 1) * response.pageSize < response.total);
  return found;
}
for (const type of new Set(items.map(item => item.type))) {
  const found = collectPages({ category: type });
  for (const item of items.filter(item => item.type === type)) {
    assert.ok(found.has(item.itemId), `${type} 分頁缺少 ${item.itemId}`);
  }
}
for (const category of ['internal', 'arts', 'divine', 'secret']) {
  const found = collectPages({ category: 'skill_book', techniqueCategory: category });
  const books = items.filter(item => item.type === 'skill_book'
    && content.techniqueTemplates.get(item.learnTechniqueId).category === category);
  assert.equal(books.length, 14);
  for (const book of books) assert.ok(found.has(book.itemId), `${category} 缺少 ${book.itemId}`);
}
for (const slot of new Set(items.filter(item => item.type === 'equipment').map(item => item.equipSlot))) {
  const found = collectPages({ category: 'equipment', equipmentSlot: slot });
  for (const item of items.filter(item => item.type === 'equipment' && item.equipSlot === slot)) {
    assert.ok(found.has(item.itemId), `${slot} 缺少 ${item.itemId}`);
  }
}
console.log(JSON.stringify({ ok: true, items: items.length, books: 56, iconFiles: items.length * 2,
  zeroOrderCatalog: true, categoriesAndPagination: true, buyIdentity: true, databaseWrites: 0 }));
