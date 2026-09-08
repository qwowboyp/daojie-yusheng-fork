/** 聊天標題快捷行動的獨立 React 掛載點。 */
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { QuickActions, type QuickActionsProps } from './QuickActions';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let stateKey = '';

function buildStateKey({ actions }: QuickActionsProps): string {
  return actions.map((action) => [
    action.id,
    action.name,
    action.desc,
    action.cooldownLeft,
    action.requiresTarget ? '1' : '0',
    action.targetMode ?? '',
    action.range ?? '',
  ].join('\u001f')).join('\u001e');
}

function render(props: QuickActionsProps): void {
  stateKey = buildStateKey(props);
  flushSync(() => {
    root?.render(
      <StrictMode>
        <QuickActions {...props} />
      </StrictMode>,
    );
  });
}

export function mountReactQuickActions(container: HTMLElement, props: QuickActionsProps): void {
  if (!host?.isConnected || host.parentElement !== container) {
    unmountReactQuickActions();
    host = document.createElement('div');
    host.className = 'react-panel-host react-panel-host--quick-actions';
    host.dataset.reactPanel = 'quick-actions';
    container.replaceChildren(host);
    root = createRoot(host);
    render(props);
    return;
  }
  syncReactQuickActions(props);
}

export function syncReactQuickActions(props: QuickActionsProps): boolean {
  if (!host?.isConnected || !root) {
    return false;
  }
  const nextKey = buildStateKey(props);
  if (stateKey === nextKey) {
    return false;
  }
  render(props);
  return true;
}

export function unmountReactQuickActions(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  stateKey = '';
}
