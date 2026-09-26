import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeConfig } from '../src/config';
import { HistoryDialog } from '../src/custom-elements/history-dialog';
import { TankruptCard } from '../src/custom-elements/tankrupt-cr-card';
import type { HistoryDialogParams } from '../src/custom-elements/history-dialog-contract';
import type { RecentRecordsElement } from '../src/custom-elements/recent-records';
import type { Hass } from '../src/types';

class NativeButton extends HTMLElement {
  private control: HTMLButtonElement;
  constructor() {
    super();
    this.control = document.createElement('button');
    this.control.append(document.createElement('slot'));
    this.attachShadow({ mode: 'open' }).append(this.control);
  }
  get disabled() {
    return this.control.disabled;
  }
  set disabled(value: boolean) {
    this.control.disabled = value;
  }
  get appearance() {
    return this.getAttribute('data-appearance') ?? '';
  }
  set appearance(value: string) {
    this.setAttribute('data-appearance', value);
  }
  get variant() {
    return this.getAttribute('data-variant') ?? '';
  }
  set variant(value: string) {
    this.setAttribute('data-variant', value);
  }
  override focus() {
    this.control.focus();
  }
}
class NativeDialog extends HTMLElement {
  headerTitle = '';
  open = false;
}
customElements.define('ha-button', NativeButton);
customElements.define('ha-dialog', NativeDialog);

const hass: Hass = {
  config: { time_zone: 'UTC', currency: 'GBP' },
  locale: { language: 'en-GB' },
  connection: {
    sendMessagePromise: <T>() => new Promise<T>(() => {}),
    subscribeEvents: vi.fn().mockResolvedValue(() => {}),
  },
};
async function flush(element: { updateComplete: Promise<boolean> }) {
  for (let index = 0; index < 20; index++) await Promise.resolve();
  await element.updateComplete;
}
function control(element: HistoryDialog | TankruptCard, label: string) {
  return [...element.shadowRoot!.querySelectorAll<NativeButton>('ha-button')].find(
    (node) => node.getAttribute('aria-label') === label,
  )!;
}
function click(element: NativeButton) {
  element.shadowRoot!.querySelector('button')!.click();
}
async function history() {
  const params: HistoryDialogParams = {
    state: {
      config: normalizeConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel' }),
      hass,
      data: {
        records: [
          {
            id: 'r1',
            timestamp: '2026-06-12T12:00:00Z',
            vehicle_id: 'old',
            fuel_type: 'petrol',
            quantity: 10,
            total_cost: 15,
            unit_price: 1.5,
          },
        ],
      },
      available: true,
      loading: false,
      pageLoading: false,
      hasMore: true,
      restartRequired: false,
      error: '',
      availabilityMessage: '',
    },
    isActive: () => true,
    onReady: vi.fn(),
    onClosed: vi.fn(),
    retry: vi.fn(),
    restart: vi.fn(),
    loadMore: vi.fn(),
    deleteRecord: vi.fn().mockResolvedValue(undefined),
  };
  const dialog = new HistoryDialog();
  dialog.showDialog(params);
  document.body.append(dialog);
  await flush(dialog);
  return { dialog, params };
}
afterEach(() => document.body.replaceChildren());

describe('native HA actions in card and history', () => {
  it('uses compatible HA controls for Add and History while respecting disabled state', async () => {
    const card = new TankruptCard();
    card.setConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel' });
    card.hass = hass;
    document.body.append(card);
    await flush(card);
    expect(card.shadowRoot!.querySelector('button')).toBeNull();
    expect(control(card, 'Add transaction').disabled).toBe(true);
    expect(control(card, 'Add transaction').appearance).toBe('accent');
    const shown = vi.fn();
    card.addEventListener('show-dialog', shown);
    click(control(card, 'History'));
    expect(shown).toHaveBeenCalledOnce();
  });

  it('uses HA Load more with guarded pending state and restores focus after closing', async () => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    const { dialog, params } = await history();
    expect(dialog.shadowRoot!.querySelector('button')).toBeNull();
    expect(dialog.shadowRoot!.activeElement).toBe(control(dialog, 'Close'));
    click(control(dialog, 'Load more'));
    expect(params.loadMore).toHaveBeenCalledOnce();
    dialog.updateHistory({ ...params.state, pageLoading: true });
    await flush(dialog);
    expect(control(dialog, 'Load more').getAttribute('aria-busy')).toBe('true');
    click(control(dialog, 'Load more'));
    expect(params.loadMore).toHaveBeenCalledOnce();
    click(control(dialog, 'Close'));
    await flush(dialog);
    expect(params.onClosed).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(invoker);
  });

  it('uses native row/delete/back actions without duplicate mutations or lost confirmation focus', async () => {
    const { dialog, params } = await history();
    let resolve!: () => void;
    params.deleteRecord = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const list = dialog.shadowRoot!.querySelector<RecentRecordsElement>('tankrupt-recent-records')!;
    await flush(list);
    const remove = list.shadowRoot!.querySelector<NativeButton>('ha-button')!;
    expect(remove.variant).toBe('danger');
    click(remove);
    await flush(dialog);
    expect(dialog.shadowRoot!.activeElement).toBe(control(dialog, 'Back to history'));
    click(control(dialog, 'Delete transaction'));
    click(control(dialog, 'Delete transaction'));
    await flush(dialog);
    expect(params.deleteRecord).toHaveBeenCalledExactlyOnceWith('r1');
    expect(control(dialog, 'Delete transaction').disabled).toBe(true);
    expect(control(dialog, 'Back to history').disabled).toBe(true);
    resolve();
    await flush(dialog);
    expect(dialog.shadowRoot!.activeElement).toBe(control(dialog, 'Close'));
  });
});
