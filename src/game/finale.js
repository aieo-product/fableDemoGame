/**
 * @file finale.js — The v2 moon-ending state machine (Stream A; owns the goal
 * — ScaleManager's v1 WIN_RADIUS_M latch is removed).
 *
 * States: idle -> called -> descent -> landed -> contact -> merge ->
 *         ascension -> afterglow -> done
 *
 *  - IDLE/CALLED: threshold watches on trueRadius (MOON_CALL_RADIUS_M /
 *    MOON_GOAL_RADIUS_M). CALLED is pure cosmetics (EVT.MOON_CALL toast,
 *    sky-moon pulse, bgm swell).
 *  - DESCENT: the REAL moon (render/moon.js) materializes at an
 *    ANGULAR-MATCHED start pose — cameraPos + env.getMoonDirWorld() *
 *    (moonR / tan(moonAngSize[tier])) — so its screen direction and angular
 *    size EXACTLY match the sky-dome shader disc while env.setSkyMoonFade
 *    crossfades 1 -> 0 over 2s (the handoff cannot pop). It then lerps
 *    (easeInOutCubic + settle bounce) to a landing point ahead of the ball
 *    over MOON_DESCENT_S. Gameplay stays FULLY live; EVT.MOON_GUIDE at 10Hz
 *    drives the HUD edge arrow.
 *  - LANDED: moon rests on y = moonR (pushback-free, soft magnet bias);
 *    render-frame contact test => CONTACT.
 *  - CONTACT (clear-time instant, once): EVT.MOON_GUIDE {active:false} +
 *    EVT.MOON_CONTACT; inputLocked/cameraOwned latch true (main gates
 *    intent/absorb/spawner/maybeRebase and skips cameraRig.update);
 *    cameraRig.beginCinematic().
 *  - MERGE: finale writes ball.pos (lerp into the moon center); ball view
 *    hidden at t >= 0.6s; moon scale pops 1 -> 1.06 -> 1.
 *  - ASCENSION: moon rises ease-in to ascendBaseY + MOON_ASCEND_HEIGHT_K * r;
 *    env.beginNightFade(MOON_ASCEND_S); effects.moonBurst(). The (hidden)
 *    ball is parked on the moon center so the fountain/blob shadow track it.
 *  - AFTERGLOW: glow breathing, then state = 'done' — main.js (the SOLE v2
 *    'game:win' emitter) fires EVT.GAME_WIN.
 *
 * RESCALE/REBASE SAFETY (binding): _simCache is THE exhaustive list of
 * rescale/rebase-sensitive finale state — finale subscribes EVT.RESCALE
 * (every field *= S) and EVT.REBASE (every X/Z field -= sx/sz) itself.
 * Everything else (moon pose, camera targets) is DERIVED per frame from
 * _simCache + BallState, so a mid-DESCENT/LANDED rescale or rebase stays
 * pixel-identical. ANY new finale state field MUST be added to _simCache or
 * be derived per-frame (DESIGN-V2.md リスク).
 *
 * Post-CONTACT, main gates maybeRebase off and growth is frozen (absorb
 * skipped) so no rescale can fire — the cinematic phases never see either.
 *
 * Camera: from CONTACT the finale derives camPosTarget/lookTarget/fovTarget
 * per frame (pure functions of current moon pose + frozen ball radius — zero
 * cached camera state) and drives cameraRig.cinematicUpdate.
 *
 * Zero per-frame allocation: module scratch vectors, reused PAYLOADS.
 */

import * as THREE from 'three';
import { TIERS } from '../config/tiers.js';
import { EVT, PAYLOADS } from '../core/events.js';
import { clamp01, easeInOutCubic } from '../core/mathUtils.js';
import {
  ACCEL_K,
  AFTERGLOW_S,
  FOV_BASE,
  MOON_ASCEND_HEIGHT_K,
  MOON_ASCEND_S,
  MOON_CALL_RADIUS_M,
  MOON_CONTACT_PAD,
  MOON_DESCENT_S,
  MOON_GOAL_RADIUS_M,
  MOON_LAND_DIST_K,
  MOON_LAND_VEL_FRAC,
  MOON_MAGNET_ACCEL_FRAC,
  MOON_MAGNET_RANGE_K,
  MOON_MERGE_S,
  MOON_RADIUS_K,
  SPEED_K,
} from '../config/tuning.js';

