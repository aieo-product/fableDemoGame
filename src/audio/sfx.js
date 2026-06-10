/**
 * @file sfx.js — WebAudio-synthesized SFX, zero audio assets.
 *
 * Sounds: rising-pitch absorb combo blips, bonk clonk, knock-off plink,
 * tierUp 3-note arpeggio, win fanfare, and a continuous filtered-noise roll
 * loop whose gain/brightness follow ball speed.
 *
 * Bus-driven: subscribes to ABSORB / BOUNCE / KNOCK_OFF / TIER_UP / GAME_WIN /
 * GAME_START / GAME_RESET. The AudioContext is created and resumed on the
 * FIRST user input (pointerdown / keydown / touchstart on window) — browser
 * autoplay policy. Until then every trigger is a silent no-op.
 *
 * Roll loop: speed is not on the bus, so main.js (or the integrator's choice
 * of call site) feeds it per frame or at 10Hz:
 *   sfx.setRollIntensity(speed01)   // speed01 = |vel| / (SPEED_K * radiusSim)
 *
 * One-shot oscillator/gain nodes are created per trigger — standard WebAudio
 * practice (event-driven, never in the per-frame loop; the only per-frame
 * path, setRollIntensity, allocates nothing).
 */

import { bus, EVT } from '../core/events.js';
import { clamp01 } from '../core/mathUtils.js';

/** Master output gain. */
const MASTER_GAIN = 0.5;
/** Absorb blip base frequency (Hz); combo adds semitones. */
const BLIP_BASE_HZ = 392; // G4
/** Combo semitone cap for the rising pitch. */
const BLIP_SEMITONE_CAP = 14;
/** tierUp arpeggio (C5-E5-G5), seconds apart. */
const ARP_NOTES = [523.25, 659.25, 783.99];
const ARP_SPACING_S = 0.09;
/** Win fanfare (C5 E5 G5 C6 E6). */
const FANFARE_NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5];
const FANFARE_SPACING_S = 0.13;
/** Roll loop maximum gain / lowpass sweep. */
const ROLL_GAIN_MAX = 0.14;
const ROLL_FREQ_MIN = 180;
const ROLL_FREQ_MAX = 1100;

/**
 * Synthesized sound effects. Construct once at boot (subscribes to the bus
 * and installs first-gesture AudioContext bootstrapping).
 */
export class Sfx {
  /**
   * @param {import('../core/events.js').EventBus} [eventBus] Bus; defaults to the singleton.
   */
  constructor(eventBus = bus) {
    /** @type {AudioContext|null} */
    this._ctx = null;
    /** @type {GainNode|null} */
    this._master = null;
    /** @type {GainNode|null} */
    this._rollGain = null;
    /** @type {BiquadFilterNode|null} */
    this._rollFilter = null;
    /** @type {number} Cached roll intensity to skip redundant param writes. */
    this._rollLevel = -1;
    /** @type {boolean} */
    this._muted = false;

    // --- first-gesture AudioContext bootstrap ---------------------------
    this._onGesture = () => {
      this._ensureCtx();
      if (this._ctx !== null && this._ctx.state === 'suspended') {
        this._ctx.resume();
      }
    };
    window.addEventListener('pointerdown', this._onGesture);
    window.addEventListener('keydown', this._onGesture);
    window.addEventListener('touchstart', this._onGesture);

    // --- bus subscriptions (payloads reused — read fields only) -----------
    eventBus.on(EVT.ABSORB, (p) => {
      this._blip(p.combo);
    });
    eventBus.on(EVT.BOUNCE, (p) => {
      this._clonk(p.impactSpeed01);
    });
    eventBus.on(EVT.KNOCK_OFF, (p) => {
      this._knock(p.count);
    });
    eventBus.on(EVT.TIER_UP, () => {
      this._arpeggio(ARP_NOTES, ARP_SPACING_S, 0.22, 0.4);
    });
    eventBus.on(EVT.GAME_WIN, () => {
      this._arpeggio(FANFARE_NOTES, FANFARE_SPACING_S, 0.24, 0.9);
      this.setRollIntensity(0);
    });
    eventBus.on(EVT.GAME_START, () => {
      // The start click is itself a user gesture — safe to (re)create here.
      this._onGesture();
      this._pluck();
    });
    eventBus.on(EVT.GAME_RESET, () => {
      this.setRollIntensity(0);
    });
  }

  /**
   * Drive the rolling-noise loop. Call per frame (or 10Hz) from main.js with
   * speed01 = horizontal |vel| / (SPEED_K * radiusSim). Zero allocation.
   * @param {number} speed01 Normalized ball speed, 0..1.
   */
  setRollIntensity(speed01) {
    if (this._ctx === null || this._rollGain === null || this._rollFilter === null) return;
    const v = clamp01(speed01);
    if (Math.abs(v - this._rollLevel) < 0.01) return;
    this._rollLevel = v;
    const t = this._ctx.currentTime;
    const gain = this._muted ? 0 : ROLL_GAIN_MAX * v * v; // quadratic — quiet at low speed
    this._rollGain.gain.setTargetAtTime(gain, t, 0.08);
    this._rollFilter.frequency.setTargetAtTime(
      ROLL_FREQ_MIN + (ROLL_FREQ_MAX - ROLL_FREQ_MIN) * v,
      t,
      0.1
    );
  }

