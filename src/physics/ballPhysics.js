/**
 * @file ballPhysics.js — Ball kinematics on the analytic plane y = 0.
 *
 * The only dynamic body in the game. Owns the BallState (single source of
 * ball truth). Everything is radius-proportional (SEAMLESSNESS LAW) so
 * screen-space feel is identical at every tier and across rescales:
 *   accel    = ACCEL_K * simRadius * sluggish  (camera-relative input)
 *   speedCap = SPEED_K * simRadius
 *   friction = vel *= FRICTION_PER_FRAME ^ (dt * 60)
 *
 * Rolling without slipping: axis = up x v-hat, angle = |v| * dt / simRadius,
 * quat = axisAngle o quat — module scratch, zero allocation.
 *
 * Ground: center y is an UNDERDAMPED spring toward radiusSim
 * (BALL_Y_OMEGA / BALL_Y_ZETA) — radius growth from absorbs makes the ball
 * visibly 'pop' upward. Velocity stays strictly horizontal (vel.y === 0);
 * pos.y is cosmetic spring output.
 *
 * CAMERA-RELATIVE CONVENTION (binding for render/cameraRig.js):
 *   camYaw is rotation about +Y; yaw = 0 means the camera looks along -Z.
 *   forward (intent.y = +1) = (-sin yaw, 0, -cos yaw)
 *   right   (intent.x = +1) = ( cos yaw, 0, -sin yaw)
 */

import * as THREE from 'three';
import {
  ACCEL_K,
  SPEED_K,
  FRICTION_PER_FRAME,
  BALL_Y_OMEGA,
  BALL_Y_ZETA,
  SLUGGISH_FACTOR,
  SLUGGISH_RECOVERY_S,
  SIM_RADIUS_MIN,
} from '../config/tuning.js';
import { springDamped } from '../core/mathUtils.js';

/** @typedef {import('../types.js').BallState} BallState */
/** @typedef {import('../types.js').Intent} Intent */

/** Sluggishness regain per second: one absorb's dip recovers in exactly SLUGGISH_RECOVERY_S. */
const SLUGGISH_RECOVERY_RATE = (1 - SLUGGISH_FACTOR) / SLUGGISH_RECOVERY_S;
/** Below this horizontal speed (sim/s) we skip the rolling quaternion update. */
const ROLL_SPEED_EPS = 1e-5;

/* Module-level scratch — never allocated per frame. */
const SCRATCH_AXIS = new THREE.Vector3();
const SCRATCH_ROLL_Q = new THREE.Quaternion();

/**
 * Kinematic ball integrator. Construct once; main.js calls step() inside the
 * fixed-timestep loop (before absorb.resolve). ScaleManager calls rescale(S)
 * at tier-up (it also scales the hidden ground-spring state — do NOT scale
 * state fields directly or the y-spring will pop).
 */
export class BallPhysics {
  constructor() {
    /**
     * Single source of ball truth — absorb.js mutates radiusSim/sluggish,
     * bounce response mutates pos/vel; everyone else reads only.
     * @type {BallState}
     */
    this.state = {
      pos: new THREE.Vector3(0, SIM_RADIUS_MIN, 0),
      vel: new THREE.Vector3(0, 0, 0),
      quat: new THREE.Quaternion(),
      radiusSim: SIM_RADIUS_MIN,
      radiusVisualSim: SIM_RADIUS_MIN,
      sluggish: 1,
    };
    /** @type {{ value: number, vel: number }} Ground y-spring (underdamped). */
    this._ySpring = { value: SIM_RADIUS_MIN, vel: 0 };
  }

