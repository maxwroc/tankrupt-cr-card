import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { basisFor, currencyFor, normalizeConfig, unitFor } from '../src/config';
import {
  billingPeriods,
  chartRanges,
  localDateTime,
  transactionTimestamp,
} from '../src/logic/billing-period';
import { deriveTransaction, type TransactionInput } from '../src/logic/transaction';
import { displayPrice, displayQuantity, parseDecimal } from '../src/logic/units';
import { metricValue, spendingTrend } from '../src/logic/stats';
import type { Hass, PeriodCount } from '../src/types';

const config = () =>
  normalizeConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel_purchases' });
const input = (overrides: Partial<TransactionInput> = {}): TransactionInput => ({
  fuel: 'petrol',
  quantity: '10',
  amount: '15',
  mode: 'quantity_total',
  unit: 'L',
  basis: 1,
  currency: 'GBP',
  ...overrides,
});

describe('configuration', () => {
  it('has deliberate defaults and canonical mappings', () => {
    expect(config()).toMatchObject({
      billing_start_day: 1,
      input_mode: 'quantity_total',
      liquid_unit: 'L',
      price_basis: 1,
      recent_limit: 20,
      vehicles: [],
      graph: { metric: 'spending', periods: 12 },
      filter: {},
      trend_display: 'percentage',
      show_add_button: true,
    });
    expect(Object.keys(config().fields)).not.toContain('currency');
  });

  it.each([true, false])('accepts Add button visibility: %s', (show_add_button) => {
    expect(normalizeConfig({ ...config(), show_add_button }).show_add_button).toBe(show_add_button);
  });

  it.each([
    { record_type: '' },
    { billing_start_day: 0 },
    { billing_start_day: 32 },
    { billing_start_day: 1.5 },
    { recent_limit: 501 },
    { currency: 'pounds' },
    { trend_display: 'both' },
    { show_add_button: 'false' },
    { show_add_button: null },
    { show_add_button: 0 },
    { filter: null },
    { filter: [] },
    { filter: { vehicle: '' } },
    { filter: { vehicle: 'Invalid ID' } },
    { filter: { fuel: 'all' } },
    { filter: { vehicles: ['car'] } },
    { vehicles: [{ id: 'unassigned', name: 'Car', fuels: ['petrol'] }] },
    { vehicles: [{ id: 'car', name: '', fuels: ['petrol'] }] },
    { vehicles: [{ id: 'car', name: 'Car', fuels: [] }] },
    { vehicles: [{ id: 'car', name: 'Car', fuels: ['diesel'], unit: 'kWh' }] },
    { vehicles: [{ id: 'car', name: 'Car', fuels: ['electricity'], unit: 'L' }] },
    { fields: { quantity: 'total_cost' } },
    { fields: { total_cost: 'timestamp' } },
    { fields: { total_cost: 'Cost' } },
    { vehicles: [{ id: 'car', name: 'Car', fuels: ['petrol'], image: 'javascript:alert(1)' }] },
  ])('rejects invalid runtime YAML: %j', (override) => {
    expect(() =>
      normalizeConfig({ ...config(), ...override } as Parameters<typeof normalizeConfig>[0]),
    ).toThrow();
  });

  it('rejects duplicate vehicle IDs', () => {
    const car = { id: 'car', name: 'Car', fuels: ['diesel'] as const };
    expect(() =>
      normalizeConfig({
        ...config(),
        vehicles: [
          { ...car, fuels: [...car.fuels] },
          { ...car, fuels: [...car.fuels] },
        ],
      }),
    ).toThrow('unique');
  });

  it.each(['retired_car', 'unassigned'])(
    'accepts a stored vehicle filter %s without configured cars',
    (vehicle) => {
      expect(
        normalizeConfig({
          ...config(),
          filter: { vehicle, fuel: 'electricity' },
          trend_display: 'amount',
          graph: { metric: 'quantity', periods: 3 },
        }),
      ).toMatchObject({
        filter: { vehicle, fuel: 'electricity' },
        trend_display: 'amount',
        graph: { metric: 'quantity', periods: 3 },
      });
    },
  );

  it('uses HA currency unless explicitly overridden; never guesses', () => {
    const hass = { config: { currency: 'GBP' } } as Hass;
    expect(currencyFor(config(), hass)).toBe('GBP');
    expect(currencyFor({ ...config(), currency: 'EUR' }, hass)).toBe('EUR');
    expect(() => currencyFor(config(), { config: {} } as Hass)).toThrow('currency');
  });

  it('keeps hybrid electric and liquid units distinct', () => {
    const cfg = normalizeConfig({
      ...config(),
      vehicles: [
        {
          id: 'hybrid',
          name: 'Hybrid',
          fuels: ['petrol', 'electricity'],
          unit: 'US_gal',
          price_basis: 100,
        },
      ],
    });
    expect(unitFor(cfg, 'petrol', 'hybrid')).toBe('US_gal');
    expect(unitFor(cfg, 'electricity', 'hybrid')).toBe('kWh');
    expect(basisFor(cfg, 'hybrid')).toBe(100);
  });
});

