/**
 * 本文件是客户端 DOM UI 的 side panel 模块，负责具体面板、弹层或渲染片段。
 *
 * 维护时优先保持局部更新和原有交互状态，不在 UI 层裁定资产、战斗或移动合法性。
 */
/** 页面布局与多组标签页控制器 */
import { DESKTOP_LAYOUT_DRAG_LIMITS } from '../constants/ui/responsive';
import { shouldUseMobileUi } from './responsive-viewport';
import { requestMobileSurface, subscribeMobileSurface } from './mobile-surface';
import { t } from './i18n';
import { isReactPanelEnabled } from '../react-ui/bridge/panel-flags';
import { mountFloatingListPanelLayer, refreshFloatingListPanelLayout } from './floating-list-panel';
import { dismissPinnedFloatingTooltips } from './floating-tooltip';
import { bindDesktopWindow } from './desktop-window';
import {
  WORKSPACES, mountWorkspaceNavigation, mountWorkspaceActions,
  type WorkspaceId, type WorkspaceAction, type WorkspaceDefinition, type WorkspaceNavigationMount,
} from '../react-ui/shell/WorkspaceNavigation';
import {
  buildSidePanelTabId,
  mountReactSidePanelTabGroup,
  mountReactSidePanelToggle,
  syncReactSidePanelLayoutState,
  syncReactSidePanelMobileLayout,
  type ReactSidePanelLayoutTarget,
  type ReactSidePanelMobileSection,
  type ReactSidePanelTabButton,
} from '../react-ui/shell/SidePanelControls';

/** 移动端挂载位标识。 */
type MobilePaneId =
  | 'mobile-overview'
  | 'mobile-attrs'
  | 'mobile-world'
  | 'mobile-bag'
  | 'mobile-action';

/** 桌面布局拖拽目标边。 */
type LayoutTarget = 'left' | 'right' | 'bottom';

export type SidePanelLayoutCollapseState = Record<`${LayoutTarget}Collapsed`, boolean>;

/** 侧边栏布局持久化状态。 */
type SidePanelPersistedState = {
/**
 * version：version相关字段。
 */

  version: 1;  
  /**
 * layoutState：layout状态状态或数据块。
 */

  layoutState?: Partial<Record<`${LayoutTarget}Collapsed`, boolean>>;  
  /**
 * layoutSizes：layout规模相关字段。
 */

  layoutSizes?: Partial<Record<LayoutTarget, number>>;  
  /**
 * activeTabs：激活Tab相关字段。
 */

  activeTabs?: Record<string, string>;
};

/** 固定面板 Tab 切换上下文。 */
export type SidePanelTabTransition = {
  groupId: string;
  previousTabName: string | null;
  tabName: string;
  initializing: boolean;
};

/** 统一接收任意入口触发的固定面板切换生命周期。 */
export type SidePanelTabTransitionListener = {
  beforeTabChange?(transition: SidePanelTabTransition): void;
  afterTabChange?(transition: SidePanelTabTransition): void;
};

/** SIDE_PANEL_STORAGE_KEY：SIDE面板存储KEY。 */
const SIDE_PANEL_STORAGE_KEY = 'mud:side-panel-state:v1';

/** 移动端重新挂载的面板节点记录。 */
type MobileSectionMount = {
/**
 * element：element相关字段。
 */

  element: HTMLElement;  
  /**
 * paneId：paneID标识。
 */

  paneId: MobilePaneId;  
  /**
 * originalParent：originalParent相关字段。
 */

  originalParent: HTMLElement;  
  /**
 * originalNextSibling：originalNextSibling相关字段。
 */

  originalNextSibling: ChildNode | null;
};

