import { describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { normalizeConfig } from '../src/config';
import { CustomRecordsSource, validateSchema } from '../src/data/custom-records-source';
import type { Hass, NewTransaction, RecordType } from '../src/types';

const cfg = normalizeConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel_purchases' });
const recordType: RecordType = {
  id: 'fuel_purchases',
  name: 'Fuel purchases',
  fields: Object.entries(cfg.fields).map(([name, key]) => ({
    key,
    label: name,
    type: ['quantity', 'unit_price', 'total_cost'].includes(name) ? 'number' : 'text',
    required: name !== 'vehicle_name',
    options: undefined,
  })),
};
const transaction: NewTransaction = {
  timestamp: '2026-09-20T12:00:00Z',
  vehicle_id: 'car_1',
  fuel_type: 'petrol',
  quantity: 10,
  unit_price: 1.5,
  total_cost: 15,
};
const now = '2026-09-20T12:00:00.000000Z';
const aggregate = (count = 600, cost = 9000, quantity = 6000) => ({
  values: { cost: count ? cost : null, quantity: count ? quantity : null, visits: count },
  counts: { cost: count, quantity: count, visits: count },
});

function setup(handler?: (message: Record<string, unknown>) => unknown | Promise<unknown>) {
  const send = vi.fn(async (message: Record<string, unknown>) => {
    if (handler) {
      const response = await handler(message);
      if (response !== undefined) return response;
    }
    switch (message.type) {
      case 'custom_records/list_record_types':
        return { record_types: [recordType] };
      case 'custom_records/aggregate_records':
        return aggregate();
      case 'custom_records/list_records':
        return { records: [{ id: 'row-1', ...transaction }], has_more: false, next_cursor: null };
      case 'custom_records/add_record':
        return { record: { id: 'new-id', ...transaction } };
      case 'custom_records/delete_record':
        return { deleted: true };
      default:
        throw new Error(`Unexpected API command: ${String(message.type)}`);
    }
  });
  let callback: ((event: { data: { record_type?: string } }) => void) | undefined;
  const unsubscribe = vi.fn();
  const hass: Hass = {
    config: { time_zone: 'Europe/London', currency: 'GBP' },
    connection: {
      sendMessagePromise: async <T>(message: Record<string, unknown>): Promise<T> =>
        (await send(message)) as T,
      subscribeEvents: vi.fn(async (cb) => {
        callback = cb;
        return unsubscribe;
      }),
    },
  };
  const source = new CustomRecordsSource(hass, cfg);
  return {
    source,
    send,
    hass,
    unsubscribe,
    emit: (id: string) => callback?.({ data: { record_type: id } }),
  };
}

describe('history pagination protocol', () => {
  it('loads more than 500 records in bounded pages without aggregate scans or timestamp rounding', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      ...transaction,
      id: `opaque imported id ${1001 - i}`,
      timestamp: '1969-12-31T23:59:59.999999Z',
    }));
    const { source, send } = setup((request) => {
      if (request.type !== 'custom_records/list_records') return undefined;
      const offset = request.cursor ? Number(String(request.cursor).split('_')[1]) : 0;
      const records = rows.slice(offset, offset + Number(request.limit));
      const has_more = offset + records.length < rows.length;
      return {
        records,
        has_more,
        next_cursor: has_more ? `opaque_${offset + records.length}` : null,
      };
    });
    const loaded: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await source.fetchHistoryPage(
        { vehicle: 'retired_car', fuel: 'petrol' },
        now,
        cursor,
      );
      loaded.push(...page.records.map((row) => row.id));
      expect(page.records.every((row) => row.timestamp === rows[0].timestamp)).toBe(true);
      expect(page.records.length).toBeLessThanOrEqual(20);
      expect(Object.keys(page).sort()).toEqual(['hasMore', 'nextCursor', 'records']);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(loaded).toEqual(rows.map((row) => row.id));
    const queries = send.mock.calls.map(([request]) => request);
    expect(queries.some((q) => q.type === 'custom_records/get_capabilities')).toBe(false);
    expect(queries.some((q) => q.type === 'custom_records/aggregate_records')).toBe(false);
    const pages = queries.filter((q) => q.type === 'custom_records/list_records');
    expect(pages).toHaveLength(51);
    expect(pages.every((page) => page.paginate === true && page.order === 'desc')).toBe(true);
    expect(pages[0]).not.toHaveProperty('cursor');
    expect(pages[1]).toMatchObject({
      paginate: true,
      order: 'desc',
      cursor: 'opaque_20',
      limit: 20,
      end: now,
      filter: [{ vehicle_id: '==retired_car' }, { fuel_type: 'petrol' }],
    });
  });

  it.each(['not_setup', 'unauthorized', 'connection_lost', 'unknown_command'])(
    'surfaces paginated read error %s without fallback',
    async (code) => {
      const { source, send } = setup((request) => {
        if (request.type === 'custom_records/list_records')
          throw { code, message: 'Cannot read history' };
      });
      await expect(source.fetchHistoryPage({}, now)).rejects.toMatchObject({
        code,
        message: 'Cannot read history',
      });
      expect(send.mock.calls.map(([q]) => q.type)).toEqual([
        'custom_records/list_record_types',
        'custom_records/list_records',
      ]);
      expect(send.mock.calls[1][0]).toMatchObject({ paginate: true, order: 'desc' });
    },
  );

  it('preserves error codes and does not consume a failed page cursor', async () => {
    let attempts = 0;
    const { source, send } = setup((request) => {
      if (request.type === 'custom_records/list_records') {
        attempts++;
        if (attempts === 1) throw { code: 'connection_lost', message: 'Disconnected' };
        if (attempts === 2) throw { code: 'cursor_expired', message: 'Restart history' };
        return {
          records: [{ id: 'opaque: \u{1f680}', ...transaction }],
          has_more: false,
          next_cursor: null,
        };
      }
    });
    await expect(source.fetchHistoryPage({}, now, 'token')).rejects.toMatchObject({
      code: 'connection_lost',
    });
    await expect(source.fetchHistoryPage({}, now, 'token')).rejects.toMatchObject({
      code: 'cursor_expired',
    });
    expect((await source.fetchHistoryPage({}, now, 'token')).records[0].id).toBe(
      'opaque: \u{1f680}',
    );
    expect(
      send.mock.calls
        .filter(([q]) => q.type === 'custom_records/list_records')
        .map(([q]) => q.cursor),
    ).toEqual(['token', 'token', 'token']);
  });

  it.each([
    { records: [{ id: 'r1', ...transaction }] },
    { records: [], has_more: true, next_cursor: 'next' },
    { records: [], has_more: false },
    { records: [], has_more: false, next_cursor: 'next' },
    { records: [], has_more: true, next_cursor: null },
    { records: [{ id: 'r1', ...transaction }], has_more: true, next_cursor: 'same' },
    {
      records: Array.from({ length: 21 }, () => ({ id: 'r1', ...transaction })),
      has_more: false,
      next_cursor: null,
    },
  ])('rejects malformed or non-advancing pages without downgrade', async (response) => {
    const { source, send } = setup((request) =>
      request.type === 'custom_records/list_records' ? response : undefined,
    );
    await expect(source.fetchHistoryPage({}, now, 'same')).rejects.toThrow(
      'Invalid or non-advancing',
    );
    expect(send.mock.calls.map(([q]) => q.type)).toEqual([
      'custom_records/list_record_types',
      'custom_records/list_records',
    ]);
  });
});
describe('record schema', () => {
  it('allows the minimal schema without optional name', () => {
    expect(() =>
      validateSchema(
        { ...recordType, fields: recordType.fields.filter((f) => f.key !== 'vehicle_name') },
        cfg,
      ),
    ).not.toThrow();
  });
  it('rejects wrong/missing mappings and additional required fields without defaults', () => {
    expect(() => validateSchema({ ...recordType, fields: [] }, cfg)).toThrow('vehicle_id');
    expect(() =>
      validateSchema(
        {
          ...recordType,
          fields: [
            ...recordType.fields,
            { key: 'station', label: 'Station', type: 'text', required: true },
          ],
        },
        cfg,
      ),
    ).toThrow('station');
  });
  it('accepts valid explicit false/zero defaults and rejects invalid defaults', () => {
    for (const field of [
      { key: 'flag', label: 'Flag', type: 'boolean', required: true, default: false },
      { key: 'extra', label: 'Extra', type: 'number', required: true, default: 0 },
    ]) {
      expect(() =>
        validateSchema({ ...recordType, fields: [...recordType.fields, field] }, cfg),
      ).not.toThrow();
    }
    expect(() =>
      validateSchema(
        {
          ...recordType,
          fields: [
            ...recordType.fields,
            {
              key: 'extra',
              label: 'Extra',
              type: 'number',
              required: true,
              default: '0',
            },
          ],
        },
        cfg,
      ),
    ).toThrow('default');
  });
});

