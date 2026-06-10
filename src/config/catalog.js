/**
 * @file catalog.js — All 60 spawnable archetypes (ARCH_PER_TIER 10 per tier
 * x 6 tiers). v2: slots [8]/[9] of every tier are LANDMARKS — radiusNominal
 * ~2.5-4x the tier's largest absorbable, spawnWeight 0.25-0.35, upright,
 * archRoll-eligible only at chunk placement j === 0 (spawner's landmark
 * eligibility rule). They use the same build/physics path as everything else
 * and are absorbed normally once outgrown late in the NEXT tier.
 *
 * Each archetype's buildGeometry(rng) returns ONE merged, vertex-colored
 * BufferGeometry composed of a handful of low-segment primitives
 * (<= ARCHETYPE_TRI_CAP = 350 triangles). Built ONCE at boot by
 * render/geometryFactory.js — allocation here is fine, per-frame code never
 * touches this module.
 *
 * GEOMETRY CONVENTION (binding for spawner / instances / absorb):
 *   - Every returned geometry is normalized to a UNIT BOUNDING SPHERE
 *     (radius 1.0) centered at the geometry origin. Instance scale =
 *     the placed object's radiusSim, directly.
 *   - yOffset positions the object center at restY = radius * (1 + yOffset),
 *     so yOffset = 0 means "sphere sitting on the ground" and flat objects
 *     (coin, book) use strongly negative offsets. Values here were measured
 *     from the normalized geometry (yOffset = -1 - minY_unit) and rounded.
 *   - Vertex colors are baked in WORKING (linear) color space via THREE.Color;
 *     palette entries are hex tints applied per-instance via instanceColor
 *     (final color = vertexColor * instanceColor under MeshLambertMaterial
 *     {vertexColors:true}). Archetypes whose "body" part is baked near-white
 *     use saturated palettes; fixed-color parts (wheels, metal) are baked
 *     dark/desaturated so tints only nudge them.
 *
 * Archetype ids are FROZEN by config/tiers.js — asserted below in dev mode.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TIERS } from './tiers.js';

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
 * "vertex-color window bands" of apartments and skyscrapers).
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
/* T0 — Desk (objects ~1-10 cm radius)                                  */
/* ------------------------------------------------------------------ */

add({
  id: 'thumbtack',
  tier: 0,
  radiusNominal: 0.012,
  radiusJitter: 0.25,
  spawnWeight: 1.4,
  palette: [0xff5340, 0x3f8cff, 0x49c45f, 0xffc83d, 0xb05cff],
  yOffset: -0.22,
  upright: true,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      cyl(0.5, 0.5, 0.15, 10, 0xffffff, { y: 0.5 }), // plastic head disc (tinted)
      cyl(0.18, 0.24, 0.2, 8, 0xffffff, { y: 0.67 }), // knob
      cone(0.09, 0.55, 6, 0x9aa0a8, { rx: PI, y: 0.18 }), // steel pin, point down
    ]);
  },
});

add({
  id: 'coin',
  tier: 0,
  radiusNominal: 0.012,
  radiusJitter: 0.2,
  spawnWeight: 1.6,
  palette: [0xf5c84b, 0xe8e3da, 0xcf9648, 0xf7d877, 0xc9ccd4],
  yOffset: -0.9,
  upright: true,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      cyl(1, 1, 0.14, 14, 0xfff3d0), // coin body
      cyl(0.72, 0.72, 0.2, 12, 0xe5c878), // raised emboss disc
    ]);
  },
});

add({
  id: 'die',
  tier: 0,
  radiusNominal: 0.014,
  radiusJitter: 0.2,
  spawnWeight: 1.2,
  palette: [0xffffff, 0xff6a5e, 0x5ea0ff, 0x6fdc8c, 0x2e3340],
  yOffset: -0.42,
  upright: false,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      box(1, 1, 1, 0xf6f6f0),
      // three pips on the top face, one on a side — readable at a glance
      box(0.18, 0.08, 0.18, 0x23232e, { x: -0.26, y: 0.5, z: 0.26 }),
      box(0.18, 0.08, 0.18, 0x23232e, { y: 0.5 }),
      box(0.18, 0.08, 0.18, 0x23232e, { x: 0.26, y: 0.5, z: -0.26 }),
      box(0.18, 0.18, 0.08, 0x23232e, { z: 0.5 }),
    ]);
  },
});

add({
  id: 'eraser',
  tier: 0,
  radiusNominal: 0.02,
  radiusJitter: 0.25,
  spawnWeight: 1.3,
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
  tier: 0,
  radiusNominal: 0.018,
  radiusJitter: 0.25,
  spawnWeight: 1.4,
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

add({
  id: 'candy',
  tier: 0,
  radiusNominal: 0.016,
  radiusJitter: 0.25,
  spawnWeight: 1.5,
  palette: [0xff6a8a, 0x6ac4ff, 0xffd84d, 0x8be08a, 0xc98aff, 0xff9a5e],
  yOffset: -0.47,
  upright: false,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      sph(0.55, 0xffffff, { ws: 8, hs: 6 }), // wrapped sweet (tinted)
      cone(0.26, 0.5, 6, 0xf2f2f6, { rz: -HALF_PI, x: 0.78 }), // wrapper twist +x
      cone(0.26, 0.5, 6, 0xf2f2f6, { rz: HALF_PI, x: -0.78 }), // wrapper twist -x
    ]);
  },
});

