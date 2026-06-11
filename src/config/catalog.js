/**
 * @file catalog.js — v3 箱庭東京: all 94 archetypes.
 *
 * 70 CHUNK archetypes (ARCH_PER_TIER 10 x 7 tiers, ids FROZEN by
 * config/tiers.js; slots [8]/[9] of every tier are CHUNK LANDMARKS —
 * radiusNominal ~2.5-4x the tier's largest absorbable, spawnWeight 0.25-0.35,
 * upright, archRoll-eligible only at chunk placement j === 0) PLUS 24 EXTRA
 * curated archetypes (codes 70..93 FROZEN by docs/DESIGN-V3.md Phase-0
 * appendix: 12 collectibles, 10 landmark singletons + ハチ公 dual, shop
 * shell, Skytree display-name slot). EXTRA entries are spawned ONLY by
 * world/curated.js from cityMap placements (spawnWeight 0 — never
 * random-rolled); code 93 (東京スカイツリー) is a display-name reservation
 * and must NEVER be spawned into the store.
 *
 * v3 ADDITIONS per entry: displayNameJa (the FROZEN Japanese display string
 * — hud absorb-name floats, collection album, landmark toasts) and
 * naturalBand (tier-table band 0..6 — curated dynamic re-banding stamps
 * store.tierOf[slot] = clamp(naturalBand, tierIndex-1, tierIndex+1)).
 * For chunk entries naturalBand === tier; for EXTRA entries tier IS the
 * naturalBand (types.js Archetype contract).
 *
 * EXPORTS (Phase-0 frozen shapes): CATALOG (94 ids), DISPLAY_NAME_BY_CODE
 * (string[94], code-indexed), EXTRA_CATALOG (code 70..93 -> archetype),
 * EXTRA_SIZE_CLASS_BY_CODE + EXTRA_POOL_CAPS (the 4 shared EXTRA render
 * pools: collectible-small/landmark-mid/landmark-large/landmark-xl — flat
 * +4 draws in the 64/72 ledger).
 *
 * Each archetype's buildGeometry(rng) returns ONE merged, vertex-colored
 * BufferGeometry composed of a handful of low-segment primitives
 * (<= ARCHETYPE_TRI_CAP = 350 triangles). Built ONCE at boot by
 * render/geometryFactory.js — allocation here is fine, per-frame code never
 * touches this module.
 *
 * GEOMETRY CONVENTION (binding for spawner / curated / instances / absorb):
 *   - Every returned geometry is normalized to a UNIT BOUNDING SPHERE
 *     (radius 1.0) centered at the geometry origin. Instance scale =
 *     the placed object's radiusSim, directly.
 *   - yOffset positions the object center at restY = radius * (1 + yOffset),
 *     so yOffset = 0 means "sphere sitting on the ground" and flat objects
 *     (coin-likes, decals) use strongly negative offsets. Values were
 *     measured from the normalized geometry (yOffset = -1 - minY_unit)
 *     and rounded.
 *   - Vertex colors are baked in WORKING (linear) color space via THREE.Color;
 *     palette entries are hex tints applied per-instance via instanceColor
 *     (final color = vertexColor * instanceColor under MeshLambertMaterial
 *     {vertexColors:true}). Archetypes whose "body" part is baked near-white
 *     use saturated palettes; fixed-color parts (wheels, metal) are baked
 *     dark/desaturated so tints only nudge them.
 *
 * Chunk archetype ids are FROZEN by config/tiers.js; EXTRA ids/codes by
 * world/objects.js EXTRA_ARCHETYPE_IDS — both asserted below in dev mode.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TIERS, ARCH_PER_TIER } from './tiers.js';
import { EXTRA_ARCHETYPE_IDS, EXTRA_CODE_BASE } from '../world/objects.js';

/** @typedef {import('../types.js').Archetype} Archetype */

/* ================================================================== */
/* Boot-time build helpers (never called per-frame)                    */
/* ================================================================== */

const _CA = new THREE.Color();
const _CB = new THREE.Color();
const _CC = new THREE.Color();

const PI = Math.PI;
const HALF_PI = Math.PI / 2;

/**
 * Bake a flat (or vertical-gradient) vertex-color attribute onto a geometry.
 * @param {THREE.BufferGeometry} geo Geometry to paint (mutated).
 * @param {number} hex Base color (sRGB hex; converted to linear).
 * @param {number} [hex2] Optional second color — vertical gradient bottom(hex)->top(hex2).
 * @returns {THREE.BufferGeometry} The same geometry.
 */
function paint(geo, hex, hex2) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  _CA.setHex(hex);
  if (hex2 !== undefined && hex2 !== hex) {
    geo.computeBoundingBox();
    const minY = geo.boundingBox.min.y;
    const span = Math.max(1e-6, geo.boundingBox.max.y - minY);
    _CB.setHex(hex2);
    for (let i = 0; i < n; i++) {
      const t = (pos.getY(i) - minY) / span;
      _CC.copy(_CA).lerp(_CB, t);
      arr[i * 3] = _CC.r;
      arr[i * 3 + 1] = _CC.g;
      arr[i * 3 + 2] = _CC.b;
    }
  } else {
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _CA.r;
      arr[i * 3 + 1] = _CA.g;
      arr[i * 3 + 2] = _CA.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Transform options for a part.
 * @typedef {Object} XfOpts
 * @property {number} [x] @property {number} [y] @property {number} [z]
 * @property {number} [rx] @property {number} [ry] @property {number} [rz]
 * @property {number} [sx] @property {number} [sy] @property {number} [sz]
 * @property {number} [hex2] Vertical gradient top color.
 */

/**
 * Apply scale -> rotation -> translation, then bake the vertex color.
 * @param {THREE.BufferGeometry} geo @param {number} hex @param {XfOpts} [o]
 * @returns {THREE.BufferGeometry}
 */
function xf(geo, hex, o) {
  if (o !== undefined) {
    if (o.sx !== undefined || o.sy !== undefined || o.sz !== undefined) {
      geo.scale(o.sx !== undefined ? o.sx : 1, o.sy !== undefined ? o.sy : 1, o.sz !== undefined ? o.sz : 1);
    }
    if (o.rx) geo.rotateX(o.rx);
    if (o.ry) geo.rotateY(o.ry);
    if (o.rz) geo.rotateZ(o.rz);
    if (o.x || o.y || o.z) geo.translate(o.x || 0, o.y || 0, o.z || 0);
  }
  return paint(geo, hex, o !== undefined ? o.hex2 : undefined);
}

/** @param {number} w @param {number} h @param {number} d @param {number} hex @param {XfOpts} [o] */
function box(w, h, d, hex, o) {
  return xf(new THREE.BoxGeometry(w, h, d), hex, o);
}

/** @param {number} rt @param {number} rb @param {number} h @param {number} seg @param {number} hex @param {XfOpts & {theta0?:number, thetaLen?:number, open?:boolean}} [o] */
function cyl(rt, rb, h, seg, hex, o) {
  const theta0 = o !== undefined && o.theta0 !== undefined ? o.theta0 : 0;
  const thetaLen = o !== undefined && o.thetaLen !== undefined ? o.thetaLen : PI * 2;
  const open = o !== undefined && o.open === true;
  return xf(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, theta0, thetaLen), hex, o);
}

/** @param {number} r @param {number} h @param {number} seg @param {number} hex @param {XfOpts} [o] */
function cone(r, h, seg, hex, o) {
  return xf(new THREE.ConeGeometry(r, h, seg), hex, o);
}

/** @param {number} r @param {number} hex @param {XfOpts & {ws?:number, hs?:number, theta0?:number, thetaLen?:number}} [o] */
function sph(r, hex, o) {
  const ws = o !== undefined && o.ws !== undefined ? o.ws : 7;
  const hs = o !== undefined && o.hs !== undefined ? o.hs : 5;
  const theta0 = o !== undefined && o.theta0 !== undefined ? o.theta0 : 0;
  const thetaLen = o !== undefined && o.thetaLen !== undefined ? o.thetaLen : PI;
  return xf(new THREE.SphereGeometry(r, ws, hs, 0, PI * 2, theta0, thetaLen), hex, o);
}

/** @param {number} r @param {0|1} detail @param {number} hex @param {XfOpts} [o] */
function ico(r, detail, hex, o) {
  return xf(new THREE.IcosahedronGeometry(r, detail), hex, o);
}

/** @param {number} r @param {number} tube @param {number} rs @param {number} ts @param {number} hex @param {XfOpts & {arc?:number}} [o] */
function torus(r, tube, rs, ts, hex, o) {
  const arc = o !== undefined && o.arc !== undefined ? o.arc : PI * 2;
  return xf(new THREE.TorusGeometry(r, tube, rs, ts, arc), hex, o);
}

/**
 * Banded tower: one BoxGeometry with heightSegments=floors and vertex colors
 * alternating wall / window rows; rng lights up random window bands (the
 * "vertex-color window bands" of mansions and skyscrapers).
 * @param {number} w @param {number} h @param {number} d
 * @param {number} floors Height segments (one band boundary per floor).
 * @param {number} wallHex @param {number} winHex @param {number} litHex
 * @param {() => number} rng Boot rng for lit-window variation.
 * @param {XfOpts} [o]
 * @returns {THREE.BufferGeometry}
 */
function towerBanded(w, h, d, floors, wallHex, winHex, litHex, rng, o) {
  const geo = new THREE.BoxGeometry(w, h, d, 1, floors, 1);
  // Per-row lit factor, decided once per row (deterministic per boot rng).
  const lit = new Array(floors + 1);
  for (let f = 0; f <= floors; f++) lit[f] = rng() < 0.4 ? 0.4 + rng() * 0.6 : 0;
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  const wall = new THREE.Color(wallHex);
  const win = new THREE.Color(winHex);
  const litC = new THREE.Color(litHex);
  for (let i = 0; i < n; i++) {
    const t = pos.getY(i) / h + 0.5; // 0 bottom .. 1 top
    const row = Math.max(0, Math.min(floors, Math.round(t * floors)));
    if (row % 2 === 1) {
      _CC.copy(win).lerp(litC, lit[row]);
    } else {
      _CC.copy(wall);
    }
    arr[i * 3] = _CC.r;
    arr[i * 3 + 1] = _CC.g;
    arr[i * 3 + 2] = _CC.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (o !== undefined) {
    if (o.rx) geo.rotateX(o.rx);
    if (o.ry) geo.rotateY(o.ry);
    if (o.rz) geo.rotateZ(o.rz);
    if (o.x || o.y || o.z) geo.translate(o.x || 0, o.y || 0, o.z || 0);
  }
  return geo;
}

/**
 * Merge parts, recenter on the bounding-sphere center and normalize to a
 * unit bounding sphere (radius exactly 1.0). Disposes the input parts.
 * @param {THREE.BufferGeometry[]} parts
 * @returns {THREE.BufferGeometry}
 */
function finish(parts) {
  // Icosahedron/Polyhedron geometries are non-indexed while Box/Cylinder/etc
  // are indexed — mergeGeometries requires consistency, so flatten everything.
  const flat = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    flat[i] = parts[i].index !== null ? parts[i].toNonIndexed() : parts[i];
  }
  const merged = mergeGeometries(flat, false);
  for (let i = 0; i < parts.length; i++) {
    if (flat[i] !== parts[i]) flat[i].dispose();
    parts[i].dispose();
  }
  merged.computeBoundingSphere();
  const bs = merged.boundingSphere;
  merged.translate(-bs.center.x, -bs.center.y, -bs.center.z);
  const inv = 1 / Math.max(1e-6, bs.radius);
  merged.scale(inv, inv, inv);
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/* ================================================================== */
/* The catalog                                                         */
/* ================================================================== */

/** @type {Record<string, Archetype>} */
export const CATALOG = {};

/** @param {Archetype} a */
function add(a) {
  CATALOG[a.id] = a;
}

/* ------------------------------------------------------------------ */
/* T0 — パーツ棚 Parts Bin (objects ~0.5-1.2 cm radius)                  */
/* ------------------------------------------------------------------ */

add({
  id: 'screw',
  displayNameJa: 'ネジ',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.006,
  radiusJitter: 0.25,
  spawnWeight: 1.5,
  palette: [0x9aa0a8, 0xc8b46a, 0xb8c0cc, 0x8a8068, 0xd0d4da],
  yOffset: -0.19,
  upright: false,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      cyl(0.5, 0.5, 0.22, 10, 0xffffff, { y: 1.0 }), // pan head (tinted metal)
      box(0.74, 0.07, 0.16, 0x5a5f66, { y: 1.13 }), // driver slot
      cyl(0.17, 0.13, 0.95, 6, 0xe2e6ea, { y: 0.45 }), // shaft
      cyl(0.21, 0.21, 0.07, 6, 0xc8ccd2, { y: 0.62 }), // thread ridge
      cyl(0.2, 0.2, 0.07, 6, 0xc8ccd2, { y: 0.42 }), // thread ridge
      cyl(0.18, 0.18, 0.07, 6, 0xc8ccd2, { y: 0.22 }), // thread ridge
    ]);
  },
});

add({
  id: 'resistor',
  displayNameJa: '抵抗',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.005,
  radiusJitter: 0.25,
  spawnWeight: 1.5,
  palette: [0xd8b88a, 0xc9a474, 0xe0c49a, 0xd0ac80],
  yOffset: -0.69,
  upright: false,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      cyl(0.34, 0.34, 1.1, 8, 0xffffff, { rz: HALF_PI, y: 0.34 }), // tan body (tinted)
      cyl(0.36, 0.36, 0.12, 8, 0xb0483a, { rz: HALF_PI, x: -0.28, y: 0.34 }), // band: red
      cyl(0.36, 0.36, 0.12, 8, 0x3a3f48, { rz: HALF_PI, x: 0.0, y: 0.34 }), // band: black
      cyl(0.36, 0.36, 0.12, 8, 0xc89a3a, { rz: HALF_PI, x: 0.28, y: 0.34 }), // band: gold
      cyl(0.06, 0.06, 0.65, 5, 0xc8ccd4, { rz: HALF_PI, x: 0.85, y: 0.34 }), // lead +x
      cyl(0.06, 0.06, 0.65, 5, 0xc8ccd4, { rz: HALF_PI, x: -0.85, y: 0.34 }), // lead -x
    ]);
  },
});

add({
  id: 'capacitor',
  displayNameJa: 'コンデンサ',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.007,
  radiusJitter: 0.25,
  spawnWeight: 1.4,
  palette: [0x3a4a8a, 0x2e6a5a, 0x6a3a8a, 0x8a3a3a, 0x3a3f48],
  yOffset: -0.1,
  upright: false,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      cyl(0.42, 0.42, 1.05, 9, 0xffffff, { y: 0.62, hex2: 0xd0d6e8 }), // electrolytic can (tinted sleeve)
      cyl(0.43, 0.43, 0.14, 9, 0xe8ecf0, { y: 1.1 }), // top rim
      box(0.4, 0.05, 0.1, 0x9aa0aa, { y: 1.18 }), // vent score
      cyl(0.05, 0.05, 0.5, 5, 0xc8ccd4, { x: -0.15, y: -0.1 }), // lead
      cyl(0.05, 0.05, 0.5, 5, 0xc8ccd4, { x: 0.15, y: -0.1 }), // lead
    ]);
  },
});

add({
  id: 'ic_chip',
  displayNameJa: 'ICチップ',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.009,
  radiusJitter: 0.2,
  spawnWeight: 1.2,
  palette: [0x2e3138, 0x3a3f48, 0x26292e, 0x42464e],
  yOffset: -0.72,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    const parts = [
      box(1.7, 0.32, 0.95, 0xffffff, { y: 0.3 }), // epoxy package (tinted near-black)
      cyl(0.09, 0.09, 0.05, 8, 0x16181c, { x: -0.62, y: 0.47, z: 0.28 }), // pin-1 dot
    ];
    for (let i = 0; i < 4; i++) {
      const x = -0.55 + i * 0.37;
      parts.push(box(0.14, 0.16, 0.22, 0xd8dce2, { x, y: 0.12, z: 0.56 })); // legs near
      parts.push(box(0.14, 0.16, 0.22, 0xd8dce2, { x, y: 0.12, z: -0.56 })); // legs far
    }
    return finish(parts);
  },
});

