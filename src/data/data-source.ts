import type {
  ChartSeries,
  HistoryPage,
  Metric,
  NewTransaction,
  PeriodCount,
  RecordType,
  Scope,
  Summary,
  Unsubscribe,
} from '../types';

export interface DataSource {
  getRecordType(): Promise<RecordType>;
  fetchSummary(scope: Scope, now: string): Promise<Summary>;
  fetchChart(
    scope: Scope,
    periods: PeriodCount,
    metric: Metric,
    now: string,
  ): Promise<ChartSeries[]>;
  fetchHistoryPage(scope: Scope, now: string, cursor?: string): Promise<HistoryPage>;
  addRecord(record: NewTransaction): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  subscribeUpdates(callback: () => void): Promise<Unsubscribe>;
  invalidate(): void;
}
