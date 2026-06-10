/**
 * @file tiers.js — The 6-tier scale table + RESCALE_S + dev-mode invariant asserts.
 *
 * tierIndex drives ONLY: spawner content bands, fog/sky palette crossfade
 * (v2: incl. sun/moon/stars/clouds sky params), HUD label/unit, and the
 * celebration. Absorbability, camera, fog distances, speed and despawn are
 * continuous functions of ball radius (tuning.js) and NEVER reference
 * tierIndex. See DESIGN.md SEAMLESSNESS LAW.
 *
 * archetypeIds are FROZEN here — config/catalog.js must implement exactly
 * these 60 ids (ARCH_PER_TIER 10 x 6 tiers) with matching spelling.
 * v2: slots [8] and [9] of every tier are LANDMARKS (radiusNominal ~2.5-4x
 * the tier's largest absorbable; archRoll-eligible ONLY at placement j === 0
 * of a chunk — the spawner's landmark eligibility rule, DESIGN-V2.md 景観).
 *
 * v2 sky params (sunDir/sunIntensity/moonDir/moonAngSize/starIntensity/
 * cloudDensity/cloudHex) ride the EXISTING environment palette crossfade.
 * The NIGHT palette (finale ascension) is env-LOCAL (index 6 inside
 * environment.js) — this table keeps exactly 6 tiers and its asserts.
 */

import {
  FOG_FAR_K,
  SIM_RADIUS_MIN,
  SIM_RADIUS_MAX,
  START_RADIUS_M,
  MOON_DIR_MIN_ELEV,
} from './tuning.js';

/** @typedef {import('../types.js').Tier} Tier */

/**
 * One-frame similarity rescale factor applied when simRadius >= SIM_RADIUS_MAX:
 * worldScale /= S; every sim quantity *= S. 1/S === SIM_RADIUS_MAX/SIM_RADIUS_MIN === 5,
 * so the ball lands exactly back at SIM_RADIUS_MIN (asserted below).
 */
export const RESCALE_S = 0.2;

/**
 * Archetype stride: ids per tier (v2: 8 -> 10; slots 8/9 = landmarks).
 * Archetype code = tier * ARCH_PER_TIER + slotInTier, 0..59. EVERY module
 * that maps codes <-> (tier, slot) must use this constant — never literal 8.
 */
export const ARCH_PER_TIER = 10;

/**
 * The tier table. True ball radius ~x5 per tier:
 * T0 Desk 5cm-25cm, T1 Room 25cm-1.25m, T2 Street 1.25m-6m,
 * T3 Town 6m-30m, T4 City 30m-150m, T5 Skyline 150m-750m
 * (v2 goal: moon descent at MOON_GOAL_RADIUS_M 500m).
 *
 * cellSizeSim / loadRadiusSim / objectsPerChunk are expressed in the tier's
 * NATIVE sim scale (i.e. the values the spawner uses when that tier is the
 * current target band N). The N+1 scenery band overrides come from tuning.js
 * (SCENERY_LOAD_RADIUS_SIM / SCENERY_OBJECTS_PER_CHUNK).
 *
 * moonAngSize is the sky-moon angular RADIUS (rad) — grows per tier so the
 * moon visibly approaches: [0.018, 0.022, 0.028, 0.035, 0.046, 0.062].
 * moonDir POST-normalization elevation must stay >= MOON_DIR_MIN_ELEV
 * (asserted, incl. the crossfade-endpoint guarantee — adjacent dirs sit in
 * the same sky quadrant so the palette lerp can never dip below the floor).
 *
 * @type {Tier[]}
 */