add({
  id: 'led',
  displayNameJa: 'LED',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.005,
  radiusJitter: 0.25,
  spawnWeight: 1.4,
  palette: [0xff5340, 0x49c45f, 0x3f8cff, 0xffd84d, 0xff8a3d],
  yOffset: -0.03,
  upright: false,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      cyl(0.42, 0.42, 0.55, 9, 0xffffff, { y: 0.62 }), // lens body (tinted)
      sph(0.42, 0xffffff, { ws: 9, hs: 5, theta0: 0, thetaLen: HALF_PI, y: 0.9 }), // dome
      cyl(0.5, 0.5, 0.1, 9, 0xf2f2f6, { y: 0.32 }), // flange rim
      cyl(0.05, 0.05, 0.6, 5, 0xc8ccd4, { x: -0.14, y: 0 }), // lead (long)
      cyl(0.05, 0.05, 0.45, 5, 0xc8ccd4, { x: 0.14, y: -0.07 }), // lead (short)
    ]);
  },
});

add({
  id: 'button_battery',
  displayNameJa: 'ボタン電池',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.008,
  radiusJitter: 0.2,
  spawnWeight: 1.2,
  palette: [0xd8dce2, 0xc9ccd4, 0xe8e3da, 0xb8c0cc],
  yOffset: -0.88,
  upright: true,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      cyl(1, 1, 0.22, 14, 0xe8ecf0), // cell body (tinted steel)
      cyl(0.78, 0.78, 0.3, 12, 0xd2d6dc), // raised + terminal
      box(0.4, 0.05, 0.12, 0x8a9098, { y: 0.16 }), // engraving mark
    ]);
  },
});

add({
  id: 'eraser',
  displayNameJa: '消しゴム',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.012,
  radiusJitter: 0.25,
  spawnWeight: 1.1,
  palette: [0xff8fb0, 0x8fd0ff, 0xffffff, 0xb8f0c0, 0xffe28a],
  yOffset: -0.67,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.6, 0.55, 0.8, 0xffffff), // rubber (tinted)
      box(0.9, 0.62, 0.86, 0xeef0f4, { x: -0.32 }), // paper sleeve
    ]);
  },
});

add({
  id: 'paperclip',
  displayNameJa: 'クリップ',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.01,
  radiusJitter: 0.25,
  spawnWeight: 1.3,
  palette: [0xc8d0dc, 0xff7a6a, 0x7ab0ff, 0xffd06a, 0x9adfb0],
  yOffset: -0.77,
  upright: true,
  collisionScale: 0.75,
  buildGeometry(rng) {
    return finish([
      torus(0.55, 0.08, 4, 10, 0xb8c0cc, { sz: 1.7, rx: HALF_PI }), // outer loop, flat
      torus(0.36, 0.08, 4, 10, 0xb8c0cc, { sz: 1.8, rx: HALF_PI, x: 0.1 }), // inner loop
    ]);
  },
});

/* ---- T0 chunk landmarks (slots 8/9) ------------------------------- */

add({
  id: 'junk_board',
  displayNameJa: 'ジャンク基板',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.05,
  radiusJitter: 0.15,
  spawnWeight: 0.3,
  palette: [0x2f7a4a, 0x2a6a8a, 0x7a3a3a, 0x3a6a3a],
  yOffset: -0.82,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    const parts = [
      box(2.1, 0.1, 1.5, 0xffffff, { y: 0.05 }), // PCB substrate (tinted green)
      box(0.5, 0.16, 0.5, 0x26292e, { x: -0.5, y: 0.18, z: -0.3 }), // big IC
      box(0.32, 0.14, 0.32, 0x26292e, { x: 0.35, y: 0.17, z: 0.35 }), // small IC
      cyl(0.14, 0.14, 0.3, 7, 0x3a4a8a, { x: 0.65, y: 0.25, z: -0.4 }), // cap can
      cyl(0.12, 0.12, 0.26, 7, 0x8a3a3a, { x: 0.15, y: 0.23, z: -0.5 }), // cap can
      box(0.7, 0.12, 0.2, 0xd8dce2, { x: -0.6, y: 0.16, z: 0.55 }), // edge connector
    ];
    return finish(parts);
  },
});

add({
  id: 'soldering_iron',
  displayNameJa: 'はんだごて',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.06,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0x3f6cc4, 0xc94f46, 0x3f8a5f, 0x4a4f5a],
  yOffset: -0.79,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    return finish([
      cyl(0.28, 0.32, 1.2, 8, 0xffffff, { rz: HALF_PI, x: -0.7, y: 0.32 }), // grip (tinted)
      cyl(0.12, 0.16, 1.0, 6, 0xc8ccd2, { rz: HALF_PI, x: 0.35, y: 0.32 }), // barrel
      cone(0.07, 0.45, 6, 0x8a9098, { rz: -HALF_PI, x: 1.05, y: 0.32 }), // tip
      cyl(0.3, 0.34, 0.12, 8, 0x3a3f48, { x: -1.25, y: 0.32, rz: HALF_PI }), // cable boot
      torus(0.3, 0.06, 4, 8, 0x3a3f48, { rx: HALF_PI, x: -1.6, y: 0.12 }), // coiled cable
    ]);
  },
});

/* ------------------------------------------------------------------ */
/* T1 — ショップ Shop Floor (objects ~4-30 cm radius)                    */
/* ------------------------------------------------------------------ */

add({
  id: 'mouse',
  displayNameJa: 'マウス',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.045,
  radiusJitter: 0.2,
  spawnWeight: 1.4,
  palette: [0xe8e8e2, 0x3a3f48, 0xff5340, 0x3f8cff, 0xc8ccd4],
  yOffset: -0.69,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      sph(0.75, 0xffffff, { ws: 9, hs: 6, sx: 1.35, sy: 0.62, y: 0.4 }), // shell (tinted)
      cyl(0.1, 0.1, 0.22, 6, 0x6a7078, { rx: 0.3, x: 0.55, y: 0.62 }), // scroll wheel
      box(0.04, 0.04, 0.5, 0x6a7078, { x: 1.1, y: 0.5, z: 0 }), // cable stub
      box(0.9, 0.04, 0.04, 0x6a7078, { x: 1.5, y: 0.5 }), // cable run
    ]);
  },
});

add({
  id: 'game_soft',
  displayNameJa: 'ゲームソフト',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.05,
  radiusJitter: 0.2,
  spawnWeight: 1.5,
  palette: [0xc94f46, 0x3f6cc4, 0x3f9a5f, 0x8a5cc4, 0xe0a050, 0x36454f],
  yOffset: -0.88,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      box(1.45, 0.22, 1.85, 0xffffff), // case (tinted cover art)
      box(1.3, 0.26, 1.6, 0xf2f2ee, { x: 0.04 }), // inner cart sleeve
      box(1.45, 0.1, 0.4, 0xe8e4da, { z: -0.75, y: 0.1 }), // title band
    ]);
  },
});

add({
  id: 'junk_hdd',
  displayNameJa: 'ジャンクHDD',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.06,
  radiusJitter: 0.15,
  spawnWeight: 1.2,
  palette: [0xb8bec8, 0x9aa4b0, 0xc8ccd4, 0x8a9098],
  yOffset: -0.78,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.7, 0.4, 1.2, 0xffffff, { y: 0.2 }), // chassis (tinted alloy)
      cyl(0.42, 0.42, 0.06, 12, 0xe2e6ea, { x: -0.25, y: 0.44, z: 0.1 }), // platter lid disc
      box(0.5, 0.06, 0.16, 0xd2d6dc, { rz: 0.0, ry: 0.6, x: 0.45, y: 0.44, z: -0.25 }), // head arm
      box(1.5, 0.12, 0.95, 0x3f9a5f, { y: -0.04 }), // exposed PCB underside
      box(0.4, 0.16, 0.2, 0x26292e, { x: 0.6, y: 0.2, z: 0.62 }), // connector block
    ]);
  },
});

add({
  id: 'speaker',
  displayNameJa: 'スピーカー',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.12,
  radiusJitter: 0.2,
  spawnWeight: 1.0,
  palette: [0x3a3f48, 0x4a3a2e, 0x2e3138, 0x5a4a3a],
  yOffset: -0.26,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      box(1.0, 1.55, 0.85, 0xffffff, { y: 0.78 }), // cabinet (tinted)
      cyl(0.34, 0.34, 0.1, 11, 0x16181c, { rx: HALF_PI, y: 0.45, z: 0.45 }), // woofer ring
      cone(0.26, 0.12, 11, 0x3a3f48, { rx: -HALF_PI, y: 0.45, z: 0.48 }), // woofer cone
      cyl(0.16, 0.16, 0.1, 9, 0x16181c, { rx: HALF_PI, y: 1.12, z: 0.45 }), // tweeter
      box(1.06, 0.08, 0.9, 0x6a5a48, { y: 1.58 }), // top trim
    ]);
  },
});

add({
  id: 'toolbox',
  displayNameJa: '工具箱',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.16,
  radiusJitter: 0.2,
  spawnWeight: 0.9,
  palette: [0xc94f46, 0x3f6cc4, 0xe0a050, 0x3f8a5f],
  yOffset: -0.6,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.8, 0.65, 0.85, 0xffffff, { y: 0.33 }), // bin (tinted)
      box(1.84, 0.22, 0.89, 0xf2f2ee, { y: 0.75 }), // lid
      box(0.5, 0.1, 0.16, 0x3a3f48, { y: 0.92 }), // handle bar
      box(0.08, 0.14, 0.16, 0x3a3f48, { x: -0.22, y: 0.84 }), // handle post
      box(0.08, 0.14, 0.16, 0x3a3f48, { x: 0.22, y: 0.84 }), // handle post
      box(0.2, 0.18, 0.06, 0xd8dce2, { y: 0.62, z: 0.45 }), // latch
    ]);
  },
});

add({
  id: 'magazine_stack',
  displayNameJa: '雑誌たば',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.18,
  radiusJitter: 0.2,
  spawnWeight: 1.1,
  palette: [0xe8e0d0, 0xd0e0e8, 0xf0d8d8, 0xe0e8d0],
  yOffset: -0.65,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    const parts = [];
    const hexes = [0xffffff, 0xf2ece0, 0xe8eef2, 0xf6f0e6];
    for (let i = 0; i < 4; i++) {
      parts.push(
        box(1.5, 0.22, 1.95, hexes[i], {
          y: 0.12 + i * 0.23,
          ry: (rng() - 0.5) * 0.3,
        })
      );
    }
    parts.push(box(1.56, 0.06, 0.1, 0xc9a06a, { y: 0.5 })); // twine X
    parts.push(box(0.1, 0.06, 2.0, 0xc9a06a, { y: 0.52 })); // twine Z
    return finish(parts);
  },
});

add({
  id: 'round_stool',
  displayNameJa: '丸イス',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.3,
  radiusJitter: 0.2,
  spawnWeight: 0.9,
  palette: [0xb07a3f, 0x8a6a4a, 0xd8b88a, 0x6a7a8a],
  yOffset: -0.34,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      cyl(0.6, 0.6, 0.16, 10, 0xffffff, { y: 0.95 }), // seat (tinted)
      cyl(0.07, 0.09, 0.95, 6, 0xa07848, { rz: 0.2, x: -0.35, y: 0.45 }), // leg
      cyl(0.07, 0.09, 0.95, 6, 0xa07848, { rz: -0.1, rx: 0.18, x: 0.22, z: -0.3, y: 0.45 }), // leg
      cyl(0.07, 0.09, 0.95, 6, 0xa07848, { rz: -0.1, rx: -0.18, x: 0.22, z: 0.3, y: 0.45 }), // leg
    ]);
  },
});

add({
  id: 'cardboard_box',
  displayNameJa: 'ダンボール箱',
  tier: 1,
  naturalBand: 1,
  radiusJitter: 0.25,
  radiusNominal: 0.28,
  spawnWeight: 1.2,
  palette: [0xc9a06a, 0xb8905a, 0xd4ac78, 0xc09a64],
  yOffset: -0.5,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      box(1.5, 1.05, 1.25, 0xffffff, { y: 0.52 }), // carton (tinted kraft)
      box(1.54, 0.1, 0.34, 0xb8893f, { y: 1.05 }), // packing tape
      box(0.62, 0.06, 1.29, 0xd8b88a, { x: -0.42, y: 1.07, rz: 0.06 }), // open flap L
      box(0.62, 0.06, 1.29, 0xd8b88a, { x: 0.42, y: 1.07, rz: -0.06 }), // open flap R
      box(0.5, 0.3, 0.04, 0x8a6a4a, { y: 0.55, z: 0.64 }), // print label
    ]);
  },
});

/* ---- T1 chunk landmarks (slots 8/9) ------------------------------- */

add({
  id: 'parts_rack',
  displayNameJa: 'パーツ棚ラック',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.9,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0x9aa4b0, 0x8a9098, 0xb0b8c4, 0x7a8088],
  yOffset: -0.24,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    const parts = [
      box(0.12, 2.0, 0.62, 0xffffff, { x: -0.74, y: 1.0 }), // steel side (tinted)
      box(0.12, 2.0, 0.62, 0xffffff, { x: 0.74, y: 1.0 }), // side
      box(1.6, 0.12, 0.62, 0xffffff, { y: 1.94 }), // top
      box(1.6, 0.12, 0.62, 0xffffff, { y: 0.06 }), // bottom
      box(1.6, 2.0, 0.08, 0xd8dce2, { y: 1.0, z: -0.27 }), // back panel
      box(1.36, 0.08, 0.56, 0xffffff, { y: 0.72 }), // shelf
      box(1.36, 0.08, 0.56, 0xffffff, { y: 1.36 }), // shelf
    ];
    // 12 colorful parts bins, 3 rows x 4 (deterministic per-boot rng heights/colors)
    const binHex = [0xc94f46, 0x3f6cc4, 0x3f9a5f, 0xe0a050, 0x8a5cc4, 0x4aa0a8];
    const rowY = [0.12, 0.76, 1.4];
    for (let row = 0; row < 3; row++) {
      for (let b = 0; b < 4; b++) {
        const h = 0.34 + rng() * 0.12;
        parts.push(
          box(0.26, h, 0.46, binHex[(rng() * binHex.length) | 0], {
            x: -0.45 + b * 0.3,
            y: rowY[row] + h / 2,
          })
        );
      }
    }
    return finish(parts);
  },
});

add({
  id: 'arcade_cabinet',
  displayNameJa: 'アーケード筐体',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.8,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0xe8e8e2, 0xc94f46, 0x3f6cc4, 0xf2f2ee],
  yOffset: -0.22,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      box(1.1, 1.9, 0.95, 0xffffff, { y: 0.95 }), // cabinet (tinted)
      box(0.86, 0.62, 0.1, 0x16181c, { rx: -0.18, y: 1.32, z: 0.46 }), // CRT screen
      box(1.0, 0.16, 0.5, 0x3a3f48, { rx: 0.35, y: 0.92, z: 0.55 }), // control deck
      cyl(0.05, 0.05, 0.16, 6, 0xe04f3a, { x: -0.2, y: 1.04, z: 0.62 }), // joystick
      cyl(0.06, 0.06, 0.05, 6, 0xffd84d, { x: 0.18, y: 1.02, z: 0.6 }), // button
      box(1.14, 0.32, 0.99, 0xe04f3a, { y: 2.0 }), // marquee
    ]);
  },
});

/* ------------------------------------------------------------------ */
/* T2 — 電気街 Electric Town (objects ~0.2-1.5 m radius)                 */
/* ------------------------------------------------------------------ */

add({
  id: 'bicycle',
  displayNameJa: '自転車',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 0.9,
  radiusJitter: 0.15,
  spawnWeight: 1.2,
  palette: [0xff5340, 0x3f8cff, 0x49c45f, 0xffc83d, 0xffffff],
  yOffset: -0.49,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    return finish([
      torus(0.5, 0.06, 4, 10, 0x23262e, { x: 0.78, y: 0.5 }), // front wheel
      torus(0.5, 0.06, 4, 10, 0x23262e, { x: -0.78, y: 0.5 }), // rear wheel
      box(0.95, 0.08, 0.06, 0xffffff, { rz: 0.45, x: -0.1, y: 0.72 }), // down tube (tinted)
      box(0.8, 0.08, 0.06, 0xffffff, { y: 0.98, x: 0.05 }), // top tube
      cyl(0.04, 0.04, 0.55, 6, 0x6a7078, { rx: HALF_PI, x: 0.78, y: 1.12 }), // handlebar
      box(0.28, 0.08, 0.14, 0x2e3138, { x: -0.5, y: 1.08 }), // saddle
      box(0.5, 0.3, 0.4, 0xc9a06a, { x: -0.85, y: 1.2 }), // rear basket carton
    ]);
  },
});

