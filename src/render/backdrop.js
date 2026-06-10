/**
 * @file backdrop.js — v2 camera-centered horizon silhouette ring (1 draw call).
 *
 * Two jagged-top cylinder-strip layers (96 segments x 4 quad rows each,
 * 1536 tris total), vertex-colored, built ONCE at boot from
 * mulberry32(worldSeed ^ 0x42444b). Two height/color profiles are baked as
 * two vertex-attribute sets blended by uProfile01: rolling hills (T0-2) <->
 * tower skyline (T3-5), crossfaded on EVT.TIER_UP alongside the env palette
 * fade. A tiny ShaderMaterial mixes the silhouette color toward the LIVE fog
 * color (read from scene.fog each update — zero alloc) at BACKDROP_FOG_MIX,
 * so it reads as hazy distant mountains/skyline, never a hard edge — and it
 * fades toward near-black silhouette during the finale night fade for free
 * (the night palette's fog color is 0x1a1838).
 *
 * PIXEL-IDENTITY AT RESCALE / REBASE-FREE (binding, DESIGN-V2.md 背景強化):
 * update(dt, ball, camera) sets position = (cam.x, 0, cam.z) and
 * scale = ball.radiusSim — a PURE function of current radius + camera, with
 * geometry radius BACKDROP_DIST_K * r and height BACKDROP_HEIGHT_K * r.
 * Rescale multiplies both camera position and radius by S => identical
 * pixels; rebase shifts camera and ring together => nothing to do.
 * update() runs in main.js step 6 AFTER cameraRig.update.
 *
 * Render state: frustumCulled = false (always around the camera),
 * renderOrder = -5 (after the sky dome at -10, before the world at 0),
 * depthWrite = false (world geometry always paints over it).
 *
 * Zero per-frame allocation; all geometry/material allocation at boot.
 * Subscribes EVT.TIER_UP + EVT.GAME_RESET itself on the singleton bus.
 */

import * as THREE from 'three';
import { PALETTE_FADE_S } from '../config/tuning.js';
import { bus, EVT } from '../core/events.js';
import { mulberry32 } from '../core/rng.js';
import { easeInOutCubic, clamp01, lerp } from '../core/mathUtils.js';

/** @typedef {import('../types.js').BallState} BallState */
/** @typedef {import('../types.js').TierUpEvent} TierUpEvent */

/* ---- module-local tuning (DESIGN-V2.md チューニング定数) ---- */
/** Ring radius = BACKDROP_DIST_K * ball.radiusSim (between fog near 14r and far 55r). */
const BACKDROP_DIST_K = 48;
/** Peak silhouette height = BACKDROP_HEIGHT_K * ball.radiusSim — pokes above the fog band. */
const BACKDROP_HEIGHT_K = 10;
/** Front-layer mix toward the live fog color (back layer is slightly hazier). */
const BACKDROP_FOG_MIX = 0.82;
/** Back layer sits deeper in the haze. */
const BACKDROP_FOG_MIX_BACK = 0.9;

/** Ring segments around the circle. */
const SEG = 96;
/** Vertical quad rows per layer (4 rows x 96 seg x 2 layers = 1536 tris). */
const ROWS = 4;
/** First tier whose profile is the tower skyline (T0-2 hills, T3-5 skyline). */
const SKYLINE_FROM_TIER = 3;
/** Backdrop generation seed salt ('BDK'). */
const SEED_SALT = 0x42444b;

/* ------------------------------------------------------------------ */
/* Shaders                                                              */
/* ------------------------------------------------------------------ */

const BACKDROP_VERT = /* glsl */ `
attribute float aHeightA;  // hills profile (0..~1, per column; layer amp baked in)
attribute float aHeightB;  // skyline profile
attribute vec3 aColorA;    // hills silhouette color (per column)
attribute vec3 aColorB;    // skyline silhouette color
attribute float aFog;      // per-layer fog-mix factor
uniform float uProfile01;  // 0 = hills (T0-2), 1 = skyline (T3-5)
uniform float uHeight;     // BACKDROP_HEIGHT_K
varying vec3 vColor;
varying float vFog;
void main() {
  vColor = mix(aColorA, aColorB, uProfile01);
  vFog = aFog;
  // position.y is the row fraction (-0.04 .. 1); the blended profile scales it.
  float hk = mix(aHeightA, aHeightB, uProfile01);
  vec3 p = vec3(position.x, position.y * hk * uHeight, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const BACKDROP_FRAG = /* glsl */ `
