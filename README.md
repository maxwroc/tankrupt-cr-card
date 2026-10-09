# Tankrupt — Custom Records card

A Home Assistant dashboard card for petrol, diesel and EV spending, powered by
[Custom Records](https://github.com/maxwroc/custom_records).

- Log purchases for one or more vehicles, including plug-in hybrids.
- Compare billing-period spending and chart cost, quantity or effective price.
- Browse and delete transactions. No sensors or odometer readings needed.

## Installation

Install and configure a current version of **Custom Records** first; Tankrupt
requires its aggregates and paginated history APIs.

### HACS

1. Add `https://github.com/maxwroc/tankrupt-cr-card` as a **Dashboard** custom repository.
2. Download the card and reload your browser.
3. If HACS did not register the resource, add it under **Settings → Dashboards → Resources**:

```yaml
url: /hacsfiles/tankrupt-cr-card/tankrupt-cr-card.js
type: module
```

### Manual

1. Download `tankrupt-cr-card.js` from a [release](https://github.com/maxwroc/tankrupt-cr-card/releases)
   into `<config>/www/`.
2. Add `/local/tankrupt-cr-card.js` as a **JavaScript module** in dashboard Resources
   (enable advanced mode if needed).
3. Reload your browser after installing or updating.

## Initial setup

1. Open **Settings → Devices & Services → Custom Records → Add record type**.
2. Choose any name, then paste the YAML below into **Field definition**. Review
   retention and maximum-record limits before saving.
3. Add Tankrupt to your dashboard and select that record type in the visual editor.
   Use **Refresh record types** if it is not yet listed.

```yaml
fields:
  - { key: vehicle_id, label: Vehicle ID, type: text, required: true }
  - { key: fuel_type, label: Fuel type, type: text, required: true }
  - { key: quantity, label: Quantity, type: number, required: true }
  - { key: unit_price, label: Unit price, type: number, required: true }
  - { key: total_cost, label: Total cost, type: number, required: true }
  - { key: vehicle_name, label: Vehicle name, type: text, required: false }
```

- Use the integration's built-in timestamp; do not create a timestamp field.
- Existing schemas need the same field types; use [field mappings](#field-mappings) for different keys.
  Additional required fields must have usable defaults. Schema keys, types and requiredness cannot be edited later.
- New cards have **no record type selected**. Setup instructions stay visible until you select one.
  Use the logical record-type ID, not an HA entity or integration-entry ID.

Minimal YAML:

```yaml
type: custom:tankrupt-cr-card
record_type: fuel_purchases # Example ID: replace with the record type you created
```

No vehicles are required: Add offers petrol, diesel and electricity, storing
`vehicle_id: unassigned`.

## Configuration reference

Use the visual editor for common settings or YAML for all options.

| Option | Default | Values / purpose |
| --- | --- | --- |
| `type` | Required | `custom:tankrupt-cr-card` |
| `record_type` | Required; no default | Your logical Custom Records type ID |
| `title` | `Tankrupt` | Card title; `""` hides it |
| `currency` | HA currency | Three-letter currency code; required if HA has none |
| `billing_start_day` | `1` | Integer 1–31; clamped to each month's last day |
| `input_mode` | `quantity_total` | `quantity_total` or `quantity_price` |
| `liquid_unit` | `L` | `L`, `US_gal`, `imp_gal` |
| `price_basis` | `1` | Quoted/displayed price per `1` or `100` units |
| `graph.metric` | `spending` | `spending`, `price`, `quantity` |
| `graph.periods` | `12` | `1`, `3`, `6`, `12` billing periods |
| `trend_display` | `percentage` | `percentage` or `amount` (currency difference) |
| `filter.vehicle` | All vehicles | Vehicle ID, including historical IDs or `unassigned` |
| `filter.fuel` | All fuels | `petrol`, `diesel`, `electricity` |
| `recent_limit` | `20` | History batch size; integer 1–500 |
| `show_summary` | `true` | Show current billing-period spending |
| `show_trend` | `true` | Show spending comparison |
| `show_chart` | `true` | Show chart |
| `show_add_button` | `true` | Show Add transaction |
| `show_recent_records` | `true` | Show History, not an inline transaction list |
| `vehicles` | `[]` | Vehicle definitions below |
| `fields` | Canonical field keys | Backend field-key mappings below |

- IDs and mapped field keys use lowercase letters/digits separated by single underscores,
  up to 63 characters.
- Filters affect the summary, trend, chart and History, **not Add choices**.
  The editor shows the vehicle filter only when vehicles exist; YAML can always set it.
- All cards and automations sharing a record type must use **one currency**.
  Changing `currency` relabels amounts; it does not convert them.

### Vehicles

| Vehicle option | Default | Values / purpose |
| --- | --- | --- |
| `id` | Required | Unique, stable ID; `unassigned` is reserved |
| `name` | Required | Nonblank display name |
| `fuels` | Required | Nonempty list of `petrol`, `diesel`, `electricity` |
| `image` | None | HTTP(S) URL or local `/` path, e.g. `/local/cars/car.webp` |
| `unit` | Card's `liquid_unit`; `kWh` for electricity | `L`, `US_gal`, `imp_gal`, `kWh`; must suit the vehicle's fuels |
| `price_basis` | Card's `price_basis` | `1` or `100` |

- Keep IDs stable when renaming vehicles or sharing configuration between cards.
  Removing a vehicle leaves its historical transactions intact.
- For hybrids, a liquid-unit override affects liquid fuels only; electricity always uses kWh.
  An electricity-only vehicle may use `kWh`, not a liquid-unit override.

Example with two vehicles:

```yaml
type: custom:tankrupt-cr-card
record_type: fuel_purchases # Example ID: replace with yours
title: Fuel costs
billing_start_day: 25
vehicles:
  - id: family_hybrid
    name: Family hybrid
    fuels: [petrol, electricity]
    image: /local/cars/family.webp
  - id: work_diesel
    name: Work car
    fuels: [diesel]
    unit: US_gal
    price_basis: 1
```

### Field mappings

Use `fields` to map each canonical key to your backend key. Omitted mappings use
the canonical key; `vehicle_name` may be absent from the schema.

```yaml
fields:
  vehicle_id: car_id
  fuel_type: energy_type
  quantity: delivered
  unit_price: effective_price
  total_cost: paid
  vehicle_name: car_name
```

- Only the six keys above are supported. Targets must be unique, cannot be `id` or
  `timestamp`, and must match the field types in the setup definition.
- Mappings rename fields; they do not convert historical units or prices.

## Add records from an automation

Call `custom_records.add_record` with nested `fields`. This example records
40 litres of petrol at 1.50 per litre, total 60:

```yaml
action: custom_records.add_record
data:
  record_type: fuel_purchases # Example ID: replace with yours
  timestamp: '2026-09-01T18:30:00+01:00'
  fields:
    vehicle_id: family_hybrid
    vehicle_name: Family hybrid
    fuel_type: petrol
    quantity: 40
    unit_price: 1.5
    total_cost: 60
```

- `fuel_type`: `petrol`, `diesel` or `electricity`. Quantities are always **litres**
  or **kWh**, and `unit_price` is always per **one** litre/kWh, regardless of card display units.
- `total_cost`: the amount in the shared currency. Do not send currency, unit or price-basis fields.
- Use the same vehicle IDs as the card, or `unassigned` without vehicles.
  `vehicle_name` is an optional historical name snapshot.
- `timestamp` is optional and top-level; supply an offset-aware timestamp or omit it for now.
- With field mappings, send your backend keys instead of the canonical keys.

## Development

Requires **Node.js 22+**.

```sh
npm ci
npm run lint
npm run type-check
npm test
npm run test:coverage
npm run build
npm run watch
```

- Production bundle: `dist/tankrupt-cr-card.js`. Generated bundles are not committed.
- `watch`: demo at `http://127.0.0.1:5000`, with YAML/UI editing, themes, widths and test fixtures.
  Demo records are in memory; it never connects to HA. Do not install `dist/demo.js` in HA.
- Check changes in real HA as well as the demo, especially editors, dialogs and themes.
- CI runs lint, type-check, coverage and build. Publishing a release builds and attaches
  the card bundle, then validates HACS; version updates stay in the CI checkout.

## Usage, billing and charts

### Transactions

- **Quantity + total** derives an effective unit price. **Quantity + price** derives
  the total, rounded to currency precision. Quantity must be positive; zero cost is allowed.
- Use **⋮ → Switch entry mode** to change mode temporarily. Quantity/date stay; the amount clears.
- Date/time follows HA's regional settings and configured time zone.
  Ambiguous or nonexistent daylight-saving times must be corrected.
- History loads `recent_limit` records at a time; **Load more** continues.
  To correct a transaction, delete it and add a replacement.
- After an uncertain save/delete result, check History before retrying.
  Retention or maximum-record policies can permanently remove older records.

### Billing and charts

- Billing starts at local midnight on `billing_start_day`; short months clamp the day independently.
- The summary covers the current period **so far**; the trend compares it with the **entire previous period**.
  Percentage change from zero is unavailable; use `trend_display: amount` for a currency difference.
- **Spending** sums costs; **quantity** sums delivered amounts; **price** is weighted:
  total cost divided by total quantity, converted to display units.
- Chart ranges: `1` period uses daily buckets, `3` weekly, `6`/`12` billing months.
  Missing data stays blank; real zero-cost purchases remain visible.
- Totals/charts use all matching retained records, not just loaded History.
  Fuel price/quantity series stay separate; spending can combine fuels.
- Liquid storage is litres (US gallon = 3.785411784 L; imperial gallon = 4.54609 L);
  electricity is kWh. Changing display units does not change stored data.

## License

MIT licensed — see [LICENSE](LICENSE).
