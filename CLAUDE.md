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
- `setConfig()` / `get hass()` / `set hass()` — HA lifecycle entry points. `set hass` only re-renders when `_stateKey()` changes, avoiding unnecessary DOM rebuilds. The getter is required so HA can read the property back.
- `getCardSize()` / `static getStubConfig()` — HA card picker hooks; `getStubConfig` provides default config for the visual editor.
- `_readRates()` — reads `rates` attributes from up to three Octopus Energy event entities (previous day, current day, next day), normalises price from £/kWh → p/kWh (`* 100`), merges and deduplicates by `validFrom` timestamp. Previous day rates are included so midnight-crossing sessions can price their pre-midnight slots.
- `_calculateSchedule()` — core algorithm: evaluates a *consecutive* block (sliding window) vs a *split* strategy (N cheapest slots, sorted chronologically). Uses split only when it saves more than `split_threshold` p/kWh over consecutive. Returns `runs`, `skippedRuns`, costs, and `useSplit` flag.
- `_render()` and `_build*` methods — imperative DOM construction; `_render()` calls `shadowRoot.replaceChildren()` and rebuilds the full card on each state change.
- `_buildGreenAdvice()` — greenness advisory: shows a message only when `tonightScore >= 60` (very green, charge tonight) or `< 40` (low, may point to a better upcoming night). The 40–59 range is intentionally silent.
- `_buildChargerScheduleSection()` — renders the CHARGER SCHEDULE section from the array returned by `_readChargerSessions()`.

**`CHARGER_INTEGRATIONS`** — module-level lookup table mapping integration names (e.g. `hypervolt`) to entity name factory functions and energy sensor IDs. Extend this to support additional charger brands.

**Module-level pure helpers** (`_el`, `_hr`, `_avgPrice`, `_groupIntoRuns`, `_fmtTime`, `_formatDate`, `_fmtSlotDate`, `_fmtDuration`, `_fmtDayRange`, `_readChargerSessions`) — stateless utilities kept outside the class. `_readChargerSessions` reads Hypervolt schedule entities from `hass.states`, computes pricing rows per session using `buildSegments` (splits the session window into known/unknown rate segments), and detects the live row when a session is currently active — including the post-midnight window of midnight-crossing sessions.

## Key data model

Rate slots (after normalisation):
```js
{ validFrom: Date, validTo: Date, price: number }  // price in p/kWh
```

Runs (output of `_groupIntoRuns`): consecutive slots grouped into arrays; gaps > 60 s start a new run.

The `forecast` array from the greenness entity is filtered to future entries and capped at 7; `tonightScore` is matched by `toDateString()` equality.

## Coding style

### Comments

Add comments where the code is doing something non-obvious — complex calculations, algorithmic decisions, or subtle constraints. A single line is preferred. Do not comment what the code does (the names should make that clear); comment why it works the way it does or what invariant it relies on.

Good candidates for comments:
- Non-trivial maths or time calculations (e.g. time-weighted averages, slot cost accumulation split across a timestamp)
- Algorithmic strategies that aren't self-evident from the code (e.g. sliding window, cursor-based segment building)
- Edge-case handling that would surprise a reader (e.g. midnight-crossing sessions, deduplication, fallback behaviour)

Do not comment:
- Simple assignments, straightforward conditionals, or anything a fluent JavaScript reader would understand immediately
- What a function does (that belongs in the architecture notes above, not inline)

### Variable names

Use camelCase. Names should be descriptive enough that the reader knows what the variable contains without needing to trace back to its definition. Avoid single-letter names and unexpanded abbreviations outside of trivial loop indices (`i`, `j`).

- Good: `slotStart`, `elapsedHours`, `actualPower`, `costSoFar`, `dayIndices`
- Acceptable for loop indices: `i`, `j`
- Avoid: `sh`, `eh`, `ms`, `actualPow`, `elapsedH`, `idxs`, `s`, `r` as accumulator/element names in reduce/filter/map

In reduce callbacks use `sum` and a meaningful element name (e.g. `slot`, `rate`) rather than single-letter placeholders.

If a fully expanded name becomes unwieldy (more than ~25 characters), a widely understood abbreviation is fine — but err on the side of clarity.

## Registration

At the bottom of the file, `customElements.define` is guarded with `customElements.get()` to prevent double-registration errors if the script is loaded more than once (e.g. HACS hot-reload). `window.customCards` registers the card with the HA UI picker, including `preview: true` so the picker can show a live preview.