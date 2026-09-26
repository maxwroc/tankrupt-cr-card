import { LitElement, css, html, svg, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { basisFor, currencyFor, localeFor, unitFor } from '../config';
import { UNIT_LABELS } from '../const';
import { chartGeometry } from '../logic/chart-geometry';
import {
  chartDateLabels,
  formatChartTick,
  selectDateTicks,
  type DateTick,
} from '../logic/chart-ticks';
import { metricValue } from '../logic/stats';
import type { ChartSeries, Hass, Metric, ResolvedConfig, Scope } from '../types';
import { sharedStyles } from '../styles/shared.css';
import { date, LABELS, money, number } from './ui-helpers';

const WIDTH = 360;
const HEIGHT = 80;

@customElement('tankrupt-fuel-chart')
export class FuelChart extends LitElement {
  @property({ attribute: false }) series: ChartSeries[] = [];
  @property({ attribute: false }) config!: ResolvedConfig;
  @property({ attribute: false }) hass!: Hass;
  @property({ attribute: false }) scope: Scope = {};
  @property() metric: Metric = 'spending';
  @state() private detail = '';
  @state() private dateTicks = new Map<string, DateTick[]>();
  private detailKey = '';
  private detailAnchor?: SVGElement;
  private pinned = false;
  private resizeObserver?: ResizeObserver;
  private readonly measureDates = () => {
    if (!this.isConnected) return;
    const next = new Map<string, DateTick[]>();
    for (const range of this.renderRoot.querySelectorAll<HTMLElement>('.range')) {
      const labels = [...range.querySelectorAll<HTMLElement>('.x-label')];
      next.set(
        range.dataset.series!,
        selectDateTicks(
          labels.map((label) => label.textContent ?? ''),
          labels.map((label) => label.getBoundingClientRect().width),
          range.getBoundingClientRect().width,
        ),
      );
    }
    if (JSON.stringify([...next]) !== JSON.stringify([...this.dateTicks])) this.dateTicks = next;
    this.positionDetail();
  };

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.measureDates);
      this.resizeObserver.observe(this);
    } else {
      window.addEventListener('resize', this.measureDates);
    }
    document.fonts?.addEventListener('loadingdone', this.measureDates);
    queueMicrotask(this.measureDates);
  }

  disconnectedCallback(): void {
    this.hideDetail(true);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    window.removeEventListener('resize', this.measureDates);
    document.fonts?.removeEventListener('loadingdone', this.measureDates);
    super.disconnectedCallback();
  }

  protected updated(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver?.observe(this);
    for (const range of this.renderRoot.querySelectorAll('.range'))
      this.resizeObserver?.observe(range);
    queueMicrotask(this.measureDates);
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        position: relative;
      }
      figure {
        margin: 0;
      }
      figure + figure {
        margin-top: 12px;
      }
      figcaption {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 0.8rem;
        margin-bottom: 6px;
      }
      .plot {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 4px 6px;
      }
      .axis {
        position: relative;
        text-align: end;
        font-size: 0.72rem;
        max-width: 7rem;
        overflow-wrap: anywhere;
        line-height: 1;
      }
      .axis span {
        position: absolute;
        right: 0;
        white-space: nowrap;
        transform: translateY(-50%);
      }
      .axis .axis-width {
        position: static;
        display: block;
        visibility: hidden;
        height: 0;
        transform: none;
      }
      svg {
        width: 100%;
        height: 80px;
        overflow: visible;
      }
      .grid {
        stroke: var(--divider-color);
        stroke-dasharray: 3 4;
        vector-effect: non-scaling-stroke;
      }
      .mark {
        fill: var(--primary-color);
      }
      .line {
        stroke: var(--primary-color);
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
        fill: none;
      }
      .hit {
        fill: transparent;
      }
      .point {
        cursor: pointer;
      }
      .point:focus-visible {
        outline: none;
      }
      .point:focus-visible .hit {
        stroke: var(--primary-color);
        vector-effect: non-scaling-stroke;
      }
      .range {
        grid-column: 2;
        position: relative;
        min-height: 1.4em;
        font-size: 0.72rem;
        line-height: 1.4;
      }
      .x-label {
        position: absolute;
        white-space: nowrap;
      }
      .detail {
        position: absolute;
        left: 0;
        top: 0;
        visibility: hidden;
        z-index: 1;
        width: max-content;
        max-width: min(100%, 320px);
        overflow-wrap: anywhere;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        padding: 8px;
        font-size: 0.8rem;
        line-height: 1.4;
        white-space: pre-line;
        pointer-events: none;
      }
      .empty {
        margin: 8px 0;
        font-size: 0.85rem;
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues<this>): void {
    if (
      changed.has('series') ||
      changed.has('metric') ||
      changed.has('scope') ||
      changed.has('config') ||
      changed.has('hass')
    ) {
      this.hideDetail(true);
    }
  }

  private positionDetail(): void {
    const tooltip = this.renderRoot.querySelector<HTMLElement>('.detail');
    const mark = this.detailAnchor?.querySelector<SVGElement>('.mark');
    if (!tooltip || !mark) return;
    const bounds = this.getBoundingClientRect();
    const point = mark.getBoundingClientRect();
    const scaleX = bounds.width && this.clientWidth ? this.clientWidth / bounds.width : 1;
    const scaleY = bounds.height && this.clientHeight ? this.clientHeight / bounds.height : 1;
    const pointLeft = (point.left - bounds.left) * scaleX;
    const pointRight = (point.right - bounds.left) * scaleX;
    const leftSpace = Math.max(0, pointLeft - 8);
    const rightSpace = Math.max(0, bounds.width * scaleX - pointRight - 8);
    tooltip.style.maxWidth = '';
    const naturalWidth = tooltip.getBoundingClientRect().width * scaleX;
    const right =
      rightSpace >= naturalWidth || (leftSpace < naturalWidth && rightSpace >= leftSpace);
    tooltip.style.maxWidth = `${Math.min(naturalWidth, right ? rightSpace : leftSpace)}px`;
    const size = tooltip.getBoundingClientRect();
    const width = size.width * scaleX;
    const height = size.height * scaleY;
    const y = (point.top + point.height / 2 - bounds.top) * scaleY;
    const left = right ? pointRight + 8 : pointLeft - width - 8;
    const top = Math.max(0, Math.min(y - height / 2, bounds.height * scaleY - height));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.visibility = 'visible';
  }

  private showDetail(key: string, label: string, anchor: SVGElement): void {
    if (this.pinned) return;
    this.detailKey = key;
    this.detailAnchor = anchor;
    this.detail = label;
    this.requestUpdate();
  }

  private hideDetail(force = false): void {
    if (this.pinned && !force) return;
    this.pinned = false;
    this.detailAnchor = undefined;
    this.detailKey = this.detail = '';
  }

  private toggleDetail(key: string, label: string, anchor: SVGElement): void {
    if (this.pinned && this.detailKey === key) {
      this.hideDetail(true);
    } else {
      this.pinned = true;
      this.detailKey = key;
      this.detailAnchor = anchor;
      this.detail = label;
      this.requestUpdate();
    }
  }

  render() {
    if (!this.config || !this.hass) return nothing;
    const populated = this.series.filter((series) =>
      series.points.some((point) => point.totals.count > 0),
    );
    if (!populated.length) {
      return html`<p class="muted empty">No transactions in this chart range.</p>`;
    }
    const locale = localeFor(this.hass);
    const currency = currencyFor(this.config, this.hass);
    return html`${populated.map((series) => {
      const unit = unitFor(this.config, series.fuel ?? 'petrol', this.scope.vehicle);
      const basis = basisFor(this.config, this.scope.vehicle);
      const suffix =
        this.metric === 'spending'
          ? currency
          : this.metric === 'quantity'
            ? UNIT_LABELS[unit]
            : `${currency} / ${basis} ${UNIT_LABELS[unit]}`;
      const values = series.points.map((point) =>
        point.totals.count ? metricValue(point.totals, this.metric, unit, basis) : null,
      );
      const geometry = chartGeometry(values, WIDTH, HEIGHT);
      const tickFormat = (value: number) =>
        formatChartTick(
          value,
          geometry.tickStep,
          locale,
          this.metric === 'spending' ? currency : undefined,
        );
      const dates = chartDateLabels(
        series.points.map((point) => point.start),
        locale,
        this.hass.config.time_zone,
        this.config.graph.periods >= 6,
      );
      const format = (value: number) =>
        this.metric === 'spending'
          ? money(value, currency, locale)
          : number(value, locale, this.metric === 'price' ? 5 : 2);
      const title = `${series.label} — ${LABELS[this.metric]} (${suffix})`;
      const step = WIDTH / values.length;
      const barWidth = step * 0.65;
      return html`<figure>
        ${
          this.metric !== 'spending' || series.fuel
            ? html`<figcaption>
                <span
                  >${this.metric === 'spending' ? series.label : `${series.fuel ? `${series.label} · ` : ''}${LABELS[this.metric]}`}</span
                >
                <span class="muted">${suffix}</span>
              </figcaption>`
            : nothing
        }
        <div class="plot">
          <div class="axis muted" aria-hidden="true">
            ${[...geometry.ticks].reverse().map(
              (tick) => html`
                <div class="axis-width">${tickFormat(tick.value)}</div>
                <span
                  class="y-label"
                  data-value=${tick.value}
                  style=${`top:${(tick.y / HEIGHT) * 100}%`}
                  >${tickFormat(tick.value)}</span
                >
              `,
            )}
          </div>
          <svg viewBox="0 0 360 80" preserveAspectRatio="none" role="group" aria-label=${title}>
            <title>${title}</title>
            <desc>
              Y-axis: ${tickFormat(geometry.min)} to ${tickFormat(geometry.max)} ${suffix}.
              ${geometry.min > 0 ? 'Truncated baseline: bar heights show differences, not proportions from zero.' : ''}
              Empty periods have no records. Focus, hover or tap a point for its dates and value;
              press Escape or tap again to dismiss.
            </desc>
            ${geometry.ticks.map(
              (tick) =>
                svg`<line class="grid" data-value=${tick.value} x1="0" x2=${WIDTH} y1=${tick.y} y2=${tick.y}></line>`,
            )}
            ${this.metric === 'price' ? geometry.paths.map((path) => svg`<path class="line" d=${path}></path>`) : nothing}
            ${geometry.points.map((point, index) => {
              if (point.value === null) return nothing;
              const bucket = series.points[index];
              const label = `${series.label}: ${date(bucket.start, this.hass)} – ${date(bucket.end, this.hass)}: ${format(point.value)} ${suffix}; ${bucket.totals.count} transactions`;
              const detail = `${date(bucket.start, this.hass)} – ${date(bucket.end, this.hass)}\n${format(point.value)}${this.metric === 'spending' ? '' : ` ${suffix}`}`;
              const key = `${series.id}:${index}`;
              return svg`<g class="point" tabindex="0" role="img" aria-label=${label}
                @focus=${(event: FocusEvent) => this.showDetail(key, detail, event.currentTarget as SVGElement)}
                @blur=${() => this.hideDetail(true)}
                @pointerenter=${(event: PointerEvent) => this.showDetail(key, detail, event.currentTarget as SVGElement)}
                @pointerleave=${() => this.hideDetail()}
                @click=${(event: MouseEvent) => this.toggleDetail(key, detail, event.currentTarget as SVGElement)}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    this.hideDetail(true);
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.toggleDetail(key, detail, event.currentTarget as SVGElement);
                  }
                }}>
                <title>${detail}</title>
                <rect class="hit" x=${index * step} y="0" width=${step} height=${HEIGHT}></rect>
                ${
                  this.metric === 'price'
                    ? svg`<circle class="mark" cx=${point.x} cy=${point.y} r="3.5"></circle>`
                    : svg`<rect class="mark" x=${point.x - barWidth / 2} y=${Math.min(HEIGHT - 2, point.y)}
                      width=${barWidth} height=${Math.max(2, HEIGHT - point.y)} rx="1.5"></rect>`
                }
              </g>`;
            })}
          </svg>
          <div class="range muted" data-series=${series.id} aria-hidden="true">
            ${dates.map((label, index) => {
              const tick = this.dateTicks
                .get(series.id)
                ?.find((item) => item.index === index && item.label === label);
              return html`<span
                class="x-label"
                data-index=${index}
                data-x=${((index + 0.5) / dates.length) * WIDTH}
                style=${`left:${tick?.left ?? 0}px;visibility:${tick ? 'visible' : 'hidden'}`}
                >${label}</span
              >`;
            })}
          </div>
        </div>
      </figure>`;
    })}
    ${this.detail ? html`<div class="detail" role="status" aria-live="polite">${this.detail}</div>` : nothing}`;
  }
}