/** @typedef {import('../types.js').BallState} BallState */

const DEV = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;

/* ---- finale-local cosmetic tunables (not in tuning.js) -------------- */
/** Sky-moon shader disc -> real mesh crossfade duration (s) at descent start. */
const MOON_FADE_S = 2.0;
/** Post-descent settle bounce duration (s) and amplitude (fraction of moonR). */
const SETTLE_S = 0.4;
const SETTLE_AMP = 0.045;
/** EVT.MOON_GUIDE emission interval (10Hz). */
const GUIDE_INTERVAL_S = 0.1;
/** Ball view hidden this far into MERGE (s). */
const BALL_HIDE_AT_S = 0.6;
/** MERGE moon scale pop amplitude (1.0 -> 1+AMP -> 1.0). */
const MERGE_POP_AMP = 0.06;
/** Cinematic shot: camPos = moonPos + back*BACK_K*r + up*UP_K*r; FOV 60 -> 52. */
const CINE_BACK_K = 14;
const CINE_UP_K = 4;
const CINE_FOV_END = 52;
/** Moon spin rates (rad/s): descent/landed vs ascension. */
const SPIN_SLOW = 0.12;
const SPIN_ASCEND = 0.28;
/** Afterglow glow breathing frequency (Hz). */
const GLOW_BREATH_HZ = 0.5;
/** skipCinematic() time multiplier — MERGE+ASCENSION+AFTERGLOW (8.7 s)
 *  compress to ~1.7 s. A fast-forward, not a hard cut: every phase still
 *  runs (night fade, ball hide, GAME_WIN emission order all preserved). */
const SKIP_TIME_SCALE = 5;

const TWO_PI = Math.PI * 2;

// Module-level scratch (zero per-frame allocation).
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();

/**
 * Moon-ending state machine. Construct once at boot; main.js calls
 * update(frameDt, ballPhys.state) at frame-order step 4.5 and reset() inside
 * resetWorld(). Subscribes EVT.RESCALE / EVT.REBASE itself (for _simCache).
 */
