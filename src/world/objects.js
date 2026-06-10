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
 *
 * Archetype encoding: store.archetype holds a uint16 CODE
 *   code = tierIndex * ARCH_PER_TIER + indexWithinTier   (0..59, v2 stride 10)
 * derived from the FROZEN Tier.archetypeIds lists in config/tiers.js
 * (slots [8]/[9] of every tier are landmarks).
 * Use archetypeCode() / ARCHETYPE_ID_BY_CODE / ARCHETYPE_CODE_BY_ID below —
 * spawner (Dev B) writes codes, absorb/hud read ids back.
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

/* ================================================================== */
/* Archetype code <-> id mapping (derived from the frozen tier table)  */
/* ================================================================== */

/**
 * Flat archetype id table:
 * ARCHETYPE_ID_BY_CODE[tier*ARCH_PER_TIER + i] === TIERS[tier].archetypeIds[i].
 * Built once at module load from the frozen tier table (60 entries, v2).
 * @type {string[]}
 */
export const ARCHETYPE_ID_BY_CODE = [];

/**
 * Reverse lookup: catalog id -> uint16 archetype code.
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

/**
 * Compose a uint16 archetype code from tier index + index within the tier's
 * frozen ARCH_PER_TIER-id list.
 * @param {number} tierIndex   Home tier 0..5.
 * @param {number} indexInTier Index 0..ARCH_PER_TIER-1 within TIERS[tierIndex].archetypeIds.
 * @returns {number} Code 0..59 for ObjectStore.archetype.
 */
export function archetypeCode(tierIndex, indexInTier) {
  return tierIndex * ARCH_PER_TIER + indexInTier;
}

/**
 * Home tier of an archetype code.
 * @param {number} code Archetype code 0..59.
 * @returns {number} Tier index 0..5.
 */
export function archetypeTierOfCode(code) {
  return (code / ARCH_PER_TIER) | 0;
}

/* Boot DEV-assert: the v2 stride migration (8 -> 10) must produce exactly 60
   codes — cross-checked again from ball.js against this very table. */
if (import.meta.env && import.meta.env.DEV) {
  if (ARCHETYPE_ID_BY_CODE.length !== 60) {
    throw new Error(
      `[objects.js invariant] ARCHETYPE_ID_BY_CODE must have exactly 60 entries ` +
        `(6 tiers x ARCH_PER_TIER ${ARCH_PER_TIER}), found ${ARCHETYPE_ID_BY_CODE.length}`
    );
  }
  for (let c = 0; c < 60; c++) {
    if (typeof ARCHETYPE_ID_BY_CODE[c] !== 'string' || ARCHETYPE_ID_BY_CODE[c].length === 0) {
      throw new Error(`[objects.js invariant] hole in ARCHETYPE_ID_BY_CODE at code ${c}`);
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
    /** @type {Uint8Array} Home tier band 0..5 (which spatial hash owns it). */
    this.tierOf = new Uint8Array(capacity);
    /** @type {Uint8Array} FLAG_ALIVE | FLAG_FADING | FLAG_TOMB | FLAG_RARE bits. */
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
