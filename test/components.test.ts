import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeConfig } from '../src/config';
import { AddRecordDialog } from '../src/custom-elements/add-record-dialog';
import { RecentRecordsElement } from '../src/custom-elements/recent-records';
import { FuelChart } from '../src/custom-elements/fuel-chart';
import type { CardConfig, ChartPoint, Hass, Transaction, Vehicle } from '../src/types';

const hass: Hass = {
  config: { time_zone: 'Europe/London', currency: 'GBP' },
  locale: { language: 'en-GB' },
  connection: { sendMessagePromise: vi.fn(), subscribeEvents: vi.fn() },
};
const transaction: Transaction = {
  id: 'r-1',
  timestamp: '2026-06-12T12:00:00Z',
  vehicle_id: 'retired',
  vehicle_name: 'Old car',
  fuel_type: 'petrol',
  quantity: 10,
  unit_price: 1.5,
  total_cost: 15,
};
const car: Vehicle = { id: 'car', name: 'My car', fuels: ['petrol'] };
const hybrid: Vehicle = { id: 'hybrid', name: 'Hybrid', fuels: ['petrol', 'electricity'] };
const config = (extra: Partial<CardConfig> = {}) =>
  normalizeConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel_purchases', ...extra });
async function flush(element: { updateComplete: Promise<boolean> }) {
  await element.updateComplete;
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await element.updateComplete;
}
async function dialog(vehicles: Vehicle[] = [], extra: Partial<CardConfig> = {}) {
  const element = new AddRecordDialog();
  element.config = config({ vehicles, ...extra });
  element.hass = hass;
  element.save = vi.fn().mockResolvedValue(undefined);
  document.body.append(element);
  await flush(element);
  return element;
}
function button(element: Element, text: string): HTMLButtonElement {
  return [...element.shadowRoot!.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  )!;
}
async function input(element: AddRecordDialog, name: string, value: string) {
  const field = element.shadowRoot!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await flush(element);
}
async function submit(element: AddRecordDialog) {
  element
    .shadowRoot!.querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush(element);
}
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('transaction entry', () => {
  it.each(['quantity_total', 'quantity_price'] as const)(
    'toggles %s in the fallback menu without changing the configured default or other values',
    async (mode) => {
      const element = await dialog([car], { input_mode: mode });
      const quantity = element.shadowRoot!.querySelector<HTMLInputElement>('[name="quantity"]')!;
      expect(element.shadowRoot!.activeElement).toBe(quantity);
      await input(element, 'quantity', '10');
      await input(element, 'amount', '15');
      await input(element, 'timestamp', '2026-06-12T13:00');
      const menu = element.shadowRoot!.querySelector('details')!;
      const toggle = button(element, 'Switch entry mode');
      expect(menu.querySelector('summary .fallback-icon')?.textContent).toBe('\u22ee');
      expect(menu.querySelector('ha-icon, svg')).toBeNull();
      expect(element.shadowRoot!.querySelector('select, ha-select')).toBeNull();
      expect(element.shadowRoot!.querySelector('.purchase-values [name="quantity"]')).toBe(
        quantity,
      );
      expect(
        element.shadowRoot!.querySelector('.transaction-date [name="timestamp"]'),
      ).not.toBeNull();
      menu.open = true;
      toggle.click();
      await flush(element);
      expect(menu.open).toBe(false);
      expect(element.shadowRoot!.activeElement).toBe(menu.querySelector('summary'));
      expect(quantity.value).toBe('10');
      expect(element.shadowRoot!.querySelector<HTMLInputElement>('[name="timestamp"]')!.value).toBe(
        '2026-06-12T13:00',
      );
      expect(element.shadowRoot!.querySelector<HTMLInputElement>('[name="amount"]')!.value).toBe(
        '',
      );
      expect(element.shadowRoot!.querySelector('.preview')!.textContent).toContain(
        'Enter both values',
      );
      expect(
        element.shadowRoot!.querySelector('[name="amount"]')!.parentElement!.textContent,
      ).toContain(mode === 'quantity_total' ? 'Unit price' : 'Total paid');
      await input(element, 'amount', '5');
      menu.open = true;
      toggle.click();
      await flush(element);
      expect(
        element.shadowRoot!.querySelector('[name="amount"]')!.parentElement!.textContent,
      ).toContain(mode === 'quantity_total' ? 'Total paid' : 'Unit price');
      expect(element.config.input_mode).toBe(mode);
      expect(element.save).not.toHaveBeenCalled();
      element.remove();
      const reopened = await dialog([car], { input_mode: mode });
      expect(
        reopened.shadowRoot!.querySelector('[name="amount"]')!.parentElement!.textContent,
      ).toContain(mode === 'quantity_total' ? 'Total paid' : 'Unit price');
    },
  );

  it('dismisses the fallback menu before the dialog and skips its hidden item in Tab order', async () => {
    const element = await dialog([car]);
    const close = vi.fn();
    element.addEventListener('dialog-close', close);
    const menu = element.shadowRoot!.querySelector('details')!;
    const summary = menu.querySelector('summary')!;
    summary.focus();
    summary.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(element.shadowRoot!.activeElement).toBe(button(element, 'Save transaction'));
    menu.open = true;
    const toggle = button(element, 'Switch entry mode');
    toggle.focus();
    toggle.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(menu.open).toBe(false);
    expect(element.shadowRoot!.activeElement).toBe(summary);
    expect(close).not.toHaveBeenCalled();
    summary.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('places Back first in the footer and returns to vehicle selection without saving', async () => {
    const element = await dialog([car, hybrid]);
    expect(element.shadowRoot!.querySelector('.mode-menu')).toBeNull();
    button(element, '🚘 My car').click();
    await flush(element);
    await input(element, 'quantity', '10');
    await input(element, 'amount', '15');
    const back = button(element, 'Back');
    const actions = element.shadowRoot!.querySelector('form .actions')!;
    expect([...actions.querySelectorAll('button')].map((item) => item.textContent?.trim())).toEqual(
      ['Back', 'Cancel', 'Save transaction'],
    );
    expect(back.type).toBe('button');
    expect(back.classList.contains('back')).toBe(true);
    expect(element.shadowRoot!.textContent).not.toContain('Change selection');
    back.click();
    await flush(element);
    expect(element.shadowRoot!.querySelector('form')).toBeNull();
    expect(element.shadowRoot!.querySelector('.mode-menu')).toBeNull();
    expect(element.shadowRoot!.activeElement).toBe(button(element, '🚘 My car'));
    expect(element.save).not.toHaveBeenCalled();
    button(element, '🚘 My car').click();
    await flush(element);
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('[name="quantity"]')!.value).toBe(
      '',
    );
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('[name="amount"]')!.value).toBe('');
  });

  it('shows Back for fuel selection, hides it for a single-fuel car, and disables it during saving', async () => {
    const single = await dialog([car]);
    expect(button(single, 'Back')).toBeUndefined();
    single.remove();
    const element = await dialog([hybrid]);
    button(element, 'Electricity').click();
    await flush(element);
    button(element, 'Back').click();
    await flush(element);
    expect(button(element, 'Electricity')).toBeTruthy();
    button(element, 'Electricity').click();
    await flush(element);
    await input(element, 'quantity', '10');
    await input(element, 'amount', '15');
    let finish!: () => void;
    element.save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await submit(element);
    expect(button(element, 'Back').disabled).toBe(true);
    expect(button(element, 'Switch entry mode').disabled).toBe(true);
    const menu = element.shadowRoot!.querySelector('details')!;
    menu.querySelector('summary')!.click();
    expect(menu.open).toBe(false);
    button(element, 'Back').click();
    expect(element.shadowRoot!.querySelector('form')).not.toBeNull();
    finish();
    await flush(element);
  });

  it('offers fuels without cars, skips a single-fuel car, and asks a hybrid for fuel', async () => {
    const noCars = await dialog();
    expect(button(noCars, 'Petrol / unleaded')).toBeTruthy();
    expect(button(noCars, 'Diesel')).toBeTruthy();
    expect(button(noCars, 'Electricity')).toBeTruthy();
    noCars.remove();
    const single = await dialog([car]);
    expect(single.shadowRoot!.querySelector('input[name="quantity"]')).toBeTruthy();
    single.remove();
    const multiFuel = await dialog([hybrid]);
    expect(multiFuel.shadowRoot!.querySelector('form')).toBeNull();
    button(multiFuel, 'Electricity').click();
    await flush(multiFuel);
    expect(multiFuel.shadowRoot!.textContent).toContain('Quantity (kWh)');
  });

  it('chooses cars by stable ID and falls back when an image fails', async () => {
    const element = await dialog([{ ...car, image: '/missing.jpg' }, hybrid]);
    const image = element.shadowRoot!.querySelector('img')!;
    image.dispatchEvent(new Event('error'));
    await flush(element);
    expect(element.shadowRoot!.querySelector('img')).toBeNull();
    button(element, '🚘 My car').click();
    await flush(element);
    await input(element, 'quantity', '10');
    await input(element, 'amount', '15');
    await input(element, 'timestamp', '2026-06-12T13:00');
    await submit(element);
    expect(element.save).toHaveBeenCalledWith({
      ...transaction,
      id: undefined,
      vehicle_id: 'car',
      vehicle_name: 'My car',
      timestamp: '2026-06-12T12:00:00.000000Z',
    });
  });

  it('previews per-100 pricing, clears amount on mode change, and accepts free charging', async () => {
    const element = await dialog([{ ...car, fuels: ['electricity'] }], {
      input_mode: 'quantity_price',
      price_basis: 100,
    });
    await input(element, 'quantity', '25');
    await input(element, 'amount', '30');
    expect(element.shadowRoot!.textContent).toContain('£7.50');
    expect(element.shadowRoot!.querySelector('select')).toBeNull();
    const menu = element.shadowRoot!.querySelector('details')!;
    menu.open = true;
    button(element, 'Switch entry mode').click();
    await flush(element);
    expect(menu.open).toBe(false);
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('[name="amount"]')!.value).toBe('');
    await input(element, 'amount', '0');
    await submit(element);
    expect(element.save).toHaveBeenCalledWith(
      expect.objectContaining({ total_cost: 0, unit_price: 0, fuel_type: 'electricity' }),
    );
  });

  it('keeps values on uncertain write failure and prevents duplicate submits', async () => {
    const element = await dialog([car]);
    let reject!: (reason: Error) => void;
    element.save = vi.fn(
      () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    await input(element, 'quantity', '10');
    await input(element, 'amount', '15');
    await submit(element);
    await submit(element);
    expect(element.save).toHaveBeenCalledTimes(1);
    expect(button(element, 'Saving…').disabled).toBe(true);
    reject(new Error('Connection lost'));
    await flush(element);
    expect(element.shadowRoot!.textContent).toContain('may already have been saved');
    expect(element.shadowRoot!.querySelector<HTMLInputElement>('[name="quantity"]')!.value).toBe(
      '10',
    );
    expect(button(element, 'Save transaction').disabled).toBe(false);
  });

  it('validates numbers and rejects ambiguous HA-zone times without submitting', async () => {
    const element = await dialog([car]);
    await input(element, 'quantity', '0');
    await input(element, 'amount', '15');
    await submit(element);
    expect(element.shadowRoot!.textContent).toContain('Quantity must be greater');
    await input(element, 'quantity', '10');
    await input(element, 'timestamp', '2026-10-25T01:30');
    await submit(element);
    expect(element.shadowRoot!.textContent).toContain('unambiguous local date/time');
    expect(element.save).not.toHaveBeenCalled();
  });

  it('traps keyboard focus, closes on Escape, and restores the trigger', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const element = await dialog([car]);
    const buttons = element.shadowRoot!.querySelectorAll('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    last.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true, cancelable: true }),
    );
    expect(element.shadowRoot!.activeElement).toBe(element.shadowRoot!.querySelector('summary'));
    const close = vi.fn(() => element.remove());
    element.addEventListener('dialog-close', close);
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('recent record rows', () => {
  it('shows historical vehicles without count boilerplate or a nested modal', async () => {
    const element = new RecentRecordsElement();
    element.config = config();
    element.hass = hass;
    element.data = { records: [transaction] };
    document.body.append(element);
    await flush(element);
    expect(element.shadowRoot!.querySelector('section > p')).toBeNull();
    expect(element.shadowRoot!.textContent).toContain('Old car');
    const requested = vi.fn();
    element.addEventListener('request-delete', requested);
    button(element, 'Delete').click();
    await flush(element);
    expect(requested).toHaveBeenCalledOnce();
    const event = requested.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ record: transaction, description: expect.any(String) });
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(element.shadowRoot!.querySelector('tankrupt-delete-dialog')).toBeNull();
    expect(element.shadowRoot!.querySelector('[role="dialog"]')).toBeNull();
    element.available = false;
    await flush(element);
    expect(button(element, 'Delete').disabled).toBe(true);
    button(element, 'Delete').click();
    expect(requested).toHaveBeenCalledOnce();
  });
});

describe('accessible dimensional charts', () => {
  it('renders separate fuel panels, unit labels, and accessible weighted-price details', async () => {
    const element = new FuelChart();
    element.config = config();
    element.hass = hass;
    element.metric = 'price';
    element.series = [
      {
        id: 'petrol',
        label: 'Petrol',
        fuel: 'petrol',
        points: [
          {
            start: transaction.timestamp,
            end: transaction.timestamp,
            totals: { count: 2, quantity: 10, cost: 20 },
          },
        ],
      },
      {
        id: 'electricity',
        label: 'Electricity',
        fuel: 'electricity',
        points: [
          {
            start: transaction.timestamp,
            end: transaction.timestamp,
            totals: { count: 1, quantity: 20, cost: 5 },
          },
          {
            start: transaction.timestamp,
            end: transaction.timestamp,
            totals: { count: 0, quantity: 0, cost: 0 },
          },
        ],
      },
    ];
    document.body.append(element);
    await flush(element);
    expect(element.shadowRoot!.querySelectorAll('figure')).toHaveLength(2);
    expect(element.shadowRoot!.textContent).toContain('GBP / 1 L');
    expect(element.shadowRoot!.textContent).toContain('GBP / 1 kWh');
    const points = element.shadowRoot!.querySelectorAll('.point');
    expect(points).toHaveLength(2);
    expect(points[0].getAttribute('aria-label')).toContain('2 GBP / 1 L');
    points[1].dispatchEvent(new Event('focus'));
    await flush(element);
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(
      '0.25 GBP / 1 kWh',
    );
    points[1].dispatchEvent(new Event('blur'));
    await flush(element);
    expect(element.shadowRoot!.querySelector('[role="status"]')).toBeNull();
  });

  const bucket = (cost: number, count = 1): ChartPoint => ({
    start: transaction.timestamp,
    end: transaction.timestamp,
    totals: { cost, count, quantity: count ? 10 : 0 },
  });

  async function chart(points: ChartPoint[]) {
    const element = new FuelChart();
    element.config = config();
    element.hass = hass;
    element.series = [{ id: 'all', label: 'All fuels', points }];
    document.body.append(element);
    await flush(element);
    return element;
  }

  it('keeps a single current-period bar at the right edge without drawing empty buckets', async () => {
    const element = await chart([...Array.from({ length: 11 }, () => bucket(0, 0)), bucket(100)]);
    const bars = element.shadowRoot!.querySelectorAll('rect.mark');
    expect(bars).toHaveLength(1);
    expect(Number(bars[0].getAttribute('x'))).toBeGreaterThan(330);
    expect(element.shadowRoot!.querySelector('desc')!.textContent).toContain('Truncated baseline');
    expect(element.shadowRoot!.querySelector('[role="status"]')).toBeNull();
  });

  it('preserves real zero-cost records but not empty periods', async () => {
    const element = await chart([bucket(0, 0), bucket(0), bucket(20)]);
    const bars = element.shadowRoot!.querySelectorAll('rect.mark');
    expect(bars).toHaveLength(2);
    expect(bars[0].getAttribute('height')).toBe('2');
    expect(element.shadowRoot!.querySelectorAll('.point')[0].getAttribute('aria-label')).toContain(
      '£0.00',
    );
    expect(element.shadowRoot!.querySelector('desc')!.textContent).not.toContain(
      'Truncated baseline',
    );
  });

  it('supports tap and keyboard detail dismissal without reserving card height', async () => {
    const element = await chart([bucket(100), bucket(110)]);
    const point = element.shadowRoot!.querySelector('.point')!;
    point.dispatchEvent(new Event('click'));
    point.dispatchEvent(new Event('pointerleave'));
    await flush(element);
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain('£100.00');
    expect(element.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe(
      '12 Jun 2026 – 12 Jun 2026\n£100.00',
    );
    expect(point.querySelector('title')!.textContent).toBe('12 Jun 2026 – 12 Jun 2026\n£100.00');
    expect(point.getAttribute('aria-label')).toContain('1 transactions');
    point.dispatchEvent(new Event('click'));
    await flush(element);
    expect(element.shadowRoot!.querySelector('[role="status"]')).toBeNull();
    point.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush(element);
    expect(element.shadowRoot!.querySelector('[role="status"]')).not.toBeNull();
    point.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush(element);
    expect(element.shadowRoot!.querySelector('[role="status"]')).toBeNull();
  });

  it('omits the redundant spending caption and labels every nice tick grid line', async () => {
    const element = await chart([bucket(100), bucket(110)]);
    expect(element.shadowRoot!.querySelector('figcaption')).toBeNull();
    expect(
      [...element.shadowRoot!.querySelectorAll('.axis span')].map((label) => label.textContent),
    ).toEqual(['£120', '£110', '£100', '£90']);
    expect(element.shadowRoot!.querySelectorAll('.grid')).toHaveLength(4);
  });

  it('omits empty fuel panels and clears details when the data changes', async () => {
    const element = await chart([bucket(100)]);
    element.series = [
      ...element.series,
      { id: 'diesel', label: 'Diesel', fuel: 'diesel', points: [bucket(0, 0)] },
    ];
    await flush(element);
    expect(element.shadowRoot!.querySelectorAll('figure')).toHaveLength(1);
    element.shadowRoot!.querySelector('.point')!.dispatchEvent(new Event('click'));
    await flush(element);
    expect(element.shadowRoot!.querySelector('[role="status"]')).not.toBeNull();
    element.series = [{ id: 'all', label: 'All fuels', points: [bucket(0, 0)] }];
    await flush(element);
    expect(element.shadowRoot!.textContent).toContain('No transactions');
    expect(element.shadowRoot!.querySelector('[role="status"]')).toBeNull();
  });
});