export class Finale {
  /**
   * @param {import('../core/events.js').EventBus} bus Shared event bus.
   * @param {import('../world/scaleManager.js').ScaleManager} scaleMgr worldScale/tierIndex source.
   * @param {import('../render/moon.js').MoonView} moonView The real moon mesh.
   * @param {object} env Environment — setSkyMoonFade/setSkyMoonPulse/
   *   beginNightFade/getMoonDirWorld (Stream B; typeof-guarded for bring-up).
   * @param {import('../render/cameraRig.js').CameraRig} cameraRig Camera rig
   *   (yaw read for the landing-direction fallback; cinematic drive from CONTACT).
   * @param {object} ballView render/ball.js Ball — setVisible(b) (Stream C).
   * @param {THREE.PerspectiveCamera} camera Render camera (NDC projection for
   *   MOON_GUIDE + descent start pose; matrixWorldInverse freshness = last
   *   render, which is fine for a 10Hz guide).
   * @param {object} [effects] render/effects.js Effects — moonBurst() +
   *   dustRing() (optional; also injectable later via setEffects).
   */
  constructor(bus, scaleMgr, moonView, env, cameraRig, ballView, camera, effects = null) {
    this._bus = bus;
    this._scaleMgr = scaleMgr;
    this._moonView = moonView;
    this._env = env;
    this._cameraRig = cameraRig;
    this._ballView = ballView;
    this._camera = camera;
    this._effects = effects;

    /** @type {'idle'|'called'|'descent'|'landed'|'contact'|'merge'|'ascension'|'afterglow'|'done'} */
    this._state = 'idle';
    this._inputLocked = false;
    this._cameraOwned = false;

    /**
     * THE exhaustive list of rescale/rebase-sensitive finale state
     * (DESIGN-V2.md 月エンディング — binding). EVT.RESCALE: every field *= S.
     * EVT.REBASE: every X/Z field -= sx/sz. Nothing else in the finale caches
     * sim-space numbers; all poses/targets are derived per frame from here.
     */
    this._simCache = {
      startX: 0, startY: 0, startZ: 0, // descent start pose
      landX: 0, landY: 0, landZ: 0, // landing point (moon center when landed)
      moonR: 0, // frozen moon radius (sim units)
      mergeFromX: 0, mergeFromY: 0, mergeFromZ: 0, // ball pos at merge start
      ascendBaseY: 0, // moon center y at ascension start
    };

    /** @type {number} Clock within the current phase (s). */
    this._phaseT = 0;
    /** @type {number} Clock since CONTACT (cinematic FOV ease). */
    this._cineT = 0;
    /** @type {number} Accumulated moon spin angle (rad — dimensionless). */
    this._spin = 0;
    /** @type {number} MOON_GUIDE 10Hz accumulator. */
    this._guideAcc = 0;
    /** @type {boolean} Sky-moon fade reached 0 (stop calling the uniform). */
    this._fadeDone = false;
    /** @type {boolean} Ball view hidden during MERGE. */
    this._ballHidden = false;
    /** @type {boolean} DEV: missing-env-API warning emitted once. */
    this._warnedEnv = false;
    /** @type {boolean} A rescale/rebase fired this frame — the camera's
     * matrixWorldInverse is still pre-transform (render is step 7), so one
     * 10Hz guide projection is skipped instead of flashing a wrong arrow. */
    this._skipGuideOnce = false;
    /** @type {number} Post-contact cinematic time multiplier (1 = normal;
     * skipCinematic() sets SKIP_TIME_SCALE — replayers fast-forward). */
    this._timeScale = 1;

    // Current moon center — DERIVED, rewritten by _setMoonPose every active
    // frame BEFORE any consumer (guide projection / cinematic targets) reads
    // it, so it needs no rescale/rebase handling of its own.
    this._moonX = 0;
    this._moonY = 0;
    this._moonZ = 0;

    bus.on(EVT.RESCALE, (p) => {
      const S = p.S;
      const c = this._simCache;
      c.startX *= S; c.startY *= S; c.startZ *= S;
      c.landX *= S; c.landY *= S; c.landZ *= S;
      c.moonR *= S;
      c.mergeFromX *= S; c.mergeFromY *= S; c.mergeFromZ *= S;
      c.ascendBaseY *= S;
      this._skipGuideOnce = true; // camera matrix is stale this frame
    });
    bus.on(EVT.REBASE, (p) => {
      const c = this._simCache;
      c.startX -= p.sx; c.startZ -= p.sz;
      c.landX -= p.sx; c.landZ -= p.sz;
      c.mergeFromX -= p.sx; c.mergeFromZ -= p.sz;
      this._skipGuideOnce = true; // camera matrix is stale this frame
    });
  }

  /* ---------------------------------------------------------------- */
  /* Public surface (frozen interface)                                 */
  /* ---------------------------------------------------------------- */

  /** @returns {'idle'|'called'|'descent'|'landed'|'contact'|'merge'|'ascension'|'afterglow'|'done'} */
  get state() {
    return this._state;
  }

  /** True from CONTACT — main gates intent/absorb/spawner/maybeRebase. */
  get inputLocked() {
    return this._inputLocked;
  }

  /** True from CONTACT — main skips cameraRig.update (finale drives cinematicUpdate). */
  get cameraOwned() {
    return this._cameraOwned;
  }

  /**
   * Late wiring hook for render/effects.js (moonBurst + dustRing) — the
   * 7-arg constructor shape is frozen, so the integrator may inject effects
   * here instead of as the optional 8th argument.
   * @param {object} effects
   */
  setEffects(effects) {
    this._effects = effects;
  }

  /**
   * v2 replay-friction fix: fast-forward the post-contact cinematic
   * (MERGE/ASCENSION/AFTERGLOW run at SKIP_TIME_SCALE). main.js calls this on
   * any pointerdown/keydown while in the FINALE state. A no-op pre-contact —
   * descent/landing are live gameplay and must never accelerate. Idempotent.
   */
  skipCinematic() {
    if (!this._inputLocked || this._state === 'done') return;
    this._timeScale = SKIP_TIME_SCALE;
  }

