/**
 * @file types.js — THE parallel-work contract file.
 *
 * ALL cross-module JSDoc typedefs live here. NO RUNTIME CODE (tooling only,
 * zero runtime cost). Every other module imports these types via:
 *
 *   /** @typedef {import('../types.js').BallState} BallState *\/
 *
 * Any change to this file must go through the lead (Phase 0 owner).
 * See docs/DESIGN.md §モジュール間インターフェース for the binding spec.
 */

/* ------------------------------------------------------------------ */
/* Config shapes                                                       */
/* ------------------------------------------------------------------ */

/**
 * One scale tier (config/tiers.js). tierIndex drives ONLY cosmetics and
 * spawn-content selection — never physics/camera/fog math (those are
 * continuous functions of ball radius; see DESIGN.md SEAMLESSNESS LAW).
 *
 * @typedef {Object} Tier
 * @property {number}   index           0..5 (Desk..Skyline).
 * @property {string}   name            Display name for HUD banner.
 * @property {number}   enterTrueRadius Real-meter ball radius at which this tier begins.
 * @property {number}   cellSizeSim     Chunk/spatial-hash cell size in sim units (this tier's native scale, i.e. when it is the CURRENT tier).
 * @property {number}   loadRadiusSim   Chunk load radius in sim units when this tier is the target (N) band.
 * @property {number}   objectsPerChunk Placements per chunk when this tier is the target band.
 * @property {string[]} archetypeIds    Exactly 8 catalog ids (frozen — config/catalog.js must implement these).
 * @property {number}   fogColor        Hex color for fog while this tier is current.
 * @property {number}   skyTop          Hex color, sky-dome gradient top.
 * @property {number}   skyBottom       Hex color, sky-dome gradient bottom.
 */

/**
 * One spawnable object archetype (config/catalog.js). 48 total = 8 per tier x 6 tiers.
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
 */

/**
 * Normalized player input (input/input.js). Camera-relative mapping is applied
 * in ballPhysics, NOT here (keeps the touch path rewrite-free).
 *
 * @typedef {Object} Intent
 * @property {number}  x     Strafe axis in [-1, 1].
 * @property {number}  y     Forward axis in [-1, 1].
 * @property {boolean} boost Reserved boost flag.
 */

/**
 * One stuck-on-ball object record (render/ball.js). Written ONCE at attach,
 * in ball-local space; never updated per frame.
 *
 * @typedef {Object} StuckRecord
 * @property {number} archetypeFamily Index of the stuck InstancedMesh family (0..7).
 * @property {number} slot            Instance slot inside that family's stuck pool.
 * @property {number} attachRadiusSim Ball simRadius at the moment of attach (ball-local; rides ballGroup.scale).
 * @property {number} objHalfSim      Object half-size in the same ball-local sim frame (for burial cull test).
 * @property {'animating'|'live'|'culled'} stage Lifecycle stage.
 */

/**
 * A knocked-off stuck object re-entering the world as a re-absorbable
 * instance. Returned by ball.knockOff(n); spawner re-injects them.
 *
 * @typedef {Object} WorldReentry
 * @property {string} archetypeId Catalog id to respawn as.
 * @property {number} radiusSim   Bounding radius in CURRENT sim units.
 * @property {import('three').Vector3} pos Sim-space ejection position (ballistic pop start).
 * @property {import('three').Vector3} vel Sim-space ejection velocity.
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
 * 'game:win' — trueRadius crossed WIN_RADIUS_M.
 * @typedef {Object} GameWinEvent
 * @property {number} trueRadius Final ball radius in real meters.
 * @property {number} seed       World seed (uint32) for shareable runs.
 */

/**
 * 'absorb' — an object was absorbed. -> hud, sfx, effects, ball core swirl.
 * @typedef {Object} AbsorbEvent
 * @property {number} objIndex    ObjectStore index that was consumed (already freed; do not deref next frame).
 * @property {string} archetypeId Catalog id of the absorbed object.
 * @property {number} sizeReal    Object diameter in real meters (for HUD ticker).
 * @property {number} combo       Current rapid-absorb combo count (resets after COMBO_WINDOW_S).
 * @property {number} trueRadius  Ball radius in real meters AFTER the absorb.
 * @property {number} count       Total objects absorbed this run.
 */

/**
 * 'grow' — throttled ~10Hz -> hud odometer.
 * @typedef {Object} GrowEvent
 * @property {number} trueRadius           Real meters.
 * @property {number} simRadius            Sim units.
 * @property {number} progress01ToNextTier 0..1 progress within current tier band.
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
 * palette fade, arpeggio, sparkle ring). Gameplay never branches on it.
 * @typedef {Object} TierUpEvent
 * @property {number} tierIndex  New tier index.
 * @property {string} name       New tier display name.
 * @property {number} trueRadius Ball radius in real meters at the moment of tier-up.
 */

/**
 * 'rescale' — one-frame similarity rescale happened (debug overlay only;
 * all systems are handled synchronously inside ScaleManager — visually a no-op).
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

// Make this file an ES module so typedefs are importable via import('./types.js').X
export {};
