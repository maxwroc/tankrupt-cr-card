import { html, render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionControl } from '../src/custom-elements/action-control';
import { AddRecordDialog } from '../src/custom-elements/add-record-dialog';
import { HistoryDialog } from '../src/custom-elements/history-dialog';
import { RecentRecordsElement } from '../src/custom-elements/recent-records';
import { actionStyles } from '../src/styles/shared.css';
import { DemoDialog } from '../demo/adapters';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('native action fallback', () => {
  it.each([
    ['shared actions', [actionStyles]],
    ['vehicle/fuel selection and add transaction', AddRecordDialog.styles],
    ['history and delete confirmation', HistoryDialog.styles],
    ['history row actions', RecentRecordsElement.styles],
    ['demo dialog', [DemoDialog.styles]],
  ] as const)('leaves default focus styling intact in %s', (_name, styles) => {
    const cssText = styles.map((style) => style.cssText).join('\n');
    expect(cssText).not.toMatch(/:focus(?:-visible|-within)?\b/);
    expect(cssText).not.toMatch(/\boutline(?:-offset|-width|-style|-color)?\s*:/);
  });

  it('uses themed native controls when HA is absent or its registered API is incompatible', () => {
    const container = document.createElement('div');
    document.body.append(container);
    render(actionControl({ label: 'Save', appearance: 'primary' }), container);
    expect(container.querySelector('button')?.className).toBe('action-control primary');
    vi.spyOn(customElements, 'get').mockReturnValue(class extends HTMLElement {});
    render(actionControl({ label: 'Remove', appearance: 'danger', icon: true }), container);
    const button = container.querySelector('button')!;
    expect(button.className).toBe('action-control danger icon');
    expect(button.getAttribute('aria-label')).toBe('Remove');
    expect(button.title).toBe('Remove');
    expect(actionStyles.cssText).toContain('cursor: pointer');
    expect(actionStyles.cssText).toContain('var(--error-color)');
    expect(actionStyles.cssText).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it.each(['Enter', ' '])(
    'relies on native %s activation without a second keyboard handler',
    (key) => {
      const container = document.createElement('div');
      const action = vi.fn();
      document.body.append(container);
      render(actionControl({ label: 'Continue', onClick: action }), container);
      const button = container.querySelector('button')!;
      button.focus();
      expect(document.activeElement).toBe(button);
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      expect(action).not.toHaveBeenCalled();
      // happy-dom does not synthesize the browser's trusted keyboard click.
      button.click();
      expect(action).toHaveBeenCalledOnce();
    },
  );

  it('guards pending and disabled controls even against dispatched clicks', () => {
    const container = document.createElement('div');
    const action = vi.fn();
    document.body.append(container);
    for (const state of [{ disabled: true }, { pending: true }]) {
      render(actionControl({ label: 'Save', onClick: action, ...state }), container);
      const button = container.querySelector('button')!;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    expect(action).not.toHaveBeenCalled();
  });

  it('preserves native submit and required-field validation', () => {
    const container = document.createElement('div');
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.body.append(container);
    render(
      html`<form @submit=${submitted}>
        <input required />
        ${actionControl({ label: 'Save', type: 'submit' })}
      </form>`,
      container,
    );
    const button = container.querySelector('button')!;
    button.click();
    expect(submitted).not.toHaveBeenCalled();
    container.querySelector('input')!.value = 'value';
    button.click();
    expect(submitted).toHaveBeenCalledOnce();
    expect(container.querySelector('.action-submit-proxy')).toBeNull();
  });

  it('uses the same accessible pointer/focus action for the demo dialog X', async () => {
    if (!customElements.get('test-action-demo-dialog'))
      customElements.define('test-action-demo-dialog', DemoDialog);
    const dialog = new DemoDialog();
    document.body.append(dialog);
    await dialog.updateComplete;
    const close = dialog.shadowRoot!.querySelector<HTMLButtonElement>('button.action-control')!;
    expect(close.getAttribute('aria-label')).toBe('Close dialog');
    expect(close.classList.contains('icon')).toBe(true);
    expect(DemoDialog.styles.cssText).toContain('cursor: pointer');
    const closed = vi.fn();
    dialog.addEventListener('closed', closed);
    dialog.open = true;
    close.click();
    expect(closed).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(false);
  });
});
