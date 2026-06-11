/**
 * @file cityMap.js — v3 箱庭東京 (Hakoniwa Tokyo) — THE map data file (Stream B).
 *
 * ALL coordinates are REAL METERS, ORIGIN = BALL START (binding — keeps
 * BallPhysics.reset's hardcoded (0, r, 0) correct). Axes: +X east, +Z south.
 * sim = meters / worldScale (boot worldScale = 0.02 / 0.5 = 0.04).
 *
 * Contents (docs/DESIGN-V3.md §箱庭東京マップ, frozen export signatures in
 * §インターフェース):
 *  - SHOP        アキバパーツ館 interior rect, open front, walls W1-W5,
 *                prisms P1-P4 (the only authored collision besides map
 *                bounds + the Skytree base — world/terrain.js consumes).
 *  - PLACEMENTS  ~400 CuratedPlacement records (≈236 interior from seeded
 *                cluster expansion + ≈148 street/gutter/district + 12
 *                collectibles + 12 landmark placements + shop shell),
 *                expanded at module load from cluster records via
 *                mulberry32(0x544f4b59) — seed-INDEPENDENT: identical across
 *                runs; only chunk filler varies with ?seed=.
 *  - ZONES + bandAllowedAt()  chunk-spawner zone masks (static pure lookup,
 *                REAL METERS; mask 0 inside the shop interior and outside
 *                MAP_BOUNDS; T6 allowed map-wide).
 *  - LANDMARKS   11 landmark defs (frozen landmarkId 0..10, threshold ladder).
 *  - COLLECTIBLE_IDS (frozen EXPLICIT enum 0..11, append-only) + COLLECTIBLES.
 *  - SKYTREE_POS, MAP_BOUNDS (re-export — single source is tuning.js),
 *    DEV_STARTS.
 *  - validateCityMap()  every authored-data assert from the spec; DEV builds
 *                run it at module load; headless tests call it directly.
 *
 * FROZEN EXTRA archetype codes (docs/DESIGN-V3.md Phase-0 追補):
 *   collectibles: code = 70 + collectibleId (70..81; 80 = ハチ公像 DUAL)
 *   landmarks:    82 西郷さん像, 83 雷門, 84 ラジオ会館風ビル, 85 渋谷109,
 *                 86 スクランブル交差点(デカール), 87 東京ドーム, 88 東京駅,
 *                 89 国会議事堂, 90 レインボーブリッジ橋スパン, 91 東京タワー
 *   92 アキバパーツ館 (shop shell), 93 東京スカイツリー (display-name slot
 *   ONLY — never spawned into the store; not a placement here).
 */

import { mulberry32 } from '../core/rng.js';
import { ARCHETYPE_CODE_BY_ID } from '../world/objects.js';
import {
  ABSORB_RATIO,
  CURATED_PLACEMENT_CAP,
  GOAL_CONTACT_PAD,
  GROWTH_K,
  INTERIOR_ITEM_Y_MAX,
  MAP_BOUNDS as MAP_BOUNDS_TUNING,
  PICKUP_FORGIVE_K,
  SKYTREE_COLLIDER_K,
  START_RADIUS_M,
  WALL_THICK_M,
  WALL_TOP_M,
} from './tuning.js';

/** @typedef {import('../types.js').CuratedPlacement} CuratedPlacement */
/** @typedef {import('../types.js').LandmarkDef} LandmarkDef */
/** @typedef {import('../types.js').CollectibleDef} CollectibleDef */
/** @typedef {import('../types.js').ZoneRect} ZoneRect */

/* ================================================================== */
/* Bounds / fixed positions                                            */
/* ================================================================== */

/** Diorama bounds — re-export, SINGLE SOURCE IS tuning.js (no double upkeep). */
export const MAP_BOUNDS = MAP_BOUNDS_TUNING;

/** 東京スカイツリー (GOAL) fixed position — finale contact + permanent terrain
 *  base collider + environment silhouette azimuth all derive from this. */
export const SKYTREE_POS = Object.freeze({ x: 900, z: -520 });

/** Dev teleport starts (?at=name&r=meters; main.js devTeleport). FROZEN. */
export const DEV_STARTS = Object.freeze({
  shop: Object.freeze({ x: 0, z: 0, r: 0.02 }),
  street: Object.freeze({ x: 30, z: 0, r: 0.3 }),
  ueno: Object.freeze({ x: -150, z: -400, r: 4 }),
  marunouchi: Object.freeze({ x: -100, z: 450, r: 40 }),
  tower: Object.freeze({ x: -420, z: 1000, r: 250 }),
  goal: Object.freeze({ x: 700, z: -400, r: 400 }),
});

/* ================================================================== */
/* EXTRA archetype codes (frozen Phase-0 appendix)                     */
/* ================================================================== */

/** First EXTRA curated code (collectible id 0). Codes 0..69 are chunk codes. */
export const EXTRA_CODE_BASE = 70;
const CODE_SAIGO = 82;
const CODE_KAMINARIMON = 83;
const CODE_RADIO_KAIKAN = 84;
const CODE_SHIBUYA109 = 85;
const CODE_SCRAMBLE = 86;
const CODE_DOME = 87;
const CODE_TOKYO_STATION = 88;
const CODE_DIET = 89;
const CODE_BRIDGE_SPAN = 90;
const CODE_TOKYO_TOWER = 91;
/** アキバパーツ館 shop shell (activates at terrain release, absorbable @6.2m). */
export const CODE_SHOP_SHELL = 92;

/** Chunk-code lookup (frozen tier table order via objects.js). */
const C = ARCHETYPE_CODE_BY_ID;

/* ================================================================== */
/* A. PARTS SHOP 「アキバパーツ館」 — terrain + interior                */
/* ================================================================== */

/**
 * Shop geometry (world/terrain.js consumes; REAL METERS, ball-origin coords).
 * Interior rect x[-1.4, +4.6] x z[-4.8, +3.2] (6x8 m), FULL-WIDTH open front
 * on the east face x = +4.6, opening z[-3.6, +2.0] (5.6 m clear, gate radius
 * 2.8 m). Floor flush with the street at h = 0 — zero steps anywhere.
 */
