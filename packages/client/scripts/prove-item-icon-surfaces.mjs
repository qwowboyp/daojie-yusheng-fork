/**
 * 道具圖片在正式背包／交易面板的 Vite + Chrome 驗收。
 * fixture 只提供服務端原本會下發的資料；DOM、互動與 patch 都走產品程式。
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const ARTIFACT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.codex/item-art-proof');
const SURFACES = ['inventory', 'market', 'auction', 'heavenly', 'spirit-shop', 'recycle'];
const MODES = [
  { id: 'desktop-light', width: 1280, height: 900, mobile: false, colorMode: 'light' },
  { id: 'desktop-dark', width: 1280, height: 900, mobile: false, colorMode: 'dark' },
  { id: 'mobile-375-light', width: 375, height: 812, mobile: true, colorMode: 'light' },
  { id: 'mobile-375-dark', width: 375, height: 812, mobile: true, colorMode: 'dark' },
  { id: 'mobile-390-light', width: 390, height: 844, mobile: true, colorMode: 'light' },
  { id: 'mobile-390-dark', width: 390, height: 844, mobile: true, colorMode: 'dark' },
  { id: 'mobile-landscape-light', width: 844, height: 375, mobile: true, colorMode: 'light' },
  { id: 'mobile-landscape-dark', width: 844, height: 375, mobile: true, colorMode: 'dark' },
];

const mountFixture = String.raw`
  (async () => {
    const { InventoryPanel } = await import('/src/ui/panels/inventory-panel.ts');
    const { MarketPanel } = await import('/src/ui/panels/market-panel.ts');
    const { getItemIconSources } = await import('/src/content/item-art.ts');
    const { getLocalItemTemplate } = await import('/src/content/local-templates.ts');
    document.getElementById('game-shell')?.classList.remove('hidden');
    document.getElementById('login-overlay')?.classList.add('hidden');

    const ids = ['spirit_stone', 'merit', 'pill.minor_heal', 'book.custom_technique', 'equip.copper_building_hammer'];
    const missing = ids.filter((id) => !getItemIconSources(id));
    if (missing.length > 0) throw new Error('proof 圖片映射缺少：' + missing.join(', '));
    const item = (itemId, count, itemInstanceId) => {
      const template = getLocalItemTemplate(itemId);
      if (!template) throw new Error('本機道具目錄缺少：' + itemId);
      return { ...template, itemId, count, itemInstanceId };
    };
    const pill = item('pill.minor_heal', 9, 'proof-pill');
    const book = item('book.custom_technique', 1, 'proof-book');
    const inventory = { capacity: 40, revision: 1, items: [
      item('spirit_stone', 99999, 'proof-spirit-stone'),
      item('merit', 9999, 'proof-merit'), pill, book,
      item('equip.copper_building_hammer', 6, 'proof-hammer'),
    ] };
    const unknown = { itemId: 'proof.unknown.relic', itemInstanceId: 'proof-unknown', name: '未知遺物', desc: '沒有圖片映射仍需保留名稱與卡片格線', type: 'material', count: 3 };
    const listed = (itemKey, entry, sell, buy) => ({ itemKey, item: entry, sellOrderCount: 1, sellQuantity: entry.count, lowestSellPrice: sell, buyOrderCount: 1, buyQuantity: entry.count, highestBuyPrice: buy });
    const marketItems = [listed('pill.minor_heal:proof', pill, 18, 12), listed('proof.unknown.relic:proof', unknown, 27, 20)];
    const marketUpdate = {
      currencyItemId: 'spirit_stone', currencyItemName: '靈石', listedItems: marketItems,
      myOrders: [], storage: { items: [] }, heavenlyDaoShopDiscountPercent: 0,
      spiritStoneShopItems: [{ itemId: 'pill.minor_heal', unitPrice: 25 }],
      vendorRecycleItems: [{ itemId: 'equip.copper_building_hammer', unitRecyclePrice: 11 }],
    };
    const marketListings = {
      currencyItemId: 'spirit_stone', currencyItemName: '靈石', page: 1, pageSize: 20,
      total: marketItems.length, category: 'all', equipmentSlot: 'all', techniqueCategory: 'all',
      counts: { categoryCounts: { all: 2, consumable: 1, material: 1 }, equipmentSlotCounts: {}, techniqueCategoryCounts: {} },
      items: marketItems.map((entry) => ({ itemKey: entry.itemKey, item: entry.item, itemId: entry.item.itemId,
        itemType: entry.item.type, lowestSellPrice: entry.lowestSellPrice, sellOrderCount: 1,
        sellQuantity: entry.item.count, highestBuyPrice: entry.highestBuyPrice, buyOrderCount: 1, buyQuantity: entry.item.count })),
    };
    const now = Date.now();
    const auctionItem = {
      id: 'proof-auction-lot', itemKey: 'book.custom_technique:proof', itemId: 'book.custom_technique',
      itemType: book.type, itemSubType: 'other', enhanceLevel: 0, item: book,
      currentPrice: 120, buyoutPrice: 260, bidCount: 2,
      bids: [{ bidderLabel: '道友甲', unitPrice: 120, createdAtMs: now - 30000 }],
      startAtMs: now, durationSeconds: 7200, status: 'active', statusLabel: '競拍中',
      sellerLabel: '寄拍者', lotNo: '000301', heat: 2, qualityLabel: '功法書', remainingQuantity: 1,
    };
    const auction = (currentPrice = 120, bidCount = 2) => ({
      currencyItemId: 'spirit_stone', currencyItemName: '靈石', tab: 'participate', page: 1,
      pageSize: 10, total: 1, category: 'all', query: '', counts: { categoryCounts: { all: 1, skill_book: 1 } },
      summary: { activeLots: 1, buyoutLots: 1, totalCurrentPrice: currentPrice, myBidCount: 0,
        myConsignments: 0, consigningLots: 0, soldLots: 0, failedLots: 0, storageCount: 0 },
      items: [{ ...auctionItem, currentPrice, bidCount }],
    });

    const inventoryPanel = new InventoryPanel();
    inventoryPanel.setCallbacks(() => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
    inventoryPanel.update(inventory);
    const marketPanel = new MarketPanel();
    marketPanel.setCallbacks({
      onRequestMarket() {}, onRequestListings() {}, onRequestAuctionListings() {}, onRequestTransmissionListings() {},
      onRequestItemBook() {}, onRequestTradeHistory() {}, onCreateSellOrder() {}, onCreateAuctionSellOrder() {},
      onCreateBuyOrder() {}, onPlaceAuctionBid() {}, onBuyoutAuctionLot() {}, onBuyTransmissionLot() {},
      onCreateTransmissionSellOrder() {}, onBuyHeavenlyDaoShopItem() {}, onBuySpiritStoneShopItem() {},
      onVendorRecycleItem() {}, onCancelOrder() {}, onClaimStorage() {},
    });
    marketPanel.syncInventory(inventory);
    marketPanel.updateMarket(marketUpdate);
    marketPanel.updateListings(marketListings);
    marketPanel.updateAuctionListings(auction());
    window.__itemArtProof = { inventoryPanel, marketPanel, inventory, marketUpdate, marketListings, auction, getItemIconSources };
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { reactInventory: Boolean(document.querySelector('#pane-inventory [data-react-panel="inventory"]')),
      reactMarket: Boolean(document.querySelector('#pane-market [data-react-panel="market"]')),
      unknownMapped: getItemIconSources(unknown.itemId) !== null };
  })()
`;

const configureMode = (mode) => String.raw`
  (async () => {
    const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts');
    updateUiColorMode(${JSON.stringify(mode.colorMode)});
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { mode: document.documentElement.dataset.colorMode, scheme: document.documentElement.style.colorScheme };
  })()
`;

const openSurface = (surface) => String.raw`
  (async () => {
    const modal = document.getElementById('detail-modal');
    const close = document.getElementById('detail-modal-close');
    if (modal instanceof HTMLElement && !modal.classList.contains('hidden')) {
      if (close instanceof HTMLElement) close.click(); else modal.click();
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (${JSON.stringify(surface)} === 'inventory') {
      const launcher = document.querySelector('#game-dock [data-workspace-open="items"]');
      if (!(launcher instanceof HTMLButtonElement)) throw new Error('正式背包 workspace 入口不存在');
      launcher.click();
      window.__itemArtProof.inventoryPanel.update(window.__itemArtProof.inventory);
      for (let index = 0; index < 12 && !document.querySelector('#pane-inventory [data-open-item]'); index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const back = document.querySelector('#pane-inventory .inventory-workspace-detail-back');
      if (back instanceof HTMLButtonElement && back.getClientRects().length > 0) {
        back.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const first = document.querySelector('#pane-inventory [data-open-item]');
      if (!(first instanceof HTMLElement)) throw new Error('正式 React 背包沒有產生道具格');
    } else {
      const menuToggle = document.getElementById('workspace-menu-toggle');
      if (!(menuToggle instanceof HTMLButtonElement)) throw new Error('正式 workspace 全部功能入口不存在');
      if (document.getElementById('workspace-menu')?.hidden) menuToggle.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const launcher = document.querySelector('#game-dock [data-workspace-open="market"]');
      if (!(launcher instanceof HTMLButtonElement)) throw new Error('正式坊市 workspace 入口不存在');
      launcher.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const labels = { market: '坊市', auction: '拍賣行', heavenly: '天道商店', 'spirit-shop': '靈石商店', recycle: '回收商' };
      const wanted = labels[${JSON.stringify(surface)}];
      const button = [...document.querySelectorAll('[data-react-panel="market"] button')].find((entry) => entry.textContent?.trim() === wanted);
      if (!(button instanceof HTMLButtonElement)) throw new Error('正式市場入口不存在：' + wanted);
      button.click();
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.querySelector('.guided-tour-layer')?.classList.add('hidden');
    return { title: document.getElementById('detail-modal-title')?.textContent?.trim() ?? '背包',
      modalOpen: !document.getElementById('detail-modal')?.classList.contains('hidden') };
  })()
`;

const measureSurface = (surface) => String.raw`
  (async () => {
    const key = ${JSON.stringify(surface)};
    const selectors = {
      inventory: ['#pane-inventory [data-react-panel="inventory"]', '[data-inventory-grid="true"]', '.inventory-workspace-detail'],
      market: ['#detail-modal-body', '.market-board-list', '.market-book-panel'],
      auction: ['#detail-modal-body', '.auction-list', '[data-auction-detail-panel]'],
      heavenly: ['#detail-modal-body', '[data-heavenly-dao-shop-list="true"]', '[data-heavenly-dao-shop-detail="true"]'],
      'spirit-shop': ['#detail-modal-body', '[data-spirit-stone-shop-list="true"]', '[data-spirit-stone-shop-detail="true"]'],
      recycle: ['#detail-modal-body', '[data-vendor-recycle-list="true"]', '[data-vendor-recycle-detail="true"]'],
    }[key];
    const root = document.querySelector(selectors[0]);
    const list = root?.querySelector(selectors[1]);
    const detail = root?.querySelector(selectors[2]);
    if (!(root instanceof HTMLElement) || !(list instanceof HTMLElement) || !(detail instanceof HTMLElement)) throw new Error(key + ' 正式列表或詳情沒有掛載');
    const images = [...root.querySelectorAll('img.item-art')].filter((img) => img.getClientRects().length > 0);
    await Promise.all(images.map((img) => img.decode()));
    const compactArt = matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)').matches;
    const expected = compactArt ? { list: 40, detail: 64 } : { list: 48, detail: 80 };
    const imageMetrics = images.map((img) => { const rect = img.getBoundingClientRect(); const target = img.classList.contains('item-art--detail') ? expected.detail : expected.list;
      return { src: img.currentSrc, naturalWidth: img.naturalWidth, width: rect.width, height: rect.height, target,
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; });
    const listImages = [...list.querySelectorAll('img.item-art')].filter((img) => img.getClientRects().length > 0);
    const detailImages = [...detail.querySelectorAll('img.item-art--detail')].filter((img) => img.getClientRects().length > 0);
    const obstacles = [...root.querySelectorAll(['[data-item-name="true"]', '.market-item-cell-name', '.market-item-cell-prices',
      '.market-item-title', '.market-book-subtitle', '.auction-detail-title', '.auction-price-grid',
      '.auction-bid-actions', 'input', 'button'].join(','))].filter((node) => node instanceof HTMLElement && node.getClientRects().length > 0);
    const visibleRect = (node) => {
      const box = node.getBoundingClientRect(); let left = box.left; let top = box.top; let right = box.right; let bottom = box.bottom;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent); const clipX = style.overflowX !== 'visible'; const clipY = style.overflowY !== 'visible';
        if (!clipX && !clipY) continue; const clip = parent.getBoundingClientRect();
        if (clipX) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
        if (clipY) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      }
      left = Math.max(left, 0); top = Math.max(top, 0); right = Math.min(right, innerWidth); bottom = Math.min(bottom, innerHeight);
      return right > left && bottom > top ? { left, top, right, bottom } : null;
    };
    const clippedImages = images.flatMap((img) => {
      const owner = img.closest('.market-item-cell, .inventory-cell, .auction-lot-item, .auction-detail-head, .market-book-header');
      if (!(owner instanceof HTMLElement)) return [];
      const style = getComputedStyle(owner); const box = img.getBoundingClientRect(); const clip = owner.getBoundingClientRect();
      const clipX = ['hidden', 'clip'].includes(style.overflowX); const clipY = ['hidden', 'clip'].includes(style.overflowY);
      const clipped = (clipX && (box.left < clip.left - 1.5 || box.right > clip.right + 1.5))
        || (clipY && (box.top < clip.top - 1.5 || box.bottom > clip.bottom + 1.5));
      return clipped ? [{ src: img.currentSrc, imageRect: box.toJSON(), clipRect: clip.toJSON(), owner: owner.className }] : [];
    });
    const overlaps = [];
    for (const img of images) { const a = visibleRect(img); if (!a) continue; for (const node of obstacles) {
      if (node.contains(img) || img.contains(node)) continue; const b = visibleRect(node); if (!b) continue;
      if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) overlaps.push({ image: img.currentSrc, obstacle: node.className || node.tagName,
        imageRect: { left: a.left, top: a.top, right: a.right, bottom: a.bottom }, obstacleRect: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } });
    } }
    const overflow = root.scrollWidth > root.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1;
    let unknown = null;
    if (key === 'market') {
      const cells = [...root.querySelectorAll('.market-item-cell')];
      const unknownCell = cells.find((cell) => cell.textContent?.includes('未知遺物'));
      const knownCell = cells.find((cell) => cell.querySelector('img.item-art'));
      const unknownName = unknownCell?.querySelector('.market-item-cell-name'); const knownName = knownCell?.querySelector('.market-item-cell-name');
      const unknownCellRect = unknownCell?.getBoundingClientRect(); const knownCellRect = knownCell?.getBoundingClientRect();
      unknown = { name: unknownName?.textContent?.trim() ?? '', hasImage: Boolean(unknownCell?.querySelector('img')),
        mapped: window.__itemArtProof.getItemIconSources('proof.unknown.relic') !== null,
        unknownGrid: unknownCell ? getComputedStyle(unknownCell).gridTemplateColumns : '',
        knownGrid: knownCell ? getComputedStyle(knownCell).gridTemplateColumns : '',
        nameOffsetDelta: Math.abs(((unknownName?.getBoundingClientRect().left ?? 0) - (unknownCellRect?.left ?? 0))
          - ((knownName?.getBoundingClientRect().left ?? 0) - (knownCellRect?.left ?? 0))) };
    }
    const sideTab = root.querySelector('.market-side-tab'); const sideTabs = sideTab?.parentElement;
    return { imageMetrics, listImages: listImages.length, detailImages: detailImages.length, clippedImages, overlaps, overflow, unknown,
      debug: { rootDisplay: getComputedStyle(root).display, rootRect: root.getBoundingClientRect().toJSON(),
        paneClass: document.getElementById('pane-inventory')?.className, totalImages: root.querySelectorAll('img.item-art').length,
        listDisplay: getComputedStyle(list).display, detailDisplay: getComputedStyle(detail).display,
        listRect: list.getBoundingClientRect().toJSON(), detailRect: detail.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight },
        sideTab: sideTab ? { rect: sideTab.getBoundingClientRect().toJSON(), width: getComputedStyle(sideTab).width, minWidth: getComputedStyle(sideTab).minWidth } : null,
        sideTabs: sideTabs ? { rect: sideTabs.getBoundingClientRect().toJSON(), width: getComputedStyle(sideTabs).width } : null } };
  })()
`;

const verifyQuantityPatch = String.raw`
  (() => {
    const input = document.querySelector('[data-spirit-stone-shop-quantity="pill.minor_heal"]');
    const detail = document.querySelector('[data-spirit-stone-shop-detail="true"]');
    if (!(input instanceof HTMLInputElement) || !(detail instanceof HTMLElement)) throw new Error('靈石商店正式數量欄位不存在');
    const image = detail.querySelector('img.item-art--detail'); const total = detail.querySelector('[data-spirit-stone-shop-total="pill.minor_heal"]');
    input.focus(); input.value = '3'; input.dispatchEvent(new Event('input', { bubbles: true }));
    return { sameImage: image === detail.querySelector('img.item-art--detail'), focused: document.activeElement === input,
      value: input.value, total: total?.textContent?.trim() ?? '' };
  })()
`;

const verifyAuctionPatch = String.raw`
  (() => {
    const proof = window.__itemArtProof; const input = document.querySelector('[data-auction-search]'); const detail = document.querySelector('[data-auction-detail-panel]');
    if (!(input instanceof HTMLInputElement) || !(detail instanceof HTMLElement)) throw new Error('拍賣行正式行情欄位不存在');
    const image = detail.querySelector('img.item-art--detail'); input.focus(); input.value = '功法'; input.setSelectionRange(2, 2);
    proof.marketPanel.updateAuctionListings(proof.auction(188, 3));
    return { sameImage: image === detail.querySelector('img.item-art--detail'), focused: document.activeElement === input,
      value: input.value, selectionStart: input.selectionStart,
      price: detail.querySelector('[data-auction-detail-current-price]')?.textContent?.trim() ?? '',
      bidCount: detail.querySelector('[data-auction-detail-bid-count]')?.textContent?.trim() ?? '' };
  })()
`;

const revealSurfacePart = (surface, part) => String.raw`
  (async () => {
    const selectors = {
      inventory: ['[data-inventory-grid="true"]', '.inventory-workspace-detail'],
      market: ['.market-board-list', '.market-book-panel'],
      auction: ['.auction-list', '[data-auction-detail-panel]'],
      heavenly: ['[data-heavenly-dao-shop-list="true"]', '[data-heavenly-dao-shop-detail="true"]'],
      'spirit-shop': ['[data-spirit-stone-shop-list="true"]', '[data-spirit-stone-shop-detail="true"]'],
      recycle: ['[data-vendor-recycle-list="true"]', '[data-vendor-recycle-detail="true"]'],
    }[${JSON.stringify(surface)}];
    const container = document.querySelector(selectors[${part === 'list' ? 0 : 1}]);
    const image = container?.querySelector('img.item-art${part === 'detail' ? '--detail' : ''}');
    if (!(image instanceof HTMLImageElement)) throw new Error('${surface}/${part} 沒有正式圖片可捲入視窗');
    await image.decode(); image.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = image.getBoundingClientRect();
    return rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
  })()
`;

function assertSurface(result, label, required = 'both') {
  if ((required !== 'detail' && result.listImages < 1) || (required !== 'list' && result.detailImages < 1)) console.error('ITEM_ART_PROOF_MEASURE', label, result);
  if (result.clippedImages.length > 0) console.error('ITEM_ART_PROOF_CLIPPED', label, result.clippedImages);
  if (result.overlaps.length > 0) console.error('ITEM_ART_PROOF_OVERLAP', label, result.debug);
  if (result.unknown && (result.unknown.unknownGrid !== result.unknown.knownGrid || result.unknown.nameOffsetDelta > 1)) console.error('ITEM_ART_PROOF_UNKNOWN', label, result.unknown);
  if (required !== 'detail') assert(result.listImages >= 1, `${label}正式列表沒有圖片`);
  if (required !== 'list') assert(result.detailImages >= 1, `${label}正式詳情沒有圖片`);
  for (const image of result.imageMetrics) {
    assert(image.naturalWidth > 0, `${label}圖片 decode 後仍沒有像素`);
    assert(Math.abs(image.width - image.target) <= 1 && Math.abs(image.height - image.target) <= 1, `${label}圖片尺寸 ${image.width}x${image.height}，預期 ${image.target}`);
  }
  assert.deepEqual(result.clippedImages, [], `${label}圖片被 overflow/clip 祖先裁切`);
  assert.deepEqual(result.overlaps, [], `${label}圖片遮住名稱、價格、輸入或按鈕`);
  assert.equal(result.overflow, false, `${label}出現水平溢出`);
  if (result.unknown) {
    assert.equal(result.unknown.name, '未知遺物', `${label}未知道具名稱遺失`);
    assert.equal(result.unknown.hasImage, false, `${label}未知道具仍建立 img 請求節點`);
    assert.equal(result.unknown.mapped, false, `${label}未知道具不應有圖片 URL`);
    assert.equal(result.unknown.unknownGrid, result.unknown.knownGrid, `${label}未知 ID 卡片格線變窄`);
    assert(result.unknown.nameOffsetDelta <= 1, `${label}未知 ID 缺圖後名稱掉進圖示欄`);
  }
}

async function capture(cdp, name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(ARTIFACT_DIR, `${name}.png`), Buffer.from(result.data, 'base64'));
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let screenshotCount = 0;
await withClientBrowserProof({ viewport: { width: 1280, height: 900 }, profilePrefix: 'item-art-real-surfaces-' }, async (cdp) => {
  assert.deepEqual(await cdp.evaluate(mountFixture), { reactInventory: true, reactMarket: true, unknownMapped: false }, '未沿正式 React provider 掛載');
  for (const mode of MODES) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.mobile, screenWidth: mode.width, screenHeight: mode.height });
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: mode.mobile ? 5 : 1,
      configuration: mode.mobile ? 'mobile' : 'desktop',
    });
    const theme = await cdp.evaluate(configureMode(mode));
    assert.equal(theme.mode, mode.colorMode, `${mode.id} 正式主題屬性未切換`);
    assert.equal(theme.scheme, mode.colorMode, `${mode.id} color-scheme 未同步`);
    await delay(80);
    for (const surface of SURFACES) {
      const opened = await cdp.evaluate(openSurface(surface));
      assert(surface === 'inventory' || opened.modalOpen, `${mode.id}/${surface} 正式彈層未開啟`);
      if (surface === 'inventory') {
        assertSurface(await cdp.evaluate(measureSurface(surface)), `${mode.id}/${surface}/list`, 'list');
        if (mode.mobile) {
          assert.equal(await cdp.evaluate(revealSurfacePart(surface, 'list')), true, `${mode.id}/${surface}列表圖片未進入視窗`);
          await capture(cdp, `${mode.id}-${surface}-list`); screenshotCount += 1;
        }
        await cdp.evaluate(`(() => { const first = document.querySelector('#pane-inventory [data-open-item]'); if (!(first instanceof HTMLElement)) throw new Error('正式背包道具格消失'); first.click(); })()`);
        await delay(32);
        assertSurface(await cdp.evaluate(measureSurface(surface)), `${mode.id}/${surface}/detail`, 'detail');
      } else {
        assertSurface(await cdp.evaluate(measureSurface(surface)), `${mode.id}/${surface}`);
        if (mode.mobile) {
          assert.equal(await cdp.evaluate(revealSurfacePart(surface, 'list')), true, `${mode.id}/${surface}列表圖片未進入視窗`);
          await capture(cdp, `${mode.id}-${surface}-list`); screenshotCount += 1;
        }
      }
      if (mode.mobile) {
        assert.equal(await cdp.evaluate(revealSurfacePart(surface, 'detail')), true, `${mode.id}/${surface}詳情圖片未進入視窗`);
      }
      await capture(cdp, `${mode.id}-${surface}`); screenshotCount += 1;
      if (surface === 'spirit-shop') {
        const patched = await cdp.evaluate(verifyQuantityPatch);
        assert.deepEqual(patched, { sameImage: true, focused: true, value: '3', total: '75 靈石' }, `${mode.id}正式數量 patch 改建圖片或遺失焦點`);
      }
      if (surface === 'auction') {
        const patched = await cdp.evaluate(verifyAuctionPatch);
        assert.equal(patched.sameImage, true, `${mode.id}正式行情 patch 重建詳情圖片`);
        assert.equal(patched.focused, true, `${mode.id}正式行情 patch 遺失搜尋焦點`);
        assert.equal(patched.value, '功法', `${mode.id}正式行情 patch 遺失輸入值`);
        assert.equal(patched.selectionStart, 2, `${mode.id}正式行情 patch 遺失選區`);
        assert.equal(patched.price, '188', `${mode.id}正式行情價格沒有局部更新`);
        assert.equal(patched.bidCount, '3 次出價', `${mode.id}正式行情次數沒有局部更新`);
      }
    }
  }
});

  console.log(`ITEM_ICON_SURFACES_PROOF:PASS screenshots=${screenshotCount} dir=${ARTIFACT_DIR}`);
