/**
 * @file cameraRig.js — Spring-damped follow camera, the feel centerpiece.
 *
 * Camera distance (CAM_DIST_K * r) and height (CAM_HEIGHT_K * r) are pure
 * functions of simRadius — SEAMLESSNESS LAW, never tier-gated. Position and
 * look targets run through critically-damped Vector3 springs whose LAG is the
 * growth feedback: big absorbs make the world visibly recede over ~0.5s.
 *
 * Features: velocity look-ahead (CAM_LOOKAHEAD_S), lazy yaw-follow with an
 * optional mouse-drag yaw offset, FOV base 60 + tierUp celebration kick
 * (60 -> 68 -> 60 over 0.8s, with the position spring loosened for an
 * overshoot "breath") + speed bonus above 80% of speed cap, bonk micro-shake
 * (SHAKE_AMP_K * r amplitude, SHAKE_DECAY_S exponential decay).
 *
 * v2 (moon update):
 *  - EVT.DASH additive FOV kick: +DASH_FOV_BONUS deg swelling/decaying over
 *    DASH_DURATION_S (same clock+envelope idiom as the tierUp kick).
 *  - CINEMATIC MODE (finale CONTACT onward): beginCinematic() latches a flag
 *    (springs keep their state — no pop); finale then drives
 *    cinematicUpdate(dt, posTarget, lookTarget, fovTarget) per frame instead
 *    of main calling update() (main gates on finale.cameraOwned). The injected
 *    targets are DERIVED per frame by the finale (pure functions of moon pose
 *    + ball radius => rescale-safe with zero cached camera state here).
 *    endCinematic() / reset() (GAME_RESET) clear the flag. While latched,
 *    update()/updateIdle() early-return so the WIN-state idle orbit cannot
 *    yank the final moon shot from behind the result screen.
 *
 * Spring state lives in SIM SPACE: ScaleManager multiplies it by S at the
 * one-frame similarity rescale via rescaleState(S) so the camera pose stays a
 * pure function of scaled state (pixel-identity guarantee).
 *
 * YAW CONVENTION (read by physics/ballPhysics.js as cameraRig.yaw):
 *   forward      = ( sin(yaw), 0, cos(yaw) )
 *   screen-right = forward x up = ( -cos(yaw), 0, sin(yaw) )
 *
 * Zero-allocation per frame: module-level scratch vectors only.
 */

import * as THREE from 'three';
import {
  CAM_DIST_K,
  CAM_HEIGHT_K,
  CAM_LOOKAHEAD_S,
  CAM_POS_OMEGA,
  CAM_LOOK_OMEGA,
  DASH_DURATION_S,
  DASH_FOV_BONUS,
  FOV_BASE,
  FOV_KICK_PEAK,
  FOV_KICK_S,
  FOV_SPEED_BONUS,
  FOV_SPEED_FRAC,
  SHAKE_AMP_K,
  SHAKE_DECAY_S,
  SPEED_K,
} from '../config/tuning.js';
import { springVec3, damp, clamp01 } from '../core/mathUtils.js';
import { bus, EVT } from '../core/events.js';

/** @typedef {import('../types.js').BallState} BallState */

/** Lazy yaw-follow halflife (s) — how slowly the camera swings behind motion. */
const YAW_FOLLOW_HALFLIFE_S = 0.45;
/** Mouse yaw offset recenters with this halflife (s) while the ball is moving. */
const YAW_OFFSET_RECENTER_HALFLIFE_S = 2.5;
/** Speed (fraction of cap) above which the yaw starts following velocity. */
const YAW_FOLLOW_MIN_SPEED_FRAC = 0.12;
/** Smoothing halflife for the speed-FOV bonus (s). */
const FOV_SPEED_HALFLIFE_S = 0.15;
/** Spring-loosening depth during the tierUp breath (0..1 of omega). */
const KICK_OMEGA_DIP = 0.4;
/** Title-screen idle orbit angular speed (rad/s) and pose. */
const IDLE_ORBIT_SPEED = 0.12;
/** Cinematic FOV approach halflife (s) toward the injected fovTarget. */
const CINE_FOV_HALFLIFE_S = 0.25;

const TWO_PI = Math.PI * 2;

// Module-level scratch (zero per-frame allocation).
const _target = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _rebaseOffset = new THREE.Vector3();

/**
 * Wrap an angle difference to (-PI, PI].
 * @param {number} a Radians.
 * @returns {number}
 */
function wrapAngle(a) {
  a = ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  return a;
}

