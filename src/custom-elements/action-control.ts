import { html, nothing, type TemplateResult } from 'lit';

export interface ActionControlOptions {
  label: string;
  content?: TemplateResult | string;
  icon?: boolean;
  appearance?: 'normal' | 'primary' | 'danger';
  className?: string;
  disabled?: boolean;
  pending?: boolean;
  type?: 'button' | 'submit';
  slot?: string;
  title?: string;
  id?: string;
  onClick?: (event: MouseEvent) => void;
}

function compatible(tag: string, properties: string[]): boolean {
  const component = customElements.get(tag);
  return !!component && properties.every((property) => property in component.prototype);
}

/**
 * Render in the caller's root; include actionStyles (or sharedStyles) in that root.
 * HA submit actions deliberately use type=button and a hidden native submitter: this
 * preserves required validation and implicit Enter without relying on HA's form API.
 * Callbacks receive native clicks, not synthesized key events, and may cancel submission.
 */
export function actionControl(options: ActionControlOptions): TemplateResult {
  const { label, content = label, icon = false, appearance = 'normal', type = 'button' } = options;
  const disabled = !!(options.disabled || options.pending);
  const modern = compatible('ha-button', ['disabled', 'appearance', 'variant']);
  const legacy = compatible('ha-button', ['disabled', 'raised']);
  const useHa = icon
    ? type !== 'submit' && compatible('ha-icon-button', ['disabled', 'label'])
    : modern || legacy;
  const classes = `action-control ${appearance}${icon ? ' icon' : ''}${options.className ? ` ${options.className}` : ''}`;
  const click = (event: MouseEvent): void => {
    const control = event.currentTarget as HTMLElement & { disabled?: boolean };
    if (disabled || control.disabled || control.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    options.onClick?.(event);
    if (useHa && type === 'submit' && !event.defaultPrevented) {
      event.preventDefault();
      const proxy = control.nextElementSibling as HTMLButtonElement | null;
      if (proxy?.classList.contains('action-submit-proxy') && proxy.form)
        proxy.form.requestSubmit(proxy);
    }
  };
  if (!useHa)
    return html`<button
      class=${classes}
      type=${type}
      ?disabled=${disabled}
      aria-label=${label}
      aria-disabled=${String(disabled)}
      aria-busy=${options.pending ? 'true' : nothing}
      slot=${options.slot ?? nothing}
      title=${options.title ?? (icon ? label : nothing)}
      id=${options.id ?? nothing}
      @click=${click}
    >
      ${content}
    </button>`;

  if (icon)
    return html`<ha-icon-button
      class=${classes}
      .label=${label}
      .disabled=${disabled}
      ?disabled=${disabled}
      aria-label=${label}
      aria-disabled=${String(disabled)}
      aria-busy=${options.pending ? 'true' : nothing}
      slot=${options.slot ?? nothing}
      title=${options.title ?? label}
      id=${options.id ?? nothing}
      @click=${click}
      >${content}</ha-icon-button
    >`;

  return html`<ha-button
      class=${classes}
      .type=${'button'}
      type="button"
      .disabled=${disabled}
      ?disabled=${disabled}
      .loading=${!!options.pending}
      .appearance=${appearance === 'primary' ? 'accent' : 'outlined'}
      .variant=${appearance === 'danger' ? 'danger' : appearance === 'primary' ? 'brand' : 'neutral'}
      .raised=${!modern && appearance === 'primary'}
      .outlined=${!modern && appearance !== 'primary'}
      aria-label=${label}
      aria-disabled=${String(disabled)}
      aria-busy=${options.pending ? 'true' : nothing}
      slot=${options.slot ?? nothing}
      title=${options.title ?? nothing}
      id=${options.id ?? nothing}
      @click=${click}
      >${content}</ha-button
    >${
      type === 'submit'
        ? html`<button
            class="action-submit-proxy"
            type="submit"
            hidden
            tabindex="-1"
            aria-hidden="true"
            ?disabled=${disabled}
          ></button>`
        : nothing
    }`;
}