describe('billing calendar', () => {
  it('uses current-to-date versus the entire preceding billing month', () => {
    expect(billingPeriods('2026-09-20T12:00:00Z', 'Europe/London', 1)).toEqual({
      current: { start: '2026-08-31T23:00:00.000000Z', end: '2026-09-20T12:00:00.000000Z' },
      previous: { start: '2026-07-31T23:00:00.000000Z', end: '2026-08-31T22:59:59.999999Z' },
    });
  });

  it.each([
    ['2024-02-29T00:00:00Z', '2024-02-29T00:00:00.000000Z', '2024-01-31T00:00:00.000000Z'],
    ['2023-02-28T00:00:00Z', '2023-02-28T00:00:00.000000Z', '2023-01-31T00:00:00.000000Z'],
    ['2026-03-30T23:59:59Z', '2026-02-28T00:00:00.000000Z', '2026-01-31T00:00:00.000000Z'],
    ['2026-01-10T12:00:00Z', '2025-12-31T00:00:00.000000Z', '2025-11-30T00:00:00.000000Z'],
  ])('clamps each anchor independently at %s', (now, current, previous) => {
    const result = billingPeriods(now, 'UTC', 31);
    expect(result.current.start).toBe(current);
    expect(result.previous.start).toBe(previous);
    expect(Temporal.Instant.from(result.previous.end).add({ microseconds: 1 }).toString()).toBe(
      Temporal.Instant.from(current).toString(),
    );
  });

  it('uses HA time zone instead of the host/browser zone', () => {
    const now = '2026-01-01T01:00:00Z';
    expect(billingPeriods(now, 'America/Los_Angeles', 1).current.start).toBe(
      '2025-12-01T08:00:00.000000Z',
    );
    expect(billingPeriods(now, 'Asia/Tokyo', 1).current.start).toBe('2025-12-31T15:00:00.000000Z');
  });

  it('respects 23 and 25 hour local days', () => {
    const spring = chartRanges('2026-03-31T20:00:00Z', 'Europe/London', 1, 1);
    const fall = chartRanges('2026-10-31T20:00:00Z', 'Europe/London', 1, 1);
    const hours = (ranges: typeof spring) =>
      ranges.map(
        (r) =>
          Number(
            Temporal.Instant.from(r.end).add({ microseconds: 1 }).epochNanoseconds -
              Temporal.Instant.from(r.start).epochNanoseconds,
          ) / 3.6e12,
      );
    expect(hours(spring)).toContain(23);
    expect(hours(fall)).toContain(25);
  });

  it.each([1, 28, 29, 30, 31])(
    'has disjoint, contiguous bounded chart ranges for day %s',
    (day) => {
      for (const periods of [1, 3, 6, 12] as PeriodCount[]) {
        const now = '2026-09-30T12:00:00.123456Z';
        const ranges = chartRanges(now, 'Europe/London', day, periods);
        expect(ranges.length).toBeLessThanOrEqual(32);
        expect(ranges[ranges.length - 1]?.end).toBe(now);
        for (let i = 1; i < ranges.length; i++) {
          expect(
            Temporal.Instant.from(ranges[i - 1].end)
              .add({ microseconds: 1 })
              .toString(),
          ).toBe(Temporal.Instant.from(ranges[i].start).toString());
        }
      }
    },
  );

  it('formats local input and rejects ambiguous/nonexistent DST entries', () => {
    expect(localDateTime('2026-07-01T12:45:32Z', 'Europe/London')).toBe('2026-07-01T13:45');
    expect(transactionTimestamp('2026-07-01T13:45', 'Europe/London')).toBe(
      '2026-07-01T12:45:00.000000Z',
    );
    expect(() => transactionTimestamp('2026-03-29T01:30', 'Europe/London')).toThrow(
      'daylight-saving',
    );
    expect(() => transactionTimestamp('2026-10-25T01:30', 'Europe/London')).toThrow('unambiguous');
    expect(() => transactionTimestamp('not a date', 'UTC')).toThrow();
  });
});