add({
  id: 'person',
  displayNameJa: '通行人',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 0.85,
  radiusJitter: 0.15,
  spawnWeight: 1.4,
  palette: [0xff7a5e, 0x5ea0ff, 0x6fdc8c, 0xffd06a, 0xc98aff, 0xffffff],
  yOffset: -0.03,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      box(0.36, 0.6, 0.22, 0x39415e, { y: 0.3 }), // legs
      cyl(0.2, 0.31, 0.72, 8, 0xffffff, { y: 0.95 }), // torso (tinted shirt)
      cyl(0.07, 0.07, 0.8, 6, 0xffffff, { rz: HALF_PI, y: 1.18 }), // arms bar
      sph(0.21, 0xeec39a, { ws: 7, hs: 5, y: 1.56 }), // head
      sph(0.22, 0x4a3a2e, { ws: 6, hs: 3, theta0: 0, thetaLen: HALF_PI, y: 1.58 }), // hair cap
      box(0.3, 0.36, 0.12, 0xe8e4da, { x: 0.3, y: 0.85, z: 0.18 }), // shopping bag
    ]);
  },
});

add({
  id: 'signboard',
  displayNameJa: '看板',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 1.1,
  radiusJitter: 0.15,
  spawnWeight: 1.2,
  palette: [0xc94f46, 0x3f6cc4, 0xe0a050, 0x3f8a5f, 0xffffff],
  yOffset: -0.14,
  upright: true,
  collisionScale: 0.55,
  buildGeometry(rng) {
    return finish([
      box(0.7, 1.5, 0.1, 0xffffff, { rx: -0.16, y: 0.78, z: 0.12 }), // A-frame face (tinted ad)
      box(0.7, 1.5, 0.1, 0xf2f2ee, { rx: 0.16, y: 0.78, z: -0.12 }), // A-frame back
      box(0.56, 0.5, 0.06, 0xf6f2e6, { rx: -0.16, y: 1.05, z: 0.2 }), // poster patch
      box(0.74, 0.06, 0.5, 0x8a9098, { y: 0.04 }), // base bar
    ]);
  },
});

add({
  id: 'vending_machine',
  displayNameJa: '自販機',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 1.0,
  radiusJitter: 0.12,
  spawnWeight: 1.1,
  palette: [0xc94f46, 0x3f6cc4, 0xffffff, 0x3f8a5f, 0xe0a050],
  yOffset: -0.19,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    const parts = [
      box(1.15, 2.1, 0.85, 0xffffff, { y: 1.05 }), // body (tinted)
      box(0.95, 0.85, 0.08, 0x9fc4d8, { y: 1.55, z: 0.43 }), // display window
      box(0.95, 0.3, 0.06, 0x2e3138, { y: 0.5, z: 0.44 }), // dispense slot
    ];
    const drinkHex = [0xe04f3a, 0x3f8cff, 0x49c45f, 0xffd84d];
    for (let i = 0; i < 4; i++) {
      parts.push(cyl(0.08, 0.08, 0.24, 6, drinkHex[i], { x: -0.33 + i * 0.22, y: 1.62, z: 0.47 })); // sample cans
    }
    return finish(parts);
  },
});

add({
  id: 'cat',
  displayNameJa: 'ネコ',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 0.35,
  radiusJitter: 0.2,
  spawnWeight: 1.2,
  palette: [0xf0a050, 0x9aa0aa, 0x4a4a52, 0xf5e9d8, 0xc8855f],
  yOffset: -0.33,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      sph(0.5, 0xffffff, { sx: 1.4, y: 0.5 }), // body (tinted)
      sph(0.36, 0xffffff, { x: 0.55, y: 1.0 }), // head
      cone(0.13, 0.26, 4, 0xffffff, { x: 0.4, y: 1.36 }), // ear L
      cone(0.13, 0.26, 4, 0xffffff, { x: 0.72, y: 1.36 }), // ear R
      cyl(0.06, 0.09, 0.75, 6, 0xffffff, { rz: -0.9, x: -0.85, y: 0.85 }), // tail
      sph(0.13, 0xf6ead2, { ws: 6, hs: 4, x: 0.85, y: 0.92 }), // muzzle
    ]);
  },
});

add({
  id: 'pigeon',
  displayNameJa: 'ハト',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 0.18,
  radiusJitter: 0.2,
  spawnWeight: 1.4,
  palette: [0x9aa0aa, 0x8a90a0, 0xb0b4be, 0x7a8088],
  yOffset: -0.35,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      sph(0.55, 0xffffff, { ws: 8, hs: 5, sx: 1.25, sy: 0.95, y: 0.55 }), // body (tinted)
      sph(0.28, 0x6a7a8a, { ws: 7, hs: 5, x: 0.6, y: 1.0 }), // head (iridescent neck)
      cone(0.07, 0.22, 5, 0xe0a050, { rz: -HALF_PI, x: 0.92, y: 0.98 }), // beak
      cone(0.28, 0.6, 4, 0x7a8088, { rz: 2.3, x: -0.75, y: 0.62 }), // tail fan
      cyl(0.03, 0.03, 0.25, 4, 0xc4756a, { x: 0.1, y: 0.05 }), // leg
      cyl(0.03, 0.03, 0.25, 4, 0xc4756a, { x: -0.12, y: 0.05 }), // leg
    ]);
  },
});

add({
  id: 'nobori_banner',
  displayNameJa: 'のぼり',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 1.3,
  radiusJitter: 0.15,
  spawnWeight: 1.1,
  palette: [0xe04f3a, 0x3f6cc4, 0xffd84d, 0x3f8a5f, 0xffffff],
  yOffset: -0.05,
  upright: true,
  collisionScale: 0.5,
  buildGeometry(rng) {
    return finish([
      cyl(0.04, 0.05, 2.4, 6, 0xe8e4da, { y: 1.2 }), // pole
      box(0.65, 0.05, 0.05, 0xe8e4da, { x: 0.3, y: 2.32 }), // top arm
      box(0.6, 1.7, 0.05, 0xffffff, { x: 0.32, y: 1.42 }), // banner cloth (tinted)
      box(0.6, 0.22, 0.06, 0xf6f2e6, { x: 0.32, y: 2.18 }), // white header band
      cyl(0.2, 0.24, 0.18, 8, 0x6a7078, { y: 0.09 }), // water base
    ]);
  },
});

add({
  id: 'trash_can',
  displayNameJa: 'ゴミ箱',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 0.5,
  radiusJitter: 0.2,
  spawnWeight: 1.0,
  palette: [0x9aa4b0, 0x5f8a5f, 0x4a6a9a, 0xc4c8d0, 0xb05c4a],
  yOffset: -0.19,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      cyl(0.5, 0.42, 1.1, 10, 0xffffff, { hex2: 0xd8dce2, y: 0.55 }), // bin (tinted)
      cyl(0.56, 0.56, 0.12, 10, 0xe2e6ea, { y: 1.16 }), // lid
      box(0.3, 0.07, 0.1, 0x7a8088, { y: 1.26 }), // lid handle
    ]);
  },
});

/* ---- T2 chunk landmarks (slots 8/9) ------------------------------- */

add({
  id: 'utility_pole',
  displayNameJa: '電柱',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 4.5,
  radiusJitter: 0.12,
  spawnWeight: 0.35,
  palette: [0x9a8a78, 0x8a8f9a, 0xa89888, 0x7a7068],
  yOffset: 0,
  upright: true,
  collisionScale: 0.45,
  buildGeometry(rng) {
    return finish([
      cyl(0.05, 0.08, 2.9, 7, 0xffffff, { y: 1.45, hex2: 0xd8d0c4 }), // pole (tinted)
      box(1.1, 0.07, 0.07, 0x4a4540, { y: 2.62 }), // upper crossarm
      box(0.9, 0.07, 0.07, 0x4a4540, { y: 2.34 }), // lower crossarm
      cyl(0.035, 0.045, 0.1, 5, 0xe8e8e2, { x: -0.48, y: 2.7 }), // insulator
      cyl(0.035, 0.045, 0.1, 5, 0xe8e8e2, { x: 0.48, y: 2.7 }), // insulator
      cyl(0.035, 0.045, 0.1, 5, 0xe8e8e2, { x: -0.38, y: 2.42 }), // insulator
      cyl(0.035, 0.045, 0.1, 5, 0xe8e8e2, { x: 0.38, y: 2.42 }), // insulator
      cyl(0.13, 0.13, 0.34, 7, 0x6a7078, { x: 0.18, y: 2.05 }), // transformer can
    ]);
  },
});

add({
  id: 'yatai_stall',
  displayNameJa: '屋台',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 3.2,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0xe04f3a, 0xe0a050, 0xc94f46, 0xb05c4a],
  yOffset: -0.33,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      box(1.7, 0.9, 1.0, 0x8a6a4a, { y: 0.65 }), // cart body
      box(1.8, 0.08, 1.1, 0xa07848, { y: 1.14 }), // counter top
      cyl(0.05, 0.05, 1.0, 5, 0x6a5a48, { x: -0.7, y: 1.6 }), // roof post
      cyl(0.05, 0.05, 1.0, 5, 0x6a5a48, { x: 0.7, y: 1.6 }), // roof post
      box(2.0, 0.1, 1.3, 0xffffff, { rx: 0.08, y: 2.12 }), // awning roof (tinted)
      box(2.0, 0.3, 0.06, 0xf6f2e6, { y: 1.92, z: 0.62 }), // noren curtain strip
      sph(0.16, 0xffd06a, { ws: 6, hs: 4, x: 0.85, y: 1.7, z: 0.5 }), // lantern
      cyl(0.22, 0.22, 0.55, 8, 0x2e3138, { rx: HALF_PI, x: -0.6, y: 0.28, z: 0 }), // wheel
      cyl(0.22, 0.22, 0.55, 8, 0x2e3138, { rx: HALF_PI, x: 0.6, y: 0.28, z: 0 }), // wheel
    ]);
  },
});

/* ------------------------------------------------------------------ */
/* T3 — 下町 Downtown (objects ~2-7 m radius)                            */
/* ------------------------------------------------------------------ */

add({
  id: 'car',
  displayNameJa: '車',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 2.2,
  radiusJitter: 0.2,
  spawnWeight: 1.5,
  palette: [0xff5340, 0x3f8cff, 0x49c45f, 0xffd84d, 0xffffff, 0xb05cff],
  yOffset: -0.5,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      box(2.2, 0.55, 1.05, 0xffffff, { y: 0.56 }), // body (tinted)
      box(1.15, 0.45, 0.95, 0x9fc4d8, { x: -0.12, y: 1.05 }), // glass cabin
      cyl(0.28, 0.28, 0.24, 8, 0x23262e, { rx: HALF_PI, x: 0.72, z: 0.5, y: 0.28 }), // wheel FR
      cyl(0.28, 0.28, 0.24, 8, 0x23262e, { rx: HALF_PI, x: 0.72, z: -0.5, y: 0.28 }), // wheel FL
      cyl(0.28, 0.28, 0.24, 8, 0x23262e, { rx: HALF_PI, x: -0.72, z: 0.5, y: 0.28 }), // wheel RR
      cyl(0.28, 0.28, 0.24, 8, 0x23262e, { rx: HALF_PI, x: -0.72, z: -0.5, y: 0.28 }), // wheel RL
    ]);
  },
});

add({
  id: 'taxi',
  displayNameJa: 'タクシー',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 2.3,
  radiusJitter: 0.15,
  spawnWeight: 1.2,
  palette: [0xffc83d, 0x3f9a5f, 0x2e3138, 0xe8e8e2],
  yOffset: -0.5,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      box(2.3, 0.55, 1.05, 0xffffff, { y: 0.56 }), // body (tinted fleet color)
      box(1.2, 0.45, 0.95, 0x9fc4d8, { x: -0.1, y: 1.05 }), // glass cabin
      box(0.34, 0.16, 0.2, 0xe04f3a, { y: 1.36 }), // roof lamp (andon)
      box(2.34, 0.1, 1.07, 0xf2f2ee, { y: 0.36 }), // side trim line
      cyl(0.28, 0.28, 0.24, 8, 0x23262e, { rx: HALF_PI, x: 0.74, z: 0.5, y: 0.28 }), // wheel FR
      cyl(0.28, 0.28, 0.24, 8, 0x23262e, { rx: HALF_PI, x: 0.74, z: -0.5, y: 0.28 }), // wheel FL
      cyl(0.28, 0.28, 0.24, 8, 0x23262e, { rx: HALF_PI, x: -0.74, z: 0.5, y: 0.28 }), // wheel RR
      cyl(0.28, 0.28, 0.24, 8, 0x23262e, { rx: HALF_PI, x: -0.74, z: -0.5, y: 0.28 }), // wheel RL
    ]);
  },
});

add({
  id: 'bus',
  displayNameJa: 'バス',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 6.0,
  radiusJitter: 0.12,
  spawnWeight: 0.8,
  palette: [0xffc83d, 0x4aa0a8, 0xc94f46, 0x6fdc8c, 0xffffff],
  yOffset: -0.58,
  upright: true,
  collisionScale: 0.75,
  buildGeometry(rng) {
    return finish([
      box(3.1, 1.15, 1.05, 0xffffff, { y: 0.85 }), // body (tinted)
      box(3.14, 0.36, 0.98, 0x35414e, { y: 1.12 }), // window band
      box(2.9, 0.08, 0.95, 0xf2f2ee, { y: 1.46 }), // roof
      cyl(0.3, 0.3, 1.1, 8, 0x23262e, { rx: HALF_PI, x: 1.05, y: 0.3 }), // front axle
      cyl(0.3, 0.3, 1.1, 8, 0x23262e, { rx: HALF_PI, x: -1.05, y: 0.3 }), // rear axle
    ]);
  },
});

add({
  id: 'truck',
  displayNameJa: 'トラック',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 4.0,
  radiusJitter: 0.15,
  spawnWeight: 0.9,
  palette: [0xffffff, 0x5ea0ff, 0xff8a5e, 0x9adfb0, 0xd8d8d0],
  yOffset: -0.61,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      box(1.0, 0.95, 1.05, 0xffffff, { x: 1.35, y: 0.78 }), // cab (tinted)
      box(2.3, 1.25, 1.1, 0xe8e8ea, { x: -0.5, y: 0.95 }), // cargo box
      box(0.95, 0.3, 0.95, 0x6fb0c8, { x: 1.4, y: 1.1, z: 0 }), // windshield band
      cyl(0.32, 0.32, 1.15, 8, 0x23262e, { rx: HALF_PI, x: 1.25, y: 0.32 }), // front axle
      cyl(0.32, 0.32, 1.15, 8, 0x23262e, { rx: HALF_PI, x: -1.0, y: 0.32 }), // rear axle
    ]);
  },
});

add({
  id: 'street_tree',
  displayNameJa: '街路樹',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 4.0,
  radiusJitter: 0.3,
  spawnWeight: 1.4,
  palette: [0x6fb068, 0x4f9a58, 0x8ac470, 0xb0c060, 0x5a8a4a],
  yOffset: -0.05,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    const lean = (rng() - 0.5) * 0.16;
    return finish([
      cyl(0.16, 0.28, 1.3, 6, 0x7a5a3a, { rz: lean, y: 0.6 }), // trunk
      ico(0.85, 1, 0xffffff, { y: 1.85, hex2: 0xd8e8c0 }), // canopy (tinted)
      ico(0.55, 1, 0xffffff, { x: 0.45 + lean, y: 2.4, hex2: 0xd8e8c0 }), // canopy top
    ]);
  },
});

