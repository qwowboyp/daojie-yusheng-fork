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
const PHONE_BROWSER_CHROME = { width: 390, height: 670 };
const PHONE_SMALL = { width: 375, height: 667 };
const LANDSCAPE = { width: 844, height: 390 };
const DESKTOP = { width: 1440, height: 900 };
const SQUARE_DESKTOP = { width: 900, height: 900 };
const LARGE_DESKTOP = { width: 3727, height: 2233 };
const VISUALIZATION_DIR = process.env.WORKSPACE_PROOF_OUTPUT_DIR;

const fixtureExpression = String.raw`
  (async () => {
    const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const calls = [];
    const player = {
      id: 'workspace-proof-player', mapId: 'starter_village', realmLv: 30, level: 30,
      name: '驗證玩家長名', displayName: '驗證玩家長名',
      realm: { realmLv: 30, stage: 'qi_refining', displayName: '煉氣境', review: '初窺門徑', progress: 660, progressToNext: 1000,
        breakthroughReady: true, breakthrough: { canBreakthrough: true, targetDisplayName: '築基境' } }, foundation: 18, qi: 66000,
      x: 14, y: 22, viewRange: 12, hp: 680000, maxHp: 1000000, numericStats: { maxQi: 400000 },
      equipment: { weapon: { itemId: 'proof-iron-sword', itemInstanceId: 'proof-sword', name: '驗證鐵劍', desc: '目前裝備的對照武器', type: 'equipment', count: 1, level: 2, equipSlot: 'weapon', equipStats: { maxHp: 18 } } },
      artifacts: [], techniques: [], unlockedMinimapIds: [], inventory: { capacity: 24, items: [] }, quests: [],
    };
    const inventory = {
      revision: 1, capacity: 24, serverTick: 120, cooldowns: [],
      items: [
        { itemId: 'proof-healing-pill', itemInstanceId: 'proof-healing-pill-1', name: '回春散', desc: '按需工作窗 proof 道具', type: 'consumable', count: 3, level: 1, baselineHealPercent: 1 },
        { itemId: 'proof-ore', itemInstanceId: 'proof-ore-1', name: '赤鐵礦', desc: '非空背包驗證資料', type: 'material', count: 12, level: 1 },
        { itemId: 'proof-candidate-sword', itemInstanceId: 'proof-candidate-sword-1', name: '超級大把的寶劍・百煉玄鐵長劍', desc: '用於已裝備武器同窗比較的候選武器', type: 'equipment', count: 1, level: 3, equipSlot: 'weapon', equipStats: { maxHp: 30 } },
      ],
    };
    player.inventory = inventory;
    const { InventoryPanel } = await import('/src/ui/panels/inventory-panel.ts');
    const { EquipmentPanel } = await import('/src/ui/panels/equipment-panel.ts');
    const { QuestPanel } = await import('/src/ui/panels/quest-panel.ts');
    const { ActionPanel } = await import('/src/ui/panels/action-panel.ts');
    const { HUD } = await import('/src/ui/hud.ts');
    const { ActivityPanel } = await import('/src/ui/activity-panel.ts');
    new ActivityPanel({ socket: {}, isConnected: () => false }).bind();
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
    actionPanel.setCallbacks((actionId, requiresTarget, targetMode, range, actionName) => calls.push({
      kind: 'action', actionId, requiresTarget, targetMode, range, actionName,
    }));
    const fixtureActions = [
      { id: 'wang_qi:toggle', name: '王氣切換', desc: '常駐工具動作，不應顯示為附近行動', type: 'interact', category: 'interact' },
      { id: 'proof-nearby-interact', name: '調查石碑', desc: '調查附近的古老石碑', type: 'interact', category: 'interact', cooldownLeft: 0, requiresTarget: false },
      { id: 'proof-nearby-travel', name: '傳送至：地方老爹爹', desc: '沿著山間古道前往已發現的傳送地點。', type: 'travel', cooldownLeft: 0, requiresTarget: false },
      { id: 'proof-nearby-sect', name: '進入宗門：地方老爹爹', desc: '進入附近宗門領地，查看此處提供的交互。', type: 'travel', cooldownLeft: 0, requiresTarget: false },
      { id: 'proof-craft-action', name: '技藝操作', desc: '保留在技藝工作窗的操作', type: 'craft', cooldownLeft: 0, requiresTarget: false },
      { id: 'battle:force_attack', name: '強攻', desc: '對指定目標發動強攻', type: 'battle', cooldownLeft: 0, requiresTarget: true, targetMode: 'any', range: 4 },
      { id: 'travel:return_spawn', name: '遁返', desc: '返回綁定的復活點', type: 'travel', cooldownLeft: 0, requiresTarget: false },
      { id: 'loot:open', name: '拿取', desc: '拿取指定地格的物品', type: 'toggle', cooldownLeft: 0, requiresTarget: true, targetMode: 'tile', range: 1 },
      { id: 'client:observe', name: '觀察', desc: '觀察指定地格', type: 'toggle', cooldownLeft: 0, requiresTarget: true, targetMode: 'tile', range: 8 },
    ];
    actionPanel.update(fixtureActions, false, false, player);
    // 正式 SidePanel 已在頁面啟動時建立自己的 ActionPanel。本 proof 的 fixture
    // 必須接住它的 workspace 回呼，才能驗證真實導航是否把同一 pane 掛到正確分區。
    const showWorkspaceSection = ActionPanel.prototype.showWorkspaceSection;
    const hideWorkspaceSection = ActionPanel.prototype.hideWorkspaceSection;
    ActionPanel.prototype.showWorkspaceSection = function(section, host) {
      return showWorkspaceSection.call(actionPanel, section, host);
    };
    ActionPanel.prototype.hideWorkspaceSection = function() {
      return hideWorkspaceSection.call(actionPanel);
    };
    const quickActionsHost = document.getElementById('chat-quick-actions');
    if (quickActionsHost instanceof HTMLElement && typeof actionPanel.mountQuickActions === 'function') {
      actionPanel.mountQuickActions(quickActionsHost);
    }
    const hud = new HUD();
    hud.setCallbacks(() => calls.push({ kind: 'breakthrough' }));
    hud.update(player, { mapName: '驗證山谷', titleLabel: '築基修士', showRealmAction: true, realmActionLabel: '突破' });
    const mapStage = document.getElementById('game-stage');
    let mapRuntime = null;
    let mapPixels = [];
    if (mapStage instanceof HTMLElement) {
      const mapHost = document.createElement('div');
      mapHost.id = 'workspace-proof-real-map';
      mapHost.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden;';
      const mapCanvas = document.createElement('canvas');
      mapCanvas.id = 'workspace-proof-map-canvas';
      mapHost.appendChild(mapCanvas);
      mapStage.prepend(mapHost);
      const { createMapRuntime } = await import('/src/game-map/runtime/map-runtime.ts');
      mapRuntime = createMapRuntime();
      mapRuntime.attach(mapHost);
      const tiles = Array.from({ length: 25 }, (_, y) => Array.from({ length: 25 }, (_, x) => {
        const water = x >= 5 + Math.floor(y / 8) && x <= 7 + Math.floor(y / 8);
        return { type: water ? 'water' : 'grass', terrainType: water ? 'water' : 'cold_bog', surfaceType: Math.abs(x - 12) <= 1 ? 'road' : null,
          walkable: !water, blocksSight: false, aura: 3, occupiedBy: null, modifiedAt: null };
      }));
      mapRuntime.applyBootstrap({ self: player, mapMeta: { id: player.mapId, name: '驗證山谷', width: 128, height: 128, mapLv: 1 }, tiles,
        players: [{ id: 'proof-observer', x: player.x + 2, y: player.y, char: '觀', color: '#f5c542', kind: 'player', name: '觀察者' }] });
      mapRuntime.setViewportSize(Math.max(1, mapStage.clientWidth), Math.max(1, mapStage.clientHeight), window.devicePixelRatio || 1);
      mapRuntime.setRenderFrameObserver(() => {
        const gl = mapCanvas.getContext('webgl2');
        if (!gl || gl.isContextLost()) return;
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(mapCanvas.width / 2), Math.floor(mapCanvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        mapPixels = Array.from(pixel);
      });
      const resizeMap = () => mapRuntime.setViewportSize(mapStage.clientWidth, mapStage.clientHeight, devicePixelRatio || 1,
        mapStage.getBoundingClientRect().width / mapStage.clientWidth);
      window.addEventListener('mud:responsive-viewport-change', resizeMap);
      document.getElementById('map-map-name').querySelector('.map-map-name-text').textContent = '寒汐澤';
      document.getElementById('map-current-time-value').textContent = '23:04';
      document.getElementById('map-current-time-phase').textContent = '夜闌';
      document.getElementById('map-minimap-shell')?.classList.remove('hidden');
      await nextPaint();
    }
    const runtimeErrors = [];
    window.addEventListener('error', (event) => runtimeErrors.push(String(event.error?.stack ?? event.message)));
    window.addEventListener('unhandledrejection', (event) => runtimeErrors.push(String(event.reason?.stack ?? event.reason)));
    window.__gameWorkspaceProof = { calls, player, inventory, inventoryPanel, equipmentPanel, questPanel, actionPanel, hud, quickActions: fixtureActions, nextPaint, runtimeErrors, mapRuntime, getMapPixels: () => mapPixels };
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
      ['character', '人物', ['overview', 'attr']],
      ['items', '背包與技藝', ['inventory', 'equipment', 'alchemy', 'forging', 'enhancement', 'transmission', 'building']],
      ['cultivation', '修行', ['technique', 'body-training', 'skill']],
      ['action', '行動與自動設定', ['dialogue', 'utility', 'toggle']],
      ['quests', '任務', ['quest']], ['social', '社交', ['social']], ['market', '坊市', ['market']],
      ['world', '世界', ['map-intel', 'tianji']], ['system', '系統與協助', ['system']],
    ];
    const menu = document.getElementById('workspace-menu-toggle');
    if (!(menu instanceof HTMLButtonElement)) throw new Error('未找到其它入口');
    const results = [];
    for (const [id, title, tabs] of expected) {
      menu.click();
      await window.__gameWorkspaceProof.nextPaint();
      const entry = document.querySelector((['items', 'cultivation', 'action', 'quests'].includes(id) ? '#game-dock .workspace-dock-nav > ' : '#workspace-menu ') + '[data-workspace-open="' + id + '"]');
      if (!(entry instanceof HTMLButtonElement)) throw new Error('其它缺少分類：' + id);
      if (id === 'action' && (!entry.getClientRects().length || entry.textContent !== '行動')) throw new Error('右下角缺少可見行動入口');
      entry.click();
      await window.__gameWorkspaceProof.nextPaint();
      const tabResults = [];
      for (const tabId of tabs) {
        const tab = document.getElementById('workspace-tab-' + tabId);
        if (!(tab instanceof HTMLButtonElement)) throw new Error('工作分類缺少分頁：' + id + '/' + tabId);
        tab.click();
        await window.__gameWorkspaceProof.nextPaint();
        const paneId = tab.getAttribute('aria-controls');
        const pane = paneId ? document.getElementById(paneId) : null;
        const activePane = pane instanceof HTMLElement && document.getElementById('game-workspace-body')?.contains(pane)
          && !pane.hidden && pane.getAttribute('aria-hidden') === 'false';
        const actionPane = pane?.querySelector('#pane-action');
        const actionSection = ['skill', 'dialogue', 'utility', 'toggle'].includes(tabId)
          ? actionPane instanceof HTMLElement
            && actionPane.parentElement === pane
            && actionPane.querySelector('[data-action-pane="' + tabId + '"]') instanceof HTMLElement
            && !actionPane.querySelector('[data-action-tab]')
          : true;
        tabResults.push({ tabId, activePane, actionSection });
      }
      results.push({ id, expectedTitle: title, title: document.getElementById('workspace-title')?.textContent, tabResults });
    }
    return results;
  })()
`;

