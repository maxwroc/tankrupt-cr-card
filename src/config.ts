import { FUELS } from './const';
import type { CardConfig, FieldMapping, Fuel, Hass, ResolvedConfig, Unit, Vehicle } from './types';

export class ConfigError extends Error {}

export const DEFAULT_FIELDS: FieldMapping = {
  vehicle_id: 'vehicle_id',
  fuel_type: 'fuel_type',
  quantity: 'quantity',
  unit_price: 'unit_price',
  total_cost: 'total_cost',
  vehicle_name: 'vehicle_name',
};

const KEY = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function fail(message: string): never {
  throw new ConfigError(message);
}

function oneOf<T>(value: unknown, allowed: readonly T[], name: string): T {
  const result = allowed.find((item) => item === value);
  return result === undefined ? fail(`${name} must be one of: ${allowed.join(', ')}.`) : result;
}

function integer(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function validKey(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > 63 || !KEY.test(value)) {
    fail(`${name} must use lowercase letters, digits and single underscores.`);
  }
  return value;
}

function flag(value: unknown, name: string): boolean {
  if (value === undefined) return true;
  return typeof value === 'boolean' ? value : fail(`${name} must be a boolean.`);
}

function vehicle(value: Vehicle): Vehicle {
  if (!value || typeof value !== 'object') fail('Invalid vehicle configuration.');
  const id = validKey(value.id, 'Vehicle ID');
  if (id === 'unassigned') fail('Vehicle ID "unassigned" is reserved.');
  if (typeof value.name !== 'string' || !value.name.trim()) {
    fail(`Vehicle ${id} needs a name.`);
  }
  if (!Array.isArray(value.fuels) || value.fuels.length === 0) {
    fail(`Vehicle ${id} needs at least one fuel.`);
  }
  const fuels = [...new Set(value.fuels.map((f) => oneOf(f, FUELS, 'Fuel')))];
  const unit =
    value.unit === undefined
      ? undefined
      : oneOf<Unit>(value.unit, ['L', 'US_gal', 'imp_gal', 'kWh'], 'Vehicle unit');
  if (
    (unit === 'kWh' && fuels.some((f) => f !== 'electricity')) ||
    (unit && unit !== 'kWh' && fuels.every((f) => f === 'electricity'))
  ) {
    fail(`Vehicle ${id} has an incompatible unit. Hybrid unit overrides are liquid units.`);
  }
  if (
    value.image !== undefined &&
    (typeof value.image !== 'string' || !/^(https?:\/\/|\/(?!\/))/.test(value.image))
  ) {
    fail(`Vehicle ${id} image must be an HTTP(S) URL or a local / path.`);
  }
  return {
    id,
    name: value.name.trim(),
    fuels,
    image: value.image,
    unit,
    price_basis:
      value.price_basis === undefined
        ? undefined
        : oneOf(value.price_basis, [1, 100] as const, 'Vehicle price_basis'),
  };
}

