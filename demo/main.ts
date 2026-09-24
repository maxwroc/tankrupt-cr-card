import { stringify } from 'yaml';
import { render } from 'lit';
import { actionControl } from '../src/custom-elements/action-control';
import { actionStyles } from '../src/styles/shared.css';
import type { CardConfig } from '../src/types';
import type { TankruptCardEditor } from '../src/custom-elements/tankrupt-card-editor';
import type { TankruptCard } from '../src/custom-elements/tankrupt-cr-card';
import { installAdapters, installDialogManager } from './adapters';
import { DemoBackend, recordType, vehicles, type BackendMode } from './backend';
import { YamlState } from './yaml-state';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const backend = new DemoBackend();
let yaml: HTMLTextAreaElement;
let yamlTab: HTMLButtonElement;
let uiTab: HTMLButtonElement;
let state: YamlState;
let card: TankruptCard;
let editor: TankruptCardEditor;

function preset(): string {
  const scenario = element<HTMLSelectElement>('scenario').value;
  const selected =
    scenario === 'ev'
      ? [vehicles[2]]
      : scenario === 'hybrid'
        ? [vehicles[0]]
        : scenario === 'unassigned'
          ? []
          : vehicles;
  return (
    '# Tankrupt demo — these comments survive UI edits.\n' +
    stringify({
      type: 'custom:tankrupt-cr-card',
      record_type: recordType,
      title: 'Fuel costs',
      billing_start_day: 25,
      trend_display: 'percentage',
      graph: { metric: 'spending', periods: 12 },
      recent_limit: 20,
      input_mode: scenario === 'ev' ? 'quantity_price' : 'quantity_total',
      vehicles: structuredClone(selected),
    })
  );
}

function tab(mode: 'yaml' | 'ui', focus = false): void {
  if (mode === 'ui' && state.error) {
    yaml.focus();
    return;
  }
  for (const name of ['yaml', 'ui'] as const) {
    const selected = name === mode;
    const button = element<HTMLButtonElement>(`${name}-tab`);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    element(`${name}-panel`).hidden = !selected;
    if (focus && selected) button.focus();
  }
}

function sync(fromYaml: boolean): void {
  const error = element('config-error');
  error.hidden = !state.error;
  error.textContent = state.error
    ? `Invalid configuration. Fix the YAML draft to continue: ${state.error}`
    : '';
  yaml.setAttribute('aria-invalid', String(Boolean(state.error)));
  uiTab.setAttribute('aria-disabled', String(Boolean(state.error)));
  element('preview-status').textContent = state.error
    ? 'Last valid configuration — preview has not changed.'
    : 'Live preview';
  if (state.error) {
    tab('yaml');
    return;
  }
  card.setConfig(state.config!);
  if (fromYaml) editor.setConfig(state.config!);
}

export async function startDemo(loadCard?: () => Promise<unknown>): Promise<void> {
  yaml = element<HTMLTextAreaElement>('yaml');
  yamlTab = element<HTMLButtonElement>('yaml-tab');
  uiTab = element<HTMLButtonElement>('ui-tab');
  installAdapters();
  if (!document.getElementById('demo-action-styles')) {
    const style = document.createElement('style');
    style.id = 'demo-action-styles';
    style.textContent = actionStyles.cssText;
    document.head.append(style);
  }
  render(
    actionControl({ id: 'preset', label: 'Load preset (replace YAML)' }),
    element('preset-action'),
  );
  render(actionControl({ id: 'reset', label: 'Reset fixtures' }), element('reset-action'));
  // Kept external by Rollup: the production card never imports demo adapters or YAML.
  const cardModule = './tankrupt-cr-card.js';
  if (loadCard) await loadCard();
  else await import(/* @vite-ignore */ cardModule);
  installDialogManager(backend.hass);
  document.body.addEventListener('demo-dialog-error', (event) => {
    const error = element('boot-error');
    error.hidden = false;
    error.textContent = `Demo dialog failed: ${String((event as CustomEvent).detail)}`;
  });
  card = document.createElement('tankrupt-cr-card') as TankruptCard;
  editor = document.createElement('tankrupt-card-editor') as TankruptCardEditor;
  card.hass = backend.hass;
  editor.hass = backend.hass;
  state = new YamlState(preset());
  yaml.value = state.text;
  backend.onUpdate = () => {
    element('status').textContent =
      `${backend.rows.length} retained canonical records • GBP • Europe/London`;
  };
  backend.reset();
  sync(true);
  element('preview').append(card);
  element('editor').append(editor);
  yaml.addEventListener('input', () => {
    state.edit(yaml.value);
    sync(true);
  });
  editor.addEventListener('config-changed', (event) => {
    if (state.error) return;
    state.update((event as CustomEvent<{ config: CardConfig }>).detail.config);
    yaml.value = state.text;
    sync(false);
  });
  yamlTab.addEventListener('click', () => tab('yaml'));
  uiTab.addEventListener('click', () => tab('ui'));
  for (const button of [yamlTab, uiTab]) {
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      tab(
        event.key === 'Home'
          ? 'yaml'
          : event.key === 'End'
            ? 'ui'
            : button === yamlTab
              ? 'ui'
              : 'yaml',
        true,
      );
    });
  }
  element('dark').addEventListener('change', (event) => {
    document.documentElement.classList.toggle('dark', (event.target as HTMLInputElement).checked);
  });
  element('width').addEventListener('change', (event) => {
    element('preview').style.setProperty(
      '--card-width',
      `${(event.target as HTMLSelectElement).value}px`,
    );
  });
  element('preset').addEventListener('click', () => {
    state = new YamlState(preset());
    yaml.value = state.text;
    sync(true);
  });
  const reset = () => {
    backend.reset(element<HTMLSelectElement>('backend').value as BackendMode);
    // Reconnect both consumers without touching the current YAML draft or valid config.
    card.remove();
    editor.remove();
    element('preview').append(card);
    element('editor').append(editor);
  };
  element('backend').addEventListener('change', reset);
  element('reset').addEventListener('click', reset);
}
