/**
 * @file main.js — Bootstrap + fixed-timestep 60Hz accumulator loop + game
 * state machine (title/playing/win).
 *
 * main.js owns the PER-FRAME CALL ORDER (plain function calls, NOT events)
 * and wires all modules via constructor injection + the event bus.
 * NO GAME LOGIC lives here.
 *
 * Integration notes (Phase 2):
 *  - YAW BRIDGE: ballPhysics' yaw convention (yaw=0 looks along -Z, forward
 *    = (-sin, 0, -cos)) and cameraRig's (forward = (sin, 0, cos)) differ by
 *    exactly PI; the bridge is `cameraRig.yaw + Math.PI` at the one call site.
 *  - ABSORB: absorb.js emits 'absorb' BEFORE store.free(i); the handler here
 *    reads the world-instance tint, frees the world pool slot, and hands the
 *    object to ball.attachStuck — all synchronously during the emit.
 *  - KNOCK_OFF: absorb.js emits a rolled count; the handler here (subscribed
 *    FIRST, before Effects/Sfx) ejects from the render ball, re-injects the
 *    reused WorldReentry records via spawner, then writes the ACTUAL ejected
 *    count back into the payload for the downstream cosmetic handlers.
 *  - RESCALE: ScaleManager scales BallState/store/pools/camera/env itself and
 *    emits 'rescale'; the handler here covers the two pieces ScaleManager has
 *    no reference to: ball.rescaleState(S) and ballPhys.rescaleSpring(S).
 */

import * as THREE from 'three';
import {
  FIXED_DT,
  MAX_SUBSTEPS,
  MAX_FRAME_DT,
  SPEED_K,
  SIM_RADIUS_MIN,
  WIN_RADIUS_M,
} from './config/tuning.js';
import { bus, EVT } from './core/events.js';
import { resolveWorldSeed } from './core/rng.js';
import { TIERS } from './config/tiers.js';
import { CATALOG } from './config/catalog.js';
import { ObjectStore } from './world/objects.js';
import { SpatialHash } from './world/spatialHash.js';
import { BallPhysics } from './physics/ballPhysics.js';
import { Absorb } from './physics/absorb.js';
import { Spawner, ARCHETYPE_IDS } from './world/spawner.js';
import { ScaleManager } from './world/scaleManager.js';
import { Renderer, parseStartRadius } from './render/renderer.js';
import { buildAllGeometries } from './render/geometryFactory.js';
import {
  InstancedPool,
  getSharedObjectMaterial,
  updateAndFlushPools,
} from './render/instances.js';
import { Environment } from './render/environment.js';
import { Input } from './input/input.js';
import { CameraRig } from './render/cameraRig.js';
import { Ball } from './render/ball.js';
import { Effects } from './render/effects.js';
import { Sfx } from './audio/sfx.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';

/* ------------------------------------------------------------------ */
/* Game state machine                                                  */
/* ------------------------------------------------------------------ */

/** @enum {string} */
const GameState = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  WIN: 'win',
});

/** @type {string} Current game state. */
let state = GameState.TITLE;

/** uint32 world seed (?seed= param or Date.now()); shown on win screen. */
const worldSeed = resolveWorldSeed();

/** Dev `?r=` start radius (real meters) or null. */
const startRadiusM = parseStartRadius();

/** World-instance pool capacity per archetype (free-list slots). */
const POOL_CAPACITY = 512;

/* ------------------------------------------------------------------ */
/* Boot — construct modules in dependency order.                       */
/* geometryFactory runs during the title screen (~80ms).               */
/* ------------------------------------------------------------------ */

const renderer = new Renderer(
  /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'))
);
const store = new ObjectStore();
/**
 * 3 live tier-band hashes: hashes[i] owns band scaleMgr.tierIndex - 1 + i.
 * Each band's cell size is its NATIVE cellSizeSim converted to CURRENT sim
 * units (x5 per band step at boot, scaleExp 0) — ScaleManager._rebuildHashes
 * keeps them in sync via bandCellSizeCur on every re-band/rescale/rebase.
 */