add({
  id: 'kiosk',
  displayNameJa: '売店',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 2.5,
  radiusJitter: 0.15,
  spawnWeight: 1.0,
  palette: [0xffffff, 0xffe8c0, 0xd8ecf4, 0xf4d8d8],
  yOffset: -0.44,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.3, 1.15, 1.3, 0xf4e8d0, { y: 0.58, hex2: 0xffffff }), // booth
      box(0.5, 0.06, 0.62, 0xe04f3a, { rx: -0.35, x: -0.45, y: 1.32, z: 0.72 }), // awning stripe
      box(0.5, 0.06, 0.62, 0xf2f2ee, { rx: -0.35, x: 0, y: 1.32, z: 0.72 }), // awning stripe
      box(0.5, 0.06, 0.62, 0xe04f3a, { rx: -0.35, x: 0.45, y: 1.32, z: 0.72 }), // awning stripe
      box(1.0, 0.08, 0.3, 0xb07a3f, { y: 0.72, z: 0.78 }), // counter
    ]);
  },
});

add({
  id: 'machiya',
  displayNameJa: '町家',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 6.0,
  radiusJitter: 0.2,
  spawnWeight: 1.0,
  palette: [0xe8dcc8, 0xd8ccb8, 0xe0d4c0, 0xd0c4b0],
  yOffset: -0.32,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.7, 1.0, 1.35, 0xffffff, { y: 0.5 }), // plaster walls (tinted)
      cyl(0.98, 0.98, 1.9, 3, 0x3a4450, { theta0: PI, rx: HALF_PI, sy: 0.55, y: 1.25 }), // tiled gable roof
      box(1.74, 0.18, 1.39, 0x6a4a32, { y: 0.62 }), // timber belt
      box(0.9, 0.5, 0.06, 0x6a4a32, { x: -0.25, y: 0.28, z: 0.7 }), // lattice front (koushi)
      box(0.34, 0.55, 0.07, 0x3a3026, { x: 0.5, y: 0.3, z: 0.7 }), // door
      box(0.6, 0.2, 0.05, 0x2e5a8a, { y: 0.78, z: 0.72 }), // noren
    ]);
  },
});

add({
  id: 'torii',
  displayNameJa: '鳥居',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 3.5,
  radiusJitter: 0.12,
  spawnWeight: 0.9,
  palette: [0xd2402a, 0xc23a26, 0xe04f3a, 0xb83422],
  yOffset: -0.39,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      cyl(0.1, 0.12, 1.7, 8, 0xffffff, { x: -0.85, y: 0.85 }), // pillar L (tinted vermilion)
      cyl(0.1, 0.12, 1.7, 8, 0xffffff, { x: 0.85, y: 0.85 }), // pillar R
      cyl(0.16, 0.18, 0.12, 6, 0x8a8580, { x: -0.85, y: 0.06 }), // base stone L
      cyl(0.16, 0.18, 0.12, 6, 0x8a8580, { x: 0.85, y: 0.06 }), // base stone R
      box(1.96, 0.12, 0.16, 0xffffff, { y: 1.32 }), // nuki (tie beam)
      box(0.12, 0.26, 0.14, 0xffffff, { y: 1.51 }), // gakuzuka (center strut)
      box(2.3, 0.14, 0.26, 0xffffff, { y: 1.7 }), // shimaki lintel
      box(2.4, 0.09, 0.3, 0x2e2a28, { y: 1.81 }), // kasagi top cap (dark)
    ]);
  },
});

/* ---- T3 chunk landmarks (slots 8/9) ------------------------------- */

add({
  id: 'footbridge',
  displayNameJa: '歩道橋',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 18,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0x9ab0c8, 0x8aa0b8, 0xa8b8c8, 0x90a8b8],
  yOffset: -0.67,
  upright: true,
  collisionScale: 0.5,
  buildGeometry(rng) {
    return finish([
      box(3.4, 0.16, 0.85, 0xffffff, { y: 1.2 }), // deck (tinted)
      box(3.4, 0.4, 0.06, 0xd8dce2, { y: 1.45, z: 0.42 }), // railing panel
      box(3.4, 0.4, 0.06, 0xd8dce2, { y: 1.45, z: -0.42 }), // railing panel
      cyl(0.12, 0.14, 1.15, 6, 0xb8bec8, { x: -1.2, y: 0.58 }), // pillar
      cyl(0.12, 0.14, 1.15, 6, 0xb8bec8, { x: 1.2, y: 0.58 }), // pillar
      box(1.0, 0.14, 0.8, 0xe2e6ea, { rz: 0.5, x: -1.95, y: 0.66 }), // stair run L
      box(1.0, 0.14, 0.8, 0xe2e6ea, { rz: -0.5, x: 1.95, y: 0.66 }), // stair run R
    ]);
  },
});

add({
  id: 'sento_chimney',
  displayNameJa: '銭湯の煙突',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 16,
  radiusJitter: 0.15,
  spawnWeight: 0.3,
  palette: [0xb06a50, 0xa05a48, 0xc08068, 0x9a6a5a],
  yOffset: -0.16,
  upright: true,
  collisionScale: 0.35,
  buildGeometry(rng) {
    return finish([
      cyl(0.3, 0.46, 2.7, 8, 0xffffff, { y: 1.35, hex2: 0xe0d0c8 }), // stack (tinted)
      cyl(0.33, 0.33, 0.26, 8, 0xe04f3a, { y: 2.55 }), // red band
      cyl(0.35, 0.35, 0.26, 8, 0xf2f2ee, { y: 2.2 }), // white band (ゆ)
      box(1.4, 0.6, 1.0, 0xe8dcc8, { y: 0.3 }), // bathhouse roof block
      cyl(0.78, 0.78, 1.5, 3, 0x3a4450, { theta0: PI, rx: HALF_PI, sy: 0.5, y: 0.72 }), // gable
    ]);
  },
});

/* ------------------------------------------------------------------ */
/* T4 — 都心 City Core (objects ~10-25 m radius)                         */
/* ------------------------------------------------------------------ */

add({
  id: 'zakkyo_building',
  displayNameJa: '雑居ビル',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 18,
  radiusJitter: 0.2,
  spawnWeight: 1.3,
  palette: [0xd9cfc2, 0xc2ccd9, 0xd9c2c2, 0xccd9c2, 0xe2d8c8],
  yOffset: -0.19,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    const parts = [
      towerBanded(1.25, 2.7, 1.25, 8, 0xffffff, 0x39465e, 0xffd98a, rng, { y: 1.35 }), // banded block (tinted)
      box(1.35, 0.1, 1.35, 0x8a8f9a, { y: 2.75 }), // roof slab
      box(0.5, 0.35, 0.2, 0x6a7078, { y: 0.18, z: 0.7 }), // entrance
    ];
    // Stacked tenant signs down the facade edge — the zakkyo look.
    const signHex = [0xe04f3a, 0x3f8cff, 0xffd84d, 0x49c45f];
    for (let i = 0; i < 4; i++) {
      parts.push(box(0.3, 0.4, 0.1, signHex[i], { x: 0.72, y: 0.7 + i * 0.55, z: 0.62 }));
    }
    return finish(parts);
  },
});

add({
  id: 'mansion',
  displayNameJa: 'マンション',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 22,
  radiusJitter: 0.2,
  spawnWeight: 1.1,
  palette: [0xe2d8c8, 0xd0d8e2, 0xe0d0c8, 0xd8e0d0],
  yOffset: -0.22,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      towerBanded(1.6, 2.5, 1.1, 8, 0xffffff, 0x44506a, 0xffe0a0, rng, { y: 1.25 }), // slab block (tinted)
      box(1.66, 0.14, 0.16, 0xd8d4cc, { y: 0.95, z: 0.6 }), // balcony rail
      box(1.66, 0.14, 0.16, 0xd8d4cc, { y: 1.58, z: 0.6 }), // balcony rail
      box(1.66, 0.14, 0.16, 0xd8d4cc, { y: 2.2, z: 0.6 }), // balcony rail
      box(1.7, 0.12, 1.2, 0x8a8f9a, { y: 2.56 }), // roof slab
      box(0.4, 0.3, 0.3, 0xb8bec8, { x: 0.45, y: 2.72 }), // water tank
    ]);
  },
});

add({
  id: 'konbini',
  displayNameJa: 'コンビニ',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 10,
  radiusJitter: 0.15,
  spawnWeight: 1.2,
  palette: [0xffffff, 0xf0f4f8, 0xf8f0e8, 0xeef2ee],
  yOffset: -0.62,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(2.6, 0.95, 1.5, 0xffffff, { y: 0.48 }), // store box (tinted white)
      box(2.64, 0.22, 1.54, 0x3f6cc4, { y: 1.05 }), // fascia sign band (blue)
      box(2.64, 0.08, 1.54, 0xe04f3a, { y: 1.2 }), // stripe (red)
      box(2.2, 0.55, 0.06, 0x9fc4d8, { y: 0.42, z: 0.76 }), // glass front
      box(0.5, 0.6, 0.08, 0x7a8088, { x: 0.9, y: 0.32, z: 0.76 }), // door
    ]);
  },
});

add({
  id: 'parking_garage',
  displayNameJa: '立体駐車場',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 16,
  radiusJitter: 0.15,
  spawnWeight: 1.0,
  palette: [0xc8ccd4, 0xd4c8b8, 0xb8c4cc, 0xd0d4c4],
  yOffset: -0.57,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      parts.push(box(2.4, 0.12, 1.6, 0xffffff, { y: 0.1 + i * 0.55 })); // deck slabs (tinted)
    }
    parts.push(box(0.16, 1.78, 1.6, 0xd2d6dc, { x: -1.12, y: 0.95 })); // end wall
    parts.push(box(0.16, 1.78, 1.6, 0xd2d6dc, { x: 1.12, y: 0.95 })); // end wall
    parts.push(box(1.2, 0.1, 0.7, 0xb8bec8, { rz: 0.42, x: -1.6, y: 0.42 })); // entry ramp
    const carHex = [0xe04f3a, 0x3f8cff, 0xffd84d];
    for (let i = 0; i < 3; i++) {
      parts.push(box(0.46, 0.18, 0.26, carHex[i], { x: -0.7 + i * 0.7, y: 0.78, z: 0.3 })); // parked cars
    }
    return finish(parts);
  },
});

add({
  id: 'train_car',
  displayNameJa: '電車車両',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 14,
  radiusJitter: 0.12,
  spawnWeight: 1.0,
  palette: [0xe8e8e2, 0xd8e0e8, 0xf0e8e0, 0xe0e8e0],
  yOffset: -0.54,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    return finish([
      box(3.6, 0.9, 0.95, 0xffffff, { y: 0.75 }), // car body (tinted)
      box(3.64, 0.16, 0.97, 0x3f8a5f, { y: 0.42 }), // line color band
      box(3.4, 0.32, 0.98, 0x35414e, { y: 0.95 }), // window band
      box(3.3, 0.06, 0.85, 0xd2d6dc, { y: 1.24 }), // roof
      box(0.5, 0.3, 0.5, 0x8a9098, { y: 1.4 }), // pantograph base
      box(0.06, 0.4, 0.5, 0x6a7078, { rz: 0.5, x: 0.12, y: 1.6 }), // pantograph arm
      cyl(0.22, 0.22, 0.85, 7, 0x23262e, { rx: HALF_PI, x: 1.3, y: 0.22 }), // bogie
      cyl(0.22, 0.22, 0.85, 7, 0x23262e, { rx: HALF_PI, x: -1.3, y: 0.22 }), // bogie
    ]);
  },
});

add({
  id: 'gas_tank',
  displayNameJa: 'ガスタンク',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 10,
  radiusJitter: 0.15,
  spawnWeight: 1.0,
  palette: [0xffffff, 0xd8e8d8, 0xe8e0d0, 0xd0d8e8],
  yOffset: -0.27,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      sph(1.0, 0xffffff, { ws: 10, hs: 7, y: 1.15 }), // sphere tank (tinted)
      cyl(1.02, 1.02, 0.18, 12, 0xc94f46, { y: 1.15 }), // equator band
      cyl(0.72, 0.82, 0.5, 10, 0x9aa0aa, { y: 0.25 }), // skirt base
      cyl(0.05, 0.05, 1.1, 6, 0x8a8f9a, { x: 1.05, y: 0.6 }), // ladder pipe
    ]);
  },
});

add({
  id: 'crane',
  displayNameJa: 'クレーン',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 25,
  radiusJitter: 0.15,
  spawnWeight: 0.7,
  palette: [0xffc83d, 0xff8a3d, 0xffe27a, 0xe8b03d],
  yOffset: -0.31,
  upright: true,
  collisionScale: 0.5,
  buildGeometry(rng) {
    return finish([
      box(0.55, 0.22, 0.55, 0x8a8f9a, { y: 0.11 }), // base
      box(0.2, 2.3, 0.2, 0xffffff, { y: 1.35 }), // mast (tinted)
      box(2.1, 0.14, 0.18, 0xffffff, { x: 0.65, y: 2.55 }), // jib
      box(0.65, 0.14, 0.18, 0xffffff, { x: -0.65, y: 2.55 }), // counter-jib
      box(0.34, 0.3, 0.3, 0x6a7078, { x: -0.85, y: 2.32 }), // counterweight
      box(0.03, 0.85, 0.03, 0x3a3f48, { x: 1.55, y: 2.1 }), // cable
      box(0.12, 0.12, 0.12, 0x3a3f48, { x: 1.55, y: 1.62 }), // hook block
    ]);
  },
});

add({
  id: 'shrine',
  displayNameJa: '神社',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 12,
  radiusJitter: 0.15,
  spawnWeight: 0.9,
  palette: [0xe8dcc8, 0xe0d4c0, 0xf0e4d0, 0xd8ccb8],
  yOffset: -0.31,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.7, 0.25, 1.5, 0x9a958c, { y: 0.12 }), // stone platform
      box(1.2, 0.8, 1.0, 0xffffff, { y: 0.65 }), // haiden hall (tinted)
      cyl(0.95, 0.95, 1.5, 3, 0x2e5a4a, { theta0: PI, rx: HALF_PI, sy: 0.65, y: 1.3 }), // copper roof
      box(1.5, 0.08, 0.3, 0x2e5a4a, { y: 1.05, z: 0.6 }), // eave extension
      cyl(0.05, 0.06, 0.6, 6, 0xc23a26, { x: -0.75, y: 0.55, z: 0.85 }), // mini torii pillar
      cyl(0.05, 0.06, 0.6, 6, 0xc23a26, { x: -0.45, y: 0.55, z: 0.85 }), // mini torii pillar
      box(0.5, 0.07, 0.1, 0xc23a26, { x: -0.6, y: 0.85, z: 0.85 }), // mini torii lintel
    ]);
  },
});

/* ---- T4 chunk landmarks (slots 8/9) ------------------------------- */

add({
  id: 'highway_junction',
  displayNameJa: '首都高ジャンクション',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 70,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0xc8c4bc, 0xd0ccc4, 0xbcc4c8, 0xd8d4cc],
  yOffset: -0.52,
  upright: true,
  collisionScale: 0.6,
  buildGeometry(rng) {
    return finish([
      box(3.6, 0.18, 0.9, 0xffffff, { y: 1.1 }), // lower deck (tinted concrete)
      box(3.4, 0.18, 0.85, 0xf2eee6, { ry: 1.0, y: 1.75 }), // crossing upper deck
      box(1.6, 0.14, 0.7, 0xe8e4dc, { ry: 0.5, rz: 0.18, x: 1.2, y: 1.42, z: 0.8 }), // ramp
      box(3.6, 0.12, 0.07, 0xb0aca4, { y: 1.26, z: 0.44 }), // rail
      box(3.6, 0.12, 0.07, 0xb0aca4, { y: 1.26, z: -0.44 }), // rail
      cyl(0.2, 0.24, 1.0, 6, 0xb8b4ac, { x: -1.2, y: 0.5 }), // pillar
      cyl(0.2, 0.24, 1.0, 6, 0xb8b4ac, { x: 1.2, y: 0.5 }), // pillar
      cyl(0.18, 0.22, 1.65, 6, 0xb8b4ac, { x: 0, y: 0.82, z: -0.5 }), // tall pillar
    ]);
  },
});

