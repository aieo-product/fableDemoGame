/**
 * @file events.js — Tiny pub/sub bus with REUSED payload objects.
 *
 * The ONLY cross-module channel besides constructor injection. Zero-allocation
 * discipline: emitters mutate the matching pre-allocated object in PAYLOADS
 * and pass it to emit(); handlers treat payloads as READ-ONLY and must never
 * retain them (the same object is reused on the next emit).
 *
 * Contract (exhaustive — see src/types.js for payload typedefs):
 *   'game:start' {}   'game:reset' {}   'game:win' {trueRadius, seed}
 *   'absorb'   {objIndex, archetypeId, sizeReal, combo, trueRadius, count}
 *   'grow'     {trueRadius, simRadius, progress01ToNextTier}    (throttled 10Hz)
 *   'bounce'   {impactSpeed01}
 *   'knockOff' {count}
 *   'tierUp'   {tierIndex, name, trueRadius}                    (COSMETIC ONLY)
 *   'rescale'  {S}
 *   'rebase'   {sx, sz}   (floating-origin shift subtracted from the world)
 *   'frameStats' {ms, drawCalls, tris, alive}                   (dev builds)
 */

/** Frozen event-name constants — always use these, never string literals. */
export const EVT = Object.freeze({
  GAME_START: 'game:start',
  GAME_RESET: 'game:reset',
  GAME_WIN: 'game:win',
  ABSORB: 'absorb',
  GROW: 'grow',
  BOUNCE: 'bounce',
  KNOCK_OFF: 'knockOff',
  TIER_UP: 'tierUp',
  RESCALE: 'rescale',
  REBASE: 'rebase',
  FRAME_STATS: 'frameStats',
});

/**
 * Pre-allocated, reused payload objects — one per event type. Emitters write
 * fields then call bus.emit(EVT.X, PAYLOADS.x). NEVER allocate payloads in
 * per-frame code. (Shapes mirror the typedefs in src/types.js.)
 */
export const PAYLOADS = {
  /** @type {import('../types.js').GameStartEvent} */
  gameStart: {},
  /** @type {import('../types.js').GameResetEvent} */
  gameReset: {},
  /** @type {import('../types.js').GameWinEvent} */
  gameWin: { trueRadius: 0, seed: 0 },
  /** @type {import('../types.js').AbsorbEvent} */
  absorb: { objIndex: 0, archetypeId: '', sizeReal: 0, combo: 0, trueRadius: 0, count: 0 },
  /** @type {import('../types.js').GrowEvent} */
  grow: { trueRadius: 0, simRadius: 0, progress01ToNextTier: 0 },
  /** @type {import('../types.js').BounceEvent} */
  bounce: { impactSpeed01: 0 },
  /** @type {import('../types.js').KnockOffEvent} */
  knockOff: { count: 0 },
  /** @type {import('../types.js').TierUpEvent} */
  tierUp: { tierIndex: 0, name: '', trueRadius: 0 },
  /** @type {import('../types.js').RescaleEvent} */
  rescale: { S: 0 },
  /** @type {{sx: number, sz: number}} Floating-origin rebase shift (integer-snapped sim units). */
  rebase: { sx: 0, sz: 0 },
  /** @type {import('../types.js').FrameStatsEvent} */
  frameStats: { ms: 0, drawCalls: 0, tris: 0, alive: 0 },
};

/**
 * Minimal synchronous pub/sub. Handlers are invoked in subscription order.
 * NOTE: do not on()/off() the SAME event from inside one of its handlers
 * during dispatch (takes effect immediately and may skip/repeat — none of
 * our subscribers need this; subscribe once at boot).
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._handlers = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} name Event name (use EVT constants).
   * @param {(payload: object) => void} handler Receives the REUSED payload — read-only, never retain.
   * @returns {(payload: object) => void} The handler (for symmetric off()).
   */
  on(name, handler) {
    let arr = this._handlers.get(name);
    if (arr === undefined) {
      arr = [];
      this._handlers.set(name, arr);
    }
    arr.push(handler);
    return handler;
  }

  /**
   * Unsubscribe a handler.
   * @param {string} name Event name.
   * @param {(payload: object) => void} handler Previously registered handler.
   */
  off(name, handler) {
    const arr = this._handlers.get(name);
    if (arr === undefined) return;
    const idx = arr.indexOf(handler);
    if (idx !== -1) arr.splice(idx, 1);
  }

  /**
   * Emit an event synchronously. Zero allocation: plain indexed loop, no
   * snapshot, no spread, no arguments juggling.
   * @param {string} name Event name (use EVT constants).
   * @param {object} [payload] The matching PAYLOADS object (mutated in place by the emitter).
   */
  emit(name, payload) {
    const arr = this._handlers.get(name);
    if (arr === undefined) return;
    for (let i = 0; i < arr.length; i++) {
      arr[i](payload);
    }
  }
}

/** The single shared bus instance — inject this everywhere (one bus per game). */
export const bus = new EventBus();
