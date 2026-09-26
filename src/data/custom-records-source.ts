import { Temporal } from '@js-temporal/polyfill';
import { FUELS, FUEL_LABELS } from '../const';
import { billingPeriods, chartRanges } from '../logic/billing-period';
import type {
  ChartSeries,
  Fuel,
  Hass,
  HistoryPage,
  Metric,
  NewTransaction,
  PeriodCount,
  RecordField,
  RecordType,
  ResolvedConfig,
  Scope,
  Summary,
  TimeRange,
  Totals,
  Transaction,
  TransactionValues,
  Unsubscribe,
} from '../types';
import type { DataSource } from './data-source';

export function historyErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

export class HistoryRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HistoryRequestError';
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label} response from custom_records.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`Missing or invalid ${label}.`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Missing or invalid ${label}.`);
  return value;
}

function fuel(value: unknown): Fuel {
  const result = FUELS.find((f) => f === value);
  if (!result)
    throw new Error(
      `Unknown fuel type "${String(value)}". Expected petrol, diesel or electricity.`,
    );
  return result;
}

function timestamp(value: unknown): string {
  const result = text(value, 'timestamp');
  Temporal.Instant.from(result);
  return result;
}

function validateValues(record: TransactionValues): void {
  text(record.vehicle_id, 'vehicle_id');
  fuel(record.fuel_type);
  if (number(record.quantity, 'quantity') <= 0)
    throw new Error('Quantity must be greater than zero.');
  if (number(record.unit_price, 'unit_price') < 0 || number(record.total_cost, 'total_cost') < 0) {
    throw new Error('Price and total cost cannot be negative.');
  }
}

function validDefault(field: RecordField): boolean {
  const value = field.default;
  if (value === undefined || value === null) return false;
  switch (field.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'text':
    case 'long_text':
      return typeof value === 'string' && (!field.required || value.length > 0);
    case 'boolean':
      return typeof value === 'boolean';
    case 'single_select':
      return typeof value === 'string' && !!field.options?.includes(value);
    case 'multi_select':
      return (
        Array.isArray(value) &&
        (!field.required || value.length > 0) &&
        value.every((v) => typeof v === 'string' && field.options?.includes(v))
      );
    case 'datetime':
      if (typeof value !== 'string') return false;
      try {
        Temporal.Instant.from(value);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function validateSchema(type: RecordType, config: ResolvedConfig): void {
  const numeric = new Set(['quantity', 'unit_price', 'total_cost']);
  for (const [name, key] of Object.entries(config.fields)) {
    const field = type.fields.find((f) => f.key === key);
    if (!field && name === 'vehicle_name') continue;
    const expected = numeric.has(name) ? 'number' : 'text';
    if (!field || field.type !== expected) {
      throw new Error(
        `Record type "${type.id}" needs a ${expected} field "${key}" (${name}). Check the schema or fields mapping.`,
      );
    }
    if (name === 'vehicle_name' && field.required) {
      throw new Error(
        `"${key}" must be optional: entries without configured vehicles have no name.`,
      );
    }
  }
  const mapped = new Set(Object.values(config.fields));
  for (const field of type.fields) {
    if (!mapped.has(field.key) && field.required && !validDefault(field)) {
      throw new Error(
        `Additional required field "${field.key}" needs a valid default before this card can save records.`,
      );
    }
  }
}

export class CustomRecordsSource implements DataSource {
  private schema?: Promise<RecordType>;
  private cache = new Map<string, Promise<Totals>>();
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(
    private hass: Hass,
    private config: ResolvedConfig,
  ) {}

  invalidate(): void {
    this.schema = undefined;
    this.cache.clear();
  }

  private async request<T>(message: Record<string, unknown>): Promise<T> {
    if (this.active >= 4) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await this.hass.connection.sendMessagePromise<T>(message);
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }

  getRecordType(): Promise<RecordType> {
    if (!this.schema) {
      const promise = this.loadRecordType();
      this.schema = promise;
      void promise.catch(() => {
        if (this.schema === promise) this.schema = undefined;
      });
    }
    return this.schema;
  }

  private async loadRecordType(): Promise<RecordType> {
    const response = object(
      await this.request<unknown>({ type: 'custom_records/list_record_types' }),
      'record types',
    );
    if (!Array.isArray(response.record_types))
      throw new Error('custom_records did not return record_types.');
    const raw = response.record_types
      .map((r) => object(r, 'record type'))
      .find((r) => r.id === this.config.record_type);
    if (!raw)
      throw new Error(
        `Record type "${this.config.record_type}" not found. Create it in Custom Records settings.`,
      );
    if (!Array.isArray(raw.fields)) throw new Error('Record type fields are missing.');
    const type: RecordType = {
      id: text(raw.id, 'record type ID'),
      name: text(raw.name, 'record type name'),
      fields: raw.fields.map((value): RecordField => {
        const field = object(value, 'field');
        if (typeof field.required !== 'boolean') throw new Error('Field required flag is invalid.');
        if (
          field.options != null &&
          (!Array.isArray(field.options) || !field.options.every((v) => typeof v === 'string'))
        )
          throw new Error('Field options are invalid.');
        return {
          key: text(field.key, 'field key'),
          label: text(field.label, 'field label'),
          type: text(field.type, 'field type'),
          required: field.required,
          default: field.default,
          options: field.options == null ? undefined : (field.options as string[]),
        };
      }),
      retention_days:
        raw.retention_days == null ? null : number(raw.retention_days, 'retention_days'),
      max_records: raw.max_records == null ? null : number(raw.max_records, 'max_records'),
    };
    validateSchema(type, this.config);
    return type;
  }

  private filters(scope: Scope): Array<Record<string, string>> {
    const filters: Array<Record<string, string>> = [];
    if (scope.vehicle) filters.push({ [this.config.fields.vehicle_id]: `==${scope.vehicle}` });
    if (scope.fuel) filters.push({ [this.config.fields.fuel_type]: fuel(scope.fuel) });
    return filters;
  }

  private aggregate(scope: Scope, range: Partial<TimeRange>): Promise<Totals> {
    const message = {
      type: 'custom_records/aggregate_records',
      record_type: this.config.record_type,
      ...range,
      filter: this.filters(scope),
      metrics: [
        { op: 'sum', field: this.config.fields.total_cost, name: 'cost' },
        ...(scope.fuel
          ? [{ op: 'sum', field: this.config.fields.quantity, name: 'quantity' }]
          : []),
        { op: 'count', name: 'visits' },
      ],
    };
    const key = JSON.stringify(message);
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.request<unknown>(message).then((value): Totals => {
        const result = object(value, 'aggregate');
        const values = object(result.values, 'aggregate values');
        const counts = object(result.counts, 'aggregate counts');
        const count = number(values.visits, 'record count');
        if (
          !Number.isInteger(count) ||
          count < 0 ||
          counts.cost !== count ||
          (scope.fuel && counts.quantity !== count) ||
          counts.visits !== count
        ) {
          throw new Error(
            'Aggregate data is incomplete: some records have missing cost or quantity fields.',
          );
        }
        const cost =
          count === 0 && values.cost === null ? 0 : number(values.cost, 'aggregate cost');
        const quantity =
          !scope.fuel || (count === 0 && values.quantity === null)
            ? 0
            : number(values.quantity, 'aggregate quantity');
        if (cost < 0 || quantity < 0 || (scope.fuel && count > 0 && quantity === 0)) {
          throw new Error('Records contain invalid negative costs or nonpositive quantities.');
        }
        return { cost, quantity, count };
      });
      if (this.cache.size >= 512) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, pending);
      const created = pending;
      void pending.catch(() => {
        if (this.cache.get(key) === created) this.cache.delete(key);
      });
    }
    return pending;
  }

  async fetchSummary(scope: Scope, now: string): Promise<Summary> {
    await this.getRecordType();
    const periods = billingPeriods(now, this.hass.config.time_zone, this.config.billing_start_day);
    const [current, previous] = await Promise.all([
      this.aggregate(scope, periods.current),
      this.aggregate(scope, periods.previous),
    ]);
    return { periods, current, previous };
  }

  async fetchChart(
    scope: Scope,
    periods: PeriodCount,
    metric: Metric,
    now: string,
  ): Promise<ChartSeries[]> {
    await this.getRecordType();
    const ranges = chartRanges(
      now,
      this.hass.config.time_zone,
      this.config.billing_start_day,
      periods,
    );
    const fuels = metric === 'spending' ? [scope.fuel] : scope.fuel ? [scope.fuel] : [...FUELS];
    return Promise.all(
      fuels.map(async (selected): Promise<ChartSeries> => ({
        id: selected ?? 'all',
        label: selected ? FUEL_LABELS[selected] : 'All fuels',
        fuel: selected,
        points: await Promise.all(
          ranges.map(async (range) => ({
            ...range,
            totals: await this.aggregate({ ...scope, fuel: selected }, range),
          })),
        ),
      })),
    );
  }

  private readRecord(value: unknown): Transaction {
    const row = object(value, 'record');
    const fields = this.config.fields;
    const result: Transaction = {
      id: text(row.id, 'record ID'),
      timestamp: timestamp(row.timestamp),
      vehicle_id: text(row[fields.vehicle_id], 'vehicle_id'),
      fuel_type: fuel(row[fields.fuel_type]),
      quantity: number(row[fields.quantity], 'quantity'),
      unit_price: number(row[fields.unit_price], 'unit_price'),
      total_cost: number(row[fields.total_cost], 'total_cost'),
      ...(typeof row[fields.vehicle_name] === 'string'
        ? { vehicle_name: String(row[fields.vehicle_name]) }
        : {}),
    };
    validateValues(result);
    return result;
  }

  async fetchHistoryPage(scope: Scope, now: string, cursor?: string): Promise<HistoryPage> {
    try {
      await this.getRecordType();
      const limit = this.config.recent_limit;
      if (cursor !== undefined && (typeof cursor !== 'string' || !cursor.length)) {
        throw new HistoryRequestError('Invalid history cursor. Restart History.', 'invalid_cursor');
      }
      const response = object(
        await this.request<unknown>({
          type: 'custom_records/list_records',
          record_type: this.config.record_type,
          end: timestamp(now),
          limit,
          filter: this.filters(scope),
          paginate: true,
          order: 'desc',
          ...(cursor === undefined ? {} : { cursor }),
        }),
        'history page',
      );
      const next = response.next_cursor;
      if (
        !Array.isArray(response.records) ||
        response.records.length > limit ||
        typeof response.has_more !== 'boolean' ||
        !(next === null || (typeof next === 'string' && next.length > 0)) ||
        response.has_more !== (next !== null) ||
        (response.has_more && (!response.records.length || next === cursor))
      ) {
        throw new Error('Invalid or non-advancing history page from Custom Records.');
      }
      return {
        records: response.records.map((row) => this.readRecord(row)),
        nextCursor: next,
        hasMore: response.has_more,
      };
    } catch (error) {
      if (error instanceof HistoryRequestError) throw error;
      const message =
        error instanceof Error
          ? error.message
          : error &&
              typeof error === 'object' &&
              'message' in error &&
              typeof error.message === 'string'
            ? error.message
            : String(error);
      throw new HistoryRequestError(message, historyErrorCode(error));
    }
  }

  async addRecord(record: NewTransaction): Promise<void> {
    validateValues(record);
    const when = timestamp(record.timestamp);
    const schema = await this.getRecordType();
    const fields: Record<string, unknown> = {};
    const mapped = new Set(Object.values(this.config.fields));
    for (const field of schema.fields) {
      if (!mapped.has(field.key) && validDefault(field)) fields[field.key] = field.default;
    }
    fields[this.config.fields.vehicle_id] = record.vehicle_id;
    fields[this.config.fields.fuel_type] = record.fuel_type;
    fields[this.config.fields.quantity] = record.quantity;
    fields[this.config.fields.unit_price] = record.unit_price;
    fields[this.config.fields.total_cost] = record.total_cost;
    if (
      record.vehicle_name &&
      schema.fields.some((f) => f.key === this.config.fields.vehicle_name)
    ) {
      fields[this.config.fields.vehicle_name] = record.vehicle_name;
    }
    const result = object(
      await this.request<unknown>({
        type: 'custom_records/add_record',
        record_type: this.config.record_type,
        fields,
        timestamp: when,
      }),
      'add record',
    );
    text(object(result.record, 'saved record').id, 'saved record ID');
    this.invalidate();
  }

  async deleteRecord(id: string): Promise<void> {
    const result = object(
      await this.request<unknown>({
        type: 'custom_records/delete_record',
        record_type: this.config.record_type,
        record_id: text(id, 'record ID'),
      }),
      'delete record',
    );
    if (result.deleted !== true) throw new Error('The record deletion was not confirmed.');
    this.invalidate();
  }

  subscribeUpdates(callback: () => void): Promise<Unsubscribe> {
    return this.hass.connection.subscribeEvents((event) => {
      if (event.data.record_type === this.config.record_type) {
        this.invalidate();
        callback();
      }
    }, 'custom_records_updated');
  }
}
