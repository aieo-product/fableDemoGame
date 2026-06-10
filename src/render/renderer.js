/**
 * @file renderer.js — WebGLRenderer setup, resize, pixel-ratio cap (1.5),
 * dynamic-resolution governor (3s rolling avg > FRAME_BUDGET_MS drops the
 * pixel ratio toward 1.0), debug overlay (backquote: fps / draw calls / tris /
 * alive / heap delta), force-rescale dev key (KeyR, DEV builds) and the
 * `?r=` start-radius dev param parser.
 *
 * Owns the THREE.Scene and the PerspectiveCamera (cameraRig drives the camera
 * transform; this module only owns FOV base/aspect/projection plumbing at
 * construction + resize — FOV kicks are cameraRig's job).
 *
 * Zero-allocation discipline: render() allocates nothing in steady state.
 * The debug overlay builds a string only while visible, at 5 Hz (dev tool —
 * accepted, matches DESIGN.md).
 */

import * as THREE from 'three';
import {
  FOV_BASE,
  PIXEL_RATIO_MAX,
  FRAME_BUDGET_MS,
  GOVERNOR_WINDOW_S,
  DRAW_CALL_CAP,
  TRI_BUDGET,
} from '../config/tuning.js';
import { bus, EVT, PAYLOADS } from '../core/events.js';

/** Vite dev-build flag (false / undefined in prod and plain node). */
const DEV = !!(import.meta.env && import.meta.env.DEV);

/** Camera near plane (sim units). Min camera distance ~6.5*0.5 = 3.25 sim. */
const CAMERA_NEAR = 0.05;
/** Camera far plane (sim units). Max fog far = 55*2.5 = 137.5; sky dome ~1800. */
const CAMERA_FAR = 4000;
/** Governor pixel-ratio step per 3s window decision. */
const GOVERNOR_STEP = 0.125;
/** Recover resolution only when rolling avg < this fraction of the budget (hysteresis). */
const GOVERNOR_RECOVER_FRAC = 0.7;
/** Debug overlay text refresh period (s) while visible. */
const OVERLAY_PERIOD_S = 0.2;

/**
 * Parse the `?r=` dev start-radius URL param (TRUE radius in real meters,
 * e.g. `?r=1.5` starts the ball at 1.5 m — the Phase-3 per-tier tuning key).
 * @param {string} [search] Override of location.search (for tests).
 * @returns {number|null} Start radius in real meters, or null if absent/invalid.
 */
