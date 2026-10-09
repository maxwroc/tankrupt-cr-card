import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { currencyFor, localeFor, normalizeConfig } from '../config';
import { CARD_TAG, EDITOR_TAG } from '../const';
import { CustomRecordsSource } from '../data/custom-records-source';
import { localDateTime, nowInstant } from '../logic/billing-period';
import { spendingTrend } from '../logic/stats';
import type {
  CardConfig,
  ChartSeries,
  Hass,
  HassConnection,
  NewTransaction,
  RecentRecords,
  RecordType,
  ResolvedConfig,
  Scope,
  Summary,
  Unsubscribe,
} from '../types';
import { sharedStyles } from '../styles/shared.css';
import { date, message, money, number } from './ui-helpers';
import { TextTopAlignment } from './text-top-alignment';
import { actionControl } from './action-control';
import {
  showHistoryDialog,
  type HistoryHandle,
  type HistoryState,
} from './history-dialog-contract';
import './add-record-dialog';
import './fuel-chart';

@customElement(CARD_TAG)
export class TankruptCard extends LitElement {
  constructor() {
    super();
    new TextTopAlignment(this);
  }

  @state() private config?: ResolvedConfig;
  @state() private configError = '';
  @state() private schemaError = '';
  @state() private loadError = '';
  @state() private chartError = '';
  @state() private recentError = '';
  @state() private subscriptionError = '';
  @state() private schema?: RecordType;
  @state() private summary?: Summary;
  @state() private series: ChartSeries[] = [];
  @state() private recent?: RecentRecords;
  @state() private loading = false;
  @state() private chartLoading = false;
  @state() private recentLoading = false;
  @state() private schemaLoading = false;
  @state() private dialogOpen = false;
  @state() private historyOpen = false;
  @state() private historyDialogError = '';
  private historyHandle?: HistoryHandle;
  private historyToken?: object;
  private historyTimer?: ReturnType<typeof setTimeout>;
  private historyEnd?: string;
  private historyScope?: Scope;
  private historyCursor: string | null = null;
  private historyCursors = new Set<string>();
  private historyDeletedIds = new Set<string>();
  private historyNeedsInitial = false;
  private historyTraversal = 0;
  @state() private historyHasMore = false;
  @state() private historyRestartRequired = false;
  private _hass?: Hass;
  private source?: CustomRecordsSource;
  private unsubscribe?: Unsubscribe;
  private removeListeners?: () => void;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private dateTimer?: ReturnType<typeof setInterval>;
  private refreshDate = '';
  private epoch = 0;
  private summaryRequest = 0;
  private schemaRequest = 0;
  private chartRequest = 0;
  private recentRequest = 0;
  private context = '';
  private hassConnection?: HassConnection;

  static styles = [
    sharedStyles,
    css`
      ha-card {
        display: block;
        overflow: hidden;
      }
      .content {
        padding: 16px;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      header.has-title {
        /* Match the shared buttons' minimum height, line height, padding and borders. */
        min-height: max(42px, calc(1lh + 22px));
      }
      h1 {
        font-size: 1.15rem;
        margin: 0;
        overflow-wrap: anywhere;
        flex: 1 1 100px;
      }
      .card-actions {
        display: flex;
        margin-inline-start: auto;
        gap: 8px;
        flex-wrap: wrap;
      }
      .summary {
        margin: 8px 0 12px;
      }
      .summary:last-child {
        margin-bottom: 0;
      }
      .values {
        display: flex;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 8px;
      }
      .spend {
        min-width: 0;
        max-width: 100%;
        font-size: clamp(1.8rem, 6vw, 2.6rem);
        font-weight: 700;
        margin: 0;
        overflow-wrap: anywhere;
      }
      .spend,
      .trend {
        line-height: 1;
        text-box-trim: trim-start;
        text-box-edge: cap alphabetic;
      }
      .trend {
        min-width: 0;
        text-align: start;
        max-width: 100%;
        overflow-wrap: anywhere;
        font-size: 0.85rem;
        font-weight: 600;
        margin-bottom: 2px;
        margin-block-start: var(--tankrupt-trend-top-offset, 0px);
      }
      .up {
        color: var(--error-color);
      }
      .down {
        color: var(--success-color);
      }
      .caption,
      .retention {
        font-size: 0.8rem;
        line-height: 1.4;
      }
      .caption {
        padding-block: 8px;
      }
      .summary:last-child .caption {
        padding-bottom: 0;
      }
      .retention {
        margin: 8px 0;
      }
      .retention summary {
        cursor: pointer;
      }
      .status {
        color: var(--secondary-text-color);
      }
      section.chart {
        margin: 8px 0 0;
      }
      @media (max-width: 400px) {
        .content {
          padding: 14px;
        }
      }
    `,
  ];

