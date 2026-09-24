import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { Transaction } from '../types';
import { sharedStyles } from '../styles/shared.css';
import {
  HISTORY_DIALOG_TAG,
  modernDialogSurface,
  type HistoryDialogParams,
  type HistoryHandle,
  type HistoryState,
} from './history-dialog-contract';
import { emit, message } from './ui-helpers';
import { actionControl } from './action-control';
import './recent-records';

@customElement(HISTORY_DIALOG_TAG)
export class HistoryDialog extends LitElement implements HistoryHandle {
  @state() private view?: HistoryState;
  @state() private selected?: { record: Transaction; description: string };
  @state() private pending = false;
  @state() private deletionError = '';
  private session?: HistoryDialogParams;
  private generation = 0;
  private modern = false;
  private returnFocus?: HTMLElement;

  static styles = [
    sharedStyles,
    css`
      ha-dialog {
        --mdc-dialog-min-width: min(90vw, 480px);
        --mdc-dialog-max-width: 580px;
      }
      .body {
        overflow-wrap: anywhere;
      }
      .actions {
        margin: 0;
        padding: 12px 0;
      }
      .warning {
        padding: 8px 12px;
      }
    `,
  ];

  showDialog(params: HistoryDialogParams): void {
    if (!params.isActive()) {
      if (!this.session) emit(this, 'dialog-closed', { dialog: HISTORY_DIALOG_TAG });
      return;
    }
    // HA caches a single element per tag. Never retain the previous card's callbacks.
    if (this.session) this.release(false);
    this.session = params;
    this.view = params.state;
    this.selected = undefined;
    this.pending = false;
    this.deletionError = '';
    this.modern = modernDialogSurface();
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    this.returnFocus = active instanceof HTMLElement ? active : undefined;
    params.onReady(this);
    this.focusAction();
  }

  updateHistory(state: HistoryState): void {
    if (this.session?.isActive()) this.view = state;
  }

  closeDialog(): boolean {
    // Closing never retries a write; a late result is guarded by generation.
    this.release(true);
    return true;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.release(false);
  }

  private release(notify: boolean): void {
    const params = this.session;
    if (!params) return;
    ++this.generation;
    this.session = undefined;
    this.view = undefined;
    this.selected = undefined;
    this.pending = false;
    this.deletionError = '';
    params.onClosed();
    if (notify) {
      emit(this, 'dialog-closed', { dialog: HISTORY_DIALOG_TAG });
      const target = this.returnFocus;
      void this.updateComplete.then(() => {
        if (!this.session && target?.isConnected) target.focus();
      });
    }
    this.returnFocus = undefined;
  }

  private focusAction(): void {
    void this.updateComplete.then(() => {
      if (this.isConnected) this.renderRoot.querySelector<HTMLElement>('.history-focus')?.focus();
    });
  }

  private back = (): void => {
    if (this.pending) return;
    this.selected = undefined;
    this.focusAction();
  };

  private confirm = async (): Promise<void> => {
    const params = this.session;
    if (
      !params?.isActive() ||
      !this.selected ||
      !this.view?.available ||
      this.pending ||
      this.deletionError
    )
      return;
    const generation = this.generation;
    const id = this.selected.record.id;
    this.pending = true;
    try {
      await params.deleteRecord(id);
      if (generation !== this.generation || this.session !== params) return;
      this.selected = undefined;
      this.focusAction();
    } catch (error) {
      if (generation !== this.generation || this.session !== params) return;
      this.deletionError = `${message(error)} The transaction may already have been deleted. Return to history and explicitly restart it to recheck before trying again. No automatic retry was made.`;
    } finally {
      if (generation === this.generation && this.session === params) this.pending = false;
    }
  };

