import type { Hass, Transaction, Vehicle } from '../src/types';
import { Temporal } from '@js-temporal/polyfill';

export const recordType = 'fuel_purchases';
const field = (key: string, type: string, required = true) => ({
  key,
  label: key,
  type,
  required,
  options: null,
});
const schema = {
  id: recordType,
  name: 'Fuel purchases',
  fields: [
    field('vehicle_id', 'text'),
    field('fuel_type', 'text'),
    field('quantity', 'number'),
    field('unit_price', 'number'),
    field('total_cost', 'number'),
    field('vehicle_name', 'text', false),
  ],
  retention_days: null,
  max_records: null,
};
export const vehicles: Vehicle[] = [
  { id: 'family_hybrid', name: 'Family hybrid', fuels: ['petrol', 'electricity'] },
  { id: 'work_diesel', name: 'Work car', fuels: ['diesel'], unit: 'US_gal', price_basis: 1 },
  {
    id: 'electric_car',
    name: 'Electric car',
    fuels: ['electricity'],
    unit: 'kWh',
    price_basis: 100,
  },
];
export type BackendMode = 'normal' | 'empty' | 'error' | 'short' | 'zero' | 'equal' | 'expired';

interface CursorState {
  query: string;
  timestamp: bigint;
  id: string;
  accessed: number;
  bytes: number;
}