export const SHOP = Object.freeze({
  interior: Object.freeze({ x0: -1.4, x1: 4.6, z0: -4.8, z1: 3.2 }),
  /** Open front: east face, no door object exists. */
  openFront: Object.freeze({ x: 4.6, z0: -3.6, z1: 2.0, gateRadiusM: 2.8 }),
  /** Shop center (shell placement; authored around the origin = ball start). */
  center: Object.freeze({ x: 1.6, z: -0.8 }),
  /** @type {import('../types.js').TerrainWall[]} W1 west, W2 north, W3 south, W4/W5 east jambs. */
  walls: Object.freeze([
    Object.freeze({ x0: -1.4, z0: -4.8, x1: -1.4, z1: 3.2, thickness: WALL_THICK_M, yTop: WALL_TOP_M }),
    Object.freeze({ x0: -1.4, z0: -4.8, x1: 4.6, z1: -4.8, thickness: WALL_THICK_M, yTop: WALL_TOP_M }),
    Object.freeze({ x0: -1.4, z0: 3.2, x1: 4.6, z1: 3.2, thickness: WALL_THICK_M, yTop: WALL_TOP_M }),
    Object.freeze({ x0: 4.6, z0: -4.8, x1: 4.6, z1: -3.6, thickness: WALL_THICK_M, yTop: WALL_TOP_M }),
    Object.freeze({ x0: 4.6, z0: 2.0, x1: 4.6, z1: 3.2, thickness: WALL_THICK_M, yTop: WALL_TOP_M }),
  ]),
  /** @type {import('../types.js').TerrainPrism[]} P1 shelf A, P2 shelf B, P3 counter, P4 low table. */
  prisms: Object.freeze([
    Object.freeze({ x0: -1.4, z0: -4.8, x1: 0.1, z1: -1.6, h: 1.4 }),
    Object.freeze({ x0: -1.4, z0: 0.8, x1: 0.1, z1: 3.2, h: 1.4 }),
    Object.freeze({ x0: 1.2, z0: -4.8, x1: 3.9, z1: -3.4, h: 0.95 }),
    Object.freeze({ x0: 2.0, z0: 0.4, x1: 3.4, z1: 2.0, h: 0.4 }),
  ]),
});

/* ================================================================== */
/* Zone masks (chunk spawner)                                          */
/* ================================================================== */

/** @param {...number} bands @returns {number} Bitmask with the given bands set. */
function bandMask(...bands) {
  let m = 0;
  for (const b of bands) m |= 1 << b;
  return m;
}

/** T6 (スカイライン) chunk band is allowed MAP-WIDE (added to every zone). */
const MASK_T6 = bandMask(6);

/**
 * Zone-mask rects, FIRST MATCH WINS, evaluated in order. ~10 axis-aligned
 * rects in REAL METERS (docs/DESIGN-V3.md §C district masks). Everything
 * else inside MAP_BOUNDS falls back to GENERAL_FILL_MASK. Bands 0/1 are
 * allowed NOWHERE — T0/T1 content is 100% curated (shop interior + gutter).
 * @type {ZoneRect[]}
 */
export const ZONES = Object.freeze([
  // 中央通り strip — curated dressing only (gutter line / vending rows); no
  // chunk filler so the exit street stays authored. T6 still allowed.
  Object.freeze({ x0: 4.6, x1: 18, z0: -180, z1: 180, bandMask: MASK_T6 }),
  // 秋葉原 blocks.
  Object.freeze({ x0: 18, x1: 260, z0: -260, z1: 260, bandMask: bandMask(2, 3) | MASK_T6 }),
  // 上野公園.
  Object.freeze({ x0: -300, x1: 200, z0: -650, z1: -250, bandMask: bandMask(3, 4) | MASK_T6 }),
  // 浅草.
  Object.freeze({ x0: 200, x1: 600, z0: -750, z1: -450, bandMask: bandMask(3, 4) | MASK_T6 }),
  // 丸の内/銀座.
  Object.freeze({ x0: -350, x1: 150, z0: 300, z1: 750, bandMask: bandMask(4, 5) | MASK_T6 }),
  // 永田町/霞が関.
  Object.freeze({ x0: -850, x1: -450, z0: 500, z1: 850, bandMask: bandMask(4, 5) | MASK_T6 }),
  // 渋谷.
  Object.freeze({ x0: -1400, x1: -950, z0: 800, z1: 1200, bandMask: bandMask(3, 4, 5) | MASK_T6 }),
  // 水道橋.
  Object.freeze({ x0: -750, x1: -350, z0: -300, z1: 50, bandMask: bandMask(4, 5) | MASK_T6 }),
  // 湾岸.
  Object.freeze({ x0: 100, x1: 900, z0: 1100, z1: 1600, bandMask: bandMask(5, 6) }),
]);

/** General fill for everywhere else inside bounds. */
const GENERAL_FILL_MASK = bandMask(4, 5) | MASK_T6;

/**
 * Is chunk band `band` allowed to place filler at (xReal, zReal)?
 * STATIC PURE LOOKUP (zero allocation, called per chunk placement after the
 * deterministic draws — chunk contents stay a pure function of
 * (seed, cx, cz, band)). Mask 0 inside the shop interior rect and outside
 * MAP_BOUNDS.
 * @param {number} xReal Real-meter X (origin = ball start).
 * @param {number} zReal Real-meter Z.
 * @param {number} band  Chunk band 0..6.
 * @returns {boolean}
 */
export function bandAllowedAt(xReal, zReal, band) {
  if (
    xReal < MAP_BOUNDS.x[0] || xReal > MAP_BOUNDS.x[1] ||
    zReal < MAP_BOUNDS.z[0] || zReal > MAP_BOUNDS.z[1]
  ) {
    return false;
  }
  const sh = SHOP.interior;
  if (xReal >= sh.x0 && xReal <= sh.x1 && zReal >= sh.z0 && zReal <= sh.z1) return false;
  const bit = 1 << band;
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    if (xReal >= z.x0 && xReal <= z.x1 && zReal >= z.z0 && zReal <= z.z1) {
      return (z.bandMask & bit) !== 0;
    }
  }
  return (GENERAL_FILL_MASK & bit) !== 0;
}

/* ================================================================== */
/* Landmark singletons (frozen landmarkId 0..10)                       */
/* ================================================================== */

/** Collectible gold tint (matches RARE_TINT semantics; render hint). */
const GOLD = 0xffd84a;

/**
 * Geo-faithful at ~1:5 compression; absorb threshold = dioramaR / 0.65.
 * landmarkId order = threshold ladder order (frozen Phase-0 appendix).
 * ハチ公像 (id 0) is DUAL landmark+collectible — its single placement is
 * emitted from COLLECTIBLES below (code 80) carrying BOTH ids.
 * @type {LandmarkDef[]}
 */