uniform vec3 uFogColor;
varying vec3 vColor;
varying float vFog;
void main() {
  gl_FragColor = vec4(mix(vColor, uFogColor, vFog), 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Seeded profile generators (boot only — allocation allowed)           */
/* ------------------------------------------------------------------ */

/**
 * Rolling-hills height profile: a few integer-wavenumber sines (seamless
 * wrap by construction) with seeded phases. Values clamped to [0.18, 1] then
 * scaled by `amp`. Column SEG duplicates column 0 (wrap seam).
 * @param {() => number} rnd Seeded PRNG.
 * @param {number} amp Layer amplitude.
 * @returns {Float32Array} SEG+1 heights.
 */
function genHillHeights(rnd, amp) {
  const out = new Float32Array(SEG + 1);
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const p3 = rnd() * Math.PI * 2;
  const k1 = 2 + Math.floor(rnd() * 2);  // 2-3 broad ridges
  const k2 = 5 + Math.floor(rnd() * 3);  // mid detail
  const k3 = 9 + Math.floor(rnd() * 4);  // fine detail
  for (let c = 0; c < SEG; c++) {
    const a = (c / SEG) * Math.PI * 2;
    const h = 0.55 + 0.25 * Math.sin(k1 * a + p1) + 0.14 * Math.sin(k2 * a + p2) + 0.06 * Math.sin(k3 * a + p3);
    out[c] = Math.min(1, Math.max(0.18, h)) * amp;
  }
  out[SEG] = out[0];
  return out;
}

/**
 * Hills silhouette colors: per-column jitter around a muted green-grey base.
 * @param {() => number} rnd @param {number} r @param {number} g @param {number} b
 * @returns {Float32Array} (SEG+1)*3 linear-ish RGB.
 */
function genHillColors(rnd, r, g, b) {
  const out = new Float32Array((SEG + 1) * 3);
  for (let c = 0; c < SEG; c++) {
    const j = (rnd() - 0.5) * 0.06;
    out[c * 3 + 0] = Math.max(0, r + j);
    out[c * 3 + 1] = Math.max(0, g + j * 1.2);
    out[c * 3 + 2] = Math.max(0, b + j);
  }
  out[SEG * 3 + 0] = out[0];
  out[SEG * 3 + 1] = out[1];
  out[SEG * 3 + 2] = out[2];
  return out;
}

/**
 * Tower-skyline profile + colors: runs of 2-5 columns share one flat height
 * (building blocks) and one color; ~8% of runs are tall spires. Wrap seam
 * duplicated. Heights scaled by `amp`.
 * @param {() => number} rnd Seeded PRNG.
 * @param {number} amp Layer amplitude.
 * @param {number} r @param {number} g @param {number} b Base color.
 * @returns {{heights: Float32Array, colors: Float32Array}}
 */
function genSkyline(rnd, amp, r, g, b) {
  const heights = new Float32Array(SEG + 1);
  const colors = new Float32Array((SEG + 1) * 3);
  let c = 0;
  while (c < SEG) {
    const run = 2 + Math.floor(rnd() * 4); // 2-5 columns per building
    let h = 0.25 + rnd() * 0.6;
    if (rnd() < 0.08) h = 0.85 + rnd() * 0.15; // spire
    const j = (rnd() - 0.5) * 0.05;
    const cr = Math.max(0, r + j);
    const cg = Math.max(0, g + j);
    const cb = Math.max(0, b + j * 1.4);
    for (let i = 0; i < run && c < SEG; i++, c++) {
      heights[c] = h * amp;
      colors[c * 3 + 0] = cr;
      colors[c * 3 + 1] = cg;
      colors[c * 3 + 2] = cb;
    }
  }
  heights[SEG] = heights[0];
  colors[SEG * 3 + 0] = colors[0];
  colors[SEG * 3 + 1] = colors[1];
  colors[SEG * 3 + 2] = colors[2];
  return { heights, colors };
}

/* ------------------------------------------------------------------ */
/* Backdrop                                                              */
/* ------------------------------------------------------------------ */

/**
 * Backdrop — the camera-centered horizon silhouette ring.
 *
 * Integration (main.js):
 *   const backdrop = new Backdrop(renderer.scene, worldSeed);
 *   ...per frame (step 6, AFTER cameraRig.update):
 *   backdrop.update(frameDt, ballPhys.state, renderer.camera);
 *   ?r= dev start (optional cosmetic): backdrop.setProfileImmediate(startTierIndex);
 * Subscribes 'tierUp' (profile crossfade) + 'game:reset' (snap to hills)
 * on the singleton bus. dispose() for teardown/tests.
 */
export class Backdrop {
  /**
   * @param {THREE.Scene} scene Owned by render/renderer.js.
   * @param {number} worldSeed uint32 world seed (silhouette is seeded cosmetics).
   */
  constructor(scene, worldSeed) {
    /** @type {THREE.Scene} */
    this._scene = scene;

    /* --- profile crossfade state (0 = hills, 1 = skyline) --- */
    /** @type {number} */ this._prof = 0;
    /** @type {number} */ this._profFrom = 0;
    /** @type {number} */ this._profTo = 0;
    /** @type {number} */ this._fadeT = 0;
    /** @type {number} */ this._fadeDur = 0; // 0 = not fading

    /* --- geometry (boot-only allocation) --- */
    const rnd = mulberry32((worldSeed ^ SEED_SALT) >>> 0);
    const geo = this._buildGeometry(rnd);

    /** @type {{[k:string]: {value: *}}} */
    this._uniforms = {
      uProfile01: { value: 0 },
      uHeight: { value: BACKDROP_HEIGHT_K },
      uFogColor: { value: new THREE.Color(0xffffff) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this._uniforms,
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false, // fixed-haze mix above (the ring never moves relative to the camera)
    });

    /** @type {THREE.Mesh} */
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5; // after sky (-10), before world (0)
    scene.add(this.mesh);

    /* --- bus subscriptions (cosmetic only) --- */
    /** @type {(p: TierUpEvent) => void} */
    this._onTierUp = (p) => this._startProfileFade(p.tierIndex >= SKYLINE_FROM_TIER ? 1 : 0);
    bus.on(EVT.TIER_UP, this._onTierUp);
    /** @type {() => void} */
    this._onGameReset = () => this.setProfileImmediate(0);
    bus.on(EVT.GAME_RESET, this._onGameReset);

    if (import.meta.env && import.meta.env.DEV) {
      const tris = /** @type {THREE.BufferGeometry} */ (geo).index.count / 3;
      if (tris > 1600) throw new Error(`[backdrop] tri budget exceeded: ${tris} > 1600`);
    }
  }

  /**
   * Per-frame update — main.js step 6, AFTER cameraRig.update (and after
   * ScaleManager). A pure function of (radius, camera): position follows the
   * camera XZ at ground level, uniform scale = radiusSim => pixel-identical
   * at rescale, nothing to do on rebase. Reads the LIVE fog color from
   * scene.fog so tier palette fades and the finale night fade come free.
   * Zero allocation.
   * @param {number} dt Frame delta (s).
   * @param {BallState} ball The single source of ball truth.
   * @param {THREE.PerspectiveCamera} camera The render camera.
   */
  update(dt, ball, camera) {
    // Profile crossfade (cosmetic, rides EVT.TIER_UP alongside the palette fade).
    if (this._fadeDur > 0) {
      this._fadeT += dt;
      const k = easeInOutCubic(clamp01(this._fadeT / this._fadeDur));
      this._prof = lerp(this._profFrom, this._profTo, k);
      this._uniforms.uProfile01.value = this._prof;
      if (this._fadeT >= this._fadeDur) this._fadeDur = 0;
    }

    // Live fog color (environment.js mutates scene.fog.color in place).
    const fog = this._scene.fog;
    if (fog !== null) this._uniforms.uFogColor.value.copy(fog.color);

    // Pure function of camera + radius (the rescale/rebase law of this file).
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
    this.mesh.scale.setScalar(ball.radiusSim);
  }

  /**
   * Snap the profile blend with no fade (game reset; optional ?r= dev start).
   * @param {number} tierIndex 0..5.
   */
  setProfileImmediate(tierIndex) {
    this._prof = tierIndex >= SKYLINE_FROM_TIER ? 1 : 0;
    this._profFrom = this._prof;
    this._profTo = this._prof;
    this._fadeDur = 0;
    this._uniforms.uProfile01.value = this._prof;
  }

  /** Unsubscribe + release GPU resources (teardown / tests). */
  dispose() {
    bus.off(EVT.TIER_UP, this._onTierUp);
    bus.off(EVT.GAME_RESET, this._onGameReset);
    this._scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    /** @type {THREE.ShaderMaterial} */ (this.mesh.material).dispose();
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Begin a PALETTE_FADE_S crossfade toward a profile blend target.
   * @param {number} to 0 (hills) or 1 (skyline).
   */
  _startProfileFade(to) {
    if (to === this._profTo && this._fadeDur === 0 && this._prof === to) return; // already there
    this._profFrom = this._prof;
    this._profTo = to;
    this._fadeT = 0;
    this._fadeDur = PALETTE_FADE_S;
  }

  /**
   * Build the 2-layer ring geometry (boot only — allocates).
   * Layer 0 (back): radius 48, full height, hazier; layer 1 (front): radius
   * 38.4, ~0.62 height, BACKDROP_FOG_MIX. Both profiles + both color sets are
   * baked as attributes; the vertex shader blends them by uProfile01.
   * @param {() => number} rnd Seeded PRNG (consumed in a fixed order — deterministic).
   * @returns {THREE.BufferGeometry}
   */
  _buildGeometry(rnd) {
    const layers = [
      { radius: BACKDROP_DIST_K, amp: 1.0, fogMix: BACKDROP_FOG_MIX_BACK, hillCol: [0.16, 0.22, 0.19], skyCol: [0.15, 0.17, 0.23] },
      { radius: BACKDROP_DIST_K * 0.8, amp: 0.62, fogMix: BACKDROP_FOG_MIX, hillCol: [0.08, 0.13, 0.10], skyCol: [0.07, 0.08, 0.12] },
    ];
    const cols = SEG + 1;
    const rows = ROWS + 1;
    const vertsPerLayer = cols * rows;
    const vertCount = vertsPerLayer * layers.length;

    const positions = new Float32Array(vertCount * 3);
    const heightA = new Float32Array(vertCount);
    const heightB = new Float32Array(vertCount);
    const colorA = new Float32Array(vertCount * 3);
    const colorB = new Float32Array(vertCount * 3);
    const fogMix = new Float32Array(vertCount);
    const indices = new Uint16Array(layers.length * SEG * ROWS * 6);

    let ii = 0;
    for (let L = 0; L < layers.length; L++) {
      const lay = layers[L];
      // Fixed draw order from one rnd stream => deterministic per worldSeed.
      const hillH = genHillHeights(rnd, lay.amp);
      const hillC = genHillColors(rnd, lay.hillCol[0], lay.hillCol[1], lay.hillCol[2]);
      const skyl = genSkyline(rnd, lay.amp, lay.skyCol[0], lay.skyCol[1], lay.skyCol[2]);
      const base = L * vertsPerLayer;

      for (let row = 0; row < rows; row++) {
        // Row 0 dips slightly below ground level to seal against the plane.
        const rowFrac = row === 0 ? -0.04 : row / ROWS;
        for (let c = 0; c < cols; c++) {
          const v = base + row * cols + c;
          const ang = (c / SEG) * Math.PI * 2;
          positions[v * 3 + 0] = Math.cos(ang) * lay.radius;
          positions[v * 3 + 1] = rowFrac;
          positions[v * 3 + 2] = Math.sin(ang) * lay.radius;
          heightA[v] = hillH[c];
          heightB[v] = skyl.heights[c];
          colorA[v * 3 + 0] = hillC[c * 3 + 0];
          colorA[v * 3 + 1] = hillC[c * 3 + 1];
          colorA[v * 3 + 2] = hillC[c * 3 + 2];
          colorB[v * 3 + 0] = skyl.colors[c * 3 + 0];
          colorB[v * 3 + 1] = skyl.colors[c * 3 + 1];
          colorB[v * 3 + 2] = skyl.colors[c * 3 + 2];
          fogMix[v] = lay.fogMix;
        }
      }

      for (let row = 0; row < ROWS; row++) {
        for (let c = 0; c < SEG; c++) {
          const a = base + row * cols + c;
          const b = a + 1;
          const d = a + cols;
          const e = d + 1;
          indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
          indices[ii++] = b; indices[ii++] = d; indices[ii++] = e;
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aHeightA', new THREE.BufferAttribute(heightA, 1));
    geo.setAttribute('aHeightB', new THREE.BufferAttribute(heightB, 1));
    geo.setAttribute('aColorA', new THREE.BufferAttribute(colorA, 3));
    geo.setAttribute('aColorB', new THREE.BufferAttribute(colorB, 3));
    geo.setAttribute('aFog', new THREE.BufferAttribute(fogMix, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }
}
