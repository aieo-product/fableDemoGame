/**
 * @file runStats.js — v2 run clock, score/combo/rare accounting, rank,
 * localStorage best records, and the single 'goal' emission
 * (docs/DESIGN-V2.md §ゲームシステム).
 *
 * SIM-TIME IS THE OFFICIAL CLOCK: main.js calls addSimTime(steps * FIXED_DT)
 * once per render frame (frame step 6.5) — deterministic, naturally paused in
 * TITLE/WIN, frozen by an internal flag on 'moonContact'. Slow devices
 * simulate slower in wall time but ranks stay deterministic and fair per
 * simulated second. 'time' {timeS} is emitted whenever timeS crosses the next
 * 0.1 s SIM boundary (never performance.now) -> HUD mm:ss.t.
 *
 * SCORE (on 'absorb' — BINDING subscription order at boot: main
 * attach-handler -> THIS -> sfx/effects/hud):
 *   objScore = max(1, round(SCORE_SIZE_BASE * sizeReal^SCORE_SIZE_POW))
 *   comboMul = min(1 + COMBO_SCORE_K * (combo - 1), COMBO_SCORE_MAX_MUL)
 *   delta    = round(objScore * comboMul) + (rare ? RARE_SCORE_BONUS : 0)
 * then 'score' {score, delta, combo, rare} is emitted (reused payload).
 *
 * GOAL FLOW (on 'moonContact', once): freeze the clock, add MOON_SCORE_BONUS
 * + timeBonus = round(lerp(TIME_BONUS_MAX, 0, clamp01((timeS - FULL) /
 * (ZERO - FULL)))), rank S/A/B/C/D by RANK_*_S, persist bests to localStorage
 * LS_BEST_KEY (schema {v:1, bestTime:BestRecord|null, bestScore:BestRecord|
 * null} — each sub-record replaced ATOMICALLY when its metric improves, so
 * fields within one record always come from the same run), emit 'goal' once.
 *
 * Persistence is fully try/catch-wrapped (private-mode / quota / no-DOM safe)
 * and loadBest() returns null on ANY anomaly (parse error, wrong version,
 * malformed records). Zero per-frame allocation: the hot paths (addSimTime,
 * the absorb handler) are arithmetic + reused PAYLOADS only; the goal path
 * runs once per run and may allocate freely.
 */

import {
  SCORE_SIZE_BASE,
  SCORE_SIZE_POW,
  COMBO_SCORE_K,
  COMBO_SCORE_MAX_MUL,
  RARE_SCORE_BONUS,
  MOON_SCORE_BONUS,
  TIME_BONUS_MAX,
  TIME_BONUS_FULL_S,
  TIME_BONUS_ZERO_S,
  RANK_S_S,
  RANK_A_S,
  RANK_B_S,
  RANK_C_S,
  LS_BEST_KEY,
} from '../config/tuning.js';
import { EVT, PAYLOADS } from '../core/events.js';

/** @typedef {import('../types.js').BestRecord} BestRecord */
/** @typedef {import('../types.js').AbsorbEvent} AbsorbEvent */

/** Valid rank letters (loadBest validation). */
const RANKS = 'SABCD';

/**
 * Validate one persisted best record.
 * @param {*} r Candidate from JSON.parse.
 * @returns {BestRecord|null|undefined} Normalized record, null (legitimately
 *   absent), or undefined when MALFORMED (caller treats the whole blob as bad).
 */
function validateRecord(r) {
  if (r === null || r === undefined) return null;
  if (typeof r !== 'object') return undefined;
  if (typeof r.timeS !== 'number' || !Number.isFinite(r.timeS) || r.timeS < 0) return undefined;
  if (typeof r.score !== 'number' || !Number.isFinite(r.score)) return undefined;
  if (typeof r.rank !== 'string' || r.rank.length !== 1 || RANKS.indexOf(r.rank) === -1) {
    return undefined;
  }
  if (typeof r.seed !== 'number' || !Number.isFinite(r.seed)) return undefined;
  return { timeS: r.timeS, score: r.score, rank: r.rank, seed: r.seed >>> 0 };
}

/**
 * Run statistics: sim clock, score, rares, rank, best persistence, 'goal'.
 *
 * Construction order is BINDING: main.js constructs this AFTER its own
 * 'absorb' attach-handler subscription and BEFORE sfx/effects/hud, so the
 * 'score' emit (synchronous, inside the 'absorb' dispatch) is observed by the
 * cosmetic consumers in the frozen order.
 */