add({
  id: 'battery',
  tier: 0,
  radiusNominal: 0.024,
  radiusJitter: 0.2,
  spawnWeight: 1.1,
  palette: [0x3a4150, 0xd8893c, 0x4a8a5a, 0xc94f46, 0x5a6ac4],
  yOffset: -0.15,
  upright: false,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      cyl(0.42, 0.42, 1.2, 8, 0xf2f2f2, { hex2: 0xc6cbd4 }), // cell body (tinted)
      cyl(0.43, 0.43, 0.26, 8, 0xe0a050, { y: 0.42 }), // top band
      cyl(0.13, 0.13, 0.14, 6, 0xe8ecf0, { y: 0.66 }), // + terminal nub
    ]);
  },
});

add({
  id: 'key',
  tier: 0,
  radiusNominal: 0.03,
  radiusJitter: 0.25,
  spawnWeight: 1.0,
  palette: [0xf0c860, 0xd9dde4, 0xc89a4a, 0xb8c0cc],
  yOffset: -0.89,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    return finish([
      torus(0.42, 0.13, 4, 10, 0xe8c878, { rx: HALF_PI, z: -0.7 }), // bow ring, lying flat
      box(0.2, 0.13, 1.3, 0xe8c878, { z: 0.18 }), // shaft
      box(0.26, 0.13, 0.22, 0xe8c878, { x: 0.2, z: 0.55 }), // tooth 1
      box(0.34, 0.13, 0.22, 0xe8c878, { x: 0.24, z: 0.78 }), // tooth 2
    ]);
  },
});

/* ---- T0 landmarks (slots 8/9) ------------------------------------ */

add({
  id: 'soda_bottle',
  tier: 0,
  radiusNominal: 0.12,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0x49c45f, 0xff8a3d, 0x8a5cc4, 0xffd84d, 0x5ea0ff],
  yOffset: -0.07,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    return finish([
      cyl(0.34, 0.36, 1.15, 10, 0xffffff, { y: 0.58, hex2: 0xddf2ea }), // body (tinted)
      cyl(0.16, 0.33, 0.38, 10, 0xffffff, { y: 1.34 }), // shoulder taper
      cyl(0.15, 0.15, 0.22, 8, 0xeaf4f0, { y: 1.63 }), // neck
      cyl(0.17, 0.17, 0.1, 8, 0xf2f2f6, { y: 1.79 }), // cap
      cyl(0.37, 0.37, 0.42, 10, 0xf6f6f0, { y: 0.62 }), // label band
    ]);
  },
});

add({
  id: 'desk_globe',
  tier: 0,
  radiusNominal: 0.15,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0x4a8ac4, 0x5ea0ff, 0x49a0a8, 0x6ab0e8],
  yOffset: -0.13,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      cyl(0.42, 0.5, 0.14, 10, 0x6a5a48, { y: 0.07 }), // wooden base
      cyl(0.06, 0.08, 0.32, 6, 0x8a8f9a, { y: 0.3 }), // stem
      sph(0.6, 0xffffff, { ws: 10, hs: 7, rz: 0.41, y: 1.05 }), // globe (tinted ocean)
      torus(0.66, 0.045, 4, 12, 0xd8c9a8, { rz: 0.41, y: 1.05 }), // meridian arc ring
    ]);
  },
});

/* ------------------------------------------------------------------ */
/* T1 — Room (objects ~8-50 cm radius)                                  */
/* ------------------------------------------------------------------ */

add({
  id: 'book',
  tier: 1,
  radiusNominal: 0.16,
  radiusJitter: 0.25,
  spawnWeight: 1.4,
  palette: [0xc94f46, 0x3f6cc4, 0x3f9a5f, 0x8a5cc4, 0xe0a050, 0x36454f],
  yOffset: -0.89,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      box(1.5, 0.24, 2.0, 0xffffff), // cover (tinted)
      box(1.42, 0.18, 1.9, 0xf4eede, { x: 0.06 }), // page block
      box(1.5, 0.06, 2.0, 0xffffff, { y: 0.12 }), // top board accent
    ]);
  },
});

add({
  id: 'mug',
  tier: 1,
  radiusNominal: 0.08,
  radiusJitter: 0.2,
  spawnWeight: 1.4,
  palette: [0xff8a5e, 0x6ab0e8, 0xffd84d, 0x9adfb0, 0xffffff, 0xc98aff],
  yOffset: -0.47,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      cyl(0.55, 0.48, 0.95, 10, 0xffffff), // body (tinted)
      cyl(0.46, 0.46, 0.06, 10, 0x4a2e1c, { y: 0.45 }), // coffee surface
      torus(0.3, 0.09, 4, 8, 0xffffff, { arc: PI, rz: -HALF_PI, ry: HALF_PI, x: 0.6 }), // handle
    ]);
  },
});

add({
  id: 'shoe',
  tier: 1,
  radiusNominal: 0.15,
  radiusJitter: 0.2,
  spawnWeight: 1.2,
  palette: [0xff5340, 0x3f8cff, 0xffffff, 0x36454f, 0xffc83d],
  yOffset: -0.59,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      box(1.7, 0.26, 0.72, 0xf2f2ee), // sole
      box(1.15, 0.5, 0.66, 0xffffff, { x: -0.22, y: 0.38 }), // upper (tinted)
      sph(0.34, 0xffffff, { ws: 7, hs: 4, sx: 1.3, x: 0.62, y: 0.3 }), // toe cap
      box(0.4, 0.3, 0.6, 0xe8e8e2, { x: -0.62, y: 0.62 }), // ankle collar
    ]);
  },
});

