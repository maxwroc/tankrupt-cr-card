import { html, LitElement, render } from 'lit';
import { property } from 'lit/decorators.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionControl } from '../src/custom-elements/action-control';
import { AddRecordDialog } from '../src/custom-elements/add-record-dialog';
import { normalizeConfig } from '../src/config';
import type { Hass, Vehicle } from '../src/types';

class ModernHaButton extends LitElement {
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean }) loading = false;
  @property() appearance = '';
  @property() variant = '';
  @property() type = 'submit';
  render() {
    return html`<button type=${this.type} ?disabled=${this.disabled}><slot></slot></button>`;
  }
}
class HaIconButton extends LitElement {
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property() label = '';
  render() {
    return html`<ha-button .disabled=${this.disabled} type="button" aria-label=${this.label}>
      <slot></slot>
    </ha-button>`;
  }
}
customElements.define('ha-button', ModernHaButton);
customElements.define('ha-icon-button', HaIconButton);

async function flush(element: LitElement) {
  await element.updateComplete;
  for (const child of element.shadowRoot?.querySelectorAll<LitElement>(
    'ha-button, ha-icon-button',
  ) ?? [])
    await flush(child);
  await element.updateComplete;
}
const hass: Hass = {
  config: { time_zone: 'UTC', currency: 'USD' },
  connection: { sendMessagePromise: vi.fn(), subscribeEvents: vi.fn() },
};
async function dialog(vehicles: Vehicle[] = [{ id: 'car', name: 'Car', fuels: ['petrol'] }]) {
  const element = new AddRecordDialog();
  element.hass = hass;
  element.config = normalizeConfig({
    type: 'custom:tankrupt-cr-card',
    record_type: 'fuel',
    vehicles,
  });
  element.save = vi.fn().mockResolvedValue(undefined);
  document.body.append(element);
  await flush(element);
  return element;
}
function nativeButton(element: Element): HTMLButtonElement {
  const inner = element.shadowRoot!.querySelector('button, ha-button')!;
  return inner instanceof HTMLButtonElement ? inner : nativeButton(inner);
}
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('registered modern HA actions', () => {
  it('maps primary, danger, pending, names and slots to actual HA controls', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    render(
      html`${actionControl({ label: 'Save', appearance: 'primary', slot: 'primaryAction' })}
      ${actionControl({ label: 'Remove', appearance: 'danger', pending: true })}
      ${actionControl({ label: 'Close', icon: true, content: html`<span>×</span>` })}`,
      container,
    );
    const [save, remove] = container.querySelectorAll<ModernHaButton>('ha-button');
    await flush(save);
    await flush(remove);
    expect(save.appearance).toBe('accent');
    expect(save.variant).toBe('brand');
    expect(save.slot).toBe('primaryAction');
    expect(save.type).toBe('button');
    expect(remove.variant).toBe('danger');
    expect(remove.disabled && remove.loading).toBe(true);
    const close = container.querySelector<HaIconButton>('ha-icon-button')!;
    await flush(close);
    expect(close.label).toBe('Close');
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(container.querySelector('button')).toBeNull();
  });

  it.each(['Enter', ' '])(
    'handles one native HA click after %s and guards disabled clicks',
    async (key) => {
      const container = document.createElement('div');
      document.body.append(container);
      const action = vi.fn();
      render(actionControl({ label: 'Continue', onClick: action }), container);
      const control = container.querySelector<ModernHaButton>('ha-button')!;
      await flush(control);
      const button = nativeButton(control);
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
      button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, composed: true }));
      expect(action).not.toHaveBeenCalled();
      button.click();
      expect(action).toHaveBeenCalledOnce();
      render(actionControl({ label: 'Continue', pending: true, onClick: action }), container);
      await flush(control);
      control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(action).toHaveBeenCalledOnce();
    },
  );

  it('uses exactly one native validated submit path, including an implicit submit proxy', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const submitted = vi.fn((event: Event) => event.preventDefault());
    render(
      html`<form @submit=${submitted}>
        <input required />
        ${actionControl({ label: 'Save', type: 'submit' })}
      </form>`,
      container,
    );
    const control = container.querySelector<ModernHaButton>('ha-button')!;
    await flush(control);
    const button = nativeButton(control);
    button.click();
    expect(submitted).not.toHaveBeenCalled();
    container.querySelector('input')!.value = 'valid';
    button.click();
    expect(submitted).toHaveBeenCalledOnce();
    const proxy = container.querySelector<HTMLButtonElement>('.action-submit-proxy')!;
    expect(proxy.hidden).toBe(true);
    expect(proxy.tabIndex).toBe(-1);
    expect(proxy.form).toBe(container.querySelector('form'));
    proxy.click();
    expect(submitted).toHaveBeenCalledTimes(2);
  });

  it('forwards an icon action once through nested HA shadows and guards it while disabled', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const close = vi.fn();
    render(actionControl({ label: 'Close', icon: true, onClick: close }), container);
    const control = container.querySelector<HaIconButton>('ha-icon-button')!;
    await flush(control);
    nativeButton(control).click();
    expect(close).toHaveBeenCalledOnce();
    render(
      actionControl({ label: 'Close', icon: true, disabled: true, onClick: close }),
      container,
    );
    await flush(control);
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps image vehicle choices and Back reachable as HA actions', async () => {
    const element = await dialog([
      { id: 'car', name: 'Car', image: '/car.png', fuels: ['petrol'] },
      { id: 'van', name: 'Van', fuels: ['diesel'] },
    ]);
    const choice = element.shadowRoot!.querySelector<ModernHaButton>('ha-button')!;
    expect(choice.shadowRoot!.activeElement).toBe(nativeButton(choice));
    expect(choice.querySelector('img')?.getAttribute('src')).toBe('/car.png');
    nativeButton(choice).click();
    await flush(element);
    const actions = element.shadowRoot!.querySelector('.actions')!;
    expect(
      [...actions.querySelectorAll('ha-button')].map((button) => button.textContent?.trim()),
    ).toEqual(['Back', 'Cancel', 'Save transaction']);
    const back = actions.querySelector<ModernHaButton>('.back')!;
    nativeButton(back).click();
    await flush(element);
    expect(element.shadowRoot!.querySelector('form')).toBeNull();
    const first = element.shadowRoot!.querySelector<ModernHaButton>('ha-button')!;
    expect(first.shadowRoot!.activeElement).toBe(nativeButton(first));
    expect(element.save).not.toHaveBeenCalled();
  });

  it('preserves Add validation, pending guards and one save through a shadow button', async () => {
    const element = await dialog();
    const save = element.shadowRoot!.querySelector<ModernHaButton>('ha-button.primary')!;
    nativeButton(save).click();
    expect(element.save).not.toHaveBeenCalled();
    for (const name of ['quantity', 'amount']) {
      const input = element.shadowRoot!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      input.value = '10';
      input.dispatchEvent(new Event('input'));
    }
    let finish!: () => void;
    element.save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await flush(element);
    nativeButton(save).click();
    nativeButton(save).click();
    await flush(element);
    expect(element.save).toHaveBeenCalledOnce();
    expect(save.disabled).toBe(true);
    expect(
      element.shadowRoot!.querySelector<HTMLButtonElement>('.action-submit-proxy')!.disabled,
    ).toBe(true);
    save.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(element.save).toHaveBeenCalledOnce();
    finish();
    await flush(element);
  });

  it('traps deep shadow focus without stealing middle controls and restores deep opener focus', async () => {
    const opener = document.createElement('ha-icon-button') as HaIconButton;
    document.body.append(opener);
    await flush(opener);
    nativeButton(opener).focus();
    const element = await dialog();
    const actions = [...element.shadowRoot!.querySelectorAll<ModernHaButton>('ha-button')];
    const cancel = nativeButton(actions[0]);
    cancel.focus();
    const middleTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    cancel.dispatchEvent(middleTab);
    expect(middleTab.defaultPrevented).toBe(false);
    const save = nativeButton(actions[actions.length - 1]);
    save.focus();
    const endTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    save.dispatchEvent(endTab);
    expect(endTab.defaultPrevented).toBe(true);
    expect(element.shadowRoot!.activeElement).toBe(element.shadowRoot!.querySelector('select'));
    element.shadowRoot!.querySelector('select')!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(actions[actions.length - 1].shadowRoot!.activeElement).toBe(save);
    element.remove();
    expect(document.activeElement).toBe(opener);
    expect((opener.shadowRoot!.activeElement as ModernHaButton).shadowRoot!.activeElement).toBe(
      nativeButton(opener),
    );
  });
});
