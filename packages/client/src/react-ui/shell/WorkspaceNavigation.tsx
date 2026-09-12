import { StrictMode, useEffect, useState, type KeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { requestMobileSurface, subscribeMobileSurface } from '../../ui/mobile-surface';
import { shouldUseMobileUi } from '../../ui/responsive-viewport';

export type WorkspaceId = 'character' | 'items' | 'cultivation' | 'action' | 'quests' | 'social' | 'market' | 'world' | 'system';
export type WorkspaceAction = 'alchemy' | 'forging' | 'enhancement' | 'transmission' | 'building' | 'settings' | 'tutorial' | 'guided-tour' | 'mail' | 'activity' | 'chronicle' | 'logout';

export interface WorkspaceDefinition {
  id: WorkspaceId;
  label: string;
  description: string;
  compact?: boolean;
  tabs: { id: string; label: string; paneId: string }[];
}

export const WORKSPACES: readonly WorkspaceDefinition[] = [
  { id: 'character', label: '人物', description: '概況・屬性', compact: true, tabs: [{ id: 'overview', label: '人物概況', paneId: 'pane-profile' }, { id: 'attr', label: '屬性', paneId: 'pane-attr' }] },
  { id: 'items', label: '背包與技藝', description: '物品・裝備・製作', tabs: [
    { id: 'inventory', label: '背包', paneId: 'pane-inventory' }, { id: 'equipment', label: '裝備', paneId: 'pane-equipment' },
    { id: 'alchemy', label: '煉丹', paneId: 'workspace-alchemy' }, { id: 'forging', label: '煉器', paneId: 'workspace-forging' },
    { id: 'enhancement', label: '強化', paneId: 'workspace-enhancement' }, { id: 'transmission', label: '傳功', paneId: 'workspace-transmission' },
    { id: 'building', label: '營造', paneId: 'workspace-building' },
  ] },
  { id: 'cultivation', label: '修行', description: '功法・煉體・技能', tabs: [{ id: 'technique', label: '功法', paneId: 'pane-technique' }, { id: 'body-training', label: '煉體', paneId: 'pane-body-training' }, { id: 'skill', label: '技能管理', paneId: 'workspace-skill' }] },
  { id: 'action', label: '行動與自動設定', description: '交互・行動・開關', compact: true, tabs: [{ id: 'dialogue', label: '附近交互', paneId: 'workspace-dialogue' }, { id: 'utility', label: '行動', paneId: 'workspace-utility' }, { id: 'toggle', label: '自動設定', paneId: 'workspace-toggle' }] },
  { id: 'quests', label: '任務與活動', description: '任務・限時活動', tabs: [{ id: 'quest', label: '任務', paneId: 'pane-quest' }] },
  { id: 'social', label: '社交', description: '道友・宗門・飛書', compact: true, tabs: [{ id: 'social', label: '道友', paneId: 'pane-social' }] },
  { id: 'market', label: '坊市', description: '交易・求購・拍賣', compact: true, tabs: [{ id: 'market', label: '坊市', paneId: 'pane-market' }] },
  { id: 'world', label: '世界', description: '地圖・天機閣・史書', tabs: [{ id: 'map-intel', label: '地圖情報', paneId: 'pane-map-intel' }, { id: 'tianji', label: '天機閣', paneId: 'pane-tianji' }] },
  { id: 'system', label: '系統與協助', description: '設定・百科・引導', compact: true, tabs: [{ id: 'system', label: '系統與協助', paneId: 'pane-system' }] },
];

export interface WorkspaceNavigationState {
  activeWorkspace: WorkspaceId | null;
  activeTab: string | null;
  chatOpen: boolean;
  workspaces: readonly WorkspaceDefinition[];
  onOpen: (id: WorkspaceId) => void;
  onPrepareOpen: (id: WorkspaceId) => void;
  onSelectTab: (tab: string) => void;
  onPrepareTab: (tab: string) => void;
  onClose: () => void;
  onToggleChat: () => void;
  onAction: (action: WorkspaceAction) => void;
}

export interface WorkspaceNavigationMount {
  update(state: WorkspaceNavigationState): void;
  closeMenu(): boolean;
  destroy(): void;
}

/** 導覽和業務內容各自只有一個根；更新導覽不會卸載面板。 */
export function mountWorkspaceNavigation(dock: HTMLElement, controls: HTMLElement, chatHeader: HTMLElement): WorkspaceNavigationMount {
  const dockRoot = createRoot(dock);
  const controlsRoot = createRoot(controls);
  const chatRoot = createRoot(chatHeader);
  const mapToolsHost = document.createElement('div');
  mapToolsHost.id = 'mobile-map-tools';
  dock.parentElement?.appendChild(mapToolsHost);
  const mapToolsRoot = createRoot(mapToolsHost);
  flushSync(() => mapToolsRoot.render(<MobileMapTools />));
  let closeMenu: () => boolean = () => false;
  return {
    update(state) {
      flushSync(() => {
        dockRoot.render(<StrictMode><WorkspaceDock state={state} registerCloseMenu={(handler) => { closeMenu = handler; }} /></StrictMode>);
        controlsRoot.render(<StrictMode><WorkspaceHeader state={state} /></StrictMode>);
        chatRoot.render(<StrictMode><span className="chat-header-title">聊天</span><div id="chat-quick-actions" /><button id="workspace-chat-toggle" className="chat-collapse-toggle" type="button"
          aria-controls="workspace-chat-content" aria-expanded={state.chatOpen} aria-label={state.chatOpen ? '收合聊天' : '展開聊天'}
          onClick={state.onToggleChat}><span className="chat-toggle-desktop">{state.chatOpen ? '−' : '＋'}</span><span className="chat-toggle-mobile"><NavigationIcon name="chat" />{state.chatOpen ? '收合聊天' : '聊天'}</span></button></StrictMode>);
      });
    },
    closeMenu: () => closeMenu(),
    destroy() { dockRoot.unmount(); controlsRoot.unmount(); chatRoot.unmount(); mapToolsRoot.unmount(); mapToolsHost.remove(); },
  };
}

function WorkspaceDock({ state, registerCloseMenu }: { state: WorkspaceNavigationState; registerCloseMenu: (handler: () => boolean) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => subscribeMobileSurface('menu', () => setMenuOpen(false)), []);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Element && !event.target.closest('#workspace-menu, #workspace-menu-toggle')) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss); };
  }, [menuOpen]);
  registerCloseMenu(() => {
    if (!menuOpen) return false;
    setMenuOpen(false);
    document.getElementById('workspace-menu-toggle')?.focus({ preventScroll: true });
    return true;
  });
  const open = (id: WorkspaceId) => { setMenuOpen(false); state.onOpen(id); };
  const isMobileActiveDock = (id: WorkspaceId) => shouldUseMobileUi(window) && state.activeWorkspace === id;
  const toggleDock = (id: WorkspaceId) => {
    if (isMobileActiveDock(id)) {
      state.onClose();
      return;
    }
    open(id);
  };
  return (
    <nav className="workspace-dock-nav" aria-label="遊戲功能">
      {([{ id: 'items', label: '背包' }, { id: 'cultivation', label: '修行' }, { id: 'action', label: '行動' }, { id: 'quests', label: '任務' }] as const).map((item) => (
        <button key={item.id} type="button" className="workspace-dock-button" data-workspace-open={item.id}
          aria-controls="game-workspace" aria-expanded={state.activeWorkspace === item.id}
          onPointerDown={(event) => { if (event.button === 0 && !isMobileActiveDock(item.id)) state.onPrepareOpen(item.id); }} onClick={() => toggleDock(item.id)}><NavigationIcon name={item.id} /><span>{item.label}</span></button>
      ))}
      <button id="workspace-menu-toggle" type="button" className="workspace-dock-button" aria-expanded={menuOpen}
        aria-controls="workspace-menu" onClick={() => { if (!menuOpen) requestMobileSurface('menu'); setMenuOpen(!menuOpen); }}><NavigationIcon name="menu" /><span>全部功能</span></button>
      <div id="workspace-menu" className="workspace-menu" hidden={!menuOpen}>
        {([
          { label: '人物與成長', ids: ['character', 'items', 'cultivation'] },
          { label: '江湖往來', ids: ['quests', 'social', 'market'] },
          { label: '探索與設定', ids: ['action', 'world', 'system'] },
        ] as const).map((group) => <section key={group.label} className="workspace-menu-group">
          <h3>{group.label}</h3>
          {group.ids.map((id) => <button key={id} type="button" data-workspace-open={id} aria-controls="game-workspace"
            aria-expanded={state.activeWorkspace === id} onPointerDown={(event) => { if (event.button === 0) state.onPrepareOpen(id); }}
            onClick={() => open(id)}><span>{state.workspaces.find((entry) => entry.id === id)?.label}</span><small>{state.workspaces.find((entry) => entry.id === id)?.description}</small></button>)}
        </section>)}
      </div>
    </nav>
  );
}

function NavigationIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    items: 'M7 8V6a5 5 0 0 1 10 0v2M5 8h14l1 13H4L5 8Zm4 5h6',
    cultivation: 'M12 3c-1 5-7 6-7 12a7 7 0 0 0 14 0c0-3-2-6-3-7 0 4-2 5-3 5 1-4 0-7-1-10Z',
    craft: 'm4 20 8-8m-5-7 3-3 12 12-3 3L7 5Zm-4 8 4 4',
    action: 'm13 3-9 11h7l-1 7 10-12h-7l1-6Z',
    quests: 'M6 3h12v18H6V3Zm3 5h6m-6 4h6m-6 4h4',
    menu: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
    chat: 'M4 4h16v12H9l-5 4V4Zm4 5h8m-8 3h5',
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
  };
  return <svg className="workspace-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function MobileMapTools() {
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeMobileSurface('map-tools', () => setOpen(false)), []);
  useEffect(() => {
    const shell = document.getElementById('game-shell');
    if (shell) shell.dataset.mapToolsOpen = String(open);
  }, [open]);
  return <button id="mobile-map-tools-toggle" type="button" aria-expanded={open} aria-controls="zoom-slider map-tick-rate map-minimap-shell"
    onClick={() => { if (!open) requestMobileSurface('map-tools'); setOpen(!open); }}><NavigationIcon name="map" /><span>{open ? '收起' : '地圖'}</span></button>;
}

