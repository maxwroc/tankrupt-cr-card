import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeConfig } from '../src/config';
import { FuelChart } from '../src/custom-elements/fuel-chart';
import { chartGeometry } from '../src/logic/chart-geometry';
import type { ChartSeries, Hass, Metric } from '../src/types';

const hass: Hass = {
  config: { time_zone: 'UTC', currency: 'GBP' },
  locale: { language: 'en-GB' },
  connection: { sendMessagePromise: vi.fn(), subscribeEvents: vi.fn() },
};

function series(values: (number | null)[], fuel?: ChartSeries['fuel']): ChartSeries {
  return {
    id: fuel ?? 'all',
    label: fuel ?? 'All fuels',
    fuel,
    points: values.map((value, index) => ({
      start: `2026-${String(index + 1).padStart(2, '0')}-01T00:00:00Z`,
      end: `2026-${String(index + 1).padStart(2, '0')}-28T23:59:59Z`,
      totals: { count: value === null ? 0 : 1, cost: value ?? 0, quantity: value === null ? 0 : 1 },
    })),
  };
}

async function flush(element: FuelChart) {
  await element.updateComplete;
  await element.updateComplete;
}

let width = 180;
let onResize: () => void;
const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  width = 180;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const measured = this.classList.contains('range')
      ? width
      : this.classList.contains('x-label')
        ? 40
        : this.classList.contains('detail')
          ? Math.min(120, parseFloat(this.style.maxWidth) || 120)
          : 0;
    const height = this.classList.contains('detail') ? 36 : 16;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: measured,
      bottom: height,
      width: measured,
      height,
      toJSON: () => ({}),
    };
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observe.mockClear();
  disconnect.mockClear();
});

async function chart(data: ChartSeries[], metric: Metric = 'spending') {
  const element = new FuelChart();
  element.config = normalizeConfig({
    type: 'custom:tankrupt-cr-card',
    record_type: 'fuel_purchases',
  });
  element.hass = hass;
  element.series = data;
  element.metric = metric;
  document.body.append(element);
  await flush(element);
  return element;
}

function visibleDates(element: FuelChart) {
  return [...element.shadowRoot!.querySelectorAll<HTMLElement>('.x-label')].filter(
    (label) => label.style.visibility === 'visible',
  );
}