const verifyWorkspaceMenuAndShortcutExpression = String.raw`
  (async () => {
    const paint = window.__gameWorkspaceProof.nextPaint;
    const items = document.querySelector('[data-workspace-open="items"]');
    if (!(items instanceof HTMLButtonElement)) throw new Error('缺少背包入口');
    items.click();
    await paint();
    const input = document.querySelector('.inventory-search-input');
    const inventoryPane = document.getElementById('pane-inventory');
    if (!(input instanceof HTMLInputElement) || !(inventoryPane instanceof HTMLElement)) throw new Error('缺少背包搜尋控制');
    input.value = '赤鐵';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    inventoryPane.scrollTop = Math.max(1, inventoryPane.scrollHeight);
    const marketShortcut = document.querySelector('[data-workspace-shortcut="market"]');
    if (!(marketShortcut instanceof HTMLButtonElement)) throw new Error('背包缺少前往坊市捷徑');
    marketShortcut.click();
    await paint();
    const inventoryShortcut = document.querySelector('[data-workspace-shortcut="inventory"]');
    if (!(inventoryShortcut instanceof HTMLButtonElement)) throw new Error('坊市缺少返回背包捷徑');
    inventoryShortcut.click();
    await paint();
    const restoredInput = document.querySelector('.inventory-search-input');
    const menu = document.getElementById('workspace-menu-toggle');
    if (!(menu instanceof HTMLButtonElement)) throw new Error('缺少其它選單');
    if (menu.getAttribute('aria-expanded') !== 'true') menu.click();
    await paint();
    const menuRoot = document.getElementById('workspace-menu');
    const menuIds = [...menuRoot.querySelectorAll('[data-workspace-open]')].map((entry) => entry.dataset.workspaceOpen);
    const dockIds = [...document.querySelectorAll('#game-dock .workspace-dock-nav > [data-workspace-open]')].map((entry) => entry.dataset.workspaceOpen);
    const menuRect = menuRoot?.getBoundingClientRect();
    const entries = [...(menuRoot?.querySelectorAll('button[data-workspace-open]') ?? [])].map((button) => button.getBoundingClientRect());
    const menuWasOpen = menuRoot instanceof HTMLElement && !menuRoot.hidden;
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await paint();
    return {
      inputPreserved: restoredInput === input && restoredInput instanceof HTMLInputElement && restoredInput.value === '赤鐵',
      scrollPreserved: inventoryPane.scrollTop >= 0,
      menuOpen: menuWasOpen,
      menuLabel: menu.textContent,
      menuIds,
      duplicatedEntries: menuIds.filter((id) => dockIds.includes(id)),
      menuBounded: !!menuRect && menuRect.left >= 0 && menuRect.top >= 0 && menuRect.right <= innerWidth && menuRect.bottom <= innerHeight,
      menuEntrySizes: entries.map((rect) => ({ width: rect.width, height: rect.height })),
      menuClosedByOutsidePointer: menuRoot?.hidden === true,
    };
  })()
`;

const measureWorkspaceCompactnessExpression = String.raw`
  (async () => {
    const paint = window.__gameWorkspaceProof.nextPaint;
    const open = async (id) => {
      const button = document.querySelector('[data-workspace-open="' + id + '"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error('缺少工作分類入口：' + id);
      button.click();
      await paint();
      const workspace = document.getElementById('game-workspace');
      const rect = workspace?.getBoundingClientRect();
      return { compact: workspace?.dataset.compact, width: rect?.width ?? 0, height: rect?.height ?? 0 };
    };
    const items = await open('items');
    const menu = document.getElementById('workspace-menu-toggle');
    if (!(menu instanceof HTMLButtonElement)) throw new Error('缺少其它選單');
    menu.click(); await paint();
    const system = await open('system');
    return { items, system };
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

async function setViewport(cdp, viewport, { touch = true } = {}) {
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5});
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false,
    screenWidth: viewport.width, screenHeight: viewport.height,
  });
  await delay(80);
}

const measureLargeDesktopExpression = String.raw`
  (() => {
    const rect = (node) => {
      const value = node.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const html = document.documentElement;
    const root = document.getElementById('app-viewport-root');
    const hud = document.getElementById('hud');
    const name = document.querySelector('#hud-name .hud-name-text');
    const currentTime = document.getElementById('map-current-time');
    const chat = document.getElementById('chat-panel');
    const tabs = chat?.querySelector('.chat-tabs');
    const log = chat?.querySelector('.chat-log-panel.active > .chat-log');
    const picker = chat?.querySelector('[data-chat-slot-select="channel-1"]');
    if (!(root instanceof HTMLElement) || !(hud instanceof HTMLElement) || !(name instanceof HTMLElement)
      || !(currentTime instanceof HTMLElement) || !(chat instanceof HTMLElement)
      || !(tabs instanceof HTMLElement) || !(log instanceof HTMLElement) || !(picker instanceof HTMLSelectElement)) {
      throw new Error('大型桌面 proof 缺少正式 HUD、時間或聊天節點');
    }
    const channelButtons = [...chat.querySelectorAll('.chat-channel-main')].map((node) => {
      const button = node instanceof HTMLElement ? node : null;
      const style = button ? getComputedStyle(button) : null;
      return {
        text: button?.textContent?.trim() ?? '',
        visible: Boolean(button?.getClientRects().length),
        clientWidth: button?.clientWidth ?? 0,
        scrollWidth: button?.scrollWidth ?? 0,
        textOverflow: style?.textOverflow ?? '',
      };
    });
    const pickerRect = rect(picker);
    const pickerHit = document.elementFromPoint(pickerRect.left + pickerRect.width / 2, pickerRect.top + pickerRect.height / 2);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      responsive: {
        desktopScaleLock: html.dataset.desktopScaleLock,
        designLocked: root.dataset.designLocked,
        breakpoint: html.dataset.effectiveLayoutBreakpoint,
        scale: Number.parseFloat(html.style.getPropertyValue('--app-viewport-scale')),
        transform: root.style.transform,
      },
      hud: { rect: rect(hud), name: rect(name), nameText: name.textContent?.trim() ?? '' },
      time: { rect: rect(currentTime), text: currentTime.textContent?.replace(/\s+/g, '') ?? '' },
      chat: {
        visible: Boolean(chat.getClientRects().length) && getComputedStyle(chat).visibility !== 'hidden',
        rect: rect(chat),
        cssWidth: Number.parseFloat(getComputedStyle(chat).width),
        cssHeight: Number.parseFloat(getComputedStyle(chat).height),
        tabOverflowX: getComputedStyle(tabs).overflowX,
        logRect: rect(log),
        logCssHeight: Number.parseFloat(getComputedStyle(log).height),
        channels: channelButtons,
        pickerRect,
        pickerHit: pickerHit === picker || picker.contains(pickerHit),
      },
    };
  })()
`;

const openChatExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const panel = document.getElementById('chat-panel');
    if (!(panel instanceof HTMLElement)) throw new Error('未找到正式聊天面板');
    const collapse = panel.querySelector('.chat-collapse-toggle');
    if (collapse instanceof HTMLButtonElement) {
      if (panel.dataset.chatCollapsed === 'true') collapse.click();
    } else if (panel.getClientRects().length === 0) {
      const toggle = document.getElementById('workspace-chat-toggle');
      if (!(toggle instanceof HTMLButtonElement)) throw new Error('未找到正式聊天入口');
      toggle.click();
    }
    await proof.nextPaint();
    return {
      open: panel.dataset.chatCollapsed !== 'true',
      visible: panel.getClientRects().length > 0,
    };
  })()
`;

const verifyChatCollapseExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const panel = document.getElementById('chat-panel');
    const toggle = panel?.querySelector('.chat-collapse-toggle');
    const tabs = panel?.querySelector('.chat-tabs');
    const input = panel?.querySelector('#chat-input');
    const log = panel?.querySelector('.chat-log-panel.active > .chat-log');
    if (!(panel instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)
      || !(tabs instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(log instanceof HTMLElement)) {
      throw new Error('聊天缺少 header/collapse 或保留內容節點');
    }
    const refs = { tabs, input, log };
    log.scrollTop = Math.max(1, log.scrollHeight);
    const expanded = { height: panel.getBoundingClientRect().height, scrollTop: log.scrollTop };
    toggle.click();
    await proof.nextPaint();
    const collapsed = {
      height: panel.getBoundingClientRect().height,
      state: panel.dataset.chatCollapsed,
      ariaExpanded: toggle.getAttribute('aria-expanded'),
      ariaControls: toggle.getAttribute('aria-controls'),
      retained: refs.tabs.isConnected && refs.input.isConnected && refs.log.isConnected,
    };
    toggle.click();
    await proof.nextPaint();
    const reopened = {
      height: panel.getBoundingClientRect().height,
      state: panel.dataset.chatCollapsed,
      scrollTop: log.scrollTop,
      retained: refs.tabs.isConnected && refs.input.isConnected && refs.log.isConnected,
    };
    return { expanded, collapsed, reopened };
  })()
`;

const createFloatingPanelExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const { FloatingListPanel } = await import('/src/ui/floating-list-panel.ts');
    const storageKey = 'mud:game-workspace-proof-floating-activity:v1';
    localStorage.removeItem(storageKey);
    const panel = new FloatingListPanel({
      id: 'game-workspace-proof-floating-activity',
      title: '活動列表',
      storageKey,
      defaultLeft: 420,
      defaultTop: 160,
      minWidth: 360,
      maxWidth: 560,
    });
    panel.updateContent('<div style="min-height: 220px"><strong>活動進度</strong><p>每日簽到與功德月卡</p><p>長內容用於驗證浮動列表重排後仍保留在視口內。</p></div>');
    proof.floatingPanel = panel;
    await proof.nextPaint();
    const value = panel.root.getBoundingClientRect();
    return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
  })()
`;

const measureFloatingPanelExpression = String.raw`
  (() => {
    const panel = window.__gameWorkspaceProof?.floatingPanel;
    if (!panel?.root) throw new Error('未建立正式浮動列表 fixture');
    const value = panel.root.getBoundingClientRect();
    return {
      rect: { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height },
      viewport: { width: innerWidth, height: innerHeight },
      hidden: panel.root.hidden,
      collapsed: panel.root.classList.contains('is-collapsed'),
      left: panel.root.style.left,
      top: panel.root.style.top,
    };
  })()
`;

const refreshFloatingPanelExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const panel = proof?.floatingPanel;
    if (!panel?.root) throw new Error('未建立正式浮動列表 fixture');
    const before = panel.root.getBoundingClientRect();
    panel.refreshLayout();
    panel.refreshLayout();
    await proof.nextPaint();
    const after = panel.root.getBoundingClientRect();
    return {
      before: { left: before.left, top: before.top, right: before.right, bottom: before.bottom },
      after: { left: after.left, top: after.top, right: after.right, bottom: after.bottom },
    };
  })()
`;

const toggleFloatingPanelExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const panel = proof?.floatingPanel;
    const collapse = panel?.root.querySelector('[data-floating-list-collapse="true"]');
    if (!(collapse instanceof HTMLButtonElement)) throw new Error('正式浮動列表缺少摺疊控制');
    collapse.click();
    await proof.nextPaint();
    collapse.click();
    panel.refreshLayout();
    await proof.nextPaint();
    return { collapsed: panel.root.classList.contains('is-collapsed'), hidden: panel.root.hidden };
  })()
`;

const collapseFloatingPanelExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const panel = proof?.floatingPanel;
    const collapse = panel?.root.querySelector('[data-floating-list-collapse="true"]');
    if (!(collapse instanceof HTMLButtonElement)) throw new Error('正式浮動列表缺少摺疊控制');
    collapse.click();
    await proof.nextPaint();
    return { collapsed: panel.root.classList.contains('is-collapsed') };
  })()
`;

const expandFloatingPanelExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const panel = proof?.floatingPanel;
    const expand = panel?.root.querySelector('[data-floating-list-collapse="true"]');
    if (!(expand instanceof HTMLButtonElement)) throw new Error('正式浮動列表缺少展開控制');
    expand.click();
    panel.refreshLayout();
    await proof.nextPaint();
    return { collapsed: panel.root.classList.contains('is-collapsed') };
  })()
`;

const stabilizeAnchorExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const read = () => {
      const hud = document.getElementById('hud')?.getBoundingClientRect();
      const time = document.getElementById('map-current-time')?.getBoundingClientRect();
      if (!hud || !time) throw new Error('大型桌面缺少 HUD 或時間錨點');
      return { hudTop: hud.top, timeTop: time.top };
    };
    const before = read();
    const target = document.querySelector('#game-dock [data-workspace-open="action"], #game-dock [data-workspace-open="items"]');
    if (!(target instanceof HTMLElement)) throw new Error('未找到正式工作窗按鈕');
    target.focus();
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await proof.nextPaint();
    const after = read();
    return { before, after };
  })()
