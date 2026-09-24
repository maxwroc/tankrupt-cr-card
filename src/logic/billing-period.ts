import { Temporal } from '@js-temporal/polyfill';
import type { BillingPeriods, PeriodCount, TimeRange } from '../types';

function anchor(month: Temporal.PlainYearMonth, day: number, zone: string): Temporal.Instant {
  return month
    .toPlainDate({ day: Math.min(day, month.daysInMonth) })
    .toZonedDateTime(zone)
    .toInstant();
}

function activeMonth(now: Temporal.Instant, zone: string, day: number): Temporal.PlainYearMonth {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('Invalid billing start day.');
  const local = now.toZonedDateTimeISO(zone);
  const month = Temporal.PlainYearMonth.from({ year: local.year, month: local.month });
  return Temporal.Instant.compare(now, anchor(month, day, zone)) < 0
    ? month.subtract({ months: 1 })
    : month;
}

export function iso(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: 'microseconds', roundingMode: 'floor' });
}

export function nowInstant(): string {
  return iso(Temporal.Now.instant());
}

export function billingPeriods(now: string, zone: string, day: number): BillingPeriods {
  const instant = Temporal.Instant.from(now);
  const month = activeMonth(instant, zone, day);
  const start = anchor(month, day, zone);
  return {
    current: { start: iso(start), end: iso(instant) },
    previous: {
      start: iso(anchor(month.subtract({ months: 1 }), day, zone)),
      end: iso(start.subtract({ microseconds: 1 })),
    },
  };
}

export function chartRanges(
  now: string,
  zone: string,
  day: number,
  periods: PeriodCount,
): TimeRange[] {
  const instant = Temporal.Instant.from(now);
  const active = activeMonth(instant, zone, day);
  const first = active.subtract({ months: periods - 1 });
  const ranges: TimeRange[] = [];
  let start = anchor(first, day, zone);
  let month = first;
  while (Temporal.Instant.compare(start, instant) <= 0) {
    let next: Temporal.Instant;
    if (periods === 1 || periods === 3) {
      const date = start.toZonedDateTimeISO(zone).toPlainDate();
      const days = periods === 1 ? 1 : 8 - date.dayOfWeek;
      next = date.add({ days }).toZonedDateTime(zone).toInstant();
    } else {
      month = month.add({ months: 1 });
      next = anchor(month, day, zone);
    }
    const end =
      Temporal.Instant.compare(next, instant) > 0 ? instant : next.subtract({ microseconds: 1 });
    ranges.push({ start: iso(start), end: iso(end) });
    start = next;
    if (ranges.length > 32) throw new Error('Chart range exceeds the supported bucket count.');
  }
  return ranges;
}

export function localDateTime(now: string, zone: string): string {
  return Temporal.Instant.from(now)
    .toZonedDateTimeISO(zone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minutes' });
}

export function transactionTimestamp(local: string, zone: string): string {
  try {
    return iso(
      Temporal.PlainDateTime.from(local)
        .toZonedDateTime(zone, {
          disambiguation: 'reject',
        })
        .toInstant(),
    );
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(
        'Choose a valid, unambiguous local date/time (check the daylight-saving transition).',
      );
    }
    throw error;
  }
}