add({
  id: 'ferris_wheel',
  displayNameJa: '観覧車',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 60,
  radiusJitter: 0.15,
  spawnWeight: 0.3,
  palette: [0xff8a9a, 0x8ab0ff, 0xffd06a, 0x9adfb0],
  yOffset: -0.01,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    return finish([
      torus(1.0, 0.06, 4, 14, 0xffffff, { y: 1.3 }), // rim (tinted)
      box(1.9, 0.06, 0.06, 0xe8e8e2, { y: 1.3 }), // spoke
      box(0.06, 1.9, 0.06, 0xe8e8e2, { y: 1.3 }), // spoke
      box(1.34, 0.06, 0.06, 0xe8e8e2, { rz: PI / 4, y: 1.3 }), // spoke diag
      cyl(0.1, 0.1, 0.3, 6, 0x6a7078, { rx: HALF_PI, y: 1.3 }), // hub
      cyl(0.07, 0.1, 1.5, 6, 0x8a8f9a, { rz: 0.35, x: -0.28, y: 0.65 }), // A-frame leg
      cyl(0.07, 0.1, 1.5, 6, 0x8a8f9a, { rz: -0.35, x: 0.28, y: 0.65 }), // A-frame leg
      box(0.2, 0.2, 0.18, 0xe04f3a, { y: 0.24 }), // gondola bottom
      box(0.2, 0.2, 0.18, 0x3f8cff, { y: 2.36 }), // gondola top
      box(0.2, 0.2, 0.18, 0xffc83d, { x: -1.06, y: 1.3 }), // gondola left
      box(0.2, 0.2, 0.18, 0x49c45f, { x: 1.06, y: 1.3 }), // gondola right
    ]);
  },
});

/* ------------------------------------------------------------------ */
/* T5 — 大東京 Metropolis (objects ~60-130 m radius)                     */
/* ------------------------------------------------------------------ */

add({
  id: 'skyscraper',
  displayNameJa: '超高層ビル',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 110,
  radiusJitter: 0.2,
  spawnWeight: 1.3,
  palette: [0x9ab0c8, 0xb0a8c8, 0x98b8b0, 0xc0b8a8, 0xa8b8d0],
  yOffset: -0.06,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      towerBanded(1.15, 2.1, 1.15, 7, 0xffffff, 0x2e3c52, 0xffd98a, rng, { y: 1.05 }), // lower shaft (tinted)
      towerBanded(0.85, 1.45, 0.85, 5, 0xf2f2f2, 0x2e3c52, 0xffd98a, rng, { y: 2.8 }), // upper shaft
      box(0.6, 0.22, 0.6, 0x8a8f9a, { y: 3.62 }), // crown
      cyl(0.04, 0.04, 0.75, 6, 0xc8ccd4, { y: 4.1 }), // antenna
    ]);
  },
});

add({
  id: 'tower_mansion',
  displayNameJa: 'タワーマンション',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 95,
  radiusJitter: 0.18,
  spawnWeight: 1.1,
  palette: [0xc8d0dc, 0xd8d0c8, 0xc8d8d0, 0xd0c8d8],
  yOffset: -0.14,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      towerBanded(1.0, 3.2, 1.0, 10, 0xffffff, 0x3a4456, 0xffe0a0, rng, { y: 1.6 }), // tower (tinted)
      cyl(0.72, 0.72, 0.18, 10, 0xd2d6dc, { y: 3.3 }), // crown ring
      box(1.5, 0.5, 1.5, 0xe8e4dc, { y: 0.25 }), // podium
      box(0.4, 0.2, 0.4, 0x9aa0aa, { y: 3.48 }), // rooftop plant
    ]);
  },
});

add({
  id: 'hotel',
  displayNameJa: 'ホテル',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 80,
  radiusJitter: 0.15,
  spawnWeight: 1.0,
  palette: [0xe2d8c8, 0xd8e0e8, 0xe8d8d0, 0xd8d8c8],
  yOffset: -0.31,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      towerBanded(2.2, 2.2, 0.85, 7, 0xffffff, 0x44506a, 0xffe0b0, rng, { y: 1.45 }), // slab tower (tinted)
      box(2.5, 0.45, 1.3, 0xf2eee6, { y: 0.22 }), // lobby podium
      box(0.9, 0.12, 0.9, 0xe8e4dc, { y: 0.5, z: 0.5 }), // porte-cochere canopy
      box(1.0, 0.25, 0.1, 0xe0a050, { y: 2.7, z: 0.45 }), // rooftop sign
    ]);
  },
});

add({
  id: 'department_store',
  displayNameJa: 'デパート',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 70,
  radiusJitter: 0.15,
  spawnWeight: 1.0,
  palette: [0xe0d8c8, 0xd8d0c0, 0xe8e0d0, 0xd0c8b8],
  yOffset: -0.52,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(2.8, 1.5, 1.9, 0xffffff, { y: 0.75, hex2: 0xf0ece2 }), // mass (tinted stone)
      box(2.84, 0.1, 1.94, 0xc8c4ba, { y: 0.55 }), // floor cornice
      box(2.84, 0.1, 1.94, 0xc8c4ba, { y: 1.0 }), // floor cornice
      box(2.5, 0.3, 0.08, 0x9fc4d8, { y: 0.3, z: 0.98 }), // showcase windows
      box(1.2, 0.35, 0.12, 0xc94f46, { y: 1.68, z: 0.92 }), // rooftop sign
      box(0.8, 0.25, 0.8, 0xd8d4cc, { x: -0.8, y: 1.62 }), // rooftop pavilion
    ]);
  },
});

add({
  id: 'viaduct',
  displayNameJa: '高架橋',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 90,
  radiusJitter: 0.12,
  spawnWeight: 0.9,
  palette: [0xc8c4bc, 0xd0ccc4, 0xbcc4c8, 0xd8d4cc],
  yOffset: -0.67,
  upright: true,
  collisionScale: 0.5,
  buildGeometry(rng) {
    return finish([
      box(3.8, 0.2, 0.95, 0xffffff, { y: 1.15 }), // deck (tinted concrete)
      box(3.8, 0.14, 0.07, 0xb0aca4, { y: 1.32, z: 0.46 }), // rail
      box(3.8, 0.14, 0.07, 0xb0aca4, { y: 1.32, z: -0.46 }), // rail
      box(2.6, 0.14, 0.7, 0x49725a, { y: 1.28 }), // train running on top
      cyl(0.22, 0.26, 1.05, 6, 0xb8b4ac, { x: -1.45, y: 0.52 }), // pier
      cyl(0.22, 0.26, 1.05, 6, 0xb8b4ac, { x: 0, y: 0.52 }), // pier
      cyl(0.22, 0.26, 1.05, 6, 0xb8b4ac, { x: 1.45, y: 0.52 }), // pier
    ]);
  },
});

add({
  id: 'stadium',
  displayNameJa: 'スタジアム',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 90,
  radiusJitter: 0.12,
  spawnWeight: 0.7,
  palette: [0xd8d4cc, 0xd4ccd8, 0xccd8d0, 0xe0dcd4],
  yOffset: -0.73,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      torus(1.25, 0.38, 5, 14, 0xffffff, { rx: HALF_PI, sx: 1.25, sy: 0.85, y: 0.4, hex2: 0xc8c4ba }), // bowl ring (tinted)
      cyl(1.05, 1.05, 0.14, 12, 0x5fae5f, { sx: 1.25, y: 0.07 }), // pitch
      cyl(0.04, 0.04, 1.1, 6, 0xc8ccd4, { x: -1.7, y: 0.55 }), // floodlight mast
      cyl(0.04, 0.04, 1.1, 6, 0xc8ccd4, { x: 1.7, y: 0.55 }), // floodlight mast
    ]);
  },
});

add({
  id: 'rail_yard',
  displayNameJa: '操車場',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 100,
  radiusJitter: 0.12,
  spawnWeight: 0.8,
  palette: [0xb8b4ac, 0xc0bcb4, 0xb0aca4, 0xc8c4bc],
  yOffset: -0.82,
  upright: true,
  collisionScale: 0.75,
  buildGeometry(rng) {
    const parts = [box(3.8, 0.1, 2.4, 0xffffff, { y: 0.05 })]; // ballast bed (tinted)
    const trainHex = [0x49725a, 0xe07a3a, 0x4a6a9a, 0xd8d4cc];
    for (let i = 0; i < 4; i++) {
      parts.push(box(2.6 + (i % 2) * 0.8, 0.3, 0.34, trainHex[i], { x: (i % 2) * -0.4, y: 0.28, z: -0.85 + i * 0.55 })); // stabled trains
    }
    parts.push(box(0.6, 0.5, 0.5, 0x8a9098, { x: 1.5, y: 0.35, z: 0.9 })); // signal box
    return finish(parts);
  },
});

add({
  id: 'cruise_ship',
  displayNameJa: '客船',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 100,
  radiusJitter: 0.12,
  spawnWeight: 0.7,
  palette: [0xffffff, 0xe8f0f4, 0xf4ecd8, 0xd8e8f0],
  yOffset: -0.54,
  upright: true,
  collisionScale: 0.75,
  buildGeometry(rng) {
    return finish([
      box(3.4, 0.55, 1.0, 0x2c3e5e, { y: 0.28 }), // hull
      box(2.5, 0.5, 0.85, 0xffffff, { x: -0.15, y: 0.8 }), // superstructure (tinted)
      box(1.7, 0.38, 0.7, 0xf6f6f2, { x: -0.2, y: 1.24 }), // upper decks
      box(0.5, 0.3, 0.75, 0xe8eef2, { x: 1.1, y: 0.75 }), // bridge
      cyl(0.13, 0.17, 0.45, 8, 0xe04f3a, { rz: -0.12, x: -0.5, y: 1.6 }), // funnel
      cyl(0.13, 0.17, 0.45, 8, 0xe04f3a, { rz: -0.12, x: -1.1, y: 1.6 }), // funnel
    ]);
  },
});

/* ---- T5 chunk landmarks (slots 8/9) ------------------------------- */

add({
  id: 'mountain',
  displayNameJa: '丘陵',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 200,
  radiusJitter: 0.25,
  spawnWeight: 0.35,
  palette: [0x7fb86a, 0x6aa85f, 0x96c47a, 0x88b070],
  yOffset: -0.36,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      ico(1.3, 1, 0xffffff, { sy: 0.55, hex2: 0xd8e8b8 }), // grassy dome (tinted)
      cone(0.16, 0.4, 5, 0x3f7a48, { x: 0.55, y: 0.75 }), // pine
      cone(0.12, 0.3, 5, 0x3f7a48, { x: -0.5, y: 0.68, z: 0.3 }), // pine
      ico(0.18, 0, 0x9a948a, { x: -0.2, y: 0.6, z: -0.55 }), // boulder
    ]);
  },
});

add({
  id: 'bay_complex',
  displayNameJa: '湾岸コンビナート',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 190,
  radiusJitter: 0.15,
  spawnWeight: 0.3,
  palette: [0xc8ccd4, 0xd4c8b8, 0xb8c4cc, 0xd0d4c4],
  yOffset: -0.6,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      box(3.4, 0.12, 2.0, 0x9aa0aa, { y: 0.06 }), // quay slab
      sph(0.55, 0xffffff, { ws: 9, hs: 6, x: -1.0, y: 0.62 }), // gas sphere (tinted)
      sph(0.55, 0xffffff, { ws: 9, hs: 6, x: 0.1, y: 0.62 }), // gas sphere
      cyl(0.4, 0.4, 0.7, 9, 0xe8e4dc, { x: 1.1, y: 0.4, z: -0.5 }), // oil tank
      cyl(0.4, 0.4, 0.7, 9, 0xe8e4dc, { x: 1.1, y: 0.4, z: 0.5 }), // oil tank
      cyl(0.07, 0.1, 1.8, 6, 0xc8ccd2, { x: -1.5, y: 0.95, z: 0.6 }), // flare stack
      box(0.9, 0.45, 0.6, 0x8a9098, { x: 0.6, y: 0.28, z: 0.75 }), // plant block
      box(1.8, 0.05, 0.08, 0x7a8088, { y: 0.55, z: 0.2 }), // pipe run
    ]);
  },
});

/* ------------------------------------------------------------------ */
/* T6 — スカイライン Skyline (objects ~180-260 m radius)                  */
/* ------------------------------------------------------------------ */

add({
  id: 'city_block',
  displayNameJa: '街区ブロック',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 220,
  radiusJitter: 0.18,
  spawnWeight: 1.2,
  palette: [0xc8ccd4, 0xd4ccc0, 0xc0ccd4, 0xd0d4c8],
  yOffset: -0.71,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    const parts = [box(3.2, 0.14, 3.2, 0x8f949c, { y: 0.07 })]; // street slab
    for (let gx = 0; gx < 3; gx++) {
      for (let gz = 0; gz < 3; gz++) {
        if (gx === 1 && gz === 1) continue; // courtyard
        const h = 0.5 + rng() * 0.9;
        parts.push(
          box(0.78, h, 0.78, 0xffffff, {
            x: -1.05 + gx * 1.05,
            y: 0.14 + h / 2,
            z: -1.05 + gz * 1.05,
            hex2: 0xd8dce4,
          })
        );
      }
    }
    parts.push(ico(0.3, 0, 0x5f9a58, { y: 0.32 })); // courtyard green
    return finish(parts);
  },
});

add({
  id: 'park',
  displayNameJa: '公園',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 200,
  radiusJitter: 0.2,
  spawnWeight: 1.1,
  palette: [0x7fb86a, 0x6aa85f, 0x96c47a, 0x88b070],
  yOffset: -0.82,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      cyl(1.7, 1.8, 0.16, 12, 0xffffff, { y: 0.08, hex2: 0xcfe6b8 }), // lawn disc (tinted green)
      cyl(0.55, 0.55, 0.1, 10, 0x6fc3e8, { x: 0.55, y: 0.16, z: 0.35 }), // pond
      ico(0.34, 0, 0x4f9a58, { x: -0.7, y: 0.4, z: -0.3 }), // grove
      ico(0.26, 0, 0x5fae5f, { x: -0.2, y: 0.36, z: 0.6 }), // grove
      ico(0.22, 0, 0x4f8a50, { x: -0.95, y: 0.32, z: 0.5 }), // grove
      box(0.9, 0.05, 0.3, 0xd8cfb8, { x: 0.4, y: 0.14, z: -0.6 }), // gravel path
    ]);
  },
});

add({
  id: 'pier',
  displayNameJa: '埠頭',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 210,
  radiusJitter: 0.15,
  spawnWeight: 0.9,
  palette: [0xb8b4ac, 0xc0bcb4, 0xb0aca4, 0xc8c4bc],
  yOffset: -0.69,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    const parts = [
      box(3.6, 0.2, 1.8, 0xffffff, { y: 0.1 }), // wharf slab (tinted)
      box(0.16, 1.0, 0.16, 0xe04f3a, { x: -0.9, y: 0.7, z: -0.4 }), // gantry leg
      box(0.16, 1.0, 0.16, 0xe04f3a, { x: -0.9, y: 0.7, z: 0.4 }), // gantry leg
      box(1.3, 0.14, 0.18, 0xe04f3a, { x: -0.55, y: 1.22 }), // gantry boom
    ];
    const contHex = [0x3f8cff, 0xe07a3a, 0x49c45f, 0xc94f46, 0xffd84d];
    for (let i = 0; i < 5; i++) {
      parts.push(
        box(0.6, 0.26, 0.26, contHex[i], {
          x: 0.3 + (i % 2) * 0.7,
          y: 0.33 + ((i / 2) | 0) * 0.27,
          z: 0.45,
        })
      ); // container stack
    }
    return finish(parts);
  },
});

add({
  id: 'building_cluster',
  displayNameJa: 'ビル群',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 260,
  radiusJitter: 0.18,
  spawnWeight: 1.0,
  palette: [0x9ab0c8, 0xb0a8c8, 0x98b8b0, 0xa8b8d0],
  yOffset: -0.29,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      box(2.6, 0.12, 2.0, 0x8f949c, { y: 0.06 }), // block base
      towerBanded(0.8, 2.6, 0.8, 8, 0xffffff, 0x2e3c52, 0xffd98a, rng, { x: -0.7, y: 1.42 }), // tower A (tinted)
      towerBanded(0.7, 1.9, 0.7, 6, 0xf2f2f2, 0x35414e, 0xffd98a, rng, { x: 0.35, y: 1.07, z: 0.4 }), // tower B
      towerBanded(0.6, 1.4, 0.6, 5, 0xe8e8ea, 0x3a4456, 0xffe0a0, rng, { x: 0.85, y: 0.82, z: -0.55 }), // tower C
      cyl(0.03, 0.03, 0.6, 5, 0xc8ccd4, { x: -0.7, y: 3.0 }), // antenna
    ]);
  },
});

