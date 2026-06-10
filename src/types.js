/**
 * @file types.js — THE parallel-work contract file.
 *
 * ALL cross-module JSDoc typedefs live here. NO RUNTIME CODE (tooling only,
 * zero runtime cost). Every other module imports these types via:
 *
 *   /** @typedef {import('../types.js').BallState} BallState *\/
 *
 * Any change to this file must go through the lead (Phase 0 owner).
 * See docs/DESIGN.md §モジュール間インターフェース for the binding v1 spec and
 * docs/DESIGN-V2.md §インターフェース for the binding v2 delta (moon update).
 */

/* ------------------------------------------------------------------ */
/* Config shapes                                                       */
/* ------------------------------------------------------------------ */

/**
 * One scale tier (config/tiers.js). tierIndex drives ONLY cosmetics and
 * spawn-content selection — never physics/camera/fog math (those are
 * continuous functions of ball radius; see DESIGN.md SEAMLESSNESS LAW).
 *
 * v2: per-tier SKY PARAMS (sun/moon/stars/clouds) ride the existing
 * environment palette crossfade — still cosmetic-only. The env-local NIGHT
 * palette (finale ascension) is NOT a tier; tiers.js keeps exactly 6 entries.
 *
 * @typedef {Object} Tier
 * @property {number}   index           0..5 (Desk..Skyline).
 * @property {string}   name            Display name for HUD banner.
 * @property {number}   enterTrueRadius Real-meter ball radius at which this tier begins.
 * @property {number}   cellSizeSim     Chunk/spatial-hash cell size in sim units (this tier's native scale, i.e. when it is the CURRENT tier).
 * @property {number}   loadRadiusSim   Chunk load radius in sim units when this tier is the target (N) band.
 * @property {number}   objectsPerChunk Placements per chunk when this tier is the target band.
 * @property {string[]} archetypeIds    Exactly ARCH_PER_TIER (10) catalog ids (frozen — config/catalog.js must implement these). Slots [8],[9] are LANDMARKS (landmark eligibility rule: archRoll over all 10 ONLY at placement j === 0 of a chunk).
 * @property {number}   fogColor        Hex color for fog while this tier is current.
 * @property {number}   skyTop          Hex color, sky-dome gradient top.
 * @property {number}   skyBottom       Hex color, sky-dome gradient bottom.
 * @property {number[]} sunDir          [x,y,z] sky-dome sun direction (normalized by env at build).
 * @property {number}   sunIntensity    Sun disc + glare lobe strength (0..~1.2).
 * @property {number[]} moonDir         [x,y,z] sky-dome moon direction. POST-normalization elevation asin(y/|v|) >= MOON_DIR_MIN_ELEV (0.15 rad), asserted in tiers.js.
 * @property {number}   moonAngSize     Moon angular RADIUS in radians (grows per tier — the moon visibly approaches).
 * @property {number}   starIntensity   Star sparkle gate 0..1 (NIGHT palette uses 1.0 env-locally).
 * @property {number}   cloudDensity    Analytic cloud coverage 0..1 (0 = clear).
 * @property {number}   cloudHex        Hex tint for the cloud layer.
 */

/**
 * One spawnable object archetype (config/catalog.js).
 * v2: 60 total = ARCH_PER_TIER (10) per tier x 6 tiers (slots 8/9 = landmarks).
 *
 * @typedef {Object} Archetype
 * @property {string}  id              Unique id, lowercase snake_case (must match Tier.archetypeIds).
 * @property {number}  tier            Home tier index 0..5.
 * @property {(rng: () => number) => import('three').BufferGeometry} buildGeometry
 *   Builds the merged, vertex-colored composite geometry (<=350 tris). Called once at boot.
 * @property {number}   radiusNominal  Nominal bounding-sphere radius in REAL METERS.
 * @property {number}   radiusJitter   Fractional size jitter, e.g. 0.25 = +-25%.
 * @property {number}   spawnWeight    Relative weighted-pick weight within its tier.
 * @property {number[]} palette        4-6 hex tints applied via instanceColor.
 * @property {number}   yOffset        Rest height offset as a fraction of radius (0 = sphere sits on ground).
 * @property {boolean}  upright        True = yaw-only random rotation; false = free tumble.
 * @property {number}   collisionScale Collision-radius fudge for long/flat objects (benches, buses); 1 = exact.
 */