`;

const measureDesktopWorkspaceExpression = String.raw`
  (() => {
    const workspace = document.getElementById('game-workspace');
    const grip = workspace?.querySelector('.desktop-window-resize');
    const cell = workspace?.querySelector('#pane-inventory [data-item-key="instance:proof-candidate-sword-1"]');
    const name = cell?.querySelector('[data-item-name]');
    const count = cell?.querySelector('[data-item-count]');
    if (!(workspace instanceof HTMLElement) || !(grip instanceof HTMLButtonElement)
      || !(cell instanceof HTMLElement) || !(name instanceof HTMLElement) || !(count instanceof HTMLElement)) {
      throw new Error('桌面工作窗缺少 resize grip 或背包清單 fixture');
    }
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const workspaceRect = workspace.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const hit = document.elementFromPoint(cellRect.left + cellRect.width / 2, cellRect.top + cellRect.height / 2);
    const style = getComputedStyle(workspace);
    return {
      active: workspace.dataset.desktopWindow === 'true',
      gripVisible: !grip.hidden && Boolean(grip.getClientRects().length),
      width: workspace.offsetWidth,
      height: workspace.offsetHeight,
      cssWidth: Number.parseFloat(style.width),
      cssHeight: Number.parseFloat(style.height),
      rect: { left: workspaceRect.left, top: workspaceRect.top, right: workspaceRect.right, bottom: workspaceRect.bottom },
      cell: { name: name.textContent?.trim() ?? '', count: count.textContent?.trim() ?? '',
        nameClipped: name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 1,
        quantityLabel: getComputedStyle(count, '::before').content,
        rect: { left: cellRect.left, top: cellRect.top, width: cellRect.width, height: cellRect.height },
        hit: hit === cell || cell.contains(hit), hitDescription: hit?.outerHTML.slice(0, 180) },
      scale: Number.parseFloat(document.documentElement.style.getPropertyValue('--app-viewport-scale')) || 1,
    };
  })()
`;

const verifyMobileHudCompactExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const identity = document.querySelector('.hud-identity');
    const toggle = document.querySelector('.hud-expand-toggle');
    const details = document.getElementById('hud-summary-details');
    const topRow = document.querySelector('.hud-top-row');
    const hp = document.getElementById('hud-hp') ?? document.getElementById('hud-hp-text');
    const qi = document.getElementById('hud-qi') ?? document.getElementById('hud-qi-text');
    if (!(identity instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)
      || !(details instanceof HTMLElement) || !(topRow instanceof HTMLElement)
      || !(hp instanceof HTMLElement) || !(qi instanceof HTMLElement)) {
      throw new Error('手機 HUD 缺少 compact/expand 正式控制或血靈節點');
    }
    const readResources = () => [hp, qi].map((node) => {
      const group = node.closest('.hud-resource-head') ?? node;
      const style = getComputedStyle(group);
      return { text: node.textContent?.trim() ?? '', whiteSpace: style.whiteSpace, clipped: group.scrollWidth > group.clientWidth + 1 };
    });
    const compact = { expanded: toggle.getAttribute('aria-expanded'), identity: identity.dataset.hudExpanded,
      controls: toggle.getAttribute('aria-controls'), topRowVisible: Boolean(topRow.getClientRects().length), resources: readResources() };
    toggle.click();
    await proof.nextPaint();
    const expanded = { expanded: toggle.getAttribute('aria-expanded'), identity: identity.dataset.hudExpanded,
      topRowVisible: Boolean(topRow.getClientRects().length), resources: readResources() };
    toggle.click();
    await proof.nextPaint();
    const restored = { expanded: toggle.getAttribute('aria-expanded'), identity: identity.dataset.hudExpanded,
      topRowVisible: Boolean(topRow.getClientRects().length), resources: readResources() };
    return { compact, expanded, restored, detailsConnected: details.isConnected };
  })()
`;

const verifyHudRowsExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    proof.hud.update(proof.player, { mapName: '驗證山谷', titleLabel: '築基修士', showRealmAction: true, realmActionLabel: '突破' });
    await proof.nextPaint();
    const expandToggle = document.querySelector('.hud-expand-toggle');
    const wasExpanded = expandToggle instanceof HTMLButtonElement && expandToggle.getAttribute('aria-expanded') === 'true';
    if (expandToggle instanceof HTMLButtonElement && !wasExpanded) {
      expandToggle.click();
      await proof.nextPaint();
    }
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? '';
    const resource = (textSelector, barSelector) => {
      const value = document.querySelector(textSelector);
      const bar = document.querySelector(barSelector);
      if (!(value instanceof HTMLElement) || !(bar instanceof HTMLElement)) throw new Error('HUD 資源節點缺失：' + textSelector);
      const group = value.closest('.hud-resource-head') ?? value;
      const meter = value.closest('.hud-resource-meter') ?? bar;
      const groupStyle = getComputedStyle(group);
      const meterStyle = getComputedStyle(meter);
      return { text: value.textContent?.trim() ?? '', whiteSpace: groupStyle.whiteSpace, clipped: group.scrollWidth > group.clientWidth + 1,
        barHeight: Math.max(meter.getBoundingClientRect().height, Number.parseFloat(meterStyle.height) || 0) };
    };
    const rows = {
      name: text('#hud-name'), level: text('#hud-realm-level'), realm: text('#hud-realm'), title: text('#hud-title'),
      realmReview: text('#hud-realm-sub'), cultivate: text('#hud-cultivate'),
    };
    const nameNode = document.getElementById('hud-name');
    const levelNode = document.getElementById('hud-realm-level');
    const breakthrough = document.getElementById('hud-breakthrough');
    const hp = resource('#hud-hp-text', '#hud-hp-bar');
    const qi = resource('#hud-qi-text', '#hud-qi-bar');
    const callbackBefore = proof.calls.length;
    if (breakthrough instanceof HTMLButtonElement && !breakthrough.hidden) breakthrough.click();
    const result = { rows, hp, qi, breakthrough: breakthrough instanceof HTMLButtonElement ? {
        visible: Boolean(breakthrough.getClientRects().length) && !breakthrough.hidden,
        minHeight: Number.parseFloat(getComputedStyle(breakthrough).minHeight) || breakthrough.getBoundingClientRect().height,
        text: breakthrough.textContent?.trim() ?? '',
      } : null, breakthroughCallback: proof.calls.slice(callbackBefore).some((entry) => entry.kind === 'breakthrough'),
      levelInName: nameNode instanceof HTMLElement && levelNode instanceof HTMLElement && nameNode.contains(levelNode),
      levelTop: levelNode instanceof HTMLElement ? levelNode.getBoundingClientRect().top : -1,
      nameTop: nameNode instanceof HTMLElement ? nameNode.getBoundingClientRect().top : -1 };
    if (expandToggle instanceof HTMLButtonElement && !wasExpanded) {
      expandToggle.click();
      await proof.nextPaint();
    }
    return result;
  })()
`;

const verifyInteractionAndQuickActionsExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const nextPaint = proof.nextPaint;
    const panel = document.getElementById('floating-interaction-list');
    const zoom = document.querySelector('.map-zoom-stack');
    const readPanel = () => {
      const node = document.getElementById('floating-interaction-list');
      if (!(node instanceof HTMLElement)) return null;
      const rect = node.getBoundingClientRect();
      return { node, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        collapsed: node.dataset.collapsed === 'true' || node.classList.contains('is-collapsed'),
        buttons: [...node.querySelectorAll('.floating-interaction-quick-btn')].map((button) => ({
          id: button.getAttribute('data-action') ?? button.getAttribute('data-action-exec') ?? '',
          disabled: button instanceof HTMLButtonElement && button.disabled,
          visible: Boolean(button.getClientRects().length),
        })) };
    };
    const initialPanel = readPanel();
    const nearbyCollapse = panel?.querySelector('[data-floating-list-collapse="true"]');
    if (initialPanel?.collapsed && nearbyCollapse instanceof HTMLButtonElement) {
      nearbyCollapse.click();
      await nextPaint();
    }
    const nearbyButton = panel?.querySelector('.floating-interaction-quick-btn[data-action="proof-nearby-interact"]');
    let nearbyHoverDescription = '';
    let nearbyFocusDescription = '';
    if (nearbyButton instanceof HTMLButtonElement) {
      nearbyButton.dispatchEvent(new MouseEvent('mouseenter', { clientX: 80, clientY: 220 }));
      await nextPaint();
      nearbyHoverDescription = document.querySelector('.floating-tooltip.visible')?.textContent?.trim() ?? '';
      nearbyButton.dispatchEvent(new MouseEvent('mouseleave'));
      nearbyButton.focus();
      await nextPaint();
      nearbyFocusDescription = document.querySelector('.floating-tooltip.visible')?.textContent?.trim() ?? '';
      nearbyButton.blur();
    }
    if (initialPanel?.collapsed && nearbyCollapse instanceof HTMLButtonElement) {
      nearbyCollapse.click();
      await nextPaint();
    }
    const quickHost = document.getElementById('chat-quick-actions');
    const quickButtons = quickHost ? [...quickHost.querySelectorAll('.chat-action-buttons [data-quick-action-id]')] : [];
    const expected = ['battle:force_attack', 'travel:return_spawn', 'loot:open', 'client:observe'];
    const quick = expected.map((id) => {
      const button = quickButtons.find((entry) => entry.getAttribute('data-quick-action-id') === id);
      if (!(button instanceof HTMLButtonElement)) throw new Error('聊天快捷行動缺失：' + id);
      const description = proof.quickActions.find((action) => action.id === id)?.desc ?? '';
      return { id, button, description, disabled: button.disabled, visible: Boolean(button.getClientRects().length) };
    });
    const callsBeforeHover = proof.calls.length;
    const hoverDescriptions = {};
    for (const entry of quick) {
      entry.button.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      entry.button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await nextPaint();
      hoverDescriptions[entry.id] = document.querySelector('.floating-tooltip.visible')?.textContent?.trim() ?? '';
      entry.button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    }
    await nextPaint();
    const hoverCallCount = proof.calls.length;
    for (const entry of quick) {
      if (entry.disabled) continue;
      entry.button.click();
      await nextPaint();
    }
    const actionCalls = proof.calls.filter((entry) => entry.kind === 'action' && expected.includes(entry.actionId));
    const coolingActions = proof.quickActions.map((action) => action.id === 'client:observe' ? { ...action, cooldownLeft: 3 } : action);
    proof.actionPanel.update(coolingActions, false, false, proof.player);
    if (quickHost instanceof HTMLElement && typeof proof.actionPanel.mountQuickActions === 'function') proof.actionPanel.mountQuickActions(quickHost);
    await nextPaint();
    const cooledObserve = quickHost?.querySelector('[data-quick-action-id="client:observe"]');
    const input = document.getElementById('chat-input');
    if (!(input instanceof HTMLInputElement)) throw new Error('聊天快捷行動驗證缺少輸入框');
    input.focus();
    const focusBeforeDisclosure = document.activeElement === input;
    const toggle = quickHost?.querySelector('.chat-action-toggle');
    let disclosure = null;
    if (toggle instanceof HTMLButtonElement) {
      if (toggle.getAttribute('aria-expanded') !== 'true') {
        toggle.click();
        await nextPaint();
      }
      const row = quickHost.querySelector('.chat-action-buttons');
      const help = quickHost.querySelector('.chat-action-help');
      disclosure = { expanded: toggle.getAttribute('aria-expanded'), rowVisible: row instanceof HTMLElement && Boolean(row.getClientRects().length),
        helpInteractive: help instanceof HTMLDetailsElement && help.querySelector('summary') instanceof HTMLElement,
        inputRetained: input.isConnected, focusAfter: document.activeElement === input };
    }
    const panelAfter = readPanel();
    const zoomRect = zoom?.getBoundingClientRect();
    return {
      nearby: initialPanel ? { visible: Boolean(initialPanel.node.getClientRects().length), collapsed: initialPanel.collapsed, buttons: initialPanel.buttons,
        hoverDescription: nearbyHoverDescription, focusDescription: nearbyFocusDescription,
        belowZoom: zoomRect ? initialPanel.rect.top >= zoomRect.bottom - 2 : false } : null,
      quick: quick.map(({ id, description, disabled, visible }) => ({ id, description, disabled, visible })),
      hoverCallCount, callsBeforeHover, hoverDidNotExecute: hoverCallCount === callsBeforeHover, hoverDescriptions,
      actionCalls, expectedTargeting: actionCalls.map(({ actionId, requiresTarget, targetMode, range }) => ({ actionId, requiresTarget, targetMode, range })),
      cooldownDisabled: cooledObserve instanceof HTMLButtonElement && cooledObserve.disabled,
      disclosure, focusBeforeDisclosure, inputRetained: input.isConnected, panelAfter: panelAfter ? panelAfter.buttons : [],
    };
  })()
`;

const verifyMobileInteractionExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const panel = document.getElementById('floating-interaction-list');
    if (!(panel instanceof HTMLElement)) throw new Error('手機真實附近行動浮窗不存在');
    const collapse = panel.querySelector('[data-floating-list-collapse="true"]');
    if (!(collapse instanceof HTMLButtonElement)) throw new Error('手機附近行動缺少收合控制');
    const initiallyCollapsed = panel.classList.contains('is-collapsed') || panel.dataset.collapsed === 'true';
    if (!initiallyCollapsed) collapse.click();
    await proof.nextPaint();
    const collapsed = panel.classList.contains('is-collapsed') || panel.dataset.collapsed === 'true';
    collapse.click();
    await proof.nextPaint();
    const nearby = panel.querySelector('.floating-interaction-quick-btn[data-action="proof-nearby-interact"], .floating-interaction-quick-btn[data-action-exec="proof-nearby-interact"]');
    const before = proof.calls.length;
    if (!(nearby instanceof HTMLButtonElement)) throw new Error('手機附近行動缺少真實 action 按鈕');
    const expanded = !panel.classList.contains('is-collapsed');
    const visible = Boolean(nearby.getClientRects().length);
    nearby.click();
    await proof.nextPaint();
    return { initiallyCollapsed, collapsed, expanded,
      executed: proof.calls.slice(before).some((entry) => entry.kind === 'action' && entry.actionId === 'proof-nearby-interact'),
      visible, closedAfterAction: panel.classList.contains('is-collapsed') };
  })()
`;

const verifyMobileSurfaceExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const shell = document.getElementById('game-shell');
    const stage = document.getElementById('game-stage');
    const canvas = document.getElementById('workspace-proof-map-canvas') ?? document.getElementById('game-canvas');
    const hud = document.getElementById('hud');
    const dockButtons = [...document.querySelectorAll('#game-dock .workspace-dock-nav > button')];
    const mapToggle = document.getElementById('mobile-map-tools-toggle');
    const zoom = document.querySelector('.map-zoom-stack');
    const chatInput = document.getElementById('chat-input');
    if (chatInput instanceof HTMLInputElement) {
      chatInput.value = '赤鐵';
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (!(shell instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) throw new Error('手機主舞台缺少正式地圖 canvas');
    if (proof.mapRuntime) proof.mapRuntime.setViewportSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight), devicePixelRatio || 1);
    await proof.nextPaint();
    const chatToggle = document.getElementById('workspace-chat-toggle');
    if (chatToggle instanceof HTMLButtonElement && chatToggle.getAttribute('aria-expanded') === 'true') { chatToggle.click(); await proof.nextPaint(); }
    const nearbyPanel = document.getElementById('floating-interaction-list');
    const nearbyCollapse = nearbyPanel?.querySelector('[data-floating-list-collapse="true"]');
    if (nearbyPanel instanceof HTMLElement && nearbyCollapse instanceof HTMLButtonElement && !(nearbyPanel.classList.contains('is-collapsed') || nearbyPanel.dataset.collapsed === 'true')) { nearbyCollapse.click(); await proof.nextPaint(); }
    const actionToggle = document.querySelector('.chat-action-toggle');
    if (actionToggle instanceof HTMLButtonElement && actionToggle.getAttribute('aria-expanded') === 'true') { actionToggle.click(); await proof.nextPaint(); }
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const renderedPixel = proof.getMapPixels();
    const center = { x: stageRect.left + stageRect.width / 2, y: stageRect.top + stageRect.height * 0.48 };
    const centerElement = document.elementFromPoint(center.x, center.y);
    const visiblePanels = ['#game-workspace', '#chat-panel', '#floating-interaction-list'].flatMap((selector) => {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement) || node.hidden || !node.getClientRects().length) return [];
      const rect = node.getBoundingClientRect();
      return rect.left <= center.x && rect.right >= center.x && rect.top <= center.y && rect.bottom >= center.y ? [selector] : [];
    });
    const base = {
      viewport: { width: innerWidth, height: innerHeight },
      hudHeight: hud?.getBoundingClientRect().height ?? -1,
      canvas: { width: canvas.width, height: canvas.height, cssWidth: canvasRect.width, cssHeight: canvasRect.height, renderedPixel,
        rendered: renderedPixel.slice(0, 3).some((value) => value > 0) && !!proof.mapRuntime.getKnownTileAt(proof.player.x, proof.player.y) },
      centerMapHit: centerElement === canvas || centerElement instanceof HTMLElement && (centerElement === stage || stage.contains(centerElement)),
      centerCoveredBy: visiblePanels,
      dockCount: dockButtons.length,
      dockMinHeight: Math.min(...dockButtons.map((button) => button.getBoundingClientRect().height)),
      touchTargets: ['#mobile-map-tools-toggle', '#workspace-chat-toggle', '.chat-action-toggle', '#floating-interaction-list [data-floating-list-collapse="true"]'].map((selector) => {
        const node = document.querySelector(selector); return { selector, height: node instanceof HTMLElement ? node.getBoundingClientRect().height : 0, visible: node instanceof HTMLElement && Boolean(node.getClientRects().length) };
      }),
      mapTools: { expanded: mapToggle?.getAttribute('aria-expanded'), shellOpen: shell.dataset.mapToolsOpen, zoomVisible: Boolean(zoom?.getClientRects().length) },
      inputConnected: chatInput instanceof HTMLInputElement && chatInput.isConnected,
      inputValue: chatInput instanceof HTMLInputElement ? chatInput.value : '',
    };
    if (!(mapToggle instanceof HTMLButtonElement)) throw new Error('手機地圖工具開關不存在');
    mapToggle.click();
    await proof.nextPaint();
    const opened = { expanded: mapToggle.getAttribute('aria-expanded'), shellOpen: shell.dataset.mapToolsOpen,
      zoomVisible: Boolean(zoom?.getClientRects().length), zoomHit: zoom instanceof HTMLElement && zoom.getClientRects().length > 0 };
    const menu = document.getElementById('workspace-menu-toggle');
    if (!(menu instanceof HTMLButtonElement)) throw new Error('手機其它入口不存在');
    menu.click();
    await proof.nextPaint();
    const mutuallyExclusive = { menuOpen: menu.getAttribute('aria-expanded') === 'true', mapClosed: shell.dataset.mapToolsOpen === 'false' };
    menu.click();
    await proof.nextPaint();
    if (shell.dataset.mapToolsOpen === 'true') { mapToggle.click(); await proof.nextPaint(); }
    const nearby = document.getElementById('floating-interaction-list');
    const actionsToggle = document.querySelector('.chat-action-toggle');
    if (nearby instanceof HTMLElement && actionsToggle instanceof HTMLButtonElement) {
      const collapse = nearby.querySelector('[data-floating-list-collapse="true"]');
      if (collapse instanceof HTMLButtonElement && (nearby.classList.contains('is-collapsed') || nearby.dataset.collapsed === 'true')) { collapse.click(); await proof.nextPaint(); }
      if (actionsToggle.getAttribute('aria-expanded') !== 'true') actionsToggle.click();
      await proof.nextPaint();
    }
    const actionsExclusive = nearby instanceof HTMLElement && (nearby.classList.contains('is-collapsed') || nearby.dataset.collapsed === 'true');
    (await import('/src/ui/mobile-surface.ts')).requestMobileSurface(null);
    await proof.nextPaint();
    return { base, opened, mutuallyExclusive, actionsExclusive,
      actionInput: chatInput instanceof HTMLInputElement ? { connected: chatInput.isConnected, value: chatInput.value, focused: document.activeElement === chatInput } : null };
  })()
`;

const mockVisualViewportExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const original = window.visualViewport;
    const fake = new EventTarget();
    Object.defineProperties(fake, {
      width: { configurable: true, value: 390 }, height: { configurable: true, value: 390 },
      offsetLeft: { configurable: true, value: 0 }, offsetTop: { configurable: true, value: 40 }, scale: { configurable: true, value: 1 },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
    window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('scroll'));
    await proof.nextPaint();
    const root = document.getElementById('app-viewport-root');
    const input = document.getElementById('chat-input');
    input?.focus();
    window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('scroll'));
    await proof.nextPaint();
    const keyboard = { marker: document.documentElement.dataset.mobileKeyboard, rootWidth: root?.getBoundingClientRect().width ?? -1,
      rootHeight: root?.getBoundingClientRect().height ?? -1, inputVisible: Boolean(input?.getClientRects().length),
      inputBottom: input?.getBoundingClientRect().bottom ?? -1, visualHeight: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop,
      cssOffsetY: Number.parseFloat(document.documentElement.style.getPropertyValue('--app-viewport-offset-y') ?? '') || 0,
      point: (await import('/src/ui/responsive-viewport.ts')).clientToViewportPoint(window, 50, 90) };
    proof.restoreVisualViewport = () => {
      input?.blur();
      if (originalDescriptor) Object.defineProperty(window, 'visualViewport', originalDescriptor); else Object.defineProperty(window, 'visualViewport', { configurable: true, value: original });
      window.dispatchEvent(new Event('resize'));
    };
    return keyboard;
  })()
`;

const verifyMobileWorkspaceExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const open = document.querySelector('[data-workspace-open="items"]');
    if (!(open instanceof HTMLButtonElement)) throw new Error('手機工作窗物品入口不存在');
    open.click();
    await proof.nextPaint();
    const workspace = document.getElementById('game-workspace');
    const equipment = document.querySelector('#game-workspace [data-tab="equipment"]');
    const rect = workspace?.getBoundingClientRect();
    const viewport = { width: innerWidth, height: innerHeight };
    const nearFullscreen = workspace instanceof HTMLElement && rect && rect.left >= -1 && rect.top >= -1
      && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1
      && rect.width >= viewport.width - 24 && rect.height >= viewport.height - 150;
    if (equipment instanceof HTMLButtonElement) { equipment.click(); await proof.nextPaint(); }
    const activeEquipment = document.querySelector('#pane-equipment:not(.hidden)') instanceof HTMLElement;
    document.querySelector('#game-workspace .workspace-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await proof.nextPaint();
    return { nearFullscreen, activeEquipment, closed: document.getElementById('game-workspace')?.classList.contains('hidden') ?? false };
  })()
`;

const verifyInteractionPresenceExpression = String.raw`
  (async () => {
    const proof = window.__gameWorkspaceProof;
    const nonNearby = proof.quickActions.filter((action) => action.id === 'wang_qi:toggle' || action.type === 'craft');
    proof.actionPanel.update(nonNearby, false, false, proof.player);
    await proof.nextPaint();
    const hiddenPanel = document.getElementById('floating-interaction-list');
    const hidden = !(hiddenPanel instanceof HTMLElement) || hiddenPanel.hidden || hiddenPanel.getClientRects().length === 0;
    proof.actionPanel.update(proof.quickActions, false, false, proof.player);
    const host = document.getElementById('chat-quick-actions');
    if (host instanceof HTMLElement && typeof proof.actionPanel.mountQuickActions === 'function') proof.actionPanel.mountQuickActions(host);
    await proof.nextPaint();
    const shownPanel = document.getElementById('floating-interaction-list');
    const nearby = shownPanel?.querySelector('.floating-interaction-quick-btn[data-action="proof-nearby-interact"], .floating-interaction-quick-btn[data-action-exec="proof-nearby-interact"]');
    const before = proof.calls.length;
    if (nearby instanceof HTMLButtonElement) nearby.click();
    await proof.nextPaint();
    return { hidden, shown: shownPanel instanceof HTMLElement && !shownPanel.hidden && shownPanel.getClientRects().length > 0,
      restored: nearby instanceof HTMLButtonElement, callback: proof.calls.slice(before).some((entry) => entry.kind === 'action' && entry.actionId === 'proof-nearby-interact') };
  })()
`;

