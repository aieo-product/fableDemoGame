/**
 * @file objects.js — ObjectStore: SoA typed arrays, capacity 8192.
 *
 * The single source of truth for every world object (targets, scenery,
 * leftovers). Structure-of-Arrays layout so the rescale loop and the
 * sub-pixel sweep are tight, branch-light, cache-friendly passes.
 *
 * Flags byte (bitwise OR-able):
 *   FLAG_ALIVE  (1) — slot is allocated and the object exists in the world.
 *   FLAG_FADING (2) — despawn/sub-pixel scale-fade in progress (still alive).
 *   FLAG_TOMB   (4) — pending reclaim; ignored by collision/queries.
 *   FLAG_RARE   (8) — v2: deterministic rare promotion (golden tint, score
 *                 bonus). Set ONLY by the spawner at placement time; absorb.js
 *                 stamps AbsorbEvent.rare from it BEFORE store.free.
 *   FLAG_CURATED (16) — v3: slot owned by world/curated.js (CuratedSpawner).
 *                 The chunk spawner's _onAbsorb / _subPixelSweep /
 *                 _despawnIndex / leftover cleanup ALL skip flagged slots and
 *                 its _aliveCount counts only chunk-owned objects. Curated
 *                 collectibles additionally carry FLAG_RARE (gold tint).
 *
 * Archetype encoding: store.archetype holds a uint16 CODE
 *   code = tierIndex * ARCH_PER_TIER + indexWithinTier   (0..69, v3 stride 10)
 * derived from the FROZEN Tier.archetypeIds lists in config/tiers.js
 * (slots [8]/[9] of every tier are chunk landmarks), PLUS the 24 EXTRA
 * curated codes 70..93 (frozen by docs/DESIGN-V3.md Phase-0 appendix:
 * 70..81 collectibles where code = 70 + COLLECTIBLE_ID, 82..91 landmark
 * singletons, 92 shop shell, 93 Skytree display-name reservation — code 93
 * must NEVER be spawned into the store).
 * Use archetypeCode() / ARCHETYPE_ID_BY_CODE / ARCHETYPE_CODE_BY_ID below —
 * spawner/curated write codes, absorb/hud read ids/names back.
 *
 * tierOf is CURATED-MUTABLE (docs/DESIGN-V3.md dynamic re-banding): the chunk
 * spawner stamps it once at spawn; CuratedSpawner re-stamps its OWN flagged
 * slots to clamp(naturalBand, tierIndex-1, tierIndex+1) on activation and on
 * every TIER_UP. Writes are partitioned by FLAG_CURATED — never cache tierOf
 * across frames.
 */

import { STORE_CAPACITY } from '../config/tuning.js';
import { TIERS, ARCH_PER_TIER } from '../config/tiers.js';
import { FreeList } from '../core/pool.js';

/* ================================================================== */
/* Flags                                                               */
/* ================================================================== */

/** Slot is allocated and the object exists in the world. */
export const FLAG_ALIVE = 1;
/** Despawn / sub-pixel scale-fade in progress (object is still alive). */
export const FLAG_FADING = 2;
/** Pending reclaim — collision/queries must skip it. */
export const FLAG_TOMB = 4;
/**
 * v2: rare promotion (golden tint, RARE_SCORE_BONUS). VALUE FROZEN at 8 by
 * DESIGN-V2.md Phase 0 — set only by spawner._spawnPlacement (never by
 * reinject), read by absorb.js (AbsorbEvent.rare) and the sub-pixel sweep.
 */
export const FLAG_RARE = 8;
/**
 * v3: slot owned by the CuratedSpawner (world/curated.js). VALUE FROZEN at 16
 * by DESIGN-V3.md Phase 0. Chunk-spawner bookkeeping skips flagged slots; the
 * knock-off reinject path STRIPS FLAG_CURATED|FLAG_RARE (chunk codes < 70
 * re-enter the chunk path; EXTRA codes >= EXTRA_CODE_BASE never knock off).
 */
export const FLAG_CURATED = 16;

/* ================================================================== */
/* Archetype code <-> id mapping (derived from the frozen tier table)  */
/* ================================================================== */