/* ------------------------------------------------------------------ */
/* Live state shapes                                                   */
/* ------------------------------------------------------------------ */

/**
 * Single source of ball truth (physics/ballPhysics.js owns and mutates it).
 * All values in SIM UNITS / sim space. trueRadius = radiusSim * worldScale.
 *
 * @typedef {Object} BallState
 * @property {import('three').Vector3}    pos             Center position, sim units. y springs to radiusSim.
 * @property {import('three').Vector3}    vel             Linear velocity, sim units/s.
 * @property {import('three').Quaternion} quat            Rolling orientation (rolling without slipping).
 * @property {number} radiusSim        Physics radius, lives in [SIM_RADIUS_MIN, SIM_RADIUS_MAX] = [0.5, 2.5].
 * @property {number} radiusVisualSim  Display radius, slewed toward radiusSim at <= RADIUS_SLEW_K * r per second.
 * @property {number} sluggish         Transient accel multiplier in (0,1]; *= SLUGGISH_FACTOR per absorb, recovers over SLUGGISH_RECOVERY_S.
 * @property {number} dashGauge01      Dash charge 0..1 (starts 1.0); +dt/DASH_RECHARGE_S, +DASH_ABSORB_GAIN per absorb. Dimensionless => rescale-invariant.
 * @property {number} dashTimer        Seconds of dash burst remaining (DASH_DURATION_S on trigger; cap/accel multiplied while > 0).
 */

/**
 * Normalized player input (input/input.js). Camera-relative mapping is applied
 * in ballPhysics, NOT here (keeps the touch path rewrite-free).
 *
 * @typedef {Object} Intent
 * @property {number}  x     Strafe axis in [-1, 1].
 * @property {number}  y     Forward axis in [-1, 1].
 * @property {boolean} boost Boost held (Shift / second touch): ballPhysics applies BOOST_ACCEL_MUL / BOOST_CAP_MUL.
 * @property {boolean} dash  Edge-latched dash request (Space keydown / #dash-button pointerdown); true for exactly ONE input.read(), consumed on read.
 */

/**
 * One stuck-on-ball object record (render/ball.js). Written ONCE at attach,
 * in ball-local space; never updated per frame.
 *
 * @typedef {Object} StuckRecord
 * @property {number} archetypeFamily Index of the stuck InstancedMesh family (0..7; v2 landmark slots fold onto proxy families 0/1 via (code % ARCH_PER_TIER) & 7).
 * @property {number} slot            Instance slot inside that family's stuck pool.
 * @property {number} attachRadiusSim Ball simRadius at the moment of attach (ball-local; rides ballGroup.scale).
 * @property {number} objHalfSim      Object half-size in the same ball-local sim frame (for burial cull test).
 * @property {'animating'|'live'|'culled'} stage Lifecycle stage.
 */

/**
 * A knocked-off stuck object re-entering the world as a re-absorbable
 * instance. Returned by ball.knockOff(n); spawner re-injects them.
 * v2: reinject NEVER sets FLAG_RARE (score credit was granted at absorb).
 *
 * @typedef {Object} WorldReentry
 * @property {string} archetypeId Catalog id to respawn as.
 * @property {number} radiusSim   Bounding radius in CURRENT sim units.
 * @property {import('three').Vector3} pos Sim-space ejection position (ballistic pop start).
 * @property {import('three').Vector3} vel Sim-space ejection velocity.
 */

/**
 * One persisted best record line (game/runStats.js, localStorage LS_BEST_KEY,
 * schema {v:1, bestTime:BestRecord|null, bestScore:BestRecord|null}).
 * Each sub-record is replaced ATOMICALLY when its metric improves — fields
 * within one record are always from the same run (no field mixing).
 *
 * @typedef {Object} BestRecord
 * @property {number} timeS Clear time in SIM seconds.
 * @property {number} score Final score (incl. moon + time bonuses).
 * @property {string} rank  'S'|'A'|'B'|'C'|'D'.
 * @property {number} seed  World seed (uint32) of the run.
 */

