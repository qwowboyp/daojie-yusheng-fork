/**
 * 本文件負責客戶端側的配置、視圖、網路或運行態輔助邏輯，服務於正式前端主線的展示與意圖收集。
 *
 * 維護時要保持前端只處理表現和派生狀態，避免複製服務端權威真源或讓多套 UI 狀態互相分叉。
 */
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  S2C,
  SECT_DIRECTORY_PAGE_DEFAULT_LIMIT,
  type SectDirectoryView,
} from '@mud/shared';
import { detailModalHost } from '../../../ui/detail-modal-host';
import { isReactPanelEnabled } from '../../bridge/panel-flags';
import {
  SectDirectoryPanel,
  sectDirectoryStore,
  setSectDirectoryCallbacks,
  type SectDirectoryPanelCallbacks,
  type SectDirectoryPanelState,
} from './SectDirectoryPanel';
import type { SocketManager } from '../../../network/socket';
import type { SocketPanelSender } from '../../../network/socket-send-panel';
import type { SocketRuntimeSender } from '../../../network/socket-send-runtime';

const MODAL_OWNER = 'sect-directory-panel';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let lastSentRequestId: string | null = null;

function generateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function shouldUseReactSectDirectoryPanel(): boolean {
  return isReactPanelEnabled('sect-directory');
}

export function syncReactSectDirectoryState(input: Partial<SectDirectoryPanelState>): void {
  sectDirectoryStore.patchState(input);
}

export function setReactSectDirectoryCallbacks(callbacks: Partial<SectDirectoryPanelCallbacks>): void {
  setSectDirectoryCallbacks(callbacks);
}

export function mountReactSectDirectoryPanel(body: HTMLElement, signal?: AbortSignal): void {
  unmountReactSectDirectoryPanel();
  host = document.createElement('div');
  host.className = 'react-panel-host react-panel-host--sect-directory';
  host.dataset.reactPanel = 'sect-directory';
  body.replaceChildren(host);
  root = createRoot(host);
  root.render(
    <StrictMode>
      <SectDirectoryPanel />
    </StrictMode>,
  );
  signal?.addEventListener('abort', unmountReactSectDirectoryPanel, { once: true });
}

export function unmountReactSectDirectoryPanel(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}

export function openSectDirectoryPanelModal(): void {
  detailModalHost.open({
    ownerId: MODAL_OWNER,
    variantClass: 'detail-modal--sect-directory',
    title: '宗門總覽',
    subtitle: '瀏覽全服宗門名錄與遠端遞交拜帖',
    hint: '點擊空白處或按 Esc 關閉',
    size: 'lg',
    renderBody: (body) => body.replaceChildren(),
    onAfterRender: (body, signal) => mountReactSectDirectoryPanel(body, signal),
    onClose: unmountReactSectDirectoryPanel,
  });
}

export function closeSectDirectoryPanelModal(): void {
  if (detailModalHost.isOpenFor(MODAL_OWNER)) {
    detailModalHost.close(MODAL_OWNER);
  }
  unmountReactSectDirectoryPanel();
}

export type SectDirectoryPanelController = {
  open(opener?: HTMLElement | null): void;
  close(): void;
};

export interface CreateSectDirectoryPanelControllerOptions {
  socket: Pick<SocketManager, 'on'>;
  panelSender: Pick<SocketPanelSender, 'sendRequestSectDirectory'>;
  runtimeSender: Pick<SocketRuntimeSender, 'sendAction'>;
}

export function createSectDirectoryPanelController(
  deps: CreateSectDirectoryPanelControllerOptions,
): SectDirectoryPanelController {
  const { socket, panelSender, runtimeSender } = deps;

  const requestPage = (search: string, offset: number, limit: number): void => {
    const requestId = generateRequestId();
    lastSentRequestId = requestId;
    sectDirectoryStore.patchState({
      loading: true,
      error: null,
      search,
      offset,
      limit,
    });
    panelSender.sendRequestSectDirectory({
      requestId,
      search: search.trim() || undefined,
      offset,
      limit,
    });
  };

  // 監聽服務端 S2C.SectDirectory 回應
  socket.on(S2C.SectDirectory, (data: SectDirectoryView) => {
    // 遲到或非本請求的回應直接丟棄
    if (lastSentRequestId && data.requestId !== lastSentRequestId) {
      return;
    }
    sectDirectoryStore.patchState({
      items: data.items,
      total: data.total,
      offset: data.offset,
      limit: data.limit,
      search: data.search,
      revision: data.revision,
      loading: false,
      error: null,
    });
  });

  setSectDirectoryCallbacks({
    onRequestPage: (search, offset, limit) => {
      requestPage(search, offset, limit);
    },
    onApplyRemote: (sectId: string) => {
      const currentApplying = sectDirectoryStore.getState().applyingSectIds;
      if (currentApplying.includes(sectId)) {
        return;
      }
      sectDirectoryStore.patchState({
        applyingSectIds: [...currentApplying, sectId],
      });

      // 依協議編碼發送 action
      runtimeSender.sendAction(`sect:apply-remote:${encodeURIComponent(sectId)}`);

      // 遞交後 1.5s 延遲重拉當前頁刷新 relation 徽章並解除按鈕 loading 狀態
      setTimeout(() => {
        const state = sectDirectoryStore.getState();
        sectDirectoryStore.patchState({
          applyingSectIds: state.applyingSectIds.filter((id) => id !== sectId),
        });
        requestPage(state.search, state.offset, state.limit);
      }, 1500);
    },
    onClose: () => {
      closeSectDirectoryPanelModal();
    },
  });

  return {
    open(_opener: HTMLElement | null = null): void {
      openSectDirectoryPanelModal();
      const state = sectDirectoryStore.getState();
      requestPage(state.search, 0, state.limit || SECT_DIRECTORY_PAGE_DEFAULT_LIMIT);
    },
    close(): void {
      closeSectDirectoryPanelModal();
    },
  };
}
