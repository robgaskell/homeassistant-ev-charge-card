/**
 * EV Charge Planner Card
 * A Home Assistant Lovelace card that schedules EV charging using Octopus Agile rates.
 *
 * Requires the Octopus Energy integration (https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/)
 *
 * Config (in dashboard YAML):
 *   type: custom:ev-charge-card
 *   entity_current_day_rates: event.octopus_energy_electricity_XXXXX_current_day_rates       # required
 *   entity_next_day_rates: event.octopus_energy_electricity_XXXXX_next_day_rates             # optional, available after ~4pm
 *   entity_previous_day_rates: event.octopus_energy_electricity_XXXXX_previous_day_rates     # optional, needed for live cost accuracy on midnight-crossing sessions
 *   entity_current_soc: sensor.my_ev_battery_soc                                         # optional
 *   entity_target_soc: sensor.my_ev_target_soc                                           # optional
 *   entity_plug_state: sensor.my_ev_plug_state                                           # optional
 *   entity_greenness_forecast: sensor.octopus_energy_a_xxxxx_greenness_forecast_current_index  # optional
 *   charger_kw: 3.7                       # optional, default 3.7
 *   charger_integration: hypervolt        # optional, enables CHARGER SCHEDULE section
 *   split_threshold: 1.0                  # optional, default 1.0 p/kWh
 *   min_per_pct: 13.5                     # optional, default 13.5 min per 1%
 *   plug_state_value: CHARGING_CABLE_LOCKED  # optional, default CHARGING_CABLE_LOCKED
 */


const CARD_CSS = `
  :host { display: block; }
  .card-content {
    padding: 0 16px 16px;
    font-family: var(--ha-font-family-body, sans-serif);
    font-size: var(--ha-font-size-m, 14px);
    color: var(--primary-text-color);
  }
  hr { border: none; border-top: 1px solid var(--divider-color); margin: 12px 0; }
  .soc-line { font-weight: 500; margin-bottom: 2px; }
  .detail-line { color: var(--secondary-text-color); margin-bottom: 2px; }
  .plug-plugged { color: var(--success-color, #4CAF50); }
  .plug-unplugged { color: var(--warning-color, #FF9800); }
  .plug-unknown { color: var(--secondary-text-color); }
  .section-title {
    font-size: var(--ha-font-size-m, 14px); font-weight: 600; color: var(--secondary-text-color);
    letter-spacing: 0.06em; text-transform: uppercase; margin: 12px 0 6px;
  }
  .run {
    display: grid; grid-template-columns: 72px 1fr auto auto;
    gap: 8px; align-items: center; margin-bottom: 4px;
  }
  .run-date { color: var(--secondary-text-color); }
  .run-price { color: var(--secondary-text-color); text-align: right; }
  .run-cost { font-weight: 500; min-width: 36px; text-align: right; }
  .skipped { color: var(--warning-color, #FF9800); margin: 2px 0; }
  .total-cost { font-weight: 500; margin-top: 8px; }
  .saving { color: var(--secondary-text-color); margin-top: 2px; }
  .status-ok { color: var(--success-color, #4CAF50); font-style: italic; padding: 4px 0; }
  .status-warn { color: var(--warning-color, #FF9800); padding: 4px 0; }
  .status-muted { color: var(--secondary-text-color); padding: 4px 0; }
  .gn-advice { color: var(--secondary-text-color); font-style: italic; padding: 4px 0; }
  .charger-session { margin-bottom: 8px; }
  .charger-session-header { color: var(--secondary-text-color); font-size: 0.9em; margin: 4px 0 6px; }
  .charger-session-row {
    display: grid; grid-template-columns: 72px 1fr auto auto;
    gap: 8px; align-items: center; margin-bottom: 4px;
  }
  .charger-live { color: var(--primary-color); font-style: italic; margin-bottom: 6px; }
`;

