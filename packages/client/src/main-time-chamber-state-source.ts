/** 密室使用面板与管理面板的低频投影、请求关联和意图编排。 */
import type {
  PlayerState,
  TimeChamberManagementDetailView,
  TimeChamberOperationKind,
  TimeChamberOperationResultView,
  TimeChamberPanelMode,
  TimeChamberSizeTier,
  TimeChamberUsageDetailView,
} from '@mud/shared';

import type { SocketBuildingSender } from './network/socket-send-building';
import type { ToastKind } from './main-app-assembly-types';
import { TimeChamberConsoleModal } from './ui/time-chamber-console-modal';
import { TimeChamberUsageModal } from './ui/time-chamber-usage-modal';

const DETAIL_REFRESH_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;

type MainTimeChamberStateSourceOptions = {
  usageModal: TimeChamberUsageModal;
  managementModal: TimeChamberConsoleModal;
  socket: SocketBuildingSender;
  getPlayer: () => PlayerState | null;
  showToast: (message: string, kind?: ToastKind) => void;
};

type AnyDetail = TimeChamberUsageDetailView | TimeChamberManagementDetailView;

type ActivePanelTarget = {
  mode: TimeChamberPanelMode;
  sourceInstanceId: string;
  buildingId: string;
};

const FAILURE_TEXT: Record<string, string> = {
  request_id_required: '密室請求已失效，請重新操作',
  invalid_time_chamber_panel_mode: '密室面板類型無效',
  time_chamber_not_found: '密室不存在或尚未建造完成',
  time_chamber_too_far: '需要靠近密室入口才能操作',
  time_chamber_owner_required: '只有建造者可以管理密室',
  time_chamber_persistence_disabled: '密室持久化服務暫不可用',
  time_chamber_state_create_failed: '密室獨立空間建立失敗，請稍後重試',
  time_chamber_state_not_found: '密室持久化狀態不存在，請重新打開面板',
  time_chamber_unavailable: '密室實例暫不可用，請稍後重試',
  insufficient_spirit_stone: '背包中的靈石不足',
  durable_inventory_unavailable: '資產持久化服務暫不可用',
  inventory_grant_lease_context_required: '當前位置寫入權暫不可用，請稍後重試',
  inventory_empty_snapshot_changed: '背包狀態已變化，請重新操作',
  inventory_empty_removal_snapshot_changed: '背包狀態已變化，請重新操作',
  invalid_time_chamber_duration: '使用時長超出允許範圍',
  invalid_time_chamber_speed: '時間倍率超出允許範圍',
  invalid_time_chamber_capacity: '最大人數超出當前空間上限',
  invalid_time_chamber_name: '名稱需為 1 至 20 個有效字符',
  invalid_time_chamber_password: '進入密碼需為 1 至 64 個有效字符',
  invalid_time_chamber_size: '該空間尺寸不可用',
  time_chamber_full: '密室使用名額已滿',
  time_chamber_activation_required: '密室當前尚未開啟',
  time_chamber_activation_not_required: '一倍速密室無需開啟時段，可直接進入',
  time_chamber_already_active: '密室已開啟，無法重複開啟或延長時間',
  time_chamber_expiry_pending: '密室到期清理中，請稍後再開啟',
  time_chamber_price_changed: '密室開啟成本已變化，請重新確認',
  time_chamber_instance_changed: '密室獨立空間已變化，請重新打開面板',
  time_chamber_usage_time_limit: '開啟時段超出系統時間範圍',
  time_chamber_settings_locked: '密室運行期間不能修改倍率、容量或空間',
  time_chamber_capacity_exceeds_size: '請先降低最大人數再縮小空間',
  time_chamber_occupied: '密室有人時不能調整空間',
  time_chamber_not_empty: '密室內部存在對象，暫時不能調整空間',
  time_chamber_has_buildings: '密室內已有建築，不能再調整空間大小',
  time_chamber_revision_conflict: '密室狀態已變化，請重新操作',
  time_chamber_password_required: '請輸入密室進入密碼',
  time_chamber_password_incorrect: '密室進入密碼錯誤',
  time_chamber_password_rate_limited: '密碼嘗試過於頻繁，請稍後再試',
  time_chamber_operation_failed: '密室操作暫未完成，請稍後重試',
  time_chamber_activation_failed: '密室開啟失敗，請稍後重試',
};