  /**
   * Mute/unmute everything.
   * @param {boolean} muted
   */
  setMuted(muted) {
    this._muted = muted;
    if (this._master !== null && this._ctx !== null) {
      this._master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this._ctx.currentTime, 0.02);
    }
  }

  /** Tear down listeners and close the context (tests / teardown). */
  dispose() {
    window.removeEventListener('pointerdown', this._onGesture);
    window.removeEventListener('keydown', this._onGesture);
    window.removeEventListener('touchstart', this._onGesture);
    if (this._ctx !== null) {
      this._ctx.close();
      this._ctx = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Context / graph bootstrap                                          */
  /* ---------------------------------------------------------------- */

  /** Create the AudioContext + master chain + roll loop (idempotent). */
  _ensureCtx() {
    if (this._ctx !== null) return;
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (AC === undefined) return; // no WebAudio — stay silent forever
    const ctx = new AC();
    this._ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : MASTER_GAIN;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    this._master = master;

    // Roll loop: looping white noise -> lowpass -> gain(0) -> master.
    const len = (ctx.sampleRate * 1.5) | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < len; i++) {
      // Cheap LCG noise (deterministic, no Math.random churn).
      seed = (seed * 1664525 + 1013904223) | 0;
      data[i] = ((seed >>> 9) / 0x3fffff - 1) * 0.8;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = ROLL_FREQ_MIN;
    filter.Q.value = 0.4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    this._rollFilter = filter;
    this._rollGain = gain;
    this._rollLevel = -1;
  }

  /**
   * Schedule one enveloped oscillator note.
   * @param {number} freq Start frequency (Hz).
   * @param {number} endFreq End frequency (Hz, exponential glide).
   * @param {OscillatorType} type Oscillator type.
   * @param {number} when Start time (ctx time, s).
   * @param {number} dur Note length (s).
   * @param {number} peak Peak gain.
   */
  _note(freq, endFreq, type, when, dur, peak) {
    const ctx = this._ctx;
    if (ctx === null || this._master === null) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, when + dur);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(this._master);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  /* ---------------------------------------------------------------- */
  /* Triggers                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Absorb blip — pitch rises one semitone per combo step.
   * @param {number} combo Current rapid-absorb combo count.
   */
  _blip(combo) {
    if (this._ctx === null) return;
    const semis = combo < BLIP_SEMITONE_CAP ? combo : BLIP_SEMITONE_CAP;
    const f = BLIP_BASE_HZ * Math.pow(2, semis / 12);
    const t = this._ctx.currentTime;
    this._note(f, f * 1.35, 'triangle', t, 0.12, 0.22);
    this._note(f * 2, f * 2.4, 'sine', t, 0.08, 0.07); // sparkle overtone
  }

  /**
   * Bonk clonk — pitch-dropping thud + noise burst, volume by impact.
   * @param {number} impact01 Impact speed normalized 0..1.
   */
  _clonk(impact01) {
    const ctx = this._ctx;
    if (ctx === null || this._master === null) return;
    const t = ctx.currentTime;
    const v = 0.1 + 0.3 * clamp01(impact01);
    this._note(150 + 80 * impact01, 55, 'sine', t, 0.16, v);
    this._note(95, 50, 'triangle', t, 0.1, v * 0.6);
  }

  /**
   * Knock-off plink — short descending square per ejection burst.
   * @param {number} count Ejected stuck objects (1..3).
   */
  _knock(count) {
    if (this._ctx === null) return;
    const t = this._ctx.currentTime;
    const n = count < 3 ? count : 3;
    for (let i = 0; i < n; i++) {
      this._note(330 - i * 40, 165 - i * 20, 'square', t + i * 0.05, 0.12, 0.08);
    }
  }

  /**
   * Celebration arpeggio / fanfare.
   * @param {number[]} notes Frequencies (Hz).
   * @param {number} spacing Seconds between note starts.
   * @param {number} peak Per-note peak gain.
   * @param {number} dur Per-note duration (s).
   */
  _arpeggio(notes, spacing, peak, dur) {
    if (this._ctx === null) return;
    const t = this._ctx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      const when = t + i * spacing;
      this._note(notes[i], notes[i], 'triangle', when, dur, peak);
      this._note(notes[i] * 2.001, notes[i] * 2.001, 'sine', when, dur * 0.7, peak * 0.25);
    }
  }

  /** Soft start pluck on game start. */
  _pluck() {
    if (this._ctx === null) return;
    const t = this._ctx.currentTime;
    this._note(261.63, 523.25, 'triangle', t, 0.25, 0.15);
  }
}