export const TIERS = [
  {
    index: 0,
    name: 'Desk',
    enterTrueRadius: 0.05,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: [
      'thumbtack', 'coin', 'die', 'eraser', 'paperclip', 'candy', 'battery', 'key',
      'soda_bottle', 'desk_globe', // landmarks
    ],
    fogColor: 0xe7d9bf, // warm lamplight haze
    skyTop: 0xf0ddb4,
    skyBottom: 0xfff3dd,
    sunDir: [0.50, 0.62, 0.30],
    sunIntensity: 0.5, // soft lamp-glow disc
    moonDir: [-0.45, 0.40, -0.80],
    moonAngSize: 0.018,
    starIntensity: 0,
    cloudDensity: 0.10,
    cloudHex: 0xfff1d8,
  },
  {
    index: 1,
    name: 'Room',
    enterTrueRadius: 0.25,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: [
      'book', 'mug', 'shoe', 'plushie', 'lamp', 'cat', 'stool', 'trash_can',
      'bookshelf', 'grandfather_clock', // landmarks
    ],
    fogColor: 0xdde4ec, // soft indoor daylight
    skyTop: 0xbcd6ee,
    skyBottom: 0xf0f6ff,
    sunDir: [0.45, 0.60, 0.34],
    sunIntensity: 0.65,
    moonDir: [-0.42, 0.42, -0.81],
    moonAngSize: 0.022,
    starIntensity: 0,
    cloudDensity: 0.18,
    cloudHex: 0xf6fbff,
  },
  {
    index: 2,
    name: 'Street',
    enterTrueRadius: 1.25,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: [
      'bicycle', 'person', 'bench', 'mailbox', 'sign', 'dog', 'cart', 'hydrant',
      'utility_pole', 'torii', // landmarks
    ],
    fogColor: 0xcfe6f5, // fresh morning
    skyTop: 0x6fb7e8,
    skyBottom: 0xdff1fb,
    sunDir: [0.38, 0.68, 0.26],
    sunIntensity: 0.9,
    moonDir: [-0.38, 0.45, -0.81],
    moonAngSize: 0.028,
    starIntensity: 0,
    cloudDensity: 0.45, // puffy
    cloudHex: 0xffffff,
  },
  {
    index: 3,
    name: 'Town',
    enterTrueRadius: 6,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: [
      'car', 'truck', 'tree', 'kiosk', 'house', 'bus', 'fountain', 'shed',
      'pylon', 'giant_tree', // landmarks
    ],
    fogColor: 0xc4e3e8, // clear noon
    skyTop: 0x4fa3d8,
    skyBottom: 0xcfeef7,
    sunDir: [0.12, 0.88, 0.20],
    sunIntensity: 1.0, // high noon
    moonDir: [-0.34, 0.48, -0.81],
    moonAngSize: 0.035,
    starIntensity: 0,
    cloudDensity: 0.50, // puffy
    cloudHex: 0xfdfdf6,
  },
  {
    index: 4,
    name: 'City',
    enterTrueRadius: 30,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: [
      'apartment', 'crane', 'billboard', 'water_tower', 'smokestack', 'warehouse', 'overpass', 'gas_tank',
      'castle', 'pagoda', // landmarks
    ],
    fogColor: 0xf2cfa3, // golden hour
    skyTop: 0xffb46b,
    skyBottom: 0xffe3b0,
    sunDir: [-0.60, 0.18, 0.45],
    sunIntensity: 1.2, // golden-hour low fat sun
    moonDir: [-0.30, 0.52, -0.80],
    moonAngSize: 0.046,
    starIntensity: 0.15,
    cloudDensity: 0.38, // amber streaks
    cloudHex: 0xffc98a,
  },
  {
    index: 5,
    name: 'Skyline',
    enterTrueRadius: 150,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: [
      'skyscraper', 'stadium', 'ferris_wheel', 'hill', 'bridge_span', 'radio_tower', 'dome', 'cruise_ship',
      'mountain', 'skytree', // landmarks
    ],
    fogColor: 0x8a7bb5, // violet dusk
    skyTop: 0x2d2a5e,
    skyBottom: 0xb88bd6,
    sunDir: [-0.70, 0.10, 0.40],
    sunIntensity: 0.35, // dusk — dimmed
    moonDir: [-0.26, 0.56, -0.79],
    moonAngSize: 0.062,
    starIntensity: 0.5,
    cloudDensity: 0, // clear dusk
    cloudHex: 0x8a7bb5,
  },
];

