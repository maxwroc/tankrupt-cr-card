import Decimal from 'decimal.js-light';

export function formatChartTick(
  value: number,
  step: number,
  locale: string,
  currency?: string,
): string {
  const digits = new Decimal(step).decimalPlaces();
  const scientific = digits > 12 || Math.abs(value) >= 1e15;
  return new Intl.NumberFormat(locale, {
    ...(currency ? { style: 'currency', currency } : {}),
    ...(scientific
      ? {
          notation: 'scientific',
          maximumSignificantDigits: Math.min(
            17,
            Math.max(
              1,
              new Decimal(value || step).abs().exponent() - new Decimal(step).exponent() + 1,
            ),
          ),
        }
      : { minimumFractionDigits: 0, maximumFractionDigits: digits }),
  }).format(value === 0 ? 0 : value);
}

export function chartDateLabels(
  starts: string[],
  locale: string,
  timeZone: string,
  monthly: boolean,
): string[] {
  const yearFormatter = new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric' });
  const years = starts.map((start) => yearFormatter.format(new Date(start)));
  const includeYear = new Set(years).size > 1;
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    ...(!monthly ? { day: 'numeric' } : {}),
    ...(includeYear ? { year: '2-digit' } : {}),
  });
  return starts.map((start) => formatter.format(new Date(start)));
}

export interface DateTick {
  index: number;
  x: number;
  left: number;
  width: number;
  label: string;
}

/** Prioritize endpoints and the middle before filling the largest remaining gaps. */
export function selectDateTicks(
  labels: string[],
  widths: number[],
  width: number,
  gap = 8,
): DateTick[] {
  if (!Number.isFinite(width) || !(width > 0) || !labels.length) return [];
  const candidates = labels.map((label, index) => {
    const x = (width * (index + 0.5)) / labels.length;
    return {
      index,
      x,
      width: widths[index],
      label,
      left: Math.max(0, Math.min(width - widths[index], x - widths[index] / 2)),
    };
  });
  const selected: DateTick[] = [];
  const add = (index: number) => {
    const candidate = candidates[index];
    if (
      !Number.isFinite(candidate.width) ||
      !(candidate.width > 0) ||
      candidate.width > width ||
      selected.some(
        (tick) =>
          tick.label === candidate.label ||
          (candidate.left < tick.left + tick.width + gap &&
            candidate.left + candidate.width + gap > tick.left),
      )
    )
      return;
    selected.push(candidate);
  };
  add(0);
  add(labels.length - 1);
  add(Math.floor((labels.length - 1) / 2));
  const remaining = candidates.filter((tick) => !selected.includes(tick));
  while (remaining.length) {
    if (selected.length) {
      remaining.sort(
        (a, b) =>
          Math.min(...selected.map((tick) => Math.abs(b.x - tick.x))) -
          Math.min(...selected.map((tick) => Math.abs(a.x - tick.x))),
      );
    }
    add(remaining.shift()!.index);
  }
  return selected.sort((a, b) => a.index - b.index);
}