export const LANDMARKS = Object.freeze([
  { landmarkId: 0, nameJa: 'ハチ公像', x: -1150, z: 962, dioramaR: 1.2, collisionScale: 1.0, sizeReal: 1.6, archetypeCode: 70 + 10, naturalBand: 2, colorHex: 0x7a6a4f },
  { landmarkId: 1, nameJa: '西郷さん像', x: -80, z: -420, dioramaR: 4.0, collisionScale: 1.0, sizeReal: 3.7, archetypeCode: CODE_SAIGO, naturalBand: 3, colorHex: 0x6e7b5a },
  { landmarkId: 2, nameJa: '雷門', x: 350, z: -600, dioramaR: 7.0, collisionScale: 0.8, sizeReal: 11.7, archetypeCode: CODE_KAMINARIMON, naturalBand: 3, colorHex: 0xc0392b },
  { landmarkId: 3, nameJa: 'ラジオ会館風ビル', x: 120, z: 60, dioramaR: 24, collisionScale: 0.9, sizeReal: 46, archetypeCode: CODE_RADIO_KAIKAN, naturalBand: 4, colorHex: 0xd8d3c0 },
  { landmarkId: 4, nameJa: '渋谷109', x: -1150, z: 950, dioramaR: 28, collisionScale: 0.9, sizeReal: 60, archetypeCode: CODE_SHIBUYA109, naturalBand: 4, colorHex: 0xc7ccd4 },
  // スクランブル交差点: flat decal r18 (yK flattens the rest pose); the x16
  // crowd is authored as curated 'person' placements in DISTRICT_CLUSTERS.
  { landmarkId: 5, nameJa: 'スクランブル交差点', x: -1180, z: 990, dioramaR: 18, collisionScale: 0.1, sizeReal: 50, archetypeCode: CODE_SCRAMBLE, naturalBand: 4, colorHex: 0x8a8f99 },
  { landmarkId: 6, nameJa: '東京ドーム', x: -550, z: -120, dioramaR: 55, collisionScale: 0.9, sizeReal: 56, archetypeCode: CODE_DOME, naturalBand: 5, colorHex: 0xe8e6df },
  // 東京駅丸の内駅舎 (modeled L180m -> dioramaR 65, cs .55).
  { landmarkId: 7, nameJa: '東京駅丸の内駅舎', x: -120, z: 480, dioramaR: 65, collisionScale: 0.55, sizeReal: 335, archetypeCode: CODE_TOKYO_STATION, naturalBand: 5, colorHex: 0xa0522d },
  { landmarkId: 8, nameJa: '国会議事堂', x: -650, z: 650, dioramaR: 75, collisionScale: 0.7, sizeReal: 206, archetypeCode: CODE_DIET, naturalBand: 5, colorHex: 0xcfc8b8 },
  // レインボーブリッジ: 3 spans share landmarkId 9 (placements below).
  { landmarkId: 9, nameJa: 'レインボーブリッジ', x: 440, z: 1430, dioramaR: 90, collisionScale: 0.5, sizeReal: 798, archetypeCode: CODE_BRIDGE_SPAN, naturalBand: 5, colorHex: 0xdfe3e8 },
  // 東京タワー — PENULTIMATE (1:1, absorbed normally @ ~262m; its GROWTH_K=10
  // jump to ~406m IS the ramp into the finale band — BINDING resolution).
  { landmarkId: 10, nameJa: '東京タワー', x: -480, z: 1050, dioramaR: 170, collisionScale: 0.45, sizeReal: 333, archetypeCode: CODE_TOKYO_TOWER, naturalBand: 5, colorHex: 0xe85d3d },
]);

/** Extra landmark placements beyond the def table: bridge spans 2 & 3. */
const BRIDGE_SPANS = Object.freeze([
  { x: 300, z: 1380 },
  { x: 440, z: 1430 },
  { x: 580, z: 1480 },
]);

/* ================================================================== */
/* Collectibles (FROZEN EXPLICIT ids 0..11 — append-only, never reused) */
/* ================================================================== */

/**
 * FROZEN ID ENUM (binding, MINOR 14): explicit integer ids, NOT array order.
 * Future patches append ids 12+ and bump the displayed total only; ids are
 * never reused or reordered; the localStorage album mask is keyed by these.
 */
export const COLLECTIBLE_IDS = Object.freeze({
  GOLD_MANEKI_NEKO: 0,
  VACUUM_TUBE: 1,
  RETRO_GAME_CONSOLE: 2,
  AKIBA_FIGURE: 3,
  GAMING_PC: 4,
  OTORO: 5,
  DARUMA: 6,
  PANDA_PLUSH: 7,
  KAMINARI_OKOSHI: 8,
  GOLDEN_OBJET: 9,
  HACHIKO: 10,
  YAKATABUNE: 11,
});

/**
 * 12 collectible defs (archetypeCode = 70 + id, frozen mapping). y = surface
 * rest height (shop shelf/table items); landmarkId -1 except ハチ公像.
 * @type {CollectibleDef[]}
 */
export const COLLECTIBLES = Object.freeze([
  { id: 0, nameJa: '金の招き猫', x: 2.1, y: 0.4, z: 0.7, radiusReal: 0.05, archetypeCode: 70, landmarkId: -1, naturalBand: 1, rIntent: 0.3 },
  { id: 1, nameJa: '真空管', x: 3.34, y: 0.4, z: 1.5, radiusReal: 0.028, archetypeCode: 71, landmarkId: -1, naturalBand: 1, rIntent: 0.3 },
  { id: 2, nameJa: 'レトロゲーム機', x: 0.45, y: 0, z: 3.0, radiusReal: 0.07, archetypeCode: 72, landmarkId: -1, naturalBand: 1, rIntent: 0.15 },
  { id: 3, nameJa: '秋葉原フィギュア', x: 0.06, y: 0.7, z: -2.9, radiusReal: 0.05, archetypeCode: 73, landmarkId: -1, naturalBand: 1, rIntent: 0.4 },
  { id: 4, nameJa: 'ゲーミングPC', x: 9, y: 0, z: -38, radiusReal: 0.25, archetypeCode: 74, landmarkId: -1, naturalBand: 2, rIntent: 0.4 },
  { id: 5, nameJa: '特上大トロ', x: -100, y: 0, z: 460, radiusReal: 0.3, archetypeCode: 75, landmarkId: -1, naturalBand: 2, rIntent: 0.5 },
  { id: 6, nameJa: 'だるま', x: -120, y: 0, z: -380, radiusReal: 0.5, archetypeCode: 76, landmarkId: -1, naturalBand: 2, rIntent: 0.8 },
  { id: 7, nameJa: 'パンダのぬいぐるみ', x: -260, y: 0, z: -470, radiusReal: 0.6, archetypeCode: 77, landmarkId: -1, naturalBand: 2, rIntent: 1.0 },
  { id: 8, nameJa: '雷おこし', x: 360, y: 0, z: -585, radiusReal: 0.4, archetypeCode: 78, landmarkId: -1, naturalBand: 2, rIntent: 0.7 },
  { id: 9, nameJa: '金色のオブジェ', x: 430, y: 0, z: -560, radiusReal: 3.0, archetypeCode: 79, landmarkId: -1, naturalBand: 3, rIntent: 5 },
  // DUAL landmark+collectible: emits EVT.COLLECT FIRST then EVT.LANDMARK.
  { id: 10, nameJa: 'ハチ公像', x: -1150, y: 0, z: 962, radiusReal: 1.2, archetypeCode: 80, landmarkId: 0, naturalBand: 2, rIntent: 1.85 },
  { id: 11, nameJa: '屋形船', x: 380, y: 0, z: 1340, radiusReal: 8.0, archetypeCode: 81, landmarkId: -1, naturalBand: 4, rIntent: 12.5 },
]);

