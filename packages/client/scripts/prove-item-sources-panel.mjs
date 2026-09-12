/** 正式坊市／背包入口、完整途徑、觸控與返回狀態的瀏覽器驗證。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

const output = process.env.ITEM_SOURCES_PROOF_OUTPUT_DIR;
const viewports = [
  { name: 'desktop', width: 1280, height: 900, touch: false },
  { name: 'portrait', width: 390, height: 844, touch: true },
  { name: 'landscape', width: 844, height: 390, touch: true },
];
const paint = `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`;

async function click(cdp, selector, touch = false) {
  const point = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('找不到操作入口：' + ${JSON.stringify(selector)});
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  await cdp.evaluate(`(async () => { await ${paint}; })()`);
}

await withClientBrowserProof({ viewport: viewports[0], profilePrefix: 'item-sources-' }, async (cdp) => {
  await cdp.evaluate(`(async () => {
    const { GUIDED_TOUR_FLOWS } = await import('/src/constants/ui/guided-tour.ts');
    localStorage.setItem('mud:guided-tour:v1', JSON.stringify({ completed: {}, dismissed: Object.fromEntries(GUIDED_TOUR_FLOWS.map(flow => [flow.id, flow.storageVersion])) }));
    location.reload();
  })()`);
  await waitFor(() => cdp.evaluate(`document.readyState === 'complete' && document.getElementById('game-shell')?.dataset.workspaceMode === 'true'`), '正式工作區初始化');
  await cdp.evaluate(`(async () => {
    document.getElementById('game-shell').classList.remove('hidden');
    document.getElementById('login-overlay').classList.add('hidden');
    const { LOCAL_EDITOR_CATALOG } = await import('/src/content/editor-catalog.ts');
    const sources = await import('/src/content/item-sources.ts');
    await sources.preloadItemSourceCatalog();
    const { getItemIconSources } = await import('/src/content/item-art.ts');
    const icon = getItemIconSources('pill.breakmirror_pellet');
    const revision = new URL(icon.src, location.origin).searchParams.get('v');
    if (!revision || !icon.srcSet.includes('-192.webp?v=' + revision + ' 192w')) throw new Error('道具圖片缺少一致的版本快取參數');
    const { MarketPanel } = await import('/src/ui/panels/market-panel.ts');
    const { InventoryPanel } = await import('/src/ui/panels/inventory-panel.ts');
    const pill = { ...LOCAL_EDITOR_CATALOG.items.find(item => item.itemId === 'pill.breakmirror_pellet'), count: 1, itemInstanceId: 'source-proof-pill' };
    const inventory = { capacity: 40, revision: 1, items: [pill] };
    const panel = new MarketPanel();
    panel.setCallbacks(new Proxy({}, { get: () => () => {} }));
    panel.syncInventory(inventory);
    const itemKey = pill.itemId + ':proof';
    panel.updateMarket({ currencyItemId: 'spirit_stone', currencyItemName: '靈石', listedItems: [
      { itemKey, item: pill, sellOrderCount: 0, sellQuantity: 0, buyOrderCount: 0, buyQuantity: 0 }
    ], myOrders: [], storage: { items: [] }, heavenlyDaoShopDiscountPercent: 0, spiritStoneShopItems: [], vendorRecycleItems: [] });
    panel.updateListings({ currencyItemId: 'spirit_stone', currencyItemName: '靈石', page: 1, pageSize: 20, total: 1,
      category: 'all', equipmentSlot: 'all', techniqueCategory: 'all',
      counts: { categoryCounts: { all: 1, consumable: 1 }, equipmentSlotCounts: {}, techniqueCategoryCounts: {} },
      items: [{ itemKey, item: pill, itemId: pill.itemId, itemType: pill.type, sellOrderCount: 0, sellQuantity: 0, buyOrderCount: 0, buyQuantity: 0 }] });
    const bag = new InventoryPanel();
    bag.setCallbacks(() => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
    bag.update(inventory);
    panel.openMarketFromPane();
    await ${paint};
    window.__sourcesProof = { panel, bag, pill, sources };
    return true;
  })()`);
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('#detail-modal-body [data-item-source-open]'))`), '坊市來源入口');

  for (const viewport of viewports) {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.touch, maxTouchPoints: 5 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, screenWidth: viewport.width, screenHeight: viewport.height, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['light', 'dark']) {
      await cdp.evaluate(`(async () => {
        const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts'); updateUiColorMode('${theme}');
        await ${paint};
        window.__sourcesProof.marketNode = document.querySelector('.market-market-tab');
        window.__sourcesProof.selected = window.__sourcesProof.panel.selectedItemKey;
      })()`);
      await click(cdp, '#detail-modal-body [data-item-source-open]', viewport.touch);
      await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.item-sources-detail h2'))`), '百科物品詳情').catch(async (error) => {
        console.error(await cdp.evaluate(`({ dialog: document.querySelector('[data-item-sources-dialog]')?.outerHTML.slice(0,1200), button: document.querySelector('[data-item-source-open]')?.outerHTML, modal: document.getElementById('detail-modal')?.className })`));
        if (output) { const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'failure.png'), Buffer.from(shot.data, 'base64')); }
        throw error;
      });
      const detail = await cdp.evaluate(`(() => {
        const dialog = document.querySelector('[data-item-sources-dialog]');
        const r = dialog.getBoundingClientRect();
        const detail = dialog.querySelector('.item-sources-detail');
        return { open: dialog.open, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
          overflow: dialog.scrollWidth > dialog.clientWidth + 1,
          rows: detail.querySelectorAll('li').length, expected: window.__sourcesProof.sources.getItemSourceEntries('pill.breakmirror_pellet').length,
          title: detail.querySelector('h2').textContent, viewportHeight: detail.clientHeight,
          goHeight: detail.querySelector('[data-item-source-go]').getBoundingClientRect().height,
          closeHeight: dialog.querySelector('[data-item-sources-close]').getBoundingClientRect().height };
      })()`);
      assert.equal(detail.open, true);
      assert.equal(detail.title, '破鏡丹');
      assert(detail.expected > 3);
      assert.equal(detail.rows, detail.expected, '第 4 條以後仍被截斷');
      assert.equal(detail.overflow, false);
      assert(detail.left >= -1 && detail.top >= -1 && detail.right <= viewport.width + 1 && detail.bottom <= viewport.height + 1, `${viewport.name}/${theme} 視窗越界`);
      assert(detail.viewportHeight >= 100, '詳情沒有可讀空間');
      assert(detail.closeHeight >= 44, '返回按鈕觸控高度不足');
      assert(detail.goHeight >= 44, '前往按鈕觸控高度不足');
      await cdp.evaluate(`(() => { const el = document.querySelector('.item-sources-detail'); el.scrollTop = el.scrollHeight; })()`);
      assert.equal(await cdp.evaluate(`(() => { const el = document.querySelector('.item-sources-detail'); const last = el.querySelector('li:last-child'); const a = el.getBoundingClientRect(), b = last.getBoundingClientRect(); return b.bottom <= a.bottom + 1; })()`), true, '最後一條無法捲動閱讀');
      if (output) {
        await mkdir(output, { recursive: true });
        await cdp.evaluate(`(async () => { document.querySelector('.item-sources-detail').scrollTop = 0; await ${paint}; })()`);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await writeFile(path.join(output, `${viewport.name}-${theme}.png`), Buffer.from(shot.data, 'base64'));
      }
      await click(cdp, '[data-item-sources-close]', viewport.touch);
      await waitFor(() => cdp.evaluate(`!document.querySelector('[data-item-sources-dialog]').open`), '關閉百科');
      assert.equal(await cdp.evaluate(`!document.getElementById('detail-modal').classList.contains('hidden') && window.__sourcesProof.marketNode === document.querySelector('.market-market-tab') && window.__sourcesProof.selected === window.__sourcesProof.panel.selectedItemKey`), true, '返回後坊市內容被重建或選項遺失');
    }
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.evaluate(`(async () => { await ${paint}; })()`);
  await click(cdp, '#detail-modal-body [data-item-source-open]');
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('[data-item-sources-search]'))`), '百科搜尋');
  await click(cdp, '[data-item-sources-search]');
  await cdp.send('Input.insertText', { text: '功德月卡' });
  await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-item-sources-item]').length === 1`), '未持有物品搜尋');
  await click(cdp, '[data-item-sources-item="merit_month_card"]');
  assert.match(await cdp.evaluate(`document.querySelector('.item-sources-detail').textContent`), /尚未收錄取得途徑/);
  const filter = await cdp.evaluate(`(async () => {
    const search = document.querySelector('[data-item-sources-search]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, '');
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const kind = document.querySelector('[data-item-sources-kind-filter]'); kind.value = 'shop'; kind.dispatchEvent(new Event('change', { bubbles: true }));
    const map = document.querySelector('[data-item-sources-map-filter]'); map.value = 'yunlai_town'; map.dispatchEvent(new Event('change', { bubbles: true }));
    await ${paint};
    const { LOCAL_EDITOR_CATALOG } = await import('/src/content/editor-catalog.ts');
    const expected = LOCAL_EDITOR_CATALOG.items.filter(item => item.itemId !== 'mat.technique_unification_test' && window.__sourcesProof.sources.getItemSourceEntries(item.itemId).some(entry => entry.kind === 'shop' && entry.mapId === 'yunlai_town')).length;
    return { count: document.querySelector('[data-item-sources-match-count]').textContent, expected };
  })()`);
  assert.equal(filter.count, `符合 ${filter.expected} 項`, '來源方式與地圖必須命中同一條來源');
  await cdp.evaluate(`(async () => {
    const { KeyboardInput } = await import('/src/input/keyboard.ts');
    window.__sourcesProof.moves = 0;
    window.__sourcesProof.keyboard = new KeyboardInput(() => window.__sourcesProof.moves++);
    document.querySelector('[data-item-sources-close]').focus();
  })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  assert.equal(await cdp.evaluate(`window.__sourcesProof.moves`), 0, '百科按鍵誤觸遊戲移動');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(() => cdp.evaluate(`!document.querySelector('[data-item-sources-dialog]').open`), 'Escape 關閉百科');
  assert.equal(await cdp.evaluate(`!document.getElementById('detail-modal').classList.contains('hidden')`), true, 'Escape 同時關閉坊市');

  // 正式背包詳情共用入口；零掛單坊市與持有物品都能直達同一資料。
  await cdp.evaluate(`window.__sourcesProof.bag.openReactItemDetail(0, window.__sourcesProof.bag.getItemIdentity(window.__sourcesProof.pill))`);
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.inventory-source-section [data-item-source-open]'))`), '背包來源入口');
  await click(cdp, '.inventory-source-section [data-item-source-open]');
  await waitFor(() => cdp.evaluate(`document.querySelector('.item-sources-detail h2')?.textContent === '破鏡丹'`), '背包直達重設不匹配搜尋');
  assert.equal(await cdp.evaluate(`document.querySelector('[data-item-sources-search]').value`), '');
  assert.equal(await cdp.evaluate(`(async () => {
    const panel = await import('/src/react-ui/panels/item-sources/mount-item-sources-panel.tsx');
    panel.closeItemSourcesPanel(); panel.openItemSourcesPanel({ itemId: 'pill.breakmirror_pellet' });
    await ${paint}; await ${paint};
    window.__sourcesProof.keyboard.destroy();
    return document.querySelector('[data-item-sources-dialog]').open && Boolean(document.querySelector('.item-sources-detail h2'));
  })()`), true, '快速重新開啟被上一輪 close 事件清空');
  // 真實導航狀態源與發包器，攔截最末端傳輸；不建立玩家或寫入資料庫。
  await cdp.evaluate(`(async () => {
    const bridge = await import('/src/ui/item-source-navigation.ts');
    const { createMainNavigationStateSource } = await import('/src/main-navigation-state-source.ts');
    const { createSocketRuntimeSender } = await import('/src/network/socket-send-runtime.ts');
    const state = window.__sourcesProof;
    state.sent = []; state.ready = false; state.playerMap = 'proof-other-map';
    const sender = createSocketRuntimeSender({ isConnected: () => true, emitEvent: (event, payload) => state.sent.push({ event, payload }) });
    const navigation = createMainNavigationStateSource({
      getPlayer: () => ({ id: 'proof', x: 0, y: 0, mapId: state.playerMap }),
      getMapMeta: () => null, getLatestEntities: () => [],
      setRuntimePathCells: () => {}, sendMoveTo: (x, y, options) => sender.sendMoveTo(x, y, options),
    });
    bridge.setItemSourceNavigationHandler(bridge.createItemSourceNavigationHandler({
      isReady: () => state.ready,
      planPathTo: (target, options) => navigation.planPathTo(target, options),
      navigateToQuest: (id) => sender.sendNavigateQuest(id),
    }));
    state.bridge = bridge;
  })()`);
  await click(cdp, '[data-item-source-go="monster_drop"]');
  assert.equal(await cdp.evaluate(`window.__sourcesProof.sent.length`), 0, '離線時不得送出導航');
  assert.equal(await cdp.evaluate(`document.querySelector('[data-item-sources-dialog]').open && Boolean(document.querySelector('.item-sources-route-status[role="alert"]'))`), true, '未連線應保留百科並說明原因');
  for (const kind of ['monster_drop', 'shop', 'mining', 'search', 'quest']) {
    for (const sameMap of kind === 'monster_drop' ? [false, true] : [false]) {
      const expected = await cdp.evaluate(`(async () => {
        const state = window.__sourcesProof;
        const { LOCAL_EDITOR_CATALOG } = await import('/src/content/editor-catalog.ts');
        const { resolveItemSourceNavigation } = await import('/src/content/item-source-navigation.ts');
        const item = LOCAL_EDITOR_CATALOG.items.find(item => state.sources.getItemSourceEntries(item.itemId).some(entry => entry.kind === '${kind}' && resolveItemSourceNavigation(entry).kind !== 'unavailable'));
        const entry = state.sources.getItemSourceEntries(item.itemId).find(entry => entry.kind === '${kind}' && resolveItemSourceNavigation(entry).kind !== 'unavailable');
        state.ready = true; state.sent = []; state.playerMap = ${sameMap} ? entry.mapId : 'proof-other-map';
        const panel = await import('/src/react-ui/panels/item-sources/mount-item-sources-panel.tsx');
        panel.closeItemSourcesPanel(); panel.openItemSourcesPanel({ itemId: item.itemId });
        await ${paint}; await ${paint};
        return resolveItemSourceNavigation(entry);
      })()`);
      await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('[data-item-source-go="${kind}"]:not(:disabled)'))`), '可導航來源按鈕');
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await click(cdp, `[data-item-source-go="${kind}"]:not(:disabled)`, true);
      const result = await cdp.evaluate(`({ sent: window.__sourcesProof.sent, open: document.querySelector('[data-item-sources-dialog]').open })`);
      assert.equal(result.sent.length, 1, '每次點擊只送一個導航意圖');
      assert.equal(result.open, false, '提出導航後應關閉百科');
      if (kind === 'quest') assert.equal(result.sent[0].payload.questId, expected.questId);
      else {
        assert.equal(result.sent[0].payload.x, expected.x);
        assert.equal(result.sent[0].payload.y, expected.y);
        assert.equal(result.sent[0].payload.targetMapId, sameMap ? undefined : expected.mapId);
        assert.equal(result.sent[0].payload.ignoreVisibilityLimit, true);
        assert.equal(result.sent[0].payload.allowNearestReachable, true);
      }
    }
  }
  assert.equal(await cdp.evaluate(`(async () => {
    const state = window.__sourcesProof;
    const entry = state.sources.getItemSourceEntries('spirit_stone').find(entry => entry.kind === 'acquisition_rule');
    state.sent = [];
    return Boolean(state.bridge.navigateToItemSource(entry)) && state.sent.length === 0;
  })()`), true, '通用來源不可發送虛構座標');
  await cdp.evaluate(`(async () => {
    const { loadItemSourcePanelData } = await import('/src/react-ui/panels/item-sources/model.ts');
    const { reactUiBridge } = await import('/src/react-ui/bridge/react-ui-bridge.ts');
    const data = await loadItemSourcePanelData();
    const books = data.items.filter(item => item.techniqueId && item.techniqueLabel);
    const book = books.find(item => data.entriesByItemId.get(item.itemId).some(entry => entry.mapLv));
    window.__sourcesProof.book = book;
    window.__sourcesProof.books = books;
    window.__sourcesProof.reactUiBridge = reactUiBridge;
    reactUiBridge.syncTechniques([{ techId: book.techniqueId }], undefined);
    const panel = await import('/src/react-ui/panels/item-sources/mount-item-sources-panel.tsx');
    panel.openItemSourcesPanel({ itemId: book.itemId });
  })()`);
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.item-sources-detail .item-sources-learned'))`), '已學功法詳情標記');
  assert.equal(await cdp.evaluate(`document.querySelector('.item-sources-technique-realm').textContent === window.__sourcesProof.book.techniqueLabel`), true, '顯示模板品階與境界等級');
  assert.match(await cdp.evaluate(`document.querySelector('.item-sources-map-realm').textContent`), /地圖 Lv\.\d+ · 推薦境界 .+ Lv\.\d+/, '掉落地圖顯示等級及推薦境界');
  for (const viewport of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate(`(async () => { await ${paint}; })()`);
    const bounds = await cdp.evaluate(`(() => {
      const realm = document.querySelector('.item-sources-technique-realm');
      const map = document.querySelector('.item-sources-map-realm');
      return [realm, map].every(el => el.getBoundingClientRect().width > 0 && el.scrollWidth <= el.clientWidth + 1);
    })()`);
    assert.equal(bounds, true, viewport.name + ' 功法與地圖境界不得水平截字');
    if (output) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(output, viewport.name + '-technique.png'), Buffer.from(shot.data, 'base64'));
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.evaluate(`(async () => {
    const input = document.querySelector('[data-item-sources-search]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, window.__sourcesProof.book.name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await ${paint};
  })()`);
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector('.item-sources-item .item-sources-learned'))`), '清單已學標記');
  await click(cdp, '[data-item-sources-unlearned]');
  assert.equal(await cdp.evaluate(`document.querySelectorAll('[data-item-sources-item]').length`), 0, '只看未學排除已學功法');
  await cdp.evaluate(`window.__sourcesProof.reactUiBridge.syncTechniques([], undefined)`);
  await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-item-sources-item]').length === 1`), '學習狀態更新同步篩選');
  assert.equal(await cdp.evaluate(`document.querySelector('[data-item-sources-search]').value === window.__sourcesProof.book.name`), true, '狀態更新保留搜尋');
  await cdp.evaluate(`window.__sourcesProof.reactUiBridge.reset()`);
  assert.equal(await cdp.evaluate(`document.querySelectorAll('.item-sources-learned').length`), 0, '登出清除已學狀態');

  assert.deepEqual(await cdp.evaluate(`(async () => {
    const { createMainNoticeStateSource } = await import('/src/main-notice-state-source.ts');
    const messages = [], toasts = [], acknowledgements = [];
    const source = createMainNoticeStateSource({
      chatUI: { addMessage: async (...args) => { messages.push(args); return true; } },
      ackSystemMessages: ids => acknowledgements.push(...ids),
      showToast: (...args) => toasts.push(args), clearCurrentPath() {}, getCurrentPlayerId: () => 'proof',
    });
    for (const [index, key] of ['notice.craft.alchemy.batch-success', 'notice.craft.alchemy.batch-failed', 'notice.craft.forging.batch-resources-missing'].entries()) {
      source.handleSystemMsg({ id: String(index + 1), persistUntilAck: true, text: key, kind: index === 1 ? 'system' : 'forging', structured: { key, vars: { batch: 321, successNoun: '成器', count: 1 } } });
    }
    await Promise.resolve(); await Promise.resolve();
    return { messages: messages.length, toasts: toasts.length, acknowledgements };
  })()`), { messages: 3, toasts: 1, acknowledgements: ['1', '2', '3'] }, '批次紀錄與確認保留，僅異常需要浮動提示');

  await cdp.evaluate(`(async () => {
    const panel = await import('/src/react-ui/panels/item-sources/mount-item-sources-panel.tsx');
    panel.closeItemSourcesPanel();
    const { detailModalHost } = await import('/src/ui/detail-modal-host.ts');
    window.__sourcesProof.detailModalHost = detailModalHost;
    document.querySelector('#game-canvas').id = 'proof-original-game-canvas';
    const canvas = document.createElement('canvas'); canvas.id = 'game-canvas'; canvas.dataset.mapDismissFixture = '';
    canvas.style.cssText = 'position:fixed;left:0;top:650px;width:100px;height:100px;z-index:100';
    const ui = document.createElement('button'); ui.dataset.mapDismissFixture = ''; ui.textContent = '其他 UI';
    ui.style.cssText = 'position:fixed;left:150px;top:650px;width:100px;height:100px;z-index:100';
    document.body.append(canvas, ui);
    detailModalHost.open({ ownerId: 'map-dismiss-proof', title: '關閉判斷', size: 'sm', bodyHtml: '<button>視窗內按鈕</button>' });
  })()`);
  for (const [x, shouldStay] of [[180, true], [40, false]]) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: 700, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: 700, button: 'left', clickCount: 1 });
    assert.equal(await cdp.evaluate(`window.__sourcesProof.detailModalHost.isOpenFor('map-dismiss-proof')`), shouldStay, shouldStay ? '點其他 UI 不得當空白關閉' : '點主地圖畫布應關閉');
  }
  await cdp.evaluate(`window.__sourcesProof.detailModalHost.open({ ownerId: 'map-dismiss-proof', title: '關閉判斷', bodyHtml: '<p>內容</p>' })`);
  await click(cdp, '[data-detail-modal-close]');
  assert.equal(await cdp.evaluate(`window.__sourcesProof.detailModalHost.isOpenFor('map-dismiss-proof')`), false, '明確關閉鈕可關窗');
  await cdp.evaluate(`document.querySelectorAll('[data-map-dismiss-fixture]').forEach(el => el.remove()); document.querySelector('#proof-original-game-canvas').id = 'game-canvas'`);

});
console.log('item sources panel: PASS (complete sources, desktop/touch, return/Escape, navigation same/cross map, quest, offline)');
