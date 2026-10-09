import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardConfig, Hass, HistoryPage, RecordType, Summary, Transaction } from '../src/types';

const mock = vi.hoisted(() => ({
  sources: [] as any[],
  schema: undefined as Promise<RecordType> | undefined,
  summary: undefined as Promise<Summary> | undefined,
  subscription: undefined as Promise<() => void> | undefined,
}));
vi.mock('../src/data/custom-records-source', () => ({
  CustomRecordsSource: class {
    callback?: () => void;
    unsubscribe = vi.fn();
    getRecordType = vi.fn(
      () =>
        mock.schema ??
        Promise.resolve({ id: 'fuel', name: 'Fuel', fields: [], retention_days: 365 }),
    );
    fetchSummary = vi.fn(
      () =>
        mock.summary ??
        Promise.resolve({
          current: { cost: 42, quantity: 900, count: 3 },
          previous: { cost: 30, quantity: 5, count: 2 },
          periods: {
            current: { start: '2026-06-01T00:00:00Z', end: '2026-06-12T12:00:00Z' },
            previous: { start: '2026-05-01T00:00:00Z', end: '2026-05-31T23:59:59.999999Z' },
          },
        }),
    );
    fetchChart = vi.fn().mockResolvedValue([]);
    fetchHistoryPage = vi.fn().mockResolvedValue({
      nextCursor: 'page-2',
      hasMore: true,
      records: [
        {
          id: 'r1',
          timestamp: '2026-06-12T12:00:00Z',
          vehicle_id: 'old',
          vehicle_name: 'Retired car',
          fuel_type: 'petrol',
          quantity: 10,
          total_cost: 15,
          unit_price: 1.5,
        },
      ],
    });
    addRecord = vi.fn().mockResolvedValue(undefined);
    deleteRecord = vi.fn().mockResolvedValue(undefined);
    invalidate = vi.fn();
    subscribeUpdates = vi.fn((callback: () => void) => {
      this.callback = callback;
      return mock.subscription ?? Promise.resolve(this.unsubscribe);
    });
    constructor() {
      mock.sources.push(this);
    }
  },
}));
import { TankruptCard } from '../src/custom-elements/tankrupt-cr-card';
import type { AddRecordDialog } from '../src/custom-elements/add-record-dialog';
import { HistoryDialog } from '../src/custom-elements/history-dialog';
import type { RecentRecordsElement } from '../src/custom-elements/recent-records';
import type {
  HistoryDialogParams,
  ShowHistoryDialogDetail,
} from '../src/custom-elements/history-dialog-contract';

