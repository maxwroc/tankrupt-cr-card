import { afterEach, describe, expect, it, vi } from 'vitest';
import { YamlState } from '../demo/yaml-state';
import { DemoBackend, fixtures, instant, recordType } from '../demo/backend';
import { DemoDialog, DemoForm, installAdapters, installDialogManager } from '../demo/adapters';
import { HistoryDialog } from '../src/custom-elements/history-dialog';
import { normalizeConfig } from '../src/config';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const original = `# My dashboard
type: custom:tankrupt-cr-card
record_type: fuel_purchases
title: 'Fuel' # keep title note
graph:
  metric: price # keep metric note
  periods: 3
fields:
  total_cost: paid # advanced mapping
vehicles:
  - id: car
    name: Car # keep vehicle note
    fuels: [petrol]
    unit: US_gal # keep unit note
    price_basis: 100
`;

describe('demo YAML state', () => {
  it('preserves nested advanced settings, scalar style and comments through visual edits', () => {
    const state = new YamlState(original);
    expect(state.error).toBe('');
    expect(
      state.update({
        ...state.config!,
        title: 'New title',
        graph: { ...state.config!.graph, periods: 12 },
        vehicles: [{ ...state.config!.vehicles![0], name: 'Renamed' }],
      }),
    ).toBe(true);
    for (const comment of [
      'My dashboard',
      'keep title note',
      'keep metric note',
      'advanced mapping',
      'keep vehicle note',
      'keep unit note',
    ])
      expect(state.text).toContain(`# ${comment}`);
    expect(state.text).toContain("title: 'New title'");
    expect(state.config).toMatchObject({
      fields: { total_cost: 'paid' },
      vehicles: [{ name: 'Renamed', unit: 'US_gal', price_basis: 100 }],
      graph: { metric: 'price', periods: 12 },
    });
  });

  it('keeps invalid YAML verbatim and the last-valid preview until correction, rejecting UI updates', () => {
    const state = new YamlState(original);
    const valid = state.config;
    const draft = `${original}\nfilter: [broken`;
    expect(state.edit(draft)).toBe(false);
    expect(state.text).toBe(draft);
    expect(state.config).toBe(valid);
    expect(state.error).not.toBe('');
    expect(state.update({ ...valid!, title: 'Must not overwrite' })).toBe(false);
    expect(state.text).toBe(draft);
    expect(state.edit(original + '\nfilter:\n  vehicle: retired_car\n')).toBe(true);
    expect(state.config!.filter).toEqual({ vehicle: 'retired_car' });
  });

  it('validates configuration as well as YAML syntax and recovers after a UI validation error', () => {
    const state = new YamlState(original);
    expect(state.edit(original + '\ntrend_display: invalid\n')).toBe(false);
    expect(state.error).toContain('trend_display');
    expect(state.edit(original)).toBe(true);
    expect(state.update({ ...state.config!, billing_start_day: 32 })).toBe(false);
    expect(state.text).toContain('billing_start_day: 32');
    expect(state.config!.billing_start_day).toBeUndefined();
    expect(state.edit(state.text.replace('billing_start_day: 32', 'billing_start_day: 25'))).toBe(
      true,
    );
  });

  it('preserves unknown advanced keys and removes cleared filters without replacing adjacent comments', () => {
    const state = new YamlState(
      original +
        '\nfuture_option: enabled # future setting\nfilter:\n  vehicle: old\n  fuel: petrol\n',
    );
    expect(state.update({ ...state.config!, filter: {} })).toBe(true);
    expect(state.text).toContain('future_option: enabled # future setting');
    expect(state.config!.filter).toEqual({});
  });
});

