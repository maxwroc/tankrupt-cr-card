import { html, nothing, type TemplateResult } from 'lit';
import { html as staticHtml, literal } from 'lit/static-html.js';

export interface InputControlElement extends HTMLElement {
  value: string;
  disabled: boolean;
  required: boolean;
  reportValidity(): boolean;
}

interface InputControlOptions {
  name: string;
  label: string;
  value: string;
  type?: 'text' | 'datetime-local';
  inputmode?: 'decimal';
  required?: boolean;
  hideRequiredIndicator?: boolean;
  disabled?: boolean;
  onInput(value: string): void;
}

export function inputControl(options: InputControlOptions): TemplateResult {
  const input = (event: Event): void => {
    if (!options.disabled) options.onInput((event.currentTarget as InputControlElement).value);
  };
  const tag = customElements.get('ha-input')
    ? literal`ha-input`
    : customElements.get('ha-textfield')
      ? literal`ha-textfield`
      : undefined;
  if (tag)
    return staticHtml`<${tag}
      class="input-control"
      name=${options.name}
      .label=${options.label}
      .value=${options.value}
      .type=${options.type ?? 'text'}
      .inputmode=${options.inputmode ?? ''}
      .autocomplete=${'off'}
      .required=${!!options.required && !options.hideRequiredIndicator}
      aria-required=${options.required ? 'true' : nothing}
      .disabled=${!!options.disabled}
      ?disabled=${options.disabled}
      @input=${input}
      @change=${input}
    ></${tag}>`;
  return html`<label
    >${options.label}<input
      class="input-control"
      name=${options.name}
      type=${options.type ?? 'text'}
      inputmode=${options.inputmode ?? nothing}
      autocomplete="off"
      .value=${options.value}
      ?required=${options.required}
      ?disabled=${options.disabled}
      @input=${input}
      @change=${input}
  /></label>`;
}