  /**
   * Per-frame finale drive (main.js frame-order step 4.5, AFTER
   * scaleMgr.maybeTierUp/maybeRebase so _simCache and BallState agree).
   * @param {number} frameDt Render-frame delta (s).
   * @param {BallState} ball Single source of ball truth (vel biased in
   *   LANDED; pos written directly during MERGE..AFTERGLOW).
   */
  update(frameDt, ball) {
    const tr = ball.radiusSim * this._scaleMgr.worldScale;
    // Post-contact fast-forward (skipCinematic). Pre-contact phases always
    // run at 1x — _timeScale only ever rises after inputLocked latches.
    const cineDt = frameDt * this._timeScale;

    // ---- threshold ladder (both may fire in one frame, e.g. ?r=740) -------
    if (this._state === 'idle' && tr >= MOON_CALL_RADIUS_M) this._enterCalled(tr);
    if (this._state === 'called' && tr >= MOON_GOAL_RADIUS_M) this._beginDescent(ball);

    // DEV watchdog: the finale is the ONLY end-of-game path — if the run grew
    // past 1.2x goal while still pre-descent, something ate the trigger.
    if (
      DEV &&
      (this._state === 'idle' || this._state === 'called') &&
      tr > 1.2 * MOON_GOAL_RADIUS_M
    ) {
      console.error(
        `[finale] watchdog: trueRadius ${tr.toFixed(1)}m > 1.2x goal while '${this._state}' — forcing DESCENT`
      );
      this._beginDescent(ball);
    }

    switch (this._state) {
      case 'descent':
        this._updateDescent(frameDt, ball);
        break;
      case 'landed':
        this._updateLanded(frameDt, ball);
        break;
      case 'contact': // one observable frame, then the merge begins
        this._state = 'merge';
        this._phaseT = 0;
        this._updateMerge(cineDt, ball);
        break;
      case 'merge':
        this._updateMerge(cineDt, ball);
        break;
      case 'ascension':
        this._updateAscension(cineDt, ball);
        break;
      case 'afterglow':
        this._updateAfterglow(cineDt, ball);
        break;
      default:
        break; // idle / called / done
    }

    // From CONTACT: derive cinematic camera targets per frame (pure function
    // of current moon pose + frozen ball radius => rescale-safe, zero cached
    // camera state) and drive the rig springs.
    if (this._cameraOwned) this._driveCinematic(frameDt, ball);
  }

