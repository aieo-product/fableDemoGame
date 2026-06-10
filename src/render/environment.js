/**
 * @file environment.js — Ground shader plane (radius-scaled procedural grid),
 * sky gradient dome, linear fog (FOG_NEAR_K*r / FOG_FAR_K*r), tier palette
 * 2s crossfade, hemisphere + directional lights (NO shadow maps), and the
 * blob shadow decal.
 *
 * SEAMLESSNESS LAW: fog distances, grid cell size and blob-shadow size are
 * continuous functions of ball radiusVisualSim — never tierIndex. tierIndex
 * drives ONLY the cosmetic palette crossfade (via the 'tierUp' bus event).
 *
 * PIXEL-IDENTITY AT RESCALE: everything here is recomputed each update() from
 * current ball state, and update() runs AFTER ScaleManager in the frame order
 * — so the rescale frame renders identically. The ONLY accumulated state is
 * the grid-phase origin, which rescale(S)/rebase(dx,dz) keep continuous:
 *   grid phase = (worldXZ + gridOrigin) / (GRID_CELL_K * r)
 *   rescale: worldXZ *= S, r *= S      => gridOrigin *= S
 *   rebase:  worldXZ -= offset         => gridOrigin += offset
 *
 * Custom fog uniforms on the ground shader replicate THREE.Fog's LINEAR
 * factor exactly, so the ground fogs identically to the Lambert instances.
 *
 * Zero-allocation: update() mutates preallocated Colors/uniform values only.
 * All Color/geometry/texture allocation happens at construction (boot).
 */

import * as THREE from 'three';
import { TIERS } from '../config/tiers.js';
import { FOG_NEAR_K, FOG_FAR_K, PALETTE_FADE_S } from '../config/tuning.js';
import { bus, EVT } from '../core/events.js';
import { easeInOutCubic, clamp01 } from '../core/mathUtils.js';

/** @typedef {import('../types.js').BallState} BallState */
/** @typedef {import('../types.js').TierUpEvent} TierUpEvent */

/** Minor grid cell size = GRID_CELL_K * radiusVisualSim (ball diameter reads well). */
const GRID_CELL_K = 2.0;
/** Ground plane extent (sim units). World coords stay within ~±2048 (rebase at 1500). */
const GROUND_SIZE = 4096;
/** Sky dome radius (sim units) — inside the camera far plane (4000). */
const SKY_RADIUS = 1800;
/** Blob shadow radius = SHADOW_SCALE_K * radiusVisualSim. */
const SHADOW_SCALE_K = 1.15;
/** Blob shadow hover height (fraction of radius) — avoids z-fighting the ground. */
const SHADOW_Y_K = 0.02;
/** Directional light direction (normalized at module load — boot-time alloc). */
const LIGHT_DIR = new THREE.Vector3(0.45, 1.0, 0.3).normalize();
/** Directional light distance from ball = LIGHT_DIST_K * radiusVisualSim. */
const LIGHT_DIST_K = 40;

/* ------------------------------------------------------------------ */
/* Shaders                                                              */
/* ------------------------------------------------------------------ */

const GROUND_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying float vFogDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const GROUND_FRAG = /* glsl */ `
uniform vec3 uGroundColor;
uniform vec3 uLineColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uCell;
uniform vec2 uGridOrigin;
varying vec3 vWorldPos;
varying float vFogDepth;

float gridLine(vec2 coord) {
  vec2 g = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
  return 1.0 - min(min(g.x, g.y), 1.0);
}

void main() {
  vec2 p = (vWorldPos.xz + uGridOrigin) / uCell;
  float minor = gridLine(p);
  float major = gridLine(p / 5.0);
  vec3 col = mix(uGroundColor, uLineColor, max(minor * 0.40, major * 0.75));
  // Linear fog — EXACTLY THREE.Fog's factor so ground matches the Lambert objects.
  float fogF = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFogColor, fogF), 1.0);
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position; // unit sphere: object-space position == view direction
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uFogColor;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 sky = mix(uBottom, uTop, pow(clamp(h, 0.0, 1.0), 0.65));
  // Melt into the fog wall at the horizon so distant objects vanish seamlessly.
  float horizon = 1.0 - smoothstep(0.02, 0.20, h);
  gl_FragColor = vec4(mix(sky, uFogColor, horizon), 1.0);
}
`;