/**
 * First EXTRA curated code == number of chunk codes
 * (TIERS.length * ARCH_PER_TIER = 70). render/ball.knockOff skips stuck
 * entries with code >= EXTRA_CODE_BASE (EXTRA objects are permanently stuck).
 */
export const EXTRA_CODE_BASE = TIERS.length * ARCH_PER_TIER;

/**
 * The 24 EXTRA curated archetype ids, FROZEN in code order 70..93
 * (docs/DESIGN-V3.md Phase-0 appendix — append-only, never reorder):
 *   70..81 collectibles (code = 70 + frozen COLLECTIBLE_ID 0..11;
 *          80 hachiko_statue is DUAL collectible id10 + landmarkId 0),
 *   82..91 landmark singletons (threshold-ladder order),
 *   92 shop shell, 93 Skytree display-name slot (NEVER spawned into the
 *   store — render/goalTower.js + env silhouette only).
 * config/catalog.js implements exactly these ids in EXTRA_CATALOG and is
 * cross-asserted there in dev mode.
 * @type {string[]}
 */
export const EXTRA_ARCHETYPE_IDS = [
  'gold_maneki_neko', // 70 金の招き猫 (collectible 0)
  'vacuum_tube', // 71 真空管 (collectible 1)
  'retro_game_console', // 72 レトロゲーム機 (collectible 2)
  'akiba_figure', // 73 秋葉原フィギュア (collectible 3)
  'gaming_pc', // 74 ゲーミングPC (collectible 4)
  'otoro_sushi', // 75 特上大トロ (collectible 5)
  'daruma', // 76 だるま (collectible 6)
  'panda_plush', // 77 パンダのぬいぐるみ (collectible 7)
  'kaminari_okoshi', // 78 雷おこし (collectible 8)
  'golden_object', // 79 金色のオブジェ (collectible 9)
  'hachiko_statue', // 80 ハチ公像 (collectible 10 + landmarkId 0 — DUAL)
  'yakatabune', // 81 屋形船 (collectible 11)
  'saigo_statue', // 82 西郷さん像 (landmarkId 1)
  'kaminarimon', // 83 雷門 (landmarkId 2)
  'radio_kaikan', // 84 ラジオ会館風ビル (landmarkId 3)
  'shibuya_109', // 85 渋谷109 (landmarkId 4)
  'scramble_crossing', // 86 スクランブル交差点 decal (landmarkId 5)
  'tokyo_dome', // 87 東京ドーム (landmarkId 6)
  'tokyo_station', // 88 東京駅丸の内駅舎 (landmarkId 7)
  'national_diet', // 89 国会議事堂 (landmarkId 8)
  'rainbow_bridge_span', // 90 レインボーブリッジ橋スパン (landmarkId 9)
  'tokyo_tower', // 91 東京タワー (landmarkId 10)
  'akiba_parts_shop', // 92 アキバパーツ館 shop shell
  'tokyo_skytree', // 93 東京スカイツリー — display-name reservation ONLY
];

/**
 * Flat archetype id table (94 entries, v3):
 * codes 0..69: ARCHETYPE_ID_BY_CODE[tier*ARCH_PER_TIER + i] ===
 * TIERS[tier].archetypeIds[i]; codes 70..93: EXTRA_ARCHETYPE_IDS[code - 70].
 * @type {string[]}
 */
export const ARCHETYPE_ID_BY_CODE = [];

/**
 * Reverse lookup: catalog id -> uint16 archetype code (chunk + EXTRA).
 * @type {Record<string, number>}
 */
export const ARCHETYPE_CODE_BY_ID = {};

for (let t = 0; t < TIERS.length; t++) {
  const ids = TIERS[t].archetypeIds;
  for (let i = 0; i < ids.length; i++) {
    const code = t * ARCH_PER_TIER + i;
    ARCHETYPE_ID_BY_CODE[code] = ids[i];
    ARCHETYPE_CODE_BY_ID[ids[i]] = code;
  }
}
for (let e = 0; e < EXTRA_ARCHETYPE_IDS.length; e++) {
  const code = EXTRA_CODE_BASE + e;
  ARCHETYPE_ID_BY_CODE[code] = EXTRA_ARCHETYPE_IDS[e];
  ARCHETYPE_CODE_BY_ID[EXTRA_ARCHETYPE_IDS[e]] = code;
}