/**
 * Spring-damped follow camera. Construct once with the renderer's
 * PerspectiveCamera; call update(dt, ballState, yawDrag) once per render
 * frame (frame-order step 6). Subscribes to EVT.TIER_UP (FOV kick),
 * EVT.BOUNCE (micro-shake) and EVT.GAME_START / EVT.GAME_RESET (snap).
 */
export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera The render camera (owned by render/renderer.js).
   * @param {import('../core/events.js').EventBus} [eventBus] Bus to subscribe on; defaults to the singleton.
   */
  constructor(camera, eventBus = bus) {
    /** @type {THREE.PerspectiveCamera} */
    this.camera = camera;

    /**
     * Current effective camera yaw (radians, includes mouse offset).
     * Read by ballPhysics for camera-relative input mapping.
     * forward = (sin(yaw), 0, cos(yaw)).
     * @type {number}
     */
    this.yaw = 0;

    // Spring state (sim space — rescaled by S at tier-up).
    this._pos = new THREE.Vector3(0, CAM_HEIGHT_K * 0.5, -CAM_DIST_K * 0.5);
    this._vel = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._lookVel = new THREE.Vector3();

    /** @type {number} Base yaw that lazily follows the velocity direction. */
    this._followYaw = 0;
    /** @type {number} Player mouse-drag yaw offset (recenters while rolling). */
    this._yawOffset = 0;

    /** @type {number} FOV kick clock; >= FOV_KICK_S means inactive. */
    this._kickT = FOV_KICK_S;
    /** @type {number} v2 dash FOV kick clock; >= DASH_DURATION_S means inactive. */
    this._dashKickT = DASH_DURATION_S;
    /** @type {boolean} v2 finale cinematic latch (finale drives cinematicUpdate). */
    this._cinematic = false;
    /** @type {number} Smoothed speed-FOV bonus (deg). */
    this._speedFov = 0;
    /** @type {number} Current shake amplitude (sim units), exponentially decaying. */
    this._shakeAmp = 0;
    /** @type {number} Free-running clock for shake phase / idle orbit. */
    this._clock = 0;
    /** @type {number} Last seen ball simRadius (for bounce shake amplitude). */
    this._lastRadius = 0.5;
    /** @type {boolean} Snap springs to target on the next update (no lag pop-in). */
    this._needSnap = true;

    // Bus subscriptions (payloads are reused objects — read fields only, never retain).
    this._onTierUp = eventBus.on(EVT.TIER_UP, () => {
      this._kickT = 0;
    });
    this._onDash = eventBus.on(EVT.DASH, () => {
      this._dashKickT = 0; // v2: additive FOV kick over DASH_DURATION_S
    });
    this._onBounce = eventBus.on(EVT.BOUNCE, (p) => {
      const amp = SHAKE_AMP_K * this._lastRadius * (0.4 + 0.6 * p.impactSpeed01);
      if (amp > this._shakeAmp) this._shakeAmp = amp;
    });
    this._onStart = eventBus.on(EVT.GAME_START, () => {
      this.reset();
    });
    this._onReset = eventBus.on(EVT.GAME_RESET, () => {
      this.reset();
    });
  }

  /**
   * Reset rig state (game start/restart): clears yaw, offsets, kicks, shake,
   * the v2 cinematic latch, and requests a lag-free snap on the next update.
   */
  reset() {
    this.yaw = 0;
    this._followYaw = 0;
    this._yawOffset = 0;
    this._kickT = FOV_KICK_S;
    this._dashKickT = DASH_DURATION_S;
    this._cinematic = false;
    this._speedFov = 0;
    this._shakeAmp = 0;
    this._needSnap = true;
  }

  /**
   * Per-frame camera update (frame-order step 6).
   * @param {number} dt Render-frame delta (s).
   * @param {BallState} ball Ball truth (read-only).
   * @param {number} [yawDrag] Mouse yaw delta this frame (radians) from input.takeYawDrag().
   */
  update(dt, ball, yawDrag = 0) {
    if (this._cinematic) return; // finale owns the camera (belt-and-suspenders; main gates too)
    const r = ball.radiusVisualSim > 0 ? ball.radiusVisualSim : ball.radiusSim;
    this._lastRadius = ball.radiusSim;
    this._clock += dt;

    // ---- lazy yaw-follow --------------------------------------------------
    const vx = ball.vel.x;
    const vz = ball.vel.z;
    const speed = Math.sqrt(vx * vx + vz * vz);
    const speedCap = SPEED_K * ball.radiusSim;
    const speed01 = speedCap > 0 ? clamp01(speed / speedCap) : 0;
    if (speed01 > YAW_FOLLOW_MIN_SPEED_FRAC) {
      const targetYaw = Math.atan2(vx, vz);
      const dyaw = wrapAngle(targetYaw - this._followYaw);
      // Frame-rate-independent lazy approach (damp on the angle difference).
      this._followYaw += dyaw * (1 - Math.pow(2, -dt / YAW_FOLLOW_HALFLIFE_S));
      this._followYaw = wrapAngle(this._followYaw);
      // Mouse offset slowly recenters while rolling.
      this._yawOffset = damp(this._yawOffset, 0, YAW_OFFSET_RECENTER_HALFLIFE_S, dt);
    }
    this._yawOffset += yawDrag;
    this.yaw = wrapAngle(this._followYaw + this._yawOffset);

    // ---- FOV kick clock + spring "breath" ----------------------------------
    let omegaScale = 1;
    if (this._kickT < FOV_KICK_S) {
      this._kickT += dt;
      const k = Math.sin(Math.PI * clamp01(this._kickT / FOV_KICK_S));
      omegaScale = 1 - KICK_OMEGA_DIP * k; // loosen for the overshoot breath
    }

    // ---- position / look springs (pure functions of radius) ----------------
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const dist = CAM_DIST_K * r;
    const height = CAM_HEIGHT_K * r;
    _target.set(ball.pos.x - fx * dist, ball.pos.y + height, ball.pos.z - fz * dist);
    _lookTarget.set(
      ball.pos.x + ball.vel.x * CAM_LOOKAHEAD_S,
      ball.pos.y + ball.vel.y * CAM_LOOKAHEAD_S,
      ball.pos.z + ball.vel.z * CAM_LOOKAHEAD_S
    );

    if (this._needSnap) {
      this._needSnap = false;
      this._pos.copy(_target);
      this._vel.set(0, 0, 0);
      this._look.copy(_lookTarget);
      this._lookVel.set(0, 0, 0);
    } else {
      springVec3(this._pos, this._vel, _target, CAM_POS_OMEGA * omegaScale, dt);
      springVec3(this._look, this._lookVel, _lookTarget, CAM_LOOK_OMEGA * omegaScale, dt);
    }

    // ---- apply pose (+ bonk micro-shake) -----------------------------------
    this._shakeAmp *= Math.exp(-dt / SHAKE_DECAY_S);
    const cam = this.camera;
    const t = this._clock;
    const sa = this._shakeAmp;
    cam.position.set(
      this._pos.x + sa * Math.sin(t * 47.3),
      this._pos.y + sa * 0.6 * Math.sin(t * 59.1),
      this._pos.z + sa * Math.sin(t * 38.7)
    );
    cam.lookAt(this._look);

    // ---- FOV: base + kick + dash kick + smoothed speed bonus ---------------
    const kick =
      this._kickT < FOV_KICK_S
        ? (FOV_KICK_PEAK - FOV_BASE) * Math.sin(Math.PI * clamp01(this._kickT / FOV_KICK_S))
        : 0;
    // v2 dash kick: additive DASH_FOV_BONUS swell/decay over DASH_DURATION_S
    // (same clock+sin envelope idiom as the tierUp kick above).
    let dashKick = 0;
    if (this._dashKickT < DASH_DURATION_S) {
      this._dashKickT += dt;
      dashKick = DASH_FOV_BONUS * Math.sin(Math.PI * clamp01(this._dashKickT / DASH_DURATION_S));
    }
    const speedBonusTarget =
      FOV_SPEED_BONUS * clamp01((speed01 - FOV_SPEED_FRAC) / (1 - FOV_SPEED_FRAC));
    this._speedFov = damp(this._speedFov, speedBonusTarget, FOV_SPEED_HALFLIFE_S, dt);
    const fov = FOV_BASE + kick + dashKick + this._speedFov;
    if (Math.abs(fov - cam.fov) > 0.005) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Title/win idle: slow orbit around the world origin. Call instead of
   * update() while not playing (optional — main.js may skip rendering on title).
   * @param {number} dt Frame delta (s).
   */
  updateIdle(dt) {
    if (this._cinematic) return; // hold the finale's final moon shot behind the result screen
    this._clock += dt;
    const a = this._clock * IDLE_ORBIT_SPEED;
    const r = Math.max(this._lastRadius, 0.5);
    const cam = this.camera;
    cam.position.set(Math.sin(a) * CAM_DIST_K * r, CAM_HEIGHT_K * r, Math.cos(a) * CAM_DIST_K * r);
    _lookTarget.set(0, r * 0.5, 0);
    cam.lookAt(_lookTarget);
    if (Math.abs(cam.fov - FOV_BASE) > 0.005) {
      cam.fov = FOV_BASE;
      cam.updateProjectionMatrix();
    }
  }

  /* ---------------------------------------------------------------- */
  /* v2 finale cinematic (game/finale.js drives these from CONTACT)    */
  /* ---------------------------------------------------------------- */

  /**
   * Latch cinematic mode (finale CONTACT). Springs keep their state so the
   * first cinematicUpdate continues seamlessly from the gameplay pose — no
   * snap, no pop. While latched, update()/updateIdle() are inert.
   */
  beginCinematic() {
    this._cinematic = true;
  }

  /**
   * Per-frame cinematic camera drive (frame-order step 4.5, called by
   * finale.update INSTEAD of main calling update()). Drives the existing
   * position/look springs toward the INJECTED targets (read-only — derived
   * per frame by the finale from moon pose + ball radius, so rescale-safe
   * with zero cached camera state) and eases FOV toward fovTarget. The
   * gameplay FOV bonuses (kick/dash/speed) are intentionally ignored here.
   * @param {number} dt Render-frame delta (s).
   * @param {THREE.Vector3} posTarget  Camera position target (sim space, read-only).
   * @param {THREE.Vector3} lookTarget Look-at target (sim space, read-only).
   * @param {number} fovTarget Vertical FOV target (deg).
   */
  cinematicUpdate(dt, posTarget, lookTarget, fovTarget) {
    this._clock += dt;
    if (this._needSnap) {
      this._needSnap = false;
      this._pos.copy(posTarget);
      this._vel.set(0, 0, 0);
      this._look.copy(lookTarget);
      this._lookVel.set(0, 0, 0);
    } else {
      springVec3(this._pos, this._vel, posTarget, CAM_POS_OMEGA, dt);
      springVec3(this._look, this._lookVel, lookTarget, CAM_LOOK_OMEGA, dt);
    }
    // Residual bonk shake decays out naturally (no new shake post-contact).
    this._shakeAmp *= Math.exp(-dt / SHAKE_DECAY_S);
    const cam = this.camera;
    cam.position.copy(this._pos);
    cam.lookAt(this._look);
    const fov = damp(cam.fov, fovTarget, CINE_FOV_HALFLIFE_S, dt);
    if (Math.abs(fov - cam.fov) > 0.005) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Clear the cinematic latch (also cleared by reset() on GAME_RESET). */
  endCinematic() {
    this._cinematic = false;
  }

  /**
   * One-frame similarity rescale hook — called synchronously by ScaleManager
   * BETWEEN update and render. Multiplies all sim-space spring state by S so
   * the camera pose remains a pure function of scaled state and the rescale
   * frame renders pixel-identical. Also corrects the live camera position for
   * the current frame.
   * @param {number} S Similarity factor (RESCALE_S = 0.2).
   */
  rescaleState(S) {
    this._pos.multiplyScalar(S);
    this._vel.multiplyScalar(S);
    this._look.multiplyScalar(S);
    this._lookVel.multiplyScalar(S);
    this._shakeAmp *= S;
    this._lastRadius *= S;
    // Re-apply pose now: rescale happens after update() this frame.
    this.camera.position.multiplyScalar(S);
    this.camera.lookAt(this._look);
  }

  /**
   * Floating-origin rebase hook — called synchronously by ScaleManager when
   * |ball.pos| > REBASE_DISTANCE_SIM. Subtracts the integer-snapped shift
   * from all world-position spring state (velocities are shift-invariant)
   * and corrects the live camera position for the current frame.
   * @param {THREE.Vector3} offset The shift subtracted from every world position.
   */
  rebase(offset) {
    this._pos.sub(offset);
    this._look.sub(offset);
    this.camera.position.sub(offset);
    this.camera.lookAt(this._look);
  }

  /**
   * Scalar convenience wrapper — ScaleManager.maybeRebase passes the
   * integer-snapped shift as two numbers (sx, sz). Rare path (rebase only).
   * @param {number} sx Sim-unit X shift subtracted from the world.
   * @param {number} sz Sim-unit Z shift subtracted from the world.
   */
  rebaseState(sx, sz) {
    _rebaseOffset.set(sx, 0, sz);
    this.rebase(_rebaseOffset);
  }
}