/* ================================================================== */
/* Cluster records -> PLACEMENTS expansion                             */
/* ================================================================== */

/**
 * Cluster record (authoring format, expanded at module load):
 * [archetypeId, x, z, n, spread, rMin, rMax, ySurf, rIntent, rect|null]
 * - x/z: cluster center (REAL m); spread: +-uniform jitter (m).
 * - rect {x0,x1,z0,z1}: optional hard clamp region (shelf/table-top clusters)
 *   — expansion rejection-resamples until inside.
 * - ySurf: surface height the item rests on (0 = floor; <= INTERIOR_ITEM_Y_MAX
 *   for interior). Item CENTER = ySurf + radiusReal.
 * - rIntent: ball true radius (m) at which the validator checks the 3D-reach
 *   inequality (auto-raised to radiusReal / ABSORB_RATIO).
 */

/* Shelf-mid rect (shelves A/B front face x = 0.1; items inset <= 0.06). */
const SHELF_X = { x0: 0.04, x1: 0.09 };

/** Interior clusters (~232 placements). All heights <= INTERIOR_ITEM_Y_MAX. */
const INTERIOR_CLUSTERS = [
  // --- T0 floor bins (ネジ/抵抗/コンデンサ ... along the aisles) ---
  ['screw', 0.5, -2.0, 10, 0.35, 0.006, 0.010, 0, 0.02, null],
  ['screw', 1.8, -0.6, 9, 0.40, 0.006, 0.010, 0, 0.02, null],
  ['screw', 0.9, 0.3, 8, 0.35, 0.006, 0.010, 0, 0.02, null],
  ['screw', 4.3, 1.6, 8, 0.30, 0.006, 0.010, 0, 0.02, null],
  ['resistor', 2.6, -1.0, 9, 0.40, 0.006, 0.009, 0, 0.02, null],
  ['resistor', 0.4, -3.0, 8, 0.30, 0.006, 0.009, 0, 0.02, null],
  ['resistor', 3.4, -0.2, 8, 0.40, 0.006, 0.009, 0, 0.02, null],
  ['capacitor', 1.3, -1.2, 8, 0.35, 0.007, 0.011, 0, 0.02, null],
  ['capacitor', 1.5, 0.5, 8, 0.35, 0.007, 0.011, 0, 0.02, null],
  ['capacitor', 0.6, -4.2, 7, 0.25, 0.007, 0.011, 0, 0.02, null],
  ['led', 3.0, -2.6, 8, 0.30, 0.006, 0.009, 0, 0.02, null],
  ['led', 1.0, 1.4, 7, 0.30, 0.006, 0.009, 0, 0.02, null],
  ['button_battery', 3.8, -1.4, 7, 0.30, 0.006, 0.010, 0, 0.02, null],
  ['button_battery', 1.2, 2.6, 7, 0.30, 0.006, 0.010, 0, 0.02, null],
  // 消しゴム/クリップ near the counter base.
  ['paperclip', 2.4, -3.0, 8, 0.30, 0.006, 0.010, 0, 0.02, null],
  ['paperclip', 0.5, -0.5, 7, 0.35, 0.006, 0.010, 0, 0.02, null],
  ['eraser', 3.2, -3.0, 7, 0.25, 0.010, 0.012, 0, 0.025, null],
  ['eraser', 1.6, 1.2, 6, 0.25, 0.010, 0.012, 0, 0.025, null],
  ['junk_board', 1.2, -2.4, 5, 0.30, 0.030, 0.050, 0, 0.08, null],
  ['junk_board', 3.9, 0.0, 4, 0.30, 0.030, 0.050, 0, 0.08, null],
  ['soldering_iron', 3.6, -1.8, 3, 0.25, 0.025, 0.035, 0, 0.06, null],
  // --- T0 on P4 low table (y 0.4) — ICチップ/LED/ボタン電池 near the edges ---
  ['ic_chip', 2.05, 1.2, 8, 0.6, 0.007, 0.011, 0.4, 0.30, { x0: 2.02, x1: 2.08, z0: 0.6, z1: 1.8 }],
  ['led', 2.7, 0.45, 7, 0.5, 0.006, 0.009, 0.4, 0.30, { x0: 2.2, x1: 3.2, z0: 0.42, z1: 0.48 }],
  ['button_battery', 3.35, 1.2, 7, 0.6, 0.006, 0.010, 0.4, 0.30, { x0: 3.32, x1: 3.38, z0: 0.6, z1: 1.8 }],
  // --- T1 floor (雑誌たば/丸イス/ダンボール箱/工具箱/スピーカー...) ---
  ['magazine_stack', 4.0, -2.4, 4, 0.30, 0.06, 0.08, 0, 0.13, null],
  ['magazine_stack', 0.6, 1.7, 3, 0.25, 0.06, 0.08, 0, 0.13, null],
  ['cardboard_box', 0.55, -4.3, 3, 0.20, 0.06, 0.08, 0, 0.13, null],
  ['cardboard_box', 4.1, 0.2, 3, 0.25, 0.06, 0.08, 0, 0.13, null],
  ['cardboard_box', 1.0, 2.8, 2, 0.20, 0.06, 0.08, 0, 0.13, null],
  ['round_stool', 1.5, 0.2, 2, 0.15, 0.07, 0.09, 0, 0.15, null],
  ['round_stool', 3.9, 2.7, 2, 0.15, 0.07, 0.09, 0, 0.15, null],
  ['toolbox', 2.9, -1.8, 3, 0.25, 0.06, 0.08, 0, 0.13, null],
  ['speaker', 4.25, -0.8, 3, 0.20, 0.05, 0.07, 0, 0.11, null],
  ['junk_hdd', 2.0, -2.7, 3, 0.25, 0.045, 0.06, 0, 0.10, null],
  ['mouse', 4.3, -3.0, 3, 0.20, 0.045, 0.06, 0, 0.10, null],
  // --- T1 shelf mid-levels (y 0.7 ONLY — honestly late-T1, reach r ~0.4) ---
  ['mouse', 0.065, -2.15, 5, 0.3, 0.050, 0.060, 0.7, 0.40, { ...SHELF_X, z0: -2.4, z1: -1.9 }],
  ['game_soft', 0.065, -3.5, 6, 0.35, 0.045, 0.055, 0.7, 0.40, { ...SHELF_X, z0: -3.8, z1: -3.2 }],
  ['speaker', 0.065, -4.35, 3, 0.3, 0.050, 0.060, 0.7, 0.40, { ...SHELF_X, z0: -4.6, z1: -4.1 }],
  ['junk_hdd', 0.065, 1.4, 4, 0.35, 0.050, 0.065, 0.7, 0.40, { ...SHELF_X, z0: 1.1, z1: 1.7 }],
  ['mouse', 0.065, 2.35, 4, 0.3, 0.050, 0.060, 0.7, 0.40, { ...SHELF_X, z0: 2.1, z1: 2.6 }],
  ['game_soft', 0.065, 2.95, 5, 0.2, 0.045, 0.055, 0.7, 0.40, { ...SHELF_X, z0: 2.8, z1: 3.1 }],
];