const CHARGER_INTEGRATIONS = {
  hypervolt: {
    daysEntity:    (n) => `text.hypervolt_schedule_session_${n}_days_of_week`,
    startEntity:   (n) => `time.hypervolt_schedule_session_${n}_start_time`,
    endEntity:     (n) => `time.hypervolt_schedule_session_${n}_end_time`,
    // session_energy resets per session; _total_increasing is a lifetime odometer and must not be used here.
    energySensors: [
      'sensor.hypervolt_session_energy',
    ],
  },
};

class EvChargeCard extends HTMLElement {
  constructor() {
    super();
    this._config        = null;
    this._hass          = null;
    this._lastStateKey  = null;
    this.attachShadow({ mode: 'open' });
  }

  // ── HA lifecycle ─────────────────────────────────────────────────────────

  setConfig(config) {
    if (!config.entity_current_day_rates)
      throw new Error('ev-charge-card: entity_current_day_rates is required');
    this._config = {
      entity_current_day_rates:  config.entity_current_day_rates,
      entity_next_day_rates:     config.entity_next_day_rates     || null,
      charger_kw:                Number(config.charger_kw)        || 3.7,
      split_threshold:           Number(config.split_threshold)   || 1.0,
      min_per_pct:               Number(config.min_per_pct)       || 13.5,
      entity_current_soc:        config.entity_current_soc        || null,
      entity_target_soc:         config.entity_target_soc         || null,
      entity_plug_state:         config.entity_plug_state         || null,
      plug_state_value:          config.plug_state_value          || 'CHARGING_CABLE_LOCKED',
      entity_greenness_forecast:  config.entity_greenness_forecast  || null,
      entity_previous_day_rates:  config.entity_previous_day_rates  || null,
      charger_integration:        config.charger_integration        || null,
    };
  }

  get hass() { return this._hass; }

  set hass(hass) {
    this._hass = hass;
    const key = this._stateKey(hass);
    if (key !== this._lastStateKey) {
      this._lastStateKey = key;
      this._render();
    }
  }

  getCardSize() { return 5; }