describe('transaction amounts and canonical units', () => {
  it('derives price from quantity and actual paid total', () => {
    expect(deriveTransaction(input())).toEqual({
      vehicle_id: 'unassigned',
      fuel_type: 'petrol',
      quantity: 10,
      unit_price: 1.5,
      total_cost: 15,
    });
  });
  it('derives a rounded total from per-100 input prices', () => {
    expect(
      deriveTransaction(
        input({ mode: 'quantity_price', quantity: '12.345', amount: '149.9', basis: 100 }),
      ),
    ).toMatchObject({ quantity: 12.345, unit_price: 1.499, total_cost: 18.51 });
  });
  it.each([
    ['US_gal', 3.785411784],
    ['imp_gal', 4.54609],
  ] as const)('converts %s precisely and round trips display units', (unit, litres) => {
    const record = deriveTransaction(input({ quantity: '1', amount: '5', unit }));
    expect(record.quantity).toBe(litres);
    expect(displayQuantity(record.quantity, unit)).toBeCloseTo(1, 12);
    expect(displayPrice(record.unit_price, unit, 100)).toBeCloseTo(500, 10);
    expect(record).not.toHaveProperty('input_unit');
    expect(record).not.toHaveProperty('quantity_unit');
    expect(record).not.toHaveProperty('price_basis');
    expect(record).not.toHaveProperty('currency');
  });
  it.each(['quantity_price', 'quantity_total'] as const)(
    'accepts free electricity in %s mode',
    (mode) => {
      expect(
        deriveTransaction(input({ fuel: 'electricity', unit: 'kWh', amount: '0', mode })),
      ).toMatchObject({ quantity: 10, unit_price: 0, total_cost: 0 });
    },
  );
  it.each([
    { quantity: '' },
    { quantity: '0' },
    { quantity: '-1' },
    { quantity: 'NaN' },
    { quantity: 'Infinity' },
    { amount: '' },
    { amount: '-1' },
    { fuel: 'electricity', unit: 'L' },
    { fuel: 'diesel', unit: 'kWh' },
    { amount: '1.001' },
  ] as Partial<TransactionInput>[])('rejects invalid entry %j', (overrides) => {
    expect(() => deriveTransaction(input(overrides))).toThrow();
  });
  it('supports locale decimals but rejects grouped numbers', () => {
    expect(parseDecimal('1,25', 'de-DE').toNumber()).toBe(1.25);
    expect(parseDecimal('1.25', 'de-DE').toNumber()).toBe(1.25);
    expect(() => parseDecimal('1,000.00', 'en')).toThrow();
    expect(
      deriveTransaction(input({ quantity: '10,5', amount: '21,00', locale: 'de-DE' })).unit_price,
    ).toBe(2);
  });
  it.each([
    ['JPY', '1.55', 16],
    ['KWD', '1.23456', 12.346],
  ])('uses currency precision for %s', (currency, amount, total) => {
    expect(
      deriveTransaction(
        input({ currency: String(currency), amount: String(amount), mode: 'quantity_price' }),
      ).total_cost,
    ).toBe(total);
  });
});

describe('statistics presentation', () => {
  const totals = (cost: number, count = 1, quantity = 10) => ({ cost, count, quantity });
  it('compares against the full previous total', () => {
    expect(spendingTrend(totals(50), totals(100))).toMatchObject({
      direction: 'down',
      delta: -50,
      percent: -50,
    });
  });
  it('distinguishes missing, zero, free and unchanged history', () => {
    expect(spendingTrend(totals(20), totals(0, 0))).toMatchObject({
      direction: 'none',
      percent: null,
    });
    expect(spendingTrend(totals(20), totals(0))).toMatchObject({
      direction: 'up',
      percent: null,
      label: 'New spending',
    });
    expect(spendingTrend(totals(0), totals(0))).toMatchObject({ direction: 'flat', percent: 0 });
  });
  it('computes quantity-weighted price, converts quote basis and preserves gaps', () => {
    expect(metricValue(totals(100, 2, 40), 'price', 'L', 100)).toBe(250);
    expect(metricValue(totals(0, 0, 0), 'price', 'L', 1)).toBeNull();
    expect(metricValue(totals(0, 1, 10), 'price', 'kWh', 1)).toBe(0);
  });
});