/** Akiba street dressing (~71) — 中央通り strip x[4.6,18] z[-180,180]. */
const STREET_CLUSTERS = [
  ['vending_machine', 16.5, -30, 6, 25, 0.50, 0.65, 0, 1.0, null],
  ['vending_machine', 16.5, 40, 6, 30, 0.50, 0.65, 0, 1.0, null],
  ['bicycle', 7, -55, 6, 20, 0.50, 0.60, 0, 0.95, null],
  ['bicycle', 7, 25, 6, 18, 0.50, 0.60, 0, 0.95, null],
  ['signboard', 12, -90, 4, 30, 0.40, 0.55, 0, 0.9, null],
  ['signboard', 12, 70, 4, 30, 0.40, 0.55, 0, 0.9, null],
  ['nobori_banner', 6.5, -20, 4, 12, 0.40, 0.50, 0, 0.8, null],
  ['nobori_banner', 6.5, 60, 4, 15, 0.40, 0.50, 0, 0.8, null],
  // 通行人 crowds thickening near the shop.
  ['person', 8, -12, 6, 8, 0.32, 0.38, 0, 0.6, null],
  ['person', 11, 14, 5, 8, 0.32, 0.38, 0, 0.6, null],
  ['person', 10, -70, 4, 25, 0.32, 0.38, 0, 0.6, null],
  ['cat', 6, 8, 2, 4, 0.12, 0.16, 0, 0.25, null],
  ['cat', 15, -45, 2, 6, 0.12, 0.16, 0, 0.25, null],
  ['pigeon', 9, -6, 4, 5, 0.06, 0.08, 0, 0.13, null],
  ['pigeon', 13, 30, 4, 6, 0.06, 0.08, 0, 0.13, null],
  ['trash_can', 16.5, -15, 2, 8, 0.28, 0.33, 0, 0.55, null],
  ['trash_can', 16.5, 90, 2, 10, 0.28, 0.33, 0, 0.55, null],
  ['utility_pole', 17.2, -120, 4, 60, 3.2, 3.6, 0, 6, null],
  ['yatai_stall', 10, -130, 1, 0, 1.1, 1.3, 0, 2.1, null],
  ['yatai_stall', 12, 110, 1, 0, 1.1, 1.3, 0, 2.1, null],
];

/**
 * EXIT-BRIDGE GUTTER LINE (~22): 空き缶/ペットボトル/チラシたば/軍手 as
 * T0/T1-scale recipes along the east gutter, dense near the shop, thinning
 * with distance — bridges the r 0.10..0.4 shop-exit growth chain (validator
 * prints the table).
 */
const GUTTER_CLUSTERS = [
  ['eraser', 17.2, -8, 3, 5, 0.030, 0.040, 0, 0.07, null],
  ['eraser', 17.2, 18, 2, 6, 0.030, 0.040, 0, 0.07, null],
  ['button_battery', 17.0, -25, 3, 8, 0.025, 0.035, 0, 0.06, null],
  ['game_soft', 17.3, 35, 2, 8, 0.040, 0.050, 0, 0.08, null],
  ['game_soft', 17.3, -45, 2, 8, 0.040, 0.050, 0, 0.08, null],
  ['magazine_stack', 17.0, -60, 2, 10, 0.060, 0.080, 0, 0.13, null],
  ['magazine_stack', 17.0, 55, 2, 10, 0.060, 0.080, 0, 0.13, null],
  ['toolbox', 17.4, -85, 2, 12, 0.050, 0.060, 0, 0.10, null],
  ['cardboard_box', 17.2, 80, 2, 10, 0.060, 0.080, 0, 0.13, null],
  ['eraser', 17.1, -110, 2, 12, 0.030, 0.040, 0, 0.07, null],
];

/** District dressing (~55, incl. the scramble crowd x16). */
const DISTRICT_CLUSTERS = [
  ['street_tree', -150, -380, 4, 60, 2.0, 2.4, 0, 3.8, null], // 上野公園
  ['person', -240, -455, 4, 12, 0.32, 0.38, 0, 0.6, null], // 動物園前
  ['kiosk', -130, -395, 2, 15, 1.6, 1.9, 0, 3.0, null], // 上野みやげ屋
  ['machiya', 320, -560, 3, 30, 2.8, 3.4, 0, 5.3, null], // 浅草
  ['kiosk', 355, -575, 2, 12, 1.6, 1.9, 0, 3.0, null], // 仲見世
  ['torii', 340, -630, 1, 0, 1.5, 1.7, 0, 2.7, null], // 浅草
  ['taxi', -110, 470, 4, 30, 0.95, 1.05, 0, 1.7, null], // 丸の内
  ['car', -90, 440, 4, 35, 0.90, 1.00, 0, 1.6, null],
  ['bus', -140, 500, 2, 25, 1.40, 1.60, 0, 2.5, null],
  // スクランブル交差点 crowd x16 (T2-size 通行人; decal is the landmark).
  ['person', -1163, 975, 16, 16, 0.32, 0.38, 0, 0.6, null],
  ['signboard', -1135, 940, 3, 18, 0.45, 0.55, 0, 0.9, null], // 渋谷
  ['street_tree', -600, 620, 3, 40, 2.0, 2.4, 0, 3.8, null], // 永田町
  ['truck', -520, -100, 3, 35, 1.10, 1.30, 0, 2.1, null], // 水道橋
  ['person', -100, 455, 4, 15, 0.32, 0.38, 0, 0.6, null], // 東京駅前 (寿司屋台まわり)
];

