import { createRoot, type Root } from 'react-dom/client';
import type { S2C_ShenxingDestinations, S2C_ShenxingResult } from '@mud/shared';
import { isReactPanelEnabled } from '../../bridge/panel-flags';
import { ShenxingTravelPanel, type ShenxingTravelView } from './ShenxingTravelPanel';
import './shenxing-travel.css';

type TravelRequest = { requestId: string; targetMapId?: string };
const RESULT_MESSAGES: Record<S2C_ShenxingResult['code'], string> = {
  travel_succeeded: '已抵達目的地。',
  request_invalid: '請求已失效，請重新載入目的地。',
  item_missing: '背包中已沒有這枚神行丹。',
  item_changed: '丹藥狀態已改變，請從背包重新選擇。',
  realm_too_low: '境界不足，尚不能使用這個品階的神行丹。',
  cooldown_active: '神行丹仍在共用冷卻中，請稍後再試。',
  destination_invalid: '目的地不存在，請重新載入。',
  destination_forbidden: '此地圖不在這枚神行丹可前往的範圍內。',
  destination_unavailable: '目的地暫時無法進入，請稍後再試。',
  placement_unavailable: '目的地暫無可落腳的位置，請稍後再試。',
  asset_commit_unavailable: '丹藥結算暫時無法使用，請稍後再試。',
  asset_commit_failed: '丹藥結算未完成，請重新載入後再試。',
  transfer_failed: '傳送未完成，請重新載入後再試。',
};
let root: Root | null = null;
let dialog: HTMLDialogElement | null = null;
let opener: HTMLElement | null = null;
let session: { requestId: string; itemInstanceId: string; send(options: TravelRequest): void; view: ShenxingTravelView } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function stopTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function render(): void {
  const active = session;
  root?.render(active ? <ShenxingTravelPanel key={active.requestId} view={active.view}
    onClose={closeShenxingTravelPanel} onReload={reload} onConfirm={confirm} /> : null);
}

function waitForResponse(): void {
  stopTimer();
  const requestId = session?.requestId;
  timer = setTimeout(() => {
    if (!session || session.requestId !== requestId) return;
    session.view = { ...session.view, pending: null, error: session.view.confirmedMapId
      ? '傳送結果尚未確認。可重試確認同一筆請求，請勿重複服藥。'
      : '讀取逾時，請重新載入地圖。' };
    render();
  }, 20_000);
}

function reload(): void {
  if (!session || session.view.pending || session.view.confirmedMapId) return;
  session.requestId = crypto.randomUUID();
  session.view = { ...session.view, data: null, pending: 'loading', error: '' };
  render();
  waitForResponse();
  session.send({ requestId: session.requestId });
}

function confirm(mapId: string): void {
  if (!session || session.view.pending || !session.view.data?.destinations.some((map) => map.mapId === mapId)) return;
  const targetMapId = session.view.confirmedMapId ?? mapId;
  session.view = { ...session.view, confirmedMapId: targetMapId, pending: 'confirming', error: '' };
  render();
  waitForResponse();
  session.send({ requestId: session.requestId, targetMapId });
}

export function closeShenxingTravelPanel(): void {
  stopTimer();
  session = null;
  dialog?.close();
  render();
  const target = opener;
  opener = null;
  requestAnimationFrame(() => { if (!session && target?.isConnected) target.focus({ preventScroll: true }); });
}

export function openShenxingTravelPanel(itemInstanceId: string, itemName: string, send: (options: TravelRequest) => void): void {
  if (!isReactPanelEnabled('shenxing-travel')) return;
  if (!dialog?.isConnected) {
    dialog = document.createElement('dialog');
    dialog.className = 'shenxing-dialog';
    dialog.setAttribute('aria-label', '神行丹目的地');
    const host = document.createElement('div');
    dialog.append(host);
    document.body.append(dialog);
    root = createRoot(host);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); event.stopPropagation(); closeShenxingTravelPanel(); });
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    dialog.addEventListener('keyup', (event) => event.stopPropagation());
    dialog.addEventListener('close', () => { if (session && !dialog?.open) closeShenxingTravelPanel(); });
  }
  stopTimer();
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  session = { requestId: crypto.randomUUID(), itemInstanceId, send,
    view: { itemName, data: null, pending: 'loading', error: '', confirmedMapId: null } };
  render();
  if (!dialog.open) dialog.showModal();
  waitForResponse();
  send({ requestId: session.requestId });
}

export function receiveShenxingDestinations(data: S2C_ShenxingDestinations): void {
  if (!session || session.requestId !== data.requestId || session.itemInstanceId !== data.itemInstanceId || session.view.confirmedMapId) return;
  stopTimer();
  session.view = { ...session.view, data, pending: null, error: '' };
  render();
}

export function receiveShenxingResult(data: S2C_ShenxingResult): void {
  if (!session || session.requestId !== data.requestId) return;
  stopTimer();
  if (data.status === 'success') { closeShenxingTravelPanel(); return; }
  session.view = { ...session.view, pending: null, confirmedMapId: null,
    error: RESULT_MESSAGES[data.code] ?? '目前無法傳送，請重新載入目的地後再試。' };
  // 被拒絕的 operation 不改成另一個目標重送；重新載入建立新的請求。
  session.view.data = null;
  render();
}
