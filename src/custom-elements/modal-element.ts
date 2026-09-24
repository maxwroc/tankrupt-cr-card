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

function focusControl(element: HTMLElement): void {
  const inner = element.shadowRoot?.querySelector<HTMLElement>(
    'button:not([disabled]), ha-button:not([disabled]), [tabindex="0"]',
  );
  if (inner) focusControl(inner);
  else element.focus();
}

export abstract class ModalElement extends LitElement {
  private returnFocus?: HTMLElement;
  protected abstract cancel(): void;

  connectedCallback(): void {
    super.connectedCallback();
    this.returnFocus = activeElement() as HTMLElement | undefined;
    document.addEventListener('keydown', this.onKeydown, true);
    document.addEventListener('focusin', this.onFocus, true);
    void this.updateComplete.then(() => {
      if (this.isConnected) this.focusFirst();
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onKeydown, true);
    document.removeEventListener('focusin', this.onFocus, true);
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }

  protected focusFirst(): void {
    const first = this.focusables()[0];
    if (first) focusControl(first);
  }

  private focusables(): HTMLElement[] {
    return [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        'button, ha-button, ha-icon-button, input, select, textarea, a[href], [tabindex]',
      ),
    ].filter(
      (element) =>
        !element.closest('[hidden], [inert], [disabled], [aria-disabled="true"]') &&
        element.getAttribute('tabindex') !== '-1' &&
        !(element instanceof HTMLInputElement && element.type === 'hidden'),
    );
  }

  private onFocus = (event: FocusEvent): void => {
    if (!event.composedPath().includes(this)) this.focusFirst();
  };

  private onKeydown = (event: KeyboardEvent): void => {
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