export function createMainTimeChamberStateSource(options: MainTimeChamberStateSourceOptions) {
  let activeMode: TimeChamberPanelMode | null = null;
  let usageDetail: TimeChamberUsageDetailView | null = null;
  let managementDetail: TimeChamberManagementDetailView | null = null;
  let activePanelTarget: ActivePanelTarget | null = null;
  let activeDetailRequest: { requestId: string; mode: TimeChamberPanelMode } | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let detailRequestTimeout: ReturnType<typeof setTimeout> | null = null;
  const pendingRequestIdByOperation = new Map<Exclude<TimeChamberOperationKind, 'usage_detail' | 'management_detail'>, string>();
  const mutationTimeoutByOperation = new Map<Exclude<TimeChamberOperationKind, 'usage_detail' | 'management_detail'>, ReturnType<typeof setTimeout>>();

  const currentDetail = (): AnyDetail | null => activeMode === 'usage' ? usageDetail : managementDetail;
  const isActiveModalOpen = (): boolean => activeMode === 'usage'
    ? options.usageModal.isOpen()
    : activeMode === 'management' && options.managementModal.isOpen();

  const clearDetailRequest = (): void => {
    activeDetailRequest = null;
    if (detailRequestTimeout !== null) clearTimeout(detailRequestTimeout);
    detailRequestTimeout = null;
  };

  const stopAutoRefresh = (): void => {
    if (refreshTimer !== null) clearInterval(refreshTimer);
    refreshTimer = null;
  };

  const requestDetail = (mode: TimeChamberPanelMode, sourceInstanceId: string, buildingId: string): void => {
    clearDetailRequest();
    const requestId = buildRequestId(`${mode}-detail`);
    activeDetailRequest = { requestId, mode };
    options.socket.sendRequestTimeChamber({ sourceInstanceId, buildingId, requestId, mode });
    detailRequestTimeout = setTimeout(() => {
      if (activeDetailRequest?.requestId !== requestId) return;
      clearDetailRequest();
      if (!currentDetail() && isActiveModalOpen()) {
        stopAutoRefresh();
        clearModal(mode);
        options.showToast('讀取密室狀態超時，請重新打開', 'warn');
      }
    }, REQUEST_TIMEOUT_MS);
  };

  const startAutoRefresh = (): void => {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      const detail = currentDetail();
      if (!isActiveModalOpen()) {
        stopAutoRefresh();
        return;
      }
      if (activeMode && detail && !activeDetailRequest && pendingRequestIdByOperation.size === 0) {
        requestDetail(activeMode, detail.sourceInstanceId, detail.buildingId);
      }
    }, DETAIL_REFRESH_INTERVAL_MS);
  };

  const clearMutationRequests = (): void => {
    pendingRequestIdByOperation.clear();
    for (const timeout of mutationTimeoutByOperation.values()) clearTimeout(timeout);
    mutationTimeoutByOperation.clear();
  };

  const clearModal = (mode: TimeChamberPanelMode): void => {
    if (mode === 'usage') options.usageModal.clear();
    else options.managementModal.clear();
    if (activeMode === mode) {
      activeMode = null;
      activePanelTarget = null;
    }
  };

  const setPending = (operation: TimeChamberOperationKind, pending: boolean): void => {
    if (activeMode === 'usage') options.usageModal.setPending(pending);
    else if (activeMode === 'management') options.managementModal.setPending(operation, pending);
  };

  const sendOperation = <TDetail extends AnyDetail>(
    mode: TimeChamberPanelMode,
    operation: Exclude<TimeChamberOperationKind, 'usage_detail' | 'management_detail'>,
    send: (detail: TDetail, requestId: string) => void,
  ): void => {
    const detail = (mode === 'usage' ? usageDetail : managementDetail) as TDetail | null;
    if (!detail || activeMode !== mode) {
      options.showToast('密室狀態尚未加載', 'warn');
      return;
    }
    if (pendingRequestIdByOperation.size > 0) {
      options.showToast('上一項密室操作仍在處理中', 'warn');
      return;
    }
    clearDetailRequest();
    const requestId = buildRequestId(operation);
    pendingRequestIdByOperation.set(operation, requestId);
    setPending(operation, true);
    mutationTimeoutByOperation.set(operation, setTimeout(() => {
      if (pendingRequestIdByOperation.get(operation) !== requestId) return;
      pendingRequestIdByOperation.delete(operation);
      mutationTimeoutByOperation.delete(operation);
      setPending(operation, false);
      options.showToast('密室操作響應超時，請確認狀態後重試', 'warn');
      const latest = currentDetail();
      if (activeMode && latest && isActiveModalOpen()) requestDetail(activeMode, latest.sourceInstanceId, latest.buildingId);
    }, REQUEST_TIMEOUT_MS));
    send(detail, requestId);
  };

  const closePanel = (mode: TimeChamberPanelMode): void => {
    if (activeMode !== mode) return;
    activeMode = null;
    activePanelTarget = null;
    usageDetail = null;
    managementDetail = null;
    clearDetailRequest();
    clearMutationRequests();
    stopAutoRefresh();
  };

  options.usageModal.setCallbacks({
    onClose: () => closePanel('usage'),
    onActivate: (durationHours, accessPassword) => sendOperation<TimeChamberUsageDetailView>('usage', 'activate', (detail, requestId) => {
      options.socket.sendActivateTimeChamber({
        sourceInstanceId: detail.sourceInstanceId,
        buildingId: detail.buildingId,
        requestId,
        durationHours,
        expectedRevision: detail.revision,
        ...(accessPassword ? { accessPassword } : {}),
      });
    }),
    onEnter: (accessPassword) => sendOperation<TimeChamberUsageDetailView>('usage', 'enter', (detail, requestId) => {
      options.socket.sendEnterTimeChamber({
        sourceInstanceId: detail.sourceInstanceId,
        buildingId: detail.buildingId,
        requestId,
        ...(accessPassword ? { accessPassword } : {}),
      });
    }),
  });

  options.managementModal.setCallbacks({
    onClose: () => closePanel('management'),
    onSaveSettings: (settings) => sendOperation<TimeChamberManagementDetailView>('management', 'settings', (detail, requestId) => {
      options.socket.sendUpdateTimeChamberSettings({
        sourceInstanceId: detail.sourceInstanceId,
        buildingId: detail.buildingId,
        requestId,
        expectedRevision: detail.revision,
        ...settings,
      });
    }),
    onResize: (sizeTier: TimeChamberSizeTier) => sendOperation<TimeChamberManagementDetailView>('management', 'resize', (detail, requestId) => {
      options.socket.sendResizeTimeChamber({
        sourceInstanceId: detail.sourceInstanceId,
        buildingId: detail.buildingId,
        requestId,
        sizeTier,
        expectedRevision: detail.revision,
      });
    }),
  });

  const open = (mode: TimeChamberPanelMode, buildingId: string): void => {
    const player = options.getPlayer();
    const normalizedBuildingId = buildingId.trim();
    if (!player?.instanceId || !normalizedBuildingId) {
      options.showToast('當前無法定位密室入口', 'warn');
      return;
    }
    if (
      activePanelTarget?.mode === mode
      && activePanelTarget.sourceInstanceId === player.instanceId
      && activePanelTarget.buildingId === normalizedBuildingId
      && isActiveModalOpen()
    ) {
      return;
    }
    usageDetail = null;
    managementDetail = null;
    activeMode = mode;
    activePanelTarget = { mode, sourceInstanceId: player.instanceId, buildingId: normalizedBuildingId };
    clearDetailRequest();
    clearMutationRequests();
    if (mode === 'usage') options.usageModal.openPending();
    else options.managementModal.openPending();
    requestDetail(mode, player.instanceId, normalizedBuildingId);
    startAutoRefresh();
  };

  return {
    openUsage(buildingId: string): void {
      open('usage', buildingId);
    },

    openManagement(buildingId: string): void {
      open('management', buildingId);
    },

    handleOperationResult(result: TimeChamberOperationResultView): void {
      const requestId = typeof result.requestId === 'string' ? result.requestId.trim() : '';
      const isDetailOperation = result.operation === 'usage_detail' || result.operation === 'management_detail';
      if (isDetailOperation) {
        const expectedMode = result.operation === 'usage_detail' ? 'usage' : 'management';
        if (!requestId || activeDetailRequest?.requestId !== requestId || activeDetailRequest.mode !== expectedMode) return;
        clearDetailRequest();
      } else {
        const mutationOperation = result.operation as Exclude<TimeChamberOperationKind, 'usage_detail' | 'management_detail'>;
        const expectedRequestId = pendingRequestIdByOperation.get(mutationOperation);
        if (!requestId || requestId !== expectedRequestId) return;
        pendingRequestIdByOperation.delete(mutationOperation);
        const timeout = mutationTimeoutByOperation.get(mutationOperation);
        if (timeout !== undefined) clearTimeout(timeout);
        mutationTimeoutByOperation.delete(mutationOperation);
        setPending(mutationOperation, false);
      }

      if (result.usageDetail) {
        usageDetail = result.usageDetail;
        if (activeMode === 'usage' && options.usageModal.isOpen()) options.usageModal.showDetail(result.usageDetail);
      }
      if (result.managementDetail) {
        managementDetail = result.managementDetail;
        const acceptedOperation = result.ok && (result.operation === 'settings' || result.operation === 'resize')
          ? result.operation
          : null;
        if (activeMode === 'management' && options.managementModal.isOpen()) {
          options.managementModal.showDetail(result.managementDetail, acceptedOperation);
        }
      }
      if (!result.ok) {
        const failureText = FAILURE_TEXT[result.reason ?? ''] ?? '密室操作失敗，請稍後重試';
        const passwordFailure = result.reason === 'time_chamber_password_required'
          || result.reason === 'time_chamber_password_incorrect'
          || result.reason === 'time_chamber_password_rate_limited';
        const passwordOperation = result.operation === 'activate' || result.operation === 'enter'
          ? result.operation
          : undefined;
        if (!passwordFailure || !options.usageModal.showPasswordError(failureText, passwordOperation)) {
          options.showToast(failureText, 'warn');
        }
        if (isDetailOperation) {
          const failedMode = result.operation === 'usage_detail' ? 'usage' : 'management';
          clearModal(failedMode);
          stopAutoRefresh();
        } else if (result.reason === 'time_chamber_revision_conflict') {
          const detail = currentDetail();
          if (activeMode && detail) requestDetail(activeMode, detail.sourceInstanceId, detail.buildingId);
        }
        return;
      }
      if (result.operation === 'activate' || result.operation === 'enter') {
        if (result.entryQueued) {
          options.showToast(result.operation === 'activate' ? '密室已開啟，正在進入' : '正在進入密室', 'success');
          clearModal('usage');
          stopAutoRefresh();
        } else {
          options.showToast('密室已開啟，可從當前面板進入', 'success');
        }
        return;
      }
      if (!isDetailOperation) options.showToast(operationSuccessText(result.operation), 'success');
    },

    clear(): void {
      activeMode = null;
      activePanelTarget = null;
      usageDetail = null;
      managementDetail = null;
      clearDetailRequest();
      clearMutationRequests();
      stopAutoRefresh();
      options.usageModal.clear();
      options.managementModal.clear();
    },
  };
}

export type MainTimeChamberStateSource = ReturnType<typeof createMainTimeChamberStateSource>;

function buildRequestId(operation: string): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return `time-chamber:${operation}:${random}`;
}

function operationSuccessText(operation: TimeChamberOperationKind): string {
  if (operation === 'settings') return '密室配置已保存';
  if (operation === 'resize') return '密室空間已調整';
  if (operation === 'enter') return '正在進入密室';
  return '密室狀態已更新';
}
