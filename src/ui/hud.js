/**
 * @file hud.js — DOM HUD: size odometer with unit rollover, absorbed counter,
 * tier banner, progress bar, and the v2 set: #timer (EVT.TIME mm:ss.t),
 * score panel + pooled floating '+N' spans (EVT.SCORE), dash gauge
 * (GrowEvent.dashGauge01 / EVT.DASH zero / EVT.DASH_READY flash), mute button
 * (-> EVT.MUTE_REQUEST, icon on EVT.MUTE_CHANGED), #moon-arrow screen-edge
 * guide (EVT.MOON_GUIDE), #hud-toast (queue-of-1, 3 s).
 *
 * Purely event-subscribed (no per-frame update call from main.js — "hud is
 * event-driven"). DOM writes are throttled/diffed: nothing is assigned unless
 * the rendered string actually changed. String allocation only happens on the
 * throttled/event paths, per the mathUtils.formatLength/splitLength contract.
 *
 * Visibility: HUD hides on EVT.MOON_CONTACT (finale cinema takes over) and on
 * game:win/reset; re-shows on game:start.
 *
 * DOM contract (frozen in index.html):
 *   #hud (starts .hidden), #size-value, #size-unit, #absorbed-value,
 *   #tier-banner (.show), #tier-label, #progress-fill (style.width %),
 *   #timer, #score-panel/#score-value, #score-float-layer
 *   (.score-float/.fly/.rare spans), #dash-gauge (.flash)/#dash-gauge-fill,
 *   #mute-button, #hud-toast (.show), #moon-arrow (.arrow-tip, --arrow-rot).
 *   Visibility convention: toggle class 'hidden'.
 */

import { EVT, PAYLOADS } from '../core/events.js';
import { HUD_THROTTLE_HZ, START_RADIUS_M } from '../config/tuning.js';
import { TIERS } from '../config/tiers.js';
import { splitLength, clamp01 } from '../core/mathUtils.js';

/** @typedef {import('../core/events.js').EventBus} EventBus */
/** @typedef {import('../types.js').GrowEvent} GrowEvent */
/** @typedef {import('../types.js').AbsorbEvent} AbsorbEvent */
/** @typedef {import('../types.js').TierUpEvent} TierUpEvent */
/** @typedef {import('../types.js').TimeEvent} TimeEvent */
/** @typedef {import('../types.js').ScoreEvent} ScoreEvent */
/** @typedef {import('../types.js').DashEvent} DashEvent */
/** @typedef {import('../types.js').MoonGuideEvent} MoonGuideEvent */
/** @typedef {import('../types.js').MoonCallEvent} MoonCallEvent */
/** @typedef {import('../types.js').MuteChangedEvent} MuteChangedEvent */