class NativeDialog extends HTMLElement {
  headerTitle = '';
  open = false;
}
customElements.define('ha-dialog', NativeDialog);
let history: HistoryDialog | undefined;
let historyParams: HistoryDialogParams;
const dialogHost = (event: Event) => {
  const detail = (event as CustomEvent<ShowHistoryDialogDetail>).detail;
  historyParams = detail.dialogParams;
  history ??= new HistoryDialog();
  history.showDialog(detail.dialogParams);
  if (history.parentNode !== document.body) document.body.append(history);
};

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function homeAssistant(): Hass & { listeners: Map<string, Set<() => void>> } {
  const listeners = new Map<string, Set<() => void>>();
  return {
    config: { time_zone: 'UTC', currency: 'GBP' },
    locale: { language: 'en-GB' },
    listeners,
    connection: {
      sendMessagePromise: vi.fn(),
      subscribeEvents: vi.fn(),
      addEventListener: (event, callback) => {
        const entries = listeners.get(event) ?? new Set();
        entries.add(callback);
        listeners.set(event, entries);
      },
      removeEventListener: (event, callback) => {
        listeners.get(event)?.delete(callback);
      },
    },
  };
}
async function flush(element: { updateComplete: Promise<boolean> }) {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await element.updateComplete;
}
async function card(extra: Partial<CardConfig> = {}, hass = homeAssistant()) {
  const element = new TankruptCard();
  element.setConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel', ...extra });
  element.hass = hass;
  document.body.append(element);
  await flush(element);
  return element;
}
function button(element: TankruptCard, text: string) {
  return [...element.shadowRoot!.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  )!;
}
async function openHistory(element: TankruptCard) {
  button(element, 'History').focus();
  button(element, 'History').click();
  await flush(element);
  await flush(history!);
  return history!;
}
function loaded(dialog = history!): Transaction[] {
  return dialog.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!.data
    .records;
}
function transaction(id: string): Transaction {
  return {
    id,
    timestamp: '2026-06-12T12:00:00Z',
    vehicle_id: 'old',
    fuel_type: 'petrol',
    quantity: 10,
    total_cost: 15,
    unit_price: 1.5,
  };
}
function page(ids: string[], nextCursor: string | null = null): HistoryPage {
  return {
    records: ids.map(transaction),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}
async function more(element: TankruptCard) {
  historyParams.loadMore();
  await flush(element);
  await flush(history!);
}
beforeEach(() => {
  mock.sources.length = 0;
  mock.schema = mock.summary = mock.subscription = undefined;
  history = undefined;
  document.addEventListener('show-dialog', dialogHost);
});
afterEach(() => {
  document.body.replaceChildren();
  document.removeEventListener('show-dialog', dialogHost);
  vi.useRealTimers();
});

describe('card presentation and scope', () => {
  it('shows only the date range in the billing caption', async () => {
    const element = await card();
    const caption = element.shadowRoot!.querySelector('.caption')!;
    expect(caption.textContent!.replace(/\s+/g, ' ').trim()).toBe('1 Jun 2026 – 12 Jun 2026');
  });

  it.each([
    {
      current: 10,
      previous: 20,
      count: 1,
      mode: 'percentage' as const,
      value: '↓ 50%',
      color: 'down',
    },
    {
      current: 42,
      previous: 30,
      count: 1,
      mode: 'amount' as const,
      value: '↑ £12.00',
      color: 'up',
    },
    {
      current: 20,
      previous: 20,
      count: 1,
      mode: 'percentage' as const,
      value: '↔ 0%',
      color: 'flat',
    },
    { current: 10, previous: 0, count: 1, mode: 'percentage' as const, value: '—', color: '' },
    { current: 10, previous: 0, count: 0, mode: 'amount' as const, value: '—', color: '' },
  ])(
    'renders one truthful $mode trend for $current vs $previous ($count records)',
    async ({ current, previous, count, mode, value, color }) => {
      mock.summary = Promise.resolve({
        current: { cost: current, quantity: 0, count: 1 },
        previous: { cost: previous, quantity: 0, count },
        periods: {
          current: { start: '2026-06-01T00:00:00Z', end: '2026-06-12T12:00:00Z' },
          previous: { start: '2026-05-01T00:00:00Z', end: '2026-05-31T23:59:59.999999Z' },
        },
      });
      const element = await card({ trend_display: mode });
      const trend = element.shadowRoot!.querySelector('.trend span')!;
      expect(trend.textContent!.trim()).toBe(value);
      expect(trend.className).toBe(color);
      expect(element.shadowRoot!.querySelector('.trend')!.getAttribute('aria-label')).toContain(
        'current partial billing period',
      );
      expect(element.shadowRoot!.querySelector('details.trend')).toBeNull();
      expect(element.shadowRoot!.querySelector('.trend')!.getAttribute('role')).toBe('img');
      expect(element.shadowRoot!.querySelector('.summary')!.classList.contains('with-trend')).toBe(
        true,
      );
      expect(element.shadowRoot!.querySelector('.spend')!.className).toBe('spend');
    },
  );

  it.each([
    { show_summary: true, show_trend: false },
    { show_summary: false, show_trend: true },
  ])('preserves independent summary/trend visibility: %o', async (config) => {
    const element = await card(config);
    expect(Boolean(element.shadowRoot!.querySelector('.spend'))).toBe(config.show_summary);
    expect(Boolean(element.shadowRoot!.querySelector('.trend'))).toBe(config.show_trend);
    expect(element.shadowRoot!.querySelector('.summary')!.classList.contains('with-trend')).toBe(
      false,
    );
    expect(mock.sources[0].fetchSummary).toHaveBeenCalledOnce();
  });
  it('contains only Add and History actions and no runtime settings or inline records', async () => {
    const element = await card();
    expect(
      [...element.shadowRoot!.querySelectorAll('button')].map((node) => node.textContent!.trim()),
    ).toEqual(['History', 'Add']);
    expect(element.shadowRoot!.querySelector('select')).toBeNull();
    expect(element.shadowRoot!.querySelector('tankrupt-recent-records')).toBeNull();
    expect(mock.sources[0].fetchHistoryPage).not.toHaveBeenCalled();
    expect(element.getCardSize()).toBe(7);
  });

  it('can hide Add independently without disabling summaries, charts or History', async () => {
    const element = await card({ show_add_button: false });
    expect(button(element, 'Add')).toBeUndefined();
    expect(button(element, 'History')).toBeTruthy();
    expect(element.shadowRoot!.querySelector('.spend')).not.toBeNull();
    expect(element.shadowRoot!.querySelector('tankrupt-fuel-chart')).not.toBeNull();
    expect(mock.sources[0].fetchSummary).toHaveBeenCalledOnce();
    expect(mock.sources[0].fetchChart).toHaveBeenCalledOnce();
    await openHistory(element);
    expect(mock.sources[0].fetchHistoryPage).toHaveBeenCalledOnce();
    element.setConfig({
      type: 'custom:tankrupt-cr-card',
      record_type: 'fuel',
      show_add_button: false,
      show_recent_records: false,
    });
    await flush(element);
    expect(element.shadowRoot!.querySelector('.card-actions')).toBeNull();
    expect(element.shadowRoot!.querySelector('h1')!.textContent).toBe('Tankrupt');
  });

  it('closes entry when Add is hidden and restores the default when the option is omitted', async () => {
    const element = await card({ show_add_button: true });
    button(element, 'Add').click();
    await flush(element);
    expect(element.shadowRoot!.querySelector('tankrupt-add-dialog')).not.toBeNull();
    element.setConfig({
      type: 'custom:tankrupt-cr-card',
      record_type: 'fuel',
      show_add_button: false,
    });
    await flush(element);
    expect(button(element, 'Add')).toBeUndefined();
    expect(element.shadowRoot!.querySelector('tankrupt-add-dialog')).toBeNull();
    element.setConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel' });
    await flush(element);
    expect(button(element, 'Add').disabled).toBe(false);
    button(element, 'Add').click();
    await flush(element);
    expect(element.shadowRoot!.querySelector('tankrupt-add-dialog')).not.toBeNull();
  });

  it.each([true, false])('reserves the title row with action visibility %s', async (visible) => {
    const element = await card({
      title: 'Fuel costs',
      show_add_button: visible,
      show_recent_records: visible,
    });
    expect(element.shadowRoot!.querySelector('header')!.classList.contains('has-title')).toBe(true);
    expect(element.shadowRoot!.querySelector('h1')!.textContent).toBe('Fuel costs');
  });

  it.each(['', '   '])(
    'omits the header when title %j and both actions are hidden',
    async (title) => {
      const element = await card({
        title,
        show_add_button: false,
        show_recent_records: false,
      });
      expect(element.shadowRoot!.querySelector('header')).toBeNull();
      expect(element.shadowRoot!.querySelector('h1')).toBeNull();
      expect(element.shadowRoot!.querySelector('.spend')).not.toBeNull();
    },
  );

  it('keeps actions available without reserving an empty title', async () => {
    const element = await card({ title: '' });
    expect(element.shadowRoot!.querySelector('header')!.classList.contains('has-title')).toBe(
      false,
    );
    expect(element.shadowRoot!.querySelector('h1')).toBeNull();
    expect(button(element, 'Add')).toBeTruthy();
    expect(button(element, 'History')).toBeTruthy();
  });

  describe('lazy history requests and ownership', () => {
    it('ignores a pre-reconnect history response without restarting the traversal', async () => {
      const element = await card();
      const first = mock.sources[0];
      const stale = deferred<HistoryPage>();
      first.fetchHistoryPage.mockReturnValueOnce(stale.promise);
      const dialog = await openHistory(element);
      element.hass = homeAssistant();
      await flush(element);
      await flush(dialog);
      expect(mock.sources[1].fetchHistoryPage).not.toHaveBeenCalled();
      stale.resolve(page(['stale']));
      await flush(element);
      await flush(dialog);
      expect(dialog.shadowRoot!.textContent).toContain('interrupted');
      historyParams.retry();
      await flush(element);
      await flush(dialog);
      expect(loaded(dialog).map((record) => record.id)).toEqual(['r1']);
      expect(mock.sources[1].fetchHistoryPage.mock.calls[0]).toEqual(
        first.fetchHistoryPage.mock.calls[0],
      );
    });

    it('invalidates closed-history responses and starts a fresh request on reopen', async () => {
      const element = await card();
      const source = mock.sources[0];
      const stale = deferred<HistoryPage>();
      source.fetchHistoryPage.mockReturnValueOnce(stale.promise);
      const dialog = await openHistory(element);
      expect(source.fetchHistoryPage).toHaveBeenCalledOnce();
      dialog.closeDialog();
      await flush(element);
      expect(element.shadowRoot!.querySelector('tankrupt-recent-records')).toBeNull();
      await openHistory(element);
      stale.resolve(page(['stale']));
      await flush(element);
      await flush(dialog);
      expect(loaded(dialog).map((record) => record.id)).toEqual(['r1']);
      expect(source.fetchHistoryPage).toHaveBeenCalledTimes(2);
    });

    it('never refetches loaded history on record updates, but still revalidates schema and aggregates', async () => {
      vi.useFakeTimers();
      const element = await card();
      const source = mock.sources[0];
      source.callback();
      await vi.advanceTimersByTimeAsync(250);
      expect(source.fetchHistoryPage).not.toHaveBeenCalled();
      const dialog = await openHistory(element);
      source.callback();
      await vi.advanceTimersByTimeAsync(250);
      source.callback();
      await vi.advanceTimersByTimeAsync(250);
      await flush(element);
      await flush(dialog);
      expect(loaded(dialog).map((record) => record.id)).toEqual(['r1']);
      expect(source.fetchHistoryPage).toHaveBeenCalledOnce();
      expect(source.getRecordType).toHaveBeenCalledTimes(4);
      expect(source.fetchSummary).toHaveBeenCalledTimes(4);
      dialog.closeDialog();
      source.callback();
      await vi.advanceTimersByTimeAsync(250);
      expect(source.fetchHistoryPage).toHaveBeenCalledOnce();
    });

    it('closes history on reconfiguration/removal and rejects stale callbacks without touching the new source', async () => {
      const element = await card();
      let detail!: ShowHistoryDialogDetail;
      element.addEventListener('show-dialog', (event) => {
        detail = (event as CustomEvent<ShowHistoryDialogDetail>).detail;
      });
      const dialog = await openHistory(element);
      const oldParams = detail.dialogParams;
      element.setConfig({ type: 'custom:tankrupt-cr-card', record_type: 'other' });
      await flush(element);
      await flush(dialog);
      expect(dialog.shadowRoot!.querySelector('ha-dialog')).toBeNull();
      await expect(oldParams.deleteRecord('r1')).rejects.toThrow('session is closed');
      expect(mock.sources[1].deleteRecord).not.toHaveBeenCalled();
      expect(mock.sources[1].fetchHistoryPage).not.toHaveBeenCalled();
      await openHistory(element);
      element.remove();
      await flush(dialog);
      expect(detail.dialogParams.isActive()).toBe(false);
      expect(dialog.shadowRoot!.querySelector('ha-dialog')).toBeNull();
    });

    it('uses the current card owner when HA reuses one history element across cards', async () => {
      const first = await card({ record_type: 'first' });
      const second = await card({ record_type: 'second' });
      const dialog = await openHistory(first);
      await openHistory(second);
      await flush(first);
      expect(button(first, 'Add').disabled).toBe(false);
      const recent =
        dialog.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!;
      await flush(recent);
      recent.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click();
      await flush(dialog);
      dialog.shadowRoot!.querySelector<HTMLButtonElement>('.danger')!.click();
      await flush(second);
      expect(mock.sources[0].deleteRecord).not.toHaveBeenCalled();
      expect(mock.sources[1].deleteRecord).toHaveBeenCalledExactlyOnceWith('r1');
      first.remove();
      await flush(dialog);
      expect(dialog.shadowRoot!.querySelector('ha-dialog')).toBeTruthy();
    });

    it('rejects arbitrary record IDs and offline writes in captured history callbacks', async () => {
      const hass = homeAssistant(),
        element = await card({}, hass);
      let detail!: ShowHistoryDialogDetail;
      element.addEventListener('show-dialog', (event) => {
        detail = (event as CustomEvent<ShowHistoryDialogDetail>).detail;
      });
      await openHistory(element);
      await expect(detail.dialogParams.deleteRecord('not-displayed')).rejects.toThrow(
        'no longer in the displayed history',
      );
      [...hass.listeners.get('disconnected')!].forEach((callback) => callback());
      await expect(detail.dialogParams.deleteRecord('r1')).rejects.toThrow('schema is not ready');
      expect(mock.sources[0].deleteRecord).not.toHaveBeenCalled();
    });

    it('reports an unavailable dialog manager within a bounded time, without fetching raw records', async () => {
      vi.useFakeTimers();
      document.removeEventListener('show-dialog', dialogHost);
      const element = await card();
      button(element, 'History').click();
      await vi.advanceTimersByTimeAsync(3000);
      await flush(element);
      expect(element.shadowRoot!.textContent).toContain('did not open the native History dialog');
      expect(button(element, 'Retry History')).toBeTruthy();
      expect(mock.sources[0].fetchHistoryPage).not.toHaveBeenCalled();
      element.remove();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps stale history visible with a retry after a backend failure, without fabricating empty results', async () => {
      vi.useFakeTimers();
      const element = await card();
      const dialog = await openHistory(element);
      const source = mock.sources[0];
      source.fetchHistoryPage.mockRejectedValueOnce(new Error('Backend denied'));
      await more(element);
      await flush(element);
      await flush(dialog);
      expect(dialog.shadowRoot!.textContent).toContain('Backend denied');
      expect(dialog.shadowRoot!.textContent).toContain('Loaded records have been kept');
      expect(loaded(dialog).map((record) => record.id)).toEqual(['r1']);
    });
  });

  it.each([
    { currency: undefined, time_zone: 'UTC', expected: 'three-letter currency code' },
    { currency: 'invalid', time_zone: 'UTC', expected: 'three-letter currency code' },
    { currency: 'GBP', time_zone: 'Invalid/Zone', expected: 'Invalid time zone' },
  ])(
    'clears stale presentation when HA settings become invalid: $expected',
    async ({ currency, time_zone, expected }) => {
      const element = await card();
      expect(element.shadowRoot!.querySelector('tankrupt-recent-records')).toBeNull();
      button(element, 'Add').click();
      await flush(element);
      expect(element.shadowRoot!.querySelector('tankrupt-add-dialog')).toBeTruthy();
      element.hass = { ...element.hass!, config: { currency, time_zone } };
      await flush(element);
      expect(element.shadowRoot!.textContent).toContain(expected);
      expect(element.shadowRoot!.querySelector('tankrupt-recent-records')).toBeNull();
      expect(element.shadowRoot!.querySelector('tankrupt-add-dialog')).toBeNull();
      expect(button(element, 'Add').disabled).toBe(true);
    },
  );

  it('uses aggregates, a static accessible trend and retention detail', async () => {
    const element = await card();
    expect(element.shadowRoot!.textContent).toContain('£42.00');
    expect(element.shadowRoot!.textContent).not.toContain('Entire previous period');
    const trend = element.shadowRoot!.querySelector<HTMLElement>('.trend')!;
    expect(trend.textContent).toContain('↑ 40%');
    expect(trend.textContent).not.toContain('£');
    expect(trend.querySelector('summary, p')).toBeNull();
    expect(trend.hasAttribute('tabindex')).toBe(false);
    const before = element.shadowRoot!.textContent;
    trend.click();
    await flush(element);
    expect(element.shadowRoot!.textContent).toBe(before);
    expect(element.shadowRoot!.textContent).not.toContain('More spending');
    expect(element.shadowRoot!.textContent).toContain('365 days retention');
    expect(element.shadowRoot!.textContent).not.toContain('900');
    const source = mock.sources[0];
    expect(source.fetchSummary.mock.calls[0][1]).toBe(source.fetchChart.mock.calls[0][3]);
    await openHistory(element);
    expect(source.fetchHistoryPage.mock.calls[0][1]).toMatch(/T/);
  });

  it('applies configured filters to every query with configured chart settings', async () => {
    const element = await card({
      filter: { vehicle: 'old', fuel: 'electricity' },
      graph: { periods: 3, metric: 'price' },
    });
    await openHistory(element);
    const source = mock.sources[0];
    for (const method of [source.fetchSummary, source.fetchChart, source.fetchHistoryPage]) {
      expect(method.mock.lastCall[0]).toEqual({ vehicle: 'old', fuel: 'electricity' });
    }
    expect(source.fetchChart.mock.lastCall.slice(0, 3)).toEqual([
      { vehicle: 'old', fuel: 'electricity' },
      3,
      'price',
    ]);
  });

  it('does not request hidden sections, but permits entry', async () => {
    const element = await card({
      show_summary: false,
      show_trend: false,
      show_chart: false,
      show_recent_records: false,
    });
    const source = mock.sources[0];
    expect(source.fetchSummary).not.toHaveBeenCalled();
    expect(source.fetchChart).not.toHaveBeenCalled();
    expect(source.fetchHistoryPage).not.toHaveBeenCalled();
    expect(button(element, 'Add').disabled).toBe(false);
    expect(element.shadowRoot!.querySelector('tankrupt-fuel-chart')).toBeNull();
  });

  it('blocks writes until schema validation and renders actionable failures', async () => {
    const schema = deferred<RecordType>();
    mock.schema = schema.promise;
    const element = await card();
    expect(button(element, 'Add').disabled).toBe(true);
    schema.reject(new Error('quantity must be number'));
    await flush(element);
    expect(element.shadowRoot!.textContent).toContain('quantity must be number');
    expect(mock.sources[0].fetchSummary).not.toHaveBeenCalled();
  });

  it('retains independent load and subscription errors instead of inventing zero totals', async () => {
    const summary = deferred<Summary>(),
      subscription = deferred<() => void>();
    mock.summary = summary.promise;
    mock.subscription = subscription.promise;
    const element = await card();
    summary.reject(new Error('Aggregate unavailable'));
    subscription.reject(new Error('Websocket denied'));
    await flush(element);
    expect(element.shadowRoot!.textContent).toMatch(/Summary unavailable:\s+Aggregate unavailable/);
    expect(element.shadowRoot!.textContent).toContain('Live updates unavailable: Websocket denied');
    expect(element.shadowRoot!.querySelector('tankrupt-recent-records')).toBeNull();
    expect(element.shadowRoot!.textContent).not.toContain('£0.00');
  });
});

describe('history pagination', () => {
  it('traverses 1001 tied-timestamp records in batches of 20 without reordering or duplicates', async () => {
    const element = await card({ recent_limit: 20, filter: { vehicle: 'old', fuel: 'petrol' } });
    const source = mock.sources[0];
    const ids = Array.from(
      { length: 1001 },
      (_, index) => `${index % 2 ? 'a' : 'Z'} imported:${1001 - index}`,
    );
    source.fetchHistoryPage.mockImplementation((_scope: unknown, _end: string, cursor?: string) => {
      const start = cursor ? Number(cursor.slice(5)) : 0;
      const next = start + 20;
      return Promise.resolve(
        page(ids.slice(start, next), next < ids.length ? `page:${next}` : null),
      );
    });
    const dialog = await openHistory(element);
    const firstCall = source.fetchHistoryPage.mock.calls[0];
    for (let index = 20; index < ids.length; index += 20) await more(element);
    expect(source.fetchHistoryPage).toHaveBeenCalledTimes(51);
    expect(loaded(dialog).map((record) => record.id)).toEqual(ids);
    expect(new Set(loaded(dialog).map((record) => record.id)).size).toBe(1001);
    expect(
      source.fetchHistoryPage.mock.calls.every(
        (call: unknown[]) =>
          JSON.stringify(call[0]) === JSON.stringify(firstCall[0]) && call[1] === firstCall[1],
      ),
    ).toBe(true);
    expect(dialog.shadowRoot!.querySelector('[aria-label="Load more"]')).toBeNull();
    expect(dialog.shadowRoot!.textContent).not.toContain('End of available history');
    await more(element);
    expect(source.fetchHistoryPage).toHaveBeenCalledTimes(51);
    expect(source.fetchSummary).toHaveBeenCalledOnce();
    expect(source.fetchChart).toHaveBeenCalledOnce();
  }, 15000);

  it('allows only one active page, preserves row nodes and deduplicates exact IDs in server order', async () => {
    const element = await card();
    const source = mock.sources[0];
    const dialog = await openHistory(element);
    const list = dialog.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!;
    await flush(list);
    const row = list.shadowRoot!.querySelector('li');
    const next = deferred<HistoryPage>();
    source.fetchHistoryPage.mockReturnValueOnce(next.promise);
    historyParams.loadMore();
    historyParams.loadMore();
    await flush(element);
    await flush(dialog);
    expect(source.fetchHistoryPage).toHaveBeenCalledTimes(2);
    expect(dialog.shadowRoot!.textContent).toContain('Loading older');
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1']);
    next.resolve(page(['r1', 'Z', 'a', 'Z', 'A', 'a'], 'next-3'));
    await flush(element);
    await flush(dialog);
    await flush(list);
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1', 'Z', 'a', 'A']);
    expect(list.shadowRoot!.querySelector('li')).toBe(row);
    source.fetchHistoryPage.mockResolvedValueOnce(page(['A', 'Z'], 'next-4'));
    await more(element);
    expect(loaded(dialog)).toHaveLength(4);
    source.fetchHistoryPage.mockResolvedValueOnce(page(['last']));
    await more(element);
    expect(source.fetchHistoryPage.mock.lastCall[2]).toBe('next-4');
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1', 'Z', 'a', 'A', 'last']);
  });

  it('retries a failed page with the same captured scope, end and cursor, preserving loaded rows', async () => {
    const element = await card();
    const source = mock.sources[0];
    const dialog = await openHistory(element);
    source.fetchHistoryPage.mockRejectedValueOnce(new Error('Read unavailable'));
    await more(element);
    const failedCall = source.fetchHistoryPage.mock.lastCall;
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1']);
    expect(dialog.shadowRoot!.textContent).toContain('Read unavailable');
    source.fetchHistoryPage.mockResolvedValueOnce(page(['r0']));
    historyParams.retry();
    await flush(element);
    await flush(dialog);
    expect(source.fetchHistoryPage.mock.lastCall).toEqual(failedCall);
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1', 'r0']);
  });

  it('rejects a repeated/cyclic server cursor before appending and keeps the previous cursor for retry', async () => {
    const element = await card();
    const source = mock.sources[0];
    const dialog = await openHistory(element);
    source.fetchHistoryPage.mockResolvedValueOnce(page(['bad'], 'page-2'));
    await more(element);
    expect(dialog.shadowRoot!.textContent).toContain('did not advance');
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1']);
    source.fetchHistoryPage.mockResolvedValueOnce(page(['r0'], 'page-3'));
    historyParams.retry();
    await flush(element);
    expect(source.fetchHistoryPage.mock.lastCall[2]).toBe('page-2');
    source.fetchHistoryPage.mockResolvedValueOnce(page(['cycle'], 'page-2'));
    await more(element);
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1', 'r0']);
    expect(dialog.shadowRoot!.textContent).toContain('did not advance');
    source.fetchHistoryPage.mockResolvedValueOnce(page(['last']));
    historyParams.retry();
    await flush(element);
    expect(source.fetchHistoryPage.mock.lastCall[2]).toBe('page-3');
  });

  it.each(['cursor_expired', 'cursor_query_mismatch', 'invalid_cursor'])(
    'keeps expired/mismatched history and explicitly restarts after %s',
    async (code) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T12:00:00Z'));
      const element = await card();
      const source = mock.sources[0];
      const dialog = await openHistory(element);
      const oldEnd = source.fetchHistoryPage.mock.calls[0][1];
      source.fetchHistoryPage.mockRejectedValueOnce(
        Object.assign(new Error('Cursor cannot be continued'), { code }),
      );
      await more(element);
      expect(loaded(dialog).map((record) => record.id)).toEqual(['r1']);
      expect(dialog.shadowRoot!.textContent).toContain('Restart history');
      historyParams.retry();
      historyParams.loadMore();
      await flush(element);
      expect(source.fetchHistoryPage).toHaveBeenCalledTimes(2);
      vi.setSystemTime(new Date('2026-06-12T13:00:00Z'));
      source.fetchHistoryPage.mockResolvedValueOnce(page(['new']));
      historyParams.restart();
      await flush(element);
      await flush(dialog);
      expect(source.fetchHistoryPage.mock.lastCall[2]).toBeUndefined();
      expect(source.fetchHistoryPage.mock.lastCall[1]).not.toBe(oldEnd);
      expect(loaded(dialog).map((record) => record.id)).toEqual(['new']);
    },
  );

  it('keeps pages and cursor through connection replacement without an automatic read', async () => {
    const element = await card();
    const source = mock.sources[0];
    const dialog = await openHistory(element);
    source.fetchHistoryPage.mockResolvedValueOnce(page(['older'], 'third'));
    await more(element);
    const oldEnd = source.fetchHistoryPage.mock.calls[0][1];
    element.hass = homeAssistant();
    await flush(element);
    await flush(dialog);
    const replacement = mock.sources[1];
    expect(replacement.fetchHistoryPage).not.toHaveBeenCalled();
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1', 'older']);
    replacement.fetchHistoryPage.mockResolvedValueOnce(page(['last']));
    await more(element);
    expect(replacement.fetchHistoryPage.mock.lastCall).toEqual([{}, oldEnd, 'third']);
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1', 'older', 'last']);
  });

  it('does not refetch or cancel an active page on a record update/schema check', async () => {
    vi.useFakeTimers();
    const element = await card();
    const source = mock.sources[0];
    const dialog = await openHistory(element);
    const next = deferred<HistoryPage>();
    source.fetchHistoryPage.mockReturnValueOnce(next.promise);
    historyParams.loadMore();
    source.callback();
    await vi.advanceTimersByTimeAsync(250);
    expect(source.fetchHistoryPage).toHaveBeenCalledTimes(2);
    next.resolve(page(['older']));
    await flush(element);
    await flush(dialog);
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1', 'older']);
    expect(source.fetchSummary).toHaveBeenCalledTimes(2);
  });

  it('does not reintroduce a successfully deleted row from an overlapping in-flight page', async () => {
    const element = await card();
    const source = mock.sources[0];
    const dialog = await openHistory(element);
    const next = deferred<HistoryPage>();
    source.fetchHistoryPage.mockReturnValueOnce(next.promise);
    historyParams.loadMore();
    await historyParams.deleteRecord('r1');
    await flush(element);
    next.resolve(page(['r1', 'older']));
    await flush(element);
    await flush(dialog);
    expect(loaded(dialog).map((record) => record.id)).toEqual(['older']);
    expect(source.fetchHistoryPage).toHaveBeenCalledTimes(2);
  });

  it('retains uncertain deletions, blocks immediate retries and requires an explicit restart', async () => {
    const element = await card();
    const source = mock.sources[0];
    const dialog = await openHistory(element);
    source.deleteRecord.mockRejectedValueOnce(new Error('Connection dropped'));
    await expect(historyParams.deleteRecord('r1')).rejects.toThrow('Connection dropped');
    await flush(element);
    await flush(dialog);
    expect(loaded(dialog).map((record) => record.id)).toEqual(['r1']);
    expect(source.fetchHistoryPage).toHaveBeenCalledOnce();
    await expect(historyParams.deleteRecord('r1')).rejects.toThrow('Restart history');
    expect(source.deleteRecord).toHaveBeenCalledOnce();
    source.fetchHistoryPage.mockResolvedValueOnce(page([]));
    historyParams.restart();
    await flush(element);
    await flush(dialog);
    expect(loaded(dialog)).toEqual([]);
  });

  it('shows initial page failures explicitly and retries without substituting an empty list', async () => {
    const element = await card();
    const source = mock.sources[0];
    source.fetchHistoryPage.mockRejectedValueOnce(
      Object.assign(new Error('Pagination request rejected'), { code: 'invalid_format' }),
    );
    const dialog = await openHistory(element);
    expect(dialog.shadowRoot!.textContent).toContain('Pagination request rejected');
    expect(dialog.shadowRoot!.querySelector('tankrupt-recent-records')).toBeNull();
    expect(
      [...dialog.shadowRoot!.querySelectorAll('button')].map((node) => node.textContent!.trim()),
    ).toEqual(['Retry', 'Close']);
    expect(source.fetchHistoryPage).toHaveBeenCalledOnce();
    source.fetchHistoryPage.mockResolvedValueOnce(page(['retried']));
    historyParams.retry();
    await flush(element);
    await flush(dialog);
    expect(loaded(dialog).map((record) => record.id)).toEqual(['retried']);
    expect(source.fetchHistoryPage).toHaveBeenCalledTimes(2);
    expect(source.fetchHistoryPage.mock.calls[1]).toEqual(source.fetchHistoryPage.mock.calls[0]);
  });
});