  static getStubConfig() {
    return {
      entity_current_day_rates:  'event.octopus_energy_electricity_XXXX_current_day_rates',
      entity_next_day_rates:     'event.octopus_energy_electricity_XXXX_next_day_rates',
      entity_current_soc:        'sensor.my_ev_battery_soc',
      entity_target_soc:         'sensor.my_ev_target_soc',
      entity_plug_state:         'sensor.my_ev_plug_state',
      plug_state_value:          'CHARGING_CABLE_LOCKED',
      entity_greenness_forecast: 'sensor.octopus_energy_a_XXXX_greenness_forecast_current_index',
      charger_kw:                3.7,
      split_threshold:           1.0,
      min_per_pct:               13.5,
    };
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  _readRates() {
    const { entity_current_day_rates, entity_next_day_rates, entity_previous_day_rates } = this._config;

    const normalise = (raw) =>
      (raw ?? [])
        .filter(r => r && r.start && r.end)
        .map(r => ({
          validFrom: new Date(r.start),
          validTo:   new Date(r.end),
          price:     Number(r.value_inc_vat) * 100,
        }));

    const previousRates = entity_previous_day_rates
      ? normalise(this._hass.states[entity_previous_day_rates]?.attributes?.rates)
      : [];

    const todayRates = normalise(
      this._hass.states[entity_current_day_rates]?.attributes?.rates
    );

    const tomorrowRates = entity_next_day_rates
      ? normalise(this._hass.states[entity_next_day_rates]?.attributes?.rates)
      : [];

    const combined = [...previousRates, ...todayRates, ...tomorrowRates]
      .sort((a, b) => a.validFrom - b.validFrom);

    // Deduplicate by validFrom timestamp in case entities overlap
    const seen = new Set();
    return combined.filter(r => {
      const t = r.validFrom.getTime();
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  }

  // ── Scheduling algorithm ──────────────────────────────────────────────────

  _calculateSchedule(slotsNeeded, rates) {
    const { charger_kw, split_threshold } = this._config;
    const energyPerSlot = charger_kw * 0.5;
    const now    = new Date();
    const future = rates.filter(slot => slot.validTo > now);
    if (future.length < slotsNeeded) return null;

    // Sliding window: find the cheapest contiguous block of slotsNeeded slots.
    let bestConsec = { avg: Infinity, start: 0 };
    for (let i = 0; i <= future.length - slotsNeeded; i++) {
      const avg = future.slice(i, i + slotsNeeded).reduce((sum, slot) => sum + slot.price, 0) / slotsNeeded;
      if (avg < bestConsec.avg) bestConsec = { avg, start: i };
    }
    const consecBlock = future.slice(bestConsec.start, bestConsec.start + slotsNeeded);

    // Alternative: pick the N globally cheapest slots (non-contiguous), then re-sort chronologically.
    const cheapestN = [...future].sort((a, b) => a.price - b.price).slice(0, slotsNeeded);
    const splitAvg  = cheapestN.reduce((sum, slot) => sum + slot.price, 0) / slotsNeeded;

    // Use the split (non-contiguous) strategy only if it saves more than the threshold over consecutive.
    const useSplit = (bestConsec.avg - splitAvg) > split_threshold;
    const selected = useSplit
      ? [...cheapestN].sort((a, b) => a.validFrom - b.validFrom)
      : consecBlock;

    // Collect the slots between the first and last selected that were skipped — shown as warnings.
    let skipped = [];
    if (useSplit && selected.length > 1) {
      const rangeStart    = selected[0].validFrom;
      const rangeEnd      = selected[selected.length - 1].validTo;
      const selectedTimes = new Set(selected.map(slot => slot.validFrom.getTime()));
      skipped = future.filter(
        slot => slot.validFrom >= rangeStart && slot.validTo <= rangeEnd && !selectedTimes.has(slot.validFrom.getTime()),
      );
    }

    return {
      runs:        _groupIntoRuns(selected),
      skippedRuns: _groupIntoRuns(skipped),
      useSplit,
      totalCost:  selected.reduce((sum, slot) => sum + slot.price * energyPerSlot, 0) / 100,
      consecCost: consecBlock.reduce((sum, slot) => sum + slot.price * energyPerSlot, 0) / 100,
    };
  }

  // ── DOM builders ─────────────────────────────────────────────────────────

  _render() {
    if (!this._config || !this._hass) return;

    const { entity_current_day_rates, entity_current_soc, entity_target_soc,
            entity_plug_state, plug_state_value, entity_greenness_forecast, charger_kw, min_per_pct } = this._config;

    const rates = this._readRates();

    const currentSoc   = entity_current_soc
      ? parseFloat(this._hass.states[entity_current_soc]?.state ?? 0)
      : 0;
    const targetSoc    = entity_target_soc
      ? parseFloat(this._hass.states[entity_target_soc]?.state ?? 80)
      : 80;
    const plugStateVal = entity_plug_state
      ? (this._hass.states[entity_plug_state]?.state ?? 'unknown')
      : 'unknown';
    const isPlugged    = plugStateVal === plug_state_value;

    const pctToAdd     = Math.max(0, targetSoc - currentSoc);
    const timeNeeded   = pctToAdd * min_per_pct;
    const slotsNeeded  = Math.ceil(timeNeeded / 30);
    const energyNeeded = slotsNeeded * charger_kw * 0.5;

    // Bundle all derived charge plan values — passed as one object to avoid parameter sprawl
    const plan = { currentSoc, targetSoc, pctToAdd, timeNeeded, slotsNeeded, energyNeeded, isPlugged, plugStateVal };

    const now = new Date();
    const tonightStr = now.toDateString();
    const rawForecast = entity_greenness_forecast
      ? (this._hass.states[entity_greenness_forecast]?.attributes?.forecast ?? [])
      : [];
    const forecast = rawForecast.filter(n => new Date(n.end) > now).slice(0, 7);
    const tonightEntry = forecast.find(n => new Date(n.start).toDateString() === tonightStr);
    const tonightScore = tonightEntry?.greenness_score ?? 0;

    this.shadowRoot.replaceChildren();

    const styleEl = document.createElement('style');
    styleEl.textContent = CARD_CSS;
    this.shadowRoot.appendChild(styleEl);

    const card = document.createElement('ha-card');
    card.setAttribute('header', 'EV Charge Plan');

    const content = document.createElement('div');
    content.className = 'card-content';
    content.appendChild(this._buildSummary(plan));
    content.appendChild(_hr());
    content.appendChild(this._buildScheduleSection(plan, rates));
    const advice = this._buildGreenAdvice(forecast, tonightScore);
    if (advice) {
      content.appendChild(_hr());
      content.appendChild(advice);
    }
    const chargerSessions = _readChargerSessions(this._hass, rates, this._config);
    if (chargerSessions.length > 0) {
      content.appendChild(_hr());
      content.appendChild(this._buildChargerScheduleSection(chargerSessions));
    }
    card.appendChild(content);
    this.shadowRoot.appendChild(card);
  }

  _buildSummary({ currentSoc, targetSoc, pctToAdd, timeNeeded, slotsNeeded, energyNeeded, isPlugged, plugStateVal }) {
    const { charger_kw } = this._config;
    const container = _el('div', '');

    const socLine = _el('div', 'soc-line');
    socLine.textContent = `${currentSoc}% → ${targetSoc}%   ${pctToAdd.toFixed(0)}% to add`;
    container.appendChild(socLine);

    if (pctToAdd > 0) {
      const detail = _el('div', 'detail-line');
      detail.textContent = `~${_fmtDuration(timeNeeded)} · ${slotsNeeded} slots · ~${energyNeeded.toFixed(1)} kWh @ ${charger_kw}kW`;
      container.appendChild(detail);
    }

    const plugClass = isPlugged ? 'plug-plugged' : (plugStateVal === 'unknown' ? 'plug-unknown' : 'plug-unplugged');
    const plugText  = isPlugged ? 'plugged in'   : (plugStateVal === 'unknown' ? 'unknown'      : 'not plugged in');
    const plug = _el('div', `plug-line ${plugClass}`);
    plug.textContent = `Charger: ${plugText}`;
    container.appendChild(plug);

    return container;
  }

  _buildScheduleSection({ pctToAdd, slotsNeeded }, rates) {
    const container = _el('div', '');

    if (pctToAdd <= 0) {
      const msg = _el('div', 'status-ok');
      msg.textContent = 'Battery is at or above target — no charging needed.';
      container.appendChild(msg);
      return container;
    }

    if (!rates || rates.length === 0) {
      const msg = _el('div', 'status-warn');
      msg.textContent = 'No rate data — check entity_current_day_rates has a rates attribute.';
      container.appendChild(msg);
      return container;
    }

    const schedule = this._calculateSchedule(slotsNeeded, rates);
    if (!schedule) {
      const msg = _el('div', 'status-warn');
      msg.textContent = 'Not enough rate data available to schedule charging.';
      container.appendChild(msg);
      return container;
    }

    const { runs, skippedRuns, useSplit, totalCost, consecCost } = schedule;

    const heading = _el('div', 'section-title');
    heading.textContent = 'RECOMMENDED WINDOWS';
    container.appendChild(heading);

    let prevDateLabel = '';
    runs.forEach(run => {
      container.appendChild(this._buildRunRow(run, prevDateLabel));
      prevDateLabel = _fmtSlotDate(run[0].validFrom);
    });

    skippedRuns.forEach(run => {
      const row = _el('div', 'skipped');
      row.textContent = `⚠ Skipped ${_fmtTime(run[0].validFrom)}–${_fmtTime(run[run.length - 1].validTo)} @ ${_avgPrice(run).toFixed(1)}p`;
      container.appendChild(row);
    });

    const costEl = _el('div', 'total-cost');
    costEl.textContent = `Estimated cost: £${totalCost.toFixed(2)}`;
    container.appendChild(costEl);

    const saving = consecCost - totalCost;
    if (useSplit && saving > 0.005) {
      const savEl = _el('div', 'saving');
      savEl.textContent = `vs £${consecCost.toFixed(2)} consecutive · saving £${saving.toFixed(2)}`;
      container.appendChild(savEl);
    }

    return container;
  }

  _buildRunRow(run, prevDateLabel) {
    const { charger_kw } = this._config;
    const runStart  = run[0].validFrom;
    const runEnd    = run[run.length - 1].validTo;
    const runCost   = run.reduce((sum, slot) => sum + slot.price * charger_kw * 0.5, 0) / 100;
    const dateLabel = _fmtSlotDate(runStart);

    const row = _el('div', 'run');

    const dateEl = _el('span', 'run-date');
    dateEl.textContent = dateLabel !== prevDateLabel ? dateLabel : '';
    row.appendChild(dateEl);

    const timeEl = _el('span', 'run-time');
    timeEl.textContent = `${_fmtTime(runStart)}–${_fmtTime(runEnd)}`;
    row.appendChild(timeEl);

    const priceEl = _el('span', 'run-price');
    priceEl.textContent = `${_avgPrice(run).toFixed(1)}p avg`;
    row.appendChild(priceEl);

    const costEl = _el('span', 'run-cost');
    costEl.textContent = `£${runCost.toFixed(2)}`;
    row.appendChild(costEl);

    return row;
  }

  _buildGreenAdvice(forecast, tonightScore) {
    if (!forecast.length) return null;

    const el = _el('div', 'gn-advice');

    if (tonightScore >= 60) {
      el.textContent = 'Tonight is forecast very green — overnight rates could be lower than the current window. Consider waiting to charge tonight.';
      return el;
    }

    if (tonightScore < 40) {
      const betterNight = forecast.slice(1).find(n => n.greenness_score >= 60);
      let msg = "Tonight's greenness forecast is low, so waiting overnight may not save much.";
      if (betterNight) {
        msg += ` The best upcoming greenness forecast is ${_formatDate(new Date(betterNight.start))} (${betterNight.greenness_score}/100).`;
      }
      el.textContent = msg;
      return el;
    }

    // Medium (41–60): no advice
    return null;
  }

  _buildChargerScheduleSection(sessions) {
    const section = _el('div', '');

    const title = _el('div', 'section-title');
    title.textContent = 'CHARGER SCHEDULE';
    section.appendChild(title);

    sessions.forEach((sess, i) => {
      if (i > 0) section.appendChild(_hr());

      const sessDiv = _el('div', 'charger-session');

      const header = _el('div', 'charger-session-header');
      header.textContent = sess.header;
      sessDiv.appendChild(header);

      if (sess.liveRow) {
        const live = _el('div', 'charger-live');
        live.textContent = `⚡ Charging now · ${sess.liveRow.kwh.toFixed(1)} kWh · £${sess.liveRow.costSoFar.toFixed(2)} so far (est. £${sess.liveRow.estTotal.toFixed(2)} total)`;
        sessDiv.appendChild(live);
      }

      for (const row of sess.pricingRows) {
        if (row.unknown) {
          const unknownEl = _el('div', 'status-muted');
          unknownEl.textContent = row.timeRange
            ? `${row.label} · ${row.timeRange} · Price not published`
            : `Not scheduled today or tomorrow`;
          sessDiv.appendChild(unknownEl);
        } else {
          const priceRow = _el('div', 'charger-session-row');

          const dateEl = _el('span', 'run-date');
          dateEl.textContent = row.label;
          priceRow.appendChild(dateEl);

          const timeEl = _el('span', 'run-time');
          timeEl.textContent = row.timeRange;
          priceRow.appendChild(timeEl);

          const priceEl = _el('span', 'run-price');
          priceEl.textContent = `${row.avgPrice.toFixed(1)}p avg`;
          priceRow.appendChild(priceEl);

          const costEl = _el('span', 'run-cost');
          costEl.textContent = `£${row.totalCost.toFixed(2)}`;
          priceRow.appendChild(costEl);

          sessDiv.appendChild(priceRow);
        }
      }

      section.appendChild(sessDiv);
    });

    return section;
  }

  // ── State change detection ────────────────────────────────────────────────

  _stateKey(hass) {
    const { entity_current_day_rates, entity_next_day_rates,
            entity_current_soc, entity_target_soc,
            entity_plug_state, entity_greenness_forecast,
            charger_integration } = this._config;

    const { entity_previous_day_rates } = this._config;

    const parts = [
      hass.states[entity_current_day_rates]?.last_changed,
      entity_next_day_rates     ? hass.states[entity_next_day_rates]?.last_changed     : '',
      entity_previous_day_rates ? hass.states[entity_previous_day_rates]?.last_changed : '',
      entity_current_soc        ? hass.states[entity_current_soc]?.state               : '',
      entity_target_soc         ? hass.states[entity_target_soc]?.state                : '',
      entity_plug_state         ? hass.states[entity_plug_state]?.state                : '',
      entity_greenness_forecast ? hass.states[entity_greenness_forecast]?.last_changed : '',
    ];

    const defn = charger_integration && CHARGER_INTEGRATIONS[charger_integration];
    if (defn) {
      for (let n = 1; n <= 6; n++) {
        parts.push(hass.states[defn.daysEntity(n)]?.state  ?? '');
        parts.push(hass.states[defn.startEntity(n)]?.state ?? '');
        parts.push(hass.states[defn.endEntity(n)]?.state   ?? '');
      }
      for (const id of defn.energySensors)
        parts.push(hass.states[id]?.state ?? '');
    }

    return parts.join('|');
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function _el(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function _hr() {
  return document.createElement('hr');
}

function _avgPrice(slots) {
  return slots.reduce((sum, slot) => sum + slot.price, 0) / slots.length;
}

function _groupIntoRuns(slots) {
  if (!slots.length) return [];
  const runs = [];
  let current = [slots[0]];
  for (let i = 1; i < slots.length; i++) {
    // A gap > 60 s between consecutive slots means they are non-adjacent — start a new run.
    if (slots[i].validFrom - slots[i - 1].validTo > 60_000) {
      runs.push(current);
      current = [slots[i]];
    } else {
      current.push(slots[i]);
    }
  }
  runs.push(current);
  return runs;
}


function _fmtTime(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function _formatDate(date) {
  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString())    return 'Tonight';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function _fmtSlotDate(date) {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function _fmtDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins  = Math.round(minutes % 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function _fmtDayRange(days) {
  const ORDER = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'];
  const SHORT  = { MONDAY:'Mon', TUESDAY:'Tue', WEDNESDAY:'Wed', THURSDAY:'Thu', FRIDAY:'Fri', SATURDAY:'Sat', SUNDAY:'Sun' };
  const sorted      = [...days].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const dayIndices  = sorted.map(day => ORDER.indexOf(day));
  // Consecutive if every day index is exactly one after the previous (e.g. Mon–Fri).
  const isConsecutive = sorted.length > 1 && dayIndices.every((idx, i) => i === 0 || idx === dayIndices[i - 1] + 1);
  if (sorted.length === 1) return SHORT[sorted[0]] || sorted[0];
  if (isConsecutive) return `${SHORT[sorted[0]]}–${SHORT[sorted[sorted.length - 1]]}`;
  return sorted.map(day => SHORT[day] || day).join(', ');
}

function _readChargerSessions(hass, rates, config, now = new Date()) {
  const integration = config.charger_integration;
  if (!integration || !CHARGER_INTEGRATIONS[integration]) return [];

  const defn      = CHARGER_INTEGRATIONS[integration];
  const chargerKw = config.charger_kw || 3.7;

  const DAY_NAMES    = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const todayDate    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayDate  = new Date(todayDate.getTime() - 86_400_000);
  const tomorrowDate   = new Date(todayDate.getTime() + 86_400_000);
  const todayName    = DAY_NAMES[todayDate.getDay()];
  const yesterdayName  = DAY_NAMES[yesterdayDate.getDay()];
  const tomorrowName = DAY_NAMES[tomorrowDate.getDay()];

  const parseTime = timeStr => { const [hours, minutes] = timeStr.split(':').map(Number); return { hours, minutes }; };

  const sessionBounds = (base, start, end) => {
    const sessStart = new Date(base.getFullYear(), base.getMonth(), base.getDate(), start.hours, start.minutes);
    const sessEnd   = new Date(base.getFullYear(), base.getMonth(), base.getDate(), end.hours,   end.minutes);
    // Advance end by one day for midnight-crossing sessions where end ≤ start (e.g. 23:00–01:00).
    if (sessEnd.getTime() <= sessStart.getTime()) sessEnd.setDate(sessEnd.getDate() + 1);
    return [sessStart, sessEnd];
  };

  const buildSegments = (sessStart, sessEnd) => {
    const slots = rates.filter(r => r.validFrom < sessEnd && r.validTo > sessStart);

    if (!slots.length) return [{ unknown: true, start: sessStart, end: sessEnd, slots: [] }];

    // Walk a cursor through the session window, inserting unknown gaps where no rate slots exist.
    const segs   = [];
    let   cursor = sessStart.getTime();

    for (const slot of slots) {
      if (cursor < slot.validFrom.getTime())
        segs.push({ unknown: true, start: new Date(cursor), end: new Date(slot.validFrom.getTime()), slots: [] });

      // Clamp slot to the session window (it may extend beyond sessStart/sessEnd).
      const segStart = new Date(Math.max(slot.validFrom.getTime(), sessStart.getTime()));
      const segEnd   = new Date(Math.min(slot.validTo.getTime(),   sessEnd.getTime()));

      // Merge into the previous known segment if this slot is directly consecutive.
      const prev = segs[segs.length - 1];
      if (prev && !prev.unknown && prev.end.getTime() === segStart.getTime()) {
        prev.end = segEnd;
        prev.slots.push(slot);
      } else {
        segs.push({ unknown: false, start: segStart, end: segEnd, slots: [slot] });
      }
      cursor = segEnd.getTime();
    }

    // Trailing gap: rates don't reach the end of the session window.
    if (cursor < sessEnd.getTime())
      segs.push({ unknown: true, start: new Date(cursor), end: new Date(sessEnd.getTime()), slots: [] });

    return segs;
  };

  const sessions = [];

  for (let sessionNum = 1; sessionNum <= 6; sessionNum++) {
    const daysState  = hass.states[defn.daysEntity(sessionNum)]?.state;
    const startState = hass.states[defn.startEntity(sessionNum)]?.state;
    const endState   = hass.states[defn.endEntity(sessionNum)]?.state;

    const invalid = v => !v || v === 'unknown' || v === 'unavailable' || v.trim() === '';
    if (invalid(daysState) || invalid(startState) || invalid(endState)) continue;

    const days  = daysState.split(',').map(day => day.trim().toUpperCase());
    const start = parseTime(startState);
    const end   = parseTime(endState);

    const pricingRows = [];
    let todaySessStart = null, todaySessEnd = null, todaySegs = null;

    for (const [dayName, baseDate] of [[todayName, todayDate], [tomorrowName, tomorrowDate]]) {
      if (!days.includes(dayName)) continue;

      const [sessStart, sessEnd] = sessionBounds(baseDate, start, end);
      const segs = buildSegments(sessStart, sessEnd);
      if (dayName === todayName) { todaySessStart = sessStart; todaySessEnd = sessEnd; todaySegs = segs; }

      for (const seg of segs) {
        if (seg.unknown) {
          pricingRows.push({
            label:     _fmtSlotDate(seg.start),
            timeRange: `${_fmtTime(seg.start)}–${_fmtTime(seg.end)}`,
            unknown:   true,
          });
        } else {
          // Accumulate cost and a time-weighted price sum (duration-accurate average, not slot-count average).
          let totalCost = 0, weightedPriceSum = 0, totalDurationMs = 0;
          for (const slot of seg.slots) {
            const slotStart   = Math.max(slot.validFrom.getTime(), seg.start.getTime());
            const slotEnd     = Math.min(slot.validTo.getTime(),   seg.end.getTime());
            const durationMs  = slotEnd - slotStart;
            totalCost        += chargerKw * (durationMs / 3_600_000) * slot.price / 100;
            weightedPriceSum += slot.price * durationMs;
            totalDurationMs  += durationMs;
          }
          const avgPrice = totalDurationMs > 0 ? weightedPriceSum / totalDurationMs : 0;
          pricingRows.push({
            label:     _fmtSlotDate(seg.start),
            timeRange: `${_fmtTime(seg.start)}–${_fmtTime(seg.end)}`,
            avgPrice,
            totalCost,
            unknown:   false,
          });
        }
      }
    }

    if (!pricingRows.length)
      pricingRows.push({ timeRange: null, unknown: true });

    // Determine the active session window for live cost tracking.
    // For midnight-crossing sessions (end clock-time ≤ start clock-time, e.g. 22:00–02:00),
    // after midnight todaySessStart is 22:00 tonight (future), so the normal check fails.
    // Instead, re-derive bounds from yesterday's date: sessStart = 22:00 yesterday,
    // sessEnd = 02:00 today. entity_previous_day_rates (if configured) supplies the
    // pre-midnight rate slots; without it, that portion shows as unknown and is omitted.
    let liveSessStart = todaySessStart;
    let liveSessEnd   = todaySessEnd;
    let liveSegs      = todaySegs;

    const isMidnightCrossing = (end.hours * 60 + end.minutes) <= (start.hours * 60 + start.minutes);
    if (isMidnightCrossing && days.includes(yesterdayName)) {
      const [crossStart, crossEnd] = sessionBounds(yesterdayDate, start, end);
      if (now >= crossStart && now < crossEnd) {
        liveSessStart = crossStart;
        liveSessEnd   = crossEnd;
        liveSegs      = buildSegments(crossStart, crossEnd);
      }
    }

    let liveRow = null;
    if (liveSessStart && now >= liveSessStart && now < liveSessEnd) {
      const energyId    = defn.energySensors.find(id => hass.states[id]);
      const rawEnergy   = energyId ? (parseFloat(hass.states[energyId].state) || 0) : 0;
      const energyUnit  = energyId ? (hass.states[energyId].attributes?.unit_of_measurement ?? 'kWh') : 'kWh';
      const actualKwh   = energyUnit === 'Wh' ? rawEnergy / 1000 : rawEnergy;
      const elapsedHours = (now.getTime() - liveSessStart.getTime()) / 3_600_000;
      // Derive actual draw rate from energy used so far; fall back to rated power if no valid reading yet.
      const actualPower = (elapsedHours > 0 && actualKwh > 0) ? actualKwh / elapsedHours : chargerKw;

      let costSoFar = 0, estRemaining = 0;

      for (const seg of liveSegs) {
        if (seg.unknown) continue;
        for (const slot of seg.slots) {
          const slotStart = Math.max(slot.validFrom.getTime(), seg.start.getTime());
          const slotEnd   = Math.min(slot.validTo.getTime(),   seg.end.getTime());
          // Slot fully elapsed: cost at actual power; fully future: estimate at rated power;
          // straddles now: split the slot at the current timestamp.
          if (slotEnd <= now.getTime()) {
            costSoFar    += actualPower * ((slotEnd - slotStart) / 3_600_000) * slot.price / 100;
          } else if (slotStart >= now.getTime()) {
            estRemaining += chargerKw   * ((slotEnd - slotStart) / 3_600_000) * slot.price / 100;
          } else {
            costSoFar    += actualPower * ((now.getTime() - slotStart) / 3_600_000) * slot.price / 100;
            estRemaining += chargerKw   * ((slotEnd - now.getTime()) / 3_600_000) * slot.price / 100;
          }
        }
      }
      liveRow = { kwh: actualKwh, costSoFar, estTotal: costSoFar + estRemaining };
    }

    sessions.push({
      header: `${_fmtDayRange(days)} · ${String(start.hours).padStart(2,'0')}:${String(start.minutes).padStart(2,'0')} – ${String(end.hours).padStart(2,'0')}:${String(end.minutes).padStart(2,'0')}`,
      pricingRows,
      liveRow,
    });
  }

  return sessions;
}

if (!customElements.get('ev-charge-card')) {
  customElements.define('ev-charge-card', EvChargeCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type:        'ev-charge-card',
  name:        'EV Charge Planner',
  description: 'Schedules EV charging using Octopus Agile half-hourly rates.',
  preview:     true,
});
