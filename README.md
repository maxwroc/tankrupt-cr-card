# Tankrupt — Custom Records card

A Home Assistant dashboard card for petrol, diesel and electric-vehicle spending,
powered by the [Custom Records integration](https://github.com/maxwroc/custom_records).
Track purchases, compare billing periods, and chart spending, delivered quantity or
effective unit price. No sensors, odometer readings or consumption estimates are needed.

## Install

Install and configure Custom Records first. Tankrupt needs an integration version
supporting record-type discovery, flat record lists, filtered **multi-metric
aggregates**, add/delete, and `custom_records_updated` WebSocket events. Older
versions without aggregate support cannot provide complete totals; the card reports
the failure rather than substituting a sum of recent records.

### HACS

Once a release is available, add `https://github.com/maxwroc/tankrupt-cr-card` as a
**Dashboard** custom repository in HACS, download it, and reload your browser.
If HACS has not registered the dashboard resource, add:

```yaml
url: /hacsfiles/tankrupt-cr-card/tankrupt-cr-card.js
type: module
```

### Manual

Download `tankrupt-cr-card.js` from a GitHub release into
`<config>/www/tankrupt-cr-card.js`. Register `/local/tankrupt-cr-card.js` as a
JavaScript module in **Settings → Dashboards → Resources** (advanced mode may
need enabling). Reload the browser after changing the resource.
The repository intentionally does not contain a generated `dist/` bundle.

## Create the database record type

Create a record type **manually** in Custom Records with logical ID
`fuel_purchases`. Use the logical record-type ID, not a Home Assistant entity ID,
table name or integration entry ID.

| Field key      | Backend type | Required | Meaning                                                                  |
| -------------- | ------------ | -------- | ------------------------------------------------------------------------ |
| `vehicle_id`   | `text`       | Yes      | Stable vehicle ID; `unassigned` if there is no configured vehicle        |
| `fuel_type`    | `text`       | Yes      | `petrol`, `diesel` or `electricity`                                      |
| `quantity`     | `number`     | Yes      | Delivered **litres** for petrol/diesel or **kWh** for electricity        |
| `unit_price`   | `number`     | Yes      | Currency price per **one** canonical litre or kWh; see entry modes below |
| `total_cost`   | `number`     | Yes      | Transaction cost in the shared configured currency                       |
| `vehicle_name` | `text`       | No       | Optional historical display-name snapshot                                |

The integration's built-in **timestamp** is the transaction time. Do not create a
duplicate timestamp field. Use `text`, not backend select fields, for historical
identifiers: removing a select option can otherwise invalidate historical filters.
Tankrupt validates the fuel identifiers itself.

**Do not add currency, unit, input-unit or price-basis fields.** These are static
card settings, not record metadata. The stored `fuel_type` determines the canonical
dimension. There is no schema importer or automatic provisioning in this card.

### Setup checklist

1. Create the five required fields with the exact types above.
2. Optionally add `vehicle_name` as an optional text field.
3. Check retention and maximum-record settings before adding history.
4. Configure the logical record type in the card.
5. Check HA's currency and time zone, or set a card currency override.
6. Use the same vehicle IDs and currency convention in every card and external writer.

Schema keys, types and requiredness are immutable in Custom Records; only optional
fields can be added later. A mistyped/missing mapped field blocks writes with an
actionable compatibility error. Additional required fields need usable schema
defaults; otherwise the schema is incompatible. Tankrupt never writes directly to
HA's storage. Back up your data before replacing an incompatible record type.

## Quick start

Without configured vehicles the Add flow offers petrol, diesel and electricity;
new records use the reserved `unassigned` vehicle ID.

```yaml
type: custom:tankrupt-cr-card
record_type: fuel_purchases
```

Use the visual editor for ordinary options. YAML supports the full configuration,
including field mappings and detailed vehicle unit overrides.

### Two vehicles, including a plug-in hybrid

```yaml
type: custom:tankrupt-cr-card
record_type: fuel_purchases
title: Fuel costs
billing_start_day: 25
input_mode: quantity_total
liquid_unit: L
price_basis: 1
graph:
  metric: spending
  periods: 12
vehicles:
  - id: family_hybrid
    name: Family hybrid
    fuels:
      - petrol
      - electricity
    image: /local/cars/family.webp
  - id: work_diesel
    name: Work car
    fuels:
      - diesel
    unit: US_gal
    price_basis: 1
```

Vehicle IDs are durable identity, not labels. Keep IDs unchanged when renaming or
reordering vehicles and copy the same IDs to other dashboards. IDs must be unique,
safe identifiers; `unassigned` is reserved and must not be configured as a vehicle.
Names can be changed freely. Removing a vehicle does not delete its records:
historical IDs remain included when no vehicle filter is configured, with the stored
name or ID as a fallback in History.
Changing today's allowed fuels does not reinterpret yesterday's recorded fuel.

One single-fuel vehicle goes directly to numeric entry. One multi-fuel vehicle
skips car selection but asks for fuel. With several vehicles, choose a vehicle
first. Images are optional; unavailable images fall back to an icon. A hybrid
should normally inherit fuel-appropriate units rather than set one incompatible
unit for both electricity and liquid fuel.

### EV price quoted per 100 kWh

```yaml
type: custom:tankrupt-cr-card
record_type: fuel_purchases
input_mode: quantity_price
vehicles:
  - id: electric_car
    name: Electric car
    fuels: [electricity]
    unit: kWh
    price_basis: 100
```

For example, 40 kWh at 25 currency units per 100 kWh costs 10.
Storage remains `quantity: 40`, `unit_price: 0.25`, `total_cost: 10`.

## Configuration reference

| Option                | Default              | Accepted values / purpose                                   |
| --------------------- | -------------------- | ----------------------------------------------------------- |
| `type`                | Required             | `custom:tankrupt-cr-card`                                   |
| `record_type`         | Required             | Logical Custom Records type ID                              |
| `title`               | `Tankrupt`           | Card title; use `""` to hide it                             |
| `currency`            | HA system currency   | Optional currency-code override; choose one if HA has none  |
| `billing_start_day`   | `1`                  | Integer 1–31, independently clamped each month              |
| `input_mode`          | `quantity_total`     | `quantity_total` or `quantity_price`                        |
| `liquid_unit`         | `L`                  | `L`, `US_gal`, `imp_gal`                                    |
| `price_basis`         | `1`                  | `1` or `100` compatible display units                       |
| `graph.metric`        | `spending`           | `spending`, `price`, `quantity`                             |
| `graph.periods`       | `12`                 | `1`, `3`, `6`, `12` billing periods                         |
| `trend_display`       | `percentage`         | `percentage` or `amount` (currency difference)              |
| `filter.vehicle`      | All vehicles         | Stable vehicle ID, including historical IDs or `unassigned` |
| `filter.fuel`         | All fuels            | `petrol`, `diesel`, `electricity`                           |
| `recent_limit`        | `20`                 | History batch size, integer 1–500                           |
| `show_summary`        | `true`               | Show current billing-period total                           |
| `show_trend`          | `true`               | Show comparison with the entire previous billing period     |
| `show_chart`          | `true`               | Show the configured chart                                   |
| `show_add_button`     | `true`               | Show the Add transaction button                             |
| `show_recent_records` | `true`               | Show the History action (never an inline list)              |
| `vehicles`            | `[]`                 | Optional vehicle definitions                                |
| `fields`              | Canonical keys below | Advanced field-key mapping                                  |

Each vehicle has required `id`, `name`, and a nonempty `fuels` list containing
`petrol`, `diesel` and/or `electricity`. Optional `image` is an image URL;
`unit` is `L`, `US_gal`, `imp_gal` or `kWh` as compatible with its fuels;
`price_basis` is `1` or `100`. Electricity always uses an energy unit, never gallons.

### Display filters and trend

The card's ordinary actions are **Add** and **History**. Choose graph settings,
trend format and filters in the visual editor or YAML, not inside the card:

```yaml
type: custom:tankrupt-cr-card
record_type: fuel_purchases
trend_display: amount
filter:
  vehicle: retired_car
  fuel: petrol
graph:
  metric: spending
  periods: 12
show_recent_records: true
```

Set `show_add_button: false` to hide **Add**, or turn off **Show Add button** in the
visual editor. It is enabled by default. This only hides the entry action;
summaries, charts and History (including deletion) remain unchanged.
When a title is shown, its header spacing is preserved even with both actions
hidden. With `title: ""` and both actions hidden, the empty header is omitted.

Omit either filter to include all matching values. The editor accepts a manually
entered historical vehicle ID even if that vehicle is no longer configured.
Filters apply to summary, trend, chart and History. They are display settings,
not authorization boundaries, and do not restrict choices in Add.
Advanced field mappings and per-vehicle unit/price overrides survive visual edits.

### Existing schemas and field mappings

Map canonical names on the left to your actual backend field keys on the right.
Omitted mappings use the canonical key. The optional `vehicle_name` field may be
absent from your schema. Mapping two canonical fields to the same backend key is
not supported; field types and required-field defaults are checked before saving.

```yaml
type: custom:tankrupt-cr-card
record_type: my_purchases
fields:
  vehicle_id: car_id
  fuel_type: energy_type
  quantity: delivered
  unit_price: effective_price
  total_cost: paid
  vehicle_name: car_name
```

Mapping cannot turn legacy gallon quantities or per-100 prices into canonical
records. Migrate noncanonical historical data outside the card before using it.

## Entry, precision and units

- **Quantity + total** (default): enter quantity and the amount actually paid.
  That total is authoritative; the stored unit price is the effective price
  derived from the actual total and canonical quantity.
- **Quantity + price**: enter quantity and quoted price for the configured unit
  and basis. The stored unit price preserves that quote after canonical conversion.
  The card derives and rounds the total to the currency's minor-unit precision;
  it does not recompute the stored quote from the rounded total.
- Quantity must be finite and greater than zero. Price and total must be finite
  and nonnegative. Free fuel/charging is valid. Blank input is not zero.
- A price-plus-total mode without quantity is not supported.
- Choose a transaction date/time for a backdated purchase. HA's configured time
  zone is authoritative, not the browser's. Invalid or ambiguous local times
  require correction/explicit disambiguation rather than silent reinterpretation.
- Failed saves retain the inputs. An uncertain network result is not automatically
  retried because the backend has no idempotency key: refresh and check recent
  records before retrying.

All stored liquid quantities are litres: **1 US gallon = 3.785411784 L**;
**1 imperial gallon = 4.54609 L**. These gallon definitions are not interchangeable.
Electricity is stored in kWh. Stored unit prices are always per **one canonical
unit**, regardless of the entry/display basis.

Changing entry/display units is safe because history is canonical. Original entry
units and price basis are not retained and cannot later be reconstructed as
historical metadata. Effective price includes whatever is included in the entered
total; this is not separate advertised-tariff or charging-fee accounting.

Decimal arithmetic is used for conversions/derivation, but backend number fields
are finite floating-point values, not an exact-decimal accounting ledger.

### One currency per shared record type

All cards and external writers must agree on **one currency**. By default Tankrupt
uses Home Assistant's configured currency; `currency: GBP`, for example, overrides
the label and formatting. HA locale controls localized formatting.

**Changing HA's currency or a card override does not convert existing amounts.**
It re-labels their numeric values. No exchange rates or record currency metadata
exist, so Tankrupt cannot detect mixed-currency history. Convert/migrate your data
outside the card before changing the agreed monetary convention.

### Add records from an automation

Use the integration service with nested `fields`. This example stores 40 litres
of petrol at an effective price of 1.50 per litre, total 60, in the shared currency.
The optional timestamp is top-level and offset-aware; omit it to use the service's
current time. Use your actual field names when mappings differ.

```yaml
action: custom_records.add_record
data:
  record_type: fuel_purchases
  timestamp: '2026-09-01T18:30:00+01:00'
  fields:
    vehicle_id: family_hybrid
    vehicle_name: Family hybrid
    fuel_type: petrol
    quantity: 40
    unit_price: 1.5
    total_cost: 60
```

For electricity, use `fuel_type: electricity`, quantity in kWh and price per one
kWh. Without a configured vehicle, use `vehicle_id: unassigned` and omit the
optional name. Do not send currency, units or price basis in `fields`.

## Billing periods, statistics and charts

Billing periods start on `billing_start_day` at local midnight in **HA's time zone**.
Day 31 becomes February's last day, then March 31; it does not drift permanently
to day 28. Each month is clamped independently and respects daylight-saving time.

The summary covers the current billing-period start through the captured refresh
time, excluding future purchases. The trend compares that **partial current
period against the entire previous billing period**, not an equal elapsed portion.
Changing the chart range does not change the summary period.

No previous records is different from a prior total of zero. With the default
percentage format, an increase from zero shows an unavailable marker with an
accessible explanation, never infinity or an automatic switch to currency.
Use `trend_display: amount` for a currency difference instead. Both zero means
no change. Request failures are errors, never fabricated zero spending.
The compact trend sits immediately beside the main total, aligned at the visible top of its text, and shows only its arrow
and one magnitude. Increases use HA's error color, decreases its success color;
flat/unavailable values are neutral and the total retains normal text color.
The trend is a static indicator; clicking it does not expand additional details.

- **Spending:** sum of transaction costs.
- **Quantity:** sum of canonical delivered quantity, converted for display.
- **Price:** quantity-weighted effective price, `sum(total_cost) / sum(quantity)`,
  converted to the display unit/basis—not an average of per-record prices.
  This always uses actual stored totals, even for quantity-plus-price entries.
  Currency rounding can therefore make the chart's effective price differ slightly
  from an originally entered quote. This is normal rounding, not a separate fee
  or tariff adjustment; there are no separate fee/tariff fields.
- Empty buckets remain **blank** for every metric; genuine zero-cost purchases
  have discoverable zero marks, not missing data.
- The default chart keeps **12 chronological monthly slots**, newest on the right.
  A short history does not stretch available bars across missing months.
- Axes scale around observed values with padding and rounded tick boundaries, rather
  than always starting at zero. Tick granularity adapts to the range: larger amounts
  use whole numbers, while small prices retain necessary decimals. Labels and marks
  use the same scale; exact values remain in tooltips. Real observed zeros include
  zero. Equal-value and single-value series retain a nonzero axis span.
- Petrol, diesel and electricity retain distinct price/quantity series so unlike
  dimensions are not combined. All-fuel spending can share one currency axis.
- One period uses local days; three periods use local weeks; six/twelve use billing
  months. Edge buckets are clipped. Charts use explicit HA-local bounds rather
  than the backend's UTC calendar bucketing.
- Configured vehicle and fuel filters apply consistently to summary, comparison,
  chart and History.
- Chart tooltips show only the date range and the value on separate lines;
  they appear beside the hovered, focused or tapped point, choosing a side with
  enough room and wrapping on the roomier side in narrow charts.
  Point accessibility labels retain the fuel and transaction count.
- X-axis labels adapt to the range and available width, including intermediate
  dates where they fit without collisions.

Totals and charts come from **server aggregates over all matching retained records**,
not sums of the displayed recent list. **History** opens a Home Assistant-managed
modal and initially loads `recent_limit` records. **Load more** appends another
batch in newest-first order. The 500-record API limit is per page, not a limit on
how much retained history you can browse. **Load more** disappears when there are
no older records available for the current query. The modal omits loaded-count
labels and routine explanatory text to keep the transaction list compact.
No raw history is fetched for charts.

History requires the current Custom Records `list_records` pagination contract.
Tankrupt sends `paginate: true` and `order: desc` directly, without capability
discovery or an older-backend fallback. API, authentication, connection and
malformed-page errors are shown explicitly; a failed request is not treated as
empty history. Each page requests the configured batch size, from 1 to 500.

The API supports `order: asc` or `order: desc` independently of page size and
defaults to descending order. Timestamp and record ID share the selected ordering.
Tankrupt always requests descending order. Cursors are bound to their query's
direction, filters and time range; changing direction requires a fresh traversal.
WebSocket reads default to and cap at 500 records per request, in either direction
and with or without pagination. Omitted/false `paginate` retains the `{records}`
response; paginated responses also include `has_more` and `next_cursor`.

The open list stays unchanged when new records arrive; reopening it loads fresh
history. Subsequent pages use the same filters and captured end time and are
deduplicated by exact record ID. This is a live traversal, not a frozen database
snapshot: backdated inserts below the cursor may appear on later pages, while
deleted or pruned records may disappear. Reaching the end of a traversal does not
guarantee an immutable, complete-history snapshot.

There is no routine history Refresh button. A failed page preserves the loaded
records and can be retried. An expired cursor offers **Restart history**; cursors
can expire after 30 idle minutes, integration restart, or cache eviction. Summary,
chart and schema updates continue independently while History is open.

Confirm deletions within the same modal; successful deletions remove that record
locally without resetting the loaded pages. Uncertain writes are never retried automatically.
Escape/Close returns focus to the invoking action. `show_recent_records: false`
hides History; it does not change aggregates or Add.

History requires HA's native `ha-dialog` and `show-dialog` manager. If native
dialogs are not yet loaded, open a built-in HA dialog once and retry History,
or reload the dashboard. An unavailable native surface is reported rather than
silently replaced by an inline list.

Actions use HA text/icon buttons when available, with one themed native fallback
for the standalone demo or older HA components. Keyboard focus, disabled/pending
states, form submission and pointer styling are shared across these controls.

Retention/maximum-record policies can delete older data. Aggregates cannot restore
pruned history; warnings identify configured pruning, and “complete” means complete
for the data still retained by Custom Records.

## Corrections and limitations

Confirm deletion of the identified transaction, then add a replacement to correct
it. There is **no in-place update API**, undo guarantee, schema import or automatic
migration. A failed delete remains visible and should not be treated as success.
Relevant integration update events refresh summaries, charts and schema checks
across cards, but do not replace an already open history list.

There is no currency conversion, mixed-currency support, odometer/MPG/range or
consumption calculation, separate charging-fee/tariff model, charging-provider
integration, or vehicle registry backend. English labels use HA-localized numbers,
currency and dates; full translated UI coverage is not claimed.

## Development and demo

Use Node.js 22 or newer (CI uses Node 22).

```sh
npm ci
npm run lint
npm run type-check
npm test
npm run test:coverage
npm run build
npm run watch
```

`watch` serves the local synthetic demo and bundles at `http://127.0.0.1:5000`.
The left pane has keyboard-accessible **YAML / UI** tabs; UI reuses the real
Tankrupt visual editor. A bounded, visibly outlined card preview is on the right,
and the panes stack on narrow screens. Demo controls outside the card select
light/dark theme, 360/480/600px card width, vehicle presets and backend fixtures.
The borderless preview container adds 16px of spacing around the selected card width; on narrower
screens the preview fits the available space.
Loading a preset explicitly replaces the YAML; resetting fixtures does not.

The locally bundled `yaml` library updates YAML document nodes to preserve
comments, advanced mappings and unit overrides during UI edits. Invalid YAML or
invalid configuration remains intact with an error and a **last valid
configuration** preview label; UI editing is blocked until the draft is corrected.
No CDN or external runtime code is needed.

The demo does not connect to HA or write real records. Its exact-protocol
650-purchase fixture supports paged traversal beyond 500 while aggregates remain
uncapped. Other fixtures cover short history, real zeros, equal values, empty
history, expired cursors and API failures. The demo mirrors ascending/descending
listing, direction-bound cursors and the finite WebSocket limits. Add/delete/events operate on in-memory records; reload
or reset to discard synthetic changes. Demo-only HA form/dialog adapters use
native browser controls and a modal `<dialog>` to exercise the same History
component. They are **not live-HA verification**. A real HA smoke test is still
needed for dashboard resources, editor/native modal compatibility, manual schema
creation, focus/back behavior, live updates and themes.

TypeScript is strict, targets ES2021 and uses Lit's legacy decorators. Rollup and
esbuild produce the single production ES-module bundle at `dist/tankrupt-cr-card.js`; the CommonJS
plugin handles dependencies such as the Temporal polyfill's JSBI browser build.
The separate `dist/demo.js` contains the demo and local YAML library; **do not
install it in HA**. Neither YAML nor the demo's imitation HA elements is included
in the production card. Type checking runs separately. Vitest defaults to happy-dom; tests can opt into the installed
jsdom environment with `// @vitest-environment jsdom`.

CI runs lint, type-check, coverage and production build. Publishing a GitHub release
triggers the release workflow: `v1.2.3` and `1.2.3` normalize to the same version,
package/lock metadata and `src/const.ts` are updated only in the CI checkout, and
the built JavaScript is attached to the release before HACS validation. No generated
bundle or version-bump commit is pushed. Source development version is `0.0.0`.

## Credits and licenses

MIT licensed; see [LICENSE](LICENSE).
Project organization and tooling follow
[Weight Tracker CR Card](https://github.com/maxwroc/weight-tracker-cr-card)
(MIT, Copyright © 2026 Max Chodorowski). Its copyright/permission notice is retained
in this repository's unchanged MIT license.

Runtime dependencies: Lit 3 (BSD-3-Clause), custom-card-helpers 2 (MIT),
`@js-temporal/polyfill` (ISC) and `decimal.js-light` (MIT). The Temporal polyfill
provides DST-aware HA-zone calendar arithmetic; decimal.js-light avoids binary
rounding during financial derivation and unit conversion. These are deliberate
correctness additions to the reference tooling. Dependency license notices remain
in their packages and applicable bundled license comments.
The standalone demo additionally uses `yaml` (ISC), a development-only dependency.
