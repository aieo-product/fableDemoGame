/**
 * @file hud.js — DOM HUD: size odometer with unit rollover, absorbed counter,
 * tier banner, progress bar.
 *
 * Purely event-subscribed (no per-frame update call from main.js — "hud is
 * event-driven"). DOM writes are throttled to HUD_THROTTLE_HZ and
 * textContent-diffed: nothing is assigned unless the rendered string actually
 * changed. String allocation only happens on the throttled paths, per the
 * mathUtils.formatLength/splitLength contract.
 *
 * DOM contract (frozen in index.html):
 *   #hud (starts .hidden), #size-value, #size-unit, #absorbed-value,
 *   #tier-banner (class 'show' pops it), #tier-label, #progress-fill
 *   (style.width %). Visibility convention: toggle class 'hidden'.
 */

import { EVT } from '../core/events.js';
import { HUD_THROTTLE_HZ, START_RADIUS_M } from '../config/tuning.js';
import { TIERS } from '../config/tiers.js';
import { splitLength, clamp01 } from '../core/mathUtils.js';

/** @typedef {import('../core/events.js').EventBus} EventBus */
/** @typedef {import('../types.js').GrowEvent} GrowEvent */
/** @typedef {import('../types.js').AbsorbEvent} AbsorbEvent */
/** @typedef {import('../types.js').TierUpEvent} TierUpEvent */

/** How long the tier banner stays popped (ms). Cosmetic only. */
const BANNER_SHOW_MS = 2400;
/** How long the unit rollover pop lasts (ms) — matches the CSS transition. */
const UNIT_POP_MS = 260;

/**
 * DOM HUD controller. Construct once at boot; subscribes to the bus and
 * never needs a per-frame tick.
 */
export class Hud {
  /**
   * @param {EventBus} bus The shared game event bus.
   */
  constructor(bus) {
    this._bus = bus;

    /* --- DOM refs (frozen ids in index.html) --- */
    this._root = /** @type {HTMLElement} */ (document.getElementById('hud'));
    this._sizeValueEl = /** @type {HTMLElement} */ (document.getElementById('size-value'));
    this._sizeUnitEl = /** @type {HTMLElement} */ (document.getElementById('size-unit'));
    this._absorbedEl = /** @type {HTMLElement} */ (document.getElementById('absorbed-value'));
    this._bannerEl = /** @type {HTMLElement} */ (document.getElementById('tier-banner'));
    this._tierLabelEl = /** @type {HTMLElement} */ (document.getElementById('tier-label'));
    this._progressFillEl = /** @type {HTMLElement} */ (document.getElementById('progress-fill'));

    /* --- diff caches (last strings/numbers actually written to the DOM) --- */
    /** @type {{ value: string, unit: string }} reused splitLength out object */
    this._split = { value: '', unit: '' };
    this._lastValueText = '';
    this._lastUnitText = '';
    this._lastCountShown = -1;
    this._lastProgressPct = -1;
    this._lastTierLabel = '';

    /* --- throttle state --- */
    this._minIntervalMs = 1000 / HUD_THROTTLE_HZ;
    this._lastGrowWriteMs = 0;
    this._lastCountWriteMs = 0;
    /** Latest absorb count seen (flushed on the next gate). */
    this._pendingCount = 0;

    /* --- timers --- */
    /** @type {ReturnType<typeof setTimeout> | 0} */
    this._bannerTimer = 0;
    /** @type {ReturnType<typeof setTimeout> | 0} */
    this._unitPopTimer = 0;

    /* --- prebound handlers (subscribe once, zero closures later) --- */
    this._onGrow = this._onGrow.bind(this);
    this._onAbsorb = this._onAbsorb.bind(this);
    this._onTierUp = this._onTierUp.bind(this);
    this._onStart = this._onStart.bind(this);
    this._onWin = this._onWin.bind(this);
    this._onReset = this._onReset.bind(this);
    this._hideBanner = this._hideBanner.bind(this);
    this._endUnitPop = this._endUnitPop.bind(this);

    bus.on(EVT.GROW, this._onGrow);
    bus.on(EVT.ABSORB, this._onAbsorb);
    bus.on(EVT.TIER_UP, this._onTierUp);
    bus.on(EVT.GAME_START, this._onStart);
    bus.on(EVT.GAME_WIN, this._onWin);
    bus.on(EVT.GAME_RESET, this._onReset);

    this.reset();
  }

