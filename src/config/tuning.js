/**
 * @file tuning.js — THE designer's file. Every feel constant in the game.
 *
 * All `*_K` constants are COEFFICIENTS OF BALL simRadius — the SEAMLESSNESS
 * LAW (DESIGN.md): absorbability, camera, fog, speed, despawn are continuous
 * functions of radius and NEVER reference tierIndex, so nothing can pop at a
 * threshold. Phase-3 tuning passes edit this file only.
 *
 * Units: sim = sim units, m = real meters, s = seconds.
 */

/* ================================================================== */
/* Scale system                                                        */
/* ================================================================== */

/** Lower edge of the ball's sim-radius band. simRadius lives in [MIN, MAX]. */
export const SIM_RADIUS_MIN = 0.5;
/** Upper edge — reaching it triggers the one-frame similarity rescale (S = RESCALE_S). */
export const SIM_RADIUS_MAX = 2.5;
/** Starting ball radius in real meters (5 cm — Desk tier). */
export const START_RADIUS_M = 0.05;
/* v2: WIN_RADIUS_M deleted — replaced by MOON_GOAL_RADIUS_M (finale owns the goal). */
/** Tier-index hysteresis (+-10% of enterTrueRadius) — guards float edge cases. */
export const TIER_HYSTERESIS = 0.10;
/** Floating-origin rebase when |ball.pos| exceeds this many sim units (integer-snapped shift). */
export const REBASE_DISTANCE_SIM = 1500;

/* ================================================================== */
/* v2 Moon goal / finale (game/finale.js, render/moon.js)              */
/* ================================================================== */

/** Finale CALLED state: emit 'moonCall' (toast + sky-moon pulse) at this true radius (m). */
export const MOON_CALL_RADIUS_M = 420;
/** Goal: finale DESCENT triggers at this true radius (m). Replaces WIN_RADIUS_M. */
export const MOON_GOAL_RADIUS_M = 500;
/** Real-moon radius = MOON_RADIUS_K * ball.radiusSim, FROZEN at descent start. */
export const MOON_RADIUS_K = 2.6;
/** Descent duration (s): MoonView lerps start pose -> landing, easeInOutCubic + 0.4s settle. */
export const MOON_DESCENT_S = 6.0;
/** Landing point = ballPos + dir * MOON_LAND_DIST_K * radiusSim. */
export const MOON_LAND_DIST_K = 45;
/** Landing dir = horizontal vel dir if |vel| >= frac * speedCap, else camera forward. */
export const MOON_LAND_VEL_FRAC = 0.5;
/** Min POST-normalization elevation (rad) of every tiers.js moonDir (asserted there). */
export const MOON_DIR_MIN_ELEV = 0.15;
/** Contact when dist(ball, moonCenter) <= ballR + moonR * MOON_CONTACT_PAD. */
export const MOON_CONTACT_PAD = 0.85;
/** LANDED soft magnet: vel += dirToMoon * frac * ACCEL_K * r * dt (bias only, never overrides input). */
export const MOON_MAGNET_ACCEL_FRAC = 0.15;
/** Magnet engages within MOON_MAGNET_RANGE_K * radiusSim of the moon center. */
export const MOON_MAGNET_RANGE_K = 20;
/** Contact white flash: 0.12s in, FLASH_S out (#flash-overlay). */
export const FLASH_S = 0.45;
/** MERGE: ball.pos lerps into the moon center over this (s); ball hidden at t >= 0.6s. */
export const MOON_MERGE_S = 1.2;
/** ASCENSION duration (s): moon rises ease-in while env.beginNightFade runs. */
export const MOON_ASCEND_S = 5.0;
/** Ascension target height = ascendBaseY + MOON_ASCEND_HEIGHT_K * radiusSim. */
export const MOON_ASCEND_HEIGHT_K = 40;
/** AFTERGLOW hang time (s) before finale.state === 'done' (main emits game:win). */
export const AFTERGLOW_S = 2.5;

/* ================================================================== */
/* v2 Dash (physics/ballPhysics.js, input/input.js)                    */
/* ================================================================== */

