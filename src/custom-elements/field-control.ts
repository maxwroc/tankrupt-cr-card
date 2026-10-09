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
      .required=${!!options.required}
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

interface SelectControlOptions {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange(value: string): void;
}

export function selectControl(options: SelectControlOptions): TemplateResult {
  const component = customElements.get('ha-select');
  const modern = component && 'options' in component.prototype;
  if (modern)
    return html`<ha-select
      .label=${options.label}
      .value=${options.value}
      .options=${options.options}
      .disabled=${!!options.disabled}
      ?disabled=${options.disabled}
      @selected=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (!options.disabled) options.onChange(event.detail.value);
      }}
    ></ha-select>`;
  if (component && customElements.get('mwc-list-item'))
    return html`<ha-select
      .label=${options.label}
      .value=${options.value}
      .disabled=${!!options.disabled}
      ?disabled=${options.disabled}
      @selected=${(event: Event) => {
        event.stopPropagation();
        const value = (event.currentTarget as HTMLSelectElement).value;
        if (!options.disabled && value !== options.value) options.onChange(value);
      }}
      @closed=${(event: Event) => event.stopPropagation()}
    >
      ${options.options.map(
        (option) => html`<mwc-list-item .value=${option.value}>${option.label}</mwc-list-item>`,
      )}
    </ha-select>`;
  return html`<label
    >${options.label}<select
      .value=${options.value}
      ?disabled=${options.disabled}
      @change=${(event: Event) => {
        if (!options.disabled) options.onChange((event.currentTarget as HTMLSelectElement).value);
      }}
    >
      ${options.options.map(
        (option) =>
          html`<option value=${option.value} .selected=${option.value === options.value}>
            ${option.label}
          </option>`,
      )}
    </select></label
  >`;
}
