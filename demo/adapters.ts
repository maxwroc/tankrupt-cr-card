import { LitElement, css, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import type { Hass } from '../src/types';
import { actionControl } from '../src/custom-elements/action-control';
import { actionStyles } from '../src/styles/shared.css';

export interface FormField {
  name: string;
  required?: boolean;
  selector: {
    text?: object;
    boolean?: object;
    number?: { min?: number; max?: number; step?: number };
    select?: { options: { value: string; label: string }[] };
  };
}

export class DemoForm extends LitElement {
  @property({ attribute: false }) data: Record<string, unknown> = {};
  @property({ attribute: false }) schema: FormField[] = [];
  @property({ attribute: false }) computeLabel = (field: FormField) => field.name;
  static styles = css`
    :host {
      display: block;
    }
    form {
      display: grid;
      gap: 14px;
    }
    label {
      display: grid;
      gap: 5px;
      font-size: 0.9rem;
    }
    label.boolean {
      display: flex;
      align-items: center;
    }
    input,
    select {
      box-sizing: border-box;
      min-width: 0;
      width: 100%;
      font: inherit;
      padding: 9px;
      border: 1px solid var(--divider-color);
      border-radius: 6px;
      background: var(--card-background-color);
      color: var(--primary-text-color);
    }
    input[type='checkbox'] {
      width: 20px;
      height: 20px;
      accent-color: var(--primary-color);
    }
    :focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
  `;
  private change(field: FormField, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = field.selector.boolean
      ? input.checked
      : field.selector.number
        ? input.value === ''
          ? undefined
          : Number(input.value)
        : input.value;
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...this.data, [field.name]: value } },
        bubbles: true,
        composed: true,
      }),
    );
  }
  render() {
    return html`<form @submit=${(event: Event) => event.preventDefault()}>
      ${this.schema.map((field) => {
        const select = field.selector.select;
        const number = field.selector.number;
        return html`<label class=${field.selector.boolean ? 'boolean' : ''}>
          ${this.computeLabel(field)}
          ${
            select
              ? html`<select
                  .value=${String(this.data[field.name] ?? '')}
                  ?required=${field.required}
                  @change=${(event: Event) => this.change(field, event)}
                >
                  ${select.options.map(
                    (option) =>
                      html`<option
                        value=${option.value}
                        .selected=${String(this.data[field.name] ?? '') === option.value}
                      >
                        ${option.label}
                      </option>`,
                  )}
                </select>`
              : html`<input
                  type=${field.selector.boolean ? 'checkbox' : number ? 'number' : 'text'}
                  .value=${String(this.data[field.name] ?? '')}
                  .checked=${Boolean(this.data[field.name])}
                  ?required=${field.required}
                  min=${number?.min ?? nothing}
                  max=${number?.max ?? nothing}
                  step=${number?.step ?? nothing}
                  @change=${(event: Event) => this.change(field, event)}
                />`
          }
        </label>`;
      })}
    </form>`;
  }
}

export class DemoDialog extends LitElement {
  @property({ type: Boolean }) open = false;
  @property() headerTitle = '';
  @property() heading = '';
  @property({ type: Boolean }) preventScrimClose = false;
  @property() escapeKeyAction = 'close';
  @property() scrimClickAction = 'close';
  static styles = css`
    ${actionStyles}
    dialog {
      box-sizing: border-box;
      width: min(600px, calc(100vw - 24px));
      max-height: calc(100dvh - 32px);
      padding: 20px;
      border: 1px solid var(--divider-color);
      border-radius: 16px;
      color: var(--primary-text-color);
      background: var(--card-background-color);
    }
    dialog::backdrop {
      background: var(--dialog-backdrop-color);
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    h2 {
      font-size: 1.2rem;
      margin: 0 0 16px;
    }
    footer {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
  `;
  private closed(): void {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent('closed', { bubbles: true, composed: true }));
  }
  protected updated(): void {
    const dialog = this.shadowRoot!.querySelector('dialog')!;
    if (this.open && !dialog.open) dialog.showModal();
    else if (!this.open && dialog.open) dialog.close();
  }
  disconnectedCallback(): void {
    this.shadowRoot?.querySelector('dialog')?.close();
    super.disconnectedCallback();
  }
  render() {
    return html`<dialog
      aria-labelledby="heading"
      @close=${() => this.closed()}
      @cancel=${(event: Event) => {
        event.preventDefault();
        if (this.escapeKeyAction) this.closed();
      }}
      @click=${(event: MouseEvent) => {
        if (
          event.target !== event.currentTarget ||
          this.preventScrimClose ||
          !this.scrimClickAction
        )
          return;
        const bounds = (event.currentTarget as HTMLDialogElement).getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          this.closed();
      }}
    >
      <header>
        <h2 id="heading">${this.headerTitle || this.heading}</h2>
        ${actionControl({
          label: 'Close dialog',
          icon: true,
          content: html`<span aria-hidden="true">✕</span>`,
          onClick: () => this.closed(),
        })}
      </header>
      <slot name="heading"></slot><slot></slot>
      <footer>
        <slot name="footer"></slot><slot name="secondaryAction"></slot
        ><slot name="primaryAction"></slot>
      </footer>
    </dialog>`;
  }
}

interface ManagedDialog extends HTMLElement {
  hass?: Hass;
  showDialog(params: unknown): Promise<void> | void;
  closeDialog(): boolean | void;
}
interface DialogRequest {
  dialogTag: string;
  dialogImport?: () => Promise<unknown>;
  dialogParams: unknown;
}

export class DemoCardSurface extends LitElement {
  static styles = css`
    :host {
      display: block;
      background: var(--ha-card-background);
      border: 1px solid var(--divider-color);
      border-radius: var(--ha-card-border-radius);
      box-shadow: var(--ha-card-box-shadow);
    }
  `;
  render() {
    return html`<slot></slot>`;
  }
}

export function installAdapters(): void {
  if (!customElements.get('ha-card')) customElements.define('ha-card', DemoCardSurface);
  if (!customElements.get('ha-form')) customElements.define('ha-form', DemoForm);
  if (!customElements.get('ha-dialog')) customElements.define('ha-dialog', DemoDialog);
}

export function installDialogManager(hass: Hass, root: HTMLElement = document.body): () => void {
  let current: ManagedDialog | undefined;
  let generation = 0;
  const show = async (event: Event) => {
    const request = (event as CustomEvent<DialogRequest>).detail;
    event.stopPropagation();
    const ownGeneration = ++generation;
    let opener = document.activeElement;
    while (opener?.shadowRoot?.activeElement) opener = opener.shadowRoot.activeElement;
    try {
      await request.dialogImport?.();
      if (generation !== ownGeneration) return;
      current?.closeDialog();
      current?.remove();
      const dialog = document.createElement(request.dialogTag) as ManagedDialog;
      if (typeof dialog.showDialog !== 'function')
        throw new Error(`Unknown dialog ${request.dialogTag}`);
      current = dialog;
      dialog.hass = hass;
      dialog.addEventListener('dialog-closed', (closed) => {
        if ((closed as CustomEvent).detail?.dialog !== request.dialogTag) return;
        dialog.remove();
        if (current === dialog) {
          current = undefined;
          if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        }
      });
      root.append(dialog);
      await dialog.showDialog(request.dialogParams);
    } catch (error) {
      root.dispatchEvent(new CustomEvent('demo-dialog-error', { detail: error }));
    }
  };
  root.addEventListener('show-dialog', show);
  return () => {
    ++generation;
    root.removeEventListener('show-dialog', show);
    current?.closeDialog();
    current?.remove();
  };
}