describe('demo protocol fixtures', () => {
  const base = { record_type: recordType };
  it('retains exactly 650 canonical fixtures, uncapped aggregates, AND filters and the 500 raw cap', async () => {
    const backend = new DemoBackend();
    backend.reset();
    expect(backend.rows).toHaveLength(650);
    const records = (await backend.request({
      ...base,
      type: 'custom_records/list_records',
      limit: 999,
    })) as { records: unknown[] };
    expect(records.records).toHaveLength(500);
    expect(
      await backend.request({
        ...base,
        type: 'custom_records/aggregate_records',
        metrics: [
          { name: 'count', op: 'count' },
          { name: 'cost', op: 'sum', field: 'total_cost' },
        ],
      }),
    ).toEqual({
      values: { count: 650, cost: backend.rows.reduce((sum, row) => sum + row.total_cost, 0) },
      counts: { count: 650, cost: 650 },
    });
    const filtered = (await backend.request({
      ...base,
      type: 'custom_records/list_records',
      filter: [{ fuel_type: '==electricity' }, { vehicle_id: '==electric_car' }],
    })) as { records: Record<string, unknown>[] };
    expect(filtered.records.length).toBeGreaterThan(0);
    expect(
      filtered.records.every(
        (row) => row.fuel_type === 'electricity' && row.vehicle_id === 'electric_car',
      ),
    ).toBe(true);
    await expect(
      backend.request({ ...base, type: 'custom_records/list_records', offset: 1 }),
    ).rejects.toThrow('Unsupported');
  });

  it('uses inclusive microsecond bounds and exact nested write/delete event contracts', async () => {
    const backend = new DemoBackend();
    backend.reset('empty');
    const callback = vi.fn();
    const unsubscribe = await backend.hass.connection.subscribeEvents(
      callback,
      'custom_records_updated',
    );
    const timestamp = '2026-09-01T12:00:00.123456Z';
    const result = (await backend.request({
      ...base,
      type: 'custom_records/add_record',
      timestamp,
      fields: {
        vehicle_id: 'unassigned',
        fuel_type: 'petrol',
        quantity: 10,
        unit_price: 1,
        total_cost: 10,
      },
    })) as { record: { id: string } };
    const request = {
      ...base,
      type: 'custom_records/list_records',
      start: timestamp,
      end: timestamp,
    };
    expect(((await backend.request(request)) as { records: unknown[] }).records).toHaveLength(1);
    expect(
      (
        (await backend.request({ ...request, start: '2026-09-01T12:00:00.123457Z' })) as {
          records: unknown[];
        }
      ).records,
    ).toHaveLength(0);
    expect(instant(timestamp)).toBe(instant('2026-09-01T13:00:00.123456+01:00'));
    await backend.request({
      ...base,
      type: 'custom_records/delete_record',
      record_id: result.record.id,
    });
    await Promise.resolve();
    expect(backend.rows).toHaveLength(0);
    expect(callback).toHaveBeenCalledWith({
      event_type: 'custom_records_updated',
      data: { entry_id: 'synthetic_demo', record_type: recordType },
    });
    unsubscribe();
  });

  it('covers short, zero, equal, empty and failure scenarios', async () => {
    const now = Date.parse('2026-09-21T12:00:00Z');
    expect(fixtures('short', now)).toHaveLength(1);
    expect(fixtures('short', now)[0].total_cost).toBeGreaterThan(0);
    expect(fixtures('zero', now).map((row) => row.total_cost)).toEqual([0, 0, 0]);
    const equal = fixtures('equal', now);
    expect(equal.map((row) => row.total_cost)).toEqual([30, 30, 30]);
    expect(new Set(equal.map((row) => row.timestamp.slice(0, 7))).size).toBe(3);
    expect(fixtures('empty', now)).toEqual([]);
    const backend = new DemoBackend();
    backend.reset('error');
    await expect(backend.request({ type: 'custom_records/list_record_types' })).rejects.toThrow(
      'Synthetic backend failure',
    );
  });
});