add({
  id: 'plushie',
  tier: 1,
  radiusNominal: 0.2,
  radiusJitter: 0.25,
  spawnWeight: 1.3,
  palette: [0xe8b06a, 0xff9ab8, 0x9ac8f0, 0xc8e8a0, 0xe8e0d0],
  yOffset: -0.05,
  upright: true,
  collisionScale: 1,
  buildGeometry(rng) {
    return finish([
      sph(0.62, 0xffffff, { sy: 1.1, y: 0.55 }), // body (tinted)
      sph(0.46, 0xffffff, { y: 1.45 }), // head
      sph(0.17, 0xffffff, { ws: 6, hs: 4, x: -0.32, y: 1.82 }), // ear L
      sph(0.17, 0xffffff, { ws: 6, hs: 4, x: 0.32, y: 1.82 }), // ear R
      sph(0.2, 0xf6ead2, { ws: 6, hs: 4, y: 1.34, z: 0.38 }), // snout
      sph(0.34, 0xf6ead2, { ws: 6, hs: 4, sz: 0.6, y: 0.62, z: 0.5 }), // belly patch
    ]);
  },
});

add({
  id: 'lamp',
  tier: 1,
  radiusNominal: 0.28,
  radiusJitter: 0.2,
  spawnWeight: 1.0,
  palette: [0x4aa0a8, 0xe0a050, 0xc94f46, 0x8a8f9a, 0x3f6cc4],
  yOffset: -0.24,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      cyl(0.42, 0.5, 0.14, 10, 0x5a5f6a, { y: 0.07 }), // base
      cyl(0.05, 0.05, 1.25, 6, 0x8a8f9a, { rz: 0.18, x: 0.1, y: 0.75 }), // arm
      cone(0.5, 0.55, 10, 0xffffff, { rz: 0.5, x: 0.4, y: 1.45 }), // shade (tinted)
      sph(0.16, 0xfff2b8, { ws: 6, hs: 4, x: 0.55, y: 1.32 }), // warm bulb
    ]);
  },
});

add({
  id: 'cat',
  tier: 1,
  radiusNominal: 0.24,
  radiusJitter: 0.2,
  spawnWeight: 1.1,
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
  id: 'stool',
  tier: 1,
  radiusNominal: 0.32,
  radiusJitter: 0.2,
  spawnWeight: 1.0,
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
  id: 'trash_can',
  tier: 1,
  radiusNominal: 0.42,
  radiusJitter: 0.2,
  spawnWeight: 0.9,
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

/* ---- T1 landmarks (slots 8/9) ------------------------------------ */

add({
  id: 'bookshelf',
  tier: 1,
  radiusNominal: 0.9,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0xb07a3f, 0x8a6a4a, 0xc89a6a, 0x6a4a32],
  yOffset: -0.24,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    const parts = [
      box(0.12, 2.0, 0.62, 0xffffff, { x: -0.74, y: 1.0 }), // side (tinted wood)
      box(0.12, 2.0, 0.62, 0xffffff, { x: 0.74, y: 1.0 }), // side
      box(1.6, 0.12, 0.62, 0xffffff, { y: 1.94 }), // top
      box(1.6, 0.12, 0.62, 0xffffff, { y: 0.06 }), // bottom
      box(1.6, 2.0, 0.08, 0xe8dcc8, { y: 1.0, z: -0.27 }), // back panel
      box(1.36, 0.08, 0.56, 0xffffff, { y: 0.72 }), // shelf
      box(1.36, 0.08, 0.56, 0xffffff, { y: 1.36 }), // shelf
    ];
    // 12 colored books, 3 rows x 4 (deterministic per-boot rng heights/colors)
    const bookHex = [0xc94f46, 0x3f6cc4, 0x3f9a5f, 0xe0a050, 0x8a5cc4, 0x4aa0a8];
    const rowY = [0.12, 0.76, 1.4];
    for (let row = 0; row < 3; row++) {
      for (let b = 0; b < 4; b++) {
        const h = 0.4 + rng() * 0.14;
        parts.push(
          box(0.24, h, 0.46, bookHex[(rng() * bookHex.length) | 0], {
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
  id: 'grandfather_clock',
  tier: 1,
  radiusNominal: 1.0,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0x8a5a36, 0x6a4a32, 0xa07848, 0x5a3a28],
  yOffset: -0.09,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      box(0.74, 0.28, 0.5, 0xffffff, { y: 0.14 }), // base (tinted wood)
      box(0.62, 1.3, 0.42, 0xffffff, { y: 0.85 }), // case body
      box(0.4, 0.95, 0.06, 0x2e2620, { y: 0.78, z: 0.2 }), // glass door
      cyl(0.025, 0.025, 0.65, 4, 0xd8c060, { y: 0.95, z: 0.21 }), // pendulum rod
      cyl(0.09, 0.09, 0.04, 8, 0xe8c878, { rx: HALF_PI, y: 0.6, z: 0.22 }), // pendulum bob
      box(0.78, 0.55, 0.52, 0xffffff, { y: 1.78 }), // hood
      cyl(0.24, 0.24, 0.06, 10, 0xf6f2e4, { rx: HALF_PI, y: 1.78, z: 0.25 }), // clock face
      box(0.82, 0.1, 0.56, 0xffffff, { y: 2.1 }), // crown
    ]);
  },
});

/* ------------------------------------------------------------------ */
/* T2 — Street (objects ~0.4-1.5 m radius)                              */
/* ------------------------------------------------------------------ */

add({
  id: 'bicycle',
  tier: 2,
  radiusNominal: 0.9,
  radiusJitter: 0.15,
  spawnWeight: 1.0,
  palette: [0xff5340, 0x3f8cff, 0x49c45f, 0xffc83d, 0xffffff],
  yOffset: -0.56,
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
    ]);
  },
});

add({
  id: 'person',
  tier: 2,
  radiusNominal: 0.9,
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
    ]);
  },
});