const hashes = [
  new SpatialHash(TIERS[0].cellSizeSim / 5), // band -1 (empty at boot)
  new SpatialHash(TIERS[0].cellSizeSim), // band 0
  new SpatialHash(TIERS[1].cellSizeSim * 5), // band +1 scenery, current units
];
const geos = buildAllGeometries(CATALOG);

/** @type {Map<string, InstancedPool>} World pool per archetype id. */
const instances = new Map();
/** @type {InstancedPool[]} Flat list for updateAndFlushPools / reset. */
const poolList = [];
{
  const sharedMat = getSharedObjectMaterial();
  for (let i = 0; i < ARCHETYPE_IDS.length; i++) {
    const id = ARCHETYPE_IDS[i];
    const pool = new InstancedPool(geos[id], sharedMat, POOL_CAPACITY);
    renderer.scene.add(pool.mesh);
    instances.set(id, pool);
    poolList.push(pool);
  }
}
/** Pool lookup by archetype code (= flat index tier*8 + slotInTier). */
const POOL_BY_CODE = poolList;

const env = new Environment(renderer.scene, renderer.camera);
const ballPhys = new BallPhysics();
const scaleMgr = new ScaleManager(bus, worldSeed);
const absorb = new Absorb(bus, scaleMgr, CATALOG);
const spawner = new Spawner(worldSeed, store, hashes, instances, bus, CATALOG);
const ball = new Ball(renderer.scene, geos, bus);

/**
 * 'knockOff' (hard bonk): eject the newest stuck objects from the render
 * ball and re-inject them as re-absorbable world instances. The returned
 * records are REUSED — consumed synchronously here, never retained.
 *
 * REGISTERED BEFORE Effects/Sfx construct (subscription order = dispatch
 * order) so this handler runs first and can write the ACTUAL ejected count
 * back into the payload — effects burst sizing and the knock sfx then see
 * what really left the ball, not the pre-roll from absorb.js.
 * @param {import('./types.js').KnockOffEvent} p Reused payload.
 */
bus.on(EVT.KNOCK_OFF, (p) => {
  const records = ball.knockOff(p.count, ballPhys.state);
  for (let i = 0; i < records.length; i++) spawner.reinject(records[i]);
  p.count = records.length; // honesty: downstream handlers see the actual count
});

const input = new Input(window);
const cameraRig = new CameraRig(renderer.camera, bus);
const effects = new Effects(renderer.scene, bus);
const sfx = new Sfx(bus);
const hud = new Hud(bus);
const screens = new Screens(bus, worldSeed);

renderer.setAliveProvider(() => store.aliveCount);
renderer.onForceRescale = () => scaleMgr.forceRescale();

/* ------------------------------------------------------------------ */
/* Cross-module event glue (synchronous, zero retention)               */
/* ------------------------------------------------------------------ */

/** Module scratch for instanceColor -> hex readback (linear -> sRGB). */
const SCRATCH_COLOR = new THREE.Color();

/**
 * 'absorb' (emitted by absorb.js BEFORE store.free): free the world instance
 * slot and hand the object to the render ball's attach animation, carrying
 * the instance tint along.
 * @param {import('./types.js').AbsorbEvent} p Reused payload (read-only).
 */
bus.on(EVT.ABSORB, (p) => {
  const i = p.objIndex;
  const slot = store.instanceSlot[i];
  const pool = POOL_BY_CODE[store.archetype[i]];
  let colorHex = -1;
  if (pool !== undefined && slot >= 0) {
    const arr = pool.mesh.instanceColor.array;
    // instanceColor stores linear-sRGB floats (setColor used Color.setHex).
    SCRATCH_COLOR.setRGB(arr[slot * 3], arr[slot * 3 + 1], arr[slot * 3 + 2]);
    colorHex = SCRATCH_COLOR.getHex();
    pool.free(slot);
  }
  ball.attachStuck(i, store, ballPhys.state, colorHex);
});

