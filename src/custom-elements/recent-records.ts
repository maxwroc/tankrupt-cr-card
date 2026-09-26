import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { basisFor, currencyFor, localeFor, unitFor } from '../config';
import { FUEL_LABELS, UNIT_LABELS } from '../const';
import { displayPrice, displayQuantity } from '../logic/units';
import type { Hass, RecentRecords, ResolvedConfig, Transaction } from '../types';
import { sharedStyles } from '../styles/shared.css';
import { date, emit, LABELS, money, number } from './ui-helpers';
import { actionControl } from './action-control';

@customElement('tankrupt-recent-records')
export class RecentRecordsElement extends LitElement {
  @property({ attribute: false }) data: RecentRecords = { records: [] };
  @property({ attribute: false }) config!: ResolvedConfig;
  @property({ attribute: false }) hass!: Hass;
  @property({ type: Boolean }) available = true;
  private formattedRows = new WeakMap<
    Transaction,
    {
      config: ResolvedConfig;
      format: string;
      detail: TemplateResult;
      description: string;
    }
  >();
  static styles = [
    sharedStyles,
    css`
      ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      li {
        padding: 14px 0;
        border-top: 1px solid var(--divider-color);
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }
      .detail {
        display: grid;
        gap: 5px;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      li .action-control {
        flex-shrink: 0;
      }
      .amount {
        font-weight: 600;
      }
      @media (max-width: 360px) {
        li {
          align-items: flex-start;
          flex-direction: column;
        }
      }
    `,
  ];

  private name(record: Transaction): string {
    return (
      this.config.vehicles.find((vehicle) => vehicle.id === record.vehicle_id)?.name ??
      record.vehicle_name ??
      (record.vehicle_id === 'unassigned' ? LABELS.unassigned : record.vehicle_id)
    );
  }

  private rowView(record: Transaction, currency: string, locale: string) {
    const format = JSON.stringify([currency, locale, this.hass.config.time_zone]);
    const previous = this.formattedRows.get(record);
    if (previous?.config === this.config && previous.format === format) return previous;
    const unit = unitFor(this.config, record.fuel_type, record.vehicle_id);
    const basis = basisFor(this.config, record.vehicle_id);
    const name = `${this.name(record)} · ${FUEL_LABELS[record.fuel_type]}`;
    const timestamp = date(record.timestamp, this.hass, true);
    const amount = money(record.total_cost, currency, locale);
    const row = {
      config: this.config,
      format,
      description: `${name} · ${timestamp} · ${amount}`,
      detail: html`<div class="detail">
        <strong>${name}</strong>
        <small>${timestamp}</small>
        <span
          >${number(displayQuantity(record.quantity, unit), locale)} ${UNIT_LABELS[unit]} ·
          ${number(displayPrice(record.unit_price, unit, basis), locale, 6)} ${currency} / ${basis}
          ${UNIT_LABELS[unit]}</span
        >
        <span class="amount">${amount}</span>
      </div>`,
    };
    this.formattedRows.set(record, row);
    return row;
  }

  render() {
    if (!this.config || !this.hass) return nothing;
    const currency = currencyFor(this.config, this.hass);
    const locale = localeFor(this.hass);
    return html`<section>
      ${
        this.data.records.length
          ? html`<ul>
              ${repeat(
                this.data.records,
                (record) => record.id,
                (record) => {
                  const row = this.rowView(record, currency, locale);
                  return html`<li>
                    ${row.detail}
                    ${actionControl({
                      label: `Delete ${row.description}`,
                      content: 'Delete',
                      appearance: 'danger',
                      disabled: !this.available,
                      onClick: () => {
                        emit(this, 'request-delete', {
                          record,
                          description: row.description,
                        });
                      },
                    })}
                  </li>`;
                },
              )}
            </ul>`
          : html`<p>No transactions match these filters.</p>`
      }
    </section>`;
  }
}