add({
  id: 'bench',
  tier: 2,
  radiusNominal: 1.0,
  radiusJitter: 0.15,
  spawnWeight: 1.0,
  palette: [0xb07a3f, 0x5f8a5f, 0x8a6a4a, 0x6a7a8a, 0xc94f46],
  yOffset: -0.52,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    return finish([
      box(2.0, 0.12, 0.6, 0xffffff, { y: 0.55 }), // seat (tinted)
      box(2.0, 0.5, 0.1, 0xffffff, { rx: -0.18, y: 0.88, z: -0.3 }), // backrest
      box(0.1, 0.55, 0.55, 0x3a3f48, { x: -0.85, y: 0.27 }), // leg
      box(0.1, 0.55, 0.55, 0x3a3f48, { x: 0.85, y: 0.27 }), // leg
    ]);
  },
});

add({
  id: 'mailbox',
  tier: 2,
  radiusNominal: 0.7,
  radiusJitter: 0.15,
  spawnWeight: 1.1,
  palette: [0x4a6fa5, 0xc94f46, 0x3f8a5f, 0x36454f],
  yOffset: -0.14,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      cyl(0.09, 0.11, 1.0, 6, 0x3a3f48, { y: 0.5 }), // post
      box(0.6, 0.34, 0.95, 0xffffff, { y: 1.18 }), // box body (tinted)
      cyl(0.3, 0.3, 0.95, 8, 0xffffff, { theta0: -HALF_PI, thetaLen: PI, rx: HALF_PI, y: 1.35 }), // rounded top
      box(0.08, 0.22, 0.06, 0xe04f3a, { x: 0.32, y: 1.48, z: 0.3 }), // flag
    ]);
  },
});

add({
  id: 'sign',
  tier: 2,
  radiusNominal: 1.1,
  radiusJitter: 0.15,
  spawnWeight: 1.2,
  palette: [0xc94f46, 0x3f6cc4, 0xe0a050, 0x3f8a5f, 0xffffff],
  yOffset: 0,
  upright: true,
  collisionScale: 0.55,
  buildGeometry(rng) {
    return finish([
      cyl(0.06, 0.08, 1.7, 6, 0x8a9098, { y: 0.85 }), // pole
      cyl(0.46, 0.46, 0.07, 12, 0xffffff, { rx: HALF_PI, y: 1.85 }), // sign disc (tinted)
      cyl(0.34, 0.34, 0.1, 12, 0xf2f2ee, { rx: HALF_PI, y: 1.85 }), // inner face
    ]);
  },
});

add({
  id: 'dog',
  tier: 2,
  radiusNominal: 0.5,
  radiusJitter: 0.2,
  spawnWeight: 1.3,
  palette: [0xc8915a, 0xf5e9d8, 0x6a5240, 0xe8e8e2, 0x4a4a52],
  yOffset: -0.47,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      sph(0.45, 0xffffff, { sx: 1.6, y: 0.6 }), // body (tinted)
      sph(0.32, 0xffffff, { x: 0.72, y: 1.0 }), // head
      box(0.3, 0.18, 0.2, 0xf6ead2, { x: 1.0, y: 0.9 }), // snout
      box(0.1, 0.26, 0.16, 0xffffff, { rz: 0.4, x: 0.55, y: 1.28 }), // floppy ear L
      box(0.1, 0.26, 0.16, 0xffffff, { rz: -0.4, x: 0.9, y: 1.28 }), // floppy ear R
      cyl(0.05, 0.08, 0.55, 6, 0xffffff, { rz: -0.8, x: -0.95, y: 0.95 }), // tail
    ]);
  },
});

add({
  id: 'cart',
  tier: 2,
  radiusNominal: 0.6,
  radiusJitter: 0.15,
  spawnWeight: 1.0,
  palette: [0xc8ccd4, 0x9ab0c4, 0xd4c89a, 0xb0b8c8],
  yOffset: -0.28,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      box(1.1, 0.6, 0.72, 0xffffff, { y: 0.75, hex2: 0xd2d6de }), // basket (tinted)
      box(1.0, 0.06, 0.66, 0xb8bec8, { y: 0.32 }), // lower tray
      box(0.08, 0.55, 0.7, 0x9aa0aa, { rz: -0.3, x: -0.68, y: 1.18 }), // handle
      cyl(0.12, 0.12, 0.8, 6, 0x2e3138, { rx: HALF_PI, x: 0.42, y: 0.12 }), // front wheels
      cyl(0.12, 0.12, 0.8, 6, 0x2e3138, { rx: HALF_PI, x: -0.42, y: 0.12 }), // rear wheels
    ]);
  },
});

add({
  id: 'hydrant',
  tier: 2,
  radiusNominal: 0.45,
  radiusJitter: 0.15,
  spawnWeight: 1.1,
  palette: [0xe04f3a, 0xffd84d, 0xe8e8e2, 0x4a8ac4],
  yOffset: -0.19,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      cyl(0.32, 0.38, 0.9, 8, 0xffffff, { y: 0.5 }), // body (tinted)
      sph(0.32, 0xffffff, { ws: 8, hs: 4, theta0: 0, thetaLen: HALF_PI, y: 0.95 }), // dome
      cyl(0.12, 0.12, 0.95, 6, 0xf2f2e6, { rz: HALF_PI, y: 0.6 }), // side nozzles
      cyl(0.1, 0.1, 0.14, 6, 0xf2f2e6, { y: 1.18 }), // bonnet nut
      cyl(0.42, 0.46, 0.14, 8, 0xd8d8d0, { y: 0.07 }), // base flange
    ]);
  },
});

/* ---- T2 landmarks (slots 8/9) ------------------------------------ */

