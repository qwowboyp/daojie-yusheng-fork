import type { SpiritBeastCommandView, SpiritBeastPanelView } from '@mud/shared';
import { createPanelStore } from '../../stores/create-panel-store';

export interface SpiritBeastPanelState {
  view: SpiritBeastPanelView | null;
  loading: boolean;
  pending: string[];
  error: string | null;
  result: string | null;
  fusionPreviewReceipt: { requestId: string; revision: number } | null;
}

export const { store: spiritBeastStore, useStore: useSpiritBeastStore } = createPanelStore<SpiritBeastPanelState>({
  view: null,
  loading: false,
  pending: [],
  error: null,
  result: null,
  fusionPreviewReceipt: null,
});

export interface SpiritBeastCallbacks {
  onRequest: (() => void) | null;
  onCommand: ((command: SpiritBeastCommandView) => void) | null;
}

const callbacks: SpiritBeastCallbacks = { onRequest: null, onCommand: null };

export function setSpiritBeastCallbacks(next: Partial<SpiritBeastCallbacks>): void {
  Object.assign(callbacks, next);
}

export function requestSpiritBeastPanel(): void {
  callbacks.onRequest?.();
}

type SpiritBeastCommandInput = SpiritBeastCommandView extends infer T
  ? T extends SpiritBeastCommandView ? Omit<T, 'requestId'> : never
  : never;

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `spirit-beast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function sendSpiritBeastCommand(command: SpiritBeastCommandInput): string {
  const requestId = createRequestId();
  callbacks.onCommand?.({ ...command, requestId } as SpiritBeastCommandView);
  return requestId;
}