  /**
   * Reset all HUD readouts to a fresh run (size = START_RADIUS_M, count 0,
   * progress 0, tier label T0). Does NOT change visibility.
   */
  reset() {
    this._pendingCount = 0;
    this._lastCountShown = -1;
    this._lastProgressPct = -1;
    this._lastGrowWriteMs = 0;
    this._lastCountWriteMs = 0;
    this._writeSize(START_RADIUS_M);
    this._writeCount(0);
    this._writeProgress(0);
    this._writeTierLabel(TIERS[0].name);
    this._hideBanner();
  }

  /** Show the HUD (remove .hidden). */
  show() {
    this._root.classList.remove('hidden');
    this._root.setAttribute('aria-hidden', 'false');
  }

  /** Hide the HUD (add .hidden). */
  hide() {
    this._root.classList.add('hidden');
    this._root.setAttribute('aria-hidden', 'true');
  }

  /* ---------------------------------------------------------------- */
  /* Event handlers (payloads are reused objects — read-only, no retain) */
  /* ---------------------------------------------------------------- */

  /**
   * 'grow' — odometer + progress bar. The emitter already throttles to ~10Hz;
   * the local gate makes the HUD robust if that ever changes.
   * @param {GrowEvent} p
   */
  _onGrow(p) {
    const now = performance.now();
    if (now - this._lastGrowWriteMs < this._minIntervalMs) return;
    this._lastGrowWriteMs = now;
    this._writeSize(p.trueRadius);
    this._writeProgress(p.progress01ToNextTier);
    // Piggyback the absorbed counter so a burst's final value always lands.
    this._writeCount(this._pendingCount);
  }

  /**
   * 'absorb' — absorbed counter (throttled; grow flushes the trailing value).
   * @param {AbsorbEvent} p
   */
  _onAbsorb(p) {
    this._pendingCount = p.count;
    const now = performance.now();
    if (now - this._lastCountWriteMs < this._minIntervalMs) return;
    this._lastCountWriteMs = now;
    this._writeCount(p.count);
  }

  /**
   * 'tierUp' — banner pop + tier label. COSMETIC ONLY.
   * @param {TierUpEvent} p
   */
  _onTierUp(p) {
    this._writeTierLabel(p.name);
    this._bannerEl.textContent = p.name;
    this._bannerEl.classList.add('show');
    if (this._bannerTimer !== 0) clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(this._hideBanner, BANNER_SHOW_MS);
  }

  /** 'game:start' — fresh readouts, then reveal. */
  _onStart() {
    this.reset();
    this.show();
  }

  /** 'game:win' — hide behind the win overlay. */
  _onWin() {
    this.hide();
  }

  /** 'game:reset' — back to title. */
  _onReset() {
    this.reset();
    this.hide();
  }

  /* ---------------------------------------------------------------- */
  /* Diffed DOM writers                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Write the size odometer; a unit change triggers the rollover pop.
   * @param {number} trueRadiusM Ball radius in real meters.
   */
  _writeSize(trueRadiusM) {
    splitLength(trueRadiusM, this._split);
    if (this._split.value !== this._lastValueText) {
      this._lastValueText = this._split.value;
      this._sizeValueEl.textContent = this._split.value;
    }
    if (this._split.unit !== this._lastUnitText) {
      this._lastUnitText = this._split.unit;
      this._sizeUnitEl.textContent = this._split.unit;
      this._popUnit();
    }
  }

  /**
   * @param {number} count Total absorbed this run.
   */
  _writeCount(count) {
    if (count === this._lastCountShown) return;
    this._lastCountShown = count;
    this._absorbedEl.textContent = String(count);
  }

  /**
   * @param {number} progress01 0..1 progress within the current tier band.
   */
  _writeProgress(progress01) {
    const pct = Math.round(clamp01(progress01) * 1000) / 10; // 0.1% steps
    if (pct === this._lastProgressPct) return;
    this._lastProgressPct = pct;
    this._progressFillEl.style.width = pct + '%';
  }

  /**
   * @param {string} name Tier display name -> uppercase label.
   */
  _writeTierLabel(name) {
    if (name === this._lastTierLabel) return;
    this._lastTierLabel = name;
    this._tierLabelEl.textContent = name.toUpperCase();
  }

  /** Unit rollover pop: scale kick that the CSS transition eases back. */
  _popUnit() {
    this._sizeUnitEl.style.transform = 'scale(1.5)';
    if (this._unitPopTimer !== 0) clearTimeout(this._unitPopTimer);
    this._unitPopTimer = setTimeout(this._endUnitPop, UNIT_POP_MS);
  }

  /** Ends the unit pop (timer callback, prebound). */
  _endUnitPop() {
    this._unitPopTimer = 0;
    this._sizeUnitEl.style.transform = '';
  }

  /** Hides the tier banner (timer callback, prebound). */
  _hideBanner() {
    this._bannerTimer = 0;
    this._bannerEl.classList.remove('show');
  }
}
