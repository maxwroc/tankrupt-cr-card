import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { Temporal } from '@js-temporal/polyfill';
import { DemoBackend, fixtures, recordType } from '../demo/backend';
import type { Transaction } from '../src/types';

interface Page {
  records: Transaction[];
  has_more: boolean;
  next_cursor: string | null;
}
const request = {
  type: 'custom_records/list_records',
  record_type: recordType,
  paginate: true,
  order: 'desc',
  limit: 20,
  end: '2026-09-22T10:00:00.000001Z',
};
afterEach(() => vi.useRealTimers());

function backendWithTies(): DemoBackend {
  const backend = new DemoBackend();
  const base = fixtures('short')[0];
  const ids = [
    '🚀',
    '\ue000',
    'é',
    'z',
    'a',
    ...Array.from({ length: 1001 }, (_, i) => `item_${String(i).padStart(4, '0')}`),
  ];
  backend.rows = ids.map((id) => ({ ...base, id, timestamp: '1969-12-31T23:59:59.999999Z' }));
  backend.rows.push(
    { ...base, id: 'earlier', timestamp: '1969-12-31T23:59:59.999998Z' },
    { ...base, id: 'later', timestamp: '1970-01-01T00:00:00.000001Z' },
  );
  return backend;
}

function ordered(records: Transaction[], order: 'asc' | 'desc'): Transaction[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...records].sort(
    (a, b) =>
      direction *
      (Temporal.Instant.compare(a.timestamp, b.timestamp) ||
        Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))),
  );
}