/**
 * Environment — fog, palette, sky dome, ground grid, lights, blob shadow.
 *
 * Integration (main.js):
 *   const env = new Environment(renderer.scene, renderer.camera);
 *   ...per frame (step 6, after ScaleManager): env.update(frameDt, ballPhys.state);
 *   ScaleManager hooks: env.rescale(S); env.rebase(offsetX, offsetZ);
 *   ?r= dev start: env.setTierPaletteImmediate(startTierIndex);
 * Subscribes to 'tierUp' (palette crossfade) and 'game:reset' (snap to T0)
 * on the singleton bus.
 */
export class Environment {
  /**
   * @param {THREE.Scene} scene Owned by render/renderer.js.
   * @param {THREE.PerspectiveCamera} [camera] Optional — the sky dome follows
   *   the camera (exact pixel-identity at rescale); falls back to ball-follow.
   */
  constructor(scene, camera) {
    /** @type {THREE.Scene} */
    this._scene = scene;
    /** @type {THREE.PerspectiveCamera|null} */
    this._camera = camera !== undefined ? camera : null;

    /* --- per-tier derived palettes (boot-time allocation) --- */
    /** @type {Array<{fog:THREE.Color, skyTop:THREE.Color, skyBottom:THREE.Color, ground:THREE.Color, line:THREE.Color, hemiSky:THREE.Color, hemiGround:THREE.Color}>} */
    this._palettes = [];
    for (let i = 0; i < TIERS.length; i++) {
      const t = TIERS[i];
      const fog = new THREE.Color(t.fogColor);
      const skyTop = new THREE.Color(t.skyTop);
      const skyBottom = new THREE.Color(t.skyBottom);
      const ground = new THREE.Color(t.skyBottom).lerp(fog, 0.45).multiplyScalar(0.8);
      const line = ground.clone().multiplyScalar(0.72);
      const hemiSky = skyTop.clone();
      const hemiGround = ground.clone().multiplyScalar(0.9);
      this._palettes.push({ fog, skyTop, skyBottom, ground, line, hemiSky, hemiGround });
    }

    /* --- LIVE colors (mutated in place; referenced by fog/uniforms/lights) --- */
    /** @type {THREE.Color} */ this._cFog = new THREE.Color();
    /** @type {THREE.Color} */ this._cSkyTop = new THREE.Color();
    /** @type {THREE.Color} */ this._cSkyBottom = new THREE.Color();
    /** @type {THREE.Color} */ this._cGround = new THREE.Color();
    /** @type {THREE.Color} */ this._cLine = new THREE.Color();
    /** @type {THREE.Color} */ this._cHemiSky = new THREE.Color();
    /** @type {THREE.Color} */ this._cHemiGround = new THREE.Color();

    /* --- crossfade FROM snapshot --- */
    /** @type {THREE.Color} */ this._fFog = new THREE.Color();
    /** @type {THREE.Color} */ this._fSkyTop = new THREE.Color();
    /** @type {THREE.Color} */ this._fSkyBottom = new THREE.Color();
    /** @type {THREE.Color} */ this._fGround = new THREE.Color();
    /** @type {THREE.Color} */ this._fLine = new THREE.Color();
    /** @type {THREE.Color} */ this._fHemiSky = new THREE.Color();
    /** @type {THREE.Color} */ this._fHemiGround = new THREE.Color();
    /** @type {number} */ this._fadeT = 0;
    /** @type {number} */ this._fadeDur = 0; // 0 = not fading
    /** @type {number} */ this._toIndex = 0;

    /* --- fog --- */
    /** @type {THREE.Fog} */
    this.fog = new THREE.Fog(0xffffff, 10, 100);
    this.fog.color = this._cFog; // live ref — palette fade propagates automatically
    scene.fog = this.fog;

    /* --- lights (no shadow maps — the blob shadow reads better at every scale) --- */
    /** @type {THREE.HemisphereLight} */
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 1.15);
    this.hemiLight.color = this._cHemiSky;
    this.hemiLight.groundColor = this._cHemiGround;
    scene.add(this.hemiLight);

    /** @type {THREE.DirectionalLight} */
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    this.dirLight.position.set(LIGHT_DIR.x * 50, LIGHT_DIR.y * 50, LIGHT_DIR.z * 50);
    scene.add(this.dirLight);
    scene.add(this.dirLight.target);