add({
  id: 'river_block',
  displayNameJa: '川面ブロック',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 200,
  radiusJitter: 0.15,
  spawnWeight: 0.9,
  palette: [0x4a7a9a, 0x4a6a9a, 0x5a8aa8, 0x3f6a8a],
  yOffset: -0.88,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    return finish([
      box(3.6, 0.1, 1.9, 0xffffff, { y: 0.05, hex2: 0x9fd0e8 }), // water surface (tinted)
      box(3.6, 0.18, 0.3, 0x8a9a7a, { y: 0.12, z: 1.05 }), // grass bank
      box(3.6, 0.18, 0.3, 0x8a9a7a, { y: 0.12, z: -1.05 }), // grass bank
      box(0.7, 0.08, 2.3, 0xc8c4bc, { y: 0.32 }), // crossing bridge
      cyl(0.08, 0.1, 0.3, 5, 0xb8b4ac, { y: 0.16, z: 0.7 }), // bridge pier
      cyl(0.08, 0.1, 0.3, 5, 0xb8b4ac, { y: 0.16, z: -0.7 }), // bridge pier
      box(0.5, 0.12, 0.2, 0xe8e4da, { x: 1.2, y: 0.16 }), // river bus
    ]);
  },
});

add({
  id: 'arena',
  displayNameJa: '競技場',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 230,
  radiusJitter: 0.12,
  spawnWeight: 0.8,
  palette: [0xd8d4cc, 0xd4ccd8, 0xccd8d0, 0xe0dcd4],
  yOffset: -0.66,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      torus(1.2, 0.42, 5, 14, 0xffffff, { rx: HALF_PI, sx: 1.3, sy: 0.8, y: 0.42, hex2: 0xc8c4ba }), // bowl (tinted)
      sph(1.25, 0xe8e4dc, { ws: 12, hs: 4, theta0: 0, thetaLen: 0.5, sx: 1.3, y: 0.1 }), // roof shell cap
      cyl(0.95, 0.95, 0.12, 12, 0x5fae5f, { sx: 1.3, y: 0.06 }), // field
      box(0.5, 0.3, 0.14, 0xd2d6dc, { x: -1.85, y: 0.35 }), // entrance gate
    ]);
  },
});

add({
  id: 'forest',
  displayNameJa: '森',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 240,
  radiusJitter: 0.22,
  spawnWeight: 1.1,
  palette: [0x4f8a50, 0x5f9a58, 0x447a48, 0x6aa85f],
  yOffset: -0.55,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      ico(1.0, 1, 0xffffff, { sy: 0.7, y: 0.75, hex2: 0xc8e0a8 }), // canopy mass (tinted)
      ico(0.7, 1, 0xf2f6ea, { x: 0.85, sy: 0.75, y: 0.6, hex2: 0xc8e0a8 }), // canopy lobe
      ico(0.6, 1, 0xeef2e2, { x: -0.85, sy: 0.8, y: 0.55, z: 0.3, hex2: 0xc8e0a8 }), // canopy lobe
      cyl(0.1, 0.16, 0.5, 5, 0x6a4a32, { y: 0.22 }), // trunk
      cyl(0.08, 0.13, 0.45, 5, 0x6a4a32, { x: 0.8, y: 0.2 }), // trunk
      cyl(0.08, 0.13, 0.45, 5, 0x6a4a32, { x: -0.8, y: 0.2, z: 0.3 }), // trunk
    ]);
  },
});

add({
  id: 'cloud',
  displayNameJa: '雲',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 180,
  radiusJitter: 0.25,
  spawnWeight: 1.0,
  palette: [0xffffff, 0xf6f8fc, 0xf0f4fa, 0xfdf8f0],
  yOffset: 0.4,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      ico(0.85, 1, 0xffffff, { sy: 0.7, hex2: 0xfdfdfd }), // puff core (tinted)
      ico(0.6, 1, 0xf8fafc, { x: 0.8, y: -0.05, sy: 0.75 }), // puff lobe
      ico(0.55, 1, 0xf4f7fa, { x: -0.78, y: -0.1, sy: 0.7, z: 0.15 }), // puff lobe
      ico(0.45, 0, 0xffffff, { y: 0.45, x: 0.2 }), // top puff
    ]);
  },
});

/* ---- T6 chunk landmarks (slots 8/9 — dusk scenery; outgrow the goal) */

add({
  id: 'great_hill',
  displayNameJa: '大丘陵',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 700,
  radiusJitter: 0.2,
  spawnWeight: 0.3,
  palette: [0x6a9a5c, 0x5f8a52, 0x7aa868, 0x568048],
  yOffset: -0.6,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      cone(1.45, 1.5, 9, 0x4f7a48, { y: 0.75, hex2: 0xa8c890 }), // main rise
      cone(0.95, 1.0, 8, 0x4a7244, { x: 0.85, y: 0.5, hex2: 0x9cc088 }), // shoulder
      cone(0.8, 0.85, 7, 0x527a4c, { x: -0.75, y: 0.42, z: 0.35, hex2: 0x9cc088 }), // foothill
      ico(0.2, 0, 0x9a948a, { x: 0.3, y: 0.35, z: -0.6 }), // outcrop
    ]);
  },
});

add({
  id: 'ring_road',
  displayNameJa: '環状線リング',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 800,
  radiusJitter: 0.12,
  spawnWeight: 0.25,
  palette: [0xb8b4ac, 0xc0bcb4, 0xb0aca4, 0xc8c4bc],
  yOffset: -0.82,
  upright: true,
  collisionScale: 0.35,
  buildGeometry(rng) {
    return finish([
      torus(1.0, 0.16, 4, 22, 0xffffff, { rx: HALF_PI, sy: 1.0, y: 0.16 }), // elevated loop (tinted)
      cyl(0.8, 0.8, 0.06, 16, 0x6f9a60, { y: 0.03 }), // inner green
      box(0.2, 0.08, 0.1, 0xe04f3a, { x: 1.0, y: 0.3 }), // car
      box(0.2, 0.08, 0.1, 0x3f8cff, { x: -1.0, y: 0.3 }), // car
      box(0.2, 0.08, 0.1, 0xffd84d, { z: 1.0, y: 0.3 }), // car
      cyl(0.06, 0.08, 0.3, 5, 0xb8b4ac, { x: 0.98, y: 0.08, z: 0.2 }), // pier
      cyl(0.06, 0.08, 0.3, 5, 0xb8b4ac, { x: -0.98, y: 0.08, z: -0.2 }), // pier
    ]);
  },
});

/* ================================================================== */
/* EXTRA curated archetypes — codes 70..93 (docs/DESIGN-V3.md 追補)     */
/* ================================================================== */

/**
 * The 4 shared EXTRA render pools (size classes). Stream B builds ONE pool
 * per class (flat +4 draws, ledger 64/72); instance caps below are the
 * worst-case CONCURRENTLY-ALIVE counts, not archetype counts.
 * @type {Readonly<Record<string, number>>}
 */
export const EXTRA_POOL_CAPS = Object.freeze({
  'collectible-small': 12,
  'landmark-mid': 4,
  'landmark-large': 4,
  'landmark-xl': 4,
});

/**
 * EXTRA archetypes keyed by FROZEN code 70..93 (same objects as in CATALOG —
 * each also carries .extraCode and .sizeClass).
 * @type {Record<number, Archetype & {extraCode: number, sizeClass: string|null}>}
 */
export const EXTRA_CATALOG = {};

/**
 * Size-class pool assignment per EXTRA code (70..93). null = never rendered
 * from an EXTRA pool (code 93 東京スカイツリー — goalTower.js/env only).
 * Class membership (frozen): collectible-small = 70..79, 81;
 * landmark-mid = 80 ハチ公, 82 西郷, 83 雷門, 84 ラジオ会館 + 86 スクランブル
 * 交差点 decal (rides the mid pool — Shibuya worst-case co-location is
 * ハチ公 + decal = 2 of 4 slots); landmark-large = 85 109, 87 ドーム,
 * 88 東京駅, 89 議事堂; landmark-xl = 90 橋スパン (3 concurrent spans!),
 * 91 タワー, 92 shop shell.
 * @type {Record<number, string|null>}
 */
export const EXTRA_SIZE_CLASS_BY_CODE = {};

/**
 * Register an EXTRA curated archetype: goes into CATALOG (by id — shared
 * geometry/collisionScale lookups) AND EXTRA_CATALOG (by frozen code).
 * @param {number} code Frozen EXTRA code 70..93.
 * @param {string|null} sizeClass One of EXTRA_POOL_CAPS keys, or null.
 * @param {Archetype} a Archetype (spawnWeight must be 0 — curated-only).
 */
function addExtra(code, sizeClass, a) {
  a.extraCode = code;
  a.sizeClass = sizeClass;
  CATALOG[a.id] = a;
  EXTRA_CATALOG[code] = a;
  EXTRA_SIZE_CLASS_BY_CODE[code] = sizeClass;
}

/* ---- Collectibles 70..81 (code = 70 + frozen COLLECTIBLE_ID) ------- */
/* FLAG_RARE|FLAG_CURATED at placement (gold tint + sparkle come from the
   rare path); radiusNominal = intended pickup size at its map placement. */

addExtra(70, 'collectible-small', {
  id: 'gold_maneki_neko',
  displayNameJa: '金の招き猫',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.045,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xf0c860, 0xe8c050, 0xf6d070, 0xe0b848],
  yOffset: -0.05,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      sph(0.62, 0xffffff, { sy: 1.05, y: 0.6, hex2: 0xf6e2a0 }), // body (tinted gold)
      sph(0.45, 0xffffff, { y: 1.45 }), // head
      cone(0.14, 0.26, 4, 0xffffff, { x: -0.3, y: 1.82 }), // ear L
      cone(0.14, 0.26, 4, 0xffffff, { x: 0.3, y: 1.82 }), // ear R
      cyl(0.12, 0.12, 0.5, 6, 0xffffff, { rz: 0.5, x: 0.42, y: 1.25 }), // raised paw
      cyl(0.3, 0.3, 0.14, 8, 0xc94f46, { rx: HALF_PI, y: 0.55, z: 0.55 }), // koban coin
      box(0.5, 0.1, 0.1, 0xc23a26, { y: 1.12, z: 0.38 }), // collar
    ]);
  },
});

addExtra(71, 'collectible-small', {
  id: 'vacuum_tube',
  displayNameJa: '真空管',
  tier: 0,
  naturalBand: 0,
  radiusNominal: 0.018,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xd8e0e8, 0xc8d4dc, 0xe0e8ee, 0xd0d8e0],
  yOffset: -0.03,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      cyl(0.4, 0.4, 0.9, 9, 0xffffff, { y: 0.85, hex2: 0xeaf2f6 }), // glass envelope (tinted)
      sph(0.4, 0xffffff, { ws: 9, hs: 5, theta0: 0, thetaLen: HALF_PI, y: 1.3 }), // dome top
      cyl(0.16, 0.16, 0.55, 6, 0x4a4540, { y: 0.85 }), // inner plate
      cyl(0.44, 0.44, 0.32, 9, 0x26292e, { y: 0.16 }), // bakelite base
      cyl(0.04, 0.04, 0.14, 4, 0xc8ccd4, { x: -0.18, y: -0.05 }), // pin
      cyl(0.04, 0.04, 0.14, 4, 0xc8ccd4, { x: 0.18, y: -0.05 }), // pin
    ]);
  },
});

addExtra(72, 'collectible-small', {
  id: 'retro_game_console',
  displayNameJa: 'レトロゲーム機',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.055,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xd8d4cc, 0xc8c4bc, 0xe0dcd4, 0xd0ccc4],
  yOffset: -0.81,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.7, 0.45, 1.25, 0xffffff, { y: 0.22 }), // console body (tinted retro gray)
      box(0.85, 0.12, 0.5, 0x8a3a3a, { x: -0.2, y: 0.5, z: -0.1 }), // cartridge in slot
      cyl(0.09, 0.09, 0.1, 8, 0x3a3f48, { x: 0.55, y: 0.48, z: 0.35 }), // power button
      box(0.55, 0.16, 0.4, 0x4a4f5a, { x: 1.25, y: 0.08, z: 0.75 }), // controller
      box(0.1, 0.04, 0.55, 0x3a3f48, { x: 0.9, y: 0.05, z: 0.6 }), // controller cable
    ]);
  },
});

addExtra(73, 'collectible-small', {
  id: 'akiba_figure',
  displayNameJa: '秋葉原フィギュア',
  tier: 1,
  naturalBand: 1,
  radiusNominal: 0.04,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xff9ab8, 0x8ab0ff, 0xc98aff, 0xffd06a],
  yOffset: -0.12,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      cyl(0.5, 0.55, 0.1, 10, 0xe8ecf0, { y: 0.05 }), // display base
      box(0.22, 0.45, 0.16, 0x39415e, { y: 0.38 }), // legs
      cyl(0.14, 0.2, 0.5, 7, 0xffffff, { y: 0.85 }), // dress torso (tinted)
      sph(0.26, 0xf6dcc4, { y: 1.32 }), // big chibi head
      sph(0.27, 0xffffff, { ws: 7, hs: 3, theta0: 0, thetaLen: 1.4, y: 1.36 }), // hair (tinted)
      cone(0.12, 0.5, 5, 0xffffff, { rz: 1.0, x: -0.4, y: 1.2 }), // twin tail L
      cone(0.12, 0.5, 5, 0xffffff, { rz: -1.0, x: 0.4, y: 1.2 }), // twin tail R
    ]);
  },
});

addExtra(74, 'collectible-small', {
  id: 'gaming_pc',
  displayNameJa: 'ゲーミングPC',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 0.18,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0x2e3138, 0x26292e, 0x3a3f48, 0x2a2d34],
  yOffset: -0.32,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      box(0.95, 1.6, 1.5, 0xffffff, { y: 0.8 }), // tower case (tinted black)
      box(0.06, 1.4, 1.3, 0x4a5568, { x: 0.5, y: 0.8 }), // tempered glass panel
      torus(0.22, 0.05, 4, 10, 0xff4a6a, { ry: HALF_PI, x: 0.52, y: 1.15, z: -0.35 }), // RGB fan
      torus(0.22, 0.05, 4, 10, 0x3fd0ff, { ry: HALF_PI, x: 0.52, y: 0.55, z: -0.35 }), // RGB fan
      box(0.9, 0.08, 1.4, 0x6a3af0, { y: 1.64 }), // RGB top strip
      box(0.9, 0.08, 1.4, 0x3fd08a, { y: 0.04 }), // RGB bottom strip
    ]);
  },
});

addExtra(75, 'collectible-small', {
  id: 'otoro_sushi',
  displayNameJa: '特上大トロ',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 4.5,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xf2a0a8, 0xee94a0, 0xf6acb4, 0xea8a96],
  yOffset: -0.62,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      sph(0.85, 0xf6f4ee, { sx: 1.5, sy: 0.6, y: 0.42 }), // shari rice mound
      sph(0.95, 0xffffff, { sx: 1.55, sy: 0.35, sz: 0.95, y: 0.85, hex2: 0xf6d0d4 }), // toro slab (tinted)
      box(1.6, 0.04, 0.5, 0xf2e6e0, { rz: 0.04, y: 1.03 }), // fat marbling sheen
      box(0.5, 0.06, 0.9, 0x2e5a3a, { x: 1.1, y: 0.2, z: 0.4 }), // bamboo leaf garnish
    ]);
  },
});

addExtra(76, 'collectible-small', {
  id: 'daruma',
  displayNameJa: 'だるま',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 2.0,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xd2402a, 0xc23a26, 0xe04f3a, 0xb83422],
  yOffset: -0.12,
  upright: true,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      sph(0.95, 0xffffff, { sy: 1.02, y: 0.92, hex2: 0xe86a50 }), // body (tinted red)
      sph(0.62, 0xf6e8d2, { ws: 8, hs: 5, sz: 0.55, y: 1.1, z: 0.62 }), // face patch
      sph(0.12, 0x2e2a28, { ws: 6, hs: 4, x: -0.22, y: 1.28, z: 1.0 }), // eye L (painted)
      sph(0.12, 0xf6f2ea, { ws: 6, hs: 4, x: 0.22, y: 1.28, z: 1.0 }), // eye R (blank!)
      box(0.34, 0.16, 0.08, 0xe8c050, { y: 0.62, z: 0.98 }), // gold belly crest
    ]);
  },
});

