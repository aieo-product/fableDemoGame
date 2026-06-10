/**
 * @file screens.js — Title / win / restart overlays + seed display.
 *
 * Owns the #title-overlay and #win-overlay DOM (frozen in index.html) and is
 * the ONLY emitter of 'game:start' and 'game:reset'. Overlay visibility is
 * driven by bus events (not directly by the clicks), so debug-key starts and
 * programmatic resets keep the DOM consistent for free:
 *
 *   #start-button click   -> emit game:start
 *   #restart-button click -> emit game:reset
 *   on game:start -> hide title + win
 *   on game:reset -> hide win, show title
 *   on game:win   -> fill #win-size / #win-seed, show win overlay
 *
 * NOTE for the integrator: main.js contains a TEMPORARY #start-button click
 * block ("TEMPORARY title wiring — REMOVE") — it must be deleted when this
 * module is wired, or game:start will double-emit.
 */

import { EVT, PAYLOADS } from '../core/events.js';
import { formatLength } from '../core/mathUtils.js';

/** @typedef {import('../core/events.js').EventBus} EventBus */
/** @typedef {import('../types.js').GameWinEvent} GameWinEvent */

/**
 * Title/win overlay controller and game:start / game:reset emitter.
 */
export class Screens {
  /**
   * @param {EventBus} bus The shared game event bus.
   * @param {number} worldSeed uint32 world seed (from resolveWorldSeed()) —
   *   shown on the win screen for shareable ?seed= runs; used as a fallback
   *   when the game:win payload carries no seed.
   */
  constructor(bus, worldSeed) {
    this._bus = bus;
    this._seed = worldSeed >>> 0;

    /* --- DOM refs (frozen ids in index.html) --- */
    this._titleEl = /** @type {HTMLElement} */ (document.getElementById('title-overlay'));
    this._winEl = /** @type {HTMLElement} */ (document.getElementById('win-overlay'));
    this._startBtn = /** @type {HTMLButtonElement} */ (document.getElementById('start-button'));
    this._restartBtn = /** @type {HTMLButtonElement} */ (document.getElementById('restart-button'));
    this._winSizeEl = /** @type {HTMLElement} */ (document.getElementById('win-size'));
    this._winSeedEl = /** @type {HTMLElement} */ (document.getElementById('win-seed'));

    /* --- prebound listeners --- */
    this._onStartClick = this._onStartClick.bind(this);
    this._onRestartClick = this._onRestartClick.bind(this);
    this._onGameStart = this._onGameStart.bind(this);
    this._onGameReset = this._onGameReset.bind(this);
    this._onGameWin = this._onGameWin.bind(this);

    this._startBtn.addEventListener('click', this._onStartClick);
    this._restartBtn.addEventListener('click', this._onRestartClick);

    /* Touch devices get touch controls guidance instead of the keyboard rows
       (the drag joystick is otherwise undiscoverable on phones). */
    const hints = document.getElementById('key-hints');
    if (hints !== null && typeof window !== 'undefined' && 'ontouchstart' in window) {
      hints.innerHTML =
        '<span><kbd>ドラッグ / Drag</kbd>うごく / Move</span>' +
        '<span><kbd>2本指 / 2nd finger</kbd>ブースト / Boost</span>';
    }

    bus.on(EVT.GAME_START, this._onGameStart);
    bus.on(EVT.GAME_RESET, this._onGameReset);
    bus.on(EVT.GAME_WIN, this._onGameWin);
  }

  /* ---------------------------------------------------------------- */
  /* Button handlers — emit only; visibility reacts to the bus          */
  /* ---------------------------------------------------------------- */

  /** START — title screen dismissed; the state machine takes it from here. */
  _onStartClick() {
    this._bus.emit(EVT.GAME_START, PAYLOADS.gameStart);
  }

  /**
   * ROLL AGAIN — the label promises an immediate replay, so emit reset THEN
   * start (well-ordered: reset rebuilds the world and shows the title, start
   * hides the overlays and play resumes in the freshly preloaded world).
   */
  _onRestartClick() {
    this._bus.emit(EVT.GAME_RESET, PAYLOADS.gameReset);
    this._bus.emit(EVT.GAME_START, PAYLOADS.gameStart);
  }

  /* ---------------------------------------------------------------- */
  /* Bus handlers (payloads are reused objects — read-only, no retain)  */
  /* ---------------------------------------------------------------- */

  /** 'game:start' — both overlays out of the way. */
  _onGameStart() {
    this._titleEl.classList.add('hidden');
    this._winEl.classList.add('hidden');
  }

  /** 'game:reset' — back to the title screen. */
  _onGameReset() {
    this._winEl.classList.add('hidden');
    this._titleEl.classList.remove('hidden');
  }

  /**
   * 'game:win' — fill the final size + shareable seed and show the overlay.
   * @param {GameWinEvent} p
   */
  _onGameWin(p) {
    const seed = p !== undefined && p.seed ? p.seed >>> 0 : this._seed;
    this._winSizeEl.textContent = formatLength(p !== undefined ? p.trueRadius : 0);
    this._winSeedEl.textContent = String(seed);
    this._winEl.classList.remove('hidden');
  }
}
