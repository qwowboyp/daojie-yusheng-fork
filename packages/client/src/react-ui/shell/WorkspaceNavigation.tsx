import { StrictMode, useState, type KeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

export type WorkspaceId = 'character' | 'items' | 'cultivation' | 'craft' | 'quests' | 'social' | 'market' | 'world' | 'system';
export type WorkspaceAction = 'alchemy' | 'forging' | 'enhancement' | 'transmission' | 'building' | 'settings' | 'tutorial' | 'guided-tour' | 'mail' | 'activity' | 'chronicle' | 'logout';

export interface WorkspaceDefinition {
  id: WorkspaceId;
  label: string;
  tabs: { id: string; label: string; paneId: string }[];
}

export const WORKSPACES: readonly WorkspaceDefinition[] = [
  { id: 'character', label: '人物', tabs: [{ id: 'overview', label: '人物概況', paneId: 'pane-profile' }, { id: 'attr', label: '屬性', paneId: 'pane-attr' }] },
  { id: 'items', label: '物品與裝備', tabs: [{ id: 'inventory', label: '背包', paneId: 'pane-inventory' }, { id: 'equipment', label: '裝備', paneId: 'pane-equipment' }] },
  { id: 'cultivation', label: '修行', tabs: [{ id: 'technique', label: '功法', paneId: 'pane-technique' }, { id: 'body-training', label: '煉體', paneId: 'pane-body-training' }] },
  { id: 'craft', label: '技藝與行動', tabs: [{ id: 'crafting', label: '技藝', paneId: 'workspace-craft-launcher' }, { id: 'action', label: '行動', paneId: 'pane-action' }] },
  { id: 'quests', label: '任務日誌', tabs: [{ id: 'quest', label: '任務', paneId: 'pane-quest' }] },
  { id: 'social', label: '社交', tabs: [{ id: 'social', label: '道友', paneId: 'pane-social' }] },
  { id: 'market', label: '坊市', tabs: [{ id: 'market', label: '坊市', paneId: 'pane-market' }] },
  { id: 'world', label: '世界', tabs: [{ id: 'map-intel', label: '地圖情報', paneId: 'pane-map-intel' }, { id: 'tianji', label: '天機閣', paneId: 'pane-tianji' }] },
  { id: 'system', label: '系統與協助', tabs: [{ id: 'system', label: '系統與協助', paneId: 'pane-system' }] },
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
  let closeMenu: () => boolean = () => false;
  return {
    update(state) {
      flushSync(() => {
        dockRoot.render(<StrictMode><WorkspaceDock state={state} registerCloseMenu={(handler) => { closeMenu = handler; }} /></StrictMode>);
        controlsRoot.render(<StrictMode><WorkspaceHeader state={state} /></StrictMode>);
        chatRoot.render(<StrictMode><span className="chat-header-title">聊天</span><div id="chat-quick-actions" /><button id="workspace-chat-toggle" className="chat-collapse-toggle" type="button"
          aria-controls="workspace-chat-content" aria-expanded={state.chatOpen} aria-label={state.chatOpen ? '收合聊天' : '展開聊天'}
          onClick={state.onToggleChat}>{state.chatOpen ? '−' : '＋'}</button></StrictMode>);
      });
    },
    closeMenu: () => closeMenu(),
    destroy() { dockRoot.unmount(); controlsRoot.unmount(); chatRoot.unmount(); },
  };
}

function WorkspaceDock({ state, registerCloseMenu }: { state: WorkspaceNavigationState; registerCloseMenu: (handler: () => boolean) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  registerCloseMenu(() => {
    if (!menuOpen) return false;
    setMenuOpen(false);
    document.getElementById('workspace-menu-toggle')?.focus({ preventScroll: true });
    return true;
  });
  const open = (id: WorkspaceId) => { setMenuOpen(false); state.onOpen(id); };
  return (
    <nav className="workspace-dock-nav" aria-label="遊戲功能">
      {([{ id: 'items', label: '背包' }, { id: 'cultivation', label: '修行' }, { id: 'craft', label: '技藝' }, { id: 'quests', label: '任務' }] as const).map((item) => (
        <button key={item.id} type="button" className="workspace-dock-button" data-workspace-open={item.id}
          aria-controls="game-workspace" aria-expanded={state.activeWorkspace === item.id}
          onPointerDown={(event) => { if (event.button === 0) state.onPrepareOpen(item.id); }} onClick={() => open(item.id)}>{item.label}</button>
      ))}
      <button id="workspace-menu-toggle" type="button" className="workspace-dock-button" aria-expanded={menuOpen}
        aria-controls="workspace-menu" onClick={() => setMenuOpen(!menuOpen)}>全部功能</button>
      <div id="workspace-menu" className="workspace-menu" hidden={!menuOpen}>
        {([
          { label: '人物與成長', ids: ['character', 'items', 'cultivation', 'craft'] },
          { label: '江湖往來', ids: ['quests', 'social', 'market'] },
          { label: '世界與系統', ids: ['world', 'system'] },
        ] as const).map((group) => <section key={group.label} className="workspace-menu-group">
          <h3>{group.label}</h3>
          {group.ids.map((id) => <button key={id} type="button" data-workspace-open={id} aria-controls="game-workspace"
            aria-expanded={state.activeWorkspace === id} onPointerDown={(event) => { if (event.button === 0) state.onPrepareOpen(id); }}
            onClick={() => open(id)}>{state.workspaces.find((entry) => entry.id === id)?.label}</button>)}
        </section>)}
      </div>
    </nav>
  );
}

function WorkspaceHeader({ state }: { state: WorkspaceNavigationState }) {
  const workspace = state.workspaces.find((entry) => entry.id === state.activeWorkspace);
  if (!workspace) return null;
  const groupId = workspace.id === 'world' ? 'center-intel' : workspace.id === 'character' ? 'left-lower'
    : workspace.id === 'craft' ? 'right-bottom' : workspace.id === 'system' ? 'workspace-system' : 'right-top';
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
  const actions: { id: WorkspaceAction; label: string }[] = [{ id: 'alchemy', label: '煉丹' }, { id: 'forging', label: '煉器' }, { id: 'enhancement', label: '強化' }, { id: 'transmission', label: '傳功' }, { id: 'building', label: '營造' }];
  root.render(<div className="workspace-action-grid">{actions.map((action) => <button key={action.id} type="button"
    data-workspace-action={action.id} onClick={() => onAction(action.id)}>{action.label}</button>)}</div>);
  return root;
}
