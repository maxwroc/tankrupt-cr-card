import { LitElement } from 'lit';

function activeElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function containsFocus(element: HTMLElement, active: Element | null): boolean {
  while (active) {
    if (element === active || element.contains(active)) return true;
    const root = active.getRootNode();
    active = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

export function focusControl(element: HTMLElement): void {
  if ('hasUpdated' in element && element.hasUpdated === false && 'updateComplete' in element) {
    void Promise.resolve(element.updateComplete).then(() => {
      if (element.isConnected) focusControl(element);
    });
    return;
  }
  const inner = element.shadowRoot?.querySelector<HTMLElement>(
    'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), ha-button:not([disabled]), ha-picker-field:not([disabled]), ha-input:not([disabled]), ha-date-input:not([disabled]), ha-time-input:not([disabled]), ha-base-time-input:not([disabled]), wa-input:not([disabled]), #selector:not([disabled]), [tabindex="0"]',
  );
  if (inner) focusControl(inner);
  else element.focus();
}

export abstract class ModalElement extends LitElement {
  private returnFocus?: HTMLElement;
  private childDialogTag?: string;
  protected abstract cancel(): void;

  connectedCallback(): void {
    super.connectedCallback();
    this.returnFocus = activeElement() as HTMLElement | undefined;
    document.addEventListener('keydown', this.onKeydown);
    document.addEventListener('focusin', this.onFocus, true);
    this.addEventListener('show-dialog', this.onShowDialog);
    void this.updateComplete.then(() => {
      if (this.isConnected) this.focusFirst();
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onKeydown);
    document.removeEventListener('focusin', this.onFocus, true);
    this.removeEventListener('show-dialog', this.onShowDialog);
    this.childDialogTag = undefined;
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }

  protected focusFirst(): void {
    const first = this.focusables()[0];
    if (first) focusControl(first);
  }

  private focusables(): HTMLElement[] {
    return [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        'button, ha-button, ha-icon-button, ha-input, ha-textfield, ha-selector, ha-time-input, input, select, textarea, summary, a[href], [tabindex]',
      ),
    ].filter(
      (element) =>
        !element.closest('[hidden], [inert], [disabled], [aria-disabled="true"]') &&
        (!element.closest('details:not([open])') || element.localName === 'summary') &&
        element.getAttribute('tabindex') !== '-1' &&
        !(element instanceof HTMLInputElement && element.type === 'hidden'),
    );
  }

  private onShowDialog = (event: Event): void => {
    const detail: unknown = (event as CustomEvent).detail;
    if (
      detail &&
      typeof detail === 'object' &&
      'dialogTag' in detail &&
      typeof detail.dialogTag === 'string'
    ) {
      this.childDialogTag = detail.dialogTag;
    }
  };

  private isChildDialogEvent(event: Event): boolean {
    return event
      .composedPath()
      .some(
        (element) => element instanceof HTMLElement && element.localName === this.childDialogTag,
      );
  }

  private onFocus = (event: FocusEvent): void => {
    if (!event.composedPath().includes(this) && !this.isChildDialogEvent(event)) this.focusFirst();
  };

  private onKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || this.isChildDialogEvent(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    }
    if (event.key !== 'Tab') return;
    const elements = this.focusables();
    const current = activeElement();
    const first = elements[0];
    const last = elements[elements.length - 1];
    const focused = elements.find((element) => containsFocus(element, current));
    if (!first) {
      event.preventDefault();
      return;
    }
    if (
      (event.shiftKey && focused === first) ||
      (!event.shiftKey && focused === last) ||
      !focused
    ) {
      event.preventDefault();
      focusControl(event.shiftKey ? last : first);
    }
  };
}