  /**
   * Advance one fixed physics substep.
   * @param {number} dt     Fixed timestep (FIXED_DT).
   * @param {Intent} intent Normalized input axes in [-1, 1] (clamped to unit length here).
   * @param {number} camYaw Camera yaw (rad, about +Y; 0 = looking along -Z).
   */
  step(dt, intent, camYaw) {
    const s = this.state;
    const vel = s.vel;

    /* --- Camera-relative acceleration ------------------------------- */
    let ix = intent.x;
    let iy = intent.y;
    const inLen2 = ix * ix + iy * iy;
    if (inLen2 > 1) {
      const inv = 1 / Math.sqrt(inLen2);
      ix *= inv;
      iy *= inv;
    }
    if (inLen2 > 0) {
      const sinY = Math.sin(camYaw);
      const cosY = Math.cos(camYaw);
      // world dir = right * ix + forward * iy (see convention in file header)
      const dirX = cosY * ix - sinY * iy;
      const dirZ = -sinY * ix - cosY * iy;
      const a = ACCEL_K * s.radiusSim * s.sluggish;
      vel.x += dirX * a * dt;
      vel.z += dirZ * a * dt;
    }

    /* --- Friction + speed cap (horizontal only) --------------------- */
    const f = Math.pow(FRICTION_PER_FRAME, dt * 60);
    vel.x *= f;
    vel.z *= f;

    const cap = SPEED_K * s.radiusSim;
    let speed2 = vel.x * vel.x + vel.z * vel.z;
    if (speed2 > cap * cap) {
      const k = cap / Math.sqrt(speed2);
      vel.x *= k;
      vel.z *= k;
      speed2 = cap * cap;
    }

    /* --- Integrate position ----------------------------------------- */
    s.pos.x += vel.x * dt;
    s.pos.z += vel.z * dt;

    /* --- Ground y-spring (underdamped 'pop' on growth) -------------- */
    springDamped(this._ySpring, s.radiusSim, BALL_Y_OMEGA, BALL_Y_ZETA, dt);
    s.pos.y = this._ySpring.value;

    /* --- Rolling without slipping ------------------------------------ */
    const speed = Math.sqrt(speed2);
    if (speed > ROLL_SPEED_EPS) {
      const invSpeed = 1 / speed;
      // axis = up x v-hat = (vz, 0, -vx) / |v|
      SCRATCH_AXIS.set(vel.z * invSpeed, 0, -vel.x * invSpeed);
      SCRATCH_ROLL_Q.setFromAxisAngle(SCRATCH_AXIS, (speed * dt) / s.radiusSim);
      s.quat.premultiply(SCRATCH_ROLL_Q);
      s.quat.normalize();
    }

    /* --- Sluggishness recovery (mass feel) --------------------------- */
    if (s.sluggish < 1) {
      s.sluggish += SLUGGISH_RECOVERY_RATE * dt;
      if (s.sluggish > 1) s.sluggish = 1;
    }
  }

  /**
   * One-frame similarity rescale hook (ScaleManager calls this with
   * S = RESCALE_S between physics update and render). Scales position,
   * velocity, both radii AND the hidden ground-spring state so the rescale
   * frame renders pixel-identical. Angular state (quat) is scale-free.
   * @param {number} S Similarity factor (0.2).
   */
  rescale(S) {
    const s = this.state;
    s.pos.multiplyScalar(S);
    s.vel.multiplyScalar(S);
    s.radiusSim *= S;
    s.radiusVisualSim *= S;
    this._ySpring.value *= S;
    this._ySpring.vel *= S;
  }

  /**
   * Companion hook for orchestrators that scale the PUBLIC BallState fields
   * themselves (ScaleManager._applyRescale mutates pos/vel/radii directly):
   * scales ONLY the hidden ground-spring state so the y-spring stays
   * pixel-identical across the rescale. Do NOT call together with rescale(S)
   * — that would double-scale the spring.
   * @param {number} S Similarity factor (0.2).
   */
  rescaleSpring(S) {
    this._ySpring.value *= S;
    this._ySpring.vel *= S;
  }

  /**
   * Floating-origin rebase hook: subtract the integer-snapped shift from the
   * ball position (ScaleManager applies the same shift to the store/camera).
   * @param {number} dx Sim-unit X shift.
   * @param {number} dz Sim-unit Z shift.
   */
  rebase(dx, dz) {
    this.state.pos.x -= dx;
    this.state.pos.z -= dz;
  }

  /**
   * Reset to a fresh run (game reset / dev ?r= start-at-radius key).
   * @param {number} [radiusSim=SIM_RADIUS_MIN] Starting sim radius.
   */
  reset(radiusSim = SIM_RADIUS_MIN) {
    const s = this.state;
    s.pos.set(0, radiusSim, 0);
    s.vel.set(0, 0, 0);
    s.quat.identity();
    s.radiusSim = radiusSim;
    s.radiusVisualSim = radiusSim;
    s.sluggish = 1;
    this._ySpring.value = radiusSim;
    this._ySpring.vel = 0;
  }
}