/**
 * Compose a uint16 archetype code from tier index + index within the tier's
 * frozen ARCH_PER_TIER-id list. CHUNK CODES ONLY (0..69) — EXTRA curated
 * codes 70..93 are not tier-strided.
 * @param {number} tierIndex   Home tier 0..6.
 * @param {number} indexInTier Index 0..ARCH_PER_TIER-1 within TIERS[tierIndex].archetypeIds.
 * @returns {number} Code 0..69 for ObjectStore.archetype.
 */
export function archetypeCode(tierIndex, indexInTier) {
  return tierIndex * ARCH_PER_TIER + indexInTier;
}

/**
 * Home tier of a CHUNK archetype code. Valid ONLY for codes <
 * EXTRA_CODE_BASE (EXTRA codes carry naturalBand in catalog/cityMap data
 * instead — never derive a tier from an EXTRA code with this).
 * @param {number} code Chunk archetype code 0..69.
 * @returns {number} Tier index 0..6.
 */
export function archetypeTierOfCode(code) {
  return (code / ARCH_PER_TIER) | 0;
}

/* Boot DEV-assert: the v3 stride migration (6 -> 7 tiers, 60 -> 70 chunk
   codes) + the 24 frozen EXTRA codes must produce exactly 94 entries —
   cross-checked again from ball.js (chunk section) against this very table. */
if (import.meta.env && import.meta.env.DEV) {
  if (EXTRA_CODE_BASE !== 70) {
    throw new Error(
      `[objects.js invariant] EXTRA_CODE_BASE must be 70 (7 tiers x ARCH_PER_TIER ${ARCH_PER_TIER}), ` +
        `found ${EXTRA_CODE_BASE}`
    );
  }
  if (EXTRA_ARCHETYPE_IDS.length !== 24) {
    throw new Error(
      `[objects.js invariant] EXTRA_ARCHETYPE_IDS must have exactly 24 entries (codes 70..93), ` +
        `found ${EXTRA_ARCHETYPE_IDS.length}`
    );
  }
  if (ARCHETYPE_ID_BY_CODE.length !== 94) {
    throw new Error(
      `[objects.js invariant] ARCHETYPE_ID_BY_CODE must have exactly 94 entries ` +
        `(70 chunk + 24 EXTRA), found ${ARCHETYPE_ID_BY_CODE.length}`
    );
  }
  const uniq = new Set();
  for (let c = 0; c < 94; c++) {
    const id = ARCHETYPE_ID_BY_CODE[c];
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`[objects.js invariant] hole in ARCHETYPE_ID_BY_CODE at code ${c}`);
    }
    if (uniq.has(id)) {
      throw new Error(`[objects.js invariant] duplicate archetype id '${id}' (EXTRA id collides with chunk id?)`);
    }
    uniq.add(id);
    if (ARCHETYPE_CODE_BY_ID[id] !== c) {
      throw new Error(`[objects.js invariant] ARCHETYPE_CODE_BY_ID['${id}'] !== ${c}`);
    }
  }
}

/* ================================================================== */
/* ObjectStore                                                         */
/* ================================================================== */

/**
 * SoA object store, capacity STORE_CAPACITY (8192). All positions/radii are
 * SIM UNITS. Zero allocation after construction; alloc()/free() are O(1)
 * free-list operations; rescaleAll() is four tight Float32 passes.
 *
 * Field ownership: spawner writes px/py/pz/radius/archetype/tierOf at spawn;
 * render layer owns instanceSlot; flags is the alive/dead source of truth.
 */
