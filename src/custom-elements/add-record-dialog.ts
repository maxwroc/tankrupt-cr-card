import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { basisFor, currencyFor, localeFor, unitFor } from '../config';
import { FUELS, FUEL_LABELS, UNIT_LABELS } from '../const';
import { localDateTime, nowInstant, transactionTimestamp } from '../logic/billing-period';
import { deriveTransaction } from '../logic/transaction';
import { displayPrice } from '../logic/units';
import type {
  Fuel,
  Hass,
  InputMode,
  NewTransaction,
  ResolvedConfig,
  TransactionValues,
  Vehicle,
} from '../types';
import { modalStyles, sharedStyles } from '../styles/shared.css';
import { actionControl } from './action-control';
import { ModalElement } from './modal-element';
import { emit, LABELS, message, money, number } from './ui-helpers';

@customElement('tankrupt-add-dialog')
export class AddRecordDialog extends ModalElement {
  @property({ attribute: false }) config!: ResolvedConfig;
  @property({ attribute: false }) hass!: Hass;
  @property({ attribute: false }) save!: (record: NewTransaction) => Promise<void>;
  @property({ type: Boolean }) available = true;
  @property() availabilityMessage = '';
  @state() private vehicle?: Vehicle;
  @state() private fuel?: Fuel;
  @state() private quantity = '';
  @state() private amount = '';
  @state() private timestamp = '';
  @state() private mode: InputMode = 'quantity_total';
  @state() private pending = false;
  @state() private error = '';
  @state() private brokenImages = new Set<string>();
  private initialized = false;

  static styles = [
    sharedStyles,
    modalStyles,
    css`
      .actions {
        gap: 8px;
        flex-wrap: nowrap;
      }
      .actions .action-control {
        min-width: 0;
        --wa-form-control-padding-inline: 8px;
      }
      .actions button.action-control {
        padding-inline: 8px;
      }
      .back {
        margin-inline-end: auto;
      }
    `,
  ];

  protected willUpdate(): void {
    if (this.initialized || !this.config || !this.hass) return;
    this.initialized = true;
    this.mode = this.config.input_mode;
    this.timestamp = localDateTime(nowInstant(), this.hass.config.time_zone);
    if (this.config.vehicles.length === 1) this.selectVehicle(this.config.vehicles[0]);
  }

  protected cancel(): void {
    if (!this.pending) emit(this, 'dialog-close');
  }

  protected updated(): void {
    const select = this.renderRoot.querySelector<HTMLSelectElement>('select');
    if (select && select.value !== this.mode) select.value = this.mode;
  }

  private selectVehicle(vehicle: Vehicle): void {
    this.vehicle = vehicle;
    this.fuel = vehicle.fuels.length === 1 ? vehicle.fuels[0] : undefined;
    void this.updateComplete.then(() => this.focusFirst());
  }

  private derived(): TransactionValues {
    if (!this.fuel) throw new Error('Choose a fuel.');
    return deriveTransaction({
      fuel: this.fuel,
      vehicleId: this.vehicle?.id,
      vehicleName: this.vehicle?.name,
      quantity: this.quantity,
      amount: this.amount,
      mode: this.mode,
      unit: unitFor(this.config, this.fuel, this.vehicle?.id),
      basis: basisFor(this.config, this.vehicle?.id),
      currency: currencyFor(this.config, this.hass),
      locale: localeFor(this.hass),
    });
  }

