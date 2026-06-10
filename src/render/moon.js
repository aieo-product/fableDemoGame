/**
 * @file moon.js — MoonView: the REAL moon mesh for the v2 finale
 * (docs/DESIGN-V2.md 月エンディング, Stream A).
 *
 * Icosphere detail 3 (~1280 tris) — the documented ONE exception to the
 * 350-tri ARCHETYPE cap: it is NOT a catalog archetype, never pooled,
 * finale-only, exactly 2 draw calls (Lambert body + additive glow shell).
 *
 * Crater vertex colors are baked ONCE at boot from
 * mulberry32(worldSeed ^ 0x4d4f4f4e) — deterministic per seed, zero runtime
 * cost. Both materials are fog:false: a DOCUMENTED seamlessness-law
 * exemption — the moon is a sky element like the dome (environment.js dome
 * meshes are already fog:false), never world scenery.
 *
 * The mesh exists in SIM SPACE only from finale DESCENT onward; the finale
 * owns its pose every frame via setPose (derived from its rescale/rebase-safe
 * _simCache), so MoonView itself holds NO rescale-sensitive state and
 * subscribes to nothing.
 */

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { clamp01 } from '../core/mathUtils.js';

/** Seed salt for the crater bake ('MOON'). */
const MOON_SEED_SALT = 0x4d4f4f4e;
/** Glow shell scale relative to the moon body. */
const GLOW_SCALE = 1.18;
/** Glow shell opacity at setGlow01(1). */
const GLOW_OPACITY_MAX = 0.4;
/** Warm halo tint. */
const GLOW_COLOR = 0xfff0c2;
/** Number of baked craters. */
const CRATER_COUNT = 26;
/** Moon base albedo (warm pale regolith). */
const BASE_R = 0.93;
const BASE_G = 0.9;
const BASE_B = 0.8;

/**
 * Position-hash noise in [0,1] — consistent for coincident (duplicated)
 * vertices so the speckle never shows facet seams.
 * @param {number} x @param {number} y @param {number} z Unit-sphere coords.
 * @returns {number}
 */
function hash01(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The finale's moon. Construct once at boot (hidden); the finale shows it at
 * DESCENT and drives setPose/setGlow01/setSpin per frame.
 */
export class MoonView {
  /**
   * @param {THREE.Scene} scene Scene to attach the (initially hidden) moon group to.
   * @param {number} worldSeed uint32 world seed — crater layout is seeded.
   */
  constructor(scene, worldSeed) {
    const rng = mulberry32((worldSeed ^ MOON_SEED_SALT) >>> 0);

    /** @type {THREE.IcosahedronGeometry} Shared by body + glow shell.
     *  NOTE: three.js PolyhedronGeometry detail d = (d+1)^2 tris per face,
     *  so detail 7 = 20 * 64 = 1280 tris — the "icosphere detail 3" of the
     *  design speaks classic 4^k subdivision; the BUDGETED ~1280 tris is the
     *  binding number and is asserted by the Stream A headless smoke test. */
    this._geo = new THREE.IcosahedronGeometry(1, 7);
    this._bakeCraterColors(this._geo, rng);

    /** @type {THREE.MeshLambertMaterial} */
    this._mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
    /** @type {THREE.Mesh} */
    this._mesh = new THREE.Mesh(this._geo, this._mat);
    this._mesh.frustumCulled = false; // finale-only, huge, always meant to be seen

    /** @type {THREE.MeshBasicMaterial} Additive backside glow shell. */
    this._glowMat = new THREE.MeshBasicMaterial({
      color: GLOW_COLOR,
      fog: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    /** @type {THREE.Mesh} */
    this._glow = new THREE.Mesh(this._geo, this._glowMat);
    this._glow.scale.setScalar(GLOW_SCALE);
    this._glow.frustumCulled = false;

    /** @type {THREE.Group} Pose target (position + uniform radius scale). */
    this.group = new THREE.Group();
    this.group.add(this._mesh);
    this.group.add(this._glow);
    this.group.visible = false;
    this._scene = scene;
    scene.add(this.group);
  }

  /**
   * Bake crater + speckle vertex colors (boot-time only).
   * @param {THREE.BufferGeometry} geo Unit icosphere.
   * @param {() => number} rng Seeded PRNG.
   */
  _bakeCraterColors(geo, rng) {
    // Crater table: direction (unit), cos(angular radius), depth.
    const cx = new Float32Array(CRATER_COUNT);
    const cy = new Float32Array(CRATER_COUNT);
    const cz = new Float32Array(CRATER_COUNT);
    const cCos = new Float32Array(CRATER_COUNT);
    const cDepth = new Float32Array(CRATER_COUNT);
    for (let i = 0; i < CRATER_COUNT; i++) {
      let x = 0;
      let y = 0;
      let z = 0;
      let l = 0;
      do {
        x = rng() * 2 - 1;
        y = rng() * 2 - 1;
        z = rng() * 2 - 1;
        l = Math.hypot(x, y, z);
      } while (l < 1e-3);
      cx[i] = x / l;
      cy[i] = y / l;
      cz[i] = z / l;
      const angR = 0.06 + 0.3 * rng(); // angular radius (rad)
      cCos[i] = Math.cos(angR);
      cDepth[i] = 0.25 + 0.35 * rng();
    }

    const pos = geo.getAttribute('position');
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const px = pos.getX(v);
      const py = pos.getY(v);
      const pz = pos.getZ(v); // unit sphere => already normalized
      let shade = 0.94 + 0.12 * hash01(px, py, pz); // regolith speckle
      for (let i = 0; i < CRATER_COUNT; i++) {
        const d = px * cx[i] + py * cy[i] + pz * cz[i];
        if (d <= cCos[i]) continue;
        const t = (d - cCos[i]) / (1 - cCos[i]); // 0 at rim .. 1 at center
        // Bowl darkening with a faint bright rim just inside the edge.
        shade -= cDepth[i] * t * t;
        if (t < 0.25) shade += 0.1 * (1 - t / 0.25);
      }
      if (shade < 0.35) shade = 0.35;
      else if (shade > 1.1) shade = 1.1;
      colors[v * 3] = BASE_R * shade;
      colors[v * 3 + 1] = BASE_G * shade;
      colors[v * 3 + 2] = BASE_B * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  /**
   * Place + size the moon (sim space). Called every finale frame — the pose
   * is derived from the finale's rescale/rebase-covered _simCache.
   * @param {number} x @param {number} y @param {number} z Center, sim units.
   * @param {number} radiusSim Moon radius in sim units (uniform group scale).
   */
  setPose(x, y, z, radiusSim) {
    this.group.position.set(x, y, z);
    this.group.scale.setScalar(radiusSim);
  }

  /**
   * Show/hide the whole moon (hidden outside DESCENT..AFTERGLOW).
   * @param {boolean} b
   */
  setVisible(b) {
    this.group.visible = b;
  }

  /**
   * Halo strength 0..1 (afterglow breathing etc.).
   * @param {number} k
   */
  setGlow01(k) {
    this._glowMat.opacity = GLOW_OPACITY_MAX * clamp01(k);
  }

  /**
   * Absolute spin angle (rad) around the moon's local Y axis — craters turn,
   * the symmetric glow shell stays put. Dimensionless => rescale-invariant.
   * @param {number} rad
   */
  setSpin(rad) {
    this._mesh.rotation.y = rad;
  }

  /** Remove from the scene and free GPU resources (not used in normal play —
   *  the moon is constructed once and lives for the session). */
  dispose() {
    this._scene.remove(this.group);
    this._geo.dispose();
    this._mat.dispose();
    this._glowMat.dispose();
  }
}