addExtra(77, 'collectible-small', {
  id: 'panda_plush',
  displayNameJa: 'パンダのぬいぐるみ',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 2.5,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xf2f2ee, 0xe8e8e2, 0xf6f6f2, 0xeeeee8],
  yOffset: -0.1,
  upright: true,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      sph(0.62, 0xffffff, { sy: 1.05, y: 0.6 }), // body (tinted white)
      sph(0.48, 0xffffff, { y: 1.45 }), // head
      sph(0.16, 0x26292e, { ws: 5, hs: 3, x: -0.34, y: 1.82 }), // ear L
      sph(0.16, 0x26292e, { ws: 5, hs: 3, x: 0.34, y: 1.82 }), // ear R
      sph(0.13, 0x26292e, { ws: 5, hs: 3, sx: 0.8, x: -0.18, y: 1.52, z: 0.4 }), // eye patch L
      sph(0.13, 0x26292e, { ws: 5, hs: 3, sx: 0.8, x: 0.18, y: 1.52, z: 0.4 }), // eye patch R
      sph(0.3, 0x26292e, { ws: 5, hs: 3, x: -0.6, y: 0.75 }), // arm L
      sph(0.3, 0x26292e, { ws: 5, hs: 3, x: 0.6, y: 0.75 }), // arm R
      sph(0.26, 0x26292e, { ws: 5, hs: 3, x: -0.32, y: 0.2 }), // leg L
      sph(0.26, 0x26292e, { ws: 5, hs: 3, x: 0.32, y: 0.2 }), // leg R
    ]);
  },
});

addExtra(78, 'collectible-small', {
  id: 'kaminari_okoshi',
  displayNameJa: '雷おこし',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 1.5,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xe8c890, 0xe0c088, 0xf0d098, 0xd8b880],
  yOffset: -0.68,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      box(1.7, 0.6, 1.1, 0xffffff, { y: 0.3, hex2: 0xf2dcb0 }), // puffed-rice block (tinted)
      box(1.74, 0.28, 0.5, 0xc23a26, { y: 0.32 }), // wrapper band (red)
      box(0.42, 0.3, 0.06, 0xf6f2e6, { y: 0.34, z: 0.56 }), // label
      box(0.8, 0.2, 0.5, 0xf0d098, { x: 1.0, y: 0.78, ry: 0.4 }), // loose piece on top
    ]);
  },
});

addExtra(79, 'collectible-small', {
  id: 'golden_object',
  displayNameJa: '金色のオブジェ',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 8,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xf0c860, 0xe8c050, 0xf6d070, 0xe0b848],
  yOffset: -0.45,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.9, 0.55, 1.1, 0x2e3138, { y: 0.28 }), // black granite plinth
      ico(0.75, 1, 0xffffff, { sx: 1.5, sy: 0.62, x: 0.2, y: 0.95, rz: 0.25, hex2: 0xf6e2a0 }), // golden blob (tinted)
      ico(0.3, 0, 0xffffff, { x: 1.15, y: 1.25, rz: 0.6, hex2: 0xf6e2a0 }), // blob tip
    ]);
  },
});

addExtra(80, 'landmark-mid', {
  id: 'hachiko_statue',
  displayNameJa: 'ハチ公像',
  tier: 2,
  naturalBand: 2,
  radiusNominal: 1.2, // FROZEN dioramaR (absorbable @ 1.85m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0x6a7a5a, 0x627252, 0x728262, 0x5a6a4e],
  yOffset: -0.28,
  upright: true,
  collisionScale: 1.0, // FROZEN
  buildGeometry(rng) {
    return finish([
      box(1.1, 0.5, 0.9, 0x8a8580, { y: 0.25 }), // stone pedestal
      sph(0.42, 0xffffff, { sx: 1.45, y: 0.85, hex2: 0xb8c4a0 }), // bronze body (tinted)
      sph(0.3, 0xffffff, { x: 0.5, y: 1.25, hex2: 0xb8c4a0 }), // head
      cone(0.11, 0.24, 4, 0xffffff, { x: 0.36, y: 1.55 }), // erect ear L
      cone(0.11, 0.24, 4, 0xffffff, { x: 0.62, y: 1.55 }), // erect ear R
      sph(0.11, 0xe8e4da, { ws: 6, hs: 4, x: 0.74, y: 1.16 }), // muzzle
      torus(0.18, 0.07, 4, 8, 0xffffff, { arc: PI * 1.5, ry: HALF_PI, x: -0.62, y: 1.05 }), // curled tail
      cyl(0.07, 0.09, 0.35, 5, 0xffffff, { x: 0.3, y: 0.62, z: 0.22 }), // foreleg
      cyl(0.07, 0.09, 0.35, 5, 0xffffff, { x: 0.3, y: 0.62, z: -0.22 }), // foreleg
    ]);
  },
});

addExtra(81, 'collectible-small', {
  id: 'yakatabune',
  displayNameJa: '屋形船',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 12,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xc94f46, 0xb84438, 0xd45a4e, 0xc0483c],
  yOffset: -0.68,
  upright: true,
  collisionScale: 0.75,
  buildGeometry(rng) {
    const parts = [
      box(3.2, 0.4, 1.05, 0x4a3a2e, { y: 0.2 }), // wooden hull
      box(2.3, 0.65, 0.9, 0xffffff, { x: -0.15, y: 0.72, hex2: 0xf2e6d8 }), // cabin (tinted)
      box(2.5, 0.12, 1.05, 0x8a3a30, { x: -0.15, y: 1.1 }), // roof
      box(0.5, 0.3, 0.7, 0x5a4a3a, { x: 1.35, y: 0.5 }), // bow deck
    ];
    for (let i = 0; i < 4; i++) {
      parts.push(sph(0.1, 0xffd06a, { ws: 6, hs: 4, x: -1.2 + i * 0.7, y: 0.95, z: 0.52 })); // lantern row
    }
    return finish(parts);
  },
});

/* ---- Landmark singletons 82..91 + shop shell 92 + Skytree slot 93 -- */
/* radiusNominal/collisionScale are the FROZEN dioramaR/collisionScale of
   the DESIGN-V3.md landmark table; absorb threshold = dioramaR / 0.65. */

addExtra(82, 'landmark-mid', {
  id: 'saigo_statue',
  displayNameJa: '西郷さん像',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 4.0, // FROZEN (absorbable @ 6.2m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0x6a7a5a, 0x627252, 0x728262, 0x5a6a4e],
  yOffset: -0.22,
  upright: true,
  collisionScale: 1.0, // FROZEN
  buildGeometry(rng) {
    return finish([
      box(1.5, 0.7, 1.2, 0x8a8580, { y: 0.35, hex2: 0x9a958c }), // granite pedestal
      box(0.5, 0.7, 0.4, 0xffffff, { y: 1.05, hex2: 0xb8c4a0 }), // bronze legs/kimono (tinted)
      cyl(0.26, 0.36, 0.65, 7, 0xffffff, { y: 1.65, hex2: 0xb8c4a0 }), // torso
      sph(0.2, 0xffffff, { y: 2.12, hex2: 0xb8c4a0 }), // head
      box(0.08, 0.55, 0.08, 0xffffff, { rz: 0.3, x: 0.32, y: 1.55 }), // walking staff
      sph(0.2, 0xffffff, { sx: 1.4, x: 0.65, y: 0.85, hex2: 0xb8c4a0 }), // dog ツン body
      sph(0.13, 0xffffff, { x: 0.92, y: 1.02, hex2: 0xb8c4a0 }), // dog head
    ]);
  },
});

addExtra(83, 'landmark-mid', {
  id: 'kaminarimon',
  displayNameJa: '雷門',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 7.0, // FROZEN (absorbable @ 10.8m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xd2402a, 0xc23a26, 0xe04f3a, 0xb83422],
  yOffset: -0.46,
  upright: true,
  collisionScale: 0.8, // FROZEN
  buildGeometry(rng) {
    return finish([
      cyl(0.16, 0.18, 1.55, 8, 0xffffff, { x: -0.95, y: 0.78 }), // great pillar L (tinted vermilion)
      cyl(0.16, 0.18, 1.55, 8, 0xffffff, { x: 0.95, y: 0.78 }), // great pillar R
      cyl(0.16, 0.18, 1.55, 8, 0xffffff, { x: -1.45, y: 0.78 }), // outer pillar L
      cyl(0.16, 0.18, 1.55, 8, 0xffffff, { x: 1.45, y: 0.78 }), // outer pillar R
      box(3.3, 0.3, 1.0, 0xffffff, { y: 1.68 }), // beam structure
      box(3.5, 0.35, 1.25, 0x2e3a2e, { y: 1.98 }), // tiled roof mass (dark)
      box(3.0, 0.2, 1.05, 0x3a4a3a, { y: 2.2 }), // roof ridge
      cyl(0.52, 0.55, 0.85, 10, 0xc23a26, { y: 0.95, hex2: 0xe04f3a }), // GIANT chochin lantern
      cyl(0.56, 0.56, 0.14, 10, 0x2e2a28, { y: 1.42 }), // lantern top band
      cyl(0.56, 0.56, 0.14, 10, 0x2e2a28, { y: 0.5 }), // lantern bottom band
      box(0.5, 0.3, 0.04, 0x1c1c20, { y: 0.95, z: 0.56 }), // 「雷門」 calligraphy plate
    ]);
  },
});

addExtra(84, 'landmark-mid', {
  id: 'radio_kaikan',
  displayNameJa: 'ラジオ会館風ビル',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 24, // FROZEN (absorbable @ 37m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xe8e4dc, 0xe0dcd4, 0xf0ece4, 0xd8d4cc],
  yOffset: -0.16,
  upright: true,
  collisionScale: 0.9, // FROZEN
  buildGeometry(rng) {
    const parts = [
      towerBanded(1.5, 2.9, 1.2, 9, 0xffffff, 0x44506a, 0xffe0a0, rng, { y: 1.45 }), // cream tower (tinted)
      box(1.56, 0.4, 1.26, 0xe04f3a, { y: 3.05 }), // rooftop sign band (red)
      box(1.0, 0.26, 0.1, 0xf6f2e6, { y: 3.05, z: 0.66 }), // white sign face
      box(1.6, 0.3, 1.3, 0xd8d4cc, { y: 0.15 }), // street podium
    ];
    const signHex = [0xffd84d, 0x3fd0ff, 0xff4a6a, 0x49c45f, 0xff8a3d];
    for (let i = 0; i < 5; i++) {
      parts.push(box(0.34, 0.42, 0.1, signHex[i], { x: 0.84, y: 0.55 + i * 0.5, z: 0.3 })); // stacked shop signs
    }
    return finish(parts);
  },
});

addExtra(85, 'landmark-large', {
  id: 'shibuya_109',
  displayNameJa: '渋谷109',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 28, // FROZEN (absorbable @ 43m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xd8dce2, 0xd0d4da, 0xe0e4ea, 0xc8ccd2],
  yOffset: -0.23,
  upright: true,
  collisionScale: 0.9, // FROZEN
  buildGeometry(rng) {
    return finish([
      cyl(0.85, 0.85, 2.9, 12, 0xffffff, { y: 1.45, hex2: 0xe8ecf2 }), // silver cylinder (tinted)
      cyl(0.9, 0.9, 0.12, 12, 0xb8bec8, { y: 1.0 }), // floor ring
      cyl(0.9, 0.9, 0.12, 12, 0xb8bec8, { y: 1.9 }), // floor ring
      cyl(0.88, 0.88, 0.35, 12, 0x8a9098, { y: 3.05 }), // crown drum
      box(0.55, 0.85, 0.12, 0xc8c8cc, { y: 2.5, z: 0.85 }), // 「109」 sign slab
      box(1.6, 0.5, 1.3, 0xd2d6dc, { x: 0.6, y: 0.25 }), // entrance podium
    ]);
  },
});

addExtra(86, 'landmark-mid', {
  id: 'scramble_crossing',
  displayNameJa: 'スクランブル交差点',
  tier: 4,
  naturalBand: 4,
  radiusNominal: 18, // FROZEN decal radius (flat)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0x4a4f58, 0x444952, 0x50555e, 0x3e434c],
  yOffset: -0.95,
  upright: true,
  collisionScale: 0.3,
  buildGeometry(rng) {
    const parts = [
      cyl(1.0, 1.0, 0.05, 16, 0xffffff, { y: 0.025 }), // asphalt disc (tinted)
    ];
    // Zebra stripes in two crossing directions + diagonals.
    for (let i = 0; i < 5; i++) {
      const off = -0.6 + i * 0.3;
      parts.push(box(0.16, 0.06, 0.85, 0xe8eaee, { x: off, y: 0.05, z: 0 })); // N-S stripes
      parts.push(box(0.85, 0.06, 0.16, 0xdfe2e6, { x: 0, y: 0.07, z: off })); // E-W stripes
    }
    parts.push(box(0.7, 0.06, 0.12, 0xd8dade, { ry: PI / 4, x: 0.45, y: 0.09, z: 0.45 })); // diagonal
    return finish(parts);
  },
});

addExtra(87, 'landmark-large', {
  id: 'tokyo_dome',
  displayNameJa: '東京ドーム',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 55, // FROZEN (absorbable @ 85m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xf2f2ee, 0xeeeee8, 0xf6f6f2, 0xe8e8e2],
  yOffset: -0.65,
  upright: true,
  collisionScale: 0.9, // FROZEN
  buildGeometry(rng) {
    return finish([
      cyl(1.55, 1.65, 0.5, 14, 0xd8d4cc, { y: 0.25 }), // stadium drum
      sph(1.5, 0xffffff, { ws: 14, hs: 6, theta0: 0, thetaLen: 0.95, y: -0.25, hex2: 0xfdfdfa }), // air-membrane roof (tinted)
      box(0.6, 0.35, 0.2, 0xc8c4bc, { z: 1.6, y: 0.3 }), // gate block
      box(0.6, 0.35, 0.2, 0xc8c4bc, { z: -1.6, y: 0.3 }), // gate block
      cyl(0.04, 0.04, 0.6, 5, 0xc8ccd4, { x: 1.55, y: 0.8 }), // light mast
    ]);
  },
});

addExtra(88, 'landmark-large', {
  id: 'tokyo_station',
  displayNameJa: '東京駅丸の内駅舎',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 65, // FROZEN (modeled L180m; absorbable @ 100m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xb05c48, 0xa85440, 0xb86450, 0xa04e3c],
  yOffset: -0.68,
  upright: true,
  collisionScale: 0.55, // FROZEN (long thin building)
  buildGeometry(rng) {
    return finish([
      box(3.6, 0.75, 0.7, 0xffffff, { y: 0.38, hex2: 0xd8a08a }), // red-brick range (tinted)
      box(3.62, 0.1, 0.72, 0xf2ece0, { y: 0.62 }), // white stone string course
      box(3.4, 0.22, 0.6, 0x4a505c, { y: 0.86 }), // slate roof strip
      box(0.8, 0.95, 0.85, 0xffffff, { x: -1.5, y: 0.48, hex2: 0xd8a08a }), // north pavilion
      box(0.8, 0.95, 0.85, 0xffffff, { x: 1.5, y: 0.48, hex2: 0xd8a08a }), // south pavilion
      sph(0.42, 0x3a4450, { ws: 9, hs: 5, theta0: 0, thetaLen: HALF_PI, sy: 0.9, x: -1.5, y: 0.95 }), // dome N
      sph(0.42, 0x3a4450, { ws: 9, hs: 5, theta0: 0, thetaLen: HALF_PI, sy: 0.9, x: 1.5, y: 0.95 }), // dome S
      box(0.6, 0.5, 0.75, 0xffffff, { y: 0.7, hex2: 0xd8a08a }), // central pavilion
      box(0.5, 0.16, 0.65, 0x4a505c, { y: 1.0 }), // central roof
    ]);
  },
});