/* ------------------------------------------------------------------ */
/* Expansion (module load, seed-INDEPENDENT mulberry32(0x544f4b59))    */
/* ------------------------------------------------------------------ */

/** @param {number} x @param {number} z @returns {boolean} Inside any prism footprint. */
function pointInPrism(x, z) {
  const ps = SHOP.prisms;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return true;
  }
  return false;
}

/** Interior floor margin (clear of wall thickness). */
const IN_MARGIN = 0.07;

/**
 * Expand one cluster table into CuratedPlacement records.
 * @param {() => number} rng Shared mulberry32 stream (single authoring order).
 * @param {Array} clusters Cluster rows (see format above).
 * @param {boolean} interior True for shop-interior rows (validity rejection).
 * @param {CuratedPlacement[]} out
 */
function expandClusters(rng, clusters, interior, out) {
  for (let ci = 0; ci < clusters.length; ci++) {
    const [id, cx, cz, n, spread, rMin, rMax, ySurf, rIntent, rect] = clusters[ci];
    const code = C[id];
    for (let k = 0; k < n; k++) {
      let x = cx;
      let z = cz;
      if (rect !== null) {
        // Hard clamp region (shelf/table tops): sample uniformly inside it.
        x = rect.x0 + rng() * (rect.x1 - rect.x0);
        z = rect.z0 + rng() * (rect.z1 - rect.z0);
      } else {
        for (let attempt = 0; attempt < 24; attempt++) {
          x = cx + (rng() * 2 - 1) * spread;
          z = cz + (rng() * 2 - 1) * spread;
          if (!interior) break; // outdoor: no spatial constraint
          const sh = SHOP.interior;
          if (x < sh.x0 + IN_MARGIN || x > sh.x1 - IN_MARGIN) continue;
          if (z < sh.z0 + IN_MARGIN || z > sh.z1 - IN_MARGIN) continue;
          if (pointInPrism(x, z)) continue;
          break;
        }
      }
      const r = rMin + rng() * (rMax - rMin);
      const yaw = rng() * Math.PI * 2;
      out.push({
        archetypeCode: code,
        x, y: ySurf, z,
        radiusReal: r,
        yaw,
        naturalBand: (code / 10) | 0,
        landmarkId: -1,
        collectibleId: -1,
        interior,
        interiorElevated: interior && ySurf > 0,
        releaseGated: false,
        yK: 1,
        colorHex: -1,
        rIntent,
      });
    }
  }
}

/**
 * THE flat curated placement list (world/curated.js slot source).
 * @type {CuratedPlacement[]}
 */
export const PLACEMENTS = [];
{
  const rng = mulberry32(0x544f4b59); // 'TOKY' — seed-independent authoring stream
  expandClusters(rng, INTERIOR_CLUSTERS, true, PLACEMENTS);
  expandClusters(rng, STREET_CLUSTERS, false, PLACEMENTS);
  expandClusters(rng, GUTTER_CLUSTERS, false, PLACEMENTS);
  expandClusters(rng, DISTRICT_CLUSTERS, false, PLACEMENTS);

  // 12 collectibles (FLAG_RARE|FLAG_CURATED in curated.js; gold tint).
  for (const cdef of COLLECTIBLES) {
    PLACEMENTS.push({
      archetypeCode: cdef.archetypeCode,
      x: cdef.x, y: cdef.y, z: cdef.z,
      radiusReal: cdef.radiusReal,
      yaw: 0,
      naturalBand: cdef.naturalBand,
      landmarkId: cdef.landmarkId,
      collectibleId: cdef.id,
      interior: cdef.id <= 3,
      interiorElevated: cdef.id <= 3 && cdef.y > 0,
      releaseGated: false,
      yK: 1,
      colorHex: GOLD,
      rIntent: cdef.rIntent,
    });
  }

  // 11 landmark singletons (ハチ公 id 0 came from COLLECTIBLES above;
  // レインボーブリッジ id 9 emits 3 span placements).
  for (const ld of LANDMARKS) {
    if (ld.landmarkId === 0) continue; // dual-tagged via collectible id 10
    if (ld.landmarkId === 9) {
      for (const sp of BRIDGE_SPANS) {
        PLACEMENTS.push({
          archetypeCode: ld.archetypeCode,
          x: sp.x, y: 0, z: sp.z,
          radiusReal: ld.dioramaR,
          yaw: 0,
          naturalBand: ld.naturalBand,
          landmarkId: ld.landmarkId,
          collectibleId: -1,
          interior: false, interiorElevated: false, releaseGated: false,
          yK: 0.35, // low deck profile
          colorHex: ld.colorHex,
          rIntent: ld.dioramaR / ABSORB_RATIO,
        });
      }
      continue;
    }
    PLACEMENTS.push({
      archetypeCode: ld.archetypeCode,
      x: ld.x, y: 0, z: ld.z,
      radiusReal: ld.dioramaR,
      yaw: 0,
      naturalBand: ld.naturalBand,
      landmarkId: ld.landmarkId,
      collectibleId: -1,
      interior: false, interiorElevated: false, releaseGated: false,
      yK: ld.landmarkId === 5 ? 0.05 : 1, // scramble decal lies flat
      colorHex: ld.colorHex,
      rIntent: ld.dioramaR / ABSORB_RATIO,
    });
  }

  // Shop shell 「アキバパーツ館」 — activates only after the terrain release
  // (trueRadius >= SHOP_TERRAIN_RELEASE_M); absorbable @ 4.0/0.65 ~ 6.2m.
  PLACEMENTS.push({
    archetypeCode: CODE_SHOP_SHELL,
    x: SHOP.center.x, y: 0, z: SHOP.center.z,
    radiusReal: 4.0,
    yaw: 0,
    naturalBand: 3,
    landmarkId: -1,
    collectibleId: -1,
    interior: false, interiorElevated: false,
    releaseGated: true,
    yK: 1,
    colorHex: 0xc9b9a0,
    rIntent: 6.2,
  });
}

/* ================================================================== */
/* validateCityMap()                                                   */
/* ================================================================== */