describe('custom_records protocol', () => {
  it('accepts the backend explicit null options on non-select fields', async () => {
    const { source } = setup((m) =>
      m.type === 'custom_records/list_record_types'
        ? {
            record_types: [
              { ...recordType, fields: recordType.fields.map((f) => ({ ...f, options: null })) },
            ],
          }
        : undefined,
    );
    expect((await source.getRecordType()).fields[0].options).toBeUndefined();
  });
  it('uses full-history aggregates rather than adding the recent list', async () => {
    const { source, send } = setup();
    const [summary, recent] = await Promise.all([
      source.fetchSummary({}, now),
      source.fetchHistoryPage({}, now),
    ]);
    expect(summary.current.cost).toBe(9000);
    expect(recent.records).toHaveLength(1);
    expect(summary.current.count).toBe(600);
    const queries = send.mock.calls.map(([q]) => q);
    expect(queries.filter((q) => q.type === 'custom_records/list_record_types')).toHaveLength(1);
    expect(queries.find((q) => q.type === 'custom_records/list_records')).toMatchObject({
      record_type: 'fuel_purchases',
      paginate: true,
      order: 'desc',
      limit: 20,
      end: now,
    });
    expect(queries.find((q) => q.start === summary.periods.previous.start)).toMatchObject({
      end: '2026-08-31T22:59:59.999999Z',
    });
  });
  it('counts boundary records exactly once even with more than 500 visits at one timestamp', async () => {
    const rows = [
      ...Array.from({ length: 501 }, (_, i) => ({
        id: `previous-${i}`,
        ...transaction,
        timestamp: '2026-08-31T22:59:59.999999Z',
      })),
      { id: 'current', ...transaction, timestamp: '2026-08-31T23:00:00.000000Z' },
      { id: 'future', ...transaction, timestamp: '2026-09-20T12:00:00.000001Z' },
    ];
    const { source } = setup((m) => {
      if (m.type !== 'custom_records/aggregate_records' && m.type !== 'custom_records/list_records')
        return undefined;
      const matching = rows.filter((r) => {
        const instant = Temporal.Instant.from(r.timestamp);
        return (
          (!m.start ||
            Temporal.Instant.compare(instant, Temporal.Instant.from(String(m.start))) >= 0) &&
          (!m.end || Temporal.Instant.compare(instant, Temporal.Instant.from(String(m.end))) <= 0)
        );
      });
      if (m.type === 'custom_records/list_records') {
        matching.sort(
          (a, b) =>
            Temporal.Instant.compare(b.timestamp, a.timestamp) ||
            (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        );
        const has_more = matching.length > Number(m.limit);
        return {
          records: matching.slice(0, Number(m.limit)),
          has_more,
          next_cursor: has_more ? 'more' : null,
        };
      }
      return aggregate(matching.length, matching.length * 15, matching.length * 10);
    });
    const summary = await source.fetchSummary({}, now);
    expect(summary.previous).toEqual({ count: 501, cost: 7515, quantity: 0 });
    expect(summary.current).toEqual({ count: 1, cost: 15, quantity: 0 });
    const recent = await source.fetchHistoryPage({}, now);
    expect(recent.records).toHaveLength(20);
    expect(recent.hasMore).toBe(true);
    const chart = await source.fetchChart({}, 3, 'spending', now);
    expect(chart[0].points.reduce((count, point) => count + point.totals.count, 0)).toBe(502);
  });
  it('sends only canonical fields, timestamp at the top, and no currency/unit metadata', async () => {
    const { source, send } = setup();
    await source.addRecord(transaction);
    expect(send.mock.calls.find(([m]) => m.type === 'custom_records/add_record')?.[0]).toEqual({
      type: 'custom_records/add_record',
      record_type: 'fuel_purchases',
      timestamp: transaction.timestamp,
      fields: {
        vehicle_id: 'car_1',
        fuel_type: 'petrol',
        quantity: 10,
        unit_price: 1.5,
        total_cost: 15,
      },
    });
  });
  it('saves free charging values and ignores absent optional name', async () => {
    const { source, send } = setup();
    await source.addRecord({
      ...transaction,
      fuel_type: 'electricity',
      unit_price: 0,
      total_cost: 0,
    });
    expect(
      send.mock.calls.find(([m]) => m.type === 'custom_records/add_record')?.[0].fields,
    ).toMatchObject({ fuel_type: 'electricity', unit_price: 0, total_cost: 0 });
  });
  it('uses exact equality for vehicle filters, plus a separate fuel filter', async () => {
    const { source, send } = setup();
    await source.fetchSummary({ vehicle: 'car_1', fuel: 'diesel' }, now);
    expect(
      send.mock.calls.find(([m]) => m.type === 'custom_records/aggregate_records')?.[0].filter,
    ).toEqual([{ vehicle_id: '==car_1' }, { fuel_type: 'diesel' }]);
  });
  it('keeps twelve chronological billing buckets when only the current month has records', async () => {
    const purchased = Temporal.Instant.from('2026-09-12T12:00:00Z');
    const { source } = setup((request) => {
      if (request.type !== 'custom_records/aggregate_records') return undefined;
      const containsPurchase =
        Temporal.Instant.compare(purchased, String(request.start)) >= 0 &&
        Temporal.Instant.compare(purchased, String(request.end)) <= 0;
      return aggregate(containsPurchase ? 1 : 0, 0, 10);
    });
    const [series] = await source.fetchChart(cfg.filter, cfg.graph.periods, cfg.graph.metric, now);
    expect(series.points).toHaveLength(12);
    expect(series.points.slice(0, 11).every((point) => point.totals.count === 0)).toBe(true);
    expect(series.points[11].totals).toMatchObject({ count: 1, cost: 0 });
    expect(series.points[0].start).toBe('2025-09-30T23:00:00.000000Z');
    expect(series.points[11].end).toBe(now);
  });
  it('uses complete local buckets and caches metrics across graph switches', async () => {
    const { source, send } = setup();
    const price = await source.fetchChart({ fuel: 'electricity' }, 6, 'price', now);
    const count = send.mock.calls.length;
    const quantity = await source.fetchChart({ fuel: 'electricity' }, 6, 'quantity', now);
    expect(send.mock.calls.length).toBe(count);
    expect(price).toEqual(quantity);
    expect(price[0].points).toHaveLength(6);
    expect(price[0].points[0].start).toBe('2026-03-31T23:00:00.000000Z');
    expect(send.mock.calls.some(([m]) => 'bucket' in m)).toBe(false);
  });
  it('splits quantity/price by fuel but uses a single all-fuel spending series', async () => {
    const { source, send } = setup();
    expect((await source.fetchChart({}, 6, 'quantity', now)).map((s) => s.fuel)).toEqual([
      'petrol',
      'diesel',
      'electricity',
    ]);
    expect(await source.fetchChart({}, 6, 'spending', now)).toHaveLength(1);
    const allFuelQueries = send.mock.calls
      .map(([q]) => q)
      .filter(
        (q) =>
          q.type === 'custom_records/aggregate_records' &&
          Array.isArray(q.filter) &&
          q.filter.length === 0,
      );
    expect(allFuelQueries.length).toBeGreaterThan(0);
    expect(allFuelQueries.every((q) => !JSON.stringify(q.metrics).includes('"quantity"'))).toBe(
      true,
    );
  });
  it('handles empty successful aggregates without turning errors into zero', async () => {
    const { source } = setup((m) =>
      m.type === 'custom_records/aggregate_records' ? aggregate(0) : undefined,
    );
    expect((await source.fetchSummary({}, now)).current).toEqual({
      cost: 0,
      quantity: 0,
      count: 0,
    });
    const failed = setup((m) => {
      if (m.type === 'custom_records/aggregate_records') throw new Error('offline');
    });
    await expect(failed.source.fetchSummary({}, now)).rejects.toThrow('offline');
  });
  it('rejects incomplete aggregate values instead of silently excluding malformed records', async () => {
    const { source } = setup((m) =>
      m.type === 'custom_records/aggregate_records'
        ? {
            ...aggregate(),
            counts: { cost: 599, quantity: 600, visits: 600 },
          }
        : undefined,
    );
    await expect(source.fetchSummary({}, now)).rejects.toThrow('incomplete');
  });
  it('reports malformed paginated records and incompatible schemas', async () => {
    const invalid = setup((m) =>
      m.type === 'custom_records/list_records'
        ? {
            records: [{ ...transaction, id: 'bad', quantity: null }],
            has_more: false,
            next_cursor: null,
          }
        : undefined,
    );
    await expect(invalid.source.fetchHistoryPage({}, now)).rejects.toThrow('quantity');
    const missing = setup((m) =>
      m.type === 'custom_records/list_record_types' ? { record_types: [] } : undefined,
    );
    await expect(missing.source.getRecordType()).rejects.toThrow('not found');
  });
  it('invalidates only for matching events and exposes subscription failures', async () => {
    const { source, emit, send, unsubscribe } = setup();
    await source.fetchSummary({}, now);
    const cb = vi.fn();
    const stop = await source.subscribeUpdates(cb);
    emit('unrelated');
    expect(cb).not.toHaveBeenCalled();
    const before = send.mock.calls.length;
    emit('fuel_purchases');
    expect(cb).toHaveBeenCalledOnce();
    await source.fetchSummary({}, now);
    expect(send.mock.calls.length).toBeGreaterThan(before);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('deletes by record ID and rejects unconfirmed deletion', async () => {
    const { source, send } = setup();
    await source.deleteRecord('row-1');
    expect(send).toHaveBeenCalledWith({
      type: 'custom_records/delete_record',
      record_type: 'fuel_purchases',
      record_id: 'row-1',
    });
    const failed = setup((m) =>
      m.type === 'custom_records/delete_record' ? { deleted: false } : undefined,
    );
    await expect(failed.source.deleteRecord('row-1')).rejects.toThrow('not confirmed');
  });
  it('passes schema defaults explicitly without accidentally dropping false', async () => {
    const { source, send } = setup((m) =>
      m.type === 'custom_records/list_record_types'
        ? {
            record_types: [
              {
                ...recordType,
                fields: [
                  ...recordType.fields,
                  {
                    key: 'business',
                    label: 'Business',
                    type: 'boolean',
                    required: true,
                    default: false,
                  },
                ],
              },
            ],
          }
        : undefined,
    );
    await source.addRecord(transaction);
    expect(
      send.mock.calls.find(([m]) => m.type === 'custom_records/add_record')?.[0].fields,
    ).toMatchObject({ business: false });
  });
  it('bounds API concurrency at four even for multi-series daily charts', async () => {
    let active = 0;
    let maximum = 0;
    const { source } = setup(async (m) => {
      if (m.type !== 'custom_records/aggregate_records') return undefined;
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active--;
      return aggregate();
    });
    await source.fetchChart({}, 1, 'quantity', now);
    expect(maximum).toBe(4);
  });
  it('does not automatically retry an uncertain write', async () => {
    const { source, send } = setup((m) => {
      if (m.type === 'custom_records/add_record') throw new Error('connection lost');
    });
    await expect(source.addRecord(transaction)).rejects.toThrow('connection lost');
    expect(send.mock.calls.filter(([m]) => m.type === 'custom_records/add_record')).toHaveLength(1);
  });
});
