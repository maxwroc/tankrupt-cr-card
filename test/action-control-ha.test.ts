import { html, LitElement, render } from 'lit';
import { property } from 'lit/decorators.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionControl } from '../src/custom-elements/action-control';
import { AddRecordDialog } from '../src/custom-elements/add-record-dialog';
import { focusControl } from '../src/custom-elements/modal-element';
import { normalizeConfig } from '../src/config';
import { actionStyles } from '../src/styles/shared.css';
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
class HaInput extends LitElement {
  @property() value = '';
  @property() label = '';
  @property() name = '';
  @property() type = 'text';
  @property() inputmode = '';
  @property({ type: Boolean }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  reportValidity() {
    return this.shadowRoot!.querySelector('input')!.reportValidity();
  }
  render() {
    return html`<label
      >${this.label}<input
        .value=${this.value}
        type=${this.type}
        ?required=${this.required}
        ?disabled=${this.disabled}
        @input=${(event: Event) => {
          this.value = (event.target as HTMLInputElement).value;
        }}
    /></label>`;
  }
}
class HaDropdown extends LitElement {
  @property({ type: Boolean }) open = false;
  render() {
    return html`<slot name="trigger"></slot><slot></slot>`;
  }
}
class HaSelector extends HaInput {
  @property({ attribute: false }) hass!: Hass;
  @property({ attribute: false }) selector!: Record<string, unknown>;
}
class HaTimeInput extends HaInput {
  @property({ attribute: false }) locale!: Hass['locale'];
  @property({ type: Boolean }) clearable = true;
  @property({ type: Boolean }) enableSecond = true;
}
class HaDropdownItem extends LitElement {
  @property() value = '';
  @property({ type: Boolean }) disabled = false;
}
customElements.define('ha-button', ModernHaButton);
customElements.define('ha-icon-button', HaIconButton);
customElements.define('ha-icon', class extends HTMLElement {});
customElements.define('ha-input', HaInput);
customElements.define('ha-selector', HaSelector);
customElements.define('ha-time-input', HaTimeInput);
customElements.define('ha-dropdown', HaDropdown);
customElements.define('ha-dropdown-item', HaDropdownItem);

async function flush(element: LitElement) {
  await element.updateComplete;
  for (const child of element.shadowRoot?.querySelectorAll<LitElement>(
    'ha-button, ha-icon-button, ha-input, ha-selector, ha-time-input, ha-dropdown, ha-dropdown-item',
  ) ?? [])
    await flush(child);
  await element.updateComplete;
}
const hass: Hass = {
  config: { time_zone: 'UTC', currency: 'USD' },
  locale: { language: 'en-GB', date_format: 'DMY', time_format: '24', first_weekday: 'monday' },
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
  it('loads the HA time input through its selector before enabling the non-clearable control', async () => {
    const get = customElements.get.bind(customElements);
    const whenDefined = customElements.whenDefined.bind(customElements);
    let finish!: (element: CustomElementConstructor) => void;
    const loaded = new Promise<CustomElementConstructor>((resolve) => {
      finish = resolve;
    });
    const getSpy = vi
      .spyOn(customElements, 'get')
      .mockImplementation((name) => (name === 'ha-time-input' ? undefined : get(name)));
    vi.spyOn(customElements, 'whenDefined').mockImplementation((name) =>
      name === 'ha-time-input' ? loaded : whenDefined(name),
    );
    const element = await dialog();
    const loader = element.shadowRoot!.querySelector<HaSelector>('[name="time"]')!;
    expect(loader.localName).toBe('ha-selector');
    expect(loader.selector).toEqual({ time: { no_second: true } });
    expect(loader.disabled).toBe(true);
    const originalTime = loader.value;
    getSpy.mockRestore();
    finish(HaTimeInput);
    await loaded;
    await flush(element);
    const time = element.shadowRoot!.querySelector<HaTimeInput>('[name="time"]')!;
    expect(time.localName).toBe('ha-time-input');
    expect(time.value).toBe(originalTime);
    expect(time.disabled).toBe(false);
    expect(time.clearable).toBe(false);
  });

  it('positions only the fallback menu action, never the open HA dropdown trigger', () => {
    const styles = AddRecordDialog.styles.map((style) => style.cssText).join('\n');
    const positionedMenuRule = styles.match(/([^{}]*\.mode-menu\[open\][^{}]*)\{([^}]*)\}/);
    expect(positionedMenuRule?.[1].trim()).toBe('details.mode-menu[open] > .action-control');
    expect(positionedMenuRule?.[2]).toContain('position: absolute');
  });