/** Gauge recharge: dashGauge01 += dt / DASH_RECHARGE_S (clamped 1; 'dashReady' on crossing). */
export const DASH_RECHARGE_S = 4.0;
/** Gauge gain per absorb (absorb.js, clamped 1; 'dashReady' edge stays in ballPhysics). */
export const DASH_ABSORB_GAIN = 0.03;
/** Dash burst duration (s) — cap/accel multipliers apply while dashTimer > 0. */
export const DASH_DURATION_S = 0.8;
/** Speed-cap multiplier while dashing. */
export const DASH_CAP_MUL = 2.2;
/** Acceleration multiplier while dashing. */
export const DASH_ACCEL_MUL = 1.8;
/** Dash impulse: vel += dir * DASH_IMPULSE_K * radiusSim. */
export const DASH_IMPULSE_K = 7.0;
/** Impulse dir = horizontal vel dir if |vel| >= frac * speedCap, else camera forward. */
export const DASH_DIR_SPEED_K = 0.3;
/** cameraRig additive FOV kick on 'dash' (deg, decays over DASH_DURATION_S). */
export const DASH_FOV_BONUS = 8;

/* ================================================================== */
/* v2 Score / rank (game/runStats.js)                                  */
/* ================================================================== */

/** Per-object score = max(1, round(SCORE_SIZE_BASE * sizeReal^SCORE_SIZE_POW)). */
export const SCORE_SIZE_BASE = 100;
export const SCORE_SIZE_POW = 1.4;
/** Combo multiplier = min(1 + COMBO_SCORE_K * (combo - 1), COMBO_SCORE_MAX_MUL). */
export const COMBO_SCORE_K = 0.10;
export const COMBO_SCORE_MAX_MUL = 3.0;
/** Flat bonus added when AbsorbEvent.rare (after combo multiplication). */
export const RARE_SCORE_BONUS = 5000;
/** Flat bonus on 'moonContact'. */
export const MOON_SCORE_BONUS = 20000;
/** Time bonus = round(lerp(TIME_BONUS_MAX, 0, clamp01((timeS - FULL) / (ZERO - FULL)))). */
export const TIME_BONUS_MAX = 30000;
export const TIME_BONUS_FULL_S = 300;
export const TIME_BONUS_ZERO_S = 720;
/** Rank thresholds (sim seconds): S <= 300, A <= 400, B <= 540, C <= 720, else D.
 *  Estimates off v1 pacing + dash — re-tune from >= 3 real playthroughs in Phase 3. */
export const RANK_S_S = 300;
export const RANK_A_S = 400;
export const RANK_B_S = 540;
export const RANK_C_S = 720;

/* ================================================================== */
/* v2 Rares (world/spawner.js)                                         */
/* ================================================================== */

/** Rare promotion chance per placement. rareRoll is drawn LAST in the
 *  per-placement draw order '(jx, jz, archRoll, sizeRoll, yawRoll,
 *  paletteRoll[, tumble x3], rareRoll)', UNCONDITIONALLY for every placement
 *  (determinism survives role changes). Landmark slots [8]/[9] are excluded. */
export const RARE_CHANCE = 0.002;
/** Rare instances are scaled up by this. */
export const RARE_SCALE_MUL = 1.15;
/** Rare instanceColor override (golden). */
export const RARE_TINT = 0xffd84a;
/** Alive-rare list capacity (entries; backing Int32Array(2 * CAP) of (storeIdx, slotGen)).
 *  Overflow policy: oldest entry stops sparkling — cosmetic-only degradation. */
export const RARE_LIST_CAP = 32;

/* ================================================================== */
/* v2 Persistence (localStorage)                                       */
/* ================================================================== */

/** Best records, schema {v:1, bestTime:BestRecord|null, bestScore:BestRecord|null}. */
export const LS_BEST_KEY = 'fableKatamari.v2.best';
/** Mute flag ('1'/'0') — read by main.js BEFORE constructing Bgm/Sfx. */
export const LS_MUTE_KEY = 'fableKatamari.v2.muted';

/* ================================================================== */
/* Timestep                                                            */
/* ================================================================== */