describe('demo cursor protocol', () => {
  it.each(['asc', 'desc'] as const)(
    'traverses >1000 records with >500 ties and exact microsecond/BINARY order: %s',
    async (order) => {
      const backend = backendWithTies();
      const expected = ordered(backend.rows, order).map((row) => row.id);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const result = (await backend.request({
          ...request,
          order,
          ...(cursor ? { cursor } : {}),
        })) as Page;
        expect(result.records.length).toBeLessThanOrEqual(20);
        expect(result.has_more).toBe(result.next_cursor !== null);
        seen.push(...result.records.map((row) => row.id));
        cursor = result.next_cursor;
      } while (cursor);
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(1008);
    },
  );

  it.each(['asc', 'desc'] as const)(
    'keeps a %s cursor retryable across boundary deletion and insertion on the traversed side',
    async (order) => {
      const backend = backendWithTies();
      const first = (await backend.request({ ...request, order })) as Page;
      const nextRequest = { ...request, order, cursor: first.next_cursor };
      const expected = (await backend.request(nextRequest)) as Page;
      backend.rows = backend.rows.filter(
        (row) => row.id !== first.records[first.records.length - 1].id,
      );
      backend.rows.push({
        ...first.records[0],
        id: 'traversed-side',
        timestamp: order === 'asc' ? '1969-12-31T23:59:59.999997Z' : '2026-09-22T09:00:00Z',
      });
      const retry = (await backend.request(nextRequest)) as Page;
      expect(retry.records.map((row) => row.id)).toEqual(expected.records.map((row) => row.id));
      expect(retry.records.some((row) => first.records.some((old) => old.id === row.id))).toBe(
        false,
      );
    },
  );

  it.each(['asc', 'desc'] as const)(
    'includes live inserts only on the untraversed side: %s',
    async (order) => {
      const backend = backendWithTies();
      const base = backend.rows[0];
      backend.rows = ['a', 'c', 'e', 'g', 'i'].map((id) => ({ ...base, id }));
      const first = (await backend.request({ ...request, order, limit: 2 })) as Page;
      backend.rows.push(
        { ...base, id: order === 'asc' ? 'b' : 'h' },
        { ...base, id: order === 'asc' ? 'd' : 'f' },
      );
      const next = (await backend.request({
        ...request,
        order,
        limit: 2,
        cursor: first.next_cursor,
      })) as Page;
      expect(next.records.map((row) => row.id)).toEqual(order === 'asc' ? ['d', 'e'] : ['f', 'e']);
    },
  );

  it.each(['asc', 'desc'] as const)(
    'binds %s cursor scope but permits changing page size and equivalent offset timestamps',
    async (order) => {
      const backend = backendWithTies();
      const query = { ...request, order };
      const first = (await backend.request(query)) as Page;
      const cursor = first.next_cursor;
      const next = (await backend.request({
        ...query,
        cursor,
        limit: 50,
        end: '2026-09-22T11:00:00.000001+01:00',
      })) as Page;
      expect(next.records).toHaveLength(50);
      await expect(
        backend.request({ ...query, cursor, filter: [{ fuel_type: 'petrol' }] }),
      ).rejects.toMatchObject({ code: 'cursor_query_mismatch' });
      await expect(
        backend.request({ ...query, cursor, end: '2026-09-22T10:00:00.000002Z' }),
      ).rejects.toMatchObject({ code: 'cursor_query_mismatch' });
      await expect(
        backend.request({ ...query, cursor, order: order === 'asc' ? 'desc' : 'asc' }),
      ).rejects.toMatchObject({ code: 'cursor_query_mismatch' });
      await expect(backend.request({ ...query, paginate: false, cursor })).rejects.toMatchObject({
        code: 'invalid_cursor',
      });
      await expect(backend.request({ ...query, cursor: null })).rejects.toMatchObject({
        code: 'invalid_cursor',
      });
    },
  );

  it('treats omitted and explicit descending order as the same cursor scope', async () => {
    const backend = backendWithTies();
    const { order, ...implicit } = request;
    expect(order).toBe('desc');
    const first = (await backend.request(implicit)) as Page;
    const explicit = (await backend.request({ ...request, cursor: first.next_cursor })) as Page;
    const defaulted = (await backend.request({ ...implicit, cursor: first.next_cursor })) as Page;
    expect(defaulted.records).toEqual(explicit.records);
    const explicitFirst = (await backend.request(request)) as Page;
    const implicitNext = (await backend.request({
      ...implicit,
      cursor: explicitFirst.next_cursor,
    })) as Page;
    expect(implicitNext.records).toEqual(explicit.records);
  });

  it.each([false, true])(
    'defaults to descending order with pagination %s, independent of limit',
    async (paginate) => {
      const backend = backendWithTies();
      const expected = ordered(backend.rows, 'desc');
      for (const limit of [undefined, 7]) {
        const result = (await backend.request({
          type: request.type,
          record_type: request.record_type,
          end: request.end,
          paginate,
          ...(limit === undefined ? {} : { limit }),
        })) as Page;
        expect(result.records).toEqual(expected.slice(0, limit ?? 500));
      }
    },
  );

  it.each(['asc', 'desc'] as const)(
    'keeps %s ordering independent of limits and pagination mode',
    async (order) => {
      const backend = backendWithTies();
      const expected = ordered(backend.rows, order);
      for (const paginate of [undefined, false, true]) {
        for (const limit of [undefined, 7, 500, 999]) {
          const result = (await backend.request({
            ...request,
            order,
            paginate,
            limit,
          })) as Page;
          expect(result.records).toEqual(expected.slice(0, Math.min(limit ?? 500, 500)));
          expect(Object.keys(result).sort()).toEqual(
            paginate ? ['has_more', 'next_cursor', 'records'] : ['records'],
          );
          if (paginate) expect(result.has_more).toBe(true);
        }
      }
    },
  );

  it.each(['asc', 'desc'] as const)(
    'applies inclusive ranges and filters consistently for %s pages',
    async (order) => {
      const backend = backendWithTies();
      const base = backend.rows[0];
      backend.rows = [
        { ...base, id: 'before', timestamp: '1969-12-31T23:59:59.999998Z' },
        { ...base, id: 'start', timestamp: '1969-12-31T23:59:59.999999Z' },
        { ...base, id: 'excluded', timestamp: '1970-01-01T00:00:00.000000Z', fuel_type: 'diesel' },
        { ...base, id: 'end', timestamp: '1970-01-01T00:00:00.000001Z' },
        { ...base, id: 'after', timestamp: '1970-01-01T00:00:00.000002Z' },
      ];
      const query = {
        ...request,
        order,
        start: backend.rows[1].timestamp,
        end: backend.rows[3].timestamp,
        filter: [{ fuel_type: '==petrol' }],
        limit: 1,
      };
      const first = (await backend.request(query)) as Page;
      const next = (await backend.request({ ...query, cursor: first.next_cursor })) as Page;
      expect([...first.records, ...next.records].map((row) => row.id)).toEqual(
        order === 'asc' ? ['start', 'end'] : ['end', 'start'],
      );
      expect(next).toMatchObject({ has_more: false, next_cursor: null });
    },
  );

  it.each(['ASC', 'ascending', '', null, 0])(
    'rejects invalid order %j in both listing modes',
    async (order) => {
      const backend = backendWithTies();
      for (const paginate of [false, true])
        await expect(backend.request({ ...request, paginate, order })).rejects.toMatchObject({
          code: 'invalid_format',
        });
    },
  );

  it.each([0, -1, null, 'all', Infinity])(
    'rejects invalid or unlimited public limit %j in both modes',
    async (limit) => {
      const backend = backendWithTies();
      for (const paginate of [false, true])
        await expect(backend.request({ ...request, paginate, limit })).rejects.toMatchObject({
          code: 'invalid_format',
        });
    },
  );

  it('distinguishes non-paginated envelopes, exact last pages and expired handles', async () => {
    const backend = backendWithTies();
    const unpaged = await backend.request({ ...request, paginate: false, limit: 999 });
    expect(Object.keys(unpaged as object)).toEqual(['records']);
    expect((unpaged as Page).records).toHaveLength(500);
    backend.rows = backend.rows.slice(0, 20);
    const last = (await backend.request(request)) as Page;
    expect(last).toMatchObject({ has_more: false, next_cursor: null });
    backend.rows.push({ ...backend.rows[0], id: 'another' });
    vi.useFakeTimers();
    const first = (await backend.request(request)) as Page;
    vi.advanceTimersByTime(30 * 60_000);
    await expect(backend.request({ ...request, cursor: first.next_cursor })).rejects.toMatchObject({
      code: 'cursor_expired',
    });
    backend.reset('expired');
    const expire = (await backend.request(request)) as Page;
    await expect(backend.request({ ...request, cursor: expire.next_cursor })).rejects.toMatchObject(
      { code: 'cursor_expired' },
    );
  });
});