  /**
   * Back to a fresh run (called directly by main.resetWorld — frozen reset
   * ownership; ball visibility is restored by ball.reset(), camera latch by
   * cameraRig.reset() on GAME_RESET).
   */
  reset() {
    this._state = 'idle';
    this._inputLocked = false;
    this._cameraOwned = false;
    this._phaseT = 0;
    this._cineT = 0;
    this._spin = 0;
    this._guideAcc = 0;
    this._fadeDone = false;
    this._ballHidden = false;
    this._skipGuideOnce = false;
    this._timeScale = 1;
    const c = this._simCache;
    c.startX = 0; c.startY = 0; c.startZ = 0;
    c.landX = 0; c.landY = 0; c.landZ = 0;
    c.moonR = 0;
    c.mergeFromX = 0; c.mergeFromY = 0; c.mergeFromZ = 0;
    c.ascendBaseY = 0;
    this._moonX = 0; this._moonY = 0; this._moonZ = 0;
    this._moonView.setVisible(false);
    this._moonView.setGlow01(0);
    this._moonView.setSpin(0);
    this._envCall('setSkyMoonFade', 1);
    this._envCall('setSkyMoonPulse', false);
    // Belt-and-suspenders: cameraRig.reset() (GAME_RESET) clears this too.
    if (this._cameraRig && typeof this._cameraRig.endCinematic === 'function') {
      this._cameraRig.endCinematic();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Phase transitions                                                 */
  /* ---------------------------------------------------------------- */

  /** @param {number} tr Current trueRadius (m). */
  _enterCalled(tr) {
    this._state = 'called';
    PAYLOADS.moonCall.trueRadius = tr;
    this._bus.emit(EVT.MOON_CALL, PAYLOADS.moonCall);
    this._envCall('setSkyMoonPulse', true); // 0.5Hz uMoonGlow breathing
  }

  /**
   * DESCENT start: freeze moonR, pick the landing point, compute the
   * angular-matched start pose so the real mesh takes over the shader disc
   * with zero visual discontinuity.
   * @param {BallState} ball
   */
  _beginDescent(ball) {
    const c = this._simCache;
    const r = ball.radiusSim;
    this._state = 'descent';
    this._phaseT = 0;
    this._spin = 0;
    this._guideAcc = GUIDE_INTERVAL_S; // first guide emits immediately
    this._fadeDone = false;
    this._skipGuideOnce = false; // any pre-descent staleness flag is moot

    c.moonR = MOON_RADIUS_K * r;

    // Landing direction: horizontal velocity if moving with intent, else
    // camera forward (cameraRig convention: forward = (sin yaw, 0, cos yaw)).
    const vx = ball.vel.x;
    const vz = ball.vel.z;
    const sp = Math.sqrt(vx * vx + vz * vz);
    let dx;
    let dz;
    if (sp >= MOON_LAND_VEL_FRAC * SPEED_K * r && sp > 1e-9) {
      dx = vx / sp;
      dz = vz / sp;
    } else {
      const yaw = this._cameraRig.yaw;
      dx = Math.sin(yaw);
      dz = Math.cos(yaw);
    }
    c.landX = ball.pos.x + dx * MOON_LAND_DIST_K * r;
    c.landZ = ball.pos.z + dz * MOON_LAND_DIST_K * r;
    c.landY = c.moonR; // rests ON the ground plane
    c.ascendBaseY = c.moonR;

    // Angular-matched start pose: distance such that a sphere of radius moonR
    // subtends EXACTLY the sky-disc's angular radius from the camera, along
    // the CURRENT blended sky-moon direction (T5: ~41.9r away).
    let ti = this._scaleMgr.tierIndex;
    if (ti < 0) ti = 0;
    else if (ti >= TIERS.length) ti = TIERS.length - 1;
    const dist = c.moonR / Math.tan(TIERS[ti].moonAngSize);
    this._getMoonDir(_v3a, ti);
    const cp = this._camera.position;
    c.startX = cp.x + _v3a.x * dist;
    c.startY = cp.y + _v3a.y * dist;
    c.startZ = cp.z + _v3a.z * dist;

    this._envCall('setSkyMoonPulse', false); // the real moon takes over
    this._moonView.setGlow01(0);
    this._moonView.setVisible(true);
    this._setMoonPose(c.startX, c.startY, c.startZ, c.moonR);
  }

  /**
   * CONTACT: the clear-time instant. Latches input/camera ownership, records
   * mergeFrom, emits the guide-off + MOON_CONTACT pair.
   * @param {BallState} ball
   */
  _onContact(ball) {
    this._state = 'contact';
    this._phaseT = 0;
    this._cineT = 0;
    this._inputLocked = true;
    this._cameraOwned = true;
    const c = this._simCache;
    c.mergeFromX = ball.pos.x;
    c.mergeFromY = ball.pos.y;
    c.mergeFromZ = ball.pos.z;
    this._ballHidden = false;

    // Hide the HUD arrow first, then announce the clear (subscribers: runStats
    // freeze+GOAL, bgm duck->stop, sfx fanfare, hud hide, screens flash).
    this._projectAndEmitGuide(false);
    this._bus.emit(EVT.MOON_CONTACT, PAYLOADS.moonContact);

    if (this._cameraRig && typeof this._cameraRig.beginCinematic === 'function') {
      this._cameraRig.beginCinematic();
    } else if (DEV) {
      console.warn('[finale] cameraRig.beginCinematic() missing');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Phase updates                                                     */
  /* ---------------------------------------------------------------- */

  /** @param {number} dt @param {BallState} ball */
  _updateDescent(dt, ball) {
    this._phaseT += dt;
    const c = this._simCache;

    // Sky-disc -> mesh crossfade (1 -> 0 over MOON_FADE_S, then stop calling).
    if (!this._fadeDone) {
      const k = 1 - this._phaseT / MOON_FADE_S;
      if (k <= 0) {
        this._fadeDone = true;
        this._envCall('setSkyMoonFade', 0);
      } else {
        this._envCall('setSkyMoonFade', k);
      }
    }

    // Pose: easeInOutCubic start -> landing, then a small settle bounce.
    const e = easeInOutCubic(clamp01(this._phaseT / MOON_DESCENT_S));
    const mx = c.startX + (c.landX - c.startX) * e;
    let my = c.startY + (c.landY - c.startY) * e;
    const mz = c.startZ + (c.landZ - c.startZ) * e;
    if (this._phaseT > MOON_DESCENT_S) {
      const u = clamp01((this._phaseT - MOON_DESCENT_S) / SETTLE_S);
      my = c.landY + c.moonR * SETTLE_AMP * Math.sin(Math.PI * u) * (1 - u);
    }
    this._spin += SPIN_SLOW * dt;
    this._moonView.setGlow01(0.55 * clamp01(this._phaseT / 1.5)); // glow ramps in
    this._setMoonPose(mx, my, mz, c.moonR);

    this._updateGuide(dt);

    if (this._phaseT >= MOON_DESCENT_S + SETTLE_S) {
      this._state = 'landed';
      this._phaseT = 0;
      this._setMoonPose(c.landX, c.landY, c.landZ, c.moonR);
      if (this._effects && typeof this._effects.dustRing === 'function') {
        this._effects.dustRing(c.landX, 0, c.landZ, c.moonR); // touchdown dust, once
      }
    }
  }

  /** @param {number} dt @param {BallState} ball */
  _updateLanded(dt, ball) {
    this._phaseT += dt;
    const c = this._simCache;
    const r = ball.radiusSim;

    // Re-derive the (static) pose every frame — free, and exactly right on
    // the frame a rescale/rebase rewrote _simCache.
    this._spin += SPIN_SLOW * dt;
    this._moonView.setGlow01(0.5 + 0.08 * Math.sin(TWO_PI * GLOW_BREATH_HZ * this._phaseT));
    this._setMoonPose(c.landX, c.landY, c.landZ, c.moonR);

    // Soft magnet: horizontal bias toward the moon — never overrides input
    // (an acceleration, not a steering rewrite), engages within 20r.
    const dxh = c.landX - ball.pos.x;
    const dzh = c.landZ - ball.pos.z;
    const dh = Math.sqrt(dxh * dxh + dzh * dzh);
    if (dh > 1e-6 && dh < MOON_MAGNET_RANGE_K * r) {
      const a = (MOON_MAGNET_ACCEL_FRAC * ACCEL_K * r * dt) / dh;
      ball.vel.x += dxh * a;
      ball.vel.z += dzh * a;
    }

    this._updateGuide(dt);

    // Render-frame contact test (the moon is pushback-free — rolling in
    // always succeeds): dist(ball, moonCenter) <= ballR + moonR * PAD.
    const dy = c.landY - ball.pos.y;
    const reach = r + c.moonR * MOON_CONTACT_PAD;
    if (dxh * dxh + dy * dy + dzh * dzh <= reach * reach) {
      this._onContact(ball);
    }
  }

  /** @param {number} dt @param {BallState} ball */
  _updateMerge(dt, ball) {
    this._phaseT += dt;
    this._cineT += dt;
    const c = this._simCache;

    // Finale owns ball.pos now (intent is zeroed by main, so nothing fights).
    const t01 = clamp01(this._phaseT / MOON_MERGE_S);
    const e = easeInOutCubic(t01);
    ball.pos.x = c.mergeFromX + (c.landX - c.mergeFromX) * e;
    ball.pos.y = c.mergeFromY + (c.landY - c.mergeFromY) * e;
    ball.pos.z = c.mergeFromZ + (c.landZ - c.mergeFromZ) * e;
    ball.vel.set(0, 0, 0);

    if (!this._ballHidden && this._phaseT >= BALL_HIDE_AT_S) {
      this._ballHidden = true;
      if (this._ballView && typeof this._ballView.setVisible === 'function') {
        this._ballView.setVisible(false); // restored by ball.reset()
      } else if (DEV) {
        console.warn('[finale] ballView.setVisible(b) missing (Stream C)');
      }
    }

    // Swallow pop: moon scale 1.0 -> 1.06 -> 1.0 across the merge.
    const pop = 1 + MERGE_POP_AMP * Math.sin(Math.PI * t01);
    this._spin += SPIN_SLOW * dt;
    this._moonView.setGlow01(0.5 + 0.3 * Math.sin(Math.PI * t01));
    this._setMoonPose(c.landX, c.landY, c.landZ, c.moonR * pop);

    if (this._phaseT >= MOON_MERGE_S) {
      this._state = 'ascension';
      this._phaseT = 0;
      this._envCall('beginNightFade', MOON_ASCEND_S); // day -> NIGHT palette
      if (this._effects && typeof this._effects.moonBurst === 'function') {
        this._effects.moonBurst(); // golden sparkle fountain
      }
    }
  }

  /** @param {number} dt @param {BallState} ball */
  _updateAscension(dt, ball) {
    this._phaseT += dt;
    this._cineT += dt;
    const c = this._simCache;
    const r = ball.radiusSim;

    const u = clamp01(this._phaseT / MOON_ASCEND_S);
    const my = c.ascendBaseY + MOON_ASCEND_HEIGHT_K * r * u * u; // ease-in rise
    this._spin += SPIN_ASCEND * dt;
    this._moonView.setGlow01(0.7);
    this._setMoonPose(c.landX, my, c.landZ, c.moonR);

    // Park the (hidden) ball on the moon center so position-anchored systems
    // (effects fountain, blob shadow) ride the ascent.
    ball.pos.x = c.landX;
    ball.pos.y = my;
    ball.pos.z = c.landZ;
    ball.vel.set(0, 0, 0);

    if (this._phaseT >= MOON_ASCEND_S) {
      this._state = 'afterglow';
      this._phaseT = 0;
    }
  }

  /** @param {number} dt @param {BallState} ball */
  _updateAfterglow(dt, ball) {
    this._phaseT += dt;
    this._cineT += dt;
    const c = this._simCache;
    const r = ball.radiusSim;

    const my = c.ascendBaseY + MOON_ASCEND_HEIGHT_K * r; // hangs as THE moon
    this._spin += SPIN_ASCEND * 0.5 * dt;
    this._moonView.setGlow01(0.55 + 0.25 * Math.sin(TWO_PI * GLOW_BREATH_HZ * this._phaseT));
    this._setMoonPose(c.landX, my, c.landZ, c.moonR);

    ball.pos.x = c.landX;
    ball.pos.y = my;
    ball.pos.z = c.landZ;
    ball.vel.set(0, 0, 0);

    if (this._phaseT >= AFTERGLOW_S) {
      this._state = 'done'; // main emits EVT.GAME_WIN (sole emitter)
    }
  }

  /* ---------------------------------------------------------------- */
  /* Per-frame derived helpers                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Write the current moon center (derived state) + drive the MoonView.
   * @param {number} x @param {number} y @param {number} z @param {number} radius
   */
  _setMoonPose(x, y, z, radius) {
    this._moonX = x;
    this._moonY = y;
    this._moonZ = z;
    this._moonView.setPose(x, y, z, radius);
    this._moonView.setSpin(this._spin);
  }

  /**
   * 10Hz MOON_GUIDE throttle (DESCENT/LANDED).
   * @param {number} dt
   */
  _updateGuide(dt) {
    this._guideAcc += dt;
    if (this._guideAcc < GUIDE_INTERVAL_S) return;
    this._guideAcc -= GUIDE_INTERVAL_S;
    if (this._guideAcc > GUIDE_INTERVAL_S) this._guideAcc = 0; // no catch-up burst after hitches
    if (this._skipGuideOnce) {
      // A rescale/rebase rewrote _simCache this frame but the camera's
      // matrixWorldInverse is still last frame's (pre-transform) — projecting
      // NEW-space coords through the OLD-space matrix would snap the arrow
      // wildly for 100 ms. Skip this tick; the next one is consistent.
      this._skipGuideOnce = false;
      return;
    }
    this._projectAndEmitGuide(true);
  }

  /**
   * Project the moon center through the render camera into 0..1 screen
   * coords and emit EVT.MOON_GUIDE. Behind-camera points are mirrored so the
   * HUD edge arrow still points the shorter way around.
   * @param {boolean} active False = the one final hide on CONTACT.
   */
  _projectAndEmitGuide(active) {
    const cam = this._camera;
    _v3a.set(this._moonX, this._moonY, this._moonZ).applyMatrix4(cam.matrixWorldInverse);
    const behind = _v3a.z >= 0; // camera looks down -Z in view space
    _v3a.applyMatrix4(cam.projectionMatrix); // perspective divide included
    let nx = _v3a.x;
    let ny = _v3a.y;
    if (behind) {
      nx = -nx;
      ny = -ny;
    }
    const p = PAYLOADS.moonGuide;
    p.x01 = clamp01((nx + 1) * 0.5);
    p.y01 = clamp01((1 - ny) * 0.5); // 0 = top
    p.onScreen = !behind && nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
    p.active = active;
    this._bus.emit(EVT.MOON_GUIDE, p);
  }

  /**
   * Cinematic camera targets, derived fresh every frame: camPos = moonPos +
   * back*14r + up*4r (back = horizontal moon->mergeFrom direction, all from
   * _simCache), look = moonPos, FOV eases 60 -> 52 over merge+ascension.
   * @param {number} dt @param {BallState} ball
   */
  _driveCinematic(dt, ball) {
    const c = this._simCache;
    const r = ball.radiusSim;
    let bx = c.mergeFromX - c.landX;
    let bz = c.mergeFromZ - c.landZ;
    const bl = Math.sqrt(bx * bx + bz * bz);
    if (bl > 1e-6) {
      bx /= bl;
      bz /= bl;
    } else {
      bx = 0;
      bz = 1;
    }
    _v3a.set(
      this._moonX + bx * CINE_BACK_K * r,
      this._moonY + CINE_UP_K * r,
      this._moonZ + bz * CINE_BACK_K * r
    );
    _v3b.set(this._moonX, this._moonY, this._moonZ);
    const fovTarget =
      FOV_BASE +
      (CINE_FOV_END - FOV_BASE) *
        easeInOutCubic(clamp01(this._cineT / (MOON_MERGE_S + MOON_ASCEND_S)));
    if (this._cameraRig && typeof this._cameraRig.cinematicUpdate === 'function') {
      this._cameraRig.cinematicUpdate(dt, _v3a, _v3b, fovTarget);
    } else if (DEV) {
      console.warn('[finale] cameraRig.cinematicUpdate(...) missing');
    }
  }

  /**
   * Current blended sky-moon direction — env.getMoonDirWorld when available
   * (Stream B), else the tier's static moonDir normalized (bring-up fallback;
   * elevation floor is asserted in tiers.js either way).
   * @param {THREE.Vector3} out
   * @param {number} tierIndex Clamped tier index.
   * @returns {THREE.Vector3} out
   */
  _getMoonDir(out, tierIndex) {
    if (this._env && typeof this._env.getMoonDirWorld === 'function') {
      return this._env.getMoonDirWorld(out);
    }
    if (DEV && !this._warnedEnv) {
      this._warnedEnv = true;
      console.warn('[finale] env.getMoonDirWorld(out) missing — using tiers.js moonDir');
    }
    const m = TIERS[tierIndex].moonDir;
    return out.set(m[0], m[1], m[2]).normalize();
  }

  /**
   * Guarded env call (setSkyMoonFade / setSkyMoonPulse / beginNightFade) —
   * Stream B lands these; no-op with one DEV warn until then.
   * @param {string} method
   * @param {*} arg
   */
  _envCall(method, arg) {
    const env = this._env;
    if (env && typeof env[method] === 'function') {
      env[method](arg);
      return;
    }
    if (DEV && !this._warnedEnv) {
      this._warnedEnv = true;
      console.warn(`[finale] env.${method}(...) missing (Stream B) — finale continues without it`);
    }
  }
}