describe('demo-only HA adapters', () => {
  it('initializes native selects and emits full form data for text, number, select and boolean', async () => {
    installAdapters();
    const form = new DemoForm();
    form.schema = [
      { name: 'title', selector: { text: {} } },
      { name: 'periods', selector: { number: { min: 1, max: 12 } } },
      {
        name: 'fuel',
        selector: {
          select: {
            options: [
              { value: '', label: 'All' },
              { value: 'petrol', label: 'Petrol' },
            ],
          },
        },
      },
      { name: 'history', selector: { boolean: {} } },
    ];
    form.data = { title: 'Fuel', periods: 12, fuel: 'petrol', history: true, advanced: 'keep' };
    const changed = vi.fn();
    form.addEventListener('value-changed', changed);
    document.body.append(form);
    await form.updateComplete;
    expect(form.shadowRoot!.querySelector('select')!.value).toBe('petrol');
    for (const [index, value] of [
      [0, 'Changed'],
      [1, '3'],
    ] as const) {
      const input = form.shadowRoot!.querySelectorAll('input')[index];
      input.value = value;
      input.dispatchEvent(new Event('change'));
    }
    const checkbox = form.shadowRoot!.querySelector<HTMLInputElement>('[type=checkbox]')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    const events = changed.mock.calls.map(([event]) => event as CustomEvent);
    expect(events[0].detail.value).toMatchObject({ title: 'Changed', advanced: 'keep' });
    expect(events[1].detail.value.periods).toBe(3);
    expect(events[2].detail.value.history).toBe(false);
    expect(events.every((event) => event.bubbles && event.composed)).toBe(true);
  });

  it('opens the native dialog surface and relays Escape/close with HA closed events', async () => {
    installAdapters();
    const dialog = new DemoDialog();
    dialog.headerTitle = 'History';
    dialog.open = true;
    const closed = vi.fn();
    dialog.addEventListener('closed', closed);
    document.body.append(dialog);
    await dialog.updateComplete;
    const surface = dialog.shadowRoot!.querySelector('dialog')!;
    expect(surface.open).toBe(true);
    expect(dialog.shadowRoot!.textContent).toContain('History');
    surface.dispatchEvent(new Event('cancel', { cancelable: true }));
    await dialog.updateComplete;
    expect(surface.open).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
  });

  it('honors HA scrim and Escape actions while keeping the explicit close button available', async () => {
    installAdapters();
    const dialog = new DemoDialog();
    dialog.open = true;
    dialog.preventScrimClose = true;
    dialog.escapeKeyAction = '';
    document.body.append(dialog);
    await dialog.updateComplete;
    const surface = dialog.shadowRoot!.querySelector('dialog')!;
    surface.dispatchEvent(new Event('cancel', { cancelable: true }));
    surface.dispatchEvent(new MouseEvent('click', { clientX: -10, clientY: -10 }));
    expect(dialog.open).toBe(true);
    dialog.preventScrimClose = false;
    dialog.scrimClickAction = '';
    surface.dispatchEvent(new MouseEvent('click', { clientX: -10, clientY: -10 }));
    expect(dialog.open).toBe(true);
    dialog.scrimClickAction = 'close';
    surface.dispatchEvent(new MouseEvent('click', { clientX: -10, clientY: -10 }));
    await dialog.updateComplete;
    expect(surface.open).toBe(false);
  });

  it('manages the real History component contract outside the card and restores focus', async () => {
    installAdapters();
    // Keep the real element registration even if a compiler erases type-only use.
    expect(HistoryDialog).toBeDefined();
    const backend = new DemoBackend();
    const dispose = installDialogManager(backend.hass);
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const ready = vi.fn();
    const closed = vi.fn();
    const params = {
      state: {
        config: normalizeConfig({ type: 'custom:tankrupt-cr-card', record_type: recordType }),
        hass: backend.hass,
        loading: false,
        pageLoading: false,
        hasMore: false,
        restartRequired: false,
        error: '',
        availabilityMessage: '',
        available: true,
      },
      isActive: () => true,
      onReady: ready,
      onClosed: closed,
      retry: vi.fn(),
      loadMore: vi.fn(),
      restart: vi.fn(),
      deleteRecord: vi.fn(),
    };
    document.body.dispatchEvent(
      new CustomEvent('show-dialog', {
        detail: {
          dialogTag: 'tankrupt-history-dialog',
          dialogImport: async () => {},
          dialogParams: params,
        },
      }),
    );
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const dialog = document.body.querySelector('tankrupt-history-dialog') as HistoryDialog;
    expect(dialog).not.toBeNull();
    expect(ready).toHaveBeenCalledWith(dialog);
    await dialog.updateComplete;
    const surface = dialog.shadowRoot!.querySelector('ha-dialog') as DemoDialog;
    await surface.updateComplete;
    expect(surface.shadowRoot!.querySelector('dialog')!.open).toBe(true);
    expect(
      surface.shadowRoot!.querySelector<HTMLSlotElement>('slot[name=footer]')!.assignedElements(),
    ).toHaveLength(1);
    surface.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click();
    expect(closed).toHaveBeenCalledOnce();
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(opener);
    dispose();
  });
});