describe('card lifecycle', () => {
  it('revalidates schema and updates retention metadata after debounced record-type events', async () => {
    vi.useFakeTimers();
    const element = await card();
    const source = mock.sources[0];
    const changedSchema = deferred<RecordType>();
    source.getRecordType.mockReturnValueOnce(changedSchema.promise);
    source.callback();
    await flush(element);
    expect(button(element, 'Add').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(source.getRecordType).toHaveBeenCalledTimes(2);
    expect(source.fetchSummary).toHaveBeenCalledOnce();
    changedSchema.resolve({
      id: 'fuel',
      name: 'Fuel',
      fields: [],
      retention_days: 30,
      max_records: 500,
    });
    await flush(element);
    expect(element.shadowRoot!.textContent).toContain('30 days retention');
    expect(element.shadowRoot!.textContent).toContain('Maximum 500 records');
    expect(element.shadowRoot!.textContent).not.toContain('365 days retention');
    expect(button(element, 'Add').disabled).toBe(false);
    expect(source.fetchSummary).toHaveBeenCalledTimes(2);
  });

  it('blocks saving when an event removes the schema and ignores older same-source schema responses', async () => {
    vi.useFakeTimers();
    const element = await card();
    const source = mock.sources[0];
    const staleSchema = deferred<RecordType>();
    source.getRecordType.mockReturnValueOnce(staleSchema.promise);
    source.callback();
    await vi.advanceTimersByTimeAsync(250);
    source.getRecordType.mockRejectedValueOnce(
      new Error('Record type fuel no longer exists. Select an existing record type.'),
    );
    source.callback();
    await vi.advanceTimersByTimeAsync(250);
    await flush(element);
    expect(button(element, 'Add').disabled).toBe(true);
    expect(element.shadowRoot!.textContent).toContain('Record type fuel no longer exists');
    staleSchema.resolve({ id: 'fuel', name: 'Fuel', fields: [], retention_days: 999 });
    await flush(element);
    expect(button(element, 'Add').disabled).toBe(true);
    expect(element.shadowRoot!.textContent).not.toContain('999 days retention');
    expect(element.shadowRoot!.textContent).toContain('Record type fuel no longer exists');
    expect(source.fetchSummary).toHaveBeenCalledOnce();
  });

  it('refreshes once across the HA-local day/month boundary and cleans up the timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T03:57:30Z'));
    const hass = homeAssistant();
    hass.config.time_zone = 'America/New_York';
    const element = await card({}, hass);
    const source = mock.sources[0];
    await vi.advanceTimersByTimeAsync(120_000);
    expect(source.fetchSummary).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    await flush(element);
    expect(source.fetchSummary).toHaveBeenCalledTimes(2);
    expect(source.invalidate).toHaveBeenCalledOnce();
    expect(source.fetchSummary.mock.lastCall[1]).toBe(source.fetchChart.mock.lastCall[3]);
    expect(source.fetchHistoryPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(source.fetchSummary).toHaveBeenCalledTimes(2);
    element.remove();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(source.fetchSummary).toHaveBeenCalledTimes(2);
  });

  it('does not refresh on UTC midnight when the Home Assistant local date is unchanged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T23:59:30Z'));
    const hass = homeAssistant();
    hass.config.time_zone = 'America/New_York';
    await card({}, hass);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.sources[0].fetchSummary).toHaveBeenCalledOnce();
    expect(mock.sources[0].invalidate).not.toHaveBeenCalled();
  });

  it('keeps an open pending entry and its values through connection loss and replacement', async () => {
    const hass = homeAssistant();
    const element = await card({ vehicles: [{ id: 'car', name: 'Car', fuels: ['petrol'] }] }, hass);
    const pending = deferred<void>();
    const source = mock.sources[0];
    source.addRecord.mockReturnValueOnce(pending.promise);
    button(element, 'Add').click();
    await flush(element);
    const form = element.shadowRoot!.querySelector<AddRecordDialog>('tankrupt-add-dialog')!;
    await flush(form);
    for (const [name, value] of [
      ['quantity', '10'],
      ['amount', '15'],
    ]) {
      const input = form.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    form
      .shadowRoot!.querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(form);
    [...hass.listeners.get('disconnected')!].forEach((callback) => callback());
    await flush(element);
    expect(element.shadowRoot!.querySelector('tankrupt-add-dialog')).toBe(form);
    pending.reject(new Error('Connection dropped'));
    await flush(form);
    expect(form.shadowRoot!.textContent).toContain('may already have been saved');
    expect(form.shadowRoot!.querySelector<HTMLInputElement>('[name="quantity"]')!.value).toBe('10');
    expect(form.shadowRoot!.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(
      true,
    );
    element.hass = homeAssistant();
    await flush(element);
    await flush(form);
    expect(element.shadowRoot!.querySelector('tankrupt-add-dialog')).toBe(form);
    expect(form.shadowRoot!.querySelector<HTMLInputElement>('[name="amount"]')!.value).toBe('15');
    expect(form.shadowRoot!.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(
      false,
    );
    expect(source.addRecord).toHaveBeenCalledOnce();
    expect(mock.sources[1].addRecord).not.toHaveBeenCalled();
  });

  it('preserves delete confirmation through reconnect without enabling an offline delete', async () => {
    const hass = homeAssistant();
    const element = await card({}, hass);
    const dialog = await openHistory(element);
    const recent =
      dialog.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!;
    await flush(recent);
    recent.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click();
    await flush(dialog);
    expect(dialog.shadowRoot!.textContent).toContain('This cannot be undone');
    [...hass.listeners.get('disconnected')!].forEach((callback) => callback());
    await flush(element);
    await flush(dialog);
    expect(dialog.shadowRoot!.querySelector<HTMLButtonElement>('.danger')!.disabled).toBe(true);
    [...hass.listeners.get('ready')!].forEach((callback) => callback());
    await flush(element);
    await flush(dialog);
    expect(dialog.shadowRoot!.textContent).toContain('This cannot be undone');
    expect(dialog.shadowRoot!.querySelector<HTMLButtonElement>('.danger')!.disabled).toBe(false);
  });

  it('does not let a late schema response enable writes after the connection is lost', async () => {
    const pendingSchema = deferred<RecordType>();
    mock.schema = pendingSchema.promise;
    const hass = homeAssistant();
    const element = await card({}, hass);
    [...hass.listeners.get('disconnected')!].forEach((callback) => callback());
    pendingSchema.resolve({ id: 'fuel', name: 'Fuel', fields: [] });
    await flush(element);
    expect(button(element, 'Add').disabled).toBe(true);
    expect(mock.sources[0].fetchSummary).not.toHaveBeenCalled();
    expect(element.shadowRoot!.textContent).toContain('connection lost');
    mock.schema = undefined;
    [...hass.listeners.get('ready')!].forEach((callback) => callback());
    await flush(element);
    expect(button(element, 'Add').disabled).toBe(false);
  });

  it('detects replacement connections even when HA reuses its outer object', async () => {
    const hass = homeAssistant();
    const element = await card({}, hass);
    hass.connection = homeAssistant().connection;
    element.hass = hass;
    await flush(element);
    expect(mock.sources).toHaveLength(2);
    expect(mock.sources[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('ignores stale responses and disposes late subscriptions after config changes', async () => {
    const summary = deferred<Summary>(),
      subscription = deferred<() => void>();
    mock.summary = summary.promise;
    mock.subscription = subscription.promise;
    const element = await card();
    mock.summary = mock.subscription = undefined;
    element.setConfig({ type: 'custom:tankrupt-cr-card', record_type: 'other' });
    await flush(element);
    const unsubscribe = vi.fn();
    subscription.resolve(unsubscribe);
    summary.resolve({
      current: { cost: 9999, quantity: 0, count: 1 },
      previous: { cost: 0, quantity: 0, count: 0 },
      periods: {
        current: { start: '2026-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z' },
        previous: { start: '2025-12-01T00:00:00Z', end: '2026-01-01T00:00:00Z' },
      },
    });
    await flush(element);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(element.shadowRoot!.textContent).toContain('£42.00');
    expect(element.shadowRoot!.textContent).not.toContain('9,999');
  });

  it('unsubscribes on disconnect and resubscribes on remount, reconnect, or connection change', async () => {
    const hass = homeAssistant();
    const element = await card({}, hass);
    const first = mock.sources[0];
    element.remove();
    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(hass.listeners.get('ready')!.size).toBe(0);
    document.body.append(element);
    await flush(element);
    expect(mock.sources).toHaveLength(2);
    [...hass.listeners.get('ready')!].forEach((callback) => callback());
    await flush(element);
    expect(mock.sources).toHaveLength(3);
    element.hass = homeAssistant();
    await flush(element);
    expect(mock.sources).toHaveLength(4);
    expect(mock.sources[2].unsubscribe).toHaveBeenCalledOnce();
  });

  it('debounces external updates and cancels refresh timers when detached', async () => {
    vi.useFakeTimers();
    const element = await card();
    const source = mock.sources[0];
    source.callback();
    source.callback();
    source.callback();
    await vi.advanceTimersByTimeAsync(249);
    expect(source.fetchSummary).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await flush(element);
    expect(source.fetchSummary).toHaveBeenCalledTimes(2);
    expect(source.invalidate).toHaveBeenCalledOnce();
    source.callback();
    element.remove();
    await vi.advanceTimersByTimeAsync(500);
    expect(source.fetchSummary).toHaveBeenCalledTimes(2);
  });

  it('prevents stale filter responses from replacing a newly configured scope', async () => {
    const element = await card();
    const source = mock.sources[0];
    const stale = deferred<Summary>();
    source.fetchSummary.mockReturnValueOnce(stale.promise);
    source.callback();
    await new Promise((resolve) => setTimeout(resolve, 275));
    element.setConfig({
      type: 'custom:tankrupt-cr-card',
      record_type: 'fuel',
      filter: { fuel: 'diesel' },
    });
    await flush(element);
    stale.resolve({
      current: { cost: 9999, quantity: 0, count: 1 },
      previous: { cost: 0, quantity: 0, count: 0 },
      periods: {
        current: { start: '2026-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z' },
        previous: { start: '2025-12-01T00:00:00Z', end: '2026-01-01T00:00:00Z' },
      },
    });
    await flush(element);
    expect(element.shadowRoot!.textContent).toContain('£42.00');
    expect(element.shadowRoot!.textContent).not.toContain('9,999');
  });

  it('refreshes all visible data after confirmed or uncertain saves without automatic retry', async () => {
    const element = await card();
    const source = mock.sources[0];
    button(element, 'Add').click();
    await flush(element);
    const form = element.shadowRoot!.querySelector<AddRecordDialog>('tankrupt-add-dialog')!;
    const record = {
      vehicle_id: 'unassigned',
      fuel_type: 'petrol' as const,
      quantity: 10,
      unit_price: 1,
      total_cost: 10,
      timestamp: '2026-06-12T12:00:00Z',
    };
    await form.save(record);
    await flush(element);
    expect(source.fetchSummary).toHaveBeenCalledTimes(2);
    source.addRecord.mockRejectedValueOnce(new Error('Uncertain response'));
    await expect(form.save(record)).rejects.toThrow('Uncertain response');
    await flush(element);
    expect(source.addRecord).toHaveBeenCalledTimes(2);
    expect(source.fetchHistoryPage).not.toHaveBeenCalled();
  });

  it('refreshes aggregates after deletion but removes the local row without resetting history', async () => {
    const element = await card();
    const source = mock.sources[0];
    const dialog = await openHistory(element);
    const recent =
      dialog.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!;
    await flush(recent);
    recent.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click();
    await flush(dialog);
    dialog.shadowRoot!.querySelector<HTMLButtonElement>('.danger')!.click();
    await flush(element);
    expect(source.deleteRecord).toHaveBeenCalledExactlyOnceWith('r1');
    expect(source.invalidate).toHaveBeenCalledOnce();
    expect(source.fetchSummary).toHaveBeenCalledTimes(2);
    expect(source.fetchChart).toHaveBeenCalledTimes(2);
    expect(source.fetchHistoryPage).toHaveBeenCalledOnce();
    await flush(dialog);
    expect(loaded(dialog)).toEqual([]);
    source.fetchHistoryPage.mockResolvedValueOnce(page(['older']));
    await more(element);
    expect(source.fetchHistoryPage.mock.lastCall[2]).toBe('page-2');
    expect(loaded(dialog).map((record) => record.id)).toEqual(['older']);
  });
});
