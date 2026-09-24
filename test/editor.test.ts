import { afterEach, describe, expect, it, vi } from 'vitest';
import { TankruptCardEditor } from '../src/custom-elements/tankrupt-card-editor';
import type { Hass } from '../src/types';

const hass = (): Hass => ({
  config: { time_zone: 'UTC', currency: 'USD' },
  connection: {
    sendMessagePromise: vi
      .fn()
      .mockResolvedValue({ record_types: [{ id: 'fuel', name: 'Fuel purchases', fields: [] }] }),
    subscribeEvents: vi.fn(),
  },
});
async function flush(element: TankruptCardEditor) {
  await element.updateComplete;
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await element.updateComplete;
}
afterEach(() => document.body.replaceChildren());

describe('visual editor', () => {
  it('discovers record types using the exact API and preserves YAML settings on composed config events', async () => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    element.setConfig({
      type: 'custom:tankrupt-cr-card',
      record_type: 'fuel',
      fields: { total_cost: 'cost' },
      vehicles: [{ id: 'car', name: 'Car', fuels: ['petrol'], unit: 'US_gal' }],
    });
    const changed = vi.fn();
    element.addEventListener('config-changed', changed);
    document.body.append(element);
    await flush(element);
    expect(element.hass.connection.sendMessagePromise).toHaveBeenCalledExactlyOnceWith({
      type: 'custom_records/list_record_types',
    });
    const form = element.shadowRoot!.querySelector('ha-form') as HTMLElement & {
      schema: { name: string; selector?: unknown }[];
      data: Record<string, unknown>;
    };
    expect(JSON.stringify(form.schema)).toContain('Fuel purchases');
    expect(form.data.show_add_button).toBe(true);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            ...form.data,
            title: 'Fuel log',
            graph_periods: '12',
            price_basis: '100',
            show_add_button: false,
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
    const event = changed.mock.calls[0][0] as CustomEvent;
    expect(event.bubbles && event.composed).toBe(true);
    expect(event.detail.config).toMatchObject({
      title: 'Fuel log',
      fields: { total_cost: 'cost' },
      graph: { periods: 12 },
      price_basis: 100,
      show_add_button: false,
      vehicles: [{ unit: 'US_gal' }],
    });
    expect(event.detail.config).not.toHaveProperty('graph_periods');
    expect(event.detail.config).not.toHaveProperty('filter_vehicle');
    expect(event.detail.config).not.toHaveProperty('filter_fuel');
    await flush(element);
    expect(form.data.show_add_button).toBe(false);
    element.setConfig(event.detail.config);
    await flush(element);
    expect(form.data.show_add_button).toBe(false);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, show_add_button: true } },
      }),
    );
    expect(changed.mock.calls[1][0].detail.config.show_add_button).toBe(true);
  });

  it('uses twelve periods, percentage trend and History action labels by default', async () => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    element.setConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel' });
    document.body.append(element);
    await flush(element);
    const form = element.shadowRoot!.querySelector('ha-form') as HTMLElement & {
      data: Record<string, unknown>;
      computeLabel: (field: { name: string }) => string;
      schema: { name: string; selector: { text?: object } }[];
    };
    expect(form.data).toMatchObject({
      graph_periods: '12',
      trend_display: 'percentage',
      filter_vehicle: '',
      filter_fuel: '',
      show_add_button: true,
    });
    expect(form.computeLabel({ name: 'show_recent_records' })).toBe('Show History action');
    expect(form.computeLabel({ name: 'show_add_button' })).toBe('Show Add button');
    expect(form.schema.find((field) => field.name === 'show_add_button')?.selector).toHaveProperty(
      'boolean',
    );
    expect(form.computeLabel({ name: 'recent_limit' })).toBe('History batch size');
    expect(form.schema.find((field) => field.name === 'filter_vehicle')?.selector).toHaveProperty(
      'text',
    );
  });

  it('edits and clears configured filters including manual historic IDs without losing advanced keys', async () => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    element.setConfig({
      type: 'custom:tankrupt-cr-card',
      record_type: 'fuel',
      filter: { vehicle: 'retired_car', fuel: 'petrol' },
      graph: { metric: 'price', periods: 3 },
      fields: { quantity: 'delivered' },
      vehicles: [{ id: 'car', name: 'Car', fuels: ['petrol'], unit: 'imp_gal', price_basis: 100 }],
    });
    const changed = vi.fn();
    element.addEventListener('config-changed', changed);
    document.body.append(element);
    await flush(element);
    const form = element.shadowRoot!.querySelector('ha-form') as HTMLElement & {
      data: Record<string, unknown>;
    };
    expect(form.data.filter_vehicle).toBe('retired_car');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            ...form.data,
            filter_vehicle: 'unassigned',
            filter_fuel: 'electricity',
            trend_display: 'amount',
          },
        },
      }),
    );
    expect(changed.mock.calls[changed.mock.calls.length - 1][0].detail.config).toMatchObject({
      filter: { vehicle: 'unassigned', fuel: 'electricity' },
      trend_display: 'amount',
      graph: { metric: 'price', periods: 3 },
      fields: { quantity: 'delivered' },
      vehicles: [{ unit: 'imp_gal', price_basis: 100 }],
    });
    await flush(element);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: { ...form.data, filter_vehicle: '', filter_fuel: '' },
        },
      }),
    );
    expect(changed.mock.calls[changed.mock.calls.length - 1][0].detail.config.filter).toEqual({});
  });

  it('edits vehicle labels without regenerating IDs and adds structured rows', async () => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    element.setConfig({
      type: 'custom:tankrupt-cr-card',
      record_type: 'fuel',
      vehicles: [{ id: 'stable', name: 'Old', fuels: ['petrol'] }],
    });
    const changed = vi.fn();
    element.addEventListener('config-changed', changed);
    document.body.append(element);
    await flush(element);
    const fields = element.shadowRoot!.querySelectorAll<HTMLInputElement>('fieldset input');
    fields[1].value = 'Renamed';
    fields[1].dispatchEvent(new Event('input'));
    expect(changed.mock.calls[0][0].detail.config.vehicles[0]).toMatchObject({
      id: 'stable',
      name: 'Renamed',
    });
    [...element.shadowRoot!.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Add vehicle')!
      .click();
    await flush(element);
    expect(element.shadowRoot!.querySelectorAll('fieldset')).toHaveLength(2);
    const remove = element.shadowRoot!.querySelector<HTMLButtonElement>('.action-control.danger')!;
    expect(remove.getAttribute('aria-label')).toBe('Remove vehicle Renamed');
    remove.click();
    await flush(element);
    expect(element.shadowRoot!.querySelectorAll('fieldset')).toHaveLength(1);
  });

  it('shows discovery failures instead of swallowing them and can retry', async () => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    vi.mocked(element.hass.connection.sendMessagePromise).mockRejectedValueOnce(
      new Error('Offline'),
    );
    document.body.append(element);
    await flush(element);
    expect(element.shadowRoot!.textContent).toContain('Record-type discovery failed: Offline');
    [...element.shadowRoot!.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Retry discovery')!
      .click();
    await flush(element);
    expect(element.shadowRoot!.textContent).not.toContain('Record-type discovery failed');
  });
});