addExtra(89, 'landmark-large', {
  id: 'national_diet',
  displayNameJa: '国会議事堂',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 75, // FROZEN (absorbable @ 115m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xd8d0c0, 0xd0c8b8, 0xe0d8c8, 0xc8c0b0],
  yOffset: -0.5,
  upright: true,
  collisionScale: 0.7, // FROZEN
  buildGeometry(rng) {
    return finish([
      box(3.4, 0.55, 1.1, 0xffffff, { y: 0.28, hex2: 0xe8e0d0 }), // main range (tinted granite)
      box(1.0, 0.75, 1.2, 0xffffff, { x: -1.45, y: 0.38, hex2: 0xe8e0d0 }), // wing pavilion L (衆議院)
      box(1.0, 0.75, 1.2, 0xffffff, { x: 1.45, y: 0.38, hex2: 0xe8e0d0 }), // wing pavilion R (参議院)
      box(0.9, 1.0, 1.0, 0xffffff, { y: 0.85, hex2: 0xe8e0d0 }), // central tower base
      box(0.7, 0.5, 0.8, 0xf2ece0, { y: 1.6 }), // tower mid
      cone(0.45, 0.55, 4, 0xc8b89c, { ry: PI / 4, y: 2.12 }), // stepped pyramid crown
      box(3.44, 0.1, 1.14, 0xb8b0a0, { y: 0.58 }), // cornice line
    ]);
  },
});

addExtra(90, 'landmark-xl', {
  id: 'rainbow_bridge_span',
  displayNameJa: 'レインボーブリッジ',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 90, // FROZEN per span (3 spans; absorbable @ 138m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xf2f2f0, 0xeeeeec, 0xf6f6f4, 0xe8e8e6],
  yOffset: -0.56,
  upright: true,
  collisionScale: 0.5, // FROZEN
  buildGeometry(rng) {
    return finish([
      box(3.6, 0.16, 0.7, 0x9aa0aa, { y: 1.0 }), // double deck
      box(3.6, 0.1, 0.6, 0xb0b6be, { y: 0.78 }), // lower deck
      box(0.16, 1.6, 0.78, 0xffffff, { x: -1.0, y: 1.05 }), // suspension tower (tinted white)
      box(0.16, 1.6, 0.78, 0xffffff, { x: 1.0, y: 1.05 }), // suspension tower
      box(1.05, 0.05, 0.05, 0xe8e8e2, { rz: -0.55, x: -1.45, y: 1.48, z: 0.3 }), // cable
      box(1.05, 0.05, 0.05, 0xe8e8e2, { rz: 0.55, x: -0.55, y: 1.48, z: 0.3 }), // cable
      box(1.05, 0.05, 0.05, 0xe8e8e2, { rz: -0.55, x: 0.55, y: 1.48, z: 0.3 }), // cable
      box(1.05, 0.05, 0.05, 0xe8e8e2, { rz: 0.55, x: 1.45, y: 1.48, z: 0.3 }), // cable
      box(0.3, 0.95, 0.7, 0x7a8088, { x: -1.0, y: 0.32 }), // pier
      box(0.3, 0.95, 0.7, 0x7a8088, { x: 1.0, y: 0.32 }), // pier
    ]);
  },
});

addExtra(91, 'landmark-xl', {
  id: 'tokyo_tower',
  displayNameJa: '東京タワー',
  tier: 5,
  naturalBand: 5,
  radiusNominal: 170, // FROZEN (1:1 333m; absorbable @ 262m — PENULTIMATE)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xe8543a, 0xe04f38, 0xf05c40, 0xd84a34],
  yOffset: -0.04,
  upright: true,
  collisionScale: 0.45, // FROZEN
  buildGeometry(rng) {
    // International-orange lattice via thin boxes (v2 skytree-recipe style;
    // the white band pattern is baked per part).
    const parts = [
      // 4 splayed legs.
      box(0.1, 2.0, 0.1, 0xffffff, { rz: 0.3, rx: -0.3, x: -0.62, z: 0.62, y: 0.95 }),
      box(0.1, 2.0, 0.1, 0xffffff, { rz: -0.3, rx: -0.3, x: 0.62, z: 0.62, y: 0.95 }),
      box(0.1, 2.0, 0.1, 0xffffff, { rz: 0.3, rx: 0.3, x: -0.62, z: -0.62, y: 0.95 }),
      box(0.1, 2.0, 0.1, 0xffffff, { rz: -0.3, rx: 0.3, x: 0.62, z: -0.62, y: 0.95 }),
      // Lattice cross-brace rings (legs level).
      box(1.7, 0.07, 0.07, 0xffffff, { y: 0.55, z: 0.78 }),
      box(1.7, 0.07, 0.07, 0xffffff, { y: 0.55, z: -0.78 }),
      box(0.07, 0.07, 1.7, 0xffffff, { y: 0.55, x: 0.78 }),
      box(0.07, 0.07, 1.7, 0xffffff, { y: 0.55, x: -0.78 }),
      box(1.1, 0.07, 0.07, 0xffffff, { y: 1.45, z: 0.45 }),
      box(1.1, 0.07, 0.07, 0xffffff, { y: 1.45, z: -0.45 }),
      box(0.07, 0.07, 1.1, 0xffffff, { y: 1.45, x: 0.45 }),
      box(0.07, 0.07, 1.1, 0xffffff, { y: 1.45, x: -0.45 }),
      // Main observatory (white band) at 150m equivalent.
      box(0.95, 0.3, 0.95, 0xf2f2ee, { y: 2.0 }),
      // Upper tapering shaft sections.
      box(0.09, 1.1, 0.09, 0xffffff, { rz: 0.12, x: -0.26, y: 2.65 }),
      box(0.09, 1.1, 0.09, 0xffffff, { rz: -0.12, x: 0.26, y: 2.65 }),
      box(0.09, 1.1, 0.09, 0xffffff, { rx: 0.12, z: -0.26, y: 2.65 }),
      box(0.09, 1.1, 0.09, 0xffffff, { rx: -0.12, z: 0.26, y: 2.65 }),
      box(0.62, 0.06, 0.06, 0xffffff, { y: 2.5 }),
      box(0.06, 0.06, 0.62, 0xffffff, { y: 2.5 }),
      // Top deck (white) + antenna with red/white bands.
      box(0.45, 0.2, 0.45, 0xf2f2ee, { y: 3.25 }),
      cyl(0.05, 0.07, 0.5, 5, 0xffffff, { y: 3.6 }),
      cyl(0.04, 0.05, 0.45, 5, 0xf2f2ee, { y: 4.05 }),
      cyl(0.03, 0.04, 0.4, 5, 0xffffff, { y: 4.45 }),
    ];
    return finish(parts);
  },
});

addExtra(92, 'landmark-xl', {
  id: 'akiba_parts_shop',
  displayNameJa: 'アキバパーツ館',
  tier: 3,
  naturalBand: 3,
  radiusNominal: 4.0, // shop shell (activates at terrain release; absorbable @ 6.2m)
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xffd84d, 0xf6d048, 0xffe060, 0xf0c840],
  yOffset: -0.63,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.9, 0.1, 2.4, 0xb8b4ac, { y: 0.05 }), // floor slab
      box(0.1, 0.85, 2.4, 0xe8e4dc, { x: -0.9, y: 0.48 }), // west wall (roofless shell)
      box(1.9, 0.85, 0.1, 0xe8e4dc, { y: 0.48, z: -1.15 }), // north wall
      box(1.9, 0.85, 0.1, 0xe8e4dc, { y: 0.48, z: 1.15 }), // south wall
      box(0.42, 0.55, 0.5, 0x8a9098, { x: -0.55, y: 0.38, z: -0.7 }), // shelf rows inside
      box(0.42, 0.55, 0.5, 0x8a9098, { x: -0.55, y: 0.38, z: 0.55 }), // shelf rows inside
      box(0.7, 0.35, 0.4, 0xa07848, { x: 0.4, y: 0.28, z: -0.8 }), // counter
      box(1.95, 0.4, 0.12, 0xffffff, { x: 0, y: 1.05, z: 1.22 }), // facade sign (tinted yellow)
      box(0.9, 0.26, 0.06, 0xe04f3a, { y: 1.05, z: 1.3 }), // red logo plate
    ]);
  },
});

addExtra(93, null, {
  // DISPLAY-NAME RESERVATION ONLY (DESIGN-V3.md 追補): the Skytree is NEVER
  // spawned into the ObjectStore — render/goalTower.js (2 draws, fog:false)
  // + the environment.js sky silhouette represent it. This entry exists so
  // DISPLAY_NAME_BY_CODE has 94 entries and dev tools can render the name.
  id: 'tokyo_skytree',
  displayNameJa: '東京スカイツリー',
  tier: 6,
  naturalBand: 6,
  radiusNominal: 380,
  radiusJitter: 0,
  spawnWeight: 0,
  palette: [0xe8ecf0, 0xd8e0e8, 0xf0f0f4, 0xc8d4dc],
  yOffset: -0.02,
  upright: true,
  collisionScale: 0.4,
  buildGeometry(rng) {
    return finish([
      cyl(0.26, 0.46, 1.5, 6, 0xffffff, { y: 0.75 }), // tapered lattice base (tinted)
      cyl(0.16, 0.26, 1.3, 6, 0xf6f6f8, { y: 2.15 }), // mid section
      cyl(0.34, 0.34, 0.16, 10, 0x44505e, { y: 2.88 }), // observation deck 1
      cyl(0.09, 0.15, 0.9, 6, 0xffffff, { y: 3.45 }), // upper section
      cyl(0.2, 0.2, 0.12, 10, 0x44505e, { y: 3.96 }), // observation deck 2
      cyl(0.03, 0.05, 0.95, 5, 0xc8ccd4, { y: 4.5 }), // antenna mast
    ]);
  },
});

/* ================================================================== */
/* DISPLAY_NAME_BY_CODE — string[94], code-indexed (Phase-0 frozen)    */
/* ================================================================== */

/**
 * Code -> Japanese display name (hud absorb-name floats with FLOAT_MERGE_S
 * burst merging, collection album, landmark toasts). Codes 0..69 follow the
 * frozen tiers.js order; 70..93 the frozen EXTRA order from objects.js.
 * Built unconditionally (prod ships it); asserted complete in dev.
 * @type {string[]}
 */
export const DISPLAY_NAME_BY_CODE = (() => {
  const names = new Array(TIERS.length * ARCH_PER_TIER + EXTRA_ARCHETYPE_IDS.length);
  for (let t = 0; t < TIERS.length; t++) {
    const ids = TIERS[t].archetypeIds;
    for (let i = 0; i < ids.length; i++) {
      const a = CATALOG[ids[i]];
      names[t * ARCH_PER_TIER + i] = a !== undefined && a.displayNameJa ? a.displayNameJa : '';
    }
  }
  for (let e = 0; e < EXTRA_ARCHETYPE_IDS.length; e++) {
    const a = CATALOG[EXTRA_ARCHETYPE_IDS[e]];
    names[EXTRA_CODE_BASE + e] = a !== undefined && a.displayNameJa ? a.displayNameJa : '';
  }
  return names;
})();

/* ================================================================== */
/* Dev-mode invariant asserts (stripped from prod by the DEV guard)    */
/* ================================================================== */

if (import.meta.env && import.meta.env.DEV) {
  /** @param {boolean} cond @param {string} msg */
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`[catalog.js invariant] ${msg}`);
  };

  /** Shared per-entry shape checks (chunk + EXTRA). @param {Archetype} a @param {string} ctx */
  const checkCommon = (a, ctx) => {
    assert(a.radiusNominal > 0, `${ctx}: radiusNominal must be > 0`);
    assert(a.radiusJitter >= 0 && a.radiusJitter < 1, `${ctx}: radiusJitter out of range`);
    assert(a.palette.length >= 4 && a.palette.length <= 6, `${ctx}: palette must have 4-6 tints`);
    assert(a.yOffset > -1.01 && a.yOffset <= 0.5, `${ctx}: yOffset out of sane range`);
    assert(a.collisionScale > 0 && a.collisionScale <= 1, `${ctx}: collisionScale out of range`);
    assert(typeof a.buildGeometry === 'function', `${ctx}: buildGeometry missing`);
    assert(
      typeof a.displayNameJa === 'string' && a.displayNameJa.length > 0,
      `${ctx}: displayNameJa missing (v3 — every archetype carries the frozen Japanese name)`
    );
    assert(
      Number.isInteger(a.naturalBand) && a.naturalBand >= 0 && a.naturalBand < TIERS.length,
      `${ctx}: naturalBand must be a tier index 0..${TIERS.length - 1}`
    );
  };

  // ---- 70 chunk archetypes (frozen tiers.js ids) ----------------------
  let total = 0;
  for (let t = 0; t < TIERS.length; t++) {
    const ids = TIERS[t].archetypeIds;
    for (const id of ids) {
      const a = CATALOG[id];
      assert(a !== undefined, `tier ${t}: missing archetype '${id}'`);
      assert(a.id === id, `'${id}': id field mismatch`);
      assert(a.tier === t, `'${id}': tier field must be ${t}`);
      assert(a.naturalBand === t, `'${id}': chunk naturalBand must equal its tier (${t})`);
      assert(a.spawnWeight > 0, `'${id}': chunk spawnWeight must be > 0`);
      checkCommon(a, `'${id}'`);
      total++;
    }
  }
  assert(total === 70, `exactly 70 chunk archetypes required (10 x 7, v3 stride), found ${total}`);

  // ---- 24 EXTRA curated archetypes (frozen objects.js codes 70..93) ---
  for (let e = 0; e < EXTRA_ARCHETYPE_IDS.length; e++) {
    const code = EXTRA_CODE_BASE + e;
    const id = EXTRA_ARCHETYPE_IDS[e];
    const a = EXTRA_CATALOG[code];
    assert(a !== undefined, `EXTRA code ${code}: missing archetype '${id}'`);
    assert(a.id === id, `EXTRA code ${code}: id must be '${id}', found '${a.id}'`);
    assert(CATALOG[id] === a, `EXTRA '${id}': must be the same object in CATALOG and EXTRA_CATALOG`);
    assert(a.extraCode === code, `EXTRA '${id}': extraCode field mismatch`);
    assert(a.spawnWeight === 0, `EXTRA '${id}': spawnWeight must be 0 (curated-only, never chunk-rolled)`);
    assert(a.tier === a.naturalBand, `EXTRA '${id}': tier field must equal naturalBand (types.js contract)`);
    if (code === 93) {
      assert(a.sizeClass === null, `code 93 (tokyo_skytree) must have sizeClass null — never pooled/spawned`);
    } else {
      assert(
        EXTRA_POOL_CAPS[a.sizeClass] !== undefined,
        `EXTRA '${id}': sizeClass '${a.sizeClass}' must be one of the 4 frozen pool classes`
      );
    }
    assert(EXTRA_SIZE_CLASS_BY_CODE[code] === a.sizeClass, `EXTRA '${id}': size-class table mismatch`);
    checkCommon(a, `EXTRA '${id}'`);
  }
  // Frozen collisionScale spot checks from the landmark table.
  assert(CATALOG['hachiko_statue'].collisionScale === 1.0, 'ハチ公像 collisionScale frozen at 1.0');
  assert(CATALOG['kaminarimon'].collisionScale === 0.8, '雷門 collisionScale frozen at 0.8');
  assert(CATALOG['tokyo_station'].collisionScale === 0.55, '東京駅 collisionScale frozen at 0.55');
  assert(CATALOG['rainbow_bridge_span'].collisionScale === 0.5, '橋スパン collisionScale frozen at 0.5');
  assert(CATALOG['tokyo_tower'].collisionScale === 0.45, '東京タワー collisionScale frozen at 0.45');
  assert(CATALOG['tokyo_tower'].radiusNominal === 170, '東京タワー dioramaR frozen at 170');

  // ---- totals + display-name table ------------------------------------
  assert(
    Object.keys(CATALOG).length === 94,
    `CATALOG must contain exactly 94 ids (70 chunk + 24 EXTRA), found ${Object.keys(CATALOG).length}`
  );
  assert(DISPLAY_NAME_BY_CODE.length === 94, 'DISPLAY_NAME_BY_CODE must have exactly 94 entries');
  for (let c = 0; c < 94; c++) {
    assert(DISPLAY_NAME_BY_CODE[c].length > 0, `DISPLAY_NAME_BY_CODE hole at code ${c}`);
  }
  assert(DISPLAY_NAME_BY_CODE[93] === '東京スカイツリー', 'code 93 reserved for 東京スカイツリー');
}
