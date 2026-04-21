/**
 * EV Charge Planner Card
 * A Home Assistant Lovelace card that schedules EV charging using Octopus Agile rates.
 *
 * Requires the Octopus Energy integration (https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/)
 *
 * Config (in dashboard YAML):
 *   type: custom:ev-charge-card
 *   entity_current_day_rates: event.octopus_energy_electricity_XXXXX_current_day_rates   # required
 *   entity_next_day_rates: event.octopus_energy_electricity_XXXXX_next_day_rates         # optional, available after ~4pm
 *   entity_current_soc: sensor.my_ev_battery_soc                                         # optional
 *   entity_target_soc: sensor.my_ev_target_soc                                           # optional
 *   entity_plug_state: sensor.my_ev_plug_state                                           # optional
 *   entity_greenness_forecast: sensor.octopus_energy_a_xxxxx_greenness_forecast_current_index  # optional
 *   charger_kw: 3.7                       # optional, default 3.7
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
    energySensors: [
      'sensor.hypervolt_session_energy',
      'sensor.hypervolt_session_energy_total_increasing',
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
      entity_greenness_forecast: config.entity_greenness_forecast || null,
      charger_integration:       config.charger_integration       || null,
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
    const { entity_current_day_rates, entity_next_day_rates } = this._config;

    const normalise = (raw) =>
      (raw ?? [])
        .filter(r => r && r.start && r.end)
        .map(r => ({
          validFrom: new Date(r.start),
          validTo:   new Date(r.end),
          price:     Number(r.value_inc_vat) * 100,
        }));

    const todayRates = normalise(
      this._hass.states[entity_current_day_rates]?.attributes?.rates
    );

    const tomorrowRates = entity_next_day_rates
      ? normalise(this._hass.states[entity_next_day_rates]?.attributes?.rates)
      : [];

    const combined = [...todayRates, ...tomorrowRates]
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
    const future = rates.filter(s => s.validTo > now);
    if (future.length < slotsNeeded) return null;

    let bestConsec = { avg: Infinity, start: 0 };
    for (let i = 0; i <= future.length - slotsNeeded; i++) {
      const avg = future.slice(i, i + slotsNeeded).reduce((s, r) => s + r.price, 0) / slotsNeeded;
      if (avg < bestConsec.avg) bestConsec = { avg, start: i };
    }
    const consecBlock = future.slice(bestConsec.start, bestConsec.start + slotsNeeded);

    const cheapestN = [...future].sort((a, b) => a.price - b.price).slice(0, slotsNeeded);
    const indivAvg  = cheapestN.reduce((s, r) => s + r.price, 0) / slotsNeeded;

    const useSplit = (bestConsec.avg - indivAvg) > split_threshold;
    const selected = useSplit
      ? [...cheapestN].sort((a, b) => a.validFrom - b.validFrom)
      : consecBlock;

    let skipped = [];
    if (useSplit && selected.length > 1) {
      const rangeStart    = selected[0].validFrom;
      const rangeEnd      = selected[selected.length - 1].validTo;
      const selectedTimes = new Set(selected.map(s => s.validFrom.getTime()));
      skipped = future.filter(
        s => s.validFrom >= rangeStart && s.validTo <= rangeEnd && !selectedTimes.has(s.validFrom.getTime()),
      );
    }

    return {
      runs:        _groupIntoRuns(selected),
      skippedRuns: _groupIntoRuns(skipped),
      useSplit,
      totalCost:  selected.reduce((sum, s) => sum + s.price * energyPerSlot, 0) / 100,
      consecCost: consecBlock.reduce((sum, s) => sum + s.price * energyPerSlot, 0) / 100,
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

    skippedRuns.forEach(grp => {
      const row = _el('div', 'skipped');
      row.textContent = `⚠ Skipped ${_fmtTime(grp[0].validFrom)}–${_fmtTime(grp[grp.length - 1].validTo)} @ ${_avgPrice(grp).toFixed(1)}p`;
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
    const runCost   = run.reduce((s, r) => s + r.price * charger_kw * 0.5, 0) / 100;
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

  // ── State change detection ────────────────────────────────────────────────

  _stateKey(hass) {
    const { entity_current_day_rates, entity_next_day_rates,
            entity_current_soc, entity_target_soc,
            entity_plug_state, entity_greenness_forecast } = this._config;
    return [
      hass.states[entity_current_day_rates]?.last_changed,
      entity_next_day_rates     ? hass.states[entity_next_day_rates]?.last_changed     : '',
      entity_current_soc        ? hass.states[entity_current_soc]?.state               : '',
      entity_target_soc         ? hass.states[entity_target_soc]?.state                : '',
      entity_plug_state         ? hass.states[entity_plug_state]?.state                : '',
      entity_greenness_forecast ? hass.states[entity_greenness_forecast]?.last_changed : '',
    ].join('|');
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
  return slots.reduce((s, r) => s + r.price, 0) / slots.length;
}

function _groupIntoRuns(slots) {
  if (!slots.length) return [];
  const runs = [];
  let current = [slots[0]];
  for (let i = 1; i < slots.length; i++) {
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
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function _fmtDayRange(days) {
  const ORDER = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'];
  const SHORT  = { MONDAY:'Mon', TUESDAY:'Tue', WEDNESDAY:'Wed', THURSDAY:'Thu', FRIDAY:'Fri', SATURDAY:'Sat', SUNDAY:'Sun' };
  const sorted = [...days].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const idxs   = sorted.map(d => ORDER.indexOf(d));
  const consec = sorted.length > 1 && idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1);
  if (sorted.length === 1) return SHORT[sorted[0]] || sorted[0];
  if (consec) return `${SHORT[sorted[0]]}–${SHORT[sorted[sorted.length - 1]]}`;
  return sorted.map(d => SHORT[d] || d).join(', ');
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