  private submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (this.pending) return;
    if (!this.available) {
      this.error = 'Connection or record schema is not ready. Your entries have been kept.';
      return;
    }
    this.error = '';
    let record: NewTransaction;
    try {
      record = {
        ...this.derived(),
        timestamp: transactionTimestamp(this.timestamp, this.hass.config.time_zone),
      };
    } catch (error) {
      this.error = message(error);
      return;
    }
    this.pending = true;
    try {
      await this.save(record);
      emit(this, 'dialog-close');
    } catch (error) {
      this.error = `${message(error)} The transaction may already have been saved. A refresh was requested; close this dialog and check recent records or Custom Records before trying again. No automatic retry was made.`;
    } finally {
      this.pending = false;
    }
  };

  private preview() {
    if (!this.quantity || !this.amount || !this.fuel)
      return html`Enter both values to preview the calculation.`;
    try {
      const result = this.derived();
      const currency = currencyFor(this.config, this.hass);
      const locale = localeFor(this.hass);
      const unit = unitFor(this.config, this.fuel, this.vehicle?.id);
      const basis = basisFor(this.config, this.vehicle?.id);
      return this.mode === 'quantity_price'
        ? html`Total paid: <strong>${money(result.total_cost, currency, locale)}</strong>`
        : html`Effective unit price:
            <strong
              >${number(displayPrice(result.unit_price, unit, basis), locale, 6)} ${currency} /
              ${basis} ${UNIT_LABELS[unit]}</strong
            >`;
    } catch (error) {
      return html`${message(error)}`;
    }
  }

  render() {
    if (!this.config || !this.hass) return nothing;
    const chooseVehicle = this.config.vehicles.length > 1 && !this.vehicle;
    const fuels = this.vehicle?.fuels ?? FUELS;
    const unit = this.fuel ? unitFor(this.config, this.fuel, this.vehicle?.id) : 'L';
    const basis = basisFor(this.config, this.vehicle?.id);
    const currency = currencyFor(this.config, this.hass);
    return html`<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <h2 id="add-title">${LABELS.add}</h2>
      ${
        !this.available
          ? html`<p class="warning" role="status">
              Saving is temporarily unavailable. ${this.availabilityMessage} Your entries have been
              kept.
            </p>`
          : nothing
      }
      ${
        chooseVehicle
          ? html`<p>Choose a vehicle</p>
              <div class="choices">
                ${this.config.vehicles.map(
                  (vehicle) =>
                    actionControl({
                      label: vehicle.name,
                      onClick: () => this.selectVehicle(vehicle),
                      content: html`${
                        vehicle.image && !this.brokenImages.has(vehicle.id)
                          ? html`<img
                              src=${vehicle.image}
                              alt=""
                              @error=${() => {
                                this.brokenImages = new Set([...this.brokenImages, vehicle.id]);
                              }}
                            />`
                          : html`<span aria-hidden="true">🚘 </span>`
                      }${vehicle.name}`,
                    }),
                )}
              </div>`
          : !this.fuel
            ? html`<p>${this.vehicle?.name ?? 'Choose fuel or energy'}</p>
                <div class="choices">
                  ${fuels.map(
                    (fuel) =>
                      actionControl({
                        label: FUEL_LABELS[fuel],
                        onClick: () => {
                          this.fuel = fuel;
                          void this.updateComplete.then(() => this.focusFirst());
                        },
                      }),
                  )}
                </div>`
            : html`<form @submit=${this.submit}>
                <div>
                  <strong
                    >${this.vehicle?.name ?? LABELS.unassigned} · ${FUEL_LABELS[this.fuel]}</strong
                  >
                </div>
                <label
                  >Entry mode<select
                    .value=${this.mode}
                    ?disabled=${this.pending}
                    @change=${(e: Event) => {
                      this.mode = (e.target as HTMLSelectElement).value as InputMode;
                      this.amount = '';
                      this.error = '';
                    }}
                  >
                    <option value="quantity_total" .selected=${this.mode === 'quantity_total'}>
                      Quantity + total paid
                    </option>
                    <option value="quantity_price" .selected=${this.mode === 'quantity_price'}>
                      Quantity + unit price
                    </option>
                  </select></label
                >
                <label
                  >Quantity (${UNIT_LABELS[unit]})<input
                    name="quantity"
                    inputmode="decimal"
                    autocomplete="off"
                    required
                    .value=${this.quantity}
                    ?disabled=${this.pending}
                    @input=${(e: Event) => {
                      this.quantity = (e.target as HTMLInputElement).value;
                    }}
                /></label>
                <label
                  >${this.mode === 'quantity_total' ? `Total paid (${currency})` : `Unit price (${currency} / ${basis} ${UNIT_LABELS[unit]})`}
                  <input
                    name="amount"
                    inputmode="decimal"
                    autocomplete="off"
                    required
                    .value=${this.amount}
                    ?disabled=${this.pending}
                    @input=${(e: Event) => {
                      this.amount = (e.target as HTMLInputElement).value;
                    }}
                  />
                </label>
                <div class="preview" role="status" aria-live="polite">${this.preview()}</div>
                <label
                  >Transaction date and time (${this.hass.config.time_zone})<input
                    name="timestamp"
                    type="datetime-local"
                    required
                    .value=${this.timestamp}
                    ?disabled=${this.pending}
                    @input=${(e: Event) => {
                      this.timestamp = (e.target as HTMLInputElement).value;
                    }}
                /></label>
                <small
                  >Daylight-saving times that are ambiguous or do not exist are rejected. Choose an
                  unambiguous local time.</small
                >
                ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
                <div class="actions">
                  ${
                    this.config.vehicles.length > 1 || fuels.length > 1
                      ? actionControl({
                          label: 'Back',
                          className: 'back',
                          disabled: this.pending,
                          onClick: () => {
                            if (this.pending) return;
                            this.fuel = undefined;
                            this.quantity = this.amount = this.error = '';
                            if (this.config.vehicles.length > 1) this.vehicle = undefined;
                            void this.updateComplete.then(() => this.focusFirst());
                          },
                        })
                      : nothing
                  }
                  ${actionControl({
                    label: LABELS.cancel,
                    disabled: this.pending,
                    onClick: () => this.cancel(),
                  })}
                  ${actionControl({
                    label: this.pending ? LABELS.saving : LABELS.save,
                    appearance: 'primary',
                    type: 'submit',
                    disabled: !this.available,
                    pending: this.pending,
                  })}
                </div>
              </form>`
      }
      ${!this.fuel ? html`<div class="actions">${actionControl({ label: LABELS.cancel, onClick: () => this.cancel() })}</div>` : nothing}
    </section>`;
  }
}
