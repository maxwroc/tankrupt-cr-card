import type { Hass } from '../types';
import { localeFor } from '../config';

export const LABELS = {
  add: 'Add transaction',
  cancel: 'Cancel',
  save: 'Save transaction',
  saving: 'Saving…',
  spending: 'Spending',
  price: 'Effective unit price',
  quantity: 'Quantity',
  recent: 'Recent transactions',
  allVehicles: 'All vehicles',
  allFuels: 'All fuels',
  unassigned: 'Unassigned',
  refresh: 'Refresh',
  remove: 'Delete transaction',
  deleting: 'Deleting…',
};

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function number(value: number, locale: string, digits = 3): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

export function money(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

export function date(value: string, hass: Hass, time = false): string {
  return new Intl.DateTimeFormat(localeFor(hass), {
    timeZone: hass.config.time_zone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(time ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
  }).format(new Date(value));
}

export function emit(target: HTMLElement, name: string, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