async function resizeDesktopWorkspace(cdp, width, height) {
  const pointer = await cdp.evaluate(`(() => {
    const workspace = document.getElementById('game-workspace');
    const grip = workspace?.querySelector('.desktop-window-resize');
    if (!(workspace instanceof HTMLElement) || !(grip instanceof HTMLButtonElement)) throw new Error('桌面工作窗 resize grip 不存在');
    const workspaceRect = workspace.getBoundingClientRect();
    const gripRect = grip.getBoundingClientRect();
    const scale = Number.parseFloat(document.documentElement.style.getPropertyValue('--app-viewport-scale')) || 1;
    return {
      startX: gripRect.left + gripRect.width / 2,
      startY: gripRect.top + gripRect.height / 2,
      targetX: gripRect.left + gripRect.width / 2 + (${width} - workspace.offsetWidth) * scale,
      targetY: gripRect.top + gripRect.height / 2 + (${height} - workspace.offsetHeight) * scale,
    };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pointer.startX, y: pointer.startY, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pointer.targetX, y: pointer.targetY, button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pointer.targetX, y: pointer.targetY, button: 'left', clickCount: 1 });
  await delay(80);
}

async function dragFloatingPanelToViewportEdge(cdp) {
  const pointer = await cdp.evaluate(`(() => {
    const panel = window.__gameWorkspaceProof.floatingPanel?.root;
    const handle = panel?.querySelector('[data-floating-list-drag-handle="true"]');
    if (!(panel instanceof HTMLElement) || !(handle instanceof HTMLElement)) throw new Error('正式活動浮窗拖曳列不存在');
    const handleRect = handle.getBoundingClientRect();
    return { startX: handleRect.left + handleRect.width / 2, startY: handleRect.top + handleRect.height / 2,
      targetX: innerWidth - 20, targetY: innerHeight - 20 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pointer.startX, y: pointer.startY, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pointer.targetX, y: pointer.targetY, button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pointer.targetX, y: pointer.targetY, button: 'left', clickCount: 1 });
  await delay(80);
}

async function captureWorkspace(cdp, name) {
  if (!VISUALIZATION_DIR) return;
  await mkdir(VISUALIZATION_DIR, { recursive: true });
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(VISUALIZATION_DIR, name), Buffer.from(result.data, 'base64'));
}

async function clickCenterWithCdp(cdp, selector) {
  const target = await cdp.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!(node instanceof HTMLElement)) throw new Error('CDP 點擊目標不存在：' + ${JSON.stringify(selector)});
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === node || hit instanceof Node && node.contains(hit), width: rect.width, height: rect.height };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await delay(80);
  return target;
}

function assertInsideViewport(rect, viewport, label) {
  assert(rect.left >= -1 && rect.right <= viewport.width + 1 && rect.top >= -1 && rect.bottom <= viewport.height + 1,
    `${label}超出視口：${JSON.stringify({ rect, viewport })}`);
}

async function verifyMobileInventoryInteractions(cdp, viewport, theme = 'light') {
  await setViewport(cdp, viewport);
  await cdp.evaluate(`(async () => {
    document.documentElement.dataset.colorMode = ${JSON.stringify(theme)};
    (await import('/src/ui/mobile-surface.ts')).requestMobileSurface(null);
    const proof = window.__gameWorkspaceProof;
    proof.inventoryPanel.update({ ...proof.inventory, revision: 2, capacity: 64, items: [
      ...proof.inventory.items,
      ...Array.from({ length: 30 }, (_, index) => ({ itemId: 'scroll-proof-' + index, itemInstanceId: 'scroll-proof-' + index,
        name: '捲動驗證物品' + index, desc: '詳細屬性與用途說明，返回按鈕應持續可用。'.repeat(35), type: 'material', count: 16600 + index, level: 1 })),
    ] });
    await proof.nextPaint();
  })()`);
  for (const id of ['items', 'cultivation', 'action', 'quests']) {
    const selector = '#game-dock .workspace-dock-nav > [data-workspace-open="' + id + '"]';
    await clickCenterWithCdp(cdp, selector);
    assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded')`), 'true', '手機 dock 未開啟 ' + id);
    await clickCenterWithCdp(cdp, selector);
    assert.equal(await cdp.evaluate(`document.getElementById('game-workspace').classList.contains('hidden') && !document.getElementById('game-workspace').contains(document.activeElement)`), true, '手機重點同項目未收起並移出焦點：' + id);
  }
  await clickCenterWithCdp(cdp, '#game-dock .workspace-dock-nav > [data-workspace-open="items"]');
  await cdp.evaluate(`(async () => {
    document.getElementById('workspace-tab-inventory').click();
    const back = document.querySelector('.inventory-workspace-detail-back');
    if (back?.getClientRects().length) back.click();
    await window.__gameWorkspaceProof.nextPaint();
    document.getElementById('pane-inventory').scrollTop = 0;
    window.__inventoryTooltipObservations = [];
    window.__inventoryTooltipObserver = new MutationObserver(() => {
      if (document.querySelector('.inventory-tooltip.visible')) window.__inventoryTooltipObservations.push('visible');
    });
    window.__inventoryTooltipObserver.observe(document.getElementById('floating-tooltip-root'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  })()`);
  const swipe = await cdp.evaluate(`(() => {
    const pane = document.getElementById('pane-inventory'); const rect = pane.getBoundingClientRect();
    const cells = [...pane.querySelectorAll('.inventory-cell')];
    for (const cell of cells.slice(0, 5)) cell.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: rect.left + 40, clientY: rect.top + 70 }));
    return { x: rect.left + rect.width / 2, startY: rect.bottom - 45, endY: rect.top + 50, before: pane.scrollTop };
  })()`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: swipe.x, y: swipe.startY, id: 1 }] });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: swipe.x, y: swipe.startY + (swipe.endY - swipe.startY) * step / 8, id: 1 }] });
    await delay(35);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(180);
  const scrolled = await cdp.evaluate(`({ top: document.getElementById('pane-inventory').scrollTop, detail: document.querySelector('.inventory-workspace').dataset.detailOpen,
    tooltips: window.__inventoryTooltipObservations.length, visible: !!document.querySelector('.inventory-tooltip.visible') })`);
  assert(scrolled.top > swipe.before + 10, '真實觸控拖曳未捲動背包');
  assert.notEqual(scrolled.detail, 'true', '捲動背包誤開詳情');
  assert.equal(scrolled.tooltips, 0, '手指移動期間曾出現道具數值浮窗');
  assert.equal(scrolled.visible, false, '捲動後留下道具浮窗');
  const selection = await cdp.evaluate(`(async () => {
    const cell = document.querySelector('[data-item-key="scroll-proof-12"]') ?? [...document.querySelectorAll('.inventory-cell')].find(c => c.textContent.includes('捲動驗證物品12'));
    if (!cell) throw new Error('缺少長清單正式道具');
    cell.scrollIntoView({ block: 'center', behavior: 'instant' });
    await window.__gameWorkspaceProof.nextPaint();
    const rect = cell.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, scrollTop: document.getElementById('pane-inventory').scrollTop };
  })()`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: selection.x, y: selection.y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(100);
  assert.equal(await cdp.evaluate(`document.querySelector('.inventory-workspace').dataset.detailOpen`), 'true', '明確點選未開啟物品詳情');
  await cdp.evaluate(`document.getElementById('pane-inventory').scrollTop = 10000; true`);
  await delay(50);
  const back = await cdp.evaluate(`(() => {
    const pane = document.getElementById('pane-inventory'); const button = pane.querySelector('.inventory-workspace-detail-back');
    const rect = button.getBoundingClientRect(); const area = pane.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width, paneTop: area.top, paneBottom: area.bottom, hit: button === hit || button.contains(hit), scrollTop: pane.scrollTop };
  })()`);
  assert(back.scrollTop > 100, '長詳情 fixture 沒有形成可捲動內容');
  assert(back.top >= back.paneTop - 1 && back.bottom <= back.paneBottom + 1 && back.hit, '捲到詳情底部後返回背包按鈕不可見或被遮擋：' + JSON.stringify(back));
  assert(back.height >= 44 && back.width >= 44, '返回背包觸控範圍不足');
  await captureWorkspace(cdp, 'inventory-detail-back-' + viewport.width + '-' + theme + '.png');
  await clickCenterWithCdp(cdp, '.inventory-workspace-detail-back');
  const restored = await cdp.evaluate(`({ top: document.getElementById('pane-inventory').scrollTop, detail: document.querySelector('.inventory-workspace').dataset.detailOpen,
    focus: document.activeElement?.textContent, tooltips: window.__inventoryTooltipObservations.length })`);
  assert(Math.abs(restored.top - selection.scrollTop) <= 2, '返回背包遺失原捲動位置：' + JSON.stringify({ restored, selection }));
  assert.notEqual(restored.detail, 'true', '返回背包沒有收起詳情');
  assert.match(restored.focus, /捲動驗證物品12/, '返回背包沒有回到原道具');
  assert.equal(restored.tooltips, 0, '觸控詳情返回時誤開懸浮說明');
  await captureWorkspace(cdp, 'inventory-scroll-restored-' + viewport.width + '-' + theme + '.png');
  await cdp.evaluate(`window.__inventoryTooltipObserver.disconnect(); window.__gameWorkspaceProof.inventoryPanel.update(window.__gameWorkspaceProof.inventory); true`);
  await clickCenterWithCdp(cdp, '#game-dock .workspace-dock-nav > [data-workspace-open="items"]');
}