/* ------------------------------------------------------------------ */
/* Event bus payload shapes (core/events.js)                           */
/* ------------------------------------------------------------------ */
/* Payloads are REUSED module-level objects: read-only in handlers,    */
/* never retained across frames. The exhaustive name list is EVT in    */
/* core/events.js; the reusable instances are PAYLOADS there.          */

/** 'game:start' — title screen dismissed. @typedef {Object} GameStartEvent */

/** 'game:reset' — restart requested from win screen. @typedef {Object} GameResetEvent */

/**
 * 'game:win' — v2: emitted by MAIN.JS when finale.state === 'done'
 * (was ScaleManager's WIN_RADIUS_M latch in v1; payload unchanged).
 * @typedef {Object} GameWinEvent
 * @property {number} trueRadius Final ball radius in real meters.
 * @property {number} seed       World seed (uint32) for shareable runs.
 */

/**
 * 'absorb' — an object was absorbed. -> main attach-handler, runStats, hud,
 * sfx, effects (BINDING subscription order: main -> runStats -> sfx/effects/hud).
 * @typedef {Object} AbsorbEvent
 * @property {number} objIndex    ObjectStore index that was consumed (already freed; do not deref next frame).
 * @property {string} archetypeId Catalog id of the absorbed object.
 * @property {number} sizeReal    Object diameter in real meters (for HUD ticker).
 * @property {number} combo       Current rapid-absorb combo count (resets after COMBO_WINDOW_S).
 * @property {number} trueRadius  Ball radius in real meters AFTER the absorb.
 * @property {number} count       Total objects absorbed this run.
 * @property {boolean} rare       v2: absorb.js stamps (store.flags[i] & FLAG_RARE) !== 0 BEFORE store.free.
 */

/**
 * 'grow' — throttled ~10Hz -> hud odometer + dash gauge fill.
 * @typedef {Object} GrowEvent
 * @property {number} trueRadius           Real meters.
 * @property {number} simRadius            Sim units.
 * @property {number} progress01ToNextTier 0..1 progress within current tier band.
 * @property {number} dashGauge01          v2: copied from BallState.dashGauge01 by ScaleManager at the 10Hz emit.
 */

/**
 * 'bounce' — pushback off a too-big object. -> cameraRig shake, sfx clonk.
 * @typedef {Object} BounceEvent
 * @property {number} impactSpeed01 Impact speed normalized by speedCap, 0..1.
 */

/**
 * 'knockOff' — hard bonk ejected stuck objects. -> effects, sfx.
 * @typedef {Object} KnockOffEvent
 * @property {number} count How many stuck objects were ejected (1..3).
 */

/**
 * 'tierUp' — tierIndex incremented. COSMETIC ONLY (FOV kick, banner,
 * palette fade, arpeggio, sparkle ring; v2: + bgm layer unlock, backdrop
 * profile crossfade). Gameplay never branches on it.
 * @typedef {Object} TierUpEvent
 * @property {number} tierIndex  New tier index.
 * @property {string} name       New tier display name.
 * @property {number} trueRadius Ball radius in real meters at the moment of tier-up.
 */

/**
 * 'rescale' — one-frame similarity rescale happened (debug overlay; v2: also
 * finale._simCache *= S — finale.js subscribes itself).
 * @typedef {Object} RescaleEvent
 * @property {number} S Similarity factor applied (RESCALE_S = 0.2).
 */

/**
 * 'frameStats' — dev builds only -> debug overlay.
 * @typedef {Object} FrameStatsEvent
 * @property {number} ms        Last frame CPU ms.
 * @property {number} drawCalls renderer.info.render.calls.
 * @property {number} tris      renderer.info.render.triangles.
 * @property {number} alive     ObjectStore alive count.
 */

/* ------------------------------------------------------------------ */
/* v2 event payload shapes (moon update — see docs/DESIGN-V2.md)       */
/* ------------------------------------------------------------------ */

