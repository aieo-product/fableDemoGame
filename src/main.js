/**
 * @file main.js — Bootstrap + fixed-timestep 60Hz accumulator loop + game
 * state machine (title/playing/finale/win).
 *
 * main.js owns the PER-FRAME CALL ORDER (plain function calls, NOT events)
 * and wires all modules via constructor injection + the event bus.
 * NO GAME LOGIC lives here.
 *
 * ============ v2 (moon update) — BINDING FRAME ORDER ============
 * (docs/DESIGN-V2.md §インターフェース; stub call sites below are marked
 *  "V2-WIRE" for the integrator; stubs no-op so v1 mode keeps running.)
 *  1   intent = input.read(); if (finale.inputLocked) zero x/y/boost/dash
 *  2   fixed steps { ballPhys.step(dt, intent, yaw+PI);
 *                    if (!finale.inputLocked) absorb.resolve(...) }
 *  3   if (!finale.inputLocked) spawner.update(...)
 *  4   scaleMgr.maybeTierUp(...); if (!finale.inputLocked) scaleMgr.maybeRebase(...)
 *  4.5 finale.update(frameDt, ballPhys.state)   // moon drive, render-frame
 *      contact test, cinematic camera (drives cameraRig.cinematicUpdate)
 *  5   ball.update(...)
 *  6   if (!finale.cameraOwned) cameraRig.update(...);
 *      env.update(...); backdrop.update(...); effects.update(...)
 *  6.5 runStats.addSimTime(steps * FIXED_DT)    // internally frozen after MOON_CONTACT
 *  7   updateAndFlushPools(); renderer.render()
 * GameState: TITLE -> PLAYING -> FINALE (finale.inputLocked first true)
 *            -> WIN (main emits GAME_WIN at finale.state === 'done' — main
 *            is the SOLE game:win emitter in v2).
 * BINDING ABSORB subscription order at boot: spawner (bookkeeping only —
 * constructed first; MUST NOT touch instanceSlot/archetype/position fields)
 * -> main attach-handler -> runStats -> sfx/effects/hud.
 * MUTE ownership: main is the single owner — reads LS_MUTE_KEY BEFORE
 * constructing Bgm/Sfx (initialMuted); input.takeMuteToggle() OR
 * EVT.MUTE_REQUEST -> toggle, bgm.setMuted + sfx.setMuted, persist,
 * emit EVT.MUTE_CHANGED.
 * RESET ownership: finale.reset + runStats.reset via resetWorld() below;
 * cameraRig/env/backdrop/ball/hud self-reset via bus (see DESIGN-V2.md).
 * ================================================================
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
  MOON_GOAL_RADIUS_M,
  LS_MUTE_KEY,
} from './config/tuning.js';
import { bus, EVT, PAYLOADS } from './core/events.js';
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

/* ---- v2 modules (all streams landed) -------------------------------- */
import { Finale } from './game/finale.js'; // Stream A
import { MoonView } from './render/moon.js'; // Stream A
import { RunStats } from './game/runStats.js'; // Stream D
import { Bgm } from './audio/bgm.js'; // Stream E
import { Backdrop } from './render/backdrop.js'; // Stream B

/* ------------------------------------------------------------------ */
/* Game state machine                                                  */
/* ------------------------------------------------------------------ */

/** @enum {string} */
const GameState = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  /** v2: post-contact cinematic — sim keeps stepping, input/absorb/spawner/rebase gated off. */
  FINALE: 'finale',
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
/** Pool lookup by archetype code (= flat index tier*ARCH_PER_TIER + slotInTier). */
const POOL_BY_CODE = poolList;

const env = new Environment(renderer.scene, renderer.camera);
const ballPhys = new BallPhysics(bus); // v2: bus injected for dash/dashReady emits
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

/* ------------------------------------------------------------------ */
/* BINDING ABSORB subscription order (v2 contract): spawner ->          */
/* main attach-handler -> runStats -> sfx/effects/hud. The Spawner      */
/* constructor (above) subscribes FIRST — its handler is bookkeeping    */
/* only (consumed bitmask / slotGen / rare-list) and MUST NOT mutate    */
/* instanceSlot/archetype/position fields, which the attach-handler     */
/* below reads intact. The attach-handler is subscribed HERE, before    */
/* any cosmetic consumer constructs (dispatch order = subscription      */
/* order).                                                              */
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

/* v2 mute ownership: read the persisted flag BEFORE constructing audio so
 * Bgm/Sfx apply it inside their lazy context/master-gain creation path. */
let initialMuted = false;
try {
  initialMuted = localStorage.getItem(LS_MUTE_KEY) === '1';
} catch (_) {
  /* private mode / blocked storage — default unmuted */
}