add({
  id: 'utility_pole',
  tier: 2,
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
  id: 'torii',
  tier: 2,
  radiusNominal: 3.5,
  radiusJitter: 0.12,
  spawnWeight: 0.25,
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

/* ------------------------------------------------------------------ */
/* T3 — Town (objects ~2-7 m radius)                                    */
/* ------------------------------------------------------------------ */

add({
  id: 'car',
  tier: 3,
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
  id: 'truck',
  tier: 3,
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
  id: 'tree',
  tier: 3,
  radiusNominal: 4.5,
  radiusJitter: 0.3,
  spawnWeight: 1.5,
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
  tier: 3,
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
  id: 'house',
  tier: 3,
  radiusNominal: 6.0,
  radiusJitter: 0.2,
  spawnWeight: 1.0,
  palette: [0xf4e0c0, 0xe8d0d0, 0xd0e0e8, 0xf0e8d0, 0xe0e8d0],
  yOffset: -0.29,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.7, 1.05, 1.4, 0xffffff, { y: 0.52 }), // walls (tinted)
      cyl(0.95, 0.95, 1.85, 3, 0xb05c4a, { theta0: PI, rx: HALF_PI, sy: 0.6, y: 1.32 }), // gable roof prism
      box(0.34, 0.6, 0.08, 0x6a4a32, { y: 0.3, z: 0.71 }), // door
      box(0.3, 0.3, 0.08, 0x9fc4d8, { x: 0.5, y: 0.62, z: 0.71 }), // window
      box(0.22, 0.5, 0.22, 0x8a5a4a, { x: -0.5, y: 1.55 }), // chimney
    ]);
  },
});

add({
  id: 'bus',
  tier: 3,
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
  id: 'fountain',
  tier: 3,
  radiusNominal: 3.5,
  radiusJitter: 0.15,
  spawnWeight: 0.8,
  palette: [0xd8d4cc, 0xc8d4d8, 0xe0d8c8, 0xccc8d8],
  yOffset: -0.5,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      cyl(1.35, 1.45, 0.42, 12, 0xffffff, { y: 0.21 }), // basin (tinted stone)
      cyl(1.18, 1.18, 0.3, 12, 0x6fc3e8, { y: 0.3 }), // water
      cyl(0.18, 0.3, 0.85, 8, 0xe2ded6, { y: 0.85 }), // pedestal
      cyl(0.55, 0.32, 0.22, 10, 0xe2ded6, { y: 1.3 }), // upper bowl
      sph(0.16, 0xa8dff2, { ws: 6, hs: 4, y: 1.52 }), // jet blob
    ]);
  },
});

add({
  id: 'shed',
  tier: 3,
  radiusNominal: 2.0,
  radiusJitter: 0.2,
  spawnWeight: 1.2,
  palette: [0xb07a3f, 0x8a9a6a, 0x9aa4b0, 0xc89a6a],
  yOffset: -0.5,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      box(1.35, 0.95, 1.15, 0xffffff, { y: 0.48, hex2: 0xe8e0d0 }), // walls (tinted)
      box(1.55, 0.1, 1.35, 0x6a7078, { rx: 0.14, y: 1.02 }), // slanted roof
      box(0.4, 0.6, 0.06, 0x5a4a3a, { y: 0.3, z: 0.59 }), // door
    ]);
  },
});

/* ---- T3 landmarks (slots 8/9) ------------------------------------ */

add({
  id: 'pylon',
  tier: 3,
  radiusNominal: 18,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0xb0b8c4, 0x9aa4b0, 0xc0c8d0, 0x8a94a0],
  yOffset: -0.07,
  upright: true,
  collisionScale: 0.5,
  buildGeometry(rng) {
    return finish([
      // 4 tapered lattice legs (thin slanted boxes)
      box(0.08, 2.5, 0.08, 0xffffff, { rz: 0.15, rx: -0.15, x: -0.38, z: 0.38, y: 1.2 }),
      box(0.08, 2.5, 0.08, 0xffffff, { rz: -0.15, rx: -0.15, x: 0.38, z: 0.38, y: 1.2 }),
      box(0.08, 2.5, 0.08, 0xffffff, { rz: 0.15, rx: 0.15, x: -0.38, z: -0.38, y: 1.2 }),
      box(0.08, 2.5, 0.08, 0xffffff, { rz: -0.15, rx: 0.15, x: 0.38, z: -0.38, y: 1.2 }),
      // horizontal brace rings (two levels)
      box(0.95, 0.06, 0.06, 0xffffff, { y: 0.8, z: 0.42 }),
      box(0.95, 0.06, 0.06, 0xffffff, { y: 0.8, z: -0.42 }),
      box(0.06, 0.06, 0.95, 0xffffff, { y: 0.8, x: 0.42 }),
      box(0.06, 0.06, 0.95, 0xffffff, { y: 0.8, x: -0.42 }),
      box(0.62, 0.06, 0.06, 0xffffff, { y: 1.7, z: 0.26 }),
      box(0.62, 0.06, 0.06, 0xffffff, { y: 1.7, z: -0.26 }),
      box(0.06, 0.06, 0.62, 0xffffff, { y: 1.7, x: 0.26 }),
      box(0.06, 0.06, 0.62, 0xffffff, { y: 1.7, x: -0.26 }),
      // conductor cross arms + apex spike
      box(1.5, 0.08, 0.08, 0xffffff, { y: 2.2 }),
      box(1.1, 0.08, 0.08, 0xffffff, { y: 2.5 }),
      cone(0.09, 0.36, 4, 0xffffff, { y: 2.85 }),
    ]);
  },
});