export function parseStartRadius(search) {
  const s = search !== undefined ? search : (typeof location !== 'undefined' ? location.search : '');
  const m = /[?&]r=([0-9]*\.?[0-9]+)/.exec(s);
  if (m === null) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Renderer — owns the WebGLRenderer, Scene and PerspectiveCamera, the resize
 * path, the dynamic-resolution governor and the debug overlay.
 *
 * Integration (main.js):
 *   const renderer = new Renderer(document.getElementById('game-canvas'));
 *   renderer.setAliveProvider(() => store.aliveCount);   // debug overlay / frameStats
 *   renderer.onForceRescale = () => scaleMgr.forceRescale(...); // DEV KeyR
 *   ...per frame, last step: renderer.render();
 */
export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas The #game-canvas mount.
   */
  constructor(canvas) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;

    /** @type {THREE.WebGLRenderer} The raw three renderer. */
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });

    /** @type {THREE.Scene} The single scene — environment/ball/instances mount here. */
    this.scene = new THREE.Scene();

    /** @type {THREE.PerspectiveCamera} Driven by cameraRig (transform + FOV kicks). */
    this.camera = new THREE.PerspectiveCamera(FOV_BASE, 1, CAMERA_NEAR, CAMERA_FAR);

    /**
     * DEV force-rescale hook (KeyR). main.js assigns a callback that triggers
     * ScaleManager's forced rescale for the screenshot-diff verification.
     * @type {(() => void)|null}
     */
    this.onForceRescale = null;

    /** @type {(() => number)|null} Returns ObjectStore alive count for stats. */
    this._aliveProvider = null;

    /* --- resolution / governor state --- */
    /** @type {number} */ this._basePixelRatio = this._computeBasePixelRatio();
    /** @type {number} */ this._pixelRatio = this._basePixelRatio;
    /** @type {number} ms accumulated in the current governor window. */ this._winMs = 0;
    /** @type {number} frames in the current governor window. */ this._winFrames = 0;
    /** @type {number} seconds elapsed in the current governor window. */ this._winElapsed = 0;

    /* --- frame timing --- */
    /** @type {number} */ this._lastTime = -1;
    /** @type {number} Last raw frame interval (ms). */ this._frameMs = 0;
    /** @type {number} Smoothed frame interval (ms) for the fps readout. */ this._avgMs = 16.7;

    /* --- debug overlay --- */
    /** @type {HTMLElement|null} */
    this._overlayEl = typeof document !== 'undefined' ? document.getElementById('debug-overlay') : null;
    /** @type {boolean} */ this._overlayVisible = false;
    /** @type {number} */ this._overlayTimer = 0;
    /** @type {number} */ this._lastHeap = 0;

    /* --- bound listeners (stored for dispose) --- */
    this._onResizeBound = () => this.resize();
    this._onKeyDownBound = (e) => this._onKeyDown(e);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onResizeBound);
      window.addEventListener('keydown', this._onKeyDownBound);
    }

    this.resize();
  }

  /** Current effective pixel ratio (after governor). @returns {number} */
  get pixelRatio() {
    return this._pixelRatio;
  }

  /**
   * Provide the alive-object count for frameStats / the debug overlay.
   * @param {() => number} fn e.g. () => store.aliveCount
   */
  setAliveProvider(fn) {
    this._aliveProvider = fn;
  }

  /**
   * Recompute camera aspect + drawing-buffer size from the canvas CSS size.
   * Bound to window resize; safe to call manually.
   */
  resize() {
    this._basePixelRatio = this._computeBasePixelRatio();
    if (this._pixelRatio > this._basePixelRatio) this._pixelRatio = this._basePixelRatio;
    const w = this.canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1);
    const h = this.canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._applyResolution(w, h);
  }

  /**
   * Render one frame (step 7 of the frame order). Measures the frame interval,
   * runs the dynamic-resolution governor on a 3s rolling window, renders, then
   * emits 'frameStats' (dev / overlay) and refreshes the debug overlay at 5 Hz.
   * Zero allocation in steady state (overlay string only while visible).
   */
  render() {
    const now = performance.now();
    if (this._lastTime >= 0) {
      const frameMs = now - this._lastTime;
      this._frameMs = frameMs;
      this._avgMs += (frameMs - this._avgMs) * 0.08;
      this._governorTick(frameMs);
    }
    this._lastTime = now;

    this.renderer.render(this.scene, this.camera);

    if (DEV || this._overlayVisible) {
      const info = this.renderer.info.render;
      const p = PAYLOADS.frameStats;
      p.ms = this._frameMs;
      p.drawCalls = info.calls;
      p.tris = info.triangles;
      p.alive = this._aliveProvider !== null ? this._aliveProvider() : 0;
      bus.emit(EVT.FRAME_STATS, p);
    }

    if (this._overlayVisible) {
      this._overlayTimer += this._frameMs / 1000;
      if (this._overlayTimer >= OVERLAY_PERIOD_S) {
        this._overlayTimer = 0;
        this._updateOverlay();
      }
    }
  }

  /**
   * Show/hide the debug overlay (also toggled with the backquote key).
   * @param {boolean} [force] Explicit state; omit to toggle.
   */
  toggleDebugOverlay(force) {
    this._overlayVisible = force !== undefined ? force : !this._overlayVisible;
    if (this._overlayEl !== null) {
      this._overlayEl.classList.toggle('hidden', !this._overlayVisible);
    }
    if (this._overlayVisible) this._updateOverlay();
  }

  /** Detach listeners and release the GL context (tests / teardown). */
  dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onResizeBound);
      window.removeEventListener('keydown', this._onKeyDownBound);
    }
    this.renderer.dispose();
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                            */
  /* ------------------------------------------------------------------ */

  /** @returns {number} min(devicePixelRatio, PIXEL_RATIO_MAX), floor 1. */
  _computeBasePixelRatio() {
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    return Math.max(1, Math.min(dpr, PIXEL_RATIO_MAX));
  }

  /**
   * Apply the current pixel ratio + canvas CSS size to the drawing buffer.
   * @param {number} [w] CSS width (px); defaults to current canvas CSS size.
   * @param {number} [h] CSS height (px).
   */
  _applyResolution(w, h) {
    const cw = w !== undefined ? w : (this.canvas.clientWidth || 1);
    const ch = h !== undefined ? h : (this.canvas.clientHeight || 1);
    this.renderer.setPixelRatio(this._pixelRatio);
    this.renderer.setSize(cw, ch, false); // CSS owns layout (#game-canvas inset 0)
  }

  /**
   * Dynamic-resolution governor: accumulate the frame interval into a
   * GOVERNOR_WINDOW_S window; on window close, if the average exceeded
   * FRAME_BUDGET_MS, drop the pixel ratio one step toward 1.0; if it was
   * comfortably under (GOVERNOR_RECOVER_FRAC hysteresis), step back toward
   * the base cap.
   * @param {number} frameMs Last frame interval (ms).
   */
  _governorTick(frameMs) {
    this._winMs += frameMs;
    this._winFrames++;
    this._winElapsed += frameMs / 1000;
    if (this._winElapsed < GOVERNOR_WINDOW_S) return;

    const avg = this._winMs / this._winFrames;
    this._winMs = 0;
    this._winFrames = 0;
    this._winElapsed = 0;

    if (avg > FRAME_BUDGET_MS && this._pixelRatio > 1.0) {
      this._pixelRatio = Math.max(1.0, this._pixelRatio - GOVERNOR_STEP);
      this._applyResolution();
    } else if (avg < FRAME_BUDGET_MS * GOVERNOR_RECOVER_FRAC && this._pixelRatio < this._basePixelRatio) {
      this._pixelRatio = Math.min(this._basePixelRatio, this._pixelRatio + GOVERNOR_STEP);
      this._applyResolution();
    }
  }

  /** Rebuild the overlay text (5 Hz while visible — dev tool, string alloc OK). */
  _updateOverlay() {
    if (this._overlayEl === null) return;
    const info = this.renderer.info.render;
    const fps = this._avgMs > 0 ? 1000 / this._avgMs : 0;
    const alive = this._aliveProvider !== null ? this._aliveProvider() : 0;
    const callsWarn = info.calls > DRAW_CALL_CAP ? ' !' : '';
    const trisWarn = info.triangles > TRI_BUDGET ? ' !' : '';
    let heapLine = '';
    const perf = /** @type {{ memory?: { usedJSHeapSize: number } }} */ (performance);
    if (perf.memory !== undefined) {
      const heap = perf.memory.usedJSHeapSize;
      const delta = this._lastHeap > 0 ? heap - this._lastHeap : 0;
      this._lastHeap = heap;
      heapLine = `\nheap  ${(heap / 1048576).toFixed(1)}MB (${delta >= 0 ? '+' : ''}${(delta / 1024).toFixed(0)}KB)`;
    }
    this._overlayEl.textContent =
      `fps   ${fps.toFixed(1)} (${this._avgMs.toFixed(2)}ms)\n` +
      `calls ${info.calls}/${DRAW_CALL_CAP}${callsWarn}\n` +
      `tris  ${info.triangles}/${TRI_BUDGET}${trisWarn}\n` +
      `alive ${alive}\n` +
      `pxr   ${this._pixelRatio.toFixed(3)} (base ${this._basePixelRatio.toFixed(2)})` +
      heapLine +
      (DEV ? '\n[R] force rescale  [?r=] start radius' : '');
  }

  /**
   * Backquote toggles the debug overlay; KeyR (DEV builds only) fires the
   * force-rescale hook for the pixel-identity screenshot-diff check.
   * @param {KeyboardEvent} e
   */
  _onKeyDown(e) {
    if (e.code === 'Backquote') {
      this.toggleDebugOverlay();
      return;
    }
    if (DEV && e.code === 'KeyR' && typeof this.onForceRescale === 'function') {
      this.onForceRescale();
    }
  }
}
