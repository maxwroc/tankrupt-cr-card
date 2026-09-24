import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { normalizeConfig } from '../config';
import { EDITOR_TAG, FUELS, FUEL_LABELS } from '../const';
import type { CardConfig, Fuel, Hass, HassConnection, RecordType, Vehicle } from '../types';
import { sharedStyles } from '../styles/shared.css';
import { actionControl } from './action-control';
import { emit, message } from './ui-helpers';

const labels: Record<string, string> = {
  title: 'Title',
  record_type: 'Custom Records record type',
  currency: 'Currency override (optional)',
  billing_start_day: 'Billing period start day',
  input_mode: 'Entry mode',
  liquid_unit: 'Liquid unit',
  price_basis: 'Price per number of units',
  graph_metric: 'Chart metric',
  graph_periods: 'Chart billing periods',
  trend_display: 'Trend format',
  filter_vehicle: 'Vehicle filter ID (blank for all, including historical IDs)',
  filter_fuel: 'Fuel filter',
  recent_limit: 'History batch size',
  show_summary: 'Show summary',
  show_trend: 'Show spending trend',
  show_chart: 'Show chart',
  show_add_button: 'Show Add button',
  show_recent_records: 'Show History action',
};

@customElement(EDITOR_TAG)
export class TankruptCardEditor extends LitElement {
  @property({ attribute: false }) hass?: Hass;
  @state() private config: CardConfig = { type: 'custom:tankrupt-cr-card', record_type: '' };
  @state() private types: RecordType[] = [];
  @state() private discoveryError = '';
  @state() private discovering = false;
  private connection?: HassConnection;
  private generation = 0;
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }
      fieldset {
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        margin: 16px 0;
        padding: 16px;
        display: grid;
        gap: 12px;
      }
      .fuel {
        flex-direction: row;
        align-items: center;
      }
      .fuel input {
        min-height: unset;
      }
    `,
  ];

  setConfig(config: CardConfig): void {
    this.config = { ...config };
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    ++this.generation;
    this.connection = undefined;
  }

  protected willUpdate(): void {
    if (this.isConnected && this.hass && this.connection !== this.hass.connection) {
      this.connection = this.hass.connection;
      void this.discover();
    }
  }

  private discover = async (): Promise<void> => {
    if (!this.hass) return;
    const generation = ++this.generation;
    this.discovering = true;
    this.discoveryError = '';
    try {
      const result = await this.hass.connection.sendMessagePromise<{ record_types: RecordType[] }>({
        type: 'custom_records/list_record_types',
      });
      if (generation === this.generation && this.isConnected) this.types = result.record_types;
    } catch (error) {
      if (generation === this.generation && this.isConnected) this.discoveryError = message(error);
    } finally {
      if (generation === this.generation && this.isConnected) this.discovering = false;
    }
  };

  private change(config: CardConfig): void {
    this.config = config;
    emit(this, 'config-changed', { config });
  }

  private formChanged = (event: CustomEvent<{ value: Record<string, unknown> }>): void => {
    event.stopPropagation();
    const { graph_metric, graph_periods, filter_vehicle, filter_fuel, ...settings } =
      event.detail.value;
    const config = {
      ...this.config,
      ...settings,
      type: 'custom:tankrupt-cr-card',
      graph: {
        ...this.config.graph,
        ...(graph_metric !== undefined ? { metric: graph_metric } : {}),
        ...(graph_periods !== undefined ? { periods: Number(graph_periods) } : {}),
      },
    } as CardConfig;
    if (filter_vehicle !== undefined || filter_fuel !== undefined) {
      config.filter = { ...this.config.filter };
      if (filter_vehicle !== undefined) {
        if (filter_vehicle === '') delete config.filter.vehicle;
        else config.filter.vehicle = String(filter_vehicle);
      }
      if (filter_fuel !== undefined) {
        if (filter_fuel === '') delete config.filter.fuel;
        else config.filter.fuel = filter_fuel as Fuel;
      }
    }
    if (config.currency === '') delete config.currency;
    if (config.price_basis !== undefined)
      config.price_basis = Number(config.price_basis) as 1 | 100;
    this.change(config);
  };

  private updateVehicle(index: number, patch: Partial<Vehicle>): void {
    const vehicles = [...(this.config.vehicles ?? [])];
    vehicles[index] = { ...vehicles[index], ...patch };
    this.change({ ...this.config, vehicles });
  }

  private addVehicle(): void {
    const vehicles = this.config.vehicles ?? [];
    let next = vehicles.length + 1;
    while (vehicles.some((vehicle) => vehicle.id === `vehicle_${next}`)) next++;
    this.change({
      ...this.config,
      vehicles: [
        ...vehicles,
        { id: `vehicle_${next}`, name: `Vehicle ${next}`, fuels: ['petrol'] },
      ],
    });
  }

  private schema() {
    const select = (name: string, options: { value: string; label: string }[]) => ({
      name,
      selector: { select: { mode: 'dropdown', options } },
    });
    const types = new Map(this.types.map((type) => [type.id, type.name]));
    if (this.config.record_type && !types.has(this.config.record_type))
      types.set(this.config.record_type, this.config.record_type);
    return [
      { name: 'title', selector: { text: {} } },
      types.size && !this.discoveryError
        ? {
            ...select(
              'record_type',
              [...types].map(([value, label]) => ({ value, label })),
            ),
            required: true,
          }
        : { name: 'record_type', required: true, selector: { text: {} } },
      { name: 'currency', selector: { text: {} } },
      { name: 'filter_vehicle', selector: { text: {} } },
      select('filter_fuel', [
        { value: '', label: 'All fuels' },
        ...FUELS.map((value) => ({ value, label: FUEL_LABELS[value] })),
      ]),
      select('trend_display', [
        { value: 'percentage', label: 'Percentage' },
        { value: 'amount', label: 'Currency difference' },
      ]),
      {
        name: 'billing_start_day',
        selector: { number: { min: 1, max: 31, step: 1, mode: 'box' } },
      },
      select('input_mode', [
        { value: 'quantity_total', label: 'Quantity + total paid' },
        { value: 'quantity_price', label: 'Quantity + unit price' },
      ]),
      select('liquid_unit', [
        { value: 'L', label: 'Litres' },
        { value: 'US_gal', label: 'US gallons' },
        { value: 'imp_gal', label: 'Imperial gallons' },
      ]),
      select('price_basis', [
        { value: '1', label: 'Per 1 unit' },
        { value: '100', label: 'Per 100 units' },
      ]),
      select('graph_metric', [
        { value: 'spending', label: 'Spending' },
        { value: 'quantity', label: 'Quantity' },
        { value: 'price', label: 'Effective unit price' },
      ]),
      select(
        'graph_periods',
        [1, 3, 6, 12].map((count) => ({ value: String(count), label: String(count) })),
      ),
      { name: 'recent_limit', selector: { number: { min: 1, max: 500, step: 1, mode: 'box' } } },
      ...['show_summary', 'show_trend', 'show_chart', 'show_add_button', 'show_recent_records'].map(
        (name) => ({
          name,
          selector: { boolean: {} },
        }),
      ),
    ];
  }

  render() {
    if (!this.hass) return nothing;
    let validation = '';
    try {
      normalizeConfig(this.config);
    } catch (error) {
      validation = message(error);
    }
    const data = {
      title: 'Tankrupt',
      billing_start_day: 1,
      input_mode: 'quantity_total',
      liquid_unit: 'L',
      recent_limit: 20,
      show_summary: true,
      show_trend: true,
      show_chart: true,
      show_add_button: true,
      show_recent_records: true,
      trend_display: 'percentage',
      ...this.config,
      price_basis: String(this.config.price_basis ?? 1),
      graph_metric: this.config.graph?.metric ?? 'spending',
      graph_periods: String(this.config.graph?.periods ?? 12),
      filter_vehicle: this.config.filter?.vehicle ?? '',
      filter_fuel: this.config.filter?.fuel ?? '',
    };
    return html`<ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${this.schema()}
        .computeLabel=${(field: { name: string }) => labels[field.name] ?? field.name}
        @value-changed=${this.formChanged}
      ></ha-form>
      ${this.discovering ? html`<p role="status">Discovering record types…</p>` : nothing}
      ${
        this.discoveryError
          ? html`<p class="error" role="alert">
                Record-type discovery failed: ${this.discoveryError}. You can enter the ID manually.
              </p>
              ${actionControl({
                label: 'Retry discovery',
                disabled: this.discovering,
                onClick: () => {
                  if (!this.discovering) void this.discover();
                },
              })}`
          : nothing
      }
      ${validation ? html`<p class="error" role="alert">${validation}</p>` : nothing}
      <h2>Vehicles</h2>
      <p class="muted">
        Optional. IDs identify stored history: keep them stable when renaming or reordering
        vehicles, and use the same IDs on every card.
      </p>
      ${(this.config.vehicles ?? []).map(
        (vehicle, index) =>
          html`<fieldset>
            <legend>Vehicle ${index + 1}</legend>
            <label
              >Stable ID<input
                .value=${vehicle.id}
                @change=${(event: Event) => this.updateVehicle(index, { id: (event.target as HTMLInputElement).value })}
            /></label>
            <label
              >Name<input
                .value=${vehicle.name}
                @input=${(event: Event) => this.updateVehicle(index, { name: (event.target as HTMLInputElement).value })}
            /></label>
            <label
              >Image URL (optional)<input
                .value=${vehicle.image ?? ''}
                @change=${(event: Event) => this.updateVehicle(index, { image: (event.target as HTMLInputElement).value || undefined })}
            /></label>
            <div class="row">
              ${FUELS.map(
                (fuel: Fuel) =>
                  html`<label class="fuel"
                    ><input
                      type="checkbox"
                      .checked=${vehicle.fuels.includes(fuel)}
                      @change=${(event: Event) =>
                        this.updateVehicle(index, {
                          fuels: (event.target as HTMLInputElement).checked
                            ? [...vehicle.fuels, fuel]
                            : vehicle.fuels.filter((item) => item !== fuel),
                        })}
                    />${FUEL_LABELS[fuel]}</label
                  >`,
              )}
            </div>
            ${actionControl({
              label: `Remove vehicle ${vehicle.name}`,
              appearance: 'danger',
              onClick: () =>
                this.change({
                  ...this.config,
                  vehicles: this.config.vehicles?.filter((_, i) => i !== index),
                }),
            })}
          </fieldset>`,
      )}
      ${actionControl({ label: 'Add vehicle', onClick: () => this.addVehicle() })}
      <p class="muted">
        Create the record type manually in Custom Records first. Advanced field mappings and vehicle
        unit/price-basis overrides are available in YAML. Currency changes relabel historical
        amounts; they do not convert them.
      </p>`;
  }
}