add({
  id: 'giant_tree',
  tier: 3,
  radiusNominal: 14,
  radiusJitter: 0.18,
  spawnWeight: 0.3,
  palette: [0x5f9a58, 0x6fb068, 0x4f8a50, 0x7ec070],
  yOffset: -0.07,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    const lean = (rng() - 0.5) * 0.1;
    return finish([
      cyl(0.36, 0.52, 0.28, 7, 0x5a4030, { y: 0.14 }), // root flare
      cyl(0.2, 0.38, 1.7, 7, 0x6a4a32, { rz: lean, y: 0.95, hex2: 0x7a583c }), // thick trunk
      ico(0.85, 1, 0xffffff, { y: 2.2, hex2: 0xe2f0cc }), // main canopy (tinted)
      ico(0.6, 1, 0xffffff, { x: 0.55 + lean, y: 1.8, hex2: 0xe2f0cc }), // canopy lobe
      ico(0.55, 1, 0xffffff, { x: -0.5, y: 1.95, z: 0.25, hex2: 0xe2f0cc }), // canopy lobe
    ]);
  },
});

/* ------------------------------------------------------------------ */
/* T4 — City (objects ~9-25 m radius)                                   */
/* ------------------------------------------------------------------ */

add({
  id: 'apartment',
  tier: 4,
  radiusNominal: 18,
  radiusJitter: 0.2,
  spawnWeight: 1.3,
  palette: [0xd9cfc2, 0xc2ccd9, 0xd9c2c2, 0xccd9c2, 0xe2d8c8],
  yOffset: -0.19,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      towerBanded(1.25, 2.7, 1.25, 8, 0xffffff, 0x39465e, 0xffd98a, rng, { y: 1.35 }), // banded block (tinted)
      box(1.35, 0.1, 1.35, 0x8a8f9a, { y: 2.75 }), // roof slab
      box(0.5, 0.35, 0.2, 0x6a7078, { y: 0.18, z: 0.7 }), // entrance
    ]);
  },
});

add({
  id: 'crane',
  tier: 4,
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
  id: 'billboard',
  tier: 4,
  radiusNominal: 9,
  radiusJitter: 0.2,
  spawnWeight: 1.1,
  palette: [0xffffff, 0xffd8d8, 0xd8e8ff, 0xfff0c0],
  yOffset: -0.25,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    return finish([
      cyl(0.09, 0.11, 1.5, 6, 0x6a7078, { x: -0.7, y: 0.75 }), // leg
      cyl(0.09, 0.11, 1.5, 6, 0x6a7078, { x: 0.7, y: 0.75 }), // leg
      box(2.3, 1.15, 0.12, 0x4a4f5a, { y: 2.0 }), // frame
      box(2.1, 0.98, 0.16, 0xffffff, { y: 2.0 }), // face (tinted ad)
      box(2.3, 0.08, 0.3, 0x8a8f9a, { y: 2.62 }), // lamp rail
    ]);
  },
});

add({
  id: 'water_tower',
  tier: 4,
  radiusNominal: 12,
  radiusJitter: 0.15,
  spawnWeight: 1.0,
  palette: [0xc8d0d8, 0xd8c8b8, 0xb8c8d8, 0xe0d8c8],
  yOffset: -0.07,
  upright: true,
  collisionScale: 0.8,
  buildGeometry(rng) {
    return finish([
      cyl(0.07, 0.1, 1.5, 6, 0x6a7078, { rz: 0.12, x: -0.45, y: 0.75 }), // leg
      cyl(0.07, 0.1, 1.5, 6, 0x6a7078, { rz: -0.12, x: 0.45, y: 0.75 }), // leg
      cyl(0.07, 0.1, 1.5, 6, 0x6a7078, { rx: 0.12, z: -0.45, y: 0.75 }), // leg
      cyl(0.07, 0.1, 1.5, 6, 0x6a7078, { rx: -0.12, z: 0.45, y: 0.75 }), // leg
      cyl(0.72, 0.78, 0.95, 10, 0xffffff, { y: 1.95, hex2: 0xd8d2c6 }), // tank (tinted)
      cone(0.82, 0.5, 10, 0x8a6a5a, { y: 2.65 }), // roof
    ]);
  },
});

add({
  id: 'smokestack',
  tier: 4,
  radiusNominal: 16,
  radiusJitter: 0.15,
  spawnWeight: 0.9,
  palette: [0xb06a50, 0xa05a48, 0xc08068, 0x9a6a5a],
  yOffset: -0.08,
  upright: true,
  collisionScale: 0.55,
  buildGeometry(rng) {
    return finish([
      cyl(0.3, 0.46, 2.7, 8, 0xffffff, { y: 1.35, hex2: 0xe0d0c8 }), // stack (tinted brick)
      cyl(0.33, 0.33, 0.26, 8, 0xe04f3a, { y: 2.55 }), // red band
      cyl(0.35, 0.35, 0.26, 8, 0xf2f2ee, { y: 2.2 }), // white band
      box(0.8, 0.3, 0.8, 0x8a8f9a, { y: 0.15 }), // plinth
    ]);
  },
});

add({
  id: 'warehouse',
  tier: 4,
  radiusNominal: 15,
  radiusJitter: 0.2,
  spawnWeight: 1.1,
  palette: [0xc8ccd4, 0xd4c8b8, 0xb8c4cc, 0xd0d4c4],
  yOffset: -0.48,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      box(2.7, 1.05, 1.9, 0xffffff, { y: 0.52, hex2: 0xe2e2da }), // hall (tinted)
      cyl(0.95, 0.95, 2.7, 8, 0xa8b0ba, { theta0: 0, thetaLen: PI, rz: HALF_PI, sy: 0.55, y: 1.05 }), // barrel roof
      box(0.6, 0.7, 0.08, 0x5a606a, { x: -0.7, y: 0.35, z: 0.96 }), // door
      box(0.6, 0.7, 0.08, 0x5a606a, { x: 0.7, y: 0.35, z: 0.96 }), // door
    ]);
  },
});