const runStats = new RunStats(bus, scaleMgr, worldSeed);
const effects = new Effects(renderer.scene, bus);
const sfx = new Sfx(bus, initialMuted);
const bgm = new Bgm(bus, initialMuted);
const hud = new Hud(bus);
const screens = new Screens(bus, worldSeed);

/* v2 finale chain + backdrop (Streams A/B/C wiring). */
const moonView = new MoonView(renderer.scene, worldSeed);
const finale = new Finale(bus, scaleMgr, moonView, env, cameraRig, ball, renderer.camera);
finale.setEffects(effects);
effects.setRareProvider(spawner.forEachAliveRare.bind(spawner));
const backdrop = new Backdrop(renderer.scene, worldSeed);

renderer.setAliveProvider(() => store.aliveCount);
renderer.onForceRescale = () => scaleMgr.forceRescale();

/* ------------------------------------------------------------------ */
/* Cross-module event glue (synchronous, zero retention)               */
/* (the ABSORB attach-handler lives above, before the cosmetic         */
/*  consumers — binding v2 subscription order)                         */
/* ------------------------------------------------------------------ */

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

/* v2 mute ownership — main is the SINGLE owner. */
/** @type {boolean} Current mute state (persisted to LS_MUTE_KEY). */
let muted = initialMuted;

/**
 * Apply a mute state everywhere: both audio modules, persistence, and the
 * MUTE_CHANGED broadcast (hud icon).
 * @param {boolean} m New mute state.
 */
function setMutedAll(m) {
  muted = m;
  bgm.setMuted(m);
  sfx.setMuted(m);
  try {
    localStorage.setItem(LS_MUTE_KEY, m ? '1' : '0');
  } catch (_) {
    /* persistence is best-effort */
  }
  PAYLOADS.muteChanged.muted = m;
  bus.emit(EVT.MUTE_CHANGED, PAYLOADS.muteChanged);
}
bus.on(EVT.MUTE_REQUEST, () => setMutedAll(!muted)); // hud button
// Sync the HUD icon with the persisted state at boot (hud only updates the
// icon on the MUTE_CHANGED event; no toggle happens here).
setMutedAll(initialMuted);

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
  // v2 (RESET OWNERSHIP, frozen): finale + runStats reset here; cameraRig /
  // env / backdrop / hud self-reset via the GAME_RESET / GAME_START events.
  finale.reset();
  runStats.reset();
  spawner.preloadStartArea(ballPhys.state.pos, scaleMgr.tierIndex, ballPhys.state.radiusSim);
}

/* ------------------------------------------------------------------ */
/* State transitions (driven by bus events from ui/screens.js)         */
/* ------------------------------------------------------------------ */

bus.on(EVT.GAME_START, onGameStart);
bus.on(EVT.GAME_RESET, onGameReset);
bus.on(EVT.GAME_WIN, onGameWin);

/* v2 cinematic skip: any pointer/key input during the FINALE fast-forwards
   the post-contact cinematic (finale.skipCinematic is a pre-contact no-op).
   Listeners are passive observers — input.js still owns gameplay input. */
function onFinaleSkipInput() {
  if (state === GameState.FINALE) finale.skipCinematic();
}
window.addEventListener('pointerdown', onFinaleSkipInput);
window.addEventListener('keydown', onFinaleSkipInput);

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

/**
 * Finale 'done' -> Win. v1: GAME_WIN comes from ScaleManager's WIN_RADIUS_M
 * latch. v2 (after Stream A removes that latch): main.js is the SOLE emitter
 * — see the V2-WIRE block at frame() step 4.5.
 */
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
  backdrop.setProfileImmediate(devTier); // skip the hills->skyline crossfade too
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
 * Per-frame driver. THE CALL ORDER BELOW IS THE BINDING v2 CONTRACT
 * (docs/DESIGN-V2.md §インターフェース "BINDING frame order") — do not reorder.
 * @param {number} now RAF timestamp (ms).
 */
