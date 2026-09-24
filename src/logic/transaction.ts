import Decimal from 'decimal.js-light';
import type { Fuel, InputMode, PriceBasis, TransactionValues, Unit } from '../types';
import { checkUnit, parseDecimal, UNIT_FACTORS } from './units';

export interface TransactionInput {
  fuel: Fuel;
  vehicleId?: string;
  vehicleName?: string;
  quantity: string;
  amount: string;
  mode: InputMode;
  unit: Unit;
  basis: PriceBasis;
  currency: string;
  locale?: string;
}

export function deriveTransaction(input: TransactionInput): TransactionValues {
  checkUnit(input.fuel, input.unit);
  if (input.basis !== 1 && input.basis !== 100) throw new Error('Price basis must be 1 or 100.');
  if (!['quantity_total', 'quantity_price'].includes(input.mode))
    throw new Error('Invalid input mode.');
  const quantityInput = parseDecimal(input.quantity, input.locale);
  const amount = parseDecimal(input.amount, input.locale);
  if (quantityInput.lte(0)) throw new Error('Quantity must be greater than zero.');
  if (amount.lt(0)) throw new Error('Price and total cost cannot be negative.');
  const quantity = quantityInput.times(UNIT_FACTORS[input.unit]);
  const digits =
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: input.currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const cost =
    input.mode === 'quantity_total'
      ? amount
      : quantityInput.times(amount).div(input.basis).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP);
  if (input.mode === 'quantity_total' && !amount.eq(amount.toDecimalPlaces(digits))) {
    throw new Error(`Total paid supports at most ${digits} decimal places in ${input.currency}.`);
  }
  const price =
    input.mode === 'quantity_total'
      ? cost.div(quantity)
      : amount.div(input.basis).div(UNIT_FACTORS[input.unit]);
  const result: TransactionValues = {
    vehicle_id: input.vehicleId ?? 'unassigned',
    fuel_type: input.fuel,
    quantity: quantity.toNumber(),
    unit_price: price.toNumber(),
    total_cost: cost.toNumber(),
    ...(input.vehicleName ? { vehicle_name: input.vehicleName } : {}),
  };
  for (const value of [result.quantity, result.unit_price, result.total_cost]) {
    if (!Number.isFinite(value)) throw new Error('Calculated values are too large.');
  }
  if (result.quantity <= 0 || (price.gt(0) && result.unit_price === 0)) {
    throw new Error('The number is too small to store reliably.');
  }
  return result;
}