/**
 * Validate every authored-data invariant from docs/DESIGN-V3.md §箱庭東京マップ.
 * Throws on violation; prints the aisle table, the street growth-chain table,
 * the landmark threshold ladder and the interior growth budget. DEV builds
 * run it at module load; headless tests call it directly.
 * @returns {true}
 */
export function validateCityMap() {
  /** @param {boolean} cond @param {string} msg */
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`[cityMap invariant] ${msg}`);
  };
  const log = (...a) => console.log('[cityMap]', ...a);

  /* ---- counts ---- */
  assert(PLACEMENTS.length <= CURATED_PLACEMENT_CAP,
    `PLACEMENTS ${PLACEMENTS.length} exceeds CURATED_PLACEMENT_CAP ${CURATED_PLACEMENT_CAP}`);
  for (const p of PLACEMENTS) {
    assert(Number.isInteger(p.archetypeCode) && p.archetypeCode >= 0 && p.archetypeCode <= 92,
      `placement archetypeCode out of range: ${p.archetypeCode}`);
    assert(p.radiusReal > 0, 'placement radiusReal must be > 0');
    assert(p.naturalBand >= 0 && p.naturalBand <= 6, 'naturalBand out of range');
    assert(
      p.x >= MAP_BOUNDS.x[0] && p.x <= MAP_BOUNDS.x[1] &&
      p.z >= MAP_BOUNDS.z[0] && p.z <= MAP_BOUNDS.z[1],
      `placement outside MAP_BOUNDS at (${p.x}, ${p.z})`
    );
  }

  /* ---- collectible ids: unique, < 31, code = 70 + id ---- */
  {
    const ids = Object.values(COLLECTIBLE_IDS);
    const seen = new Set();
    for (const id of ids) {
      assert(Number.isInteger(id) && id >= 0 && id < 31, `collectible id ${id} must be an int < 31 (LS mask)`);
      assert(!seen.has(id), `duplicate collectible id ${id}`);
      seen.add(id);
    }
    assert(COLLECTIBLES.length === 12, 'exactly 12 collectible defs in v3');
    for (const cd of COLLECTIBLES) {
      assert(seen.has(cd.id), `collectible def id ${cd.id} missing from COLLECTIBLE_IDS`);
      assert(cd.archetypeCode === EXTRA_CODE_BASE + cd.id, `collectible ${cd.id}: code must be 70 + id`);
    }
  }

  /* ---- landmark ladder (absorb threshold = dioramaR / ABSORB_RATIO) ---- */
  {
    let prev = 0;
    const rows = [];
    for (const ld of LANDMARKS) {
      const at = ld.dioramaR / ABSORB_RATIO;
      rows.push(`  L${ld.landmarkId} ${ld.nameJa}: dioramaR ${ld.dioramaR}m -> absorbable @ ${at.toFixed(1)}m`);
      // スクランブル交差点 (id 5) is OFF the ladder by spec — its 'absorbable'
      // entry is the T2-size crowd, the flat decal is incidental.
      if (ld.landmarkId !== 5) {
        assert(at > prev, `landmark ladder must be strictly increasing at ${ld.nameJa}`);
        prev = at;
      }
      assert(ld.collisionScale > 0 && ld.collisionScale <= 1, `landmark ${ld.nameJa}: collisionScale`);
    }
    log('landmark threshold ladder:\n' + rows.join('\n'));
  }

  /* ---- finale always wins over the base collider ---- */
  assert(SKYTREE_COLLIDER_K < GOAL_CONTACT_PAD,
    `SKYTREE_COLLIDER_K ${SKYTREE_COLLIDER_K} must be < GOAL_CONTACT_PAD ${GOAL_CONTACT_PAD}`);
  assert(
    SKYTREE_POS.x >= MAP_BOUNDS.x[0] && SKYTREE_POS.x <= MAP_BOUNDS.x[1] &&
    SKYTREE_POS.z >= MAP_BOUNDS.z[0] && SKYTREE_POS.z <= MAP_BOUNDS.z[1],
    'SKYTREE_POS inside MAP_BOUNDS'
  );

  /* ---- zones inside bounds; shop interior masked 0 ---- */
  for (const zn of ZONES) {
    assert(zn.x0 < zn.x1 && zn.z0 < zn.z1, 'zone rect degenerate');
    assert(
      zn.x0 >= MAP_BOUNDS.x[0] && zn.x1 <= MAP_BOUNDS.x[1] &&
      zn.z0 >= MAP_BOUNDS.z[0] && zn.z1 <= MAP_BOUNDS.z[1],
      'zone rect outside MAP_BOUNDS'
    );
  }
  for (let b = 0; b <= 6; b++) {
    assert(!bandAllowedAt(SHOP.center.x, SHOP.center.z, b), 'shop interior must be mask 0');
    assert(!bandAllowedAt(MAP_BOUNDS.x[1] + 1, 0, b), 'outside bounds must be mask 0');
  }
  assert(!bandAllowedAt(500, 0, 0) && !bandAllowedAt(500, 0, 1),
    'bands 0/1 are curated-only (allowed nowhere)');
  assert(bandAllowedAt(100, 100, 2), 'akiba blocks must allow band 2');
  assert(bandAllowedAt(1500, 0, 6), 'T6 must be allowed map-wide (general fill)');

  /* ---- shop geometry: aisles, ball start, exit lane ---- */
  const sh = SHOP.interior;
  const ps = SHOP.prisms;
  {
    // Aisle table: the 5 spec pairs (binding, min 1.1 m).
    const aisles = [
      ['central band P1<->P2 (z)', ps[1].z0 - ps[0].z1], // 0.8 - (-1.6) = 2.4
      ['P1 <-> P3 (x)', ps[2].x0 - ps[0].x1], // 1.2 - 0.1 = 1.1
      ['P2 <-> P4 (x)', ps[3].x0 - ps[1].x1], // 2.0 - 0.1 = 1.9
      ['P4 <-> E wall (x)', sh.x1 - ps[3].x1], // 4.6 - 3.4 = 1.2
      ['P4 <-> S wall (z)', sh.z1 - ps[3].z1], // 3.2 - 2.0 = 1.2
    ];
    const rows = [];
    for (const [name, gap] of aisles) {
      rows.push(`  ${name}: ${gap.toFixed(2)}m`);
      assert(gap >= 1.1 - 1e-9, `aisle '${name}' must be >= 1.1m (got ${gap})`);
    }
    // Documented dead-end pocket P3 <-> E wall (0.7 m, open to the corridor at
    // z > -3.4 — no seal/stranding possible on a flat floor, ball just backs out).
    rows.push(`  (pocket P3 <-> E wall: ${(sh.x1 - ps[2].x1).toFixed(2)}m — open, documented)`);
    log('aisle table:\n' + rows.join('\n'));

    // Ball start (0,0): inside interior, outside every prism, clear of walls.
    assert(!pointInPrism(0, 0), 'ball start must not be inside a prism footprint');
    let minD = Infinity;
    for (const p of ps) {
      const dx = Math.max(p.x0 - 0, 0, 0 - p.x1);
      const dz = Math.max(p.z0 - 0, 0, 0 - p.z1);
      minD = Math.min(minD, Math.hypot(dx, dz));
    }
    assert(minD >= 0.3, `ball-start prism clearance >= 0.3m (got ${minD.toFixed(2)})`);

    // Exit lane: straight +X corridor |z| <= 0.35 from origin through the gate
    // — must intersect no prism, and the gate must span z = 0.
    for (const p of ps) {
      const hit = p.x0 <= 5.6 && p.x1 >= 0 && p.z0 <= 0.35 && p.z1 >= -0.35;
      assert(!hit, 'exit lane (+X, |z|<=0.35) blocked by a prism');
    }
    assert(SHOP.openFront.z0 < -0.35 && SHOP.openFront.z1 > 0.35, 'open front must span the exit lane');
  }

  /* ---- interior placements: rect, prism footprints, height cap, reach ---- */
  let sigmaR3 = 0;
  let interiorCount = 0;
  const reachK = 1 + PICKUP_FORGIVE_K; // 1.45 — forgiven 3D absorb reach
  for (const p of PLACEMENTS) {
    if (!p.interior) continue;
    interiorCount++;
    sigmaR3 += p.radiusReal ** 3;
    assert(p.y <= INTERIOR_ITEM_Y_MAX + 1e-9, `interior item height ${p.y} > INTERIOR_ITEM_Y_MAX`);
    assert(
      p.x >= sh.x0 && p.x <= sh.x1 && p.z >= sh.z0 && p.z <= sh.z1,
      `interior placement outside the interior rect at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`
    );
    // Footprint rule: floor items must not sit inside a prism; elevated items
    // MUST sit on the prism whose top is their surface height.
    let onPrism = null;
    for (const pr of ps) {
      if (p.x >= pr.x0 && p.x <= pr.x1 && p.z >= pr.z0 && p.z <= pr.z1) onPrism = pr;
    }
    if (p.y === 0) {
      assert(onPrism === null, `floor placement inside a prism footprint at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
    } else {
      assert(onPrism !== null && p.y <= onPrism.h + 1e-9,
        `elevated placement (y=${p.y}) must rest on a prism of sufficient height`);
    }
    // 3D-reach inequality at the intended tier radius:
    //   sqrt(dXZ^2 + (yCenter - r)^2) <= (1 + PICKUP_FORGIVE_K) * r + objR
    // with dXZ = inset-from-nearest-open-face + r (dXZ >= r).
    const objR = p.radiusReal;
    const r = Math.max(p.rIntent || 0, objR / ABSORB_RATIO);
    let inset = 0;
    if (onPrism !== null) {
      inset = Math.min(
        p.x - onPrism.x0, onPrism.x1 - p.x,
        p.z - onPrism.z0, onPrism.z1 - p.z
      );
    }
    const dXZ = inset + r;
    const yCenter = p.y + objR;
    const lhs = Math.hypot(dXZ, yCenter - r);
    const rhs = reachK * r + objR;
    assert(lhs <= rhs + 1e-9,
      `3D-reach fails at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) y=${p.y} objR=${objR.toFixed(3)} ` +
      `rIntent=${r.toFixed(2)}: ${lhs.toFixed(3)} > ${rhs.toFixed(3)}`);
  }

  /* ---- growth budget + NO-SEAL ---- */
  {
    const fullClear = Math.cbrt(START_RADIUS_M ** 3 + GROWTH_K * sigmaR3);
    const gate = SHOP.openFront.gateRadiusM;
    log(`interior placements: ${interiorCount}, SigmaR^3 = ${sigmaR3.toFixed(4)} m^3, ` +
      `full-clear radius = ${fullClear.toFixed(3)} m (gate r ${gate} m)`);
    assert(fullClear < 0.5 * gate,
      `NO-SEAL: full-clear ${fullClear.toFixed(3)} must be < 0.5 * gate ${0.5 * gate}`);
    assert(fullClear >= 0.28, `growth budget: full-clear ${fullClear.toFixed(3)} must support r ~0.30m`);
    assert(fullClear <= 0.58, `growth budget: full-clear ${fullClear.toFixed(3)} should stay <= ~0.55m`);
  }

  /* ---- street growth chain (exit radii -> absorbable supply <= 150 m) ---- */
  {
    const rows = [];
    for (const r of [0.10, 0.15, 0.25, 0.4]) {
      let count = 0;
      for (const p of PLACEMENTS) {
        if (p.interior) continue;
        if (p.radiusReal > ABSORB_RATIO * r) continue;
        if (Math.hypot(p.x, p.z) > 150) continue;
        count++;
      }
      rows.push(`  exit r=${r}m: ${count} absorbables (objR <= ${(ABSORB_RATIO * r).toFixed(3)}m) within 150m`);
      assert(count >= 8, `growth chain: need >= 8 absorbables within 150m for exit r=${r} (got ${count})`);
    }
    log('street growth-chain table:\n' + rows.join('\n'));
  }

  /* ---- landmark/collectible placements present exactly once ---- */
  {
    const lmCount = new Array(11).fill(0);
    const colCount = new Array(12).fill(0);
    let shell = 0;
    for (const p of PLACEMENTS) {
      if (p.landmarkId >= 0) lmCount[p.landmarkId]++;
      if (p.collectibleId >= 0) colCount[p.collectibleId]++;
      if (p.archetypeCode === CODE_SHOP_SHELL) shell++;
    }
    for (let i = 0; i < 11; i++) {
      const want = i === 9 ? 3 : 1; // bridge = 3 spans
      assert(lmCount[i] === want, `landmark ${i} placement count ${lmCount[i]} != ${want}`);
    }
    for (let i = 0; i < 12; i++) assert(colCount[i] === 1, `collectible ${i} placement count != 1`);
    assert(shell === 1, 'exactly one shop-shell placement');
  }

  log(`OK — ${PLACEMENTS.length} curated placements (cap ${CURATED_PLACEMENT_CAP})`);
  return true;
}

/* DEV builds validate at module load (stripped from prod by the guard). */
if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  validateCityMap();
}