/**
 * 'rescale' (emitted synchronously inside ScaleManager._applyRescale, after
 * BallState/store/pools/camera/env were scaled): cover the two hooks
 * ScaleManager has no reference to.
 * @param {import('./types.js').RescaleEvent} p Reused payload (read-only).
 */
bus.on(EVT.RESCALE, (p) => {
  ballPhys.rescaleSpring(p.S); // hidden ground y-spring (BallState already scaled)
  ball.rescaleState(p.S); // ballGroup.scale *= S + stuck-record radii
});

/* ------------------------------------------------------------------ */
/* World reset / start-radius helpers                                  */
/* ------------------------------------------------------------------ */

/**
 * Starting sim radius: SIM_RADIUS_MIN normally; the dev `?r=` key maps the
 * requested true radius through the CURRENT worldScale — if it lands above
 * SIM_RADIUS_MAX, ScaleManager applies one rescale per frame until the band
 * is reached (the spawner tracks each via the 'rescale' event).
 * @returns {number} Sim radius for ballPhys.reset().
 */
function startRadiusSim() {
  if (startRadiusM === null) return SIM_RADIUS_MIN;
  return startRadiusM / scaleMgr.worldScale;
}

/**
 * Full deterministic world reset (boot + game:reset). Order matters:
 * spawner first (it owns chunk records pointing into the store), then
 * sim/render stores, then ScaleManager (worldScale must be fresh before the
 * `?r=` radius mapping), then the synchronous start-area preload.
 */
function resetWorld() {
  spawner.reset();
  store.reset();
  for (let i = 0; i < poolList.length; i++) poolList[i].reset();
  absorb.reset();
  scaleMgr.reset();
  // Re-band + re-cell the hashes from the fresh tier/scale (empty store —
  // rebuild doubles as clear and restores each band's cell size).
  for (let i = 0; i < hashes.length; i++) {
    const band = scaleMgr.tierIndex - 1 + i;
    hashes[i].rebuild(store, band, scaleMgr.bandCellSizeCur(band));
  }
  ball.reset();
  ballPhys.reset(startRadiusSim());
  spawner.preloadStartArea(ballPhys.state.pos, scaleMgr.tierIndex, ballPhys.state.radiusSim);
}

/* ------------------------------------------------------------------ */
/* State transitions (driven by bus events from ui/screens.js)         */
/* ------------------------------------------------------------------ */

bus.on(EVT.GAME_START, onGameStart);
bus.on(EVT.GAME_RESET, onGameReset);
bus.on(EVT.GAME_WIN, onGameWin);

/** Title -> Playing. */
function onGameStart() {
  if (state === GameState.PLAYING) return;
  state = GameState.PLAYING;
  accumulator = 0;
  lastTime = performance.now(); // no huge first-frame dt
}

/** Win -> Title (full world reset). */
function onGameReset() {
  state = GameState.TITLE;
  accumulator = 0;
  resetWorld();
}

/** Playing -> Win (trueRadius >= WIN_RADIUS_M; emitted by ScaleManager). */
function onGameWin() {
  state = GameState.WIN;
  sfx.setRollIntensity(0);
}

/* Populate the start area while the title screen is up (a few ms, once).
   Mirrors resetWorld(): the ?r= dev radius is applied BEFORE the preload so
   the preloaded world matches the actual start state, and the environment
   palette lands directly on the requested tier (per Environment's contract)
   instead of crossfading through every TIER_UP on the first playing frame. */
if (startRadiusM !== null) {
  ballPhys.reset(startRadiusSim());
  let devTier = 0;
  while (devTier < TIERS.length - 1 && startRadiusM >= TIERS[devTier + 1].enterTrueRadius) {
    devTier++;
  }
  env.setTierPaletteImmediate(devTier);
}
spawner.preloadStartArea(ballPhys.state.pos, scaleMgr.tierIndex, ballPhys.state.radiusSim);

