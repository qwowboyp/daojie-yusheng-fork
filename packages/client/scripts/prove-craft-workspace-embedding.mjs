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
    const [{ CraftWorkbenchModal }, { detailModalHost }] = await Promise.all([
      import('/src/ui/craft-workbench-modal.ts'),
      import('/src/ui/detail-modal-host.ts'),
    ]);
    document.getElementById('login-overlay')?.classList.add('hidden');
    document.getElementById('game-shell')?.classList.remove('hidden');
    const workspace = document.getElementById('game-workspace');
    const workspaceBody = document.getElementById('game-workspace-body');
    if (!workspace || !workspaceBody) throw new Error('缺少正式 workspace 宿主');

    const requests = { alchemy: 0, forging: 0, enhancement: 0 };
    const starts = [];
    const modal = new CraftWorkbenchModal();
    const showWorkspaceMode = CraftWorkbenchModal.prototype.showWorkspaceMode;
    CraftWorkbenchModal.prototype.showWorkspaceMode = function(mode, host) {
      return showWorkspaceMode.call(modal, mode, host);
    };
    modal.configureWorkspaceNavigation({
      open: (mode) => {
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

    const recipe = (index, kind = 'alchemy') => ({
      recipeId: 'proof-' + kind + '-' + index,
      outputItemId: kind === 'alchemy' ? 'pill.minor_heal' : 'equip.copper_building_hammer',
      outputName: (kind === 'alchemy' ? '回元丹' : '玄鐵器') + String(index + 1).padStart(2, '0'),
      category: kind === 'alchemy' ? 'recovery' : 'weapon',
      outputCount: 1,
      outputLevel: 1,
      baseBrewTicks: 8 + index,
      level: 1,
      grade: 'mortal',
      fullPower: 5,
      requiredAuxElements: elements,
      mainIngredients: [{ itemId: kind === 'alchemy' ? 'mat.moondew_grass' : 'black_iron_chunk', name: kind === 'alchemy' ? '月露草' : '黑鐵塊', count: 1 }],
      ingredients: [{ itemId: kind === 'alchemy' ? 'mat.moondew_grass' : 'black_iron_chunk', name: kind === 'alchemy' ? '月露草' : '黑鐵塊', role: 'main', count: 1, level: 1, grade: 'mortal', powerPerUnit: 5 }],
    });
    const alchemyCatalog = Array.from({ length: 24 }, (_, index) => recipe(index));
    const forgingCatalog = Array.from({ length: 18 }, (_, index) => recipe(index, 'forging'));
    const job = {
      jobRunId: 'proof-alchemy-job', jobType: 'alchemy', jobVersion: 1,
      recipeId: alchemyCatalog[0].recipeId, outputItemId: alchemyCatalog[0].outputItemId,
      outputCount: 1, quantity: 2, completedCount: 0, successCount: 0, failureCount: 0,
      ingredients: [{ itemId: 'mat.moondew_grass', count: 1 }], phase: 'brewing',
      batchBrewTicks: 10, currentBatchRemainingTicks: 8, pausedTicks: 0, spiritStoneCost: 2,
      totalTicks: 20, remainingTicks: 8, workTotalTicks: 20, workRemainingTicks: 8,
      interruptWaitRemainingTicks: 0, interruptState: null, successRate: 0.8, exactRecipe: true, startedAt: Date.now(),
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
        const result = {
          requestCount: p.requests.alchemy,
          detailHidden: document.getElementById('detail-modal').classList.contains('hidden'),
          embedded: pane.querySelector('[data-craft-workbench-embedded="true"]') !== null,
          noInnerTabs: pane.querySelector('[data-craft-workbench-tabs="true"]') === null,
          recipeCount: pane.querySelectorAll('.alchemy-recipe-item').length,
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
    assert.equal(alchemy.requestCount, 1, '同步 workspace onContent 重入只能请求一次煉丹面板');
    assert.equal(alchemy.detailHidden, true, '工坊不得再打开 detail modal');
    assert.equal(alchemy.embedded, true, 'React 工坊必须带 embedded 标记');
    assert.equal(alchemy.noInnerTabs, true, 'workspace 已有主分页时不得重复工坊侧栏分页');
    assert.equal(alchemy.recipeCount, 24, '非空煉丹长列表必须完整进入正式 renderer');
    assert.equal(alchemy.scrollable, true, '煉丹长列表必须存在可滚动路径');
    assert.equal(alchemy.scrollPreserved, true, '增量 patch 不得打断列表滚动位置');
    assert.equal(alchemy.hostPreserved, true, '增量 patch 不得重挂 React root');
    assert.equal(alchemy.progressChanged, true, `job statePatch 必须更新工作进度：${JSON.stringify(alchemy)}`);
    const alchemyShot = await capture(cdp, `craft-workspace-${entry.id}-alchemy.png`);

    const enhancement = await cdp.evaluate(String.raw`
      (async () => {
        const p = window.__craftWorkspaceProof;
        p.openForging();
        p.openEnhancement();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const pane = document.getElementById('workspace-enhancement');
        return {
          forgingRequests: p.requests.forging,
          enhancementRequests: p.requests.enhancement,
          embedded: pane.querySelector('[data-craft-workbench-embedded="true"]') !== null,
          candidateText: pane.textContent.includes('銅鑄造鎚'),
        };
      })()
    `);
    assert.equal(enhancement.forgingRequests, 1, '煉器同步切页只能请求一次');
    assert.equal(enhancement.enhancementRequests, 1, '强化同步切页只能请求一次');
    assert.equal(enhancement.embedded, true, '强化必须沿用 embedded 正式 renderer');
    assert.equal(enhancement.candidateText, true, '强化非空候选必须可见');
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
    assert.equal(lifecycle.confirmOpened, true, '煉丹开始确认必须继续使用独立 confirm layer');
    assert.equal(lifecycle.detailClosed, true, '道具详细弹层入口切换 workspace 时必须走原 onClose 生命周期');
    assert.equal(lifecycle.enhancementRequests, 2, '道具详细入口后的强化激活仍只能增加一次请求');
    assert.equal(lifecycle.transmissionVisible, true, '傳功必须进入自身 workspace pane');
    assert.equal(lifecycle.confirmClosed, true, `离开 workspace 必须关闭 transient confirm：${JSON.stringify(lifecycle.confirmStates)}`);
    assert.equal(lifecycle.bodyCleared, true, '离开 workspace 必须卸载 React 与清空专属宿主');
    return [alchemyShot, enhancementShot];
  });
}

if (outputDir) await mkdir(outputDir, { recursive: true });
const screenshots = [];
for (const entry of cases) {
  screenshots.push(...(await runCase(entry)).filter(Boolean));
  await delay(100);
}
console.log(`技藝工坊 workspace 內嵌 proof 通過${screenshots.length > 0 ? `：${screenshots.join(', ')}` : ''}`);