/** Fixed physics timestep: 60 Hz with accumulator. */
export const FIXED_DT = 1 / 60;
/** Max physics substeps per render frame (excess accumulator time is dropped). */
export const MAX_SUBSTEPS = 3;
/** Clamp on raw frame delta (s) so tab-switch pauses don't explode the accumulator. */
export const MAX_FRAME_DT = 0.1;

/* ================================================================== */
/* Ball physics (physics/ballPhysics.js)                               */
/* ================================================================== */

/**
 * Acceleration = ACCEL_K * simRadius along camera-relative input (sim/s^2 per r).
 * MUST satisfy ACCEL_K * FIXED_DT * f/(1-f) >= SPEED_K (f = FRICTION_PER_FRAME)
 * or the SPEED_K cap is unreachable and cruise speed silently drops below it
 * (at 22 the ball cruised at ~4.2r, half the 8.5r cap — pickup rate halved).
 * 45 * (1/60) * 0.92/0.08 = 8.6r, so the cap binds (~0.6s ramp to cruise).
 */
export const ACCEL_K = 45;
/** Speed cap = SPEED_K * simRadius (sim/s per r) — identical screen-space feel at every scale. */
export const SPEED_K = 8.5;
/** Friction: vel *= FRICTION_PER_FRAME ^ (dt * 60). */
export const FRICTION_PER_FRAME = 0.92;
/** Ground y-spring natural frequency (rad/s): center y springs to radiusSim. */
export const BALL_Y_OMEGA = 16;
/** Ground y-spring damping ratio (<1 = slight overshoot for the absorb 'pop'). */
export const BALL_Y_ZETA = 0.6;
/** Each absorb multiplies the transient accel factor by this (mass feel). */
export const SLUGGISH_FACTOR = 0.97;
/**
 * Sluggishness returns toward 1.0 PROPORTIONALLY with this time constant (s):
 * ds/dt = (1 - s) / SLUGGISH_RECOVERY_S — a single dip recovers in ~1.5s and
 * deep dips recover fast at first, so absorb streaks never park the ball.
 */
export const SLUGGISH_RECOVERY_S = 1.5;
/** Hard floor on the sluggish multiplier — burst absorbs can never zero out accel. */
export const SLUGGISH_MIN = 0.6;
/** Boost (Shift / second touch): acceleration multiplier while held. */
export const BOOST_ACCEL_MUL = 1.5;
/** Boost: speed-cap multiplier while held. */
export const BOOST_CAP_MUL = 1.25;

/* ================================================================== */
/* Absorb / collision (physics/absorb.js)                              */
/* ================================================================== */

/** Absorbable when objRadius <= ABSORB_RATIO * ballRadius. NEVER tier-gated. */
export const ABSORB_RATIO = 0.65;
/**
 * Volume growth: newR = cbrt(R^3 + GROWTH_K * r^3). With the T0 catalog
 * (mean r^3 ~ 0.0076 sim^3) and PICKUP_FORGIVE_K below, GROWTH_K = 10 puts
 * tier 0 at ~60s / ~170 absorbs (mean gap ~0.35s, so combos actually fire).
 * Retune against a measured tier-0 playthrough, not arithmetic alone.
 */
export const GROWTH_K = 10;
/**
 * Pickup forgiveness: for objects whose radius <= PICKUP_FORGIVE_MAX_RATIO *
 * ballRadius the absorb overlap test is widened by PICKUP_FORGIVE_K *
 * ballRadius — generous for clearly-smaller objects, honest near the
 * ABSORB_RATIO threshold (forgiven objects are always absorbable, so the
 * widened reach can never trigger a pushback). Continuous in radius.
 */
export const PICKUP_FORGIVE_K = 0.45;
export const PICKUP_FORGIVE_MAX_RATIO = 0.5;
/** Visual radius slew limit: radiusVisualSim approaches radiusSim at <= RADIUS_SLEW_K * r per second. */
export const RADIUS_SLEW_K = 1.5;
/** Pushback: normal velocity reflected * this; tangential preserved. */
export const BOUNCE_RESTITUTION = 0.35;
/** Impact speed > BONK_SPEED_FRAC * speedCap => bonk (shake + clonk + knock-off). */
export const BONK_SPEED_FRAC = 0.7;
/** Knock-off ejects between MIN and MAX of the NEWEST stuck objects. */
export const KNOCKOFF_MIN = 1;
export const KNOCKOFF_MAX = 3;
/** Ballistic pop speed of ejected objects, in ball simRadius units per second. */
export const KNOCKOFF_POP_SPEED_K = 2.5;
/** Rapid-absorb combo resets after this gap (drives rising-pitch sfx + HUD combo). */
export const COMBO_WINDOW_S = 1.5;