    /* --- ground plane (1 draw call; grid is procedural in world XZ) --- */
    const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    /** @type {{[k:string]: {value: *}}} */
    this._groundUniforms = {
      uGroundColor: { value: this._cGround },
      uLineColor: { value: this._cLine },
      uFogColor: { value: this._cFog },
      uFogNear: { value: 10 },
      uFogFar: { value: 100 },
      uCell: { value: GRID_CELL_K },
      uGridOrigin: { value: new THREE.Vector2(0, 0) },
    };
    const groundMat = new THREE.ShaderMaterial({
      uniforms: this._groundUniforms,
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      fog: false, // custom fog uniforms above
    });
    /** @type {THREE.Mesh} */
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.frustumCulled = false;
    scene.add(this.ground);

    /* --- sky gradient dome (follows camera; gradient is direction-only) --- */
    const skyGeo = new THREE.SphereGeometry(1, 32, 16);
    /** @type {{[k:string]: {value: *}}} */
    this._skyUniforms = {
      uTop: { value: this._cSkyTop },
      uBottom: { value: this._cSkyBottom },
      uFogColor: { value: this._cFog },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this._skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    /** @type {THREE.Mesh} */
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.scale.setScalar(SKY_RADIUS);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10; // paint first; depthWrite off
    scene.add(this.sky);

    /* --- blob shadow decal (canvas radial gradient, MeshBasic transparent) --- */
    const shadowTex = this._makeShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(2, 2, 1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    /** @type {THREE.Mesh} */
    this.blobShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.blobShadow.frustumCulled = false;
    this.blobShadow.renderOrder = 1; // over the ground
    scene.add(this.blobShadow);

    this.setTierPaletteImmediate(0);

    /* --- bus subscriptions (cosmetic only) --- */
    /** @type {(p: TierUpEvent) => void} */
    this._onTierUp = (p) => this.startPaletteFade(p.tierIndex);
    bus.on(EVT.TIER_UP, this._onTierUp);
    /** @type {() => void} */
    this._onGameReset = () => this.setTierPaletteImmediate(0);
    bus.on(EVT.GAME_RESET, this._onGameReset);
  }

  /**
   * Per-frame update — call in main.js step 6 (with cameraRig/effects), i.e.
   * AFTER ScaleManager so the rescale frame is recomputed from scaled state.
   * Continuous in radius: fog 14r/55r, grid cell 2r, shadow 1.15r.
   * Zero allocation.
   * @param {number} dt Frame delta (s).
   * @param {BallState} ball The single source of ball truth.
   */
  update(dt, ball) {
    const rv = ball.radiusVisualSim;
    const gu = this._groundUniforms;

    // Fog — continuous in radius (SEAMLESSNESS LAW).
    this.fog.near = FOG_NEAR_K * rv;
    this.fog.far = FOG_FAR_K * rv;
    gu.uFogNear.value = this.fog.near;
    gu.uFogFar.value = this.fog.far;
    gu.uCell.value = GRID_CELL_K * rv;

    // Blob shadow under the ball.
    const ss = SHADOW_SCALE_K * rv;
    this.blobShadow.position.set(ball.pos.x, SHADOW_Y_K * rv, ball.pos.z);
    this.blobShadow.scale.set(ss, 1, ss);

    // Sky dome follows the camera (direction-only gradient => rescale identity).
    if (this._camera !== null) {
      this.sky.position.copy(this._camera.position);
    } else {
      this.sky.position.set(ball.pos.x, 0, ball.pos.z);
    }

    // Directional light tracks the ball at a constant direction.
    const ld = LIGHT_DIST_K * rv;
    this.dirLight.position.set(
      ball.pos.x + LIGHT_DIR.x * ld,
      ball.pos.y + LIGHT_DIR.y * ld,
      ball.pos.z + LIGHT_DIR.z * ld
    );
    this.dirLight.target.position.set(ball.pos.x, ball.pos.y, ball.pos.z);

    // Palette crossfade (cosmetic, PALETTE_FADE_S on tierUp).
    if (this._fadeDur > 0) {
      this._fadeT += dt;
      const k = easeInOutCubic(clamp01(this._fadeT / this._fadeDur));
      const p = this._palettes[this._toIndex];
      this._cFog.lerpColors(this._fFog, p.fog, k);
      this._cSkyTop.lerpColors(this._fSkyTop, p.skyTop, k);
      this._cSkyBottom.lerpColors(this._fSkyBottom, p.skyBottom, k);
      this._cGround.lerpColors(this._fGround, p.ground, k);
      this._cLine.lerpColors(this._fLine, p.line, k);
      this._cHemiSky.lerpColors(this._fHemiSky, p.hemiSky, k);
      this._cHemiGround.lerpColors(this._fHemiGround, p.hemiGround, k);
      if (this._fadeT >= this._fadeDur) this._fadeDur = 0;
    }
  }

  /**
   * ScaleManager hook — one-frame similarity rescale by S (RESCALE_S).
   * Grid phase origin is the only accumulated state and MUST scale; the
   * radius-derived values are also scaled defensively (update() recomputes
   * them from scaled ball state the same frame).
   * @param {number} S Similarity factor (0.2).
   */
  rescale(S) {
    this._groundUniforms.uGridOrigin.value.multiplyScalar(S);
    this.fog.near *= S;
    this.fog.far *= S;
    this._groundUniforms.uFogNear.value *= S;
    this._groundUniforms.uFogFar.value *= S;
    this._groundUniforms.uCell.value *= S;
    this.blobShadow.position.multiplyScalar(S);
    this.blobShadow.scale.x *= S;
    this.blobShadow.scale.z *= S;
    this.dirLight.position.multiplyScalar(S);
    this.dirLight.target.position.multiplyScalar(S);
  }

  /**
   * ScaleManager hook — floating-origin rebase. (offsetX, offsetZ) is the
   * integer-snapped shift SUBTRACTED from every world position; the grid
   * origin absorbs it so the ground pattern under the ball never jumps.
   * @param {number} offsetX Sim units subtracted from all world x.
   * @param {number} offsetZ Sim units subtracted from all world z.
   */
  rebase(offsetX, offsetZ) {
    this._groundUniforms.uGridOrigin.value.x += offsetX;
    this._groundUniforms.uGridOrigin.value.y += offsetZ;
    this.blobShadow.position.x -= offsetX;
    this.blobShadow.position.z -= offsetZ;
    this.dirLight.position.x -= offsetX;
    this.dirLight.position.z -= offsetZ;
    this.dirLight.target.position.x -= offsetX;
    this.dirLight.target.position.z -= offsetZ;
  }

  /**
   * Begin the PALETTE_FADE_S crossfade toward a tier's palette ('tierUp').
   * @param {number} tierIndex 0..5.
   */
  startPaletteFade(tierIndex) {
    this._fFog.copy(this._cFog);
    this._fSkyTop.copy(this._cSkyTop);
    this._fSkyBottom.copy(this._cSkyBottom);
    this._fGround.copy(this._cGround);
    this._fLine.copy(this._cLine);
    this._fHemiSky.copy(this._cHemiSky);
    this._fHemiGround.copy(this._cHemiGround);
    this._toIndex = tierIndex;
    this._fadeT = 0;
    this._fadeDur = PALETTE_FADE_S;
  }

  /**
   * Snap to a tier's palette with no fade (boot, game reset, ?r= dev start).
   * @param {number} tierIndex 0..5.
   */
  setTierPaletteImmediate(tierIndex) {
    const p = this._palettes[tierIndex];
    this._cFog.copy(p.fog);
    this._cSkyTop.copy(p.skyTop);
    this._cSkyBottom.copy(p.skyBottom);
    this._cGround.copy(p.ground);
    this._cLine.copy(p.line);
    this._cHemiSky.copy(p.hemiSky);
    this._cHemiGround.copy(p.hemiGround);
    this._toIndex = tierIndex;
    this._fadeDur = 0;
  }

  /** Unsubscribe + release GPU resources (teardown / tests). */
  dispose() {
    bus.off(EVT.TIER_UP, this._onTierUp);
    bus.off(EVT.GAME_RESET, this._onGameReset);
    this._scene.remove(this.sky, this.ground, this.blobShadow, this.hemiLight, this.dirLight, this.dirLight.target);
    this.ground.geometry.dispose();
    /** @type {THREE.ShaderMaterial} */ (this.ground.material).dispose();
    this.sky.geometry.dispose();
    /** @type {THREE.ShaderMaterial} */ (this.sky.material).dispose();
    this.blobShadow.geometry.dispose();
    const sm = /** @type {THREE.MeshBasicMaterial} */ (this.blobShadow.material);
    if (sm.map !== null) sm.map.dispose();
    sm.dispose();
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Canvas radial-gradient blob shadow texture (boot only). Returns null in
   * non-DOM environments (headless tests).
   * @returns {THREE.CanvasTexture|null}
   */
  _makeShadowTexture() {
    if (typeof document === 'undefined') return null;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.30)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
