import type { Hass, RecentRecords, RecordType, ResolvedConfig } from '../types';

export const HISTORY_DIALOG_TAG = 'tankrupt-history-dialog';

export interface HistoryState {
  config: ResolvedConfig;
  hass: Hass;
  data?: RecentRecords;
  schema?: RecordType;
  loading: boolean;
  pageLoading: boolean;
  hasMore: boolean;
  restartRequired: boolean;
  error: string;
  availabilityMessage: string;
  availabilityError?: boolean;
  updateWarning?: string;
  available: boolean;
}

export interface HistoryHandle {
  updateHistory(state: HistoryState): void;
  closeDialog(): boolean;
}

export interface HistoryDialogParams {
  state: HistoryState;
  isActive(): boolean;
  onReady(handle: HistoryHandle): void;
  onClosed(): void;
  retry(): void;
  loadMore(): void;
  restart(): void;
  deleteRecord(id: string): Promise<void>;
}

export interface ShowHistoryDialogDetail {
  dialogTag: typeof HISTORY_DIALOG_TAG;
  dialogImport(): Promise<unknown>;
  dialogParams: HistoryDialogParams;
  addHistory: boolean;
}

/** HA owns the overlay and focus trap; only its public dialog protocol is used. */
export function showHistoryDialog(host: HTMLElement, params: HistoryDialogParams): void {
  if (!customElements.get('ha-dialog')) {
    throw new Error(
      'Home Assistant native dialogs are unavailable. Open a Home Assistant dialog once, then retry History, or reload the dashboard.',
    );
  }
  const surface = document.createElement('ha-dialog');
  if (!('open' in surface) || !('headerTitle' in surface || 'heading' in surface)) {
    throw new Error(
      'This Home Assistant native dialog API is unsupported. Update Home Assistant and reload the dashboard before retrying History.',
    );
  }
  host.dispatchEvent(
    new CustomEvent<ShowHistoryDialogDetail>('show-dialog', {
      bubbles: true,
      composed: true,
      detail: {
        dialogTag: HISTORY_DIALOG_TAG,
        dialogImport: () => import('./history-dialog'),
        dialogParams: params,
        addHistory: true,
      },
    }),
  );
}

export function modernDialogSurface(): boolean {
  const surface = document.createElement('ha-dialog');
  return 'headerTitle' in surface;
}
