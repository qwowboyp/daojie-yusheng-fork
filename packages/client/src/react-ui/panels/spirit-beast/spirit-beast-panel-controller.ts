import { C2S, S2C, type SpiritBeastCommandResultView, type SpiritBeastCommandView, type SpiritBeastPanelView } from '@mud/shared';
import type { SocketManager } from '../../../network/socket';
import { formatSpiritBeastReason } from './spirit-beast-display';
import { setSpiritBeastCallbacks, spiritBeastStore, type SpiritBeastCallbacks } from './spirit-beast-panel-model';

function successMessage(action: SpiritBeastCommandView['action'] | undefined, result: SpiritBeastCommandResultView): string {
  if (action === 'enhance_egg') return result.promoted ? '靈蛋強化成功，主蛋已升至下一星。' : '靈蛋強化未成功，主蛋已保留，十份素材已消耗。';
  if (action === 'cultivate') return result.promoted ? '靈獸培養成功，主獸已升至下一星。' : '靈獸培養未成功，主獸已保留，十隻素材已消耗。';
  const messages: Partial<Record<SpiritBeastCommandView['action'], string>> = {
    summon: '靈獸已召喚至宗門。',
    recall: '已送出收回靈獸的指示。',
    protect: '收藏保護已更新。',
    incubate: '靈蛋已開始孵化。',
    cancel_incubation: '孵化已取消。',
    adopt: '靈獸已收養並收入宗門倉庫。',
    preview_fusion: '融合結果已更新。',
    fuse: '融合完成，新靈獸已收入宗門倉庫。',
    set_mine_enabled: '礦場設定已更新。',
    set_crop_plan: '種植計畫已儲存。',
    cancel_crop: '本輪種植已取消。',
    deposit: '物資已放入設備。',
    withdraw: '產物已領取。',
    queue_craft: '工作已加入排程。',
    cancel_order: '工作排程已取消。',
    manual_work: '已開始親自工作。',
    cancel_manual_work: '已停止親自工作。',
    buy_seed: '種子已購買並收入背包。',
  };
  return (action && messages[action]) || '操作完成。';
}

/** 將低頻管理快照接進 React store；pending 只由對應 requestId 的結果移除。 */
export function createSpiritBeastPanelController(socket: Pick<SocketManager, 'emitEvent' | 'on'>): void {
  const pendingActions = new Map<string, SpiritBeastCommandView['action']>();
  const request = (): void => {
    spiritBeastStore.patchState({ loading: true, error: null });
    socket.emitEvent(C2S.RequestSpiritBeastPanel, {});
  };
  socket.on(S2C.SpiritBeastPanel, (incoming: SpiritBeastPanelView) => {
    const current = spiritBeastStore.getState();
    const sameRevision = current.view?.revision === incoming.revision;
    const fusionPreview = incoming.fusionPreview ?? (sameRevision ? current.view?.fusionPreview : undefined);
    spiritBeastStore.patchState({
      view: fusionPreview ? { ...incoming, fusionPreview } : incoming,
      loading: false,
      error: null,
      ...(!sameRevision ? { fusionPreviewReceipt: null } : {}),
    });
  });
  socket.on(S2C.SpiritBeastCommandResult, (result: SpiritBeastCommandResultView) => {
    const current = spiritBeastStore.getState();
    if (!current.pending.includes(result.requestId)) return;
    const action = pendingActions.get(result.requestId);
    pendingActions.delete(result.requestId);
    const pending = current.pending.filter((id) => id !== result.requestId);
    if (!result.ok) {
      spiritBeastStore.patchState({ pending, result: null, error: formatSpiritBeastReason(result.reasonKey) });
      return;
    }
    if (action === 'preview_fusion' && result.fusionPreview && current.view && result.revision >= current.view.revision) {
      spiritBeastStore.patchState({
        pending,
        view: { ...current.view, revision: result.revision, fusionPreview: result.fusionPreview },
        fusionPreviewReceipt: { requestId: result.requestId, revision: result.revision },
        result: successMessage(action, result),
        error: null,
      });
      return;
    }
    spiritBeastStore.patchState({ pending, result: successMessage(action, result), error: null });
    request();
  });
  const callbacks: SpiritBeastCallbacks = {
    onRequest: request,
    onCommand: (command) => {
      const current = spiritBeastStore.getState();
      if (current.pending.includes(command.requestId)) return;
      pendingActions.set(command.requestId, command.action);
      spiritBeastStore.patchState({
        pending: [...current.pending, command.requestId],
        error: null,
        result: null,
        ...(command.action === 'preview_fusion' ? { fusionPreviewReceipt: null } : {}),
      });
      socket.emitEvent(C2S.SpiritBeastCommand, command);
    },
  };
  setSpiritBeastCallbacks(callbacks);
}
