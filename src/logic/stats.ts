import type { Metric, PriceBasis, Totals, Unit } from '../types';
import { displayPrice, displayQuantity } from './units';

export interface Trend {
  direction: 'up' | 'down' | 'flat' | 'none';
  delta: number;
  percent: number | null;
  label: string;
}

export function spendingTrend(current: Totals, previous: Totals): Trend {
  const delta = current.cost - previous.cost;
  if (!previous.count)
    return { direction: 'none', delta, percent: null, label: 'No previous data' };
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const percent = previous.cost > 0 ? (delta / previous.cost) * 100 : delta === 0 ? 0 : null;
  return {
    direction,
    delta,
    percent,
    label:
      direction === 'flat'
        ? 'No change'
        : previous.cost === 0
          ? 'New spending'
          : direction === 'up'
            ? 'More spending'
            : 'Less spending',
  };
}

export function metricValue(
  totals: Totals,
  metric: Metric,
  unit: Unit,
  basis: PriceBasis,
): number | null {
  if (metric === 'spending') return totals.cost;
  if (metric === 'quantity') return displayQuantity(totals.quantity, unit);
  return totals.quantity > 0 ? displayPrice(totals.cost / totals.quantity, unit, basis) : null;
}