add({
  id: 'overpass',
  tier: 4,
  radiusNominal: 22,
  radiusJitter: 0.12,
  spawnWeight: 0.7,
  palette: [0xc8c4bc, 0xd0ccc4, 0xbcc4c8],
  yOffset: -0.62,
  upright: true,
  collisionScale: 0.55,
  buildGeometry(rng) {
    return finish([
      box(3.4, 0.2, 0.95, 0xffffff, { y: 1.2 }), // deck (tinted concrete)
      box(3.4, 0.14, 0.07, 0xb0aca4, { y: 1.38, z: 0.46 }), // rail
      box(3.4, 0.14, 0.07, 0xb0aca4, { y: 1.38, z: -0.46 }), // rail
      cyl(0.2, 0.24, 1.1, 6, 0xb8b4ac, { x: -1.15, y: 0.55 }), // pillar
      cyl(0.2, 0.24, 1.1, 6, 0xb8b4ac, { x: 1.15, y: 0.55 }), // pillar
    ]);
  },
});

add({
  id: 'gas_tank',
  tier: 4,
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

/* ---- T4 landmarks (slots 8/9) ------------------------------------ */

add({
  id: 'castle',
  tier: 4,
  radiusNominal: 55,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0xf2f2ea, 0xe8e8e0, 0xf6f0e0, 0xeae6da],
  yOffset: -0.32,
  upright: true,
  collisionScale: 0.9,
  buildGeometry(rng) {
    return finish([
      cyl(1.1, 1.5, 0.7, 4, 0x9a958c, { ry: PI / 4, y: 0.35 }), // flared stone base
      box(1.5, 0.52, 1.3, 0xffffff, { y: 0.95 }), // keep tier 1 (tinted plaster)
      cyl(0.92, 1.32, 0.22, 4, 0x3a4450, { ry: PI / 4, y: 1.3 }), // roof skirt 1
      box(1.15, 0.46, 1.0, 0xffffff, { y: 1.55 }), // keep tier 2
      cyl(0.68, 1.02, 0.2, 4, 0x3a4450, { ry: PI / 4, y: 1.86 }), // roof skirt 2
      box(0.85, 0.42, 0.74, 0xffffff, { y: 2.12 }), // keep tier 3
      cyl(0.1, 0.78, 0.4, 4, 0x3a4450, { ry: PI / 4, y: 2.5 }), // top hip roof
      ico(0.07, 0, 0xf0c860, { x: -0.22, y: 2.72 }), // gold shachihoko L
      ico(0.07, 0, 0xf0c860, { x: 0.22, y: 2.72 }), // gold shachihoko R
    ]);
  },
});

add({
  id: 'pagoda',
  tier: 4,
  radiusNominal: 45,
  radiusJitter: 0.12,
  spawnWeight: 0.3,
  palette: [0xf2e8d8, 0xe8dcc8, 0xf6eee0, 0xe0d4c0],
  yOffset: -0.08,
  upright: true,
  collisionScale: 0.7,
  buildGeometry(rng) {
    const parts = [];
    // 5 stacked body+flared-roof tiers, shrinking upward
    for (let i = 0; i < 5; i++) {
      const w = 1.3 - i * 0.18;
      const y = 0.2 + i * 0.56;
      parts.push(box(w * 0.78, 0.34, w * 0.78, 0xffffff, { y: y + 0.17 })); // body (tinted)
      parts.push(cyl(0.16, w * 0.62, 0.2, 4, 0x7a3a30, { ry: PI / 4, y: y + 0.46 })); // flared roof
    }
    parts.push(cyl(0.035, 0.035, 0.7, 5, 0xe8c878, { y: 3.3 })); // sorin spire
    parts.push(cyl(0.1, 0.1, 0.03, 6, 0xe8c878, { y: 3.18 })); // spire ring
    parts.push(cyl(0.08, 0.08, 0.03, 6, 0xe8c878, { y: 3.34 })); // spire ring
    parts.push(cyl(0.06, 0.06, 0.03, 6, 0xe8c878, { y: 3.5 })); // spire ring
    return finish(parts);
  },
});

/* ------------------------------------------------------------------ */
/* T5 — Skyline (objects ~60-130 m radius)                              */
/* ------------------------------------------------------------------ */

add({
  id: 'skyscraper',
  tier: 5,
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
  id: 'stadium',
  tier: 5,
  radiusNominal: 90,
  radiusJitter: 0.12,
  spawnWeight: 0.7,
  palette: [0xd8d4cc, 0xd4ccd8, 0xccd8d0],
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
  id: 'ferris_wheel',
  tier: 5,
  radiusNominal: 70,
  radiusJitter: 0.15,
  spawnWeight: 0.8,
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

add({
  id: 'hill',
  tier: 5,
  radiusNominal: 130,
  radiusJitter: 0.25,
  spawnWeight: 1.2,
  palette: [0x7fb86a, 0x6aa85f, 0x96c47a, 0x88b070],
  yOffset: -0.36,
  upright: true,
  collisionScale: 0.9,
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
  id: 'bridge_span',
  tier: 5,
  radiusNominal: 120,
  radiusJitter: 0.12,
  spawnWeight: 0.7,
  palette: [0xc94f46, 0x8a98a8, 0xb8a060, 0x6a8aa8],
  yOffset: -0.56,
  upright: true,
  collisionScale: 0.55,
  buildGeometry(rng) {
    return finish([
      box(3.6, 0.16, 0.7, 0x9aa0aa, { y: 1.0 }), // deck
      box(0.16, 1.5, 0.78, 0xffffff, { x: -1.0, y: 1.0 }), // tower (tinted)
      box(0.16, 1.5, 0.78, 0xffffff, { x: 1.0, y: 1.0 }), // tower
      box(1.05, 0.05, 0.05, 0xe8e8e2, { rz: -0.55, x: -1.45, y: 1.42, z: 0.3 }), // cable
      box(1.05, 0.05, 0.05, 0xe8e8e2, { rz: 0.55, x: -0.55, y: 1.42, z: 0.3 }), // cable
      box(1.05, 0.05, 0.05, 0xe8e8e2, { rz: -0.55, x: 0.55, y: 1.42, z: 0.3 }), // cable
      box(1.05, 0.05, 0.05, 0xe8e8e2, { rz: 0.55, x: 1.45, y: 1.42, z: 0.3 }), // cable
      box(0.3, 0.9, 0.7, 0x7a8088, { x: -1.0, y: 0.35 }), // pier
      box(0.3, 0.9, 0.7, 0x7a8088, { x: 1.0, y: 0.35 }), // pier
    ]);
  },
});

add({
  id: 'radio_tower',
  tier: 5,
  radiusNominal: 90,
  radiusJitter: 0.15,
  spawnWeight: 0.9,
  palette: [0xd84436, 0xe86a5a, 0xc83a30, 0xe85a4a],
  yOffset: -0.03,
  upright: true,
  collisionScale: 0.45,
  buildGeometry(rng) {
    return finish([
      cyl(0.3, 0.52, 1.1, 4, 0xffffff, { y: 0.55 }), // lattice base section (tinted)
      cyl(0.18, 0.3, 1.1, 4, 0xf2f2ee, { y: 1.65 }), // mid section
      cyl(0.08, 0.18, 1.1, 4, 0xffffff, { y: 2.75 }), // top section
      box(0.7, 0.05, 0.05, 0xe8e8e2, { y: 1.1 }), // cross arm
      cyl(0.03, 0.03, 0.8, 4, 0xc8ccd4, { y: 3.7 }), // antenna
      ico(0.09, 0, 0xff6a5e, { y: 4.12 }), // beacon
    ]);
  },
});

add({
  id: 'dome',
  tier: 5,
  radiusNominal: 60,
  radiusJitter: 0.15,
  spawnWeight: 0.9,
  palette: [0xe2d8c4, 0xc4d2e2, 0xd8e2c8, 0xe2c8c8],
  yOffset: -0.32,
  upright: true,
  collisionScale: 0.95,
  buildGeometry(rng) {
    return finish([
      cyl(0.92, 1.0, 0.55, 12, 0xffffff, { y: 0.28 }), // drum (tinted)
      sph(0.88, 0xd9cfba, { ws: 10, hs: 5, theta0: 0, thetaLen: HALF_PI, y: 0.55 }), // dome shell
      cyl(0.16, 0.16, 0.3, 6, 0xe8e0d0, { y: 1.55 }), // cupola
      ico(0.1, 0, 0xf0c860, { y: 1.78 }), // gold finial
    ]);
  },
});

add({
  id: 'cruise_ship',
  tier: 5,
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

/* ---- T5 landmarks (slots 8/9) ------------------------------------ */

add({
  id: 'mountain',
  tier: 5,
  radiusNominal: 600,
  radiusJitter: 0.25,
  spawnWeight: 0.35,
  palette: [0xf0f0e8, 0xe6efe2, 0xefe6e0, 0xe2e8f0],
  yOffset: -0.55,
  upright: true,
  collisionScale: 0.85,
  buildGeometry(rng) {
    return finish([
      cone(1.45, 1.7, 9, 0x5a7a52, { y: 0.85, hex2: 0xf4f7f8 }), // main peak, snow-cap gradient
      cone(0.95, 1.15, 8, 0x567550, { x: 0.85, y: 0.57, hex2: 0xeef2f4 }), // shoulder peak
      cone(0.8, 1.0, 7, 0x5e7e56, { x: -0.75, y: 0.5, z: 0.35, hex2: 0xeef2f4 }), // foothill peak
    ]);
  },
});

add({
  id: 'skytree',
  tier: 5,
  radiusNominal: 500,
  radiusJitter: 0.1,
  spawnWeight: 0.25,
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
/* Dev-mode invariant asserts (stripped from prod by the DEV guard)    */
/* ================================================================== */

if (import.meta.env && import.meta.env.DEV) {
  /** @param {boolean} cond @param {string} msg */
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`[catalog.js invariant] ${msg}`);
  };

  let total = 0;
  for (let t = 0; t < TIERS.length; t++) {
    const ids = TIERS[t].archetypeIds;
    for (const id of ids) {
      const a = CATALOG[id];
      assert(a !== undefined, `tier ${t}: missing archetype '${id}'`);
      assert(a.id === id, `'${id}': id field mismatch`);
      assert(a.tier === t, `'${id}': tier field must be ${t}`);
      assert(a.radiusNominal > 0, `'${id}': radiusNominal must be > 0`);
      assert(a.radiusJitter >= 0 && a.radiusJitter < 1, `'${id}': radiusJitter out of range`);
      assert(a.spawnWeight > 0, `'${id}': spawnWeight must be > 0`);
      assert(a.palette.length >= 4 && a.palette.length <= 6, `'${id}': palette must have 4-6 tints`);
      assert(a.yOffset > -1.01 && a.yOffset <= 0.5, `'${id}': yOffset out of sane range`);
      assert(a.collisionScale > 0 && a.collisionScale <= 1, `'${id}': collisionScale out of range`);
      assert(typeof a.buildGeometry === 'function', `'${id}': buildGeometry missing`);
      total++;
    }
  }
  assert(total === 60, `exactly 60 archetypes required (10 x 6, v2 stride), found ${total}`);
  assert(Object.keys(CATALOG).length === 60, 'CATALOG must contain exactly the 60 frozen ids');
}