/* ================================================================== */
/* Camera (render/cameraRig.js)                                        */
/* ================================================================== */

/** Camera distance behind ball = CAM_DIST_K * simRadius. */
export const CAM_DIST_K = 6.5;
/** Camera height above ball = CAM_HEIGHT_K * simRadius. */
export const CAM_HEIGHT_K = 3.2;
/** Look target = ballPos + vel * CAM_LOOKAHEAD_S (look-ahead sells speed). */
export const CAM_LOOKAHEAD_S = 0.4;
/** Critically-damped spring stiffness (omega, rad/s) for camera POSITION. The LAG is the growth feedback. */
export const CAM_POS_OMEGA = 6.0;
/** Spring stiffness for camera LOOK target. */
export const CAM_LOOK_OMEGA = 4.5;
/** Base vertical FOV in degrees. */
export const FOV_BASE = 60;
/** tierUp celebration: FOV kicks FOV_BASE -> FOV_KICK_PEAK -> FOV_BASE over FOV_KICK_S. */
export const FOV_KICK_PEAK = 68;
export const FOV_KICK_S = 0.8;
/** Extra FOV degrees added above FOV_SPEED_FRAC of speed cap. */
export const FOV_SPEED_BONUS = 4;
export const FOV_SPEED_FRAC = 0.8;
/** Bonk micro-shake: amplitude = SHAKE_AMP_K * simRadius, exponential decay over SHAKE_DECAY_S. */
export const SHAKE_AMP_K = 0.15;
export const SHAKE_DECAY_S = 0.25;

/* ================================================================== */
/* Environment / fog (render/environment.js)                           */
/* ================================================================== */

/** Fog near = FOG_NEAR_K * simRadius. */
export const FOG_NEAR_K = 14;
/** Fog far = FOG_FAR_K * simRadius. Must stay inside the spawn ring (asserted in config/tiers.js). */
export const FOG_FAR_K = 55;
/** Tier palette (fog/sky) crossfade duration on tierUp. Cosmetic only. */
export const PALETTE_FADE_S = 2.0;

/* ================================================================== */
/* Spawner (world/spawner.js)                                          */
/* ================================================================== */

/** Amortization budgets — hard per-frame caps. */
export const SPAWN_BUDGET_PER_FRAME = 64;
export const DESPAWN_BUDGET_PER_FRAME = 64;
/** Max InstancedMesh per-instance matrix writes per frame (render-side budget). */
export const INSTANCE_WRITE_BUDGET = 64;
/** Sub-pixel despawn: objDiameter < SUBPIXEL_RATIO * ballRadius => 0.6s scale-fade out. */
export const SUBPIXEL_RATIO = 0.04;
/** Round-robin sub-pixel sweep examines this many objects per frame. */
export const SUBPIXEL_SWEEP_BUDGET = 200;
/** Pre-warm N+2 chunks beyond the fog wall at this fraction of the tier threshold. */
export const PREWARM_FRACTION = 0.70;
/** N+1 scenery band: load radius (sim units) and per-chunk density.
 *  v2: 8 -> 10 (peak population arithmetic: 2000 target + ~600 scenery +
 *  ~250 capped pre-warm + <=1200 leftovers ≈ 4050 < ALIVE_TOTAL_BUDGET 4096).
 *  One-line revert to 8 if the 0.9-budget DEV warn fires in Phase 3. */
export const SCENERY_LOAD_RADIUS_SIM = 140;
export const SCENERY_OBJECTS_PER_CHUNK = 10;
/** Alive-population budgets (soft, monitored in dev overlay).
 *  v2: ALIVE_SCENERY_BUDGET deleted (dead constant — never imported).
 *  Spawner DEV-warns when aliveCount > 0.9 * ALIVE_TOTAL_BUDGET. */
