import Decimal from 'decimal.js-light';
import type { Fuel, PriceBasis, Unit } from '../types';

export const UNIT_FACTORS: Record<Unit, string> = {
  L: '1',
  US_gal: '3.785411784',
  imp_gal: '4.54609',
  kWh: '1',
};

export function checkUnit(fuel: Fuel, unit: Unit): void {
  if (!(unit in UNIT_FACTORS) || (fuel === 'electricity') !== (unit === 'kWh')) {
    throw new Error('The quantity unit is incompatible with the selected fuel.');
  }
}

export function displayQuantity(canonical: number, unit: Unit): number {
  return new Decimal(canonical).div(UNIT_FACTORS[unit]).toNumber();
}

export function displayPrice(canonical: number, unit: Unit, basis: PriceBasis): number {
  return new Decimal(canonical).times(UNIT_FACTORS[unit]).times(basis).toNumber();
}

export function parseDecimal(text: string, locale = 'en'): Decimal {
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ??
    '.';
  const normalized = text.trim().replace(decimal, '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    throw new Error('Enter a number without grouping separators.');
  }
  const value = new Decimal(normalized);
  if (!Number.isFinite(value.toNumber())) throw new Error('The number is too large.');
  return value;
}