describe('nice chart axes', () => {
  it('places tooltips beside each bar and flips sides to avoid covering it', async () => {
    const element = await chart([series([100, 150, 120])]);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 360, 100));
    const points = [...element.shadowRoot!.querySelectorAll<SVGElement>('.point')];
    const marks = [
      new DOMRect(100, 215, 20, 65),
      new DOMRect(270, 260, 20, 20),
      new DOMRect(440, 230, 20, 50),
    ];
    points.forEach((point, index) => {
      vi.spyOn(point.querySelector('.mark')!, 'getBoundingClientRect').mockReturnValue(
        marks[index],
      );
    });
    for (const [index, event] of ['pointerenter', 'focus', 'click'].entries()) {
      points[index].dispatchEvent(new Event(event));
      await flush(element);
      const tooltip = element.shadowRoot!.querySelector<HTMLElement>('.detail')!;
      expect(tooltip.style.left).toBe(`${[28, 198, 212][index]}px`);
      expect(tooltip.style.top).toBe(`${[29.5, 52, 37][index]}px`);
      expect(tooltip.style.visibility).toBe('visible');
    }
    points[2].dispatchEvent(new Event('pointerleave'));
    points[0].dispatchEvent(new Event('pointerenter'));
    await flush(element);
    expect(element.shadowRoot!.querySelector<HTMLElement>('.detail')!.style.left).toBe('212px');
    points[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush(element);
    expect(element.shadowRoot!.querySelector('.detail')).toBeNull();
  });

  it('positions price details in the selected fuel panel and follows resizing while pinned', async () => {
    const element = await chart([series([0.2], 'petrol'), series([0.3], 'electricity')], 'price');
    let bounds = new DOMRect(100, 200, 360, 240);
    let mark = new DOMRect(276.5, 376.5, 7, 7);
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => bounds);
    const point = element.shadowRoot!.querySelectorAll<SVGElement>('.point')[1];
    vi.spyOn(point.querySelector('.mark')!, 'getBoundingClientRect').mockImplementation(() => mark);
    point.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush(element);
    const tooltip = element.shadowRoot!.querySelector<HTMLElement>('.detail')!;
    expect(tooltip.style.left).toBe('191.5px');
    expect(tooltip.style.top).toBe('162px');
    bounds = new DOMRect(100, 200, 180, 240);
    mark = new DOMRect(186.5, 396.5, 7, 7);
    onResize();
    await flush(element);
    expect(tooltip.style.left).toBe('101.5px');
    expect(tooltip.style.maxWidth).toBe('78.5px');
    expect(tooltip.style.top).toBe('182px');
    bounds = new DOMRect(100, 200, 360, 240);
    mark = new DOMRect(276.5, 376.5, 7, 7);
    onResize();
    await flush(element);
    expect(tooltip.style.maxWidth).toBe('120px');
    expect(tooltip.style.left).toBe('191.5px');
    element.series = [series([0.4])];
    await flush(element);
    expect(element.shadowRoot!.querySelector('.detail')).toBeNull();
  });

  it('plots the actual rounded domain, sharing Y positions with grids and labels', async () => {
    const values = [2350, 2406];
    const element = await chart([series(values)]);
    const geometry = chartGeometry(values, 360, 80);
    const root = element.shadowRoot!;
    expect([...root.querySelectorAll('.y-label')].map((tick) => tick.textContent)).toEqual([
      '£2,450',
      '£2,400',
      '£2,350',
      '£2,300',
    ]);
    const grids = [...root.querySelectorAll('.grid')];
    grids.forEach((grid, index) => {
      expect(Number(grid.getAttribute('y1'))).toBe(geometry.ticks[index].y);
      expect(grid.getAttribute('y1')).toBe(grid.getAttribute('y2'));
      const label = root.querySelector<HTMLElement>(
        `.y-label[data-value="${geometry.ticks[index].value}"]`,
      )!;
      expect(parseFloat(label.style.top)).toBeCloseTo((geometry.ticks[index].y / 80) * 100);
    });
    const marks = [...root.querySelectorAll('.mark')];
    expect(marks.map((mark) => Number(mark.getAttribute('y')))).toEqual(
      geometry.points.map((point) => point.y),
    );
    expect(root.querySelector('figcaption')).toBeNull();
    expect(root.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 360 80');
    expect(root.querySelector('desc')!.textContent).toContain('Truncated baseline');
    const point = root.querySelectorAll('.point')[1];
    point.dispatchEvent(new Event('pointerenter'));
    await flush(element);
    expect(root.querySelector('.detail')!.textContent).toBe('1 Feb 2026 – 28 Feb 2026\n£2,406.00');
    expect(point.querySelector('title')!.textContent).toBe('1 Feb 2026 – 28 Feb 2026\n£2,406.00');
  });

  it('keeps twelve chronological slots, missing gaps, and a real zero', async () => {
    const values: (number | null)[] = Array.from({ length: 12 }, () => null);
    values[9] = 0;
    values[11] = 2406;
    const element = await chart([series(values)]);
    const marks = [...element.shadowRoot!.querySelectorAll('.mark')];
    expect(marks).toHaveLength(2);
    expect(Number(marks[0].getAttribute('x')) + Number(marks[0].getAttribute('width')) / 2).toBe(
      285,
    );
    expect(Number(marks[1].getAttribute('x')) + Number(marks[1].getAttribute('width')) / 2).toBe(
      345,
    );
    expect(element.shadowRoot!.querySelector('.y-label[data-value="0"]')!.textContent).toBe('£0');
    expect(visibleDates(element).map((label) => label.dataset.index)).toEqual(['0', '5', '11']);
  });

  it('adapts date density to measured plot width without changing the time positions', async () => {
    const element = await chart([series(Array.from({ length: 12 }, () => 100))]);
    expect(visibleDates(element).map((label) => label.dataset.x)).toEqual(['15', '165', '345']);
    expect(visibleDates(element).map((label) => label.style.left)).toEqual([
      '0px',
      '62.5px',
      '140px',
    ]);
    width = 720;
    onResize();
    await flush(element);
    expect(visibleDates(element)).toHaveLength(12);
    width = 50;
    onResize();
    await flush(element);
    expect(visibleDates(element)).toHaveLength(1);
    width = 0;
    onResize();
    await flush(element);
    expect(visibleDates(element)).toHaveLength(0);
    const calls = disconnect.mock.calls.length;
    element.remove();
    expect(disconnect.mock.calls.length).toBe(calls + 1);
  });

  it('uses actual width with the observer-less fallback and removes the listener', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const remove = vi.spyOn(window, 'removeEventListener');
    const element = await chart([series(Array.from({ length: 12 }, () => 100))]);
    width = 100;
    window.dispatchEvent(new Event('resize'));
    await flush(element);
    expect(visibleDates(element).map((label) => label.dataset.index)).toEqual(['0', '11']);
    element.remove();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('retains separate fuel axes, fractional price precision and disconnected paths', async () => {
    const element = await chart(
      [series([0.045, null, 0.055], 'petrol'), series([1, 1.1, 1.2], 'electricity')],
      'price',
    );
    const figures = [...element.shadowRoot!.querySelectorAll('figure')];
    expect(figures).toHaveLength(2);
    expect(figures[0].querySelectorAll('.line')).toHaveLength(2);
    expect([...figures[0].querySelectorAll('.y-label')].map((label) => label.textContent)).toEqual([
      '0.06',
      '0.05',
      '0.04',
    ]);
    expect(figures[0].querySelector('figcaption')!.textContent).toContain('GBP / 1 L');
    expect(figures[1].querySelector('figcaption')!.textContent).toContain('GBP / 1 kWh');
    element.metric = 'quantity';
    await flush(element);
    expect(element.shadowRoot!.querySelectorAll('figure')).toHaveLength(2);
    expect(element.shadowRoot!.querySelectorAll('.line')).toHaveLength(0);
  });

  it('does not plot recordless totals or render empty axes', async () => {
    const element = await chart([series([null, null])]);
    expect(element.shadowRoot!.querySelector('svg')).toBeNull();
    expect(element.shadowRoot!.textContent).toContain('No transactions');
  });
});