/** SidePanel：Side面板实现。 */
export class SidePanel {
  /** DRAG_START_THRESHOLD_PX：DRAG START THRESHOLD PX。 */
  private static readonly DRAG_START_THRESHOLD_PX = 6;
  /** panel：面板。 */
  private panel: HTMLElement;
  /** mobileShell：mobile Shell。 */
  private mobileShell: HTMLElement | null;
  /** mobileExpandToggle：移动端底部壳放大/收起按钮（其他 HTML 入口可能无此节点）。 */
  private mobileExpandToggle: HTMLButtonElement | null;
  /** mobileExpanded：移动端底部壳是否处于放大态；每次加载默认收起，不持久化。 */
  private mobileExpanded = false;
  /** mobileExpandTransitionHandler：放大切换的 transitionend 监听器引用，防止快速切换时堆叠。 */
  private mobileExpandTransitionHandler: ((event: TransitionEvent) => void) | null = null;
  /** mobileSections：mobile Sections。 */
  private mobileSections: MobileSectionMount[];
  /** persistedState：persisted状态。 */
  private persistedState: SidePanelPersistedState | null;
  /** mobileLayoutActive：mobile布局活跃。 */
  private mobileLayoutActive = false;
  /** visible：可见。 */
  private visible = false;
  /** onVisibilityChange：on Visibility变更。 */
  private onVisibilityChange: ((visible: boolean) => void) | null = null;
  /** onLayoutChange：on布局变更。 */
  private onLayoutChange: (() => void) | null = null;
  /** onTabChange：on Tab变更。 */
  private onTabChange: ((tabName: string) => void) | null = null;
  private readonly tabTransitionListeners = new Set<SidePanelTabTransitionListener>();
  private readonly activeTabNames = new WeakMap<HTMLElement, string>();
  private readonly preparedTabTransitions = new WeakMap<HTMLElement, SidePanelTabTransition>();
  private tabsInitialized = false;
  private workspace: HTMLElement | null = null;
  private workspaceBackdrop: HTMLElement | null = null;
  private workspaceNavigation: WorkspaceNavigationMount | null = null;
  private workspaceDefinitions: WorkspaceDefinition[] = [];
  private readonly workspacePanes = new Map<string, HTMLElement>();
  private workspaceGroups: HTMLElement[] | null = null;
  private readonly workspaceGroupTabs = new Map<HTMLElement, HTMLElement[]>();
  private readonly workspaceGroupPanes = new Map<HTMLElement, HTMLElement[]>();
  private activeWorkspace: WorkspaceId | null = null;
  private workspaceTab: string | null = null;
  private workspaceReturnFocus: HTMLElement | null = null;
  private chatOpen: boolean | null = null;
  private workspaceWindow: ReturnType<typeof bindDesktopWindow> | null = null;
  private chatWindow: ReturnType<typeof bindDesktopWindow> | null = null;
  private hudWindow: ReturnType<typeof bindDesktopWindow> | null = null;
  private workspaceActionHandler: ((action: WorkspaceAction) => void) | null = null;
  private workspaceContentHandler: ((tab: string | null, pane: HTMLElement | null) => void) | null = null;
  private readonly workspaceActionRoots: { unmount(): void }[] = [];
  private readonly mobileSurfaceCleanup: (() => void)[] = [];
  private readonly dismissMobileSurfacesOnMap = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest('#game-canvas')) requestMobileSurface(null);
  };
  /**
 * layoutState：layout状态状态或数据块。
 */

  private layoutState = {
    leftCollapsed: false,
    rightCollapsed: false,
    bottomCollapsed: false,
  };
  private buildingModeActive = false;
  /**
 * 构造器：初始化 当前 实例并建立基础状态。
 * @returns 无返回值，完成实例初始化。
 */


  constructor() {
    this.panel = document.getElementById('game-shell')!;
    this.mobileShell = document.getElementById('mobile-ui-shell');
    this.mobileExpandToggle = document.querySelector<HTMLButtonElement>('#mobile-shell-expand-toggle');
    this.persistedState = this.readPersistedState();
    this.restorePersistedLayoutState();
    this.mobileSections = this.collectMobileSections();
    this.bindTabGroups();
    this.bindLayoutToggles();
    this.bindLayoutTransitionSync();
    this.bindResponsiveLayout();
    this.bindMobileExpandToggle();
    this.restorePersistedLayoutSizes();
    this.initializeTabStates();
    this.initializeWorkspace();
    this.syncLayoutState();
    this.syncResponsiveLayout();
    this.mountReactTabGroups();
  }

  /** show：处理显示。 */
  show(): void {
    this.panel.classList.remove('hidden');
    this.visible = true;
    this.hudWindow?.refresh();
    if (this.workspace) refreshFloatingListPanelLayout();
    if (this.workspace) {
      this.chatOpen ??= !this.mobileLayoutActive;
      this.syncChatVisibility();
    }
    this.onVisibilityChange?.(true);
  }

  /** hide：处理hide。 */
  hide(): void {
    this.closeWorkspace(false);
    this.panel.classList.add('hidden');
    this.visible = false;
    this.onVisibilityChange?.(false);
  }

  /** toggle：处理toggle。 */
  toggle(): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (this.visible) {
      this.hide();
      return;
    }
    this.show();
  }

  /** isVisible：判断是否可见。 */
  isVisible(): boolean {
    return this.visible;
  }  

  getLayoutCollapseState(): SidePanelLayoutCollapseState {
    return {
      leftCollapsed: this.layoutState.leftCollapsed,
      rightCollapsed: this.layoutState.rightCollapsed,
      bottomCollapsed: this.layoutState.bottomCollapsed,
    };
  }

  setLayoutCollapsed(target: LayoutTarget, collapsed: boolean, options: { persist?: boolean } = {}): void {
    if (target === 'left') {
      this.layoutState.leftCollapsed = collapsed;
    } else if (target === 'right') {
      this.layoutState.rightCollapsed = collapsed;
    } else {
      this.layoutState.bottomCollapsed = collapsed;
    }
    this.syncLayoutState(options);
    this.onLayoutChange?.();
  }

  setLayoutCollapseState(state: Partial<SidePanelLayoutCollapseState>, options: { persist?: boolean } = {}): void {
    if (typeof state.leftCollapsed === 'boolean') {
      this.layoutState.leftCollapsed = state.leftCollapsed;
    }
    if (typeof state.rightCollapsed === 'boolean') {
      this.layoutState.rightCollapsed = state.rightCollapsed;
    }
    if (typeof state.bottomCollapsed === 'boolean') {
      this.layoutState.bottomCollapsed = state.bottomCollapsed;
    }
    this.syncLayoutState(options);
    this.onLayoutChange?.();
  }

  setBuildingModeActive(active: boolean): void {
    if (active) this.closeWorkspace(false);
    this.buildingModeActive = active;
    this.syncReactLayoutState();
    this.onLayoutChange?.();
  }

  isMobileLayoutActive(): boolean {
    return this.mobileLayoutActive;
  }

  /**
 * setVisibilityChangeCallback：写入可见性ChangeCallback。
 * @param callback (visible: boolean) => void 参数说明。
 * @returns 无返回值，直接更新可见性ChangeCallback相关状态。
 */


  setVisibilityChangeCallback(callback: (visible: boolean) => void): void {
    this.onVisibilityChange = callback;
  }  
  /**
 * setLayoutChangeCallback：写入LayoutChangeCallback。
 * @param callback () => void 参数说明。
 * @returns 无返回值，直接更新LayoutChangeCallback相关状态。
 */


  setLayoutChangeCallback(callback: () => void): void {
    this.onLayoutChange = callback;
  }  
  /**
 * setTabChangeCallback：写入TabChangeCallback。
 * @param callback (tabName: string) => void 参数说明。
 * @returns 无返回值，直接更新TabChangeCallback相关状态。
 */


  setTabChangeCallback(callback: (tabName: string) => void): void {
    this.onTabChange = callback;
  }

  addTabTransitionListener(listener: SidePanelTabTransitionListener): () => void {
    this.tabTransitionListeners.add(listener);
    return () => this.tabTransitionListeners.delete(listener);
  }

  initializeTabs(): void {
    if (this.tabsInitialized) return;
    this.tabsInitialized = true;
    const persistedTabs = this.persistedState?.activeTabs ?? {};
    this.getTabGroups().forEach((group) => {
      const groupId = group.dataset.tabGroup;
      const currentTabName = this.getGroupActiveTabName(group);
      if (!groupId || !currentTabName) return;
      const persistedTabName = persistedTabs[groupId];
      const targetTabName = persistedTabName
        && this.getGroupTabs(group).some((button) => button.dataset.tab === persistedTabName)
        && this.getGroupPanes(group).some((pane) => pane.dataset.pane === persistedTabName)
        ? persistedTabName
        : currentTabName;
      this.switchGroupTab(group, targetTabName, { forceLifecycle: true, initializing: true, persist: false });
    });
  }

  getActiveTabName(groupId: string): string | null {
    const group = this.getTabGroups()
      .find((entry) => entry.dataset.tabGroup === groupId);
    return group ? this.getGroupActiveTabName(group) : null;
  }

  /** switchTab：处理switch Tab。 */
  switchTab(tabName: string): void {
    dismissPinnedFloatingTooltips();
    if (this.workspace) {
      if (tabName === 'logbook') {
        this.setChatOpen(true, false);
        this.onTabChange?.(tabName);
        return;
      }
      const aliases: Record<string, string> = {
        'mobile-overview': 'overview', 'mobile-attrs': 'attr', 'mobile-bag': 'inventory',
        'mobile-action': 'dialogue', action: 'dialogue', crafting: 'alchemy', 'mobile-world': 'map-intel', intel: 'map-intel',
      };
      tabName = aliases[tabName] ?? tabName;
      if (this.workspacePanes.has(tabName)) {
        const group = this.getTabGroups().find((entry) => this.getGroupTabs(entry).some((tab) => tab.dataset.tab === tabName));
        if (group) this.switchGroupTab(group, tabName);
        else {
          this.showWorkspaceTab(tabName);
          this.onTabChange?.(tabName);
        }
        return;
      }
    }
    const groups = this.getTabGroups();
    groups.forEach(group => {
      const hasTarget = this.getGroupTabs(group)
        .some(button => button.dataset.tab === tabName);
      if (hasTarget) {
        this.switchGroupTab(group, tabName);
      }
    });
  }

  /** 同一正式工作區可從 dock、HUD 摘要或場景入口直達。 */
  openWorkspace(id: WorkspaceId): void {
    const tab = this.getWorkspaceEntryTab(id);
    if (tab) this.switchTab(tab);
  }

  private getWorkspaceEntryTab(id: WorkspaceId): string | null {
    const definition = this.workspaceDefinitions.find((entry) => entry.id === id);
    if (!definition) return null;
    const remembered = this.persistedState?.activeTabs?.[`workspace-${id}`];
    const tab = definition.tabs.find((entry) => entry.id === remembered) ?? definition.tabs[0];
    return tab?.id ?? null;
  }

  isWorkspaceOpen(): boolean {
    return this.activeWorkspace !== null;
  }

  isChatOpen(): boolean {
    return this.chatOpen === true;
  }

  toggleChat(): void {
    this.setChatOpen(!this.isChatOpen());
  }

  /** 聊天只摺疊內容，保留原頻道、輸入框、訊息列表與常駐標題列。 */
  setChatOpen(open: boolean, restoreFocus = !open): void {
    if (!this.workspace) return;
    if (open) requestMobileSurface('chat');
    if (open && this.mobileLayoutActive) this.closeWorkspace(false);
    this.chatOpen = open;
    this.syncChatVisibility();
    if (!open && restoreFocus) document.getElementById('workspace-chat-toggle')?.focus({ preventScroll: true });
  }

  private syncChatVisibility(): void {
    const chat = document.getElementById('chat-panel');
    if (!chat) return;
    const open = this.isChatOpen();
    this.panel.dataset.chatOpen = String(open);
    chat.hidden = false;
    chat.classList.remove('hidden');
    chat.setAttribute('aria-hidden', 'false');
    chat.dataset.chatCollapsed = String(!open);
    const content = document.getElementById('workspace-chat-content');
    if (content) content.hidden = !open;
    chat.dataset.expanded = String(open);
    this.renderWorkspaceNavigation();
    this.chatWindow?.refresh();
    this.onLayoutChange?.();
  }

  setWorkspaceActionHandler(handler: (action: WorkspaceAction) => void): void {
    this.workspaceActionHandler = handler;
  }

  setWorkspaceContentHandler(handler: (tab: string | null, pane: HTMLElement | null) => void): void {
    this.workspaceContentHandler = handler;
  }

  closeWorkspace(restoreFocus = true): void {
    dismissPinnedFloatingTooltips();
    if (!this.workspace || !this.activeWorkspace) return;
    const previousWorkspace = this.activeWorkspace;
    this.activeWorkspace = null;
    this.workspaceContentHandler?.(null, null);
    this.workspace.hidden = true;
    this.workspace.classList.add('hidden');
    this.workspace.setAttribute('aria-hidden', 'true');
    this.panel.dataset.workspaceOpen = 'false';
    this.renderWorkspaceNavigation();
    if (restoreFocus) {
      const previous = this.workspaceReturnFocus;
      const fallback = document.querySelector<HTMLElement>(`#game-dock [data-workspace-open="${previousWorkspace}"]`);
      const target = previous?.isConnected && previous.getClientRects().length ? previous
        : fallback?.getClientRects().length ? fallback : document.getElementById('workspace-menu-toggle');
      target?.focus({ preventScroll: true });
    }
    this.onLayoutChange?.();
  }

  private getTabGroups(): HTMLElement[] {
    return this.workspaceGroups ?? [...this.panel.querySelectorAll<HTMLElement>('[data-tab-group]')];
  }

  private initializeWorkspace(): void {
    const workspace = document.getElementById('game-workspace');
    const body = document.getElementById('game-workspace-body');
    const controls = document.getElementById('game-workspace-controls');
    const dock = document.getElementById('game-dock');
    if (!workspace || !body || !controls || !dock || !isReactPanelEnabled('workspace-navigation')) {
      delete this.panel.dataset.workspaceMode;
      return;
    }
    this.workspaceGroups = this.getTabGroups();
    for (const group of this.workspaceGroups) {
      const tabs = this.getGroupTabs(group);
      this.workspaceGroupTabs.set(group, tabs);
      this.workspaceGroupPanes.set(group, this.getGroupPanes(group));
      // 舊入口只留在控制器映射中；不讓選擇器／輔助科技找到第二套隱藏導覽。
      for (const tab of tabs) this.resolveReactTabContainer(tab)?.remove();
    }
    this.workspace = workspace;
    const backdrop = document.createElement('div');
    backdrop.id = 'game-workspace-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    // 獨立背景接住整個點擊，關閉工作窗時不把同一次手勢送往地圖移動。
    backdrop.addEventListener('pointerdown', (event) => event.stopPropagation());
    backdrop.addEventListener('click', (event) => {
      if (event.target !== backdrop) return;
      event.stopPropagation();
      this.closeWorkspace();
    });
    this.panel.appendChild(backdrop);
    this.workspaceBackdrop = backdrop;
    this.panel.dataset.workspaceMode = 'true';
    this.panel.dataset.workspaceOpen = 'false';
    workspace.hidden = true;
    mountFloatingListPanelLayer(this.panel);
    const buildingToolbar = document.getElementById('building-mode-toolbar');
    if (buildingToolbar) this.panel.appendChild(buildingToolbar);
    workspace.classList.add('hidden');
    workspace.setAttribute('role', 'region');
    workspace.setAttribute('aria-labelledby', 'workspace-title');
    workspace.setAttribute('aria-hidden', 'true');

    for (const id of ['alchemy', 'forging', 'enhancement', 'transmission', 'skill', 'dialogue', 'utility', 'toggle']) {
      const pane = document.createElement('section');
      pane.id = `workspace-${id}`;
      body.appendChild(pane);
    }
    const launcher = document.createElement('section');
    launcher.id = 'workspace-building';
    body.appendChild(launcher);
    this.workspaceActionRoots.push(mountWorkspaceActions(launcher, (action) => this.workspaceActionHandler?.(action)));

    const systemContent = document.getElementById('workspace-system-content');
    if (systemContent) {
      for (const actions of this.panel.querySelectorAll<HTMLElement>('.hud-link-actions, .hud-corner-actions')) {
        systemContent.appendChild(actions);
      }
      // 保留既有事件接線，入口由各工作區的捷徑提供。
      for (const id of ['hud-open-mail', 'hud-open-activity', 'hud-open-chronicle']) {
        const button = document.getElementById(id);
        if (button) button.hidden = true;
      }
    }
    const chat = document.getElementById('chat-panel');
    const chatHeader = document.createElement('div');
    chatHeader.className = 'chat-header';
    if (chat) {
      this.panel.appendChild(chat);
      const content = document.createElement('div');
      content.id = 'workspace-chat-content';
      content.append(...chat.childNodes);
      chat.append(chatHeader, content);
    }
    for (const definition of WORKSPACES) {
      const tabs = definition.tabs.filter((tab) => {
        const pane = document.getElementById(tab.paneId);
        if (!pane) return false;
        body.appendChild(pane);
        pane.classList.add('workspace-pane');
        pane.classList.remove('active');
        pane.classList.add('hidden');
        pane.hidden = true;
        pane.setAttribute('role', 'tabpanel');
        pane.setAttribute('aria-hidden', 'true');
        this.workspacePanes.set(tab.id, pane);
        return true;
      });
      if (tabs.length) this.workspaceDefinitions.push({ ...definition, tabs });
    }
    this.workspaceNavigation = mountWorkspaceNavigation(dock, controls, chatHeader);
    this.workspaceWindow = bindDesktopWindow(workspace, {
      storageKey: () => `workspace-v2-${this.activeWorkspace ?? 'items'}-${workspace.dataset.compact === 'true' ? 'compact' : 'full'}`,
      handleSelector: '.workspace-heading', minWidth: 320, minHeight: 220,
    });
    if (chat) this.chatWindow = bindDesktopWindow(chat, {
      storageKey: 'chat', handleSelector: '.chat-header', minWidth: 360, minHeight: 280,
      isCollapsed: () => !this.isChatOpen(),
    });
    const hud = document.getElementById('hud');
    if (hud) this.hudWindow = bindDesktopWindow(hud, {
      storageKey: 'hud', handleSelector: '.hud-identity', minWidth: 260, minHeight: 140,
    });
    this.syncChatVisibility();
    window.addEventListener('keydown', this.handleWorkspaceEscape, true);
    this.mobileSurfaceCleanup.push(
      subscribeMobileSurface('chat', () => { if (this.isChatOpen()) this.setChatOpen(false, false); }),
      subscribeMobileSurface('workspace', () => { if (this.isWorkspaceOpen()) this.closeWorkspace(false); }),
    );
    this.panel.addEventListener('pointerdown', this.dismissMobileSurfacesOnMap);
  }

  private showWorkspaceTab(tabName: string): void {
    const definition = this.workspaceDefinitions.find((entry) => entry.tabs.some((tab) => tab.id === tabName));
    if (!this.workspace || !definition) return;
    requestMobileSurface('workspace');
    const opening = this.activeWorkspace === null;
    if (opening) this.workspaceReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.activeWorkspace = definition.id;
    this.workspaceTab = tabName;
    this.workspace.dataset.workspace = definition.id;
    this.workspace.dataset.compact = String(definition.compact === true || tabName === 'building');
    this.workspace.hidden = false;
    this.workspace.classList.remove('hidden');
    this.workspace.setAttribute('aria-hidden', 'false');
    this.panel.dataset.workspaceOpen = 'true';
    for (const [id, pane] of this.workspacePanes) {
      const active = id === tabName;
      pane.hidden = !active;
      pane.classList.toggle('hidden', !active);
      pane.classList.toggle('active', active);
      pane.setAttribute('aria-hidden', active ? 'false' : 'true');
      if (active) pane.setAttribute('aria-labelledby', `workspace-tab-${tabName}`);
      else pane.removeAttribute('aria-labelledby');
    }
    this.workspaceContentHandler?.(tabName, this.workspacePanes.get(tabName) ?? null);
    this.persistedState = {
      ...this.persistedState, version: 1,
      activeTabs: { ...this.persistedState?.activeTabs, [`workspace-${definition.id}`]: tabName },
    };
    this.writePersistedState();
    this.renderWorkspaceNavigation();
    this.workspaceWindow?.refresh();
    if (opening) document.getElementById(`workspace-tab-${tabName}`)?.focus({ preventScroll: true });
    this.onLayoutChange?.();
  }

  private renderWorkspaceNavigation(): void {
    this.workspaceNavigation?.update({
      activeWorkspace: this.activeWorkspace, activeTab: this.workspaceTab, chatOpen: this.isChatOpen(), workspaces: this.workspaceDefinitions,
      onOpen: (id) => this.openWorkspace(id), onSelectTab: (tab) => this.switchTab(tab), onClose: () => this.closeWorkspace(),
      onPrepareTab: (tab) => this.prepareWorkspaceTab(tab),
      onPrepareOpen: (id) => { const tab = this.getWorkspaceEntryTab(id); if (tab) this.prepareWorkspaceTab(tab); },
      onToggleChat: () => this.toggleChat(),
      onAction: (action) => this.workspaceActionHandler?.(action),
    });
  }

  private prepareWorkspaceTab(tabName: string): void {
    const group = this.getTabGroups().find((entry) => this.getGroupTabs(entry).some((tab) => tab.dataset.tab === tabName));
    if (group) this.prepareGroupTabTransition(group, tabName);
  }

  private readonly handleWorkspaceEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || this.panel.classList.contains('hidden')) return;
    // 在 capture 階段記住是否有上層視窗；由既有 host 完成詳情／確認的關閉和返回。
    const overlays = document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [aria-modal="true"], .modal, .modal-overlay, .detail-modal-layer, .confirm-modal-layer, .react-ui-modal-layer, [id$="-modal"], .guided-tour-overlay',
    );
    if ([...overlays].some((element) => element !== this.workspace && !element.hidden && element.getClientRects().length > 0)) return;
    if (this.workspaceNavigation?.closeMenu()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!this.activeWorkspace) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.closeWorkspace();
  };

  /** bindTabGroups：绑定Tab分组。 */
  private bindTabGroups(): void {
    const groups = this.panel.querySelectorAll<HTMLElement>('[data-tab-group]');
    groups.forEach(group => {
      group.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLButtonElement>('[data-tab]');
        if (!button || button.disabled || button.closest<HTMLElement>('[data-tab-group]') !== group) return;
        const tabName = button.dataset.tab;
        if (tabName) this.prepareGroupTabTransition(group, tabName);
      }, true);
      this.getGroupTabs(group).forEach(button => {
        button.addEventListener('click', () => {
          const tabName = button.dataset.tab;
          if (!tabName) return;
          this.switchGroupTab(group, tabName);
        });
      });
    });
  }

  /** bindLayoutToggles：绑定布局Toggles。 */
  private bindLayoutToggles(): void {}

  /** bindResponsiveLayout：绑定Responsive布局。 */
  private bindResponsiveLayout(): void {
    /** refresh：处理refresh。 */
    const refresh = () => {
      this.syncResponsiveLayout();
    };
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
    window.visualViewport?.addEventListener('resize', refresh);
    this.responsiveCleanup = () => {
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      window.visualViewport?.removeEventListener('resize', refresh);
    };
  }

  /** 清理 responsive 布局监听器。 */
  private responsiveCleanup: (() => void) | null = null;

  /** 销毁面板，释放事件监听器。 */
  destroy(): void {
    this.mobileSurfaceCleanup.forEach((cleanup) => cleanup());
    this.panel.removeEventListener('pointerdown', this.dismissMobileSurfacesOnMap);
    this.workspaceWindow?.destroy();
    this.workspaceBackdrop?.remove();
    this.workspaceBackdrop = null;
    this.chatWindow?.destroy();
    this.hudWindow?.destroy();
    window.removeEventListener('keydown', this.handleWorkspaceEscape, true);
    this.workspaceNavigation?.destroy();
    this.workspaceActionRoots.forEach((root) => root.unmount());
    this.responsiveCleanup?.();
    this.responsiveCleanup = null;
    if (this.mobileExpandTransitionHandler) {
      this.panel.removeEventListener('transitionend', this.mobileExpandTransitionHandler);
      this.mobileExpandTransitionHandler = null;
    }
  }

  /** bindMobileExpandToggle：绑定移动端底部壳放大/收起按钮（节点缺失时静默跳过）。 */
  private bindMobileExpandToggle(): void {
    if (!this.mobileExpandToggle) {
      return;
    }
    this.mobileExpandToggle.addEventListener('click', () => {
      this.toggleMobileExpanded();
    });
  }

  /** toggleMobileExpanded：切换底部壳放大态，更新按钮文案与 aria 状态并通知地图重排。 */
  private toggleMobileExpanded(): void {
    const button = this.mobileExpandToggle;
    if (!button) {
      return;
    }
    this.mobileExpanded = !this.mobileExpanded;
    // 与 data-building-mode 相同的 dataset true/false 写法，CSS 以 [data-mobile-expanded="true"] 匹配。
    this.panel.dataset.mobileExpanded = this.mobileExpanded ? 'true' : 'false';
    const labelKey = this.mobileExpanded ? 'shell.mobile-collapse' : 'shell.mobile-expand';
    const ariaKey = this.mobileExpanded
      ? 'shell.mobile-collapse.aria-label'
      : 'shell.mobile-expand.aria-label';
    const textNode = button.querySelector<HTMLElement>('.mobile-shell-expand-toggle-text');
    if (textNode) {
      // 同步更新 data-i18n 键与文本，保证后续静态 i18n 重扫仍取到正确文案。
      textNode.dataset.i18n = labelKey;
      textNode.textContent = t(labelKey);
    }
    button.dataset.i18nAriaLabel = ariaKey;
    button.setAttribute('aria-label', t(ariaKey));
    button.setAttribute('aria-expanded', this.mobileExpanded ? 'true' : 'false');
    const glyphNode = button.querySelector<HTMLElement>('.mobile-shell-expand-toggle-glyph');
    if (glyphNode) {
      glyphNode.textContent = this.mobileExpanded ? '⤓' : '⤒';
    }
    this.notifyMobileExpandedResize();
    this.onLayoutChange?.();
  }

  /** notifyMobileExpandedResize：放大切换后通知地图画布重测尺寸（立即一次 + 过渡结束后一次）。 */
  private notifyMobileExpandedResize(): void {
    // 下一帧立即派发 resize，兼容不支持 grid-template-rows 过渡而直接跳变的浏览器。
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    // 移除上一次尚未触发的 transitionend 监听，避免快速反复切换时堆叠。
    if (this.mobileExpandTransitionHandler) {
      this.panel.removeEventListener('transitionend', this.mobileExpandTransitionHandler);
      this.mobileExpandTransitionHandler = null;
    }
    const handler = (event: TransitionEvent) => {
      // transitionend 会冒泡；只认 game-shell 自身的 grid-template-rows 过渡。
      if (event.target !== this.panel || event.propertyName !== 'grid-template-rows') {
        return;
      }
      this.panel.removeEventListener('transitionend', handler);
      if (this.mobileExpandTransitionHandler === handler) {
        this.mobileExpandTransitionHandler = null;
      }
      window.dispatchEvent(new Event('resize'));
    };
    this.mobileExpandTransitionHandler = handler;
    this.panel.addEventListener('transitionend', handler);
  }

  /** bindLayoutTransitionSync：绑定布局Transition同步。 */
  private bindLayoutTransitionSync(): void {
    this.panel.addEventListener('transitionend', (event) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      const isShellColumnTransition = event.target === this.panel && event.propertyName === 'grid-template-columns';
      const isCenterRowTransition = event.target.id === 'layout-center' && event.propertyName === 'grid-template-rows';
      if (!isShellColumnTransition && !isCenterRowTransition) {
        return;
      }
      this.onLayoutChange?.();
    });
  }

  /** collectMobileSections：收集Mobile Sections。 */
  private collectMobileSections(): MobileSectionMount[] {
    return [...this.panel.querySelectorAll<HTMLElement>('[data-mobile-section]')]
      .map((element) => {
        const paneId = this.resolveMobilePaneId(element.dataset.mobileSection);
        const originalParent = element.parentElement;
        if (!paneId || !originalParent) {
          return null;
        }
        return {
          element,
          paneId,
          originalParent,
          originalNextSibling: element.nextSibling,
        } satisfies MobileSectionMount;
      })
      .filter((entry): entry is MobileSectionMount => entry !== null);
  }

  /** resolveMobilePaneId：解析Mobile Pane ID。 */
  private resolveMobilePaneId(section?: string): MobilePaneId | null {
    switch (section) {
      case 'overview':
        return 'mobile-overview';
      case 'attrs':
        return 'mobile-attrs';
      case 'world':
        return 'mobile-world';
      case 'bag':
        return 'mobile-bag';
      case 'action':
        return 'mobile-action';
      default:
        return null;
    }
  }

  /** shouldUseMobileLayout：判断是否使用Mobile布局。 */
  private shouldUseMobileLayout(): boolean {
    return shouldUseMobileUi(window);
  }

  /** syncResponsiveLayout：同步Responsive布局。 */
  private syncResponsiveLayout(): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const nextMobileLayoutActive = this.shouldUseMobileLayout();
    if (nextMobileLayoutActive === this.mobileLayoutActive) {
      return;
    }
    this.mobileLayoutActive = nextMobileLayoutActive;
    this.syncReactLayoutState();
    this.syncReactMobileLayout();
    this.onLayoutChange?.();
  }

  /** toggleLayout：处理toggle布局。 */
  private toggleLayout(target: 'left' | 'right' | 'bottom'): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (target === 'left') {
      this.layoutState.leftCollapsed = !this.layoutState.leftCollapsed;
    } else if (target === 'right') {
      this.layoutState.rightCollapsed = !this.layoutState.rightCollapsed;
    } else {
      this.layoutState.bottomCollapsed = !this.layoutState.bottomCollapsed;
    }
    this.syncLayoutState();
    this.onLayoutChange?.();
  }

  /** syncLayoutState：同步布局状态。 */
  private syncLayoutState(options: { persist?: boolean } = {}): void {
    this.syncReactLayoutState();

    this.syncToggleButton('left', this.layoutState.leftCollapsed
      ? { text: '>', title: t('side-panel.toggle.left.expand') }
      : { text: '<', title: t('side-panel.toggle.left.collapse') });
    this.syncToggleButton('right', this.layoutState.rightCollapsed
      ? { text: '<', title: t('side-panel.toggle.right.expand') }
      : { text: '>', title: t('side-panel.toggle.right.collapse') });
    this.syncToggleButton('bottom', this.layoutState.bottomCollapsed
      ? { text: '^', title: t('side-panel.toggle.bottom.expand') }
      : { text: 'v', title: t('side-panel.toggle.bottom.collapse') });
    if (options.persist !== false) {
      this.persistCurrentLayoutState();
    }
  }

  /** syncToggleButton：同步Toggle按钮。 */
  private syncToggleButton(target: 'left' | 'right' | 'bottom', state: {  
  /**
 * text：text名称或显示文本。
 */
 text: string;  
 /**
 * title：title名称或显示文本。
 */
 title: string }): void {
    if (this.workspace) return;
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const button = this.panel.querySelector<HTMLButtonElement>(`[data-layout-toggle="${target}"]`);
    if (!button) {
      return;
    }
    const expanded = target === 'left'
      ? (!this.layoutState.leftCollapsed)
      : target === 'right'
        ? (!this.layoutState.rightCollapsed)
        : (!this.layoutState.bottomCollapsed);
    mountReactSidePanelToggle(button, {
      label: state.text,
      title: state.title,
      expanded,
      target,
      getLayoutSize: (targetName) => this.getLayoutSize(targetName),
      getShellSize: () => ({
        width: this.panel.clientWidth,
        height: this.panel.clientHeight,
      }),
      isCollapsed: (targetName) => this.isCollapsed(targetName),
      setLayoutSize: (targetName, size) => this.setLayoutSize(targetName, size),
      onToggle: (targetName) => this.toggleLayout(targetName),
      onDragCommit: () => this.persistCurrentLayoutSizes(),
      onLayoutChange: () => this.onLayoutChange?.(),
    });
  }

  private syncReactLayoutState(): void {
    syncReactSidePanelLayoutState(this.panel, {
      leftCollapsed: this.layoutState.leftCollapsed,
      rightCollapsed: this.layoutState.rightCollapsed,
      bottomCollapsed: this.layoutState.bottomCollapsed,
      mobileLayoutActive: this.mobileLayoutActive,
      buildingModeActive: this.buildingModeActive,
    });
  }

  private syncReactMobileLayout(): void {
    if (this.workspace) return;
    syncReactSidePanelMobileLayout(this.panel, {
      mobileShell: this.mobileShell,
      active: this.mobileLayoutActive,
      sections: this.mobileSections.map((entry): ReactSidePanelMobileSection => ({
        element: entry.element,
        paneId: entry.paneId,
        originalParent: entry.originalParent,
        originalNextSibling: entry.originalNextSibling,
      })),
    });
  }

  /** isCollapsed：判断是否Collapsed。 */
  private isCollapsed(target: 'left' | 'right' | 'bottom'): boolean {
    return target === 'left'
      ? this.layoutState.leftCollapsed
      : target === 'right'
        ? this.layoutState.rightCollapsed
        : this.layoutState.bottomCollapsed;
  }

  /** clamp：处理clamp。 */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /** getLayoutSize：读取布局Size。 */
  private getLayoutSize(target: 'left' | 'right' | 'bottom'): number {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const selector = target === 'left'
      ? '#layout-left'
      : target === 'right'
        ? '#layout-right'
        : '#layout-center-bottom';
    const element = this.panel.querySelector<HTMLElement>(selector);
    if (!element) {
      return 0;
    }
    return target === 'bottom' ? element.offsetHeight : element.offsetWidth;
  }

  private setLayoutSize(target: ReactSidePanelLayoutTarget, size: number): void {
    const property = target === 'left'
      ? '--layout-left-size'
      : target === 'right'
        ? '--layout-right-size'
        : '--layout-bottom-size';
    this.panel.style.setProperty(property, `${size}px`);
  }

  /** switchGroupTab：处理switch分组Tab。 */
  private switchGroupTab(
    group: HTMLElement,
    tabName: string,
    options: { forceLifecycle?: boolean; initializing?: boolean; persist?: boolean } = {},
  ): void {
    const tabs = this.getGroupTabs(group);
    if (!tabs.some((button) => button.dataset.tab === tabName)) return;
    const groupId = group.dataset.tabGroup ?? '';
    const previousTabName = this.getGroupActiveTabName(group);
    const transition = {
      groupId,
      previousTabName,
      tabName,
      initializing: options.initializing === true,
    } satisfies SidePanelTabTransition;
    const changed = previousTabName !== tabName;
    const notifyLifecycle = (changed || options.forceLifecycle === true) && groupId.length > 0;
    const prepared = changed && this.consumePreparedTabTransition(group, transition);
    if (notifyLifecycle && !prepared) this.notifyBeforeTabChange(transition);
    this.activeTabNames.set(group, tabName);
    this.applyGroupTabState(group, tabName);
    if (this.workspace && !options.initializing && this.workspacePanes.has(tabName)) this.showWorkspaceTab(tabName);
    if (options.persist !== false) this.persistGroupActiveTab(group, tabName);
    this.syncReactTabGroup(group);
    this.onTabChange?.(tabName);
    if (notifyLifecycle) this.notifyAfterTabChange(transition);
  }

  private prepareGroupTabTransition(group: HTMLElement, tabName: string): void {
    const groupId = group.dataset.tabGroup ?? '';
    const previousTabName = this.getGroupActiveTabName(group);
    if (!groupId || !previousTabName || previousTabName === tabName) return;
    const transition = { groupId, previousTabName, tabName, initializing: false } satisfies SidePanelTabTransition;
    this.preparedTabTransitions.set(group, transition);
    this.notifyBeforeTabChange(transition);
  }

  private consumePreparedTabTransition(group: HTMLElement, transition: SidePanelTabTransition): boolean {
    const prepared = this.preparedTabTransitions.get(group);
    this.preparedTabTransitions.delete(group);
    return prepared?.previousTabName === transition.previousTabName
      && prepared.tabName === transition.tabName;
  }

  private notifyBeforeTabChange(transition: SidePanelTabTransition): void {
    for (const listener of this.tabTransitionListeners) listener.beforeTabChange?.(transition);
  }

  private notifyAfterTabChange(transition: SidePanelTabTransition): void {
    for (const listener of this.tabTransitionListeners) listener.afterTabChange?.(transition);
  }

  private applyGroupTabState(group: HTMLElement, tabName: string): void {
    const groupId = group.dataset.tabGroup ?? '';
    const panes = new Map(this.getGroupPanes(group).map((pane) => [pane.dataset.pane ?? '', pane] as const));
    this.getGroupTabs(group).forEach((button) => {
      const buttonTabName = button.dataset.tab ?? '';
      const active = buttonTabName === tabName;
      const pane = panes.get(buttonTabName);
      button.classList.toggle('active', active);
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
      if (groupId && buttonTabName) button.id = buildSidePanelTabId(groupId, buttonTabName);
      if (pane?.id) button.setAttribute('aria-controls', pane.id);
      else button.removeAttribute('aria-controls');
    });
    for (const [paneTabName, pane] of panes) {
      if (this.workspace) continue;
      const active = paneTabName === tabName;
      pane.classList.toggle('active', active);
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-hidden', active ? 'false' : 'true');
      if (groupId && paneTabName) pane.setAttribute('aria-labelledby', buildSidePanelTabId(groupId, paneTabName));
    }
  }

  private mountReactTabGroups(): void {
    this.panel.querySelectorAll<HTMLElement>('[data-tab-group]').forEach((group) => {
      this.syncReactTabGroup(group);
    });
  }

  private syncReactTabGroup(group: HTMLElement): void {
    if (this.workspace) return;
    const groupId = group.dataset.tabGroup;
    if (!groupId) {
      return;
    }
    const tabs = this.getGroupTabs(group);
    if (tabs.length === 0) {
      return;
    }
    const container = this.resolveReactTabContainer(tabs[0]);
    if (!container || !tabs.every((tab) => this.resolveReactTabContainer(tab) === container)) {
      return;
    }
    const activeTabName = this.getGroupActiveTabName(group) ?? tabs[0]?.dataset.tab ?? '';
    const state = {
      groupId,
      activeTabName,
      tabs: tabs.map((tab): ReactSidePanelTabButton => ({
        tabName: tab.dataset.tab ?? '',
        label: tab.textContent?.trim() || tab.dataset.tab || '',
        className: tab.className.replace(/\bactive\b/g, '').replace(/\s+/g, ' ').trim(),
        active: tab.dataset.tab === activeTabName,
        disabled: tab instanceof HTMLButtonElement && tab.disabled,
        i18nKey: tab.dataset.i18n,
      })).filter((tab) => tab.tabName.length > 0),
      panes: this.getGroupPanes(group)
        .map((pane) => ({
          tabName: pane.dataset.pane ?? '',
          element: pane,
        }))
        .filter((pane) => pane.tabName.length > 0),
    };
    if (state.tabs.length === 0) {
      return;
    }
    mountReactSidePanelTabGroup(container, state, (targetGroupId, tabName) => {
      if (targetGroupId !== groupId) {
        return;
      }
      this.switchGroupTab(group, tabName);
    });
  }

  private initializeTabStates(): void {
    this.panel.querySelectorAll<HTMLElement>('[data-tab-group]').forEach((group) => {
      const tabName = this.resolveInitialActiveTabName(group, this.getGroupTabs(group));
      if (!tabName) return;
      this.activeTabNames.set(group, tabName);
      this.applyGroupTabState(group, tabName);
    });
  }

  private getGroupActiveTabName(group: HTMLElement): string | null {
    return this.activeTabNames.get(group) ?? null;
  }

  private resolveInitialActiveTabName(group: HTMLElement, tabs: HTMLElement[]): string {
    const activeTabName = tabs.find((tab) => tab.classList.contains('active'))?.dataset.tab;
    if (activeTabName) {
      return activeTabName;
    }
    const activePaneName = this.getGroupPanes(group)
      .find((pane) => pane.classList.contains('active'))
      ?.dataset.pane;
    return activePaneName ?? tabs[0]?.dataset.tab ?? '';
  }

  private resolveReactTabContainer(tab: HTMLElement | undefined): HTMLElement | null {
    let container = tab?.parentElement ?? null;
    while (container?.classList.contains('react-side-panel-tab-host')) {
      container = container.parentElement;
    }
    return container;
  }

  /** getGroupTabs：读取分组标签页。 */
  private getGroupTabs(group: HTMLElement): HTMLElement[] {
    const stored = this.workspaceGroupTabs.get(group);
    if (stored) return stored;
    return [...group.querySelectorAll<HTMLElement>('[data-tab]')]
      .filter((button) => button.closest<HTMLElement>('[data-tab-group]') === group);
  }

  /** getGroupPanes：读取分组Panes。 */
  private getGroupPanes(group: HTMLElement): HTMLElement[] {
    const stored = this.workspaceGroupPanes.get(group);
    if (stored) return stored;
    return [...group.querySelectorAll<HTMLElement>('[data-pane]')]
      .filter((pane) => pane.closest<HTMLElement>('[data-tab-group]') === group);
  }

  /** restorePersistedLayoutState：处理restore Persisted布局状态。 */
  private restorePersistedLayoutState(): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const persistedLayoutState = this.persistedState?.layoutState;
    if (!persistedLayoutState) {
      return;
    }
    this.layoutState.leftCollapsed = persistedLayoutState.leftCollapsed === true;
    this.layoutState.rightCollapsed = persistedLayoutState.rightCollapsed === true;
    this.layoutState.bottomCollapsed = persistedLayoutState.bottomCollapsed === true;
  }

  /** restorePersistedLayoutSizes：处理restore Persisted布局Sizes。 */
  private restorePersistedLayoutSizes(): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const layoutSizes = this.persistedState?.layoutSizes;
    if (!layoutSizes) {
      return;
    }
    const leftSize = this.normalizeStoredLayoutSize('left', layoutSizes.left);
    const rightSize = this.normalizeStoredLayoutSize('right', layoutSizes.right);
    const bottomSize = this.normalizeStoredLayoutSize('bottom', layoutSizes.bottom);
    if (leftSize !== null) {
      this.panel.style.setProperty('--layout-left-size', `${leftSize}px`);
    }
    if (rightSize !== null) {
      this.panel.style.setProperty('--layout-right-size', `${rightSize}px`);
    }
    if (bottomSize !== null) {
      this.panel.style.setProperty('--layout-bottom-size', `${bottomSize}px`);
    }
  }

  /** persistCurrentLayoutState：持久化当前布局状态。 */
  private persistCurrentLayoutState(): void {
    this.persistedState = {
      version: 1,
      ...this.persistedState,
      layoutState: {
        leftCollapsed: this.layoutState.leftCollapsed,
        rightCollapsed: this.layoutState.rightCollapsed,
        bottomCollapsed: this.layoutState.bottomCollapsed,
      },
    };
    this.writePersistedState();
  }

  /** persistCurrentLayoutSizes：持久化当前布局Sizes。 */
  private persistCurrentLayoutSizes(): void {
    this.persistedState = {
      version: 1,
      ...this.persistedState,
      layoutSizes: {
        left: this.getLayoutSize('left'),
        right: this.getLayoutSize('right'),
        bottom: this.getLayoutSize('bottom'),
      },
    };
    this.writePersistedState();
  }

  /** persistGroupActiveTab：持久化分组活跃Tab。 */
  private persistGroupActiveTab(group: HTMLElement, tabName: string): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const groupId = group.dataset.tabGroup;
    if (!groupId) {
      return;
    }
    this.persistedState = {
      version: 1,
      ...this.persistedState,
      activeTabs: {
        ...(this.persistedState?.activeTabs ?? {}),
        [groupId]: tabName,
      },
    };
    this.writePersistedState();
  }

  /** normalizeStoredLayoutSize：规范化Stored布局Size。 */
  private normalizeStoredLayoutSize(target: LayoutTarget, value: unknown): number | null {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    if (target === 'left') {
      return this.clamp(Math.round(value), DESKTOP_LAYOUT_DRAG_LIMITS.leftMin, DESKTOP_LAYOUT_DRAG_LIMITS.leftMax);
    }
    if (target === 'right') {
      return this.clamp(Math.round(value), DESKTOP_LAYOUT_DRAG_LIMITS.rightMin, DESKTOP_LAYOUT_DRAG_LIMITS.rightMax);
    }
    return this.clamp(Math.round(value), DESKTOP_LAYOUT_DRAG_LIMITS.bottomMin, DESKTOP_LAYOUT_DRAG_LIMITS.bottomMax);
  }

  /** readPersistedState：处理read Persisted状态。 */
  private readPersistedState(): SidePanelPersistedState | null {
    try {
      const raw = window.localStorage.getItem(SIDE_PANEL_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
        return null;
      }
      return parsed as SidePanelPersistedState;
    } catch {
      return null;
    }
  }

  /** writePersistedState：处理write Persisted状态。 */
  private writePersistedState(): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (!this.persistedState) {
      return;
    }
    try {
      window.localStorage.setItem(SIDE_PANEL_STORAGE_KEY, JSON.stringify(this.persistedState));
    } catch {
      // 本地存储不可用时保留当前会话内状态。
    }
  }
}