/** How long the tier banner stays popped (ms). Cosmetic only. */
const BANNER_SHOW_MS = 2400;
/** How long the unit rollover pop lasts (ms) — matches the CSS transition. */
const UNIT_POP_MS = 260;
/** Toast display time (ms) — queue-of-1: a new toast replaces the current. */
const TOAST_SHOW_MS = 3000;
/** Pooled floating '+N' spans (matches the score-fly 0.9 s animation churn). */
const FLOAT_POOL_SIZE = 8;
/** Pseudo-random offsets (px) cycled per float span — no Math.random churn. */
const FLOAT_OFF_X = [0, 34, 12, 52, 22, 64, 4, 44];
const FLOAT_OFF_Y = [0, 18, 38, 8, 52, 28, 64, 46];
/** Gauge flash animation length (ms) — matches CSS gauge-flash. */
const GAUGE_FLASH_MS = 520;

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
    // ---- v2 ----
    this._timerEl = /** @type {HTMLElement} */ (document.getElementById('timer'));
    this._scoreValueEl = /** @type {HTMLElement} */ (document.getElementById('score-value'));
    this._floatLayerEl = /** @type {HTMLElement} */ (document.getElementById('score-float-layer'));
    this._gaugeEl = /** @type {HTMLElement} */ (document.getElementById('dash-gauge'));
    this._gaugeFillEl = /** @type {HTMLElement} */ (document.getElementById('dash-gauge-fill'));
    this._muteBtn = /** @type {HTMLButtonElement} */ (document.getElementById('mute-button'));
    this._toastEl = /** @type {HTMLElement} */ (document.getElementById('hud-toast'));
    this._arrowEl = /** @type {HTMLElement} */ (document.getElementById('moon-arrow'));

    /* --- pooled floating '+N' spans (created once — zero churn later) --- */
    /** @type {HTMLSpanElement[]} */
    this._floatPool = [];
    for (let i = 0; i < FLOAT_POOL_SIZE; i++) {
      const span = document.createElement('span');
      span.className = 'score-float';
      span.style.left = FLOAT_OFF_X[i] + 'px';
      span.style.top = FLOAT_OFF_Y[i] + 'px';
      this._floatLayerEl.appendChild(span);
      this._floatPool.push(span);
    }
    this._floatNext = 0;

    /* --- diff caches (last strings/numbers actually written to the DOM) --- */
    /** @type {{ value: string, unit: string }} reused splitLength out object */
    this._split = { value: '', unit: '' };
    this._lastValueText = '';
    this._lastUnitText = '';
    this._lastCountShown = -1;
    this._lastProgressPct = -1;
    this._lastTierLabel = '';
    this._lastTimerText = '';
    this._lastScoreShown = -1;
    this._lastGaugePct = -1;

    /* --- throttle state --- */
    this._minIntervalMs = 1000 / HUD_THROTTLE_HZ;
    this._lastGrowWriteMs = 0;
    this._lastCountWriteMs = 0;
    /** Latest absorb count seen (flushed on the next gate). */
    this._pendingCount = 0;
    /* --- v2 score throttle: EVT.SCORE fires once PER ABSORB inside the
       fixed-step loop; the float-span path forces a synchronous reflow, so
       it is gated like _onAbsorb. Deltas accumulate between gates and one
       span carries the sum (burst absorbs read as one bigger '+N'). --- */
    this._lastScoreWriteMs = 0;
    /** Accumulated un-flushed score delta. */
    this._pendingDelta = 0;
    /** Latest total score seen (flushed with the delta). */
    this._pendingScore = -1;
    /** A rare absorb is in the pending window (gold span styling). */
    this._pendingRare = false;
    /** Cached formatter — toLocaleString re-resolves the locale every call. */
    this._numFmt =
      typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function'
        ? new Intl.NumberFormat('ja-JP')
        : null;

    /* --- timers --- */
    /** @type {ReturnType<typeof setTimeout> | 0} */
    this._bannerTimer = 0;
    /** @type {ReturnType<typeof setTimeout> | 0} */
    this._unitPopTimer = 0;
    /** @type {ReturnType<typeof setTimeout> | 0} */
    this._toastTimer = 0;
    /** @type {ReturnType<typeof setTimeout> | 0} */
    this._gaugeFlashTimer = 0;

    /** One 「月へ向かえ！」 toast per run (reset on game:start). */
    this._guideToastShown = false;

    /* --- prebound handlers (subscribe once, zero closures later) --- */
    this._onGrow = this._onGrow.bind(this);
    this._onAbsorb = this._onAbsorb.bind(this);
    this._onTierUp = this._onTierUp.bind(this);
    this._onStart = this._onStart.bind(this);
    this._onWin = this._onWin.bind(this);
    this._onReset = this._onReset.bind(this);
    this._onTime = this._onTime.bind(this);
    this._onScore = this._onScore.bind(this);
    this._onDash = this._onDash.bind(this);
    this._onDashReady = this._onDashReady.bind(this);
    this._onMuteChanged = this._onMuteChanged.bind(this);
    this._onMoonCall = this._onMoonCall.bind(this);
    this._onMoonGuide = this._onMoonGuide.bind(this);
    this._onMoonContact = this._onMoonContact.bind(this);
    this._onMuteClick = this._onMuteClick.bind(this);
    this._hideBanner = this._hideBanner.bind(this);
    this._endUnitPop = this._endUnitPop.bind(this);
    this._hideToast = this._hideToast.bind(this);
    this._endGaugeFlash = this._endGaugeFlash.bind(this);

    bus.on(EVT.GROW, this._onGrow);
    bus.on(EVT.ABSORB, this._onAbsorb);
    bus.on(EVT.TIER_UP, this._onTierUp);
    bus.on(EVT.GAME_START, this._onStart);
    bus.on(EVT.GAME_WIN, this._onWin);
    bus.on(EVT.GAME_RESET, this._onReset);
    bus.on(EVT.TIME, this._onTime);
    bus.on(EVT.SCORE, this._onScore);
    bus.on(EVT.DASH, this._onDash);
    bus.on(EVT.DASH_READY, this._onDashReady);
    bus.on(EVT.MUTE_CHANGED, this._onMuteChanged);
    bus.on(EVT.MOON_CALL, this._onMoonCall);
    bus.on(EVT.MOON_GUIDE, this._onMoonGuide);
    bus.on(EVT.MOON_CONTACT, this._onMoonContact);

    this._muteBtn.addEventListener('click', this._onMuteClick);

    this.reset();
  }

  /**
   * Reset all HUD readouts to a fresh run (size = START_RADIUS_M, count 0,
   * progress 0, tier label T0, timer 0:00.0, score 0, dash gauge full,
   * toast/arrow hidden). Does NOT change visibility.
   */
  reset() {
    this._pendingCount = 0;
    this._lastCountShown = -1;
    this._lastProgressPct = -1;
    this._lastGrowWriteMs = 0;
    this._lastCountWriteMs = 0;
    this._lastScoreWriteMs = 0;
    this._pendingDelta = 0;
    this._pendingScore = -1;
    this._pendingRare = false;
    this._lastTimerText = '';
    this._lastScoreShown = -1;
    this._lastGaugePct = -1;
    this._guideToastShown = false;
    this._writeSize(START_RADIUS_M);
    this._writeCount(0);
    this._writeProgress(0);
    this._writeTierLabel(TIERS[0].name);
    this._writeTimer(0);
    this._writeScore(0);
    this._writeGauge(1);
    this._hideBanner();
    this._hideToast();
    this._arrowEl.classList.add('hidden');
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
   * 'grow' — odometer + progress bar + dash gauge fill. The emitter already
   * throttles to ~10Hz; the local gate makes the HUD robust if that changes.
   * @param {GrowEvent} p
   */
  _onGrow(p) {
    const now = performance.now();
    if (now - this._lastGrowWriteMs < this._minIntervalMs) return;
    this._lastGrowWriteMs = now;
    this._writeSize(p.trueRadius);
    this._writeProgress(p.progress01ToNextTier);
    this._writeGauge(p.dashGauge01);
    // Piggyback the absorbed counter so a burst's final value always lands.
    this._writeCount(this._pendingCount);
    // Piggyback any un-flushed score delta (trailing flush after a burst).
    if (this._pendingDelta > 0 && now - this._lastScoreWriteMs >= this._minIntervalMs) {
      this._flushScore(now);
    }
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

  /**
   * 'time' — sim clock crossed a 0.1 s boundary (10 Hz; string alloc allowed
   * on this throttled path).
   * @param {TimeEvent} p
   */
  _onTime(p) {
    this._writeTimer(p.timeS);
  }

  /**
   * 'score' — fires once PER ABSORB (inside the fixed-step loop), so the DOM
   * work is throttled: deltas accumulate and at most one float span +
   * score-panel write happens per gate window (the span's `void offsetWidth`
   * is a forced synchronous reflow — never per-absorb). The rare toast stays
   * immediate (rares are rare; it is a cheap class toggle path).
   * @param {ScoreEvent} p
   */
  _onScore(p) {
    this._pendingDelta += p.delta;
    this._pendingScore = p.score;
    if (p.rare) {
      this._pendingRare = true;
      this._showToast('レアはっけん！+5000');
    }
    const now = performance.now();
    if (now - this._lastScoreWriteMs < this._minIntervalMs) return; // _onGrow flushes trailing
    this._flushScore(now);
  }

  /** Write the score panel + one pooled float span from the pending state. */
  _flushScore(now) {
    this._lastScoreWriteMs = now;
    if (this._pendingScore >= 0) this._writeScore(this._pendingScore);
    const delta = this._pendingDelta;
    this._pendingDelta = 0;
    if (delta <= 0) return;
    // Floating '+N': recycle the next pooled span and restart its animation.
    const span = this._floatPool[this._floatNext];
    this._floatNext = (this._floatNext + 1) % FLOAT_POOL_SIZE;
    span.textContent = '+' + (this._numFmt !== null ? this._numFmt.format(delta) : String(delta));
    if (this._pendingRare) span.classList.add('rare');
    else span.classList.remove('rare');
    this._pendingRare = false;
    span.classList.remove('fly');
    void span.offsetWidth; // reflow — restarts the score-fly animation
    span.classList.add('fly');
  }

  /**
   * 'dash' — gauge zeroes instantly (recharge refills it via 'grow').
   * @param {DashEvent} p
   */
  _onDash(p) {
    this._writeGauge(p.gauge01);
  }

  /** 'dashReady' — gauge flash (restartable CSS animation). */
  _onDashReady() {
    this._gaugeEl.classList.remove('flash');
    void this._gaugeEl.offsetWidth; // reflow — restart animation
    this._gaugeEl.classList.add('flash');
    if (this._gaugeFlashTimer !== 0) clearTimeout(this._gaugeFlashTimer);
    this._gaugeFlashTimer = setTimeout(this._endGaugeFlash, GAUGE_FLASH_MS);
  }

  /** #mute-button click -> EVT.MUTE_REQUEST (main.js is the single owner). */
  _onMuteClick() {
    this._bus.emit(EVT.MUTE_REQUEST, PAYLOADS.muteRequest);
  }

  /**
   * 'muteChanged' — icon only (audio itself is driven by main.js).
   * @param {MuteChangedEvent} p
   */
  _onMuteChanged(p) {
    this._muteBtn.textContent = p.muted ? '🔇' : '🔊';
  }

  /**
   * 'moonCall' — toast 「月が呼んでいる…！」 (env pulse / audio handled elsewhere).
   * @param {MoonCallEvent} p
   */
  _onMoonCall(p) {
    this._showToast('月が呼んでいる…！');
  }

  /**
   * 'moonGuide' — screen-edge arrow: position from x01/y01 (0..1, y 0 = top),
   * tip rotated to point from screen center toward the moon.
   * @param {MoonGuideEvent} p
   */
  _onMoonGuide(p) {
    if (!p.active || p.onScreen) {
      // Inactive OR the moon itself is visible on screen — an edge arrow
      // sitting on top of the moon is noise; it returns when the moon
      // leaves the frustum (payload keeps arriving at 10 Hz).
      this._arrowEl.classList.add('hidden');
      if (p.active && !this._guideToastShown) {
        this._guideToastShown = true;
        this._showToast('月へ向かえ！');
      }
      return;
    }
    this._arrowEl.classList.remove('hidden');
    // Keep the 56px arrow inside the viewport (payload is already clamped).
    const x = 0.04 + clamp01(p.x01) * 0.92;
    const y = 0.06 + clamp01(p.y01) * 0.86;
    this._arrowEl.style.left = (x * 100).toFixed(1) + '%';
    this._arrowEl.style.top = (y * 100).toFixed(1) + '%';
    const deg = Math.atan2(p.x01 - 0.5, 0.5 - p.y01) * (180 / Math.PI);
    this._arrowEl.style.setProperty('--arrow-rot', deg.toFixed(1) + 'deg');
    if (!this._guideToastShown) {
      this._guideToastShown = true;
      this._showToast('月へ向かえ！');
    }
  }

  /** 'moonContact' — the finale cinema owns the screen; HUD out of the way. */
  _onMoonContact() {
    this._arrowEl.classList.add('hidden');
    this._hideToast();
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

  /**
   * #timer — m:ss.t from SIM seconds (timeS arrives on 0.1 s boundaries).
   * @param {number} timeS Elapsed simulated seconds.
   */
  _writeTimer(timeS) {
    const t10 = Math.round(timeS * 10);
    const m = (t10 / 600) | 0;
    const rem = t10 - m * 600;
    const ss = (rem / 10) | 0;
    const text = m + ':' + (ss < 10 ? '0' : '') + ss + '.' + (rem % 10);
    if (text === this._lastTimerText) return;
    this._lastTimerText = text;
    this._timerEl.textContent = text;
  }

  /**
   * #score-value — diffed; ja-JP grouping for readability.
   * @param {number} score Total score.
   */
  _writeScore(score) {
    if (score === this._lastScoreShown) return;
    this._lastScoreShown = score;
    this._scoreValueEl.textContent =
      this._numFmt !== null ? this._numFmt.format(score) : String(score);
  }

  /**
   * #dash-gauge-fill width — 1% steps, diffed.
   * @param {number} gauge01 Dash charge 0..1.
   */
  _writeGauge(gauge01) {
    const pct = Math.round(clamp01(gauge01) * 100);
    if (pct === this._lastGaugePct) return;
    this._lastGaugePct = pct;
    this._gaugeFillEl.style.width = pct + '%';
  }

  /* ---------------------------------------------------------------- */
  /* Toast (queue-of-1) / timer callbacks                               */
  /* ---------------------------------------------------------------- */

  /**
   * Show a toast for TOAST_SHOW_MS; a newer toast replaces the current one.
   * @param {string} text
   */
  _showToast(text) {
    this._toastEl.textContent = text;
    this._toastEl.classList.add('show');
    if (this._toastTimer !== 0) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(this._hideToast, TOAST_SHOW_MS);
  }

  /** Hides the toast (timer callback, prebound). */
  _hideToast() {
    this._toastTimer = 0;
    this._toastEl.classList.remove('show');
  }

  /** Ends the gauge flash so the next one can restart cleanly (prebound). */
  _endGaugeFlash() {
    this._gaugeFlashTimer = 0;
    this._gaugeEl.classList.remove('flash');
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