export class RunStats {
  /**
   * @param {import('../core/events.js').EventBus} bus Shared event bus.
   * @param {{ trueRadiusMeters?: () => number }} [scaleMgr] ScaleManager —
   *   read once at goal for the final trueRadius. Optional (headless tests
   *   fall back to the last AbsorbEvent.trueRadius).
   * @param {number} [worldSeed] uint32 world seed (stamped onto 'goal' + bests).
   */
  constructor(bus, scaleMgr, worldSeed = 0) {
    /** @type {import('../core/events.js').EventBus} */
    this._bus = bus;
    /** @type {{ trueRadiusMeters?: () => number }|null} */
    this._scaleMgr = scaleMgr || null;
    /** @type {number} uint32 world seed. */
    this._seed = worldSeed >>> 0;

    /** @type {number} Elapsed SIM seconds (the official clock). */
    this._timeS = 0;
    /** @type {number} Last 0.1s boundary index reported via 'time'. */
    this._lastTenth = 0;
    /** @type {boolean} Clock + score frozen (after 'moonContact'). */
    this._frozen = false;
    /** @type {boolean} 'goal' emitted (once-per-run latch). */
    this._goalEmitted = false;

    /** @type {number} Total score (combo + rare + goal bonuses included). */
    this._score = 0;
    /** @type {number} Total objects absorbed this run. */
    this._absorbed = 0;
    /** @type {number} Rare objects absorbed this run. */
    this._raresFound = 0;
    /** @type {number} Last seen trueRadius (m) — goal fallback when no scaleMgr. */
    this._lastTrueRadius = 0;

    bus.on(EVT.ABSORB, this._onAbsorb.bind(this));
    bus.on(EVT.MOON_CONTACT, this._onMoonContact.bind(this));
  }

  /* ---------------------------------------------------------------- */
  /* Read-only accessors                                               */
  /* ---------------------------------------------------------------- */

  /** Elapsed sim seconds (frozen after contact). @returns {number} */
  get timeS() {
    return this._timeS;
  }

  /** Current total score. @returns {number} */
  get score() {
    return this._score;
  }

  /** Objects absorbed this run. @returns {number} */
  get absorbed() {
    return this._absorbed;
  }

  /** Rares absorbed this run. @returns {number} */
  get raresFound() {
    return this._raresFound;
  }

  /* ---------------------------------------------------------------- */
  /* Sim clock (main.js frame step 6.5)                                */
  /* ---------------------------------------------------------------- */