/* ------------------------------------------------------------------ */
/* Fixed-timestep 60Hz accumulator loop                                */
/* ------------------------------------------------------------------ */

/** @type {number} Unsimulated time (s). */
let accumulator = 0;
/** @type {number} Last RAF timestamp (ms). */
let lastTime = performance.now();

/**
 * Per-frame driver. THE CALL ORDER BELOW IS THE BINDING CONTRACT
 * (DESIGN.md モジュール間インターフェース) — do not reorder.
 * @param {number} now RAF timestamp (ms).
 */
function frame(now) {
  requestAnimationFrame(frame);

  let frameDt = (now - lastTime) / 1000;
  lastTime = now;
  if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT; // tab-switch guard

  if (state !== GameState.PLAYING) {
    // Title/win: slow idle orbit over the preloaded world, render only.
    cameraRig.updateIdle(frameDt);
    env.update(frameDt, ballPhys.state);
    ball.update(frameDt, ballPhys.state);
    effects.update(frameDt, ballPhys.state);
    updateAndFlushPools(poolList, frameDt);
    renderer.render();
    return;
  }

  /* 1) Read input once per render frame. */
  const intent = input.read();

  /* 2) Fixed-step physics: cap 3 substeps, drop excess debt (no tunneling, */
  /*    no spiral of death).                                                */
  accumulator += frameDt;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    // +PI bridges ballPhysics' yaw convention to cameraRig's (see header).
    ballPhys.step(FIXED_DT, intent, cameraRig.yaw + Math.PI);
    absorb.resolve(ballPhys.state, hashes, store);
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_SUBSTEPS && accumulator >= FIXED_DT) {
    accumulator = accumulator % FIXED_DT; // drop unpayable debt
  }

  /* 3) Amortized world streaming: chunk diff + spawn/despawn queues        */
  /*    (<=64 each) + sub-pixel sweep + knock-off flights.                  */
  spawner.update(ballPhys.state.pos, scaleMgr.tierIndex, ballPhys.state.radiusSim, frameDt);

  /* 4) BETWEEN update and render — pixel-identity transforms:              */
  /*    one-frame similarity rescale (tier-up) and floating-origin rebase.  */
  scaleMgr.maybeTierUp(ballPhys.state, store, hashes, instances, cameraRig, env);
  scaleMgr.maybeRebase(ballPhys.state, store, hashes, instances, cameraRig, env, spawner);

  /* 5) Ball visuals: attach animations, staggered burial cull.             */
  ball.update(frameDt, ballPhys.state);

  /* 6) Camera spring + environment + effects (all AFTER ScaleManager).     */
  cameraRig.update(frameDt, ballPhys.state, input.takeYawDrag());
  env.update(frameDt, ballPhys.state);
  effects.update(frameDt, ballPhys.state);

  /* Roll-loop audio follows ball speed (silent until first user gesture). */
  const vel = ballPhys.state.vel;
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  sfx.setRollIntensity(speed / (SPEED_K * ballPhys.state.radiusSim));

  /* 7) Flush instance buffers (one needsUpdate per mesh, updateRanges)     */
  /*    then render. HUD is event-driven (10Hz 'grow'), not called here.    */
  /*    Win check lives in ScaleManager.maybeTierUp (trueRadius latch).     */
  updateAndFlushPools(poolList, frameDt);
  renderer.render();
}

requestAnimationFrame(frame);

if (import.meta.env && import.meta.env.DEV) {
  console.log(
    `[fable-katamari] booted — seed=${worldSeed} win@${WIN_RADIUS_M}m ` +
      `alive=${store.aliveCount} pools=${poolList.length} hud=${hud !== null} screens=${screens !== null}`
  );
}