  static async getConfigElement(): Promise<HTMLElement> {
    await import('./tankrupt-card-editor');
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig(): CardConfig {
    return { type: `custom:${CARD_TAG}`, record_type: 'fuel_purchases' };
  }

  setConfig(config: CardConfig): void {
    this.closeHistory();
    this.teardown();
    this.config = undefined;
    this.recent = undefined;
    this.configError = '';
    this.dialogOpen = false;
    this.historyDialogError = '';
    try {
      this.config = normalizeConfig(config);
    } catch (error) {
      this.configError = message(error);
    }
    this.setup();
  }

  set hass(value: Hass) {
    const context = JSON.stringify([
      value.config.time_zone,
      value.config.currency,
      localeFor(value),
    ]);
    const changed = this.hassConnection !== value.connection || context !== this.context;
    this._hass = value;
    this.hassConnection = value.connection;
    this.context = context;
    if (changed) {
      this.teardown();
      this.setup();
    }
    this.requestUpdate();
  }

  get hass(): Hass | undefined {
    return this._hass;
  }
  getCardSize(): number {
    return 2 + (this.config?.show_summary ? 2 : 0) + (this.config?.show_chart ? 3 : 0);
  }

  protected updated(): void {
    if (this.historyHandle && this.config && this.hass)
      this.historyHandle.updateHistory(this.historyState());
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.setup();
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.closeHistory();
    this.teardown();
    this.dialogOpen = false;
  }

  private teardown(): void {
    ++this.epoch;
    ++this.recentRequest;
    if (this.historyOpen && this.recentLoading) {
      this.recentError =
        'The history request was interrupted by a connection change. Retry to continue the same history query.';
    }
    this.recentLoading = false;
    clearTimeout(this.refreshTimer);
    clearInterval(this.dateTimer);
    this.refreshDate = '';
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.removeListeners?.();
    this.removeListeners = undefined;
    this.source = undefined;
  }

  private restart = (): void => {
    this.teardown();
    this.setup();
  };

  private setup(): void {
    if (!this.isConnected || !this.config || !this.hass || this.source) return;
    this.summary = undefined;
    this.series = [];
    this.schema = undefined;
    this.schemaError = this.loadError = this.chartError = this.subscriptionError = '';
    this.loading = this.chartLoading = this.recentLoading = false;
    this.schemaLoading = false;
    try {
      currencyFor(this.config, this.hass);
      new Intl.DateTimeFormat('en', { timeZone: this.hass.config.time_zone });
    } catch (error) {
      this.schemaError = message(error);
      this.recent = undefined;
      this.dialogOpen = false;
      this.closeHistory();
      return;
    }
    const source = (this.source = new CustomRecordsSource(this.hass, this.config));
    const epoch = this.epoch;
    const connection = this.hass.connection;
    const disconnected = () => {
      if (!this.current(source, epoch)) return;
      this.teardown();
      this.subscriptionError = 'Home Assistant connection lost. Waiting to reconnect.';
      this.schema = undefined;
      this.schemaLoading = this.loading = this.chartLoading = this.recentLoading = false;
      connection.addEventListener?.('ready', this.restart);
      this.removeListeners = () => connection.removeEventListener?.('ready', this.restart);
    };
    connection.addEventListener?.('ready', this.restart);
    connection.addEventListener?.('disconnected', disconnected);
    this.removeListeners = () => {
      connection.removeEventListener?.('ready', this.restart);
      connection.removeEventListener?.('disconnected', disconnected);
    };
    this.dateTimer = setInterval(() => {
      if (!this.current(source, epoch) || !this.hass || !this.schema) return;
      const now = nowInstant();
      if (localDateTime(now, this.hass.config.time_zone).slice(0, 10) === this.refreshDate) return;
      this.invalidateAndRefresh(now);
    }, 60_000);
    this.checkSchema(nowInstant());
    void source
      .subscribeUpdates(() => {
        if (!this.current(source, epoch)) return;
        this.suspendSchema();
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
          if (this.current(source, epoch)) {
            this.invalidateAndRefresh();
          }
        }, 250);
      })
      .then((unsubscribe) => {
        if (this.current(source, epoch)) this.unsubscribe = unsubscribe;
        else unsubscribe();
      })
      .catch((error: unknown) => {
        if (this.current(source, epoch))
          this.subscriptionError = `Live updates unavailable: ${message(error)}`;
      });
  }

  private current(source: CustomRecordsSource, epoch: number): boolean {
    return this.isConnected && this.source === source && this.epoch === epoch;
  }

  private invalidateAndRefresh(now = nowInstant()): void {
    if (!this.source) return;
    this.source.invalidate();
    this.checkSchema(now);
  }

  private checkSchema(now: string): void {
    if (!this.source) return;
    const source = this.source,
      epoch = this.epoch,
      request = this.suspendSchema();
    void source
      .getRecordType()
      .then((schema) => {
        if (!this.current(source, epoch) || request !== this.schemaRequest) return;
        this.schema = schema;
        this.refresh(now);
      })
      .catch((error: unknown) => {
        if (this.current(source, epoch) && request === this.schemaRequest)
          this.schemaError = message(error);
      })
      .finally(() => {
        if (this.current(source, epoch) && request === this.schemaRequest)
          this.schemaLoading = false;
      });
  }

  private suspendSchema(): number {
    ++this.summaryRequest;
    ++this.chartRequest;
    this.schema = undefined;
    this.schemaLoading = true;
    this.loading = this.chartLoading = false;
    this.schemaError = '';
    return ++this.schemaRequest;
  }

  private refresh = (now = nowInstant()): void => {
    if (!this.source || !this.schema || !this.config || !this.hass) return;
    this.refreshDate = localDateTime(now, this.hass.config.time_zone).slice(0, 10);
    this.loadSummary(now);
    this.loadChart(now);
    if (this.historyNeedsInitial) this.loadHistoryPage();
  };

  private loadSummary(now: string): void {
    if (!this.source || !this.config || (!this.config.show_summary && !this.config.show_trend))
      return;
    const source = this.source,
      epoch = this.epoch,
      request = ++this.summaryRequest;
    this.loading = true;
    this.loadError = '';
    void source
      .fetchSummary({ ...this.config.filter }, now)
      .then((summary) => {
        if (this.current(source, epoch) && request === this.summaryRequest) this.summary = summary;
      })
      .catch((error: unknown) => {
        if (this.current(source, epoch) && request === this.summaryRequest)
          this.loadError = message(error);
      })
      .finally(() => {
        if (this.current(source, epoch) && request === this.summaryRequest) this.loading = false;
      });
  }

  private loadChart(now: string): void {
    if (!this.source || !this.schema || !this.config?.show_chart) return;
    const source = this.source,
      epoch = this.epoch,
      request = ++this.chartRequest;
    this.chartLoading = true;
    this.chartError = '';
    void source
      .fetchChart(
        { ...this.config.filter },
        this.config.graph.periods,
        this.config.graph.metric,
        now,
      )
      .then((series) => {
        if (this.current(source, epoch) && request === this.chartRequest) this.series = series;
      })
      .catch((error: unknown) => {
        if (this.current(source, epoch) && request === this.chartRequest)
          this.chartError = message(error);
      })
      .finally(() => {
        if (this.current(source, epoch) && request === this.chartRequest) this.chartLoading = false;
      });
  }

  private loadHistoryPage = (): void => {
    if (
      !this.source ||
      !this.schema ||
      !this.historyOpen ||
      !this.historyEnd ||
      !this.historyScope ||
      this.recentLoading ||
      this.historyRestartRequired ||
      (this.recent && !this.historyHasMore)
    )
      return;
    const source = this.source,
      epoch = this.epoch,
      request = ++this.recentRequest,
      cursor = this.historyCursor;
    this.historyNeedsInitial = false;
    this.recentLoading = true;
    this.recentError = '';
    void source
      .fetchHistoryPage({ ...this.historyScope }, this.historyEnd, cursor ?? undefined)
      .then((page) => {
        if (!this.current(source, epoch) || request !== this.recentRequest) return;
        if (
          page.hasMore &&
          (!page.nextCursor ||
            page.nextCursor === cursor ||
            this.historyCursors.has(page.nextCursor))
        ) {
          throw new Error(
            'History pagination did not advance its cursor. Retry the page; if the problem persists, reopen History and report this integration error.',
          );
        }
        const records = [...(this.recent?.records ?? [])];
        const seen = new Set(records.map((record) => record.id));
        for (const record of page.records) {
          if (seen.has(record.id) || this.historyDeletedIds.has(record.id)) continue;
          seen.add(record.id);
          records.push(record);
        }
        this.recent = { records };
        this.historyCursor = page.nextCursor;
        if (page.nextCursor) this.historyCursors.add(page.nextCursor);
        this.historyHasMore = page.hasMore;
      })
      .catch((error: unknown) => {
        if (this.current(source, epoch) && request === this.recentRequest) {
          this.recentError = message(error);
          const code =
            typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
          this.historyRestartRequired =
            code === 'cursor_expired' ||
            code === 'cursor_query_mismatch' ||
            code === 'invalid_cursor';
        }
      })
      .finally(() => {
        if (this.current(source, epoch) && request === this.recentRequest)
          this.recentLoading = false;
      });
  };

  private resetHistoryTraversal(): void {
    ++this.recentRequest;
    ++this.historyTraversal;
    this.recent = undefined;
    this.recentLoading = false;
    this.recentError = '';
    this.historyCursor = null;
    this.historyCursors.clear();
    this.historyDeletedIds.clear();
    this.historyHasMore = false;
    this.historyRestartRequired = false;
    this.historyEnd = nowInstant();
    this.historyScope = { ...this.config!.filter };
    this.historyNeedsInitial = true;
  }

  private closeHistory(): void {
    const handle = this.historyHandle;
    this.historyHandle = undefined;
    this.historyToken = undefined;
    this.historyOpen = false;
    clearTimeout(this.historyTimer);
    ++this.recentRequest;
    ++this.historyTraversal;
    this.historyNeedsInitial = false;
    this.historyEnd = undefined;
    this.historyScope = undefined;
    this.recent = undefined;
    this.recentLoading = false;
    this.recentError = '';
    handle?.closeDialog();
  }

  private historyState(): HistoryState {
    return {
      config: this.config!,
      hass: this.hass!,
      data: this.recent,
      schema: this.schema,
      loading:
        !this.recent && (this.recentLoading || (this.historyNeedsInitial && this.schemaLoading)),
      pageLoading: this.recentLoading && Boolean(this.recent),
      hasMore: this.historyHasMore,
      restartRequired: this.historyRestartRequired,
      error: this.recentError,
      availabilityMessage:
        this.schemaError || this.subscriptionError || 'Checking the record schema.',
      availabilityError: Boolean(this.schemaError || this.subscriptionError),
      updateWarning: this.subscriptionError,
      available: Boolean(this.source && this.schema),
    };
  }

  private openHistory = (): void => {
    if (!this.config || !this.hass || this.historyOpen) return;
    const token = {};
    this.historyToken = token;
    this.resetHistoryTraversal();
    this.historyDialogError = '';
    const active = () => this.isConnected && this.historyToken === token;
    this.historyTimer = setTimeout(() => {
      if (!active() || this.historyHandle) return;
      this.closeHistory();
      this.historyDialogError =
        'Home Assistant did not open the native History dialog. Reload the dashboard and retry.';
    }, 3000);
    try {
      showHistoryDialog(this, {
        state: this.historyState(),
        isActive: active,
        onReady: (handle) => {
          if (!active()) return;
          clearTimeout(this.historyTimer);
          this.historyHandle = handle;
          this.historyOpen = true;
          this.loadHistoryPage();
        },
        onClosed: () => {
          if (!active()) return;
          this.historyHandle = undefined;
          this.closeHistory();
        },
        retry: () => {
          if (!active()) return;
          const needsRead = Boolean(this.recentError) || !this.recent;
          if (this.source && this.schema && !this.subscriptionError) {
            if (needsRead) this.loadHistoryPage();
          } else {
            this.historyNeedsInitial = needsRead;
            this.restart();
          }
        },
        loadMore: () => {
          if (active()) this.loadHistoryPage();
        },
        restart: () => {
          if (!active()) return;
          this.resetHistoryTraversal();
          if (this.source && this.schema) this.loadHistoryPage();
          else this.restart();
        },
        deleteRecord: async (id) => {
          if (!active())
            throw new Error('This history session is closed. Reopen History before deleting.');
          if (!this.recent?.records.some((record) => record.id === id))
            throw new Error(
              'This transaction is no longer in the displayed history. Refresh before deleting.',
            );
          if (this.historyRestartRequired)
            throw new Error('Restart history before attempting another deletion.');
          if (!this.source || !this.schema)
            throw new Error('Record schema is not ready. Reconnect before deleting.');
          const traversal = this.historyTraversal;
          try {
            await this.deleteRecord(id);
            if (!active() || traversal !== this.historyTraversal) return;
            this.historyDeletedIds.add(id);
            if (this.recent)
              this.recent = {
                records: this.recent.records.filter((record) => record.id !== id),
              };
          } catch (error) {
            if (active() && traversal === this.historyTraversal) {
              this.historyRestartRequired = true;
              this.recentError = `${message(error)} The transaction may already have been deleted. Restart history to recheck before another deletion.`;
            }
            throw error;
          }
        },
      });
    } catch (error) {
      this.closeHistory();
      this.historyDialogError = message(error);
    }
  };

  private save = async (record: NewTransaction): Promise<void> => {
    const source = this.source,
      epoch = this.epoch;
    if (!source || !this.schema)
      throw new Error('Record schema is not ready. Refresh before saving.');
    try {
      await source.addRecord(record);
    } finally {
      if (this.current(source, epoch)) {
        this.invalidateAndRefresh();
      }
    }
  };

  private deleteRecord = async (id: string): Promise<void> => {
    const source = this.source,
      epoch = this.epoch;
    if (!source || !this.schema)
      throw new Error('Record schema is not ready. Refresh before deleting.');
    try {
      await source.deleteRecord(id);
    } finally {
      if (this.current(source, epoch)) {
        this.invalidateAndRefresh();
      }
    }
  };

  private summaryView() {
    if (!this.config || !this.hass || !this.summary) return nothing;
    const summary = this.summary,
      currency = currencyFor(this.config, this.hass),
      locale = localeFor(this.hass);
    const trend = spendingTrend(summary.current, summary.previous);
    const unavailable =
      trend.direction === 'none' ||
      (this.config.trend_display === 'percentage' && trend.percent === null);
    const magnitude = unavailable
      ? '—'
      : this.config.trend_display === 'amount'
        ? money(Math.abs(trend.delta), currency, locale)
        : `${number(Math.abs(trend.percent!), locale, 1)}%`;
    const explanation =
      trend.direction === 'none'
        ? 'No previous-period transactions are available.'
        : unavailable
          ? 'Percentage change is unavailable because previous spending was zero.'
          : `Spending ${trend.direction === 'up' ? 'increased' : trend.direction === 'down' ? 'decreased' : 'is unchanged'}${trend.direction === 'flat' ? '' : ` by ${magnitude}`}.`;
    return html`<section
      class=${`summary${this.config.show_summary && this.config.show_trend ? ' with-trend' : ''}`}
      aria-label="Billing period spending"
    >
      <div class="values">
        ${
          this.config.show_summary
            ? html`<div class="spend">${money(summary.current.cost, currency, locale)}</div>`
            : nothing
        }
        ${
          this.config.show_trend
            ? html`<div
                class="trend"
                role="img"
                aria-label=${`${explanation} Comparison of the current partial billing period with the entire previous period.`}
              >
                <span class=${unavailable ? '' : trend.direction}
                  >${unavailable ? '' : trend.direction === 'up' ? '↑ ' : trend.direction === 'down' ? '↓ ' : '↔ '}${magnitude}</span
                >
              </div>`
            : nothing
        }
      </div>
      ${
        this.config.show_summary
          ? html`<div class="caption muted">
              ${date(summary.periods.current.start, this.hass)} –
              ${date(summary.periods.current.end, this.hass)}
            </div>`
          : nothing
      }
    </section>`;
  }

  render() {
    if (this.configError)
      return html`<ha-card><p class="error" role="alert">${this.configError}</p></ha-card>`;
    if (!this.config || !this.hass)
      return html`<ha-card
        ><p class="status">Waiting for Home Assistant configuration…</p></ha-card
      >`;
    const config = this.config;
    const hasTitle = Boolean(config.title.trim());
    const hasActions = config.show_add_button || config.show_recent_records;
    return html`<ha-card
      ><div
        class="content"
        .inert=${this.dialogOpen}
        aria-hidden=${this.dialogOpen ? 'true' : 'false'}
      >
        ${
          hasTitle || hasActions
            ? html`<header class=${hasTitle ? 'has-title' : nothing}>
                ${hasTitle ? html`<h1>${config.title}</h1>` : nothing}
                ${
                  hasActions
                    ? html`<div class="card-actions">
                        ${config.show_recent_records ? actionControl({ label: 'History', disabled: this.historyOpen, onClick: () => this.openHistory() }) : nothing}
                        ${
                          config.show_add_button
                            ? actionControl({
                                label: 'Add transaction',
                                content: 'Add',
                                appearance: 'primary',
                                disabled: !this.schema || this.historyOpen,
                                onClick: () => {
                                  this.dialogOpen = true;
                                },
                              })
                            : nothing
                        }
                      </div>`
                    : nothing
                }
              </header>`
            : nothing
        }
        ${this.schemaLoading ? html`<p role="status">Checking record schema…</p>` : nothing}
        ${
          this.schemaError
            ? html`<p class="error" role="alert">
                  Cannot use this record type: ${this.schemaError}
                </p>
                ${actionControl({ label: 'Retry schema check', onClick: () => this.restart() })}`
            : nothing
        }
        ${
          this.subscriptionError
            ? html`<p class="error" role="alert">${this.subscriptionError}</p>
                ${actionControl({ label: 'Reconnect live updates', onClick: () => this.restart() })}`
            : nothing
        }
        ${
          this.schema?.retention_days || this.schema?.max_records
            ? html`<details class="retention muted">
                <summary>Retained records only · history may be pruned</summary>
                <p>
                  History can be pruned by Custom Records:
                  ${this.schema.retention_days ? `${this.schema.retention_days} days retention. ` : ''}
                  ${this.schema.max_records ? `Maximum ${this.schema.max_records} records. ` : ''}Totals
                  include retained records only; deleted history cannot be recovered by this card.
                </p>
              </details>`
            : nothing
        }
        ${
          this.historyDialogError
            ? html`<p class="error" role="alert">${this.historyDialogError}</p>
                ${actionControl({ label: 'Retry History', onClick: () => this.openHistory() })}`
            : nothing
        }
        ${this.loading ? html`<p role="status">Loading billing-period totals…</p>` : nothing}
        ${
          this.loadError
            ? html`<p class="error" role="alert">
                  Summary unavailable:
                  ${this.loadError}${this.summary ? ' Displayed totals are from the last successful refresh.' : ''}
                </p>
                ${actionControl({ label: 'Retry totals', onClick: () => this.invalidateAndRefresh() })}`
            : nothing
        }
        ${this.summaryView()}
        ${
          config.show_chart
            ? html`<section class="chart">
                ${this.chartLoading ? html`<p role="status">Loading chart…</p>` : nothing}
                ${
                  this.chartError
                    ? html`<p class="error" role="alert">Chart unavailable: ${this.chartError}</p>
                        ${actionControl({ label: 'Retry chart', onClick: () => this.invalidateAndRefresh() })}`
                    : nothing
                }
                ${!this.chartLoading && !this.chartError && this.schema ? html`<tankrupt-fuel-chart .series=${this.series} .config=${config} .hass=${this.hass} .scope=${config.filter} .metric=${config.graph.metric}></tankrupt-fuel-chart>` : nothing}
              </section>`
            : nothing
        }
      </div>
      ${
        this.dialogOpen
          ? html`<tankrupt-add-dialog
              .config=${config}
              .hass=${this.hass}
              .save=${this.save}
              .available=${Boolean(this.schema)}
              .availabilityMessage=${this.schemaError || this.subscriptionError || 'Checking the record schema.'}
              @dialog-close=${() => {
                this.dialogOpen = false;
              }}
            ></tankrupt-add-dialog>`
          : nothing
      }</ha-card
    >`;
  }
}
