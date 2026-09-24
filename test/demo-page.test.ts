import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startDemo } from '../demo/main';
import type { TankruptCardEditor } from '../src/custom-elements/tankrupt-card-editor';
import type { DemoForm } from '../demo/adapters';
import { normalizeConfig } from '../src/config';

afterEach(() => document.body.replaceChildren());

it('boots the real split editor, synchronizes UI/YAML and protects invalid drafts across tabs and fixture changes', async () => {
  const html = readFileSync(resolve('demo', 'index.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link\b[^>]*>/g, '');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  await startDemo(async () => {
    await import('../src/custom-elements/tankrupt-cr-card');
    await import('../src/custom-elements/tankrupt-card-editor');
  });
  const yaml = document.querySelector<HTMLTextAreaElement>('#yaml')!;
  const uiTab = document.querySelector<HTMLButtonElement>('#ui-tab')!;
  const yamlPanel = document.querySelector<HTMLElement>('#yaml-panel')!;
  const editor = document.querySelector<TankruptCardEditor>('tankrupt-card-editor')!;
  const initial = yaml.value;
  expect(initial).toContain('title: Fuel costs');
  expect(
    normalizeConfig({ type: 'custom:tankrupt-cr-card', record_type: 'fuel_purchases' }).title,
  ).toBe('Tankrupt');
  expect(document.querySelector('#reset')!.classList.contains('action-control')).toBe(true);
  expect(document.querySelector('#preset')!.classList.contains('action-control')).toBe(true);
  expect(document.querySelector('#preview tankrupt-cr-card')).not.toBeNull();
  expect(customElements.get('ha-card')).toBeDefined();
  const width = document.querySelector<HTMLSelectElement>('#width')!;
  width.value = '360';
  width.dispatchEvent(new Event('change'));
  expect(
    document.querySelector<HTMLElement>('#preview')!.style.getPropertyValue('--card-width'),
  ).toBe('360px');
  expect(document.querySelector('#status')!.textContent).toContain('650 retained');
  uiTab.click();
  expect(uiTab.getAttribute('aria-selected')).toBe('true');
  expect(yamlPanel.hidden).toBe(true);
  await editor.updateComplete;
  const form = editor.shadowRoot!.querySelector<DemoForm>('ha-form')!;
  form.dispatchEvent(
    new CustomEvent('value-changed', {
      detail: { value: { ...form.data, trend_display: 'amount', filter_vehicle: 'retired_car' } },
      bubbles: true,
      composed: true,
    }),
  );
  expect(yaml.value).toContain('trend_display: amount');
  expect(yaml.value).toContain('vehicle: retired_car');
  expect(yaml.value).toContain('# Tankrupt demo');
  document.querySelector<HTMLButtonElement>('#yaml-tab')!.click();
  yaml.value += '\nfilter: [incomplete';
  const invalid = yaml.value;
  yaml.dispatchEvent(new Event('input'));
  expect(document.querySelector<HTMLElement>('#config-error')!.hidden).toBe(false);
  expect(document.querySelector('#preview-status')!.textContent).toContain(
    'Last valid configuration',
  );
  uiTab.click();
  expect(yaml.value).toBe(invalid);
  expect(yamlPanel.hidden).toBe(false);
  expect(uiTab.getAttribute('aria-disabled')).toBe('true');
  document.querySelector<HTMLButtonElement>('#reset')!.click();
  expect(yaml.value).toBe(invalid);
  yaml.value = initial;
  yaml.dispatchEvent(new Event('input'));
  expect(document.querySelector<HTMLElement>('#config-error')!.hidden).toBe(true);
  expect(document.querySelector('#preview-status')!.textContent).toBe('Live preview');
  uiTab.click();
  expect(uiTab.getAttribute('aria-selected')).toBe('true');
  uiTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  expect(document.querySelector('#yaml-tab')!.getAttribute('aria-selected')).toBe('true');
});