  it('waits for nested HA controls to render before focusing their native button', async () => {
    const control = new HaIconButton();
    document.body.append(control);
    expect(control.hasUpdated).toBe(false);
    focusControl(control);
    await flush(control);
    const inner = control.shadowRoot!.querySelector<ModernHaButton>('ha-button')!;
    expect(document.activeElement).toBe(control);
    expect(control.shadowRoot!.activeElement).toBe(inner);
    expect(inner.shadowRoot!.activeElement).toBe(nativeButton(control));
  });

  it('does not restore deferred focus after a control is removed', async () => {
    const control = new HaIconButton();
    document.body.append(control);
    focusControl(control);
    control.remove();
    const next = document.createElement('button');
    document.body.append(next);
    next.focus();
    await control.updateComplete;
    expect(document.activeElement).toBe(next);
  });

  it('centers only the native calendar icon in material date-time fields', () => {
    const styles = AddRecordDialog.styles.map((style) => style.cssText).join('\n');
    expect(styles).toMatch(
      /ha-input\[type='datetime-local'\]\[appearance='material'\]::part\(\s*wa-input\s*\)::-webkit-calendar-picker-indicator\s*\{\s*transform: translateY\(calc\(var\(--ha-space-3, 12px\) \/ -2\)\);/,
    );
  });

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
    expect(save.appearance).toBe('filled');
    expect(save.variant).toBe('brand');
    expect(save.slot).toBe('primaryAction');
    expect(save.type).toBe('button');
    expect(remove.variant).toBe('danger');
    expect(remove.appearance).toBe('plain');
    expect(remove.disabled && remove.loading).toBe(true);
    const close = container.querySelector<HaIconButton>('ha-icon-button')!;
    await flush(close);
    expect(close.label).toBe('Close');
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(container.querySelector('button')).toBeNull();
    expect(actionStyles.cssText).not.toMatch(/--(?:ha-button-height|ha-icon-button-size|wa-)/);
    expect(actionStyles.cssText).not.toContain('::part(base)');
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
      const input = element.shadowRoot!.querySelector<HaInput>(`[name="${name}"]`)!;
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
    const mode = element.shadowRoot!.querySelector<HaIconButton>('ha-icon-button')!;
    expect(element.shadowRoot!.activeElement).toBe(mode);
    expect((mode.shadowRoot!.activeElement as ModernHaButton).shadowRoot!.activeElement).toBe(
      nativeButton(mode),
    );
    nativeButton(mode).dispatchEvent(
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

  it('uses standard HA inputs and overflow menu, preserving labels, mode changes and disabled fields', async () => {
    const element = await dialog();
    expect(element.shadowRoot!.querySelector('input, select')).toBeNull();
    const mode = element.shadowRoot!.querySelector<HaDropdown>('ha-dropdown')!;
    const menuItem = element.shadowRoot!.querySelector<HaDropdownItem>('ha-dropdown-item')!;
    const icon = mode.querySelector('ha-icon')!;
    expect(icon.getAttribute('icon')).toBe('mdi:dots-vertical');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.parentElement?.getAttribute('slot')).toBe('trigger');
    expect(mode.querySelector('svg, .fallback-icon')).toBeNull();
    const quantity = element.shadowRoot!.querySelector<HaInput>('[name="quantity"]')!;
    const amount = element.shadowRoot!.querySelector<HaInput>('[name="amount"]')!;
    const date = element.shadowRoot!.querySelector<HaSelector>('[name="date"]')!;
    const time = element.shadowRoot!.querySelector<HaTimeInput>('[name="time"]')!;
    expect(quantity.label).toBe('Quantity (L)');
    expect(quantity.inputmode).toBe('decimal');
    expect(quantity.type).toBe('text');
    expect(element.shadowRoot!.activeElement).toBe(quantity);
    expect(element.shadowRoot!.querySelector('ha-select')).toBeNull();
    expect(mode.getAttribute('placement')).toBe('bottom-end');
    expect(menuItem.textContent?.trim()).toBe('Switch entry mode');
    expect(element.shadowRoot!.querySelector('.purchase-values [name="quantity"]')).toBe(quantity);
    expect(element.shadowRoot!.querySelector('.purchase-values [name="amount"]')).toBe(amount);
    expect(element.shadowRoot!.querySelector('.purchase-values .preview')).not.toBeNull();
    expect(element.shadowRoot!.querySelector('.transaction-date [name="date"]')).toBe(date);
    expect(date.selector).toEqual({ date: {} });
    expect(time.localName).toBe('ha-time-input');
    expect(time.clearable).toBe(false);
    expect(time.enableSecond).toBe(false);
    expect(date.hass).toBe(hass);
    expect(time.locale).toBe(hass.locale);
    for (const field of [quantity, amount, date, time]) {
      expect(field.required).toBe(false);
      expect(field.getAttribute('aria-required')).toBe('true');
    }
    expect(time.label).toBe('');
    expect(time.getAttribute('aria-label')).toBe('Time');
    expect(element.shadowRoot!.querySelector('.transaction-date small')).toBeNull();
    expect(element.shadowRoot!.textContent).not.toContain('Daylight-saving');
    expect(element.shadowRoot!.querySelector('[name="timestamp"]')).toBeNull();
    quantity.value = '10';
    quantity.dispatchEvent(new Event('input'));
    amount.value = '15';
    amount.dispatchEvent(new Event('input'));
    await flush(element);
    const originalTimestamp = [date.value, time.value];
    mode.dispatchEvent(new CustomEvent('wa-select', { detail: { item: menuItem } }));
    await flush(element);
    expect(quantity.value).toBe('10');
    expect([date.value, time.value]).toEqual(originalTimestamp);
    expect(element.shadowRoot!.querySelector('.preview')?.textContent).toContain(
      'Enter both values',
    );
    expect(amount.value).toBe('');
    expect(amount.label).toBe('Unit price (USD / 1 L)');
    amount.value = '0';
    amount.dispatchEvent(new Event('input'));
    await flush(element);
    let finish!: () => void;
    element.save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    nativeButton(element.shadowRoot!.querySelector('ha-button.primary')!).click();
    await flush(element);
    expect(element.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ quantity: 10, total_cost: 0, unit_price: 0 }),
    );
    expect([quantity, amount, date, time, menuItem].every((control) => control.disabled)).toBe(
      true,
    );
    date.dispatchEvent(new CustomEvent('value-changed', { detail: { value: '2000-01-01' } }));
    time.dispatchEvent(new CustomEvent('value-changed', { detail: { value: '00:00' } }));
    expect(element.shadowRoot!.querySelector<HaIconButton>('ha-icon-button')!.disabled).toBe(true);
    mode.dispatchEvent(new CustomEvent('wa-select', { detail: { item: menuItem } }));
    await flush(element);
    expect(amount.value).toBe('0');
    expect(amount.label).toBe('Unit price (USD / 1 L)');
    expect([date.value, time.value]).toEqual(originalTimestamp);
    finish();
    await flush(element);
  });

  it.each(['date', 'time'])(
    'validates shadow inputs and focuses an empty %s before saving',
    async (name) => {
      const element = await dialog();
      const quantity = element.shadowRoot!.querySelector<HaInput>('[name="quantity"]')!;
      const amount = element.shadowRoot!.querySelector<HaInput>('[name="amount"]')!;
      const timestamp = element.shadowRoot!.querySelector<HaSelector>(`[name="${name}"]`)!;
      const save = nativeButton(element.shadowRoot!.querySelector('ha-button.primary')!);
      save.click();
      expect(element.save).not.toHaveBeenCalled();
      expect(element.shadowRoot!.activeElement).toBe(quantity);
      expect(quantity.shadowRoot!.activeElement).toBe(quantity.shadowRoot!.querySelector('input'));
      for (const field of [quantity, amount]) {
        field.value = '10';
        field.dispatchEvent(new Event('input'));
      }
      timestamp.dispatchEvent(new CustomEvent('value-changed', { detail: { value: undefined } }));
      await flush(element);
      save.click();
      expect(element.save).not.toHaveBeenCalled();
      expect(element.shadowRoot!.activeElement).toBe(timestamp);
    },
  );

  it('forwards updated HA locale preferences and saves local selector values in the HA time zone', async () => {
    const element = await dialog();
    element.hass = {
      ...hass,
      config: { ...hass.config, time_zone: 'Europe/London' },
      locale: { language: 'en-US', date_format: 'YMD', time_format: '12', first_weekday: 'sunday' },
    };
    await flush(element);
    const date = element.shadowRoot!.querySelector<HaSelector>('[name="date"]')!;
    const time = element.shadowRoot!.querySelector<HaTimeInput>('[name="time"]')!;
    expect(date.hass.locale).toEqual(element.hass.locale);
    expect(time.locale).toEqual(element.hass.locale);
    expect(time.label).toBe('');
    expect(element.shadowRoot!.textContent).not.toContain('Europe/London');
    for (const field of element.shadowRoot!.querySelectorAll<HaInput>('ha-input')) {
      field.value = '10';
      field.dispatchEvent(new Event('input'));
    }
    date.dispatchEvent(new CustomEvent('value-changed', { detail: { value: '2026-07-12' } }));
    time.dispatchEvent(new CustomEvent('value-changed', { detail: { value: '13:45:00' } }));
    await flush(element);
    nativeButton(element.shadowRoot!.querySelector('ha-button.primary')!).click();
    expect(element.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ timestamp: '2026-07-12T12:45:00.000000Z' }),
    );
  });

  it.each(['2026-03-29', '2026-10-25'])(
    'rejects ambiguous or nonexistent selector time on %s',
    async (value) => {
      const element = await dialog();
      element.hass = { ...hass, config: { ...hass.config, time_zone: 'Europe/London' } };
      for (const field of element.shadowRoot!.querySelectorAll<HaInput>('ha-input')) {
        field.value = '10';
        field.dispatchEvent(new Event('input'));
      }
      element
        .shadowRoot!.querySelector('[name="date"]')!
        .dispatchEvent(new CustomEvent('value-changed', { detail: { value } }));
      element
        .shadowRoot!.querySelector('[name="time"]')!
        .dispatchEvent(new CustomEvent('value-changed', { detail: { value: '01:30:00' } }));
      await flush(element);
      nativeButton(element.shadowRoot!.querySelector('ha-button.primary')!).click();
      await flush(element);
      expect(element.save).not.toHaveBeenCalled();
      expect(element.shadowRoot!.querySelector('.error')?.textContent).toContain('unambiguous');
    },
  );

  it('lets the HA calendar own focus and Escape without closing the transaction dialog', async () => {
    const element = await dialog();
    const close = vi.fn();
    element.addEventListener('dialog-close', close);
    const date = element.shadowRoot!.querySelector<HaSelector>('[name="date"]')!;
    date.dispatchEvent(
      new CustomEvent('show-dialog', {
        detail: { dialogTag: 'ha-dialog-date-picker' },
        bubbles: true,
        composed: true,
      }),
    );
    const calendar = document.createElement('ha-dialog-date-picker');
    const input = document.createElement('button');
    calendar.attachShadow({ mode: 'open' }).append(input);
    document.body.append(calendar);
    input.focus();
    expect(document.activeElement).toBe(calendar);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(close).not.toHaveBeenCalled();
    calendar.remove();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(element.shadowRoot!.activeElement).toBe(
      element.shadowRoot!.querySelector('[name="quantity"]'),
    );
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('still reports required fields when HA validation is unavailable in the browser', async () => {
    const element = await dialog();
    for (const field of element.shadowRoot!.querySelectorAll<HaInput>('ha-input'))
      vi.spyOn(field, 'reportValidity').mockReturnValue(true);
    nativeButton(element.shadowRoot!.querySelector('ha-button.primary')!).click();
    await flush(element);
    expect(element.save).not.toHaveBeenCalled();
    expect(element.shadowRoot!.querySelector('.error')?.textContent).toBe(
      'Complete all required fields.',
    );
    expect(element.shadowRoot!.activeElement).toBe(
      element.shadowRoot!.querySelector('[name="quantity"]'),
    );
  });

  it('submits once on Enter from a shadow input, but not during composition or saving', async () => {
    const element = await dialog();
    for (const name of ['quantity', 'amount']) {
      const field = element.shadowRoot!.querySelector<HaInput>(`[name="${name}"]`)!;
      const input = field.shadowRoot!.querySelector('input')!;
      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    await flush(element);
    const amount = element.shadowRoot!.querySelector<HaInput>('[name="amount"]')!;
    const input = amount.shadowRoot!.querySelector('input')!;
    const enter = (isComposing = false) =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          isComposing,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    enter(true);
    expect(element.save).not.toHaveBeenCalled();
    let finish!: () => void;
    element.save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    enter();
    enter();
    await flush(element);
    expect(element.save).toHaveBeenCalledOnce();
    finish();
    await flush(element);
  });

  it('lets HA dropdowns consume Escape without closing the transaction dialog', async () => {
    const element = await dialog();
    const close = vi.fn();
    element.addEventListener('dialog-close', close);
    const mode = element.shadowRoot!.querySelector<HaDropdown>('ha-dropdown')!;
    mode.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    nativeButton(element.shadowRoot!.querySelector('ha-icon-button')!).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(close).not.toHaveBeenCalled();
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