export function normalizeConfig(config: CardConfig): ResolvedConfig {
  if (!config || typeof config !== 'object') fail('Card configuration is required.');
  const record_type = validKey(config.record_type, 'record_type');
  if (config.title !== undefined && typeof config.title !== 'string') {
    fail('title must be a string.');
  }
  if (config.vehicles !== undefined && !Array.isArray(config.vehicles)) {
    fail('vehicles must be a list.');
  }
  const vehicles = (config.vehicles ?? []).map(vehicle);
  if (new Set(vehicles.map((v) => v.id)).size !== vehicles.length) {
    fail('Vehicle IDs must be unique.');
  }
  if (
    config.fields !== undefined &&
    (!config.fields || typeof config.fields !== 'object' || Array.isArray(config.fields))
  ) {
    fail('fields must be a mapping.');
  }
  const fields = { ...DEFAULT_FIELDS, ...config.fields };
  for (const [name, key] of Object.entries(fields)) {
    if (!(name in DEFAULT_FIELDS)) fail(`Unknown field mapping ${name}.`);
    validKey(key, `fields.${name}`);
    if (key === 'id' || key === 'timestamp') fail(`${key} is a reserved record field.`);
  }
  if (new Set(Object.values(fields)).size !== Object.keys(fields).length) {
    fail('Field mappings must be unique.');
  }
  if (
    config.graph !== undefined &&
    (!config.graph || typeof config.graph !== 'object' || Array.isArray(config.graph))
  ) {
    fail('graph must be a mapping.');
  }
  if (
    config.filter !== undefined &&
    (!config.filter || typeof config.filter !== 'object' || Array.isArray(config.filter))
  ) {
    fail('filter must be a mapping.');
  }
  for (const key of Object.keys(config.filter ?? {})) {
    if (key !== 'vehicle' && key !== 'fuel') fail(`Unknown filter ${key}.`);
  }
  return {
    type: 'custom:tankrupt-cr-card',
    record_type,
    title: config.title ?? 'Tankrupt',
    currency: config.currency === undefined ? undefined : validateCurrency(config.currency),
    billing_start_day: integer(config.billing_start_day ?? 1, 1, 31, 'billing_start_day'),
    input_mode: oneOf(
      config.input_mode ?? 'quantity_total',
      ['quantity_total', 'quantity_price'] as const,
      'input_mode',
    ),
    liquid_unit: oneOf(
      config.liquid_unit ?? 'L',
      ['L', 'US_gal', 'imp_gal'] as const,
      'liquid_unit',
    ),
    price_basis: oneOf(config.price_basis ?? 1, [1, 100] as const, 'price_basis'),
    graph: {
      metric: oneOf(
        config.graph?.metric ?? 'spending',
        ['spending', 'price', 'quantity'] as const,
        'graph.metric',
      ),
      periods: oneOf(config.graph?.periods ?? 12, [1, 3, 6, 12] as const, 'graph.periods'),
    },
    filter: {
      ...(config.filter?.vehicle !== undefined
        ? { vehicle: validKey(config.filter.vehicle, 'filter.vehicle') }
        : {}),
      ...(config.filter?.fuel !== undefined
        ? { fuel: oneOf(config.filter.fuel, FUELS, 'filter.fuel') }
        : {}),
    },
    trend_display: oneOf(
      config.trend_display ?? 'percentage',
      ['percentage', 'amount'] as const,
      'trend_display',
    ),
    recent_limit: integer(config.recent_limit ?? 20, 1, 500, 'recent_limit'),
    vehicles,
    fields,
    show_summary: flag(config.show_summary, 'show_summary'),
    show_trend: flag(config.show_trend, 'show_trend'),
    show_chart: flag(config.show_chart, 'show_chart'),
    show_add_button: flag(config.show_add_button, 'show_add_button'),
    show_recent_records: flag(config.show_recent_records, 'show_recent_records'),
  };
}

export function validateCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z]{3}$/i.test(value)) {
    fail('Choose a three-letter currency code in HA settings or card configuration.');
  }
  return value.toUpperCase();
}

export function currencyFor(config: ResolvedConfig, hass: Hass): string {
  return validateCurrency(config.currency ?? hass.config.currency);
}

export function localeFor(hass: Hass): string {
  return hass.locale?.language ?? hass.language ?? 'en';
}

export function unitFor(config: ResolvedConfig, fuel: Fuel, vehicleId?: string): Unit {
  if (fuel === 'electricity') return 'kWh';
  const override = config.vehicles.find((v) => v.id === vehicleId)?.unit;
  return override && override !== 'kWh' ? override : config.liquid_unit;
}

export function basisFor(config: ResolvedConfig, vehicleId?: string): 1 | 100 {
  return config.vehicles.find((v) => v.id === vehicleId)?.price_basis ?? config.price_basis;
}
