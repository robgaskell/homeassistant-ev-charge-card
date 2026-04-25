# EV Charge Planner Card

A [Home Assistant](https://www.home-assistant.io/) Lovelace card that plans your EV charging schedule using [Octopus Agile](https://octopus.energy/agile/) half-hourly rates and [Greener Nights](https://octopus.energy/greener-nights/) carbon intensity forecasts.

It reads live electricity prices from the [Octopus Energy integration](https://github.com/BottlecapDave/HomeAssistant-OctopusEnergy), calculates exactly how many 30-minute slots your car needs, and picks the cheapest window — either as a single consecutive block or split across multiple cheaper periods. It also shows Octopus's Greener Nights carbon intensity forecast so you can choose a cleaner night to charge if price isn't the only priority.

The card reads all data directly from Home Assistant sensor entities — battery state, target SoC, plug state, and electricity rates. All scheduling runs in the browser with no server-side processing and no external API calls.

---

## Requirements

- [Home Assistant](https://www.home-assistant.io/) with [HACS](https://hacs.xyz/) installed
- An [Octopus Agile](https://octopus.energy/agile/) electricity tariff
- The [Octopus Energy integration](https://github.com/BottlecapDave/HomeAssistant-OctopusEnergy) installed and configured (provides the rate entities)
- Sensor entities exposing the vehicle's current SoC, target SoC, and charger plug state

---

## Installation

### HACS (recommended)

1. Open HACS in Home Assistant
2. Go to **Frontend**
3. Click the three-dot menu in the top right and select **Custom repositories**
4. Add `https://github.com/robgaskell/homeassistant-ev-charge-card` with category **Lovelace**
5. Find **EV Charge Planner Card** in the list and click **Download**
6. Reload your browser

### Manual

1. Download `ev-charge-card.js` from this repository
2. Copy it to your `config/www/` directory
3. In Home Assistant go to **Settings → Dashboards** and click the three-dot menu → **Resources**
4. Add `/local/ev-charge-card.js` as a **JavaScript module**
5. Reload your browser

---

## Configuration

Add to your Lovelace dashboard:

```yaml
type: custom:ev-charge-card
entity_current_day_rates: event.octopus_energy_electricity_XXXXX_current_day_rates
entity_next_day_rates: event.octopus_energy_electricity_XXXXX_next_day_rates
entity_current_soc: sensor.my_ev_battery_soc
entity_target_soc: sensor.my_ev_target_soc
entity_plug_state: sensor.my_ev_plug_state
entity_greenness_forecast: sensor.octopus_energy_a_xxxx_greenness_forecast_current_index
```

Replace the `XXXXX` placeholders with your meter's MPAN and serial number. You can find the exact entity names in **Settings → Devices & Services → Octopus Energy → Entities**.

### All options

| Option | Default | Description |
|--------|---------|-------------|
| `entity_current_day_rates` | _(required)_ | Octopus Energy event entity for today's half-hourly rates |
| `entity_next_day_rates` | _(optional)_ | Octopus Energy event entity for tomorrow's rates (available after ~4pm) |
| `entity_previous_day_rates` | _(optional)_ | Octopus Energy event entity for yesterday's rates — needed for accurate live cost on midnight-crossing sessions |
| `entity_current_soc` | _(optional)_ | Current battery SoC sensor entity ID |
| `entity_target_soc` | _(optional)_ | Target SoC sensor entity ID |
| `entity_plug_state` | _(optional)_ | Plug state sensor entity ID |
| `plug_state_value` | `CHARGING_CABLE_LOCKED` | State value that means the car is plugged in |
| `entity_greenness_forecast` | _(optional)_ | Greenness forecast sensor entity ID |
| `charger_integration` | _(optional)_ | Charger brand integration — enables the CHARGER SCHEDULE section. Supported value: `hypervolt` |
| `charger_kw` | `3.7` | Charger output in kW |
| `split_threshold` | `1.0` | Minimum p/kWh saving to justify non-consecutive slots |
| `min_per_pct` | `13.5` | Minutes of charging time per 1% SoC increase |

### Finding the rate entity names

In the Octopus Energy integration, the rate entities are named:

```
event.octopus_energy_electricity_{serial}_{mpan}_current_day_rates
event.octopus_energy_electricity_{serial}_{mpan}_next_day_rates
event.octopus_energy_electricity_{serial}_{mpan}_previous_day_rates
```

To find yours: go to **Settings → Devices & Services → Octopus Energy → Entities** and search for `current_day_rates`.

### Enable the greenness forecast sensor

The greenness forecast sensor is disabled by default in the Octopus Energy integration. To enable it:

1. Go to **Settings → Devices & Services → Octopus Energy**
2. Click your account entry, then **Entities**
3. Find **Greenness Forecast Current Index** and enable it

### Plug state values

The card compares `entity_plug_state` against `plug_state_value` (default `CHARGING_CABLE_LOCKED`). If your EV integration uses a different state value, set `plug_state_value` to match. The schedule is always calculated regardless of plug state — the plug indicator is informational only.

### Hypervolt charger integration

If you have a Hypervolt charger with the [Hypervolt Home Assistant integration](https://github.com/MeatBall1337/home-assistant-hypervolt-charger) installed, set `charger_integration: hypervolt` to unlock the **CHARGER SCHEDULE** section. This reads up to six configured charging sessions directly from Hypervolt's schedule entities and displays each one with:

- Scheduled days and time window
- Estimated charging cost using the published Agile rates for that session window
- A **⚡ Charging now** live row when a session is active, showing kWh used, cost so far, and estimated total

For sessions that cross midnight (e.g. 22:00–02:00), also configure `entity_previous_day_rates` so the pre-midnight rate slots are available for an accurate live cost estimate.

---

## How it works

### Scheduling

The card calculates how many 30-minute slots are needed based on the percentage of charge to add and your configured charge rate. It then evaluates two strategies:

**Consecutive** — finds the cheapest unbroken block of N slots using a sliding window.

**Split** — picks the N cheapest individual slots regardless of position, sorted chronologically.

If the split strategy saves more than `split_threshold` p/kWh over consecutive, it uses split. Otherwise it uses the consecutive block to avoid the charger starting and stopping multiple times overnight.

Tomorrow's rates (via `entity_next_day_rates`) are automatically included once Octopus publishes them (usually around 4–5pm), extending the scheduling window through the following night.

### Greener Nights

If `entity_greenness_forecast` is configured, the card reads Octopus's carbon intensity forecast and shows an advisory message when a significantly greener night (20+ points higher score) is coming up in the next 7 days. On Agile, greener nights tend to coincide with lower prices due to higher renewable generation — the message reads:

> *Tomorrow is forecast greener (72/100) — charging may be cheaper then.*

The small green bar in the card header shows tonight's greenness score at a glance. No table is shown — the message only appears when there's a meaningfully better night coming.

---

## Troubleshooting

### Rate entity has no data

If the schedule section shows "No rate data", check that:

1. The Octopus Energy integration is connected and your electricity meter is configured
2. The entity name in your config matches exactly — check **Developer Tools → States** and search for `current_day_rates`
3. The entity has a `rates` attribute containing a list of slots (visible in Developer Tools → States → entity attributes)

### Schedule only covers part of the night

If rates are only available for part of the night, `entity_next_day_rates` may not yet have tomorrow's data. Octopus typically publishes next-day Agile rates between 4pm and 6pm. Once available, the card automatically extends the schedule window.
