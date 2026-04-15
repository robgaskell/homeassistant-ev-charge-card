# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A single-file Home Assistant Lovelace custom card (`ev-charge-card.js`) that schedules EV charging using Octopus Agile half-hourly electricity rates and Octopus Greener Nights carbon intensity forecasts. All logic runs in the browser — no build system, no server, no external API calls.

Distributed via HACS (`hacs.json`) or manual copy to `config/www/`.

## Development workflow

There is no build step. Edit `ev-charge-card.js` directly, then test by loading it in Home Assistant:

1. Copy the file to `config/www/ev-charge-card.js` on your HA instance (or use the HACS workflow)
2. Hard-reload the browser to bypass the Lovelace resource cache
3. Observe card rendering and check the browser console for errors

There are no automated tests, no linter config, and no `package.json`.

## Architecture

The entire card lives in one file with two sections:

**`CARD_CSS`** — all styles as a single template literal injected into the Shadow DOM.

**`EvChargeCard` class** (extends `HTMLElement`, registered as `custom:ev-charge-card`):
- `setConfig()` / `set hass()` — HA lifecycle entry points. `set hass` only re-renders when `_stateKey()` changes, avoiding unnecessary DOM rebuilds.
- `_readRates()` — reads `rates` attributes from the two Octopus Energy event entities, normalises price from £/kWh → p/kWh (`* 100`), merges and deduplicates by `validFrom` timestamp.
- `_calculateSchedule()` — core algorithm: evaluates a *consecutive* block (sliding window) vs a *split* strategy (N cheapest slots, sorted chronologically). Uses split only when it saves more than `split_threshold` p/kWh over consecutive. Returns `runs`, `skippedRuns`, costs, and `useSplit` flag.
- `_render()` and `_build*` methods — imperative DOM construction; `_render()` calls `shadowRoot.replaceChildren()` and rebuilds the full card on each state change.
- `_buildGreenAdvice()` — greenness advisory: shows a message only when `tonightScore >= 60` (very green, charge tonight) or `< 40` (low, may point to a better upcoming night). The 40–59 range is intentionally silent.

**Module-level pure helpers** (`_el`, `_hr`, `_avgPrice`, `_groupIntoRuns`, `_greennessCategory`, `_fmtTime`, `_formatDate`, `_fmtSlotDate`, `_fmtDuration`) — stateless utilities kept outside the class.

## Key data model

Rate slots (after normalisation):
```js
{ validFrom: Date, validTo: Date, price: number }  // price in p/kWh
```

Runs (output of `_groupIntoRuns`): consecutive slots grouped into arrays; gaps > 60 s start a new run.

The `forecast` array from the greenness entity is filtered to future entries and capped at 7; `tonightScore` is matched by `toDateString()` equality.