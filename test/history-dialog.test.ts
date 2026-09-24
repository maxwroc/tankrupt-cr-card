import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeConfig } from '../src/config';
import { HistoryDialog } from '../src/custom-elements/history-dialog';
import {
  showHistoryDialog,
  type HistoryDialogParams,
  type HistoryState,
} from '../src/custom-elements/history-dialog-contract';
import type { RecentRecordsElement } from '../src/custom-elements/recent-records';
import type { Hass } from '../src/types';

class NativeDialog extends HTMLElement {
  headerTitle = '';
  open = false;
}
customElements.define('ha-dialog', NativeDialog);
const record = {
  id: 'r1',
  timestamp: '2026-06-12T12:00:00Z',
  vehicle_id: 'retired',
  vehicle_name: 'Retired car',
  fuel_type: 'petrol' as const,
  quantity: 10,
  total_cost: 15,
  unit_price: 1.5,
};
function state(): HistoryState {
  return {
    config: normalizeConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel' }),
    hass: { config: { currency: 'GBP', time_zone: 'UTC' }, locale: { language: 'en-GB' } } as Hass,
    data: { records: [record] },
    available: true,
    loading: false,
    pageLoading: false,
    hasMore: true,
    restartRequired: false,
    error: '',
    availabilityMessage: '',
  };
}
function params(): HistoryDialogParams {
  return {
    state: state(),
    isActive: () => true,
    onReady: vi.fn(),
    onClosed: vi.fn(),
    retry: vi.fn(),
    loadMore: vi.fn(),
    restart: vi.fn(),
    deleteRecord: vi.fn().mockResolvedValue(undefined),
  };
}
async function flush(element: { updateComplete: Promise<boolean> }) {
  for (let index = 0; index < 15; index++) await Promise.resolve();
  await element.updateComplete;
}
async function dialog(input = params()) {
  const element = new HistoryDialog();
  element.showDialog(input);
  document.body.append(element);
  await flush(element);
  return element;
}
function button(element: HistoryDialog, label: string) {
  return [...element.shadowRoot!.querySelectorAll('button')].find(
    (node) => node.textContent!.trim() === label,
  )!;
}
async function selectDelete(element: HistoryDialog) {
  const list = element.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!;
  await flush(list);
  list.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click();
  await flush(element);
}
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('HA-managed history lifecycle', () => {
  it('shows Load more only for unfinished history and disables it during a page request', async () => {
    const input = params(),
      element = await dialog(input);
    button(element, 'Load more').click();
    expect(input.loadMore).toHaveBeenCalledOnce();
    element.updateHistory({ ...input.state, pageLoading: true });
    await flush(element);
    expect(button(element, 'Loading more…').disabled).toBe(true);
    button(element, 'Loading more…').click();
    expect(input.loadMore).toHaveBeenCalledOnce();
    element.updateHistory({ ...input.state, hasMore: false });
    await flush(element);
    expect(button(element, 'Load more')).toBeUndefined();
    expect(element.shadowRoot!.textContent).not.toContain('End of available history');
    expect(button(element, 'Refresh history')).toBeUndefined();
    expect(button(element, 'Restart history')).toBeUndefined();
  });

  it('offers Retry for failed reads and Restart history only for cursor recovery', async () => {
    const input = params(),
      element = await dialog(input);
    element.updateHistory({ ...input.state, error: 'Temporary read failure' });
    await flush(element);
    expect(button(element, 'Load more')).toBeUndefined();
    button(element, 'Retry').click();
    expect(input.retry).toHaveBeenCalledOnce();
    element.updateHistory({ ...input.state, error: 'Cursor expired', restartRequired: true });
    await flush(element);
    expect(button(element, 'Retry')).toBeUndefined();
    button(element, 'Restart history').click();
    expect(input.restart).toHaveBeenCalledOnce();
    expect(input.deleteRecord).not.toHaveBeenCalled();
  });

  it('shows an empty completed page without Load more or upgrade guidance', async () => {
    const input = params();
    input.state = {
      ...input.state,
      data: { records: [] },
      hasMore: false,
    };
    const element = await dialog(input);
    expect(element.shadowRoot!.textContent).not.toContain('Upgrade');
    expect(element.shadowRoot!.textContent).not.toContain('End of available history');
    expect(button(element, 'Load more')).toBeUndefined();
    expect(button(element, 'Refresh history')).toBeUndefined();
  });

  it('refreshes cached row formatting when configuration or locale changes', async () => {
    const input = params(),
      element = await dialog(input);
    const list =
      element.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!;
    await flush(list);
    expect(list.shadowRoot!.textContent).toContain('£15.00');
    element.updateHistory({
      ...input.state,
      config: normalizeConfig({
        type: 'custom:tankrupt-cr-card',
        record_type: 'fuel',
        currency: 'EUR',
        vehicles: [{ id: 'retired', name: 'Renamed car', fuels: ['petrol'] }],
      }),
      hass: { ...input.state.hass, locale: { language: 'de-DE' } },
    });
    await flush(element);
    await flush(list);
    expect(list.shadowRoot!.textContent).toContain('Renamed car');
    expect(list.shadowRoot!.textContent).toContain('15,00');
    expect(list.shadowRoot!.textContent).not.toContain('£15.00');
  });

  it('uses the public dialog protocol without a card-contained overlay', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const listener = vi.fn();
    document.addEventListener('show-dialog', listener, { once: true });
    const input = params();
    showHistoryDialog(host, input);
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.bubbles && event.composed).toBe(true);
    expect(event.detail).toMatchObject({
      dialogTag: 'tankrupt-history-dialog',
      dialogParams: input,
      addHistory: true,
    });
    expect(event.detail.dialogImport()).toBeInstanceOf(Promise);
    expect(host.children.length).toBe(0);
  });

  it('reports missing native HA dialogs instead of silently showing inline content', () => {
    const get = customElements.get.bind(customElements);
    vi.spyOn(customElements, 'get').mockImplementation((name) =>
      name === 'ha-dialog' ? undefined : get(name),
    );
    expect(() => showHistoryDialog(document.body, params())).toThrow(
      'native dialogs are unavailable',
    );
  });

  it('reports unsupported native surfaces before sending an unfulfillable open request', () => {
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => create(tag === 'ha-dialog' ? 'div' : tag, options)) as typeof document.createElement);
    expect(() => showHistoryDialog(document.body, params())).toThrow(
      'native dialog API is unsupported',
    );
  });

  it('uses native modern header/footer and one modal for list and delete confirmation', async () => {
    const input = params(),
      element = await dialog(input);
    expect('params' in element).toBe(false);
    expect('dialogNext' in element).toBe(false);
    expect(element.shadowRoot!.querySelector<NativeDialog>('ha-dialog')!.headerTitle).toBe(
      'Transaction history',
    );
    expect(element.shadowRoot!.querySelector('[slot="footer"]')).toBeTruthy();
    expect(button(element, 'Refresh history')).toBeUndefined();
    expect(button(element, 'Retry')).toBeUndefined();
    const list =
      element.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!;
    await flush(list);
    expect(list.shadowRoot!.textContent).not.toContain('transactions loaded');
    expect(list.shadowRoot!.textContent).not.toContain('700');
    expect(element.shadowRoot!.textContent).not.toContain('History is read live');
    expect(element.shadowRoot!.textContent).not.toContain('Older transactions are available');
    element.updateHistory({ ...input.state, hasMore: false });
    await flush(element);
    expect(element.shadowRoot!.textContent).not.toContain('End of available history');
    element.updateHistory(input.state);
    await flush(element);
    expect(button(element, 'Load more')).toBeTruthy();
    expect(list.shadowRoot!.textContent).toContain('Retired car');
    await selectDelete(element);
    expect(element.shadowRoot!.querySelectorAll('ha-dialog')).toHaveLength(1);
    expect(element.shadowRoot!.querySelector('tankrupt-delete-dialog')).toBeNull();
    expect(element.shadowRoot!.textContent).toContain('This cannot be undone');
    expect(input.deleteRecord).not.toHaveBeenCalled();
    button(element, 'Back to history').click();
    await flush(element);
    expect(element.shadowRoot!.querySelector('tankrupt-recent-records')).toBeTruthy();
    expect(input.deleteRecord).not.toHaveBeenCalled();
  });

  it('selects the legacy heading/action API when modern headerTitle is absent', async () => {
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      const node = create(tag, options);
      if (tag === 'ha-dialog') delete (node as Partial<NativeDialog>).headerTitle;
      return node;
    }) as typeof document.createElement);
    const element = await dialog();
    expect(
      (element.shadowRoot!.querySelector('ha-dialog') as HTMLElement & { heading: string }).heading,
    ).toBe('Transaction history');
    expect(element.shadowRoot!.querySelector('[slot="secondaryAction"]')).toBeTruthy();
  });

  it('gates pending and schema-unavailable writes and never retries an uncertain deletion', async () => {
    let reject!: (reason: Error) => void;
    const input = params();
    input.deleteRecord = vi.fn(
      () =>
        new Promise<void>((_, no) => {
          reject = no;
        }),
    );
    const element = await dialog(input);
    await selectDelete(element);
    element.updateHistory({ ...input.state, available: false });
    await flush(element);
    expect(button(element, 'Delete transaction').disabled).toBe(true);
    button(element, 'Delete transaction').click();
    expect(input.deleteRecord).not.toHaveBeenCalled();
    element.updateHistory(input.state);
    await flush(element);
    button(element, 'Delete transaction').click();
    button(element, 'Delete transaction').click();
    await flush(element);
    expect(input.deleteRecord).toHaveBeenCalledExactlyOnceWith('r1');
    reject(new Error('Connection dropped'));
    await flush(element);
    expect(element.shadowRoot!.textContent).toContain('may already have been deleted');
    expect(element.shadowRoot!.textContent).toContain('No automatic retry');
    expect(button(element, 'Delete transaction').disabled).toBe(true);
    button(element, 'Back to history').click();
    await flush(element);
    expect(input.retry).not.toHaveBeenCalled();
    expect(input.restart).not.toHaveBeenCalled();
    button(element, 'Restart history').click();
    expect(input.restart).toHaveBeenCalledOnce();
  });

  it('cleans up native close and manager/back close and returns focus to the invoking action', async () => {
    const target = document.createElement('button');
    document.body.append(target);
    target.focus();
    const input = params(),
      element = await dialog(input);
    const closed = vi.fn();
    element.addEventListener('dialog-closed', closed);
    element.shadowRoot!.querySelector('ha-dialog')!.dispatchEvent(new Event('closed'));
    await flush(element);
    expect(input.onClosed).toHaveBeenCalledOnce();
    expect(closed.mock.calls[0][0].detail).toEqual({ dialog: 'tankrupt-history-dialog' });
    expect(document.activeElement).toBe(target);
    expect(element.closeDialog()).toBe(true);
    expect(input.onClosed).toHaveBeenCalledOnce();
    expect(element.shadowRoot!.querySelector('ha-dialog')).toBeNull();
  });

  it('drops obsolete card callbacks and late writes when HA reuses the dialog element', async () => {
    let resolve!: () => void;
    const first = params();
    first.deleteRecord = vi.fn(
      () =>
        new Promise<void>((yes) => {
          resolve = yes;
        }),
    );
    const element = await dialog(first);
    await selectDelete(element);
    button(element, 'Delete transaction').click();
    await flush(element);
    const second = params();
    second.state.data = { records: [{ ...record, id: 'other' }] };
    element.showDialog(second);
    await flush(element);
    await selectDelete(element);
    resolve();
    await flush(element);
    expect(first.onClosed).toHaveBeenCalledOnce();
    expect(element.shadowRoot!.textContent).toContain('Record ID: other');
    button(element, 'Delete transaction').click();
    await flush(element);
    expect(second.deleteRecord).toHaveBeenCalledExactlyOnceWith('other');
    element.remove();
    expect(second.onClosed).toHaveBeenCalledOnce();
  });

  it('does not activate an expired asynchronous open request', async () => {
    const input = params();
    input.isActive = () => false;
    const element = await dialog(input);
    expect(input.onReady).not.toHaveBeenCalled();
    expect(element.shadowRoot!.querySelector('ha-dialog')).toBeNull();
  });

  it('does not let a delayed expired open replace another card current session', async () => {
    const current = params(),
      element = await dialog(current);
    const stale = params();
    stale.isActive = () => false;
    element.showDialog(stale);
    await flush(element);
    expect(current.onClosed).not.toHaveBeenCalled();
    expect(stale.onReady).not.toHaveBeenCalled();
    expect(element.shadowRoot!.querySelector('ha-dialog')).toBeTruthy();
    element.updateHistory({ ...current.state, error: 'Please retry' });
    await flush(element);
    button(element, 'Retry').click();
    expect(current.retry).toHaveBeenCalledOnce();
    expect(stale.retry).not.toHaveBeenCalled();
  });

  it('keeps stale/error, empty, loading and retention states readable and recoverable', async () => {
    const input = params();
    input.state.schema = {
      id: 'fuel',
      name: 'Fuel',
      fields: [],
      retention_days: 30,
      max_records: 500,
    };
    input.state.error = 'Backend denied';
    const element = await dialog(input);
    expect(element.shadowRoot!.textContent).toContain('Loaded records have been kept');
    expect(element.shadowRoot!.textContent).toContain('Maximum 500 records');
    button(element, 'Retry').click();
    expect(input.retry).toHaveBeenCalledOnce();
    const list =
      element.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!;
    await flush(list);
    expect(list.shadowRoot!.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    element.updateHistory({
      ...input.state,
      error: '',
      data: { records: [] },
      loading: true,
    });
    await flush(element);
    expect(element.shadowRoot!.textContent).toContain('Loading recent');
    expect(button(element, 'Refresh history')).toBeUndefined();
    expect(button(element, 'Retry')).toBeUndefined();
    await flush(list);
    expect(list.shadowRoot!.textContent).toContain('No transactions match these filters');
  });
});