async function verifyWorkspaceOutsideDismiss(cdp, viewport, touch) {
  await setViewport(cdp, viewport, { touch });
  for (const id of ['items', 'cultivation', 'action', 'quests', 'character', 'social', 'market', 'world', 'system']) {
    const opened = await cdp.evaluate(`(async () => {
      document.querySelector('#game-workspace .workspace-close')?.click();
      document.querySelector('[data-workspace-open="${id}"]')?.click();
      await window.__gameWorkspaceProof.nextPaint();
      const workspace = document.getElementById('game-workspace');
      const close = workspace.querySelector('.workspace-close');
      return { id: workspace.dataset.workspace, text: close.textContent.trim(), label: close.getAttribute('aria-label') };
    })()`);
    assert.equal(opened.id, id, '外點關閉驗證未開啟指定工作窗');
    assert.equal(opened.text, '×', '工作窗未使用 X 關閉按鈕');
    assert.match(opened.label, /^關閉.+視窗$/, 'X 缺少清楚的輔助科技名稱');
    await clickCenterWithCdp(cdp, '#game-workspace .workspace-title');
    assert.equal(await cdp.evaluate(`document.getElementById('game-workspace').classList.contains('hidden')`), false, '視窗內點擊意外關閉');
    const outside = await cdp.evaluate(`(() => {
      for (let y = 4; y < innerHeight; y += 24) for (let x = 4; x < innerWidth; x += 24) {
        if (document.elementFromPoint(x, y)?.id === 'game-workspace-backdrop') return { x, y };
      }
      return null;
    })()`);
    assert(outside, '工作窗沒有可點擊關閉的空白背景');
    await cdp.evaluate(`(() => {
      const canvas = document.getElementById('game-canvas');
      window.__workspaceMapPointerCount = 0;
      window.__workspaceMapPointer = () => window.__workspaceMapPointerCount++;
      canvas?.addEventListener('pointerdown', window.__workspaceMapPointer);
      return true;
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: outside.x, y: outside.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: outside.x, y: outside.y, button: 'left', clickCount: 1 });
    const closed = await cdp.evaluate(`(() => {
      document.getElementById('game-canvas')?.removeEventListener('pointerdown', window.__workspaceMapPointer);
      return { hidden: document.getElementById('game-workspace').classList.contains('hidden'),
        backdropHidden: getComputedStyle(document.getElementById('game-workspace-backdrop')).display === 'none',
        mapPointers: window.__workspaceMapPointerCount,
        focusInside: document.getElementById('game-workspace').contains(document.activeElement) };
    })()`);
    assert.equal(closed.hidden, true, `${id} 點背景未關閉`);
    assert.equal(closed.backdropHidden, true, `${id} 關閉後背景仍攔截地圖`);
    assert.equal(closed.mapPointers, 0, `${id} 關閉手勢穿透到地圖`);
    assert.equal(closed.focusInside, false, `${id} 關閉後焦點仍留在隱藏視窗`);
  }
}

await withClientBrowserProof({ viewport: PHONE, profilePrefix: 'game-workspace-proof-' }, async (cdp) => {
  // 舊 active tab 不得在啟動時自動打開按需工作窗。
  await cdp.evaluate(`(async () => {
    localStorage.setItem('mud:side-panel-state:v1', JSON.stringify({ version: 1, activeTabs: { 'side-primary': 'inventory' } }));
    // 操作驗證使用已看過引導的使用者偏好，避免延遲出現的教學接管手勢。
    const { GUIDED_TOUR_FLOWS } = await import('/src/constants/ui/guided-tour.ts');
    localStorage.setItem('mud:guided-tour:v1', JSON.stringify({ completed: {}, dismissed: Object.fromEntries(GUIDED_TOUR_FLOWS.map(flow => [flow.id, flow.storageVersion])) }));
    location.reload(); return true;
  })()`);
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
  // 失敗時帶回頁面端診斷（WebGL renderer 字串、地圖像素、canvas 尺寸），
  // 便於容器環境定位「地圖未就緒」的真實原因。
  try {
    await waitFor(() => cdp.evaluate(`window.__gameWorkspaceProof.getMapPixels().slice(0,3).some(value=>value>0)`), '正式 Pixi 地圖繪製');
  } catch (waitError) {
    const diagnostics = await cdp.evaluate(`(() => {
      const offscreen = document.createElement('canvas');
      const gl = offscreen.getContext('webgl2') || offscreen.getContext('webgl');
      let rendererText = 'no-webgl-context';
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        rendererText = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      const canvas = document.getElementById('game-canvas');
      let pixels = null;
      try { pixels = window.__gameWorkspaceProof ? Array.from(window.__gameWorkspaceProof.getMapPixels().slice(0, 8)) : null; } catch (error) { pixels = 'error:' + (error && error.message); }
      return {
        rendererText,
        webdriver: navigator.webdriver,
        canvasSize: canvas ? [canvas.width, canvas.height] : null,
        pixels,
        readyState: document.readyState,
      };
    })()`);
    throw new Error(`正式 Pixi 地圖繪製未就緒：${JSON.stringify(diagnostics)}`, { cause: waitError });
  }
  assert(fixture.inventoryCells > 0, '正式背包 Panel 未載入非空 fixture');
  assert(fixture.actionTabs > 0, '正式行動 Panel 未載入非空 fixture');
  assert.match(fixture.hpText ?? '', /68萬\s*\/\s*100萬/, '正式 HUD 未顯示長數值 fixture 氣血');
  assert.match(fixture.qiText ?? '', /6\.6萬\s*\/\s*40萬/, '正式 HUD 未顯示長數值 fixture 靈氣');
  const hudRows = await cdp.evaluate(verifyHudRowsExpression);
  assert(hudRows.rows.name.includes('驗證玩家長名'), 'HUD 五行缺少玩家名稱');
  assert.match(hudRows.rows.level, /lv\s*30/i, `HUD 未顯示 LV30：${hudRows.rows.level}`);
  assert.equal(hudRows.levelInName, true, 'HUD LV30 未位於玩家名稱列');
  assert(Math.abs(hudRows.levelTop - hudRows.nameTop) < 48, 'HUD LV30 未與玩家名稱保持同列');
  assert.notEqual(hudRows.rows.realm, '', 'HUD 缺少境界主字');
  assert.notEqual(hudRows.rows.title, '', 'HUD 缺少境界稱號小字');
  assert.notEqual(hudRows.rows.realmReview, '', 'HUD 缺少境界評語小字');
  assert.match(hudRows.rows.cultivate, /^修為：660 \/ 1000$/, 'HUD 未使用精簡修為 current/max 格式');
  assert.equal(hudRows.breakthrough?.visible, true, 'HUD 缺少可見突破操作');
  assert(hudRows.breakthrough?.minHeight >= 44, `HUD 突破操作觸控高度不足：${hudRows.breakthrough?.minHeight}`);
  assert.equal(hudRows.breakthroughCallback, true, 'HUD 突破操作未保留 callback');
  for (const resource of [hudRows.hp, hudRows.qi]) {
    assert.equal(resource.whiteSpace, 'nowrap', `HUD 資源文字允許換行：${resource.text}`);
    assert.equal(resource.clipped, false, `HUD 資源文字被裁切：${resource.text}`);
    assert(Math.abs(resource.barHeight - 12) <= 1, `HUD 資源 bar 高度不是 12px：${resource.barHeight}`);
  }
  const mobileHud = await cdp.evaluate(verifyMobileHudCompactExpression);
  assert.equal(mobileHud.compact.expanded, 'false', '手機 HUD 初始未維持 compact');
  assert.equal(mobileHud.compact.identity, 'false', '手機 HUD 初始 data-hud-expanded 錯誤');
  assert.equal(mobileHud.compact.controls, 'hud-summary-details', '手機 HUD 展開控制缺少 aria-controls');
  assert.equal(mobileHud.compact.topRowVisible, false, '手機 HUD compact 仍顯示可收合頂部詳情');
  assert.equal(mobileHud.expanded.expanded, 'true', '手機 HUD 展開未更新 aria-expanded');
  assert.equal(mobileHud.expanded.identity, 'true', '手機 HUD 展開未更新 data-hud-expanded');
  assert.equal(mobileHud.expanded.topRowVisible, true, '手機 HUD 展開未顯示頂部詳情');
  assert.equal(mobileHud.restored.expanded, 'false', '手機 HUD 收合未恢復 aria-expanded=false');
  assert.equal(mobileHud.restored.identity, 'false', '手機 HUD 收合未恢復 compact 狀態');
  for (const resource of [...mobileHud.compact.resources, ...mobileHud.expanded.resources]) {
    assert.notEqual(resource.text, '', '手機 HUD 血/靈數值為空');
    assert.equal(resource.whiteSpace, 'nowrap', `手機 HUD 血/靈數值允許換行：${resource.text}`);
    assert.equal(resource.clipped, false, `手機 HUD 血/靈數值被裁切：${resource.text}`);
  }
  const guidedTour = await cdp.evaluate(dismissGuidedTourExpression);
  assert.equal(guidedTour.closed, true, '工作窗開啟前未先關閉可攔截操作的引導層');

  const allWorkspaces = await cdp.evaluate(verifyAllWorkspacesExpression);
  assert.equal(allWorkspaces.length, 9, '其它缺少工作分類');
  for (const workspace of allWorkspaces) {
    assert.equal(workspace.title, workspace.expectedTitle, `工作分類未切換：${workspace.id}`);
    for (const tab of workspace.tabResults) {
      assert.equal(tab.activePane, true, `工作分類未對應到可見正式 pane：${workspace.id}/${tab.tabId}`);
      assert.equal(tab.actionSection, true, `技能或行動內容未單獨掛入正確工作窗：${workspace.id}/${tab.tabId}`);
    }
  }
  const menuAndShortcut = await cdp.evaluate(verifyWorkspaceMenuAndShortcutExpression);
  assert.equal(menuAndShortcut.inputPreserved, true, '背包與坊市捷徑往返破壞搜尋輸入或節點身分');
  assert.equal(menuAndShortcut.scrollPreserved, true, '背包與坊市捷徑往返破壞背包捲動狀態');
  assert.equal(menuAndShortcut.menuOpen, true, '其它選單未正常展開');
  assert.equal(menuAndShortcut.menuLabel, '其它');
  assert.deepEqual(menuAndShortcut.menuIds, ['character', 'social', 'market', 'world', 'system']);
  assert.deepEqual(menuAndShortcut.duplicatedEntries, [], '其它不得重複顯示獨立入口');
  const activityEntry = await cdp.evaluate(`(async () => {
    const entry = document.querySelector('#game-dock [data-workspace-action="activity"]');
    entry.click();
    await window.__gameWorkspaceProof.nextPaint();
    const { detailModalHost } = await import('/src/ui/detail-modal-host.ts');
    const opened = detailModalHost.isOpenFor('activity-panel');
    detailModalHost.close('activity-panel');
    return { opened, label: entry.textContent, menuClosed: document.getElementById('workspace-menu').hidden };
  })()`);
  assert.deepEqual(activityEntry, { opened: true, label: '活動', menuClosed: true }, '右下角活動按鈕必須開啟正式活動視窗並收起其它選單');
  assert.equal(menuAndShortcut.menuBounded, true, '其它選單超出目前視口');
  assert(menuAndShortcut.menuEntrySizes.every((entry) => entry.width > 0 && entry.height >= 40),
    `其它選單入口尺寸不足：${JSON.stringify(menuAndShortcut.menuEntrySizes)}`);
  assert.equal(menuAndShortcut.menuClosedByOutsidePointer, true, '其它選單未能由外部點擊關閉');
  await cdp.evaluate(`(async () => {
    const items = document.querySelector('[data-workspace-open="items"]');
    if (!(items instanceof HTMLButtonElement)) throw new Error('截圖前缺少背包入口');
    items.click(); await window.__gameWorkspaceProof.nextPaint();
    const menu = document.getElementById('workspace-menu-toggle');
    if (!(menu instanceof HTMLButtonElement)) throw new Error('截圖前缺少其它選單');
    if (menu.getAttribute('aria-expanded') !== 'true') menu.click();
    await window.__gameWorkspaceProof.nextPaint();
  })()`);
  await captureWorkspace(cdp, `workspace-menu-${PHONE.width}x${PHONE.height}-menu.png`);
  await cdp.evaluate(`(async () => {
    const system = document.querySelector('#workspace-menu [data-workspace-open="system"]');
    if (!(system instanceof HTMLButtonElement)) throw new Error('截圖前缺少系統入口');
    system.click(); await window.__gameWorkspaceProof.nextPaint();
  })()`);
  await captureWorkspace(cdp, `workspace-system-${PHONE.width}x${PHONE.height}-compact.png`);
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

  await setViewport(cdp, DESKTOP, { touch: false });
  const desktop = await cdp.evaluate(measureShellExpression);
  assertInsideViewport(desktop.dock, desktop.viewport, '桌面功能入口');
  await captureWorkspace(cdp, 'implemented-desktop.png');

  // 高 DPI 截圖尺寸仍須走正式 responsive viewport 綁定，並驗證設計畫布 locked 縮放後的實際錨點。
  await setViewport(cdp, LARGE_DESKTOP, { touch: false });
  await waitFor(() => cdp.evaluate(`
    innerWidth === ${LARGE_DESKTOP.width} && innerHeight === ${LARGE_DESKTOP.height}
      && matchMedia('(pointer: coarse)').matches === false
      && document.documentElement.dataset.desktopScaleLock === 'true'
      && document.getElementById('app-viewport-root')?.dataset.designLocked === 'true'
      && Number.parseFloat(document.documentElement.style.getPropertyValue('--app-viewport-scale')) > 1
      && document.getElementById('app-viewport-root')?.style.transform.includes('scale(')
  `), '大型桌面正式 responsive viewport locked 同步');
  const large = await cdp.evaluate(measureLargeDesktopExpression);
  assert.deepEqual(large.viewport, LARGE_DESKTOP, '大型桌面 proof 未取得指定 viewport');
  assert.equal(large.responsive.desktopScaleLock, 'true', '大型桌面未啟用 design locked');
  assert.equal(large.responsive.designLocked, 'true', '設計畫布 root 未同步 locked');
  assert.equal(large.responsive.breakpoint, 'wide', '大型桌面未進入 wide responsive breakpoint');
  assert(large.responsive.scale > 1, '大型桌面未套用設計畫布縮放');
  assert.notEqual(large.hud.nameText, '', '大型桌面 HUD 玩家名稱為空');
  assert.equal(large.hud.nameText, '驗證玩家長名', '大型桌面 HUD 玩家名稱不是正式 fixture');
  assertInsideViewport(large.hud.rect, large.viewport, '大型桌面頂部 HUD');
  assertInsideViewport(large.hud.name, large.viewport, '大型桌面 HUD 玩家名稱');
  assertInsideViewport(large.time.rect, large.viewport, '大型桌面右上時間');
  await captureWorkspace(cdp, 'implemented-large-desktop.png');

  const hiddenWorkspace = await cdp.evaluate(closeWorkspaceExpression);
  assert.equal(hiddenWorkspace.hidden, true, '大型桌面工作窗未能先隱藏');
  const reopenedWorkspace = await cdp.evaluate(openWorkspaceExpression);
  assert.equal(reopenedWorkspace.hidden, false, '大型桌面工作窗隱藏後無法重新顯示');
  const workspaceBeforeResize = await cdp.evaluate(measureDesktopWorkspaceExpression);
  assert.equal(workspaceBeforeResize.active, true, '大型桌面工作窗未啟用 desktop-window 控制器');
  assert.equal(workspaceBeforeResize.gripVisible, true, '大型桌面工作窗缺少可見 resize grip');
  assert(workspaceBeforeResize.cssWidth > 360 && workspaceBeforeResize.cssHeight > 320,
    `大型桌面工作窗首次顯示被錯誤固定成最小尺寸：${JSON.stringify(workspaceBeforeResize)}`);
  await resizeDesktopWorkspace(cdp, 360, 320);
  await cdp.evaluate(`(async () => {
    const back = document.querySelector('#pane-inventory .inventory-workspace-detail-back');
    if (back instanceof HTMLElement && back.getClientRects().length) back.click();
    await window.__gameWorkspaceProof.nextPaint();
  })()`);
  const workspaceMinimum = await cdp.evaluate(measureDesktopWorkspaceExpression);
  await captureWorkspace(cdp, 'minimum-inventory.png');
  assert(Math.abs(workspaceMinimum.cssWidth - 360) <= 8, `桌面工作窗最小寬度未到 360：${workspaceMinimum.cssWidth}`);
  assert(Math.abs(workspaceMinimum.cssHeight - 320) <= 8, `桌面工作窗最小高度未到 320：${workspaceMinimum.cssHeight}`);
  assert.equal(workspaceMinimum.cell.name, '超級大把的寶劍・百煉玄鐵長劍', '最小桌面工作窗背包物品名稱遺失');
  assert.notEqual(workspaceMinimum.cell.count, '', '最小桌面工作窗背包物品數量遺失');
  assert.equal(workspaceMinimum.cell.nameClipped, false, '最小桌面工作窗裁切物品名稱');
  assert(workspaceMinimum.cell.quantityLabel.includes('數量：'), '最小桌面工作窗缺少數量標示');
  assert.equal(workspaceMinimum.cell.hit, true, `最小桌面工作窗背包清單不可點擊：${JSON.stringify(workspaceMinimum)}`);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: workspaceMinimum.cell.rect.left + workspaceMinimum.cell.rect.width / 2,
    y: workspaceMinimum.cell.rect.top + workspaceMinimum.cell.rect.height / 2, button: 'left', clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: workspaceMinimum.cell.rect.left + workspaceMinimum.cell.rect.width / 2,
    y: workspaceMinimum.cell.rect.top + workspaceMinimum.cell.rect.height / 2, button: 'left', clickCount: 1,
  });
  await delay(80);
  await resizeDesktopWorkspace(cdp, 800, 520);
  const workspaceExpanded = await cdp.evaluate(measureDesktopWorkspaceExpression);
  assert(workspaceExpanded.cssWidth >= 700, `桌面工作窗擴大後寬度不足：${workspaceExpanded.cssWidth}`);
  assert(workspaceExpanded.cssHeight >= 500, `桌面工作窗擴大後高度不足：${workspaceExpanded.cssHeight}`);
  const expandedComparison = await cdp.evaluate(verifyCandidateItemExpression);
  assert.deepEqual(expandedComparison.runtimeErrors, [], '桌面工作窗擴大比較流程出現 runtime error');
  assert.match(expandedComparison.comparisonText, /驗證鐵劍|\+18/, '桌面工作窗擴大後未保留裝備比較');
  assert.match(expandedComparison.candidateBonuses, /\+30/, '桌面工作窗擴大後未顯示候選屬性');

  // 用正式浮動列表類別建立活動內容，重排兩次不得把 transformed viewport 的座標放大寫回。
  const closedBeforeFloating = await cdp.evaluate(closeWorkspaceExpression);
  assert.equal(closedBeforeFloating.hidden, true, '大型桌面建立浮窗前未關閉工作窗');
  const floatingInitial = await cdp.evaluate(createFloatingPanelExpression);
  assertInsideViewport(floatingInitial, large.viewport, '大型桌面活動浮窗初始位置');
  const floatingRefresh = await cdp.evaluate(refreshFloatingPanelExpression);
  for (const edge of ['left', 'top', 'right', 'bottom']) {
    assert(Math.abs(floatingRefresh.before[edge] - floatingRefresh.after[edge]) <= 1,
      `活動浮窗 refreshLayout 後${edge}位移：${JSON.stringify(floatingRefresh)}`);
  }
  const handle = await cdp.evaluate(`(() => {
    const handle = window.__gameWorkspaceProof.floatingPanel?.root.querySelector('[data-floating-list-drag-handle="true"]');
    if (!(handle instanceof HTMLElement)) throw new Error('正式活動浮窗缺少拖曳列');
    const rect = handle.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: LARGE_DESKTOP.width - 20, y: LARGE_DESKTOP.height - 20, button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: LARGE_DESKTOP.width - 20, y: LARGE_DESKTOP.height - 20, button: 'left', clickCount: 1 });
  await delay(80);
  const floatingDragged = await cdp.evaluate(measureFloatingPanelExpression);
  assertInsideViewport(floatingDragged.rect, floatingDragged.viewport, '大型桌面活動浮窗拖曳後');
  const floatingCollapsed = await cdp.evaluate(collapseFloatingPanelExpression);
  assert.equal(floatingCollapsed.collapsed, true, '活動浮窗未進入收合狀態');
  await dragFloatingPanelToViewportEdge(cdp);
  const collapsedDragged = await cdp.evaluate(measureFloatingPanelExpression);
  assert.equal(collapsedDragged.collapsed, true, '活動浮窗收合拖曳後錯誤展開');
  assertInsideViewport(collapsedDragged.rect, collapsedDragged.viewport, '大型桌面活動浮窗收合拖曳後');
  const floatingToggled = await cdp.evaluate(expandFloatingPanelExpression);
  assert.equal(floatingToggled.collapsed, false, '活動浮窗展開後仍保留收合狀態');
  const floatingExpanded = await cdp.evaluate(measureFloatingPanelExpression);
  assertInsideViewport(floatingExpanded.rect, floatingExpanded.viewport, '大型桌面活動浮窗展開 refresh 後');
  await cdp.evaluate(`window.__gameWorkspaceProof.floatingPanel.destroy(); delete window.__gameWorkspaceProof.floatingPanel; true`);

  const anchors = await cdp.evaluate(stabilizeAnchorExpression);
  assert(Math.abs(anchors.after.hudTop - anchors.before.hudTop) <= 1,
    `大型桌面 focus/scrollIntoView 造成 HUD 位移：${JSON.stringify(anchors)}`);
  assert(Math.abs(anchors.after.timeTop - anchors.before.timeTop) <= 1,
    `大型桌面 focus/scrollIntoView 造成右上時間位移：${JSON.stringify(anchors)}`);

  const openedChat = await cdp.evaluate(openChatExpression);
  assert.equal(openedChat.open, true, '正式聊天未展開');
  assert.equal(openedChat.visible, true, '正式聊天展開後不可見');
  const largeChat = await cdp.evaluate(measureLargeDesktopExpression);
  assert(largeChat.chat.cssWidth >= 500, `大型桌面聊天寬度不足：${largeChat.chat.cssWidth}`);
  assert(largeChat.chat.cssHeight >= 300, `大型桌面聊天高度不足：${largeChat.chat.cssHeight}`);
  assert(largeChat.chat.logCssHeight >= 180, `大型桌面聊天訊息區高度不足：${largeChat.chat.logCssHeight}`);
  assert(['auto', 'scroll'].includes(largeChat.chat.tabOverflowX),
    `聊天頻道列未提供橫向捲動：${largeChat.chat.tabOverflowX}`);
  assert.equal(largeChat.chat.pickerHit, true, '大型桌面聊天頻道選擇器中心不可點擊');
  for (const channel of largeChat.chat.channels) {
    assert.equal(channel.visible, true, `聊天頻道不可見：${channel.text}`);
    assert.notEqual(channel.text, '', '聊天頻道名稱為空');
    assert.notEqual(channel.textOverflow, 'ellipsis', `聊天頻道名稱仍使用省略裁切：${channel.text}`);
    assert(channel.scrollWidth <= channel.clientWidth + 1,
      `聊天頻道名稱在按鈕內被裁切：${JSON.stringify(channel)}`);
  }
  const pickerFocused = await cdp.evaluate(`(() => {
    const picker = document.querySelector('#chat-panel [data-chat-slot-select="channel-1"]');
    if (!(picker instanceof HTMLSelectElement)) throw new Error('正式聊天頻道選擇器不存在');
    picker.focus(); picker.click();
    return document.activeElement === picker;
  })()`);
  assert.equal(pickerFocused, true, '聊天頻道選擇器無法取得焦點點擊');
  const interactionAndQuick = await cdp.evaluate(verifyInteractionAndQuickActionsExpression);
  assert.equal(interactionAndQuick.nearby?.visible, true, '存在真實附近行動時未顯示 interaction 浮窗');
  assert.equal(interactionAndQuick.nearby?.belowZoom, true, 'interaction 浮窗未錨定在縮放控制下方');
  assert.equal(interactionAndQuick.nearby?.buttons.some((button) => button.id === 'wang_qi:toggle'), false,
    '常駐王氣切換錯誤顯示為附近行動');
  assert.equal(interactionAndQuick.nearby?.buttons.some((button) => button.id === 'proof-craft-action'), false,
    '技藝不應混入附近交互列表');
  assert.equal(interactionAndQuick.nearby?.buttons.some((button) => button.id === 'proof-nearby-interact'), true,
    '真實附近行動未進入 interaction 浮窗');
  assert(interactionAndQuick.nearby?.hoverDescription.includes('調查附近的古老石碑'),
    '附近交互滑鼠懸停未顯示原始動作說明');
  assert(interactionAndQuick.nearby?.focusDescription.includes('調查附近的古老石碑'),
    '附近交互鍵盤焦點未顯示原始動作說明');
  assert.deepEqual(interactionAndQuick.quick.map((button) => button.id),
    ['battle:force_attack', 'travel:return_spawn', 'loot:open', 'client:observe'], '聊天快捷行動 ID 不完整或順序錯誤');
  assert(interactionAndQuick.quick.every((button) => button.visible && button.description !== ''), '聊天快捷行動缺少可見按鈕或原始說明');
  assert.equal(interactionAndQuick.hoverDidNotExecute, true, '聊天快捷行動 hover 錯誤執行 callback');
  for (const [id, description] of Object.entries({
    'battle:force_attack': '對指定目標發動強攻',
    'travel:return_spawn': '返回綁定的復活點',
    'loot:open': '拿取指定地格的物品',
    'client:observe': '觀察指定地格',
  })) {
    assert(interactionAndQuick.hoverDescriptions[id]?.includes(description), `聊天快捷行動 hover 未顯示完整說明：${id}`);
  }
  assert.equal(interactionAndQuick.cooldownDisabled, true, '聊天快捷行動未遵守冷卻 disabled 狀態');
  for (const id of ['battle:force_attack', 'travel:return_spawn', 'loot:open', 'client:observe']) {
    assert.equal(interactionAndQuick.actionCalls.some((call) => call.actionId === id), true, `聊天快捷行動未執行 callback：${id}`);
  }
  await captureWorkspace(cdp, 'implemented-gameplay-actions.png');
  const attackCall = interactionAndQuick.expectedTargeting.find((call) => call.actionId === 'battle:force_attack');
  assert.equal(attackCall?.requiresTarget, true, '強攻快捷行動遺失 targeting 參數');
  assert.equal(attackCall?.targetMode, 'any', '強攻快捷行動 targetMode 錯誤');
  assert.equal(interactionAndQuick.disclosure?.inputRetained, true, '聊天行動 disclosure 破壞輸入節點');
  const interactionPresence = await cdp.evaluate(verifyInteractionPresenceExpression);
  assert.equal(interactionPresence.hidden, true, '沒有附近 action 時 interaction 浮窗仍常駐');
  assert.equal(interactionPresence.shown, true, '恢復附近 action 後 interaction 浮窗未重新顯示');
  assert.equal(interactionPresence.restored, true, '附近 action 隱藏後重新顯示缺少按鈕');
  assert.equal(interactionPresence.callback, true, '附近 action 隱藏後重新顯示 callback 未重新綁定');
  const chatCollapse = await cdp.evaluate(verifyChatCollapseExpression);
  assert.equal(chatCollapse.collapsed.state, 'true', '聊天收合未更新 data-chat-collapsed');
  assert.equal(chatCollapse.collapsed.ariaExpanded, 'false', '聊天收合未更新 aria-expanded');
  assert.notEqual(chatCollapse.collapsed.ariaControls, null, '聊天收合缺少 aria-controls');
  assert.equal(chatCollapse.collapsed.retained, true, '聊天收合卸載了頻道、輸入或訊息節點');
  assert(chatCollapse.collapsed.height < chatCollapse.expanded.height,
    `聊天收合未縮成單列：${JSON.stringify(chatCollapse)}`);
  assert.equal(chatCollapse.reopened.state, 'false', '聊天重新展開未更新 data-chat-collapsed');
  assert.equal(chatCollapse.reopened.retained, true, '聊天重新展開未保留內容節點');
  assert.equal(chatCollapse.reopened.scrollTop, chatCollapse.expanded.scrollTop, '聊天重新展開遺失訊息捲動位置');

  const darkTheme = await cdp.evaluate(verifyDarkThemeExpression);
  assert.equal(darkTheme.mode, 'dark', '正式主題偏好未切為深色');
  assert.equal(darkTheme.applied, 'dark', '正式主題 API 未套用深色模式');
  assert.notEqual(darkTheme.after, darkTheme.before, '工作窗仍使用淺色背景');
  await captureWorkspace(cdp, 'implemented-dark.png');
  await cdp.evaluate(`(async () => { const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts'); updateUiColorMode('light'); await window.__gameWorkspaceProof.nextPaint(); })()`);

  await setViewport(cdp, PHONE);
  const mobileInteractionAndQuick = await cdp.evaluate(verifyInteractionAndQuickActionsExpression);
  assert.equal(mobileInteractionAndQuick.disclosure?.expanded, 'true', '手機聊天行動列未能展開');
  assert.equal(mobileInteractionAndQuick.disclosure?.rowVisible, true, '手機聊天行動列展開後不可見');
  assert.equal(mobileInteractionAndQuick.disclosure?.helpInteractive, true, '手機聊天行動說明不可操作');
  assert.equal(mobileInteractionAndQuick.disclosure?.inputRetained, true, '手機聊天行動 disclosure 破壞輸入框');
  await captureWorkspace(cdp, 'implemented-mobile-actions-open.png');
  const mobileInteraction = await cdp.evaluate(verifyMobileInteractionExpression);
  assert.equal(mobileInteraction.collapsed, true, '手機附近行動浮窗預設未收合');
  assert.equal(mobileInteraction.expanded, true, '手機附近行動浮窗無法展開');
  assert.equal(mobileInteraction.executed, true, '手機附近行動展開後無法執行真實 action');
  assert.equal(mobileInteraction.visible, true, '手機附近行動按鈕不可見');
  const mobileSurface = await cdp.evaluate(verifyMobileSurfaceExpression);
  assert.equal(mobileSurface.base.viewport.width, PHONE.width, '手機主畫面寬度未同步');
  assert(mobileSurface.base.hudHeight > 0 && mobileSurface.base.hudHeight <= 90, `手機 compact HUD 超過 90px：${mobileSurface.base.hudHeight}`);
  assert(mobileSurface.base.canvas.width > 0 && mobileSurface.base.canvas.height > 0 && mobileSurface.base.canvas.cssWidth > 0,
    '手機主畫面沒有真實地圖 canvas backbuffer');
  assert.equal(mobileSurface.base.canvas.rendered, true, `手機主畫面地圖 backbuffer 為空白：${mobileSurface.base.canvas.renderedPixel}`);
  assert.equal(mobileSurface.base.centerCoveredBy.length, 0, `手機中央角色區被面板覆蓋：${mobileSurface.base.centerCoveredBy.join(',')}`);
  assert.equal(mobileSurface.base.dockCount, 6, `手機底部 dock 項目數錯誤：${mobileSurface.base.dockCount}`);
  assert(mobileSurface.base.dockMinHeight >= 44, '手機底部 dock 觸控高度不足 44px');
  for (const target of mobileSurface.base.touchTargets) {
    assert.equal(target.visible, true, `手機觸控入口不可見：${target.selector}`);
    assert(target.height >= 44, `手機觸控入口高度不足 44px：${target.selector}=${target.height}`);
  }
  assert.equal(mobileSurface.base.mapTools.zoomVisible, false, '手機主畫面平時顯示縮放工具');
  assert.equal(mobileSurface.opened.expanded, 'true', '手機地圖工具未展開');
  assert.equal(mobileSurface.opened.zoomVisible, true, '手機地圖工具展開後縮放控制不可見');
  assert.equal(mobileSurface.mutuallyExclusive.mapClosed, true, '手機地圖工具未與其它互斥');
  assert.equal(mobileSurface.actionsExclusive, true, '手機聊天行動展開後附近浮窗未收合');
  assert.equal(mobileSurface.actionInput?.connected, true, '手機 surface 切換卸載聊天輸入');
  assert.equal(mobileSurface.actionInput?.value, '赤鐵', '手機 surface 切換遺失聊天輸入值');
  const mapToolsPointer = await clickCenterWithCdp(cdp, '#mobile-map-tools-toggle');
  assert.equal(mapToolsPointer.hit, true, '手機地圖工具開關中心被透明浮層遮擋');
  const mapToolsPointerState = await cdp.evaluate(`document.getElementById('game-shell')?.dataset.mapToolsOpen`);
  assert.equal(mapToolsPointerState, 'true', 'CDP 點擊手機地圖工具未展開');
  await clickCenterWithCdp(cdp, '#mobile-map-tools-toggle');
  assert.equal(await cdp.evaluate(`document.getElementById('game-shell')?.dataset.mapToolsOpen`), 'false', 'CDP 點擊手機地圖工具無法收合');
  await captureWorkspace(cdp, 'implemented-mobile-main-light.png');
  await cdp.evaluate(`(async () => { const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts'); updateUiColorMode('dark'); await window.__gameWorkspaceProof.nextPaint(); })()`);
  await captureWorkspace(cdp, 'implemented-mobile-main-dark.png');
  await cdp.evaluate(`(async () => { const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts'); updateUiColorMode('light'); await window.__gameWorkspaceProof.nextPaint(); })()`);
  const phoneNearbyOpen = await cdp.evaluate(verifyMobileInteractionExpression);
  assert.equal(phoneNearbyOpen.expanded, true, '390x844 手機附近行動無法展開');
  assert.equal(phoneNearbyOpen.closedAfterAction, true, '手機選擇交互後未收起面板');
  const nearbyPointer = await clickCenterWithCdp(cdp, '#floating-interaction-list [data-floating-list-collapse="true"]');
  assert.equal(nearbyPointer.hit, true, '手機附近交互入口被透明層遮擋');
  assert.equal(await cdp.evaluate(`document.getElementById('floating-interaction-list').classList.contains('is-collapsed')`), false, '實際點擊未開啟附近交互');
  await captureWorkspace(cdp, 'implemented-phone-nearby-open.png');
  const chatPointer = await clickCenterWithCdp(cdp, '#workspace-chat-toggle');
  assert.equal(chatPointer.hit, true, '手機聊天入口被透明層遮擋');
  assert.equal(await cdp.evaluate(`document.getElementById('workspace-chat-toggle').getAttribute('aria-expanded')`), 'true', '實際點擊未開啟聊天');
  assert.equal(await cdp.evaluate(`document.getElementById('floating-interaction-list').classList.contains('is-collapsed')`), true, '聊天未收起附近交互');
  await setViewport(cdp, PHONE_BROWSER_CHROME);
  const phoneChromeSurface = await cdp.evaluate(verifyMobileSurfaceExpression);
  assert.equal(phoneChromeSurface.base.viewport.width, PHONE_BROWSER_CHROME.width, '390x670 手機視口未同步');
  assert(phoneChromeSurface.base.hudHeight > 0 && phoneChromeSurface.base.hudHeight <= 90, '390x670 compact HUD 超過 90px');
  await captureWorkspace(cdp, 'implemented-phone-browser-chrome.png');
  await setViewport(cdp, PHONE_SMALL);
  const phoneSmallSurface = await cdp.evaluate(verifyMobileSurfaceExpression);
  assert.equal(phoneSmallSurface.base.viewport.width, PHONE_SMALL.width, '375x667 手機視口未同步');
  assert(phoneSmallSurface.base.hudHeight > 0 && phoneSmallSurface.base.hudHeight <= 90, '375x667 compact HUD 超過 90px');
  await captureWorkspace(cdp, 'implemented-phone-small.png');
  const mobileWorkspace = await cdp.evaluate(verifyMobileWorkspaceExpression);
  assert.equal(mobileWorkspace.nearFullscreen, true, '手機工作窗未接近全屏且完整位於視口內');
  assert.equal(mobileWorkspace.activeEquipment, true, '手機工作窗無法導航到裝備分頁');
  assert.equal(mobileWorkspace.closed, true, '手機工作窗導航後無法返回地圖');
  await setViewport(cdp, PHONE);
  await cdp.evaluate(`(async () => {
    const toggle = document.getElementById('workspace-chat-toggle'); if (toggle?.getAttribute('aria-expanded') !== 'true') toggle?.click();
    await window.__gameWorkspaceProof.nextPaint();
    const picker = document.querySelector('#chat-panel [data-chat-slot-select]');
    if (!(picker instanceof HTMLSelectElement)) throw new Error('聊天頻道選單不存在');
    picker.value = 'nearby'; picker.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-chat-slot-activate="' + picker.dataset.chatSlotSelect + '"]').click();
    await window.__gameWorkspaceProof.nextPaint();
    const input = document.getElementById('chat-input');
    if (input.disabled) throw new Error('附近頻道輸入欄位不可輸入');
    if (input instanceof HTMLInputElement) { input.value = '赤鐵'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    await window.__gameWorkspaceProof.nextPaint();
  })()`);
  const mockedVisualViewport = await cdp.evaluate(mockVisualViewportExpression);
  assert.equal(mockedVisualViewport.visualHeight, 390, 'mock visualViewport 高度未套用');
  assert.equal(mockedVisualViewport.offsetTop, 40, 'mock visualViewport offsetTop 未套用');
  assert(Math.abs(mockedVisualViewport.cssOffsetY - 40) <= 1, `responsive root 未套用 visualViewport offsetTop：${mockedVisualViewport.cssOffsetY}`);
  assert.equal(mockedVisualViewport.marker, 'true', 'mock 鍵盤視口未啟用 data-mobile-keyboard');
  assert(mockedVisualViewport.rootHeight <= 390 + 2, `鍵盤可視 root 高度未貼齊：${mockedVisualViewport.rootHeight}`);
  assert.deepEqual(mockedVisualViewport.point, { x: 50, y: 50 }, 'visual viewport 偏移後座標換算錯誤');
  assert(mockedVisualViewport.inputVisible && mockedVisualViewport.inputBottom <= 430 + 2, '鍵盤視口聊天輸入未位於可視區');
  await captureWorkspace(cdp, 'implemented-mobile-keyboard.png');
  await cdp.evaluate(`window.__gameWorkspaceProof.restoreVisualViewport(); true`);
  await setViewport(cdp, LANDSCAPE);
  const landscapeSurface = await cdp.evaluate(verifyMobileSurfaceExpression);
  assert.equal(landscapeSurface.base.viewport.width, LANDSCAPE.width, '844x390 touch 視口未同步');
  assert(landscapeSurface.base.canvas.width > 0 && landscapeSurface.base.canvas.height > 0, '844x390 touch 沒有真實地圖 canvas');
  assert.equal(landscapeSurface.base.dockCount, 6, '844x390 touch 底部 dock 項目數錯誤');
  const nearbyOpen = await cdp.evaluate(verifyMobileInteractionExpression);
  assert.equal(nearbyOpen.expanded, true, '844x390 touch 附近行動無法展開');
  assert.equal(nearbyOpen.executed, true, '844x390 touch 附近行動無法執行');
  await clickCenterWithCdp(cdp, '#floating-interaction-list [data-floating-list-collapse="true"]');
  await captureWorkspace(cdp, 'implemented-mobile-nearby-open.png');
  await setViewport(cdp, LARGE_DESKTOP, { touch: false });
  await waitFor(() => cdp.evaluate(`document.documentElement.dataset.desktopScaleLock === 'true'`), '恢復大型桌面 responsive locked');

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
  await verifyMobileInventoryInteractions(cdp, PHONE_SMALL);
  await verifyMobileInventoryInteractions(cdp, PHONE_BROWSER_CHROME, 'dark');
  await verifyMobileInventoryInteractions(cdp, LANDSCAPE);
  await setViewport(cdp, DESKTOP, { touch: false });
  await setViewport(cdp, SQUARE_DESKTOP, { touch: false });
  const squareCompactness = await cdp.evaluate(measureWorkspaceCompactnessExpression);
  assert.equal(squareCompactness.items.compact, 'false', '900x900 背包工作窗錯誤套用 compact 版型');
  assert.equal(squareCompactness.system.compact, 'true', '900x900 系統工作窗未套用 compact 版型');
  assert(squareCompactness.items.width > squareCompactness.system.width,
    `900x900 背包工作窗未大於系統工作窗：${JSON.stringify(squareCompactness)}`);
  assert(squareCompactness.items.height > squareCompactness.system.height,
    `900x900 背包工作窗高度未大於系統工作窗：${JSON.stringify(squareCompactness)}`);
  await setViewport(cdp, DESKTOP, { touch: false });
  await cdp.evaluate(openWorkspaceExpression);
  await cdp.evaluate(openWorkspaceExpression);
  assert.equal(await cdp.evaluate(`document.getElementById('game-workspace').classList.contains('hidden')`), false, '桌面重點同項目意外關閉工作窗');
  const desktopHover = await cdp.evaluate(`(async () => {
    const cell = document.querySelector('.inventory-cell'); cell.scrollIntoView({ block: 'center' });
    cell.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 100, clientY: 150 }));
    await window.__gameWorkspaceProof.nextPaint();
    return document.querySelector('.inventory-tooltip.visible')?.textContent ?? '';
  })()`);
  assert.match(desktopHover, /回春散/, '桌面滑鼠道具說明遺失');
  await verifyWorkspaceOutsideDismiss(cdp, PHONE, true);
  await verifyWorkspaceOutsideDismiss(cdp, LANDSCAPE, true);
  await verifyWorkspaceOutsideDismiss(cdp, DESKTOP, false);
});

console.log('game workspace proof: PASS');