/**
 * 'dash' — dash impulse fired (ballPhysics). -> cameraRig FOV kick, effects
 * speed-line burst, sfx whoosh, hud gauge zero.
 * @typedef {Object} DashEvent
 * @property {number} gauge01 Gauge value after the trigger (0).
 */

/**
 * 'dashReady' — gauge crossed 1.0, once per refill (ballPhysics, the SINGLE
 * emitter — absorb.js only adds gauge, never emits). -> hud flash, sfx chime.
 * @typedef {Object} DashReadyEvent
 */

/**
 * 'score' — score changed (game/runStats.js on each absorb). -> hud score
 * panel + floating '+N', sfx rare gliss when rare.
 * @typedef {Object} ScoreEvent
 * @property {number}  score Total score after the delta.
 * @property {number}  delta Points just gained (combo + rare bonus included).
 * @property {number}  combo Combo count used for the multiplier.
 * @property {boolean} rare  This absorb was a rare (RARE_SCORE_BONUS applied).
 */

/**
 * 'time' — sim clock crossed the next 0.1s boundary (game/runStats.js;
 * SIM time, never performance.now). -> hud #timer mm:ss.t.
 * @typedef {Object} TimeEvent
 * @property {number} timeS Elapsed simulated seconds.
 */

/**
 * 'moonCall' — trueRadius crossed MOON_CALL_RADIUS_M, once (game/finale.js).
 * -> hud toast 「月が呼んでいる…！」, env sky-moon pulse, bgm shimmer swell, sfx pad.
 * @typedef {Object} MoonCallEvent
 * @property {number} trueRadius Ball radius in real meters at the call.
 */

/**
 * 'moonGuide' — moon screen-position guide, 10Hz during DESCENT/LANDED plus
 * one final {active:false} on CONTACT (game/finale.js). -> hud #moon-arrow.
 * @typedef {Object} MoonGuideEvent
 * @property {number}  x01      Moon center NDC x mapped to 0..1 (clamped).
 * @property {number}  y01      Moon center NDC y mapped to 0..1 (clamped, 0 = top).
 * @property {boolean} onScreen Moon center is inside the frustum.
 * @property {boolean} active   Guide visible; false = hide the arrow.
 */

/**
 * 'moonContact' — ball touched the landed moon = CLEAR TIME instant, once
 * (game/finale.js). -> runStats (freeze + GOAL), bgm duck->stop, sfx grand
 * fanfare, hud hide, screens flash. From this frame finale.inputLocked and
 * finale.cameraOwned are true.
 * @typedef {Object} MoonContactEvent
 */

/**
 * 'goal' — final results computed + best persisted, once (game/runStats.js,
 * synchronously inside the MOON_CONTACT dispatch). -> screens caches a COPY
 * and prebuilds the X intent URL.
 * @typedef {Object} GoalEvent
 * @property {number}  timeS          Clear time, sim seconds.
 * @property {number}  score          Final score incl. MOON_SCORE_BONUS + time bonus.
 * @property {string}  rank           'S'|'A'|'B'|'C'|'D' (RANK_*_S thresholds).
 * @property {number}  trueRadius     Final ball radius in real meters.
 * @property {number}  absorbed       Total objects absorbed this run.
 * @property {number}  raresFound     Rare objects absorbed this run.
 * @property {number}  seed           World seed (uint32).
 * @property {boolean} newRecordTime  bestTime record was replaced this run.
 * @property {boolean} newRecordScore bestScore record was replaced this run.
 */

/**
 * 'ui:muteRequest' — hud mute button clicked. -> main.js (single mute owner).
 * @typedef {Object} MuteRequestEvent
 */

/**
 * 'muteChanged' — mute state toggled + persisted by main.js. -> hud icon,
 * (bgm/sfx are called directly by main via setMuted, not via this event).
 * @typedef {Object} MuteChangedEvent
 * @property {boolean} muted New mute state.
 */

// Make this file an ES module so typedefs are importable via import('./types.js').X
export {};
