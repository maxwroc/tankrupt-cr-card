export type Fuel = 'petrol' | 'diesel' | 'electricity';
export type LiquidUnit = 'L' | 'US_gal' | 'imp_gal';
export type Unit = LiquidUnit | 'kWh';
export type PriceBasis = 1 | 100;
export type InputMode = 'quantity_total' | 'quantity_price';
export type Metric = 'spending' | 'price' | 'quantity';
export type TrendDisplay = 'percentage' | 'amount';
export type PeriodCount = 1 | 3 | 6 | 12;
export type Unsubscribe = () => void;

export interface HassConnection {
  sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
  subscribeEvents(
    callback: (event: { data: { record_type?: string } }) => void,
    eventType: string,
  ): Promise<Unsubscribe>;
  addEventListener?(type: string, callback: () => void): void;
  removeEventListener?(type: string, callback: () => void): void;
}

export interface Hass {
  connection: HassConnection;
  config: { time_zone: string; currency?: string };
  locale?: {
    language: string;
    date_format?: 'language' | 'system' | 'DMY' | 'MDY' | 'YMD';
    time_format?: 'language' | 'system' | '12' | '24';
    first_weekday?: 'language' | 'system' | 'saturday' | 'sunday' | 'monday';
  };
  language?: string;
}

export interface Vehicle {
  id: string;
  name: string;
  fuels: Fuel[];
  image?: string;
  unit?: Unit;
  price_basis?: PriceBasis;
}

export interface FieldMapping {
  vehicle_id: string;
  fuel_type: string;
  quantity: string;
  unit_price: string;
  total_cost: string;
  vehicle_name: string;
}

export interface CardConfig {
  type: string;
  record_type: string;
  title?: string;
  currency?: string;
  billing_start_day?: number;
  input_mode?: InputMode;
  liquid_unit?: LiquidUnit;
  price_basis?: PriceBasis;
  graph?: { metric?: Metric; periods?: PeriodCount };
  filter?: Scope;
  trend_display?: TrendDisplay;
  recent_limit?: number;
  vehicles?: Vehicle[];
  fields?: Partial<FieldMapping>;
  show_summary?: boolean;
  show_trend?: boolean;
  show_chart?: boolean;
  show_add_button?: boolean;
  show_recent_records?: boolean;
}

export interface ResolvedConfig {
  type: string;
  record_type: string;
  title: string;
  currency?: string;
  billing_start_day: number;
  input_mode: InputMode;
  liquid_unit: LiquidUnit;
  price_basis: PriceBasis;
  graph: { metric: Metric; periods: PeriodCount };
  filter: Scope;
  trend_display: TrendDisplay;
  recent_limit: number;
  vehicles: Vehicle[];
  fields: FieldMapping;
  show_summary: boolean;
  show_trend: boolean;
  show_chart: boolean;
  show_add_button: boolean;
  show_recent_records: boolean;
}

export interface RecordField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  default?: unknown;
  options?: string[];
}

export interface RecordType {
  id: string;
  name: string;
  fields: RecordField[];
  retention_days?: number | null;
  max_records?: number | null;
}

export interface TransactionValues {
  vehicle_id: string;
  fuel_type: Fuel;
  quantity: number;
  unit_price: number;
  total_cost: number;
  vehicle_name?: string;
}

export interface Transaction extends TransactionValues {
  id: string;
  timestamp: string;
}

export interface NewTransaction extends TransactionValues {
  timestamp: string;
}

export interface Scope {
  vehicle?: string;
  fuel?: Fuel;
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface BillingPeriods {
  current: TimeRange;
  previous: TimeRange;
}

export interface Totals {
  cost: number;
  /** Only meaningful for a single fuel; all-fuel queries do not add unlike quantities. */
  quantity: number;
  count: number;
}

export interface Summary {
  periods: BillingPeriods;
  current: Totals;
  previous: Totals;
}

export interface ChartPoint extends TimeRange {
  totals: Totals;
}

export interface ChartSeries {
  id: string;
  label: string;
  fuel?: Fuel;
  points: ChartPoint[];
}

export interface RecentRecords {
  records: Transaction[];
}

export interface HistoryPage {
  records: Transaction[];
  nextCursor: string | null;
  hasMore: boolean;
}
