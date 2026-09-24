import type { LitElement, ReactiveController } from 'lit';

export function textInkOffset(metrics: TextMetrics, lineHeight: number): number {
  return (
    (lineHeight - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 +
    metrics.fontBoundingBoxAscent -
    metrics.actualBoundingBoxAscent
  );
}

export class TextTopAlignment implements ReactiveController {
  private connected = false;
  private resize?: ResizeObserver;
  private frame?: number;

  constructor(private host: LitElement) {
    host.addController(this);
  }

  hostConnected(): void {
    this.connected = true;
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(this.schedule);
      this.resize.observe(this.host);
    }
    document.fonts?.addEventListener('loadingdone', this.schedule);
    void document.fonts?.ready.then(this.schedule);
  }

  hostDisconnected(): void {
    this.connected = false;
    this.resize?.disconnect();
    document.fonts?.removeEventListener('loadingdone', this.schedule);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  hostUpdated(): void {
    this.schedule();
  }

  private schedule = (): void => {
    if (!this.connected || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.align();
    });
  };

  private align(): void {
    const total = this.host.renderRoot.querySelector<HTMLElement>('.spend');
    const trend = this.host.renderRoot.querySelector<HTMLElement>('.trend');
    let offset = 0;
    const trimsText = typeof CSS !== 'undefined' && CSS.supports?.('text-box-trim', 'trim-start');
    if (total && trend && !trimsText) {
      const context = document.createElement('canvas').getContext('2d');
      if (context) {
        const top = (element: HTMLElement): number => {
          const style = getComputedStyle(element);
          context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          return textInkOffset(
            context.measureText(element.textContent?.trim() ?? ''),
            parseFloat(style.lineHeight),
          );
        };
        const difference = top(total) - top(trend);
        if (Number.isFinite(difference)) offset = difference;
      }
    }
    const value = `${offset}px`;
    if (this.host.style.getPropertyValue('--tankrupt-trend-top-offset') !== value) {
      this.host.style.setProperty('--tankrupt-trend-top-offset', value);
    }
  }
}