  /**
   * Accumulate simulated time and emit 'time' when a 0.1s sim boundary is
   * crossed. A frame adds at most MAX_SUBSTEPS * FIXED_DT = 0.05s, so at most
   * one boundary per call in practice (a larger jump still emits exactly one
   * 'time' carrying the latest timeS — the HUD only displays it).
   * @param {number} s Simulated seconds advanced this frame (steps * FIXED_DT).
   */
  addSimTime(s) {
    if (this._frozen || !(s > 0)) return;
    this._timeS += s;
    const tenth = Math.floor(this._timeS * 10);
    if (tenth !== this._lastTenth) {
      this._lastTenth = tenth;
      PAYLOADS.time.timeS = this._timeS;
      this._bus.emit(EVT.TIME, PAYLOADS.time);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Score accounting ('absorb' handler — hot path, zero allocation)   */
  /* ---------------------------------------------------------------- */

  /**
   * @param {AbsorbEvent} p Reused payload (read-only, not retained).
   */
  _onAbsorb(p) {
    if (this._frozen) return; // post-contact absorbs are impossible by gating, belt-and-suspenders
    const objScore = Math.max(1, Math.round(SCORE_SIZE_BASE * Math.pow(p.sizeReal, SCORE_SIZE_POW)));
    let comboMul = 1 + COMBO_SCORE_K * (p.combo - 1);
    if (comboMul > COMBO_SCORE_MAX_MUL) comboMul = COMBO_SCORE_MAX_MUL;
    const rare = p.rare === true;
    const delta = Math.round(objScore * comboMul) + (rare ? RARE_SCORE_BONUS : 0);

    this._score += delta;
    this._absorbed = p.count;
    if (rare) this._raresFound++;
    this._lastTrueRadius = p.trueRadius;

    const sp = PAYLOADS.score;
    sp.score = this._score;
    sp.delta = delta;
    sp.combo = p.combo;
    sp.rare = rare;
    this._bus.emit(EVT.SCORE, sp);
  }

  /* ---------------------------------------------------------------- */
  /* Goal ('moonContact' handler — once per run, may allocate)         */
  /* ---------------------------------------------------------------- */

  _onMoonContact() {
    if (this._goalEmitted) return;
    this._goalEmitted = true;
    this._frozen = true; // CLEAR TIME instant — clock + score freeze here

    const timeS = this._timeS;

    /* Bonuses: flat moon bonus + linear time bonus. */
    let u = (timeS - TIME_BONUS_FULL_S) / (TIME_BONUS_ZERO_S - TIME_BONUS_FULL_S);
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
    const timeBonus = Math.round(TIME_BONUS_MAX * (1 - u));
    this._score += MOON_SCORE_BONUS + timeBonus;

    /* Rank table (sim seconds). */
    const rank =
      timeS <= RANK_S_S ? 'S' : timeS <= RANK_A_S ? 'A' : timeS <= RANK_B_S ? 'B' : timeS <= RANK_C_S ? 'C' : 'D';

    const trueRadius =
      this._scaleMgr !== null && typeof this._scaleMgr.trueRadiusMeters === 'function'
        ? this._scaleMgr.trueRadiusMeters()
        : this._lastTrueRadius;

    /* Best records: each sub-record replaced ATOMICALLY when its metric
       improves — never mix fields across runs. */
    const prev = RunStats.loadBest();
    const bestTime = prev !== null ? prev.bestTime : null;
    const bestScore = prev !== null ? prev.bestScore : null;
    /** @type {BestRecord} */
    const rec = { timeS, score: this._score, rank, seed: this._seed };
    const newRecordTime = bestTime === null || timeS < bestTime.timeS;
    const newRecordScore = bestScore === null || this._score > bestScore.score;
    if (newRecordTime || newRecordScore) {
      const next = {
        v: 1,
        bestTime: newRecordTime ? rec : bestTime,
        bestScore: newRecordScore ? rec : bestScore,
      };
      try {
        localStorage.setItem(LS_BEST_KEY, JSON.stringify(next));
      } catch (_) {
        /* private mode / quota — records just don't persist */
      }
    }

    const g = PAYLOADS.goal;
    g.timeS = timeS;
    g.score = this._score;
    g.rank = rank;
    g.trueRadius = trueRadius;
    g.absorbed = this._absorbed;
    g.raresFound = this._raresFound;
    g.seed = this._seed;
    g.newRecordTime = newRecordTime;
    g.newRecordScore = newRecordScore;
    this._bus.emit(EVT.GOAL, g);
  }

  /* ---------------------------------------------------------------- */
  /* Reset (main.resetWorld — frozen reset-ownership table)            */
  /* ---------------------------------------------------------------- */

  /** Reset to a fresh run. Best records persist (localStorage, not run state). */
  reset() {
    this._timeS = 0;
    this._lastTenth = 0;
    this._frozen = false;
    this._goalEmitted = false;
    this._score = 0;
    this._absorbed = 0;
    this._raresFound = 0;
    this._lastTrueRadius = 0;
  }

  /* ---------------------------------------------------------------- */
  /* Persistence                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Load the persisted best records. Returns null on ANY anomaly: no storage
   * (private mode / headless), missing key, JSON parse error, wrong schema
   * version, or malformed record fields — callers need no try/catch.
   * @returns {{v: number, bestTime: BestRecord|null, bestScore: BestRecord|null}|null}
   */
  static loadBest() {
    try {
      const raw = localStorage.getItem(LS_BEST_KEY);
      if (typeof raw !== 'string') return null;
      const obj = JSON.parse(raw);
      if (obj === null || typeof obj !== 'object' || obj.v !== 1) return null;
      const bestTime = validateRecord(obj.bestTime);
      const bestScore = validateRecord(obj.bestScore);
      if (bestTime === undefined || bestScore === undefined) return null;
      return { v: 1, bestTime, bestScore };
    } catch (_) {
      return null;
    }
  }
}
