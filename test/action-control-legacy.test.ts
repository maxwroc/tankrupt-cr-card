import { html, LitElement, render } from 'lit';
import { property } from 'lit/decorators.js';
import { afterEach, expect, it, vi } from 'vitest';
import { actionControl } from '../src/custom-elements/action-control';

class LegacyHaButton extends LitElement {
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean }) raised = false;
  @property({ type: Boolean }) outlined = false;
  render() {
    return html`<button type="button" ?disabled=${this.disabled}><slot></slot></button>`;
  }
}
customElements.define('ha-button', LegacyHaButton);
afterEach(() => document.body.replaceChildren());

it('supports the legacy raised/outlined API without relying on HA form association', async () => {
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
  expect(remove.outlined).toBe(true);
  expect(remove.disabled).toBe(true);
  save.shadowRoot!.querySelector('button')!.click();
  expect(submit).not.toHaveBeenCalled();
  container.querySelector('input')!.value = 'valid';
  save.shadowRoot!.querySelector('button')!.click();
  expect(submit).toHaveBeenCalledOnce();
});
