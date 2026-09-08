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
const LARGE_DESKTOP = { width: 3727, height: 2233 };
const VISUALIZATION_DIR = process.env.WORKSPACE_PROOF_OUTPUT_DIR;

const fixtureExpression = String.raw`
  (async () => {
    const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const calls = [];
    const player = {
      id: 'workspace-proof-player', mapId: 'starter_village', realmLv: 3,
      name: '驗證玩家長名', displayName: '驗證玩家長名',
      realm: { realmLv: 3, stage: 'qi_refining' }, foundation: 18, qi: 66000,
      x: 14, y: 22, hp: 680000, maxHp: 1000000, numericStats: { maxQi: 400000 },
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
    const name = document.getElementById('hud-name');
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
    const target = document.querySelector('#game-dock [data-workspace-open="craft"], #game-dock [data-workspace-open="items"]');
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
  assert.match(fixture.hpText ?? '', /68萬\s*\/\s*100萬/, '正式 HUD 未顯示長數值 fixture 氣血');
  assert.match(fixture.qiText ?? '', /6\.6萬\s*\/\s*40萬/, '正式 HUD 未顯示長數值 fixture 靈氣');
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