function WorkspaceHeader({ state }: { state: WorkspaceNavigationState }) {
  const workspace = state.workspaces.find((entry) => entry.id === state.activeWorkspace);
  if (!workspace) return null;
  const groupId = workspace.id === 'world' ? 'center-intel' : workspace.id === 'character' ? 'left-lower'
    : workspace.id === 'action' ? 'right-bottom' : workspace.id === 'system' ? 'workspace-system' : 'right-top';
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % workspace.tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + workspace.tabs.length - 1) % workspace.tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = workspace.tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = workspace.tabs[next];
    state.onSelectTab(tab.id);
    document.getElementById(`workspace-tab-${tab.id}`)?.focus({ preventScroll: true });
  };
  return <div className="workspace-header">
    <div className="workspace-heading"><h2 id="workspace-title" className="workspace-title">{workspace.label}</h2>
      <div className="workspace-shortcuts">
        {workspace.id === 'items' && <button type="button" data-workspace-shortcut="market" onClick={() => state.onSelectTab('market')}>前往坊市 ↗</button>}
        {workspace.id === 'market' && <button type="button" data-workspace-shortcut="inventory" onClick={() => state.onSelectTab('inventory')}>返回背包</button>}
        {workspace.id === 'social' && <button type="button" onClick={() => state.onAction('mail')}>飛書</button>}
        {workspace.id === 'quests' && <button type="button" onClick={() => state.onAction('activity')}>活動</button>}
        {workspace.id === 'world' && <button type="button" onClick={() => state.onAction('chronicle')}>史書</button>}
      </div>
      <button type="button" className="workspace-close" onClick={state.onClose} aria-label="關閉工作區，返回地圖">返回地圖</button></div>
    <div className="workspace-tabs" role="tablist" data-tab-group={groupId} aria-label={`${workspace.label}分頁`}>
      {workspace.tabs.map((tab, index) => <button key={tab.id} type="button" id={`workspace-tab-${tab.id}`} data-tab={tab.id}
        className={`workspace-tab tab-btn${state.activeTab === tab.id ? ' active' : ''}`} role="tab" aria-selected={state.activeTab === tab.id}
        aria-controls={tab.paneId} tabIndex={state.activeTab === tab.id ? 0 : -1} onKeyDown={(event) => onTabKey(event, index)}
        onPointerDown={(event) => { if (event.button === 0) state.onPrepareTab(tab.id); }}
        onClick={() => state.onSelectTab(tab.id)}>{tab.label}</button>)}
    </div>
  </div>;
}

export function mountWorkspaceActions(container: HTMLElement, onAction: (action: WorkspaceAction) => void): Root {
  const root = createRoot(container);
  root.render(<div className="workspace-building-entry"><h3>營造與佈置</h3><p>選擇建築、查看材料，並在地圖上安排位置。</p><button type="button"
    data-workspace-action="building" onClick={() => onAction('building')}>開啟營造</button></div>);
  return root;
}