  render() {
    const view = this.view;
    if (!view) return nothing;
    const title = this.selected ? 'Delete this transaction?' : 'Transaction history';
    const restartRequired = view.restartRequired || Boolean(this.deletionError);
    return html`<ha-dialog
      .open=${true}
      .headerTitle=${this.modern ? title : undefined}
      .heading=${this.modern ? undefined : title}
      @closed=${(event: Event) => {
        if (
          event.target !== event.currentTarget ||
          event.currentTarget !== this.renderRoot.querySelector('ha-dialog')
        )
          return;
        event.stopPropagation();
        this.closeDialog();
      }}
    >
      <div class="body">
        ${!view.available ? html`<p class="warning" role="status">${view.availabilityMessage || 'Waiting for the connection and record schema before deleting.'}</p>` : nothing}
        ${view.available && view.updateWarning ? html`<p class="warning" role="status">${view.updateWarning}</p>` : nothing}
        ${
          this.selected
            ? html`<p>${this.selected.description}</p>
                <small>Record ID: ${this.selected.record.id}</small>
                <p>
                  This cannot be undone. To correct a transaction, delete it and add a replacement.
                </p>
                ${this.deletionError ? html`<p class="error" role="alert">${this.deletionError}</p>` : nothing}`
            : html`
                ${
                  view.schema?.retention_days || view.schema?.max_records
                    ? html`<p class="warning">
                        Custom Records may prune history.
                        ${view.schema.retention_days ? `${view.schema.retention_days} days retention. ` : ''}
                        ${view.schema.max_records ? `Maximum ${view.schema.max_records} records. ` : ''}
                        Totals and history include retained records only.
                      </p>`
                    : nothing
                }
                ${view.loading ? html`<p role="status">Loading recent transactions…</p>` : nothing}
                ${view.pageLoading ? html`<p role="status">Loading older transactions…</p>` : nothing}
                ${view.error || this.deletionError ? html`<p class="error" role="alert">History request failed: ${view.error || this.deletionError}${view.data ? ' Loaded records have been kept.' : ''}</p>` : nothing}
                ${
                  restartRequired
                    ? actionControl({
                        label: 'Restart history',
                        disabled: view.loading || view.pageLoading,
                        onClick: () => {
                          this.deletionError = '';
                          this.session?.restart();
                        },
                      })
                    : view.error || view.availabilityError
                      ? actionControl({
                          label: 'Retry',
                          disabled: view.loading || view.pageLoading,
                          onClick: () => this.session?.retry(),
                        })
                      : nothing
                }
                ${
                  view.data
                    ? html`<tankrupt-recent-records
                        .data=${view.data}
                        .config=${view.config}
                        .hass=${view.hass}
                        .available=${view.available && !view.loading && !view.pageLoading && !view.error && !restartRequired}
                        @request-delete=${(
                          event: CustomEvent<{ record: Transaction; description: string }>,
                        ) => {
                          event.stopPropagation();
                          if (!this.view?.available || this.pending || restartRequired) return;
                          this.selected = event.detail;
                          this.deletionError = '';
                          this.focusAction();
                        }}
                      ></tankrupt-recent-records>`
                    : nothing
                }
              `
        }
      </div>
      <div class="actions" slot=${this.modern ? 'footer' : 'secondaryAction'}>
        ${
          this.selected
            ? html`${actionControl({ label: 'Back to history', className: 'history-focus', disabled: this.pending, onClick: () => this.back() })}
              ${actionControl({
                label: 'Delete transaction',
                content: this.pending ? 'Deleting…' : 'Delete transaction',
                appearance: 'danger',
                pending: this.pending,
                disabled: !view.available || Boolean(this.deletionError),
                onClick: () => {
                  void this.confirm();
                },
              })}`
            : html`${
                view.hasMore && !view.error && !restartRequired
                  ? actionControl({
                      label: 'Load more',
                      content: view.pageLoading ? 'Loading more…' : 'Load more',
                      disabled: !view.available || view.loading,
                      pending: view.pageLoading,
                      onClick: () => this.session?.loadMore(),
                    })
                  : nothing
              }
              ${actionControl({
                label: 'Close',
                className: 'history-focus',
                onClick: () => {
                  this.closeDialog();
                },
              })}`
        }
      </div>
    </ha-dialog>`;
  }
}
