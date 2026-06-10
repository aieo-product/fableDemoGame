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
 *   'absorb'   {objIndex, archetypeId, sizeReal, combo, trueRadius, count, rare}
 *   'grow'     {trueRadius, simRadius, progress01ToNextTier, dashGauge01} (throttled 10Hz)
 *   'bounce'   {impactSpeed01}
 *   'knockOff' {count}
 *   'tierUp'   {tierIndex, name, trueRadius}                    (COSMETIC ONLY)
 *   'rescale'  {S}
 *   'rebase'   {sx, sz}   (floating-origin shift subtracted from the world)
 *   'frameStats' {ms, drawCalls, tris, alive}                   (dev builds)
 *   ---- v2 (moon update — docs/DESIGN-V2.md §インターフェース) ----
 *   'dash'        {gauge01}                       (ballPhysics -> cameraRig kick, effects burst, sfx whoosh, hud zero)
 *   'dashReady'   {}                              (ballPhysics, once per refill -> hud flash, sfx chime)
 *   'score'       {score, delta, combo, rare}     (runStats -> hud, sfx when rare)
 *   'time'        {timeS}                         (runStats, on 0.1s SIM-boundary -> hud)
 *   'moonCall'    {trueRadius}                    (finale once -> hud toast, env pulse, bgm swell, sfx pad)
 *   'moonGuide'   {x01, y01, onScreen, active}    (finale 10Hz during DESCENT/LANDED, +one active:false on CONTACT -> hud arrow)
 *   'moonContact' {}                              (finale once = run end -> runStats freeze+GOAL, bgm duck, sfx fanfare, hud hide, screens flash)
 *   'goal'        {timeS, score, rank, trueRadius, absorbed, raresFound, seed, newRecordTime, newRecordScore} (runStats once -> screens cache + X URL build)
 *   'ui:muteRequest' {}                           (hud -> main, the single mute owner)
 *   'muteChanged' {muted}                         (main -> hud icon)
 *
 * v2 CONTRACT NOTES (binding):
 *  - ABSORB subscription order at boot: spawner -> main attach-handler ->
 *    runStats -> sfx/effects/hud (handlers run in subscription order; the
 *    Spawner constructor subscribes first — its handler is internal
 *    bookkeeping ONLY and must never mutate instanceSlot/archetype/position
 *    fields, which main's attach-handler reads intact; runStats must see
 *    the payload after main but before the cosmetic consumers).
 *  - 'game:win' is now emitted by MAIN.JS when finale.state === 'done'
 *    (was ScaleManager's WIN_RADIUS_M latch in v1; payload unchanged).
 *  - 'goal' fields must be COPIED by subscribers (payload is reused like all
 *    others; screens.js caches a field-by-field copy).
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
  // ---- v2 (moon update) ----
  DASH: 'dash',
  DASH_READY: 'dashReady',
  SCORE: 'score',
  TIME: 'time',
  MOON_CALL: 'moonCall',
  MOON_GUIDE: 'moonGuide',
  MOON_CONTACT: 'moonContact',
  GOAL: 'goal',
  MUTE_REQUEST: 'ui:muteRequest',
  MUTE_CHANGED: 'muteChanged',
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
  absorb: { objIndex: 0, archetypeId: '', sizeReal: 0, combo: 0, trueRadius: 0, count: 0, rare: false },
  /** @type {import('../types.js').GrowEvent} */
  grow: { trueRadius: 0, simRadius: 0, progress01ToNextTier: 0, dashGauge01: 1 },
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
  // ---- v2 (moon update) ----
  /** @type {import('../types.js').DashEvent} */
  dash: { gauge01: 0 },
  /** @type {import('../types.js').DashReadyEvent} */
  dashReady: {},
  /** @type {import('../types.js').ScoreEvent} */
  score: { score: 0, delta: 0, combo: 0, rare: false },
  /** @type {import('../types.js').TimeEvent} */
  time: { timeS: 0 },
  /** @type {import('../types.js').MoonCallEvent} */
  moonCall: { trueRadius: 0 },
  /** @type {import('../types.js').MoonGuideEvent} */
  moonGuide: { x01: 0, y01: 0, onScreen: false, active: false },
  /** @type {import('../types.js').MoonContactEvent} */
  moonContact: {},
  /** @type {import('../types.js').GoalEvent} */
  goal: {
    timeS: 0,
    score: 0,
    rank: '',
    trueRadius: 0,
    absorbed: 0,
    raresFound: 0,
    seed: 0,
    newRecordTime: false,
    newRecordScore: false,
  },
  /** @type {import('../types.js').MuteRequestEvent} */
  muteRequest: {},
  /** @type {import('../types.js').MuteChangedEvent} */
  muteChanged: { muted: false },
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