export const ALIVE_TARGET_BUDGET = 2000;   // tier N targets
export const ALIVE_LEFTOVER_BUDGET = 1200; // tier N-1 leftovers, falling
export const ALIVE_TOTAL_BUDGET = 4096;    // hard total
/** ObjectStore SoA capacity. */
export const STORE_CAPACITY = 8192;

/* ================================================================== */
/* Fades / transitions (all animate instance-matrix SCALE, never opacity) */
/* ================================================================== */

/** Belt-and-suspenders scale-up for any spawn landing inside fog range. */
export const SPAWN_FADE_S = 0.4;
/** Ring-exit despawn scale-fade. */
export const DESPAWN_FADE_S = 0.4;
/** Sub-pixel despawn scale-fade. */
export const SUBPIXEL_FADE_S = 0.6;

/* ================================================================== */
/* Stuck objects / ball (render/ball.js)                               */
/* ================================================================== */

/** Attach animation: world slot lerps to ball-surface socket over this, ease-out. */
export const ATTACH_ANIM_S = 0.15;
/** Squash scale at attach start (1.15 -> 1.0). */
export const ATTACH_SQUASH = 1.15;
/** Socket distance = simRadius * ATTACH_EMBED_K (8% embedded). */
export const ATTACH_EMBED_K = 0.92;
/** Total stuck-pool ring-buffer capacity across the 8 archetype families. */
export const STUCK_CAP = 512;
/** Burial cull: attachRadiusSim + objHalfSim < BURIAL_RATIO * currentSimRadius => reclaim. */
export const BURIAL_RATIO = 0.98;
/** Also cull stuck objects whose relative size drops below this (sub-pixel on ball). */
export const BURIAL_MIN_REL = 0.02;
/** Burial culls are staggered over this window so a tier jump never molts visibly. */
export const BURIAL_STAGGER_S = 1.0;
/** Ball core base color lerps this fraction toward each absorbed object's color. */
export const BALL_COLOR_LERP = 0.10;

/* ================================================================== */
/* Spatial hash (world/spatialHash.js)                                 */
/* ================================================================== */

/** Hash table size (power of two; key & (SIZE-1)). */
export const HASH_TABLE_SIZE = 16384;
/** 2D hash key primes: ((xi * PRIME_X) ^ (zi * PRIME_Z)) & (HASH_TABLE_SIZE - 1). */
export const HASH_PRIME_X = 73856093;
export const HASH_PRIME_Z = 19349663;
/** Opportunistic rebuild when tombstones exceed this fraction of entries. */
export const TOMBSTONE_REBUILD_FRAC = 0.25;

/* ================================================================== */
/* Renderer (render/renderer.js)                                       */
/* ================================================================== */

/** devicePixelRatio cap. */
export const PIXEL_RATIO_MAX = 1.5;
/** Dynamic-resolution governor: drop toward 1.0 if rolling avg frame > this (ms). */
export const FRAME_BUDGET_MS = 17;
/** Rolling window for the governor (s). */
export const GOVERNOR_WINDOW_S = 3;
/** Budget ceilings (dev-overlay warnings, not runtime behavior).
 *  v2 ledger (4-band tier-transition worst case, the honest peak):
 *    40 world InstancedMesh (4 live bands x 10 archetypes)
 *  +  8 stuck-on-ball families
 *  +  6 fixed (sky dome, ground, ball core, effects quads, 2x moon mesh+glow
 *      — moon is finale-only but budgeted)
 *  +  1 backdrop silhouette ring
 *  = 56 worst case -> cap 60. If measurement exceeds 56, first lever is
 *  dropping the moon glow shell (-1), then hiding N+2 pre-warm pools. */
export const DRAW_CALL_CAP = 60;
export const TRI_BUDGET = 600000;
/** Per-archetype merged-geometry triangle cap (asserted at boot in dev). */
export const ARCHETYPE_TRI_CAP = 350;

/* ================================================================== */
/* UI                                                                  */
/* ================================================================== */

/** HUD odometer update throttle ('grow' event emission rate). */
export const HUD_THROTTLE_HZ = 10;