function apiError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function compareIds(left: string, right: string): number {
  const a = new TextEncoder().encode(left),
    b = new TextEncoder().encode(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function comparePosition(left: bigint, leftId: string, right: bigint, rightId: string): number {
  return left < right ? -1 : left > right ? 1 : compareIds(leftId, rightId);
}

export function fixtures(mode: BackendMode, now = Date.now()): Transaction[] {
  if (mode === 'empty') return [];
  const count = mode === 'short' ? 1 : mode === 'zero' || mode === 'equal' ? 3 : 650;
  return Array.from({ length: count }, (_, i) => {
    const fuel = (['petrol', 'diesel', 'electricity'] as const)[i % 3];
    const vehicle = vehicles[i % 3];
    const quantity = fuel === 'electricity' ? 12 + (i % 45) : 20 + (i % 35);
    const price = i % 37 === 0 ? 0 : fuel === 'electricity' ? 0.24 : 1.42 + (i % 9) / 100;
    const total =
      mode === 'zero'
        ? 0
        : mode === 'equal' || mode === 'short'
          ? 30
          : Math.round(quantity * price * 100) / 100;
    // Equal and zero fixtures occupy three distinct billing months, never repacked slots.
    const timestamp =
      count === 650
        ? new Date(now - (i + 1) * 12 * 60 * 60 * 1000).toISOString()
        : Temporal.Instant.fromEpochMilliseconds(now)
            .toZonedDateTimeISO('Europe/London')
            .subtract({ months: i })
            .toInstant()
            .toString();
    return {
      id: `fixture_${String(i).padStart(4, '0')}`,
      timestamp,
      vehicle_id: i % 71 === 0 ? 'retired_car' : vehicle.id,
      vehicle_name: i % 71 === 0 ? 'Previous car' : vehicle.name,
      fuel_type: fuel,
      quantity,
      unit_price: total / quantity,
      total_cost: total,
    };
  });
}

export function instant(value: string): bigint {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? '';
  const whole = Date.parse(value.replace(/\.\d+/, ''));
  if (!Number.isFinite(whole)) throw new Error(`Invalid timestamp: ${value}`);
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

export class DemoBackend {
  rows: Transaction[] = [];
  mode: BackendMode = 'normal';
  private nextId = 1000;
  private cursors = new Map<string, CursorState>();
  private cursorBytes = 0;
  private subscribers = new Set<(event: { data: { record_type?: string } }) => void>();
  onUpdate = () => {};
  readonly hass: Hass = {
    config: { currency: 'GBP', time_zone: 'Europe/London' },
    locale: { language: 'en-GB' },
    language: 'en-GB',
    connection: {
      sendMessagePromise: async <T>(message: Record<string, unknown>) => this.request(message) as T,
      subscribeEvents: async (callback, type) => {
        if (type !== 'custom_records_updated') throw new Error('Unknown event subscription');
        this.subscribers.add(callback);
        return () => {
          this.subscribers.delete(callback);
        };
      },
      addEventListener() {},
      removeEventListener() {},
    },
  };

  reset(mode = this.mode): void {
    this.mode = mode;
    this.rows = fixtures(mode);
    this.nextId = 1000;
    this.cursors.clear();
    this.cursorBytes = 0;
    this.updated();
  }

  private updated(): void {
    for (const callback of this.subscribers) {
      queueMicrotask(() =>
        callback({
          event_type: 'custom_records_updated',
          data: { entry_id: 'synthetic_demo', record_type: recordType },
        } as { data: { record_type: string } }),
      );
    }
    this.onUpdate();
  }

  private matching(message: Record<string, any>): Transaction[] {
    return this.rows.filter((row) => {
      const when = instant(row.timestamp);
      if (message.start && when < instant(message.start)) return false;
      if (message.end && when > instant(message.end)) return false;
      return (message.filter ?? []).every((clause: Record<string, unknown>) =>
        Object.entries(clause).every(([key, expression]) => {
          if (typeof expression !== 'string') throw new Error('Expected a string filter');
          const expected = expression.startsWith('==') ? expression.slice(2) : expression;
          return row[key as keyof Transaction] === expected;
        }),
      );
    });
  }

  private queryKey(message: Record<string, any>, order: 'asc' | 'desc'): string {
    return JSON.stringify([
      message.record_type,
      order,
      message.start ? instant(message.start).toString() : null,
      message.end ? instant(message.end).toString() : null,
      (message.filter ?? []).map((clause: Record<string, string>) =>
        Object.entries(clause).map(([key, value]) => [
          key,
          value.startsWith('==') ? value.slice(2) : value,
        ]),
      ),
    ]);
  }

  private forgetCursor(token: string): void {
    const state = this.cursors.get(token);
    if (state) this.cursorBytes -= state.bytes;
    this.cursors.delete(token);
  }

  private storeCursor(query: string, row: Transaction): string {
    const bytes = new TextEncoder().encode(query + row.id).length + 256;
    const budget = 4 * 1024 * 1024;
    if (bytes > budget)
      throw apiError('pagination_resource_limit', 'Cursor exceeds the history resource limit.');
    for (const [token, state] of this.cursors) {
      if (Date.now() - state.accessed >= 30 * 60_000) this.forgetCursor(token);
    }
    while (this.cursors.size >= 1024 || this.cursorBytes + bytes > budget) {
      this.forgetCursor(this.cursors.keys().next().value!);
    }
    const token = crypto.randomUUID();
    this.cursors.set(token, {
      query,
      timestamp: instant(row.timestamp),
      id: row.id,
      accessed: Date.now(),
      bytes,
    });
    this.cursorBytes += bytes;
    return token;
  }

  async request(message: Record<string, any>): Promise<unknown> {
    if (this.mode === 'error')
      throw new Error('Synthetic backend failure; change Backend to recover.');
    if (message.type === 'custom_records/list_record_types')
      return { record_types: structuredClone([schema]) };
    if (message.record_type !== recordType) throw new Error('Unknown record_type');
    const allowed = (
      {
        'custom_records/list_records': [
          'type',
          'record_type',
          'start',
          'end',
          'limit',
          'filter',
          'paginate',
          'cursor',
          'order',
        ],
        'custom_records/aggregate_records': [
          'type',
          'record_type',
          'start',
          'end',
          'filter',
          'metrics',
        ],
        'custom_records/add_record': ['type', 'record_type', 'fields', 'timestamp'],
        'custom_records/delete_record': ['type', 'record_type', 'record_id'],
      } as Record<string, string[]>
    )[message.type];
    if (!allowed || Object.keys(message).some((key) => !allowed.includes(key)))
      throw new Error(`Unsupported demo request: ${message.type}`);
    switch (message.type) {
      case 'custom_records/list_records': {
        if (message.order !== undefined && message.order !== 'asc' && message.order !== 'desc')
          throw apiError('invalid_format', 'order must be asc or desc.');
        const order = message.order === 'asc' ? 'asc' : 'desc';
        const direction = order === 'asc' ? 1 : -1;
        if (message.paginate !== undefined && typeof message.paginate !== 'boolean')
          throw apiError('invalid_format', 'paginate must be boolean.');
        if (message.limit !== undefined && (!Number.isInteger(message.limit) || message.limit < 1))
          throw apiError('invalid_format', 'limit must be a positive integer.');
        if (
          'cursor' in message &&
          (message.paginate !== true ||
            typeof message.cursor !== 'string' ||
            !/^[\da-f-]{36}$/i.test(message.cursor))
        )
          throw apiError('invalid_cursor', 'Invalid cursor or missing paginate:true.');
        const query = this.queryKey(message, order);
        let position: CursorState | undefined;
        if (message.cursor !== undefined) {
          position = this.cursors.get(message.cursor);
          if (
            !position ||
            this.mode === 'expired' ||
            Date.now() - position.accessed >= 30 * 60_000
          ) {
            this.forgetCursor(message.cursor);
            throw apiError('cursor_expired', 'History cursor expired. Restart history.');
          }
          if (position.query !== query)
            throw apiError('cursor_query_mismatch', 'The history query changed.');
          position.accessed = Date.now();
          this.cursors.delete(message.cursor);
          this.cursors.set(message.cursor, position);
        }
        const limit = Math.min(message.limit ?? 500, 500);
        const records = this.matching(message)
          .filter(
            (row) =>
              !position ||
              direction *
                comparePosition(instant(row.timestamp), row.id, position.timestamp, position.id) >
                0,
          )
          .sort(
            (a, b) =>
              direction * comparePosition(instant(a.timestamp), a.id, instant(b.timestamp), b.id),
          )
          .slice(0, limit + (message.paginate ? 1 : 0));
        if (message.paginate) {
          const has_more = records.length > limit;
          const page = records.slice(0, limit);
          return {
            records: structuredClone(page),
            has_more,
            next_cursor: has_more ? this.storeCursor(query, page[page.length - 1]) : null,
          };
        }
        return { records: structuredClone(records) };
      }
      case 'custom_records/aggregate_records': {
        if (!Array.isArray(message.metrics) || message.metrics.length > 10)
          throw new Error('Expected at most ten metrics');
        const selected = this.matching(message);
        const values: Record<string, number | null> = {};
        const counts: Record<string, number> = {};
        for (const metric of message.metrics) {
          const present = selected.filter(
            (row) => typeof row[metric.field as keyof Transaction] === 'number',
          );
          if (metric.op === 'count') {
            values[metric.name] = selected.length;
            counts[metric.name] = selected.length;
          } else if (metric.op === 'sum') {
            values[metric.name] = present.length
              ? present.reduce(
                  (sum, row) => sum + Number(row[metric.field as keyof Transaction]),
                  0,
                )
              : null;
            counts[metric.name] = present.length;
          } else throw new Error(`Unsupported demo aggregate: ${metric.op}`);
        }
        return { values, counts };
      }
      case 'custom_records/add_record': {
        const fields = message.fields;
        if (!fields || typeof fields !== 'object') throw new Error('Add expects nested fields');
        if (Object.keys(fields).some((key) => !schema.fields.some((f) => f.key === key)))
          throw new Error('Unknown field; currency/unit/basis metadata is not supported');
        for (const definition of schema.fields) {
          const value = fields[definition.key];
          if (value === undefined && !definition.required) continue;
          const expected = definition.type === 'number' ? 'number' : 'string';
          if (typeof value !== expected || (expected === 'number' && !Number.isFinite(value)))
            throw new Error(`Invalid field ${definition.key}`);
        }
        const timestamp = message.timestamp ?? new Date().toISOString();
        instant(timestamp);
        const record = { id: `demo_${this.nextId++}`, timestamp, ...fields } as Transaction;
        this.rows.push(record);
        this.updated();
        return { record: structuredClone(record) };
      }
      case 'custom_records/delete_record': {
        const index = this.rows.findIndex((row) => row.id === message.record_id);
        if (index === -1) throw new Error('Record not found');
        this.rows.splice(index, 1);
        this.updated();
        return { deleted: true };
      }
    }
  }
}
