import { describe, expect, it } from 'vitest';
import { chartGeometry } from '../src/logic/chart-geometry';
import { chartDateLabels, formatChartTick, selectDateTicks } from '../src/logic/chart-ticks';

describe('chart geometry', () => {
  it('keeps missing prices as gaps while preserving legitimate zero prices', () => {
    const chart = chartGeometry([2, null, 0, 4]);
    expect(chart.min).toBe(0);
    expect(chart.max).toBe(6);
    expect(chart.paths).toHaveLength(2);
    expect(chart.points[2]).toMatchObject({ value: 0, y: 180 });
    expect(chart.paths[1]).toContain(' L');
  });
  it('handles empty, all-zero and nonfinite inputs without invalid coordinates', () => {
    expect(chartGeometry([])).toMatchObject({ min: 0, max: 1, paths: [], points: [] });
    expect(
      chartGeometry([0, null, Infinity, NaN]).points.every(
        (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
      ),
    ).toBe(true);
    expect(chartGeometry([Infinity]).paths).toEqual([]);
  });

  it('uses a padded nonzero baseline to expose differences between positive values', () => {
    const chart = chartGeometry([100, 101, 102], 360, 80);
    expect(chart.min).toBe(98);
    expect(chart.max).toBe(104);
    expect(chart.points[0].y - chart.points[2].y).toBeGreaterThan(25);
    expect(chart.points.every((point) => point.y > 0 && point.y < 80)).toBe(true);
  });

  it('retains all twelve slots, including leading and interior gaps', () => {
    const values: (number | null)[] = Array.from({ length: 12 }, () => null);
    values[9] = 100;
    values[11] = 101;
    const chart = chartGeometry(values, 360, 80);
    expect(chart.points).toHaveLength(12);
    expect(chart.points[9].x).toBe(285);
    expect(chart.points[10].value).toBeNull();
    expect(chart.points[11].x).toBe(345);
    expect(chart.min).toBeGreaterThan(0);
    expect(chart.paths).toHaveLength(2);
  });

  it.each([
    [100],
    [100, 100],
    [0],
    [0, 0],
    [1e-12],
    [Number.MIN_VALUE],
    [Number.MAX_VALUE],
    [1e300, 1.1e300],
    [-Number.MAX_VALUE, Number.MAX_VALUE],
    [-Number.MIN_VALUE, Number.MIN_VALUE],
    [Number.MAX_VALUE * (1 - Number.EPSILON), Number.MAX_VALUE],
    [Number.MIN_VALUE, Number.MIN_VALUE * 2],
    [-100],
  ])(
    'keeps equal, tiny, and large values inside a finite non-degenerate domain: %j',
    (...values) => {
      const chart = chartGeometry(values);
      expect(Number.isFinite(chart.min)).toBe(true);
      expect(Number.isFinite(chart.max)).toBe(true);
      expect(chart.max).toBeGreaterThan(chart.min);
      expect(chart.min).toBeLessThanOrEqual(Math.min(...values));
      expect(chart.max).toBeGreaterThanOrEqual(Math.max(...values));
      expect(new Set(chart.ticks.map((tick) => tick.value)).size).toBe(chart.ticks.length);
      const labels = chart.ticks.map((tick) =>
        formatChartTick(tick.value, chart.tickStep, 'en-GB'),
      );
      expect(new Set(labels).size).toBe(labels.length);
      expect(
        chart.points.every((point) => Number.isFinite(point.y) && point.y >= 0 && point.y <= 180),
      ).toBe(true);
    },
  );

  it.each([
    { values: [2350, 2406], ticks: [2300, 2350, 2400, 2450], step: 50 },
    { values: [2300, 2406], ticks: [2200, 2300, 2400, 2500], step: 100 },
    { values: [1000, 2000, 3000], ticks: [0, 2000, 4000], step: 2000 },
    { values: [100, 150, 200], ticks: [0, 100, 200, 300], step: 100 },
    { values: [0.9, 1, 1.1], ticks: [0.8, 1, 1.2], step: 0.2 },
    { values: [0.045, 0.05, 0.055], ticks: [0.04, 0.05, 0.06], step: 0.01 },
    { values: [0, 4], ticks: [0, 2.5, 5], step: 2.5 },
  ])('rounds the actual compact domain and tick positions: $values', ({ values, ticks, step }) => {
    const chart = chartGeometry(values, 360, 80);
    expect(chart.tickStep).toBe(step);
    expect(chart.ticks.map((tick) => tick.value)).toEqual(ticks);
    expect(chart.min).toBe(ticks[0]);
    expect(chart.max).toBe(ticks[ticks.length - 1]);
    chart.ticks.forEach((tick, index) => {
      expect(tick.y).toBeCloseTo(80 * (1 - index / (ticks.length - 1)), 10);
    });
    chart.points.forEach((point, index) => {
      expect(point.value).toBe(values[index]);
      expect(point.y).toBeCloseTo((80 * (chart.max - values[index])) / (chart.max - chart.min), 10);
    });
  });

  it('uses more ticks only when the plot height allows them', () => {
    expect(chartGeometry([1000, 3000], 360, 80).ticks).toHaveLength(3);
    expect(chartGeometry([1000, 3000], 360, 240).ticks).toHaveLength(5);
  });

  it('keeps representable nearby values distinct across decimal orders of magnitude', () => {
    for (const exponent of [-323, -300, -100, -13, -3, 0, 6, 100, 300, 308]) {
      for (const sign of [-1, 1]) {
        const value = sign * 10 ** exponent;
        const values = [value, value * (1 + Number.EPSILON), value * 1.01];
        const geometry = chartGeometry(values, 360, 80);
        expect(geometry.min).toBeLessThanOrEqual(Math.min(...values));
        expect(geometry.max).toBeGreaterThanOrEqual(Math.max(...values));
        expect(geometry.ticks.length).toBeGreaterThanOrEqual(2);
        expect(geometry.ticks.length).toBeLessThanOrEqual(4);
        const labels = geometry.ticks.map((tick) =>
          formatChartTick(tick.value, geometry.tickStep, 'en-GB', 'GBP'),
        );
        expect(new Set(labels).size).toBe(labels.length);
        geometry.points.forEach((point) => {
          expect(Number.isFinite(point.y)).toBe(true);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(80);
        });
      }
    }
  });

  it('formats tick precision independently of exact money/tooltips', () => {
    expect(formatChartTick(2400, 50, 'en-GB', 'GBP')).toBe('£2,400');
    expect(formatChartTick(100, 50, 'en-GB', 'GBP')).toBe('£100');
    expect(formatChartTick(1, 0.2, 'en-GB', 'GBP')).toBe('£1');
    expect(formatChartTick(1.2, 0.2, 'en-GB', 'GBP')).toBe('£1.2');
    expect(formatChartTick(0.05, 0.01, 'en-GB', 'GBP')).toBe('£0.05');
    expect(formatChartTick(2.5, 2.5, 'de-DE')).toBe('2,5');
    expect(formatChartTick(-0, 5, 'en-GB')).toBe('0');
  });
});

describe('adaptive date ticks', () => {
  const labels = Array.from({ length: 12 }, (_, index) => `Month ${index + 1}`);
  const widths = labels.map(() => 40);
  it('uses real bucket centers for first/middle/last at compact width', () => {
    const ticks = selectDateTicks(labels, widths, 180);
    expect(ticks.map((tick) => tick.index)).toEqual([0, 5, 11]);
    expect(ticks.map((tick) => tick.x)).toEqual([7.5, 82.5, 172.5]);
    expect(ticks.map((tick) => tick.left)).toEqual([0, 62.5, 140]);
  });
  it.each([50, 100, 180, 360, 720])('has no overlapping/out-of-bounds labels at %d px', (width) => {
    const ticks = selectDateTicks(labels, widths, width);
    expect(ticks.length).toBeGreaterThan(0);
    ticks.forEach((tick, index) => {
      expect(tick.left).toBeGreaterThanOrEqual(0);
      expect(tick.left + tick.width).toBeLessThanOrEqual(width);
      if (index)
        expect(tick.left).toBeGreaterThanOrEqual(
          ticks[index - 1].left + ticks[index - 1].width + 8,
        );
    });
    if (width === 50) expect(ticks).toHaveLength(1);
    if (width === 100) expect(ticks.map((tick) => tick.index)).toEqual([0, 11]);
    if (width === 720) expect(ticks).toHaveLength(12);
  });
  it('does not invent widths, overflow unavoidably narrow plots, or repeat labels', () => {
    expect(selectDateTicks(labels, widths, 0)).toEqual([]);
    expect(selectDateTicks(labels, widths, 30)).toEqual([]);
    expect(
      selectDateTicks(
        labels,
        labels.map(() => 0),
        360,
      ),
    ).toEqual([]);
    expect(
      selectDateTicks(['Jan', 'Jan', 'Feb'], [20, 20, 20], 360).map((tick) => tick.label),
    ).toEqual(['Jan', 'Feb']);
  });
  it('formats day/week/month buckets in the HA zone, distinguishing years', () => {
    expect(
      chartDateLabels(['2026-06-01T00:00Z', '2026-06-02T00:00Z'], 'en-GB', 'UTC', false),
    ).toEqual(['1 Jun', '2 Jun']);
    expect(
      chartDateLabels(['2026-06-01T00:00Z', '2026-06-08T00:00Z'], 'en-GB', 'UTC', false),
    ).toEqual(['1 Jun', '8 Jun']);
    expect(
      chartDateLabels(['2025-12-01T00:00Z', '2026-01-01T00:00Z'], 'en-GB', 'UTC', true),
    ).toEqual(['Dec 25', 'Jan 26']);
    expect(
      chartDateLabels(['2025-12-31T00:00Z', '2026-01-01T00:00Z'], 'en-GB', 'UTC', false),
    ).toEqual(['31 Dec 25', '1 Jan 26']);
    expect(chartDateLabels(['2026-01-01T01:00Z'], 'en-GB', 'America/Los_Angeles', false)).toEqual([
      '31 Dec',
    ]);
  });
});
