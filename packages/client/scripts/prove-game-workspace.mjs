/**
 * 主舞台與按需工作窗的瀏覽器 proof。
 *
 * 不登入、不讀取帳號資料：資料由正式 Panel 公開 update 入口注入。這仍可驗證
 * 實際 Vite 頁面的 workspace 導覽、既有 pane、React 掛載、焦點與回呼路徑。
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { delay, withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

const PHONE = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const DESKTOP = { width: 1440, height: 900 };
const VISUALIZATION_DIR = process.env.WORKSPACE_PROOF_OUTPUT_DIR;

const fixtureExpression = String.raw`
  (async () => {
    const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const calls = [];
    const player = {
      id: 'workspace-proof-player', mapId: 'starter_village', realmLv: 3,
      realm: { realmLv: 3, stage: 'qi_refining' }, foundation: 18, qi: 66,
      x: 14, y: 22, hp: 680, maxHp: 1000, numericStats: { maxQi: 400 },
      equipment: { weapon: { itemId: 'proof-iron-sword', itemInstanceId: 'proof-sword', name: '驗證鐵劍', desc: '目前裝備的對照武器', type: 'equipment', count: 1, level: 2, equipSlot: 'weapon', equipStats: { maxHp: 18 } } },
      artifacts: [], techniques: [], unlockedMinimapIds: [], inventory: { capacity: 24, items: [] }, quests: [],
    };
    const inventory = {
      revision: 1, capacity: 24, serverTick: 120, cooldowns: [],
      items: [
        { itemId: 'proof-healing-pill', itemInstanceId: 'proof-healing-pill-1', name: '回春散', desc: '按需工作窗 proof 道具', type: 'consumable', count: 3, level: 1, baselineHealPercent: 1 },
        { itemId: 'proof-ore', itemInstanceId: 'proof-ore-1', name: '赤鐵礦', desc: '非空背包驗證資料', type: 'material', count: 12, level: 1 },
        { itemId: 'proof-candidate-sword', itemInstanceId: 'proof-candidate-sword-1', name: '玄鐵長劍', desc: '用於已裝備武器同窗比較的候選武器', type: 'equipment', count: 1, level: 3, equipSlot: 'weapon', equipStats: { maxHp: 30 } },
      ],
    };
    player.inventory = inventory;
    const { InventoryPanel } = await import('/src/ui/panels/inventory-panel.ts');
    const { EquipmentPanel } = await import('/src/ui/panels/equipment-panel.ts');
    const { QuestPanel } = await import('/src/ui/panels/quest-panel.ts');
    const { ActionPanel } = await import('/src/ui/panels/action-panel.ts');
    const { HUD } = await import('/src/ui/hud.ts');
    const inventoryPanel = new InventoryPanel();
    inventoryPanel.setCallbacks(
      (itemInstanceId, count) => calls.push({ kind: 'use', itemInstanceId, count }), () => {}, () => {}, () => {}, () => {},
      (itemInstanceId) => calls.push({ kind: 'equip', itemInstanceId }), () => {}, () => {},
    );
    inventoryPanel.syncPlayerContext(player);
    inventoryPanel.update(inventory);
    const equipmentPanel = new EquipmentPanel();
    equipmentPanel.setCallbacks((slot, itemInstanceId) => calls.push({ kind: 'unequip', slot, itemInstanceId }));
    equipmentPanel.syncPlayerContext(player);
    equipmentPanel.update(player.equipment, player.artifacts);
    const questPanel = new QuestPanel();
    questPanel.setCallbacks((questId) => calls.push({ kind: 'quest', questId }));
    questPanel.setCurrentMapId(player.mapId);
    questPanel.syncInventory(inventory);
    questPanel.update([{
      id: 'proof-main-quest', title: '初入道途', line: 'main', status: 'active', desc: '前往村口與引路人交談',
      objectiveType: 'talk', objectiveText: '與引路人交談', progress: 0, required: 1, targetName: '引路人',
      targetMonsterId: '', rewardText: '少量靈石', rewardItemId: '', rewardItemIds: [], rewards: [], giverId: 'proof-guide', giverName: '引路人',
    }]);
    const actionPanel = new ActionPanel();
    actionPanel.setCallbacks((actionId) => calls.push({ kind: 'action', actionId }));
    actionPanel.update([{ id: 'proof-rest', name: '吐納調息', desc: '以靈氣調整內息', type: 'interact', category: 'interact' }], false, false, player);
    const hud = new HUD();
    hud.update(player, { mapName: '驗證山谷', titleLabel: '築基修士', showRealmAction: false });
    const runtimeErrors = [];
    window.addEventListener('error', (event) => runtimeErrors.push(String(event.error?.stack ?? event.message)));
    window.addEventListener('unhandledrejection', (event) => runtimeErrors.push(String(event.reason?.stack ?? event.reason)));
    window.__gameWorkspaceProof = { calls, player, inventory, inventoryPanel, equipmentPanel, questPanel, actionPanel, hud, nextPaint, runtimeErrors };
    await nextPaint();
    return {
      inventoryCells: document.querySelectorAll('[data-inventory-grid="true"] [data-open-item]').length,
      questRows: document.querySelectorAll('[data-quest-id], [data-quest-line]').length,
      actionTabs: document.querySelectorAll('[data-action-tab]').length,
      hpText: document.getElementById('hud-hp-text')?.textContent,
      qiText: document.getElementById('hud-qi-text')?.textContent,
    };
  })()
`;

const measureShellExpression = String.raw`
  (() => {
    const shell = document.getElementById('game-shell');
    const workspace = document.getElementById('game-workspace');
    const dock = document.getElementById('game-dock');
    if (!(shell instanceof HTMLElement) || !(workspace instanceof HTMLElement) || !(dock instanceof HTMLElement)) {
      throw new Error('主舞台工作窗結構不完整');
    }
    const visible = (node) => node instanceof HTMLElement && node.getClientRects().length > 0;
    const rect = (node) => { const value = node.getBoundingClientRect(); return { left: value.left, top: value.top, right: value.right, bottom: value.bottom }; };
    return { mode: shell.dataset.workspaceMode, workspaceHidden: workspace.classList.contains('hidden'), workspaceVisible: visible(workspace), dockVisible: visible(dock), dock: rect(dock), viewport: { width: innerWidth, height: innerHeight } };
  })()
`;

const openWorkspaceExpression = String.raw`
  (async () => {
    const button = document.querySelector('[data-workspace-open="items"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error('未找到正式背包工作窗入口');
    button.click();
    await window.__gameWorkspaceProof.nextPaint();
    return {
      hidden: document.getElementById('game-workspace')?.classList.contains('hidden'),
      inventoryVisible: document.getElementById('pane-inventory')?.getClientRects().length > 0,
      active: document.activeElement?.id ?? document.activeElement?.getAttribute('data-workspace-open') ?? null,
    };
  })()
`;

const closeWorkspaceExpression = String.raw`
  (async () => {
    const close = document.querySelector('#game-workspace .workspace-close');
    if (!(close instanceof HTMLButtonElement)) throw new Error('未找到正式工作窗返回控制');
    close.click();
    await window.__gameWorkspaceProof.nextPaint();
    return {
      hidden: document.getElementById('game-workspace')?.classList.contains('hidden'),
      focusInsideHidden: document.getElementById('game-workspace')?.contains(document.activeElement) ?? false,
      calls: window.__gameWorkspaceProof.calls.slice(),
    };
  })()
`;

const preserveInputExpression = String.raw`
  (async () => {
    const input = document.querySelector('.inventory-search-input');
    if (!(input instanceof HTMLInputElement)) throw new Error('未找到正式背包文字輸入框');
    const pane = document.getElementById('pane-inventory');
    input.value = '赤鐵';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (pane instanceof HTMLElement) pane.scrollTop = Math.max(1, pane.scrollHeight);
    document.querySelector('[data-workspace-open="quests"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await window.__gameWorkspaceProof.nextPaint();
    document.querySelector('[data-workspace-open="items"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await window.__gameWorkspaceProof.nextPaint();
    const restored = document.querySelector('.inventory-search-input');
    return { value: restored instanceof HTMLInputElement ? restored.value : null, scrollTop: pane instanceof HTMLElement ? pane.scrollTop : -1 };
  })()
`;

const verifyAllWorkspacesExpression = String.raw`
  (async () => {
    const expected = [
      ['character', '人物'], ['items', '物品與裝備'], ['cultivation', '修行'], ['craft', '技藝與行動'],
      ['quests', '任務日誌'], ['social', '社交'], ['market', '坊市'], ['world', '世界'], ['system', '系統與協助'],
    ];
    const menu = document.getElementById('workspace-menu-toggle');
    if (!(menu instanceof HTMLButtonElement)) throw new Error('未找到全部功能入口');
    const results = [];
    for (const [id, title] of expected) {
      menu.click();
      await window.__gameWorkspaceProof.nextPaint();
      const entry = document.querySelector('#workspace-menu [data-workspace-open="' + id + '"]');
      if (!(entry instanceof HTMLButtonElement)) throw new Error('全部功能缺少分類：' + id);
      entry.click();
      await window.__gameWorkspaceProof.nextPaint();
      const activeTab = document.querySelector('#game-workspace-controls [role="tab"][aria-selected="true"]');
      const paneId = activeTab?.getAttribute('aria-controls');
      const pane = paneId ? document.getElementById(paneId) : null;
      const activePane = pane instanceof HTMLElement && document.getElementById('game-workspace-body')?.contains(pane)
        && !pane.hidden && pane.getAttribute('aria-hidden') === 'false';
      results.push({ id, expectedTitle: title, title: document.getElementById('workspace-title')?.textContent, activePane });
    }
    return results;
  })()
`;

const verifyCandidateItemExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const comparison = document.querySelector('.inventory-workspace-comparison');
    const primary = document.querySelector('.inventory-workspace-detail-actions .small-btn:not(.ghost)');
    const detail = [...document.querySelectorAll('.inventory-workspace-detail-actions .small-btn.ghost')]
      .find((button) => button.textContent?.includes('完整詳情'));
    if (primary instanceof HTMLButtonElement) {
      primary.scrollIntoView({ block: 'nearest' });
      await proof.nextPaint();
      primary.click();
      await window.__gameWorkspaceProof.nextPaint();
    }
    return {
      runtimeErrors: proof.runtimeErrors,
      comparisonText: comparison?.textContent ?? '',
      candidateBonuses: [...document.querySelectorAll('.inventory-workspace-detail-section')]
        .find((section) => section.querySelector('.inventory-workspace-detail-section-title')?.textContent === '屬性與效果')?.textContent ?? '',
      candidateInstanceId: 'proof-candidate-sword-1',
      calls: window.__gameWorkspaceProof.calls.slice(),
      hasDetailAction: detail instanceof HTMLButtonElement,
    };
  })()
`;

const candidatePointerTargetExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    proof.inventoryPanel.syncPlayerContext(proof.player);
    proof.inventoryPanel.update(proof.inventory);
    await proof.nextPaint();
    const candidate = [...document.querySelectorAll('[data-inventory-grid="true"] [data-item-key*="proof-candidate-sword"]')]
      .find((node) => node instanceof HTMLElement && node.getClientRects().length > 0);
    if (!(candidate instanceof HTMLElement)) throw new Error('未找到可點選候選裝備格');
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hitCandidate: hit === candidate || candidate.contains(hit), hitDescription: hit instanceof HTMLElement ? hit.outerHTML.slice(0, 180) : String(hit) };
  })()
`;


const verifyInteractiveHitTargetsExpression = String.raw`
  (() => {
    const selectors = [
      ['工作窗返回', '#game-workspace .workspace-close'],
      ['工作窗分頁', '#game-workspace .workspace-tab[aria-selected="true"]'],
      ['候選裝備主操作', '.inventory-workspace-detail-actions .small-btn:not(.ghost)'],
    ];
    return selectors.map(([label, selector]) => {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement)) throw new Error('缺少控制：' + label);
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { label, visible: node.getClientRects().length > 0, hitTarget: hit === node || node.contains(hit), rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } };
    });
  })()
`;

const verifyDarkThemeExpression = String.raw`
  (async () => {
    const { updateUiColorMode, getUiStyleConfig } = await import('/src/ui/ui-style-config.ts');
    const workspace = document.getElementById('game-workspace');
    const before = getComputedStyle(workspace).backgroundColor;
    updateUiColorMode('dark');
    await window.__gameWorkspaceProof.nextPaint();
    return { mode: getUiStyleConfig().colorMode, applied: document.documentElement.dataset.colorMode,
      before, after: getComputedStyle(workspace).backgroundColor };
  })()
`;

const dismissGuidedTourExpression = String.raw`
  (async () => {
    let dismissed = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const layer = document.querySelector('.guided-tour-layer:not(.hidden)');
      if (!(layer instanceof HTMLElement)) break;
      const skip = layer.querySelector('[data-guided-tour-skip]');
      if (!(skip instanceof HTMLButtonElement)) throw new Error('開啟中的引導缺少正式略過控制');
      skip.click();
      dismissed += 1;
      await window.__gameWorkspaceProof.nextPaint();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return { dismissed, closed: document.querySelector('.guided-tour-layer:not(.hidden)') === null };
  })()
`;

async function setViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false,
    screenWidth: viewport.width, screenHeight: viewport.height,
  });
  await delay(80);
}

async function captureWorkspace(cdp, name) {
  if (!VISUALIZATION_DIR) return;
  await mkdir(VISUALIZATION_DIR, { recursive: true });
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(VISUALIZATION_DIR, name), Buffer.from(result.data, 'base64'));
}

function assertInsideViewport(rect, viewport, label) {
  assert(rect.left >= -1 && rect.right <= viewport.width + 1 && rect.top >= -1 && rect.bottom <= viewport.height + 1,
    `${label}超出視口：${JSON.stringify({ rect, viewport })}`);
}

await withClientBrowserProof({ viewport: PHONE, profilePrefix: 'game-workspace-proof-' }, async (cdp) => {
  // 舊 active tab 不得在啟動時自動打開按需工作窗。
  await cdp.evaluate(`localStorage.setItem('mud:side-panel-state:v1', JSON.stringify({ version: 1, activeTabs: { 'side-primary': 'inventory' } })); location.reload(); true`);
  await waitFor(() => cdp.evaluate(`document.readyState === 'complete' && document.getElementById('game-shell')?.dataset.workspaceMode === 'true'`), '工作窗控制器初始化');
  const initial = await cdp.evaluate(measureShellExpression);
  assert.equal(initial.mode, 'true', '主舞台未啟用 workspace mode');
  assert.equal(initial.workspaceHidden, true, '舊 active tab 在初始載入時打開了工作窗');

  // 此 proof 不登入或讀取憑證；以登入成功後同一份正式 shell 作畫面 fixture。
  // SidePanel、dock 與 workspace controller 都是頁面既有實例，沒有建立第二個控制器。
  await cdp.evaluate(`document.getElementById('game-shell')?.classList.remove('hidden'); document.getElementById('login-overlay')?.classList.add('hidden'); document.getElementById('hud')?.classList.remove('hidden'); document.body.dataset.workspaceProofFixture = 'true'; true`);
  await waitFor(() => cdp.evaluate(`document.getElementById('game-dock')?.getClientRects().length`), '登入後主舞台 shell 顯示');
  const shown = await cdp.evaluate(measureShellExpression);
  assert.equal(shown.dockVisible, true, '主舞台缺少可達的功能入口');
  assertInsideViewport(shown.dock, shown.viewport, '手機功能入口');

  const fixture = await cdp.evaluate(fixtureExpression);
  assert(fixture.inventoryCells > 0, '正式背包 Panel 未載入非空 fixture');
  assert(fixture.actionTabs > 0, '正式行動 Panel 未載入非空 fixture');
  assert.match(fixture.hpText ?? '', /680\s*\/\s*1000/, '正式 HUD 未顯示 fixture 氣血');
  assert.match(fixture.qiText ?? '', /66\s*\/\s*400/, '正式 HUD 未顯示 fixture 靈氣');
  const guidedTour = await cdp.evaluate(dismissGuidedTourExpression);
  assert.equal(guidedTour.closed, true, '工作窗開啟前未先關閉可攔截操作的引導層');

  const allWorkspaces = await cdp.evaluate(verifyAllWorkspacesExpression);
  assert.equal(allWorkspaces.length, 9, '全部功能缺少工作分類');
  for (const workspace of allWorkspaces) {
    assert.equal(workspace.title, workspace.expectedTitle, `工作分類未切換：${workspace.id}`);
    assert.equal(workspace.activePane, true, `工作分類未對應到可見正式 pane：${workspace.id}`);
  }
  const guidedTourAfterNavigation = await cdp.evaluate(dismissGuidedTourExpression);
  assert.equal(guidedTourAfterNavigation.closed, true, '工作分類切換後仍有可攔截操作的引導層');

  // 任務面板的正式可見性觀察器會延後 flush；經真實 dock 顯示一次，不能用手動 class 模擬。
  const questFixture = await cdp.evaluate(`(async () => {
    document.querySelector('[data-workspace-open="quests"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await window.__gameWorkspaceProof.nextPaint();
    return document.querySelectorAll('[data-quest-id], [data-quest-line]').length;
  })()`);
  assert(questFixture > 0, '正式任務 Panel 未載入非空 fixture');

  const opened = await cdp.evaluate(openWorkspaceExpression);
  assert.equal(opened.hidden, false, '點擊正式背包入口未開啟工作窗');
  assert.equal(opened.inventoryVisible, true, '背包工作頁未顯示既有 pane');
  const guidedTourBeforeItemAction = await cdp.evaluate(dismissGuidedTourExpression);
  assert.equal(guidedTourBeforeItemAction.closed, true, '背包操作前仍有可攔截操作的引導層');
  const candidateTarget = await cdp.evaluate(candidatePointerTargetExpression);
  assert.equal(candidateTarget.hitCandidate, true, `候選裝備格中心被浮動視窗遮擋：${candidateTarget.hitDescription}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: candidateTarget.x, y: candidateTarget.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: candidateTarget.x, y: candidateTarget.y, button: 'left', clickCount: 1 });
  await delay(50);
  const candidate = await cdp.evaluate(verifyCandidateItemExpression);
  assert.deepEqual(candidate.runtimeErrors, [], '候選裝備詳情流程出現未處理 runtime error');
  assert.match(candidate.comparisonText, /驗證鐵劍/, '候選裝備未顯示目前已裝備比較');
  assert.match(candidate.comparisonText, /\+18/, '目前裝備沒有顯示真實屬性值');
  assert.match(candidate.candidateBonuses, /\+30/, '候選裝備沒有顯示真實屬性值');
  assert.equal(candidate.hasDetailAction, true, '候選裝備缺少完整詳情與更多操作入口');
  assert.equal(candidate.calls.some((entry) => entry.kind === 'equip' && entry.itemInstanceId === 'proof-candidate-sword-1'), true,
    '候選裝備主操作未保留原始 itemInstanceId');
  const hitTargets = await cdp.evaluate(verifyInteractiveHitTargetsExpression);
  for (const target of hitTargets) {
    assert.equal(target.visible, true, `${target.label}不可見`);
    assert.equal(target.hitTarget, true, `${target.label}中心被浮動視窗遮擋：${JSON.stringify(target.rect)}`);
  }
  await captureWorkspace(cdp, 'implemented-phone.png');
  await captureWorkspace(cdp, 'implemented-candidate-comparison.png');

  const preservedPhone = await cdp.evaluate(preserveInputExpression);
  assert.equal(preservedPhone.value, '赤鐵', '切換工作分類後背包搜尋文字遺失');
  assert(preservedPhone.scrollTop >= 0, '切換工作分類後背包捲動狀態不可讀');

  await setViewport(cdp, LANDSCAPE);
  const landscape = await cdp.evaluate(measureShellExpression);
  assertInsideViewport(landscape.dock, landscape.viewport, '橫向手機功能入口');
  const preservedLandscape = await cdp.evaluate(preserveInputExpression);
  assert.equal(preservedLandscape.value, '赤鐵', '橫向手機切換後背包搜尋文字遺失');
  await captureWorkspace(cdp, 'implemented-landscape.png');

  await setViewport(cdp, DESKTOP);
  const desktop = await cdp.evaluate(measureShellExpression);
  assertInsideViewport(desktop.dock, desktop.viewport, '桌面功能入口');
  await captureWorkspace(cdp, 'implemented-desktop.png');

  const darkTheme = await cdp.evaluate(verifyDarkThemeExpression);
  assert.equal(darkTheme.mode, 'dark', '正式主題偏好未切為深色');
  assert.equal(darkTheme.applied, 'dark', '正式主題 API 未套用深色模式');
  assert.notEqual(darkTheme.after, darkTheme.before, '工作窗仍使用淺色背景');
  await captureWorkspace(cdp, 'implemented-dark.png');
  await cdp.evaluate(`(async () => { const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts'); updateUiColorMode('light'); await window.__gameWorkspaceProof.nextPaint(); })()`);

  // Escape 先關工作窗；它不得當作取消活動意圖送至 fixture callback。
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await delay(80);
  const escaped = await cdp.evaluate(`({ hidden: document.getElementById('game-workspace')?.classList.contains('hidden'), calls: window.__gameWorkspaceProof.calls.slice(), focusInside: document.getElementById('game-workspace')?.contains(document.activeElement) ?? false })`);
  assert.equal(escaped.hidden, true, 'Escape 未關閉工作窗');
  assert.equal(escaped.focusInside, false, 'Escape 後焦點仍停在 hidden 工作窗');
  assert.equal(escaped.calls.some((entry) => entry.kind === 'cancel'), false, '關閉工作窗錯誤發出取消活動意圖');

  await cdp.evaluate(openWorkspaceExpression);
  const closed = await cdp.evaluate(closeWorkspaceExpression);
  assert.equal(closed.hidden, true, '返回地圖未關閉工作窗');
  assert.equal(closed.focusInsideHidden, false, '返回地圖後焦點仍停在 hidden 工作窗');
  assert.equal(closed.calls.some((entry) => entry.kind === 'cancel'), false, '返回地圖錯誤發出取消活動意圖');
});

console.log('game workspace proof: PASS');
