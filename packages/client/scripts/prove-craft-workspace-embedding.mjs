/**
 * 技藝工坊內嵌 workspace 的正式 Vite + Chrome proof。
 *
 * 覆蓋同步導航重入、外部入口、非空長列表、增量 patch、確認層與離開清理。
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const outputDir = process.env.WORKSPACE_PROOF_OUTPUT_DIR
  ? path.resolve(process.env.WORKSPACE_PROOF_OUTPUT_DIR)
  : null;

const cases = [
  { id: 'desktop', width: 1280, height: 900 },
  { id: 'mobile-portrait', width: 390, height: 844 },
  { id: 'mobile-landscape', width: 844, height: 390 },
];

const initialize = String.raw`
  (async () => {
    const [
      { CraftWorkbenchModal },
      { detailModalHost },
      itemSourceBridge,
      { createMainNavigationStateSource },
      { createSocketRuntimeSender },
      itemSources,
      { resolveItemSourceNavigation },
    ] = await Promise.all([
      import('/src/ui/craft-workbench-modal.ts'),
      import('/src/ui/detail-modal-host.ts'),
      import('/src/ui/item-source-navigation.ts'),
      import('/src/main-navigation-state-source.ts'),
      import('/src/network/socket-send-runtime.ts'),
      import('/src/content/item-sources.ts'),
      import('/src/content/item-source-navigation.ts'),
    ]);
    await itemSources.preloadItemSourceCatalog();
    document.getElementById('login-overlay')?.classList.add('hidden');
    document.getElementById('game-shell')?.classList.remove('hidden');
    const workspace = document.getElementById('game-workspace');
    const workspaceBody = document.getElementById('game-workspace-body');
    if (!workspace || !workspaceBody) throw new Error('缺少正式 workspace 宿主');

    const requests = { alchemy: 0, forging: 0, enhancement: 0 };
    const starts = [];
    const modal = new CraftWorkbenchModal();
    const navigationState = {
      playerMap: 'proof-other-map',
      sent: [],
      workspaceCloseCount: 0,
    };
    const sender = createSocketRuntimeSender({
      isConnected: () => true,
      emitEvent: (event, payload) => navigationState.sent.push({ event, payload }),
    });
    const navigation = createMainNavigationStateSource({
      getPlayer: () => ({ id: 'proof', x: 0, y: 0, mapId: navigationState.playerMap }),
      getMapMeta: () => null,
      getLatestEntities: () => [],
      setRuntimePathCells: () => {},
      sendMoveTo: (x, y, options) => sender.sendMoveTo(x, y, options),
    });
    itemSourceBridge.setItemSourceNavigationHandler(itemSourceBridge.createItemSourceNavigationHandler({
      isReady: () => true,
      planPathTo: (target, options) => navigation.planPathTo(target, options),
      navigateToQuest: (questId) => sender.sendNavigateQuest(questId),
    }));
    const showWorkspaceMode = CraftWorkbenchModal.prototype.showWorkspaceMode;
    CraftWorkbenchModal.prototype.showWorkspaceMode = function(mode, host) {
      return showWorkspaceMode.call(modal, mode, host);
    };
    modal.configureWorkspaceNavigation({
      open: (mode) => {
        if (workspace.classList.contains('hidden')) {
          const itemsEntry = document.querySelector('#game-dock [data-workspace-open="items"]');
          if (!(itemsEntry instanceof HTMLButtonElement)) throw new Error('缺少正式背包與技藝入口');
          itemsEntry.click();
        }
        let tab = document.getElementById('workspace-tab-' + mode);
        if (!(tab instanceof HTMLButtonElement)) {
          const itemsEntry = document.querySelector('#game-dock [data-workspace-open="items"]');
          if (!(itemsEntry instanceof HTMLButtonElement)) throw new Error('缺少正式背包與技藝入口');
          itemsEntry.click();
          tab = document.getElementById('workspace-tab-' + mode);
        }
        if (!(tab instanceof HTMLButtonElement)) throw new Error('缺少正式技藝分頁：' + mode);
        tab.click();
      },
      resolveBody: (mode) => document.getElementById('workspace-' + mode),
      close: () => {
        navigationState.workspaceCloseCount += 1;
        workspace.classList.add('hidden');
        modal.hideWorkspace();
      },
    });
    modal.setCallbacks({
      onRequestAlchemy: () => { requests.alchemy += 1; },
      onRequestForging: () => { requests.forging += 1; },
      onRequestEnhancement: () => { requests.enhancement += 1; },
      onSaveAlchemyPreset() {},
      onDeleteAlchemyPreset() {},
      onStartAlchemy: (...args) => { starts.push(['alchemy', ...args]); },
      onStartForging: (...args) => { starts.push(['forging', ...args]); },
      onCancelAlchemy() {},
      onCancelForging() {},
      onCancelTechniqueActivity() {},
      onReorderTechniqueActivityQueue() {},
      onStartEnhancement: (payload) => { starts.push(['enhancement', payload]); },
      onCancelEnhancement() {},
    });
    modal.setTransmissionCallbacks({
      getTransmissionTargets: () => [{ playerId: 'proof-target', name: '測試道友' }],
      onRequestTransmissionStatuses: () => true,
    });

    const elements = { metal: 1, wood: 3, water: 1, fire: 1, earth: 1 };
    const inventory = { capacity: 60, revision: 1, items: [
      { itemId: 'spirit_stone', itemInstanceId: 'proof-stone', type: 'material', count: 99999, name: '靈石' },
      { itemId: 'mat.moondew_grass', itemInstanceId: 'proof-grass', type: 'material', count: 999, name: '月露草', materialValues: { elements, level: 1, grade: 'mortal' } },
      { itemId: 'black_iron_chunk', itemInstanceId: 'proof-iron', type: 'material', count: 999, name: '黑鐵塊', materialValues: { elements, level: 1, grade: 'mortal' } },
      { itemId: 'equip.copper_building_hammer', itemInstanceId: 'proof-hammer', type: 'equipment', equipSlot: 'weapon', count: 1, name: '銅鑄造鎚', enhanceLevel: 1, level: 3, grade: 'mortal' },
    ] };
    modal.syncInventory(inventory);
    modal.syncEquipment({ weapon: null, helmet: null, armor: null, belt: null, boots: null, necklace: null, ring: null, bracelet: null, pillFurnace: null, forgingTool: null, buildingTool: null, luopan: null, formationDisk: null });

    const recipe = (index, kind = 'alchemy', outputLevel = 1) => ({
      recipeId: 'proof-' + kind + '-' + index,
      outputItemId: kind === 'alchemy' ? 'pill.minor_heal' : 'equip.copper_building_hammer',
      outputName: (kind === 'alchemy' ? '回元丹' : '玄鐵器') + String(index + 1).padStart(2, '0'),
      category: kind === 'alchemy' ? 'recovery' : 'weapon',
      outputCount: 1,
      outputLevel,
      baseBrewTicks: 8 + index,
      level: 1,
      grade: 'mortal',
      fullPower: 5,
      requiredAuxElements: elements,
      mainIngredients: [{ itemId: kind === 'alchemy' ? 'mat.moondew_grass' : 'black_iron_chunk', name: kind === 'alchemy' ? '月露草' : '黑鐵塊', count: 1 }],
      ingredients: [{ itemId: kind === 'alchemy' ? 'mat.moondew_grass' : 'black_iron_chunk', name: kind === 'alchemy' ? '月露草' : '黑鐵塊', role: 'main', count: 1, level: 1, grade: 'mortal', powerPerUnit: 5 }],
    });
    const alchemyCatalog = [
      ...Array.from({ length: 24 }, (_, index) => recipe(index)),
      recipe(31, 'alchemy', 31),
      recipe(42, 'alchemy', 42),
      recipe(43, 'alchemy', 43),
      recipe(54, 'alchemy', 54),
      recipe(55, 'alchemy', 55),
      recipe(67, 'alchemy', 67),
      recipe(79, 'alchemy', 79),
      recipe(91, 'alchemy', 91),
      recipe(103, 'alchemy', 103),
      recipe(115, 'alchemy', 115),
      recipe(127, 'alchemy', 127),
    ];
    const forgingCatalog = [
      ...Array.from({ length: 18 }, (_, index) => recipe(index, 'forging')),
      recipe(31, 'forging', 31),
      recipe(43, 'forging', 43),
    ];
    const job = {
      jobRunId: 'proof-alchemy-job', jobType: 'alchemy', jobVersion: 1,
      recipeId: alchemyCatalog[0].recipeId, outputItemId: alchemyCatalog[0].outputItemId,
      outputCount: 1, quantity: 2, completedCount: 0, successCount: 0, failureCount: 0,
      ingredients: [{ itemId: 'mat.moondew_grass', count: 1 }], phase: 'brewing',
      batchBrewTicks: 10, currentBatchRemainingTicks: 8, pausedTicks: 0, spiritStoneCost: 2,
      totalTicks: 20, remainingTicks: 8, workTotalTicks: 20, workRemainingTicks: 8,
      interruptWaitRemainingTicks: 0, interruptState: null, successRate: 0.8, exactRecipe: true, startedAt: Date.now(),
      queuedJobs: [{
        queueId: 'proof-alchemy-queued', kind: 'alchemy', label: '回元丹02', quantity: 1,
        createdAt: Date.now() + 1, state: 'pending', payload: { outputItemId: alchemyCatalog[1].outputItemId },
      }],
    };
    const hammer = inventory.items[3];
    const candidate = {
      ref: { source: 'inventory', itemInstanceId: 'proof-hammer' }, item: hammer,
      currentLevel: 1, nextLevel: 2, spiritStoneCost: 1, successRate: 0.72, durationTicks: 8,
      materials: [{ itemId: 'black_iron_chunk', name: '黑鐵塊', count: 1, ownedCount: 999 }],
      allowSelfProtection: false, protectionCandidates: [],
    };

    window.__craftWorkspaceProof = {
      modal, requests, starts, workspace, alchemyCatalog, forgingCatalog, job, candidate, detailModalHost,
      itemSources, resolveItemSourceNavigation, navigationState,
      openAlchemy() { modal.openAlchemy(); modal.updateAlchemy({ kind: 'alchemy', catalogVersion: 3, catalog: alchemyCatalog, state: { presets: [], job, queue: [] } }); },
      openForging() { modal.openForging(); modal.updateForging({ kind: 'forging', catalogVersion: 4, catalog: forgingCatalog, state: { presets: [], job: null, queue: [] } }); },
      openEnhancement() { modal.openEnhancement(); modal.updateEnhancement({ state: { enhancementSkillLevel: 4, candidates: [candidate], records: [], job: null, queue: [] } }); },
    };
    return true;
  })()
`;

async function capture(cdp, name) {
  if (!outputDir) return null;
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(outputDir, name);
  await writeFile(file, Buffer.from(result.data, 'base64'));
  return file;
}

async function runCase(entry) {
  return withClientBrowserProof({
    viewport: { width: entry.width, height: entry.height },
    profilePrefix: `mud-craft-workspace-${entry.id}-`,
  }, async (cdp) => {
    assert.equal(await cdp.evaluate(initialize), true);
    const alchemy = await cdp.evaluate(String.raw`
      (async () => {
        const p = window.__craftWorkspaceProof;
        p.openAlchemy();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const pane = document.getElementById('workspace-alchemy');
        const list = pane.querySelector('[data-alchemy-recipe-list="true"]');
        const host = pane.querySelector('[data-react-panel="craft"]');
        const beforeHost = host;
        const beforeFill = pane.querySelector('[data-craft-queue-progress-fill="true"]')?.style.width ?? '';
        const scrollOwner = list.scrollHeight > list.clientHeight ? list : pane;
        scrollOwner.scrollTop = Math.min(48, scrollOwner.scrollHeight - scrollOwner.clientHeight);
        const beforeScroll = scrollOwner.scrollTop;
        p.modal.updateAlchemy({ kind: 'alchemy', catalogVersion: 3, statePatch: { job: { ...p.job, remainingTicks: 5, workRemainingTicks: 5, currentBatchRemainingTicks: 5 } } });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const afterList = pane.querySelector('[data-alchemy-recipe-list="true"]');
        const afterScrollOwner = scrollOwner === list ? afterList : pane;
        const realmTabs = pane.querySelector('[data-alchemy-realm-tabs="true"]');
        const firstRecipe = pane.querySelector('.alchemy-recipe-item');
        const inlineDetail = pane.querySelector('.alchemy-detail-panel');
        const workbenchHeader = pane.querySelector('.craft-workbench-header');
        const queuePanel = pane.querySelector('.craft-queue-panel');
        const paneRect = pane.getBoundingClientRect();
        const queueRect = queuePanel.getBoundingClientRect();
        const recipeColumns = getComputedStyle(afterList).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
        const visibleRecipeCount = [...pane.querySelectorAll('.alchemy-recipe-item')].filter((item) => {
          const rect = item.getBoundingClientRect();
          return rect.bottom > paneRect.top && rect.top < paneRect.bottom;
        }).length;
        const result = {
          requestCount: p.requests.alchemy,
          detailHidden: document.getElementById('detail-modal').classList.contains('hidden'),
          embedded: pane.querySelector('[data-craft-workbench-embedded="true"]') !== null,
          noInnerTabs: pane.querySelector('[data-craft-workbench-tabs="true"]') === null,
          recipeCount: pane.querySelectorAll('.alchemy-recipe-item').length,
          realmTabs: [...pane.querySelectorAll('[data-alchemy-realm-tabs="true"] [data-craft-action="alchemy-switch-realm"]')].map((button) => button.dataset.realm),
          realmTabsOverflow: realmTabs.scrollWidth > realmTabs.clientWidth,
          realmTabsOverflowMode: getComputedStyle(realmTabs).overflowX,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          recipeColumns,
          visibleRecipeCount,
          firstRecipeHeight: firstRecipe.getBoundingClientRect().height,
          firstRecipeLabelled: (firstRecipe.getAttribute('aria-label') ?? '').includes('製作詳情'),
          inlineDetailDisplay: getComputedStyle(inlineDetail).display,
          workbenchHeaderPosition: getComputedStyle(workbenchHeader).position,
          queueVisibleAfterScroll: queueRect.top >= paneRect.top - 1 && queueRect.top < paneRect.bottom,
          queueItemCount: pane.querySelectorAll('.craft-queue-item').length,
          queueToggleVisible: getComputedStyle(pane.querySelector('.craft-queue-toggle')).display !== 'none',
          scrollable: scrollOwner.scrollHeight > scrollOwner.clientHeight,
          scrollPreserved: afterScrollOwner.scrollTop === beforeScroll,
          hostPreserved: pane.querySelector('[data-react-panel="craft"]') === beforeHost,
          beforeFill,
          afterFill: pane.querySelector('[data-craft-queue-progress-fill="true"]')?.style.width ?? '',
          progressChanged: (pane.querySelector('[data-craft-queue-progress-fill="true"]')?.style.width ?? '') !== beforeFill,
        };
        return result;
      })()
    `);
    assert.equal(alchemy.requestCount, 1, '同步 workspace onContent 重入只能請求一次煉丹面板');
    assert.equal(alchemy.detailHidden, true, '工坊不得再開啟 detail modal');
    assert.equal(alchemy.embedded, true, 'React 工坊必須帶 embedded 標記');
    assert.equal(alchemy.noInnerTabs, true, 'workspace 已有主分頁時不得重複工坊側欄分頁');
    assert.equal(alchemy.recipeCount, 24, '非空煉丹長列表必須完整進入正式 renderer');
    assert.deepEqual(alchemy.realmTabs, ['mortal', 'qi', 'foundation', 'golden-core', 'nascent', 'soul-transform', 'void-refine', 'body-integration', 'mahayana', 'tribulation', 'ascension'], '築基後配方必須依真實境界邊界新增各大境界分頁');
    assert.equal(alchemy.pageOverflow, false, '工坊不得造成頁面級橫向溢位');
    assert.equal(alchemy.queueItemCount, 2, '當前工作與後續項目必須完整進入隊列');
    assert.equal(alchemy.scrollable, true, '煉丹長列表必須存在可捲動路徑');
    assert.equal(alchemy.scrollPreserved, true, '增量 patch 不得打斷列表捲動位置');
    assert.equal(alchemy.hostPreserved, true, '增量 patch 不得重新掛載 React root');
    assert.equal(alchemy.progressChanged, true, `job statePatch 必须更新工作进度：${JSON.stringify(alchemy)}`);
    if (entry.id === 'desktop') {
      assert.equal(alchemy.realmTabsOverflow, false, '桌面境界分頁不得橫向溢出容器');
      assert.equal(alchemy.recipeColumns, 1, '桌面配方仍須維持清單與右側詳情佈局');
      assert.notEqual(alchemy.inlineDetailDisplay, 'none', '桌面必須保留右側製作詳情');
    } else {
      assert.equal(alchemy.realmTabsOverflow, true, '手機境界分頁應使用緊湊的橫向分類帶');
      assert.equal(alchemy.realmTabsOverflowMode, 'auto', '手機境界分類帶必須可水平捲動');
      assert.ok(alchemy.recipeColumns >= 2, `手機可製作道具至少雙欄：${JSON.stringify(alchemy)}`);
      assert.ok(alchemy.firstRecipeHeight >= 44, `手機配方觸控高度不得低於 44px：${JSON.stringify(alchemy)}`);
      assert.equal(alchemy.firstRecipeLabelled, true, '手機配方必須有明確的製作詳情語意');
      assert.equal(alchemy.inlineDetailDisplay, 'none', '手機不得再把製作詳情塞在配方清單底部');
      assert.equal(alchemy.workbenchHeaderPosition, 'sticky', '手機當前隊列必須置頂');
      assert.equal(alchemy.queueVisibleAfterScroll, true, '手機捲動配方時仍必須看得到當前隊列');
      assert.equal(alchemy.queueToggleVisible, true, '多項隊列必須提供完整展開入口');
      assert.ok(alchemy.visibleRecipeCount > 0, `手機首屏必須同時看得到可製作道具：${JSON.stringify(alchemy)}`);
    }
    const alchemyShot = await capture(cdp, `craft-workspace-${entry.id}-alchemy-light.png`);

    let mobileDetailShot = null;
    if (entry.id !== 'desktop') {
      const mobileDetail = await cdp.evaluate(String.raw`
        (async () => {
          const pane = document.getElementById('workspace-alchemy');
          const opener = pane.querySelector('[data-guided-tour-alchemy-recipe="proof-alchemy-0"]');
          const queueToggle = pane.querySelector('[data-craft-action="toggle-craft-queue"]');
          const beforeScroll = pane.scrollTop;
          queueToggle.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const queueExpanded = queueToggle.getAttribute('aria-expanded') === 'true'
            && getComputedStyle(pane.querySelectorAll('.craft-queue-item')[1]).display !== 'none';
          queueToggle.click();
          opener.click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const layer = document.getElementById('detail-modal');
          const card = document.getElementById('detail-modal-card');
          const body = document.getElementById('detail-modal-body');
          const closeButton = layer.querySelector('[data-detail-modal-close="true"]');
          const actionButtons = [...body.querySelectorAll('button')];
          return {
            queueExpanded,
            open: !layer.classList.contains('hidden'),
            recipeVariant: card.classList.contains('detail-modal--craft-recipe'),
            title: document.getElementById('detail-modal-title').textContent,
            bodyReady: body.querySelector('.alchemy-mobile-detail-content .alchemy-detail-stack') !== null,
            hasStartAction: body.querySelector('[data-craft-action="alchemy-start-full"]') !== null,
            closeFocused: document.activeElement === closeButton,
            closeHeight: closeButton.getBoundingClientRect().height,
            minActionHeight: actionButtons.length > 0 ? Math.min(...actionButtons.map((button) => button.getBoundingClientRect().height)) : 0,
            withinViewport: card.getBoundingClientRect().left >= 0
              && card.getBoundingClientRect().right <= window.innerWidth
              && card.getBoundingClientRect().bottom <= window.innerHeight + 1,
            pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            beforeScroll,
          };
        })()
      `);
      assert.equal(mobileDetail.queueExpanded, true, '手機完整隊列必須可展開並顯示後續項目');
      assert.equal(mobileDetail.open, true, '手機點選配方必須開啟製作詳情浮窗');
      assert.equal(mobileDetail.recipeVariant, true, '手機製作詳情必須使用專屬浮窗樣式');
      assert.equal(mobileDetail.title, '煉丹製作詳情', '手機詳情浮窗標題必須清楚說明用途');
      assert.equal(mobileDetail.bodyReady, true, '手機詳情浮窗必須包含完整配方內容');
      assert.equal(mobileDetail.hasStartAction, true, '手機詳情浮窗內必須可以直接進入製作流程');
      assert.equal(mobileDetail.closeFocused, true, '手機詳情浮窗開啟後必須把焦點移到可見關閉按鈕');
      assert.ok(mobileDetail.closeHeight >= 44, `手機詳情關閉按鈕不得低於 44px：${JSON.stringify(mobileDetail)}`);
      assert.ok(mobileDetail.minActionHeight >= 44, `手機詳情操作按鈕不得低於 44px：${JSON.stringify(mobileDetail)}`);
      assert.equal(mobileDetail.withinViewport, true, '手機詳情浮窗不得超出可視範圍');
      assert.equal(mobileDetail.pageOverflow, false, '手機詳情浮窗不得造成頁面級橫向溢位');
      mobileDetailShot = await capture(cdp, `craft-workspace-${entry.id}-alchemy-detail-light.png`);

      const mobileDetailClose = await cdp.evaluate(String.raw`
        (async () => {
          const pane = document.getElementById('workspace-alchemy');
          const beforeScroll = pane.scrollTop;
          document.querySelector('#detail-modal [data-detail-modal-close="true"]')?.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const opener = pane.querySelector('[data-guided-tour-alchemy-recipe="proof-alchemy-0"]');
          return {
            closed: document.getElementById('detail-modal').classList.contains('hidden'),
            focusReturned: document.activeElement === opener,
            scrollPreserved: pane.scrollTop === beforeScroll,
          };
        })()
      `);
      assert.equal(mobileDetailClose.closed, true, '手機製作詳情必須可明確關閉');
      assert.equal(mobileDetailClose.focusReturned, true, '關閉手機製作詳情後必須把焦點還給原配方');
      assert.equal(mobileDetailClose.scrollPreserved, true, '關閉手機製作詳情不得改變配方清單位置');
    }

    const realmSwitching = await cdp.evaluate(String.raw`
      (async () => {
        const pane = document.getElementById('workspace-alchemy');
        const clickRealm = async (realm) => {
          pane.querySelector('[data-alchemy-realm-tabs="true"] [data-realm="' + realm + '"]')?.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return [...pane.querySelectorAll('.alchemy-recipe-item')].map((item) => item.dataset.guidedTourAlchemyRecipe);
        };
        const foundation = await clickRealm('foundation');
        const goldenCore = await clickRealm('golden-core');
        const ascension = await clickRealm('ascension');
        document.documentElement.dataset.colorMode = 'dark';
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const realmTabs = pane.querySelector('[data-alchemy-realm-tabs="true"]');
        const activeRealmTab = realmTabs.querySelector('.alchemy-category-btn.active');
        // 低資源瀏覽器的顏色過渡可能跨多幀，等待原本要求的最終色值。
        const themeDeadline = performance.now() + 3000;
        while (getComputedStyle(activeRealmTab).color !== 'rgb(246, 238, 224)' && performance.now() < themeDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return {
          foundation,
          goldenCore,
          ascension,
          darkRealmBackground: getComputedStyle(realmTabs).backgroundColor,
          darkRealmText: getComputedStyle(activeRealmTab).color,
          realmTabsOverflow: realmTabs.scrollWidth > realmTabs.clientWidth,
        };
      })()
    `);
    assert.deepEqual(realmSwitching.foundation, ['proof-alchemy-31', 'proof-alchemy-42'], 'Lv.31 至 Lv.42 必須都留在築基分頁');
    assert.deepEqual(realmSwitching.goldenCore, ['proof-alchemy-43', 'proof-alchemy-54'], 'Lv.43 起必須切換至金丹分頁');
    assert.deepEqual(realmSwitching.ascension, ['proof-alchemy-127'], '飛昇配方必須落入飛昇分頁');
    assert.notEqual(realmSwitching.darkRealmBackground, 'rgba(247, 239, 225, 0.64)', '深色模式境界分頁不得沿用淺色底');
    assert.equal(realmSwitching.darkRealmText, 'rgb(246, 238, 224)', '深色模式境界分頁必須保留高對比文字');
    assert.equal(realmSwitching.realmTabsOverflow, entry.id !== 'desktop', '境界分類帶只可在手機內部水平捲動');
    const alchemyDarkShot = await capture(cdp, `craft-workspace-${entry.id}-alchemy-dark.png`);

    const enhancement = await cdp.evaluate(String.raw`
      (async () => {
        const p = window.__craftWorkspaceProof;
        p.openForging();
        p.modal.updateForging({ kind: 'forging', catalogVersion: 4, catalog: p.forgingCatalog, state: { presets: [], job: null, queue: [] } });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const forgingPane = document.getElementById('workspace-forging');
        forgingPane.querySelector('[data-alchemy-realm-tabs="true"] [data-realm="golden-core"]')?.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const forgingGoldenRecipes = [...forgingPane.querySelectorAll('.alchemy-recipe-item')].map((item) => item.dataset.guidedTourAlchemyRecipe);
        let forgingMobileDetail = null;
        if (matchMedia('(max-width: 760px), (max-width: 1024px) and (max-height: 520px)').matches) {
          forgingPane.querySelector('[data-guided-tour-alchemy-recipe="proof-forging-43"]')?.click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          forgingMobileDetail = {
            open: !document.getElementById('detail-modal').classList.contains('hidden'),
            title: document.getElementById('detail-modal-title').textContent,
            variant: document.getElementById('detail-modal-card').classList.contains('detail-modal--craft-forging'),
            hasStartAction: document.getElementById('detail-modal-body').querySelector('[data-craft-action="alchemy-start-full"]') !== null,
          };
          document.querySelector('#detail-modal [data-detail-modal-close="true"]')?.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        p.openEnhancement();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const pane = document.getElementById('workspace-enhancement');
        return {
          forgingRequests: p.requests.forging,
          enhancementRequests: p.requests.enhancement,
          embedded: pane.querySelector('[data-craft-workbench-embedded="true"]') !== null,
          candidateText: pane.textContent.includes('銅鑄造鎚'),
          forgingGoldenRecipes,
          forgingMobileDetail,
        };
      })()
    `);
    assert.equal(enhancement.forgingRequests, 1, '煉器同步切頁只能請求一次');
    assert.equal(enhancement.enhancementRequests, 1, '強化同步切頁只能請求一次');
    assert.equal(enhancement.embedded, true, '強化必須沿用 embedded 正式 renderer');
    assert.equal(enhancement.candidateText, true, '強化非空候選必須可見');
    assert.deepEqual(enhancement.forgingGoldenRecipes, ['proof-forging-43'], '煉器入口必須與煉丹共用金丹分頁邊界');
    if (entry.id !== 'desktop') {
      assert.deepEqual(enhancement.forgingMobileDetail, {
        open: true,
        title: '煉器製作詳情',
        variant: true,
        hasStartAction: true,
      }, '手機煉器配方也必須開啟可直接操作的專屬詳情浮窗');
    }
    const enhancementShot = await capture(cdp, `craft-workspace-${entry.id}-enhancement.png`);

    const lifecycle = await cdp.evaluate(String.raw`
      (async () => {
        const p = window.__craftWorkspaceProof;
        p.openAlchemy();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        document.querySelector('#workspace-alchemy [data-craft-action="alchemy-start-full"]')?.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const confirmOpened = !document.querySelector('.confirm-modal-layer')?.classList.contains('hidden');
        p.detailModalHost.open({ ownerId: 'craft-workspace-proof-detail', title: '道具詳細', bodyHtml: '<p>測試道具</p>', onClose: () => { window.__craftDetailClosed = (window.__craftDetailClosed ?? 0) + 1; } });
        p.modal.openEnhancement();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const detailClosed = document.getElementById('detail-modal').classList.contains('hidden') && window.__craftDetailClosed === 1;
        const enhancementRequests = p.requests.enhancement;
        p.modal.openTransmission();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const transmissionVisible = document.getElementById('workspace-transmission').textContent.trim().length > 0;
        p.modal.hideWorkspace();
        return {
          confirmOpened,
          detailClosed,
          enhancementRequests,
          transmissionVisible,
          confirmStates: [...document.querySelectorAll('.confirm-modal-layer')].map((node) => node.className),
          confirmClosed: [...document.querySelectorAll('.confirm-modal-layer')].every((node) => node.classList.contains('hidden')),
          bodyCleared: document.getElementById('workspace-transmission').childElementCount === 0,
        };
      })()
    `);
    assert.equal(lifecycle.confirmOpened, true, '煉丹開始確認必須繼續使用獨立 confirm layer');
    assert.equal(lifecycle.detailClosed, true, '道具詳細彈層入口切換 workspace 時必須走原 onClose 生命週期');
    assert.equal(lifecycle.enhancementRequests, 2, '道具詳細入口後的強化啟用仍只能增加一次請求');
    assert.equal(lifecycle.transmissionVisible, true, '傳功必須進入自身 workspace pane');
    assert.equal(lifecycle.confirmClosed, true, `离开 workspace 必须关闭 transient confirm：${JSON.stringify(lifecycle.confirmStates)}`);
    assert.equal(lifecycle.bodyCleared, true, '離開 workspace 必須卸載 React 與清空專屬宿主');

    const materialNavigation = await cdp.evaluate(String.raw`
      (async () => {
        const p = window.__craftWorkspaceProof;
        const paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const waitFor = async (predicate, label) => {
          const deadline = performance.now() + 3000;
          while (!predicate()) {
            if (performance.now() >= deadline) throw new Error('等待逾時：' + label);
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        };
        const runNavigation = async (mode, itemId) => {
          p.navigationState.playerMap = 'proof-other-map';
          p.navigationState.sent.length = 0;
          p.navigationState.workspaceCloseCount = 0;
          if (mode === 'alchemy') p.openAlchemy();
          else p.openForging();
          await paint();
          const pane = document.getElementById('workspace-' + mode);
          pane.querySelector('[data-alchemy-realm-tabs="true"] [data-realm="mortal"]')?.click();
          await paint();
          pane.querySelector('[data-alchemy-category-tabs="true"] [data-category="' + (mode === 'alchemy' ? 'recovery' : 'weapon') + '"]')?.click();
          await paint();
          pane.querySelector('[data-guided-tour-alchemy-recipe="proof-' + mode + '-0"]')?.click();
          await paint();
          const materialHost = document.getElementById('detail-modal').classList.contains('hidden')
            ? pane
            : document.getElementById('detail-modal-body');
          const opener = [...materialHost.querySelectorAll('[data-craft-action="alchemy-open-material-detail"]')]
            .find((button) => button.dataset.itemId === itemId);
          if (!(opener instanceof HTMLButtonElement)) throw new Error('缺少材料詳情入口：' + mode + '/' + itemId);
          opener.click();
          await waitFor(() => document.querySelector('.catalog-item-detail-dialog')?.open === true, '材料詳情開啟');
          const entries = p.itemSources.getItemSourceEntries(itemId);
          const index = entries.findIndex((entry) => p.resolveItemSourceNavigation(entry).kind === 'point');
          if (index < 0) throw new Error('材料缺少真實座標來源：' + itemId);
          const expected = p.resolveItemSourceNavigation(entries[index]);
          const go = document.querySelector('.catalog-item-detail-dialog [data-catalog-item-source-go="' + index + '"]');
          if (!(go instanceof HTMLButtonElement)) throw new Error('缺少材料前往按鈕：' + mode + '/' + itemId);
          go.click();
          await paint();
          if (mode === 'alchemy') {
            p.modal.updateAlchemy({ kind: 'alchemy', catalogVersion: 3, statePatch: { job: null, queue: [] } });
          } else {
            p.modal.updateForging({ kind: 'forging', catalogVersion: 4, statePatch: { job: null, queue: [] } });
          }
          await paint();
          return {
            expected,
            sent: p.navigationState.sent.map(({ event, payload }) => ({ event, payload: { ...payload } })),
            childClosed: document.querySelector('.catalog-item-detail-dialog')?.open === false,
            workspaceClosed: p.workspace.classList.contains('hidden'),
            workspaceCloseCount: p.navigationState.workspaceCloseCount,
            mapFocused: document.activeElement?.id === 'game-stage',
            bodyCleared: pane.childElementCount === 0,
          };
        };

        const alchemy = await runNavigation('alchemy', 'mat.moondew_grass');
        const forging = await runNavigation('forging', 'black_iron_chunk');

        p.openAlchemy();
        await paint();
        const pane = document.getElementById('workspace-alchemy');
        pane.querySelector('[data-alchemy-realm-tabs="true"] [data-realm="mortal"]')?.click();
        await paint();
        pane.querySelector('[data-alchemy-category-tabs="true"] [data-category="recovery"]')?.click();
        await paint();
        pane.querySelector('[data-guided-tour-alchemy-recipe="proof-alchemy-0"]')?.click();
        await paint();
        const materialHost = document.getElementById('detail-modal').classList.contains('hidden')
          ? pane
          : document.getElementById('detail-modal-body');
        const opener = [...materialHost.querySelectorAll('[data-craft-action="alchemy-open-material-detail"]')]
          .find((button) => button.dataset.itemId === 'mat.moondew_grass');
        opener.click();
        await waitFor(() => document.querySelector('.catalog-item-detail-dialog')?.open === true, '一般關閉材料詳情');
        document.querySelector('.catalog-item-detail-dialog [data-catalog-item-detail-close]')?.click();
        await paint();
        const ordinaryCloseKeepsWorkspace = !p.workspace.classList.contains('hidden');
        const ordinaryCloseRestoresFocus = document.activeElement === opener;

        const { openCatalogItemDetail } = await import('/src/ui/catalog-item-detail.ts');
        p.navigationState.sent.length = 0;
        openCatalogItemDetail({ itemId: 'mat.moondew_grass' });
        await waitFor(() => document.querySelector('.catalog-item-detail-dialog')?.open === true, '無回呼材料詳情');
        const entries = p.itemSources.getItemSourceEntries('mat.moondew_grass');
        const index = entries.findIndex((entry) => p.resolveItemSourceNavigation(entry).kind === 'point');
        document.querySelector('.catalog-item-detail-dialog [data-catalog-item-source-go="' + index + '"]')?.click();
        await paint();
        const callbackCleared = !p.workspace.classList.contains('hidden') && p.navigationState.sent.length === 1;
        p.modal.hideWorkspace();
        p.workspace.classList.add('hidden');
        return { alchemy, forging, ordinaryCloseKeepsWorkspace, ordinaryCloseRestoresFocus, callbackCleared };
      })()
    `);
    for (const [mode, result] of Object.entries({ alchemy: materialNavigation.alchemy, forging: materialNavigation.forging })) {
      assert.equal(result.sent.length, 1, `${mode} 材料前往只能送出一次導航意圖`);
      assert.equal(result.sent[0].payload.x, result.expected.x, `${mode} 材料導航 X 座標錯誤`);
      assert.equal(result.sent[0].payload.y, result.expected.y, `${mode} 材料導航 Y 座標錯誤`);
      assert.equal(result.sent[0].payload.targetMapId, result.expected.mapId, `${mode} 材料導航必須保留跨地圖目標`);
      assert.equal(result.sent[0].payload.ignoreVisibilityLimit, true, `${mode} 材料導航必須忽略當前可視範圍`);
      assert.equal(result.sent[0].payload.allowNearestReachable, true, `${mode} 材料導航必須允許最近可達格`);
      assert.equal(result.childClosed, true, `${mode} 導航後必須關閉材料詳情`);
      assert.equal(result.workspaceClosed, true, `${mode} 導航後必須關閉工坊並返回地圖`);
      assert.equal(result.workspaceCloseCount, 1, `${mode} 導航後只能關閉一次工坊`);
      assert.equal(result.mapFocused, true, `${mode} 導航後必須將焦點交回地圖`);
      assert.equal(result.bodyCleared, true, `${mode} 導航後更新不得重開工坊內容`);
    }
    assert.equal(materialNavigation.ordinaryCloseKeepsWorkspace, true, '一般關閉材料詳情不得關閉工坊');
    assert.equal(materialNavigation.ordinaryCloseRestoresFocus, true, '一般關閉材料詳情必須將焦點還給材料按鈕');
    assert.equal(materialNavigation.callbackCleared, true, '下一次無回呼材料導航不得沿用舊工坊關閉回呼');
    return [alchemyShot, mobileDetailShot, alchemyDarkShot, enhancementShot];
  });
}

if (outputDir) await mkdir(outputDir, { recursive: true });
const screenshots = [];
for (const entry of cases) {
  screenshots.push(...(await runCase(entry)).filter(Boolean));
  await delay(100);
}
console.log(`技藝工坊 workspace 內嵌 proof 通過${screenshots.length > 0 ? `：${screenshots.join(', ')}` : ''}`);