function frame(now) {
  requestAnimationFrame(frame);

  let frameDt = (now - lastTime) / 1000;
  lastTime = now;
  if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT; // tab-switch guard

  // v2: FINALE keeps simulating (gated below) — only TITLE/WIN idle-render.
  if (state !== GameState.PLAYING && state !== GameState.FINALE) {
    // Title/win: slow idle orbit over the preloaded world, render only.
    if (input.takeMuteToggle()) setMutedAll(!muted); // 'M' works on title/result too
    cameraRig.updateIdle(frameDt);
    env.update(frameDt, ballPhys.state);
    backdrop.update(frameDt, ballPhys.state, renderer.camera);
    ball.update(frameDt, ballPhys.state);
    effects.update(frameDt, ballPhys.state);
    updateAndFlushPools(poolList, frameDt);
    renderer.render();
    return;
  }

  /* 1) Read input once per render frame. v2: from CONTACT the finale owns  */
  /*    the run — zero the intent so physics coasts (nothing fights the     */
  /*    MERGE ball.pos writes).                                             */
  const intent = input.read();
  if (finale.inputLocked) {
    intent.x = 0;
    intent.y = 0;
    intent.boost = false;
    intent.dash = false;
  }
  if (input.takeMuteToggle()) setMutedAll(!muted); // 'M' keyup edge

  /* 2) Fixed-step physics: cap 3 substeps, drop excess debt (no tunneling, */
  /*    no spiral of death). v2: absorb gated off post-contact (growth      */
  /*    frozen => no rescale can fire during the cinematic).                */
  accumulator += frameDt;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    // +PI bridges ballPhysics' yaw convention to cameraRig's (see header).
    ballPhys.step(FIXED_DT, intent, cameraRig.yaw + Math.PI);
    if (!finale.inputLocked) absorb.resolve(ballPhys.state, hashes, store);
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_SUBSTEPS && accumulator >= FIXED_DT) {
    accumulator = accumulator % FIXED_DT; // drop unpayable debt
  }

  /* 3) Amortized world streaming: chunk diff + spawn/despawn queues        */
  /*    (<=64 each) + sub-pixel sweep + knock-off flights. v2: frozen       */
  /*    post-contact.                                                       */
  if (!finale.inputLocked) {
    spawner.update(ballPhys.state.pos, scaleMgr.tierIndex, ballPhys.state.radiusSim, frameDt);
  }

  /* 4) BETWEEN update and render — pixel-identity transforms:              */
  /*    one-frame similarity rescale (tier-up) and floating-origin rebase.  */
  /*    v2: maybeTierUp keeps running (harmless); maybeRebase is gated —    */
  /*    a rebase mid-cinematic is pointless and positions stay well inside  */
  /*    Float32 precision for the ~8.7s post-contact window.                */
  scaleMgr.maybeTierUp(ballPhys.state, store, hashes, instances, cameraRig, env);
  if (!finale.inputLocked) {
    scaleMgr.maybeRebase(ballPhys.state, store, hashes, instances, cameraRig, env, spawner);
  }

  /* 4.5) v2 FINALE (game/finale.js): moon descent/landing drive, render-   */
  /*      frame contact test, MERGE ball.pos writes, cinematic camera via   */
  /*      cameraRig.cinematicUpdate. Stub no-ops until Stream A lands.      */
  finale.update(frameDt, ballPhys.state);
  if (state === GameState.PLAYING && finale.inputLocked) {
    state = GameState.FINALE; // PLAYING -> FINALE on first contact frame
  }
  /* main is the SOLE game:win emitter in v2 (ScaleManager's latch is gone). */
  if (state === GameState.FINALE && finale.state === 'done') {
    PAYLOADS.gameWin.trueRadius = ballPhys.state.radiusSim * scaleMgr.worldScale;
    PAYLOADS.gameWin.seed = worldSeed;
    bus.emit(EVT.GAME_WIN, PAYLOADS.gameWin); // -> onGameWin (state = WIN)
  }

  /* 5) Ball visuals: attach animations, staggered burial cull.             */
  ball.update(frameDt, ballPhys.state);

  /* 6) Camera spring + environment + effects (all AFTER ScaleManager).     */
  /*    v2: from CONTACT the finale owns the camera (cinematicUpdate is     */
  /*    called inside finale.update at 4.5) — skip the gameplay spring.     */
  if (!finale.cameraOwned) {
    cameraRig.update(frameDt, ballPhys.state, input.takeYawDrag());
  }
  env.update(frameDt, ballPhys.state);
  backdrop.update(frameDt, ballPhys.state, renderer.camera);
  effects.update(frameDt, ballPhys.state);

  /* Roll-loop audio follows ball speed (silent until first user gesture). */
  const vel = ballPhys.state.vel;
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  sfx.setRollIntensity(speed / (SPEED_K * ballPhys.state.radiusSim));

  /* 6.5) v2 sim clock (game/runStats.js): deterministic SIM time — the     */
  /*      official rank clock. Internally frozen after MOON_CONTACT.        */
  runStats.addSimTime(steps * FIXED_DT);

  /* 7) Flush instance buffers (one needsUpdate per mesh, updateRanges)     */
  /*    then render. HUD is event-driven, not called here. v2: the goal     */
  /*    lives in finale.js (DESCENT trigger at MOON_GOAL_RADIUS_M).         */
  updateAndFlushPools(poolList, frameDt);
  renderer.render();
}

requestAnimationFrame(frame);

if (import.meta.env && import.meta.env.DEV) {
  console.log(
    `[fable-katamari] booted — seed=${worldSeed} goal@${MOON_GOAL_RADIUS_M}m ` +
      `alive=${store.aliveCount} pools=${poolList.length} hud=${hud !== null} screens=${screens !== null}`
  );
}