export class ObjectStore {
  /**
   * @param {number} [capacity=STORE_CAPACITY] Slot count (default 8192).
   */
  constructor(capacity = STORE_CAPACITY) {
    /** @type {number} Total slot count. */
    this.capacity = capacity;
    /** @type {Float32Array} X position, sim units. */
    this.px = new Float32Array(capacity);
    /** @type {Float32Array} Y position, sim units. */
    this.py = new Float32Array(capacity);
    /** @type {Float32Array} Z position, sim units. */
    this.pz = new Float32Array(capacity);
    /** @type {Float32Array} Bounding-sphere radius, sim units (jitter applied). */
    this.radius = new Float32Array(capacity);
    /** @type {Uint16Array} Archetype code (tier*ARCH_PER_TIER + indexInTier, see archetypeCode()). */
    this.archetype = new Uint16Array(capacity);
    /** @type {Uint8Array} Home tier band 0..6 (which spatial hash owns it).
     *  CURATED-MUTABLE: curated re-stamps its FLAG_CURATED slots on
     *  activation/TIER_UP (dynamic re-banding) — never cache across frames. */
    this.tierOf = new Uint8Array(capacity);
    /** @type {Uint8Array} FLAG_ALIVE | FLAG_FADING | FLAG_TOMB | FLAG_RARE | FLAG_CURATED bits. */
    this.flags = new Uint8Array(capacity);
    /** @type {Int32Array} InstancedPool slot, or -1 when not instanced. */
    this.instanceSlot = new Int32Array(capacity).fill(-1);

    /** @type {FreeList} */
    this._free = new FreeList(capacity);
    /** @type {number} */
    this._alive = 0;
  }

  /** Number of currently allocated (alive) slots. @returns {number} */
  get aliveCount() {
    return this._alive;
  }

  /**
   * Allocate a slot. Sets flags = FLAG_ALIVE and instanceSlot = -1; the caller
   * (spawner) must fill px/py/pz/radius/archetype/tierOf before the object is
   * inserted into a spatial hash.
   * @returns {number} Slot index, or -1 if the store is full.
   */
  alloc() {
    const i = this._free.alloc();
    if (i === -1) return -1;
    this.flags[i] = FLAG_ALIVE;
    this.instanceSlot[i] = -1;
    this._alive++;
    return i;
  }

  /**
   * Free a slot (absorb, despawn-fade end, knock-off consumption). Idempotent:
   * double-free on an already-dead slot is a no-op (flags byte is the source
   * of truth). The caller must have removed the index from its spatial hash
   * BEFORE freeing.
   * @param {number} i Slot index.
   */
  free(i) {
    if (this.flags[i] === 0) return;
    this.flags[i] = 0;
    this.instanceSlot[i] = -1;
    this._alive--;
    this._free.free(i);
  }

  /**
   * Invoke cb(index) for every alive slot (FLAG_ALIVE set, including FADING).
   * Plain indexed scan over the flags byte array — do not allocate inside cb.
   * @param {(index: number) => void} cb Callback receiving the slot index.
   */
  forEachAlive(cb) {
    const flags = this.flags;
    const n = this.capacity;
    for (let i = 0; i < n; i++) {
      if ((flags[i] & FLAG_ALIVE) !== 0) cb(i);
    }
  }

  /**
   * The one-frame similarity rescale: multiply every position and radius by S.
   * Runs unconditionally over the FULL capacity (scaling dead slots is harmless
   * and the branchless pass is faster than testing flags). Called by
   * ScaleManager between physics update and render; the caller then rebuilds
   * the spatial hashes and rewrites instance matrices.
   * @param {number} S Similarity factor (RESCALE_S = 0.2).
   */
  rescaleAll(S) {
    const n = this.capacity;
    const px = this.px;
    for (let i = 0; i < n; i++) px[i] *= S;
    const py = this.py;
    for (let i = 0; i < n; i++) py[i] *= S;
    const pz = this.pz;
    for (let i = 0; i < n; i++) pz[i] *= S;
    const radius = this.radius;
    for (let i = 0; i < n; i++) radius[i] *= S;
  }

  /**
   * Floating-origin rebase: subtract (dx, dz) from every position. Same
   * full-capacity branchless pass rationale as rescaleAll(). Called by
   * ScaleManager in the between-update-and-render slot.
   * @param {number} dx Integer-snapped X shift, sim units.
   * @param {number} dz Integer-snapped Z shift, sim units.
   */
  rebaseAll(dx, dz) {
    const n = this.capacity;
    const px = this.px;
    for (let i = 0; i < n; i++) px[i] -= dx;
    const pz = this.pz;
    for (let i = 0; i < n; i++) pz[i] -= dz;
  }

  /** Full reset to empty (game reset). */
  reset() {
    this.flags.fill(0);
    this.instanceSlot.fill(-1);
    this._free.reset();
    this._alive = 0;
  }
}
