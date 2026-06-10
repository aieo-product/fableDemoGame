/**
 * @file tiers.js — The 6-tier scale table + RESCALE_S + dev-mode invariant asserts.
 *
 * tierIndex drives ONLY: spawner content bands, fog/sky palette crossfade,
 * HUD label/unit, and the celebration. Absorbability, camera, fog distances,
 * speed and despawn are continuous functions of ball radius (tuning.js) and
 * NEVER reference tierIndex. See DESIGN.md SEAMLESSNESS LAW.
 *
 * archetypeIds are FROZEN here — config/catalog.js (Dev E) must implement
 * exactly these 48 ids with matching spelling.
 */

import {
  FOG_FAR_K,
  SIM_RADIUS_MIN,
  SIM_RADIUS_MAX,
  START_RADIUS_M,
} from './tuning.js';

/** @typedef {import('../types.js').Tier} Tier */

/**
 * One-frame similarity rescale factor applied when simRadius >= SIM_RADIUS_MAX:
 * worldScale /= S; every sim quantity *= S. 1/S === SIM_RADIUS_MAX/SIM_RADIUS_MIN === 5,
 * so the ball lands exactly back at SIM_RADIUS_MIN (asserted below).
 */
export const RESCALE_S = 0.2;

/**
 * The tier table. True ball radius ~x5 per tier:
 * T0 Desk 5cm-25cm, T1 Room 25cm-1.25m, T2 Street 1.25m-6m,
 * T3 Town 6m-30m, T4 City 30m-150m, T5 Skyline 150m-750m (win banner at 500m).
 *
 * cellSizeSim / loadRadiusSim / objectsPerChunk are expressed in the tier's
 * NATIVE sim scale (i.e. the values the spawner uses when that tier is the
 * current target band N). The N+1 scenery band overrides come from tuning.js
 * (SCENERY_LOAD_RADIUS_SIM / SCENERY_OBJECTS_PER_CHUNK).
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
    archetypeIds: ['thumbtack', 'coin', 'die', 'eraser', 'paperclip', 'candy', 'battery', 'key'],
    fogColor: 0xe7d9bf, // warm lamplight haze
    skyTop: 0xf0ddb4,
    skyBottom: 0xfff3dd,
  },
  {
    index: 1,
    name: 'Room',
    enterTrueRadius: 0.25,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: ['book', 'mug', 'shoe', 'plushie', 'lamp', 'cat', 'stool', 'trash_can'],
    fogColor: 0xdde4ec, // soft indoor daylight
    skyTop: 0xbcd6ee,
    skyBottom: 0xf0f6ff,
  },
  {
    index: 2,
    name: 'Street',
    enterTrueRadius: 1.25,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: ['bicycle', 'person', 'bench', 'mailbox', 'sign', 'dog', 'cart', 'hydrant'],
    fogColor: 0xcfe6f5, // fresh morning
    skyTop: 0x6fb7e8,
    skyBottom: 0xdff1fb,
  },
  {
    index: 3,
    name: 'Town',
    enterTrueRadius: 6,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: ['car', 'truck', 'tree', 'kiosk', 'house', 'bus', 'fountain', 'shed'],
    fogColor: 0xc4e3e8, // clear noon
    skyTop: 0x4fa3d8,
    skyBottom: 0xcfeef7,
  },
  {
    index: 4,
    name: 'City',
    enterTrueRadius: 30,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: ['apartment', 'crane', 'billboard', 'water_tower', 'smokestack', 'warehouse', 'overpass', 'gas_tank'],
    fogColor: 0xf2cfa3, // golden hour
    skyTop: 0xffb46b,
    skyBottom: 0xffe3b0,
  },
  {
    index: 5,
    name: 'Skyline',
    enterTrueRadius: 150,
    cellSizeSim: 32,
    loadRadiusSim: 96,
    objectsPerChunk: 72,
    archetypeIds: ['skyscraper', 'stadium', 'ferris_wheel', 'hill', 'bridge_span', 'radio_tower', 'dome', 'cruise_ship'],
    fogColor: 0x8a7bb5, // violet dusk
    skyTop: 0x2d2a5e,
    skyBottom: 0xb88bd6,
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

  assert(TIERS.length === 6, 'exactly 6 tiers');
  assert(
    Math.abs(1 / RESCALE_S - SIM_RADIUS_MAX / SIM_RADIUS_MIN) < 1e-9,
    '1/RESCALE_S must equal SIM_RADIUS_MAX/SIM_RADIUS_MIN (ball lands back at band min)'
  );
  assert(TIERS[0].enterTrueRadius === START_RADIUS_M, 'T0 enterTrueRadius must equal START_RADIUS_M');

  const seen = new Set();
  for (let t = 0; t < TIERS.length; t++) {
    const tier = TIERS[t];
    assert(tier.index === t, `tier ${t}: index field mismatch`);
    assert(tier.archetypeIds.length === 8, `tier ${t}: exactly 8 archetypeIds`);
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
  }
  assert(seen.size === 48, 'exactly 48 unique archetype ids across the catalog');
}
