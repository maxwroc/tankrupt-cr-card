import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { TankruptCardEditor } from '../src/custom-elements/tankrupt-card-editor';
import { TankruptCard } from '../src/custom-elements/tankrupt-cr-card';
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
  it('does not preselect the only discovered record type for a new card', async () => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    element.setConfig(TankruptCard.getStubConfig());
    const changed = vi.fn();
    element.addEventListener('config-changed', changed);
    document.body.append(element);
    await flush(element);
    const form = element.shadowRoot!.querySelector('ha-form') as HTMLElement & {
      data: Record<string, unknown>;
      schema: { name: string; selector: { select: { options: unknown[] } } }[];
    };
    expect(element.hass.connection.sendMessagePromise).toHaveBeenCalledExactlyOnceWith({
      type: 'custom_records/list_record_types',
    });
    expect(form.schema[0].selector.select.options).toHaveLength(1);
    expect(form.schema.map((field) => field.name)).toEqual(['record_type']);
    expect(form.data.record_type).toBe('');
    expect(element.shadowRoot!.querySelector('.record-setup')).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('shows only record setup when the record type is %j', async (recordType) => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    element.setConfig({
      type: 'custom:tankrupt-cr-card',
      record_type: recordType,
      title: 'Saved title',
      vehicles: [{ id: 'car', name: 'Car', fuels: ['petrol'] }],
    });
    document.body.append(element);
    await flush(element);
    const form = element.shadowRoot!.querySelector('ha-form') as HTMLElement & {
      schema: { name: string }[];
    };
    expect(form.schema.map((field) => field.name)).toEqual(['record_type']);
    expect(element.shadowRoot!.querySelectorAll('ha-form')).toHaveLength(1);
    expect(element.shadowRoot!.querySelector('fieldset')).toBeNull();
    expect(element.shadowRoot!.textContent).not.toContain('Add vehicle');
    expect(element.shadowRoot!.querySelector('.error')).toBeNull();
    const setup = element.shadowRoot!.querySelector('.record-setup')!;
    expect(setup.querySelector('h2')).toBeNull();
    expect(setup.hasAttribute('aria-labelledby')).toBe(false);
    expect(setup.textContent).not.toContain('Fuel purchases');
    expect(setup.textContent).toContain('pick a name');
    expect(setup.textContent).toContain('dropdown above');
    expect(TankruptCardEditor.styles.map((style) => style.cssText).join('\n')).toMatch(
      /\.record-setup\s*\{\s*margin-block-start:\s*24px;/,
    );
    expect(setup.querySelector('a')?.getAttribute('href')).toBe(
      '/config/integrations/integration/custom_records',
    );
    expect(setup.textContent).toContain('Field definition');
    expect(parse(setup.querySelector('code')!.textContent!)).toEqual({
      fields: [
        { key: 'vehicle_id', label: 'Vehicle ID', type: 'text', required: true },
        { key: 'fuel_type', label: 'Fuel type', type: 'text', required: true },
        { key: 'quantity', label: 'Quantity', type: 'number', required: true },
        { key: 'unit_price', label: 'Unit price', type: 'number', required: true },
        { key: 'total_cost', label: 'Total cost', type: 'number', required: true },
        { key: 'vehicle_name', label: 'Vehicle name', type: 'text', required: false },
      ],
    });
  });

  it('hides setup on selection and restores it on clearing without losing configured options', async () => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    const vehicles = [
      { id: 'car', name: 'Car', fuels: ['petrol' as const], unit: 'US_gal' as const },
    ];
    element.setConfig({
      type: 'custom:tankrupt-cr-card',
      record_type: '',
      title: 'Saved title',
      vehicles,
      fields: { total_cost: 'cost' },
      filter: { vehicle: 'car', fuel: 'petrol' },
      graph: { periods: 3, metric: 'price' },
    });
    const changed = vi.fn();
    element.addEventListener('config-changed', changed);
    document.body.append(element);
    await flush(element);
    const form = element.shadowRoot!.querySelector('ha-form') as HTMLElement & {
      data: Record<string, unknown>;
      schema: { name: string }[];
    };
    const select = async (recordType: string | undefined) => {
      form.dispatchEvent(
        new CustomEvent('value-changed', {
          detail: { value: { ...form.data, record_type: recordType } },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(element);
    };
    await select('fuel');
    expect(element.shadowRoot!.querySelector('.record-setup')).toBeNull();
    expect(element.shadowRoot!.querySelector('pre')).toBeNull();
    expect(form.schema.map((field) => field.name)).toContain('title');
    expect(element.shadowRoot!.querySelector('fieldset')).not.toBeNull();
    await select(undefined);
    expect(form.schema.map((field) => field.name)).toEqual(['record_type']);
    expect(element.shadowRoot!.querySelector('.record-setup')).not.toBeNull();
    expect(element.shadowRoot!.querySelector('fieldset')).toBeNull();
    await select('fuel');
    expect(element.shadowRoot!.querySelector('.record-setup')).toBeNull();
    expect(changed.mock.lastCall![0].detail.config).toMatchObject({
      record_type: 'fuel',
      title: 'Saved title',
      vehicles,
      fields: { total_cost: 'cost' },
      filter: { vehicle: 'car', fuel: 'petrol' },
      graph: { periods: 3, metric: 'price' },
    });
  });

  it('refreshes record types after setup and retains manual entry when none are found', async () => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    vi.mocked(element.hass.connection.sendMessagePromise).mockResolvedValueOnce({
      record_types: [],
    });
    document.body.append(element);
    await flush(element);
    const form = element.shadowRoot!.querySelector('ha-form') as HTMLElement & {
      schema: { name: string; selector: object }[];
    };
    expect(form.schema).toEqual([{ name: 'record_type', required: true, selector: { text: {} } }]);
    [...element.shadowRoot!.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Refresh record types')!
      .click();
    await flush(element);
    expect(element.hass.connection.sendMessagePromise).toHaveBeenCalledTimes(2);
    expect(form.schema.map((field) => field.name)).toEqual(['record_type']);
    expect(form.schema[0].selector).toHaveProperty('select');
    expect(element.shadowRoot!.querySelector('.record-setup')).not.toBeNull();
  });

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
    expect(form.schema.find((field) => field.name === 'filter_vehicle')).toBeUndefined();
  });

  it('shows the vehicle filter only while vehicles are configured, preserving existing filters', async () => {
    const element = new TankruptCardEditor();
    element.hass = hass();
    element.setConfig({
      type: 'custom:tankrupt-cr-card',
      record_type: 'fuel',
      vehicles: [],
      filter: { vehicle: 'retired_car', fuel: 'petrol' },
    });
    const changed = vi.fn();
    element.addEventListener('config-changed', changed);
    document.body.append(element);
    await flush(element);
    const form = element.shadowRoot!.querySelector('ha-form') as HTMLElement & {
      data: Record<string, unknown>;
      schema: { name: string; selector: object }[];
    };
    expect(form.schema.find((field) => field.name === 'filter_vehicle')).toBeUndefined();
    expect(form.schema.find((field) => field.name === 'filter_fuel')).toBeDefined();
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...form.data, title: 'Updated' } },
      }),
    );
    expect(changed.mock.lastCall![0].detail.config.filter.vehicle).toBe('retired_car');
    [...element.shadowRoot!.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Add vehicle')!
      .click();
    await flush(element);
    expect(form.schema.find((field) => field.name === 'filter_vehicle')?.selector).toEqual({
      text: {},
    });
    expect(form.data.filter_vehicle).toBe('retired_car');
    element.shadowRoot!.querySelector<HTMLButtonElement>('fieldset .danger')!.click();
    await flush(element);
    expect(form.schema.find((field) => field.name === 'filter_vehicle')).toBeUndefined();
    expect(changed.mock.lastCall![0].detail.config.filter.vehicle).toBe('retired_car');
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
      vehicles: [
        { id: 'stable', name: 'Old', fuels: ['petrol'], unit: 'US_gal', price_basis: 100 },
      ],
    });
    const changed = vi.fn();
    element.addEventListener('config-changed', changed);
    document.body.append(element);
    await flush(element);
    const vehicleForm = element.shadowRoot!.querySelector('fieldset ha-form') as HTMLElement & {
      data: Record<string, unknown>;
      schema: { name: string; selector: object }[];
      computeLabel: (field: { name: string }) => string;
    };
    expect(element.shadowRoot!.querySelector('fieldset input')).toBeNull();
    expect(vehicleForm.computeLabel({ name: 'id' })).toBe('Stable ID');
    expect(vehicleForm.schema.find((field) => field.name === 'petrol')?.selector).toEqual({
      boolean: {},
    });
    vehicleForm.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: { ...vehicleForm.data, name: 'Renamed', image: '/car.png', electricity: true },
        },
        bubbles: true,
        composed: true,
      }),
    );
    expect(changed.mock.calls[0][0].detail.config.vehicles[0]).toMatchObject({
      id: 'stable',
      name: 'Renamed',
      fuels: ['petrol', 'electricity'],
      image: '/car.png',
      unit: 'US_gal',
      price_basis: 100,
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
