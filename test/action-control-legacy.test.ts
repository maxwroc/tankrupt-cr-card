import { html, LitElement, render } from 'lit';
import { property } from 'lit/decorators.js';
import { afterEach, expect, it, vi } from 'vitest';
import { actionControl } from '../src/custom-elements/action-control';
import { inputControl } from '../src/custom-elements/field-control';

class LegacyHaButton extends LitElement {
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean }) raised = false;
  @property({ type: Boolean }) outlined = false;
  render() {
    return html`<button type="button" ?disabled=${this.disabled}><slot></slot></button>`;
  }
}
customElements.define('ha-button', LegacyHaButton);
class LegacyHaTextfield extends LitElement {
  @property() value = '';
  @property() label = '';
  @property() type = 'text';
  @property({ type: Boolean }) required = false;
  @property({ type: Boolean }) disabled = false;
  render() {
    return html`<input
      .value=${this.value}
      type=${this.type}
      ?required=${this.required}
      ?disabled=${this.disabled}
    />`;
  }
  reportValidity() {
    return this.shadowRoot!.querySelector('input')!.reportValidity();
  }
}
customElements.define('ha-textfield', LegacyHaTextfield);
afterEach(() => document.body.replaceChildren());

it('supports legacy raised and text buttons without relying on HA form association', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const submit = vi.fn((event: Event) => event.preventDefault());
  render(
    html`<form @submit=${submit}>
      <input required />
      ${actionControl({ label: 'Save', appearance: 'primary', type: 'submit' })}
      ${actionControl({ label: 'Delete', appearance: 'danger', disabled: true })}
    </form>`,
    container,
  );
  const [save, remove] = container.querySelectorAll<LegacyHaButton>('ha-button');
  await save.updateComplete;
  await remove.updateComplete;
  expect(save.raised).toBe(true);
  expect(remove.outlined).toBe(false);
  expect(remove.disabled).toBe(true);
  save.shadowRoot!.querySelector('button')!.click();
  expect(submit).not.toHaveBeenCalled();
  container.querySelector('input')!.value = 'valid';
  save.shadowRoot!.querySelector('button')!.click();
  expect(submit).toHaveBeenCalledOnce();
});

it('uses legacy HA fields with required validation and decimal input', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const input = vi.fn();
  render(
    html`${inputControl({
      name: 'quantity',
      label: 'Quantity (L)',
      value: '',
      required: true,
      onInput: input,
    })}`,
    container,
  );
  const field = container.querySelector<LegacyHaTextfield>('ha-textfield')!;
  await field.updateComplete;
  expect(field.label).toBe('Quantity (L)');
  expect(field.reportValidity()).toBe(false);
  field.value = '1,5';
  field.dispatchEvent(new Event('input'));
  expect(input).toHaveBeenCalledExactlyOnceWith('1,5');
});
