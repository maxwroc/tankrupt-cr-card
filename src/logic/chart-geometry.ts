import Decimal from 'decimal.js-light';

export interface PlotPoint {
  x: number;
  y: number;
  value: number | null;
}

export interface AxisTick {
  value: number;
  y: number;
}

// Decimal arithmetic keeps the outward rounding finite even when a double's
// range overflows, or its padding is smaller than the smallest positive double.
function niceDomain(values: number[], height: number) {
  const low = new Decimal(values.length ? Math.min(...values) : 0);
  const high = new Decimal(values.length ? Math.max(...values) : 0);
  const spread = high.minus(low);
  const padding = (
    spread.isZero() ? (high.abs().isZero() ? new Decimal(10) : high.abs()) : spread
  ).times(0.1);
  const lower = low.gte(0) && low.minus(padding).lt(0) ? new Decimal(0) : low.minus(padding);
  const upper = high.plus(padding);
  const intervals = Math.max(2, Math.min(4, Math.floor(height / 60)));
  const rough = upper.minus(lower).div(intervals);
  const power = new Decimal(`1e${rough.exponent()}`);
  const factor = [1, 2, 2.5, 5, 10].find((candidate) => power.times(candidate).gte(rough))!;
  const chosen = power.times(factor);
  const step = chosen.lt(Number.MIN_VALUE) ? new Decimal(Number.MIN_VALUE) : chosen;
  const first = lower.div(step).toDecimalPlaces(0, Decimal.ROUND_FLOOR);
  const last = upper.div(step).toDecimalPlaces(0, Decimal.ROUND_CEIL);
  const ticks: number[] = [];
  for (let index = first; index.lte(last); index = index.plus(1)) {
    const value = Math.max(
      -Number.MAX_VALUE,
      Math.min(Number.MAX_VALUE, index.times(step).toNumber()),
    );
    if (ticks[ticks.length - 1] !== value) ticks.push(value === 0 ? 0 : value);
  }
  return {
    min: ticks[0],
    max: ticks[ticks.length - 1],
    ticks,
    step: Math.min(Number.MAX_VALUE, step.toNumber()),
  };
}

export function chartGeometry(
  values: (number | null)[],
  width = 520,
  height = 180,
): {
  points: PlotPoint[];
  min: number;
  max: number;
  paths: string[];
  ticks: AxisTick[];
  tickStep: number;
} {
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  const { min, max, ticks, step: tickStep } = niceDomain(finite, height);
  // Normalize first so a large domain cannot overflow during interpolation.
  const scale = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const scaledMin = min / scale;
  const scaledSpan = max / scale - scaledMin;
  const y = (value: number) =>
    Math.max(0, Math.min(height, height * (1 - (value / scale - scaledMin) / scaledSpan)));
  const step = width / Math.max(1, values.length);
  const points = values.map((value, index) => ({
    x: step * (index + 0.5),
    y: value === null || !Number.isFinite(value) ? height : y(value),
    value: value !== null && Number.isFinite(value) ? value : null,
  }));
  const paths: string[] = [];
  let path = '';
  for (const point of points) {
    if (point.value === null) {
      if (path) paths.push(path);
      path = '';
    } else path += `${path ? ' L' : 'M'}${point.x},${point.y}`;
  }
  if (path) paths.push(path);
  return {
    points,
    min,
    max,
    paths,
    ticks: ticks.map((value) => ({ value, y: y(value) })),
    tickStep,
  };
}