/* ================================================================== */
/* Dev-mode invariant asserts (stripped from prod by the DEV guard)    */
/* ================================================================== */

if (import.meta.env && import.meta.env.DEV) {
  /** @param {boolean} cond @param {string} msg */
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`[tiers.js invariant] ${msg}`);
  };

  assert(TIERS.length === 6, 'exactly 6 tiers (NIGHT palette is env-local, never here)');
  assert(ARCH_PER_TIER === 10, 'ARCH_PER_TIER is frozen at 10 (v2 stride)');
  assert(
    Math.abs(1 / RESCALE_S - SIM_RADIUS_MAX / SIM_RADIUS_MIN) < 1e-9,
    '1/RESCALE_S must equal SIM_RADIUS_MAX/SIM_RADIUS_MIN (ball lands back at band min)'
  );
  assert(TIERS[0].enterTrueRadius === START_RADIUS_M, 'T0 enterTrueRadius must equal START_RADIUS_M');

  const seen = new Set();
  for (let t = 0; t < TIERS.length; t++) {
    const tier = TIERS[t];
    assert(tier.index === t, `tier ${t}: index field mismatch`);
    assert(
      tier.archetypeIds.length === ARCH_PER_TIER,
      `tier ${t}: exactly ${ARCH_PER_TIER} archetypeIds (slots 8/9 = landmarks)`
    );
    for (const id of tier.archetypeIds) {
      assert(!seen.has(id), `duplicate archetype id '${id}'`);
      seen.add(id);
    }
    if (t > 0) {
      assert(
        tier.enterTrueRadius > TIERS[t - 1].enterTrueRadius,
        `tier ${t}: enterTrueRadius must be strictly increasing`
      );
    }
    // Fog wall must hide the spawn-in edge: fog far (at reference simRadius 1)
    // must sit inside loadRadius minus one chunk so objects materialize beyond fog.
    assert(
      FOG_FAR_K < tier.loadRadiusSim - tier.cellSizeSim,
      `tier ${t}: FOG_FAR_K (${FOG_FAR_K}) must be < loadRadiusSim - cellSizeSim (${tier.loadRadiusSim - tier.cellSizeSim})`
    );
    // v2 sky params.
    assert(
      Array.isArray(tier.sunDir) && tier.sunDir.length === 3 &&
      Array.isArray(tier.moonDir) && tier.moonDir.length === 3,
      `tier ${t}: sunDir/moonDir must be [x,y,z]`
    );
    const m = tier.moonDir;
    const len = Math.hypot(m[0], m[1], m[2]);
    assert(len > 1e-6, `tier ${t}: moonDir must be non-zero`);
    assert(
      Math.asin(m[1] / len) >= MOON_DIR_MIN_ELEV,
      `tier ${t}: moonDir post-normalization elevation must be >= MOON_DIR_MIN_ELEV (${MOON_DIR_MIN_ELEV} rad)`
    );
    assert(
      tier.moonAngSize > 0 && tier.moonAngSize < 0.2,
      `tier ${t}: moonAngSize must be a sane angular radius in radians`
    );
    assert(
      tier.starIntensity >= 0 && tier.starIntensity <= 1 &&
      tier.cloudDensity >= 0 && tier.cloudDensity <= 1 &&
      tier.sunIntensity >= 0,
      `tier ${t}: sky scalars out of range`
    );
  }
  assert(seen.size === 60, 'exactly 60 unique archetype ids across the catalog (10 x 6)');
  // moonAngSize strictly increasing — the moon must visibly approach per tier.
  for (let t = 1; t < TIERS.length; t++) {
    assert(
      TIERS[t].moonAngSize > TIERS[t - 1].moonAngSize,
      `tier ${t}: moonAngSize must be strictly increasing`
    );
  }
}
