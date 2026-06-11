/**
 * pacing-model.mjs — static pacing audit model (review/tuning tool, NOT shipped).
 * Uses the real cityMap PLACEMENTS + catalog radii + tuning constants and
 * mirrors the SHIPPED growth law: newR = cbrt(R^3 + K*r^3) with
 * K = growthKForObjR(objRealRadius) for chunk filler / curated dressing and
 * K = GROWTH_K (10) for curated LANDMARK/COLLECTIBLE slots (absorb.js
 * exemption), plus the per-band density table DENSITY_K_BY_BAND.
 * Run: node scripts/pacing-model.mjs
 */
import { PLACEMENTS, LANDMARKS, bandAllowedAt, SKYTREE_POS } from '../src/config/cityMap.js';
import {
  ABSORB_RATIO, GROWTH_K, growthKForObjR, SPEED_K, PICKUP_FORGIVE_K, START_RADIUS_M,
  GOAL_RADIUS_M, densityKForBand, SHOP_TERRAIN_RELEASE_M,
} from '../src/config/tuning.js';

// Chunk catalog (id -> [tier, radiusNominal, jitter, weight]) — slots 0..7 fill + 8/9 landmarks.
const CHUNK = {
  // T0
  screw: [0, 0.006, .25, 1.5], resistor: [0, 0.005, .25, 1.5], capacitor: [0, 0.007, .25, 1.4],
  ic_chip: [0, 0.009, .2, 1.2], led: [0, 0.005, .25, 1.4], button_battery: [0, 0.008, .2, 1.2],
  eraser: [0, 0.012, .25, 1.1], paperclip: [0, 0.01, .25, 1.3],
  // T1
  mouse: [1, 0.045, .2, 1.4], game_soft: [1, 0.05, .2, 1.5], junk_hdd: [1, 0.06, .15, 1.2],
  speaker: [1, 0.12, .2, 1.0], toolbox: [1, 0.16, .2, 0.9], magazine_stack: [1, 0.18, .2, 1.1],
  round_stool: [1, 0.3, .2, 0.9], cardboard_box: [1, 0.28, .25, 1.2],
  // T2
  bicycle: [2, 0.9, .15, 1.2], person: [2, 0.85, .15, 1.4], signboard: [2, 1.1, .15, 1.2],
  vending_machine: [2, 1.0, .12, 1.1], cat: [2, 0.35, .2, 1.2], pigeon: [2, 0.18, .2, 1.4],
  nobori_banner: [2, 1.3, .15, 1.1], trash_can: [2, 0.5, .2, 1.0],
  // T3
  car: [3, 2.2, .15, 1.2], taxi: [3, 2.3, .15, 1.0], bus: [3, 6.0, .12, 0.8],
  truck: [3, 4.0, .15, 0.9], street_tree: [3, 4.0, .2, 1.2], kiosk: [3, 2.5, .15, 1.0],
  machiya: [3, 6.0, .15, 0.9], torii: [3, 3.5, .12, 0.7],
  // T4
  zakkyo_building: [4, 18, .2, 1.2], mansion: [4, 22, .2, 1.1], konbini: [4, 10, .15, 1.1],
  parking_garage: [4, 16, .15, 0.9], train_car: [4, 14, .15, 1.0], gas_tank: [4, 10, .15, 0.8],
  crane: [4, 25, .15, 0.8], shrine: [4, 12, .15, 0.8],
  // T5
  skyscraper: [5, 110, .2, 1.1], tower_mansion: [5, 95, .2, 1.1], hotel: [5, 80, .15, 1.0],
  department_store: [5, 70, .15, 1.0], viaduct: [5, 90, .15, 0.9], stadium: [5, 90, .12, 0.8],
  rail_yard: [5, 100, .15, 0.8], cruise_ship: [5, 100, .15, 0.8],
  // T6
  city_block: [6, 220, .15, 1.1], park: [6, 200, .15, 1.0], pier: [6, 210, .15, 0.9],
  building_cluster: [6, 260, .15, 1.0], river_block: [6, 200, .15, 0.9], arena: [6, 230, .12, 0.8],
  forest: [6, 240, .15, 1.0], cloud: [6, 180, .2, 0.9],
};
const FILL_BY_BAND = [[], [], [], [], [], [], []];
for (const [id, [t, r, j, w]] of Object.entries(CHUNK)) FILL_BY_BAND[t].push({ id, r, j, w });

const TIER_ENTER = [0.02, 0.10, 0.50, 2.5, 12, 60, 300];
const tierOf = (R) => { let t = 0; for (let i = 0; i < 7; i++) if (R >= TIER_ENTER[i]) t = i; return t; };
const WS = (b) => 0.04 * Math.pow(5, b);
/** SHIPPED growth law: special (landmark/collectible) keeps K=GROWTH_K. */
const grow = (R, r, special = false) =>
  Math.cbrt(R ** 3 + (special ? GROWTH_K : growthKForObjR(r)) * r ** 3);

/* ============ A. Shop phase: greedy nearest-absorbable sim ============ */
function shopSim() {
  const items = PLACEMENTS.filter((p) => p.interior).map((p) => ({ ...p, eaten: false }));
  let R = START_RADIUS_M, x = 0, z = 0, t = 0, n = 0, firstAt = -1;
  const marks = { 0.05: -1, 0.10: -1, 0.20: -1, 0.30: -1 };
  for (;;) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (p.eaten || p.radiusReal > ABSORB_RATIO * R) continue;
      if (p.y > 0 && R < p.rIntent * 0.9) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) break;
    const p = items[best];
    const v = SPEED_K * R;
    const reach = (1 + PICKUP_FORGIVE_K) * R + p.radiusReal;
    t += Math.max(0, bd - reach) / v + 0.15;
    x = p.x; z = p.z;
    R = grow(R, p.radiusReal, p.collectibleId >= 0 || p.landmarkId >= 0);
    p.eaten = true; n++;
    if (firstAt < 0) firstAt = t;
    for (const m of Object.keys(marks)) if (marks[m] < 0 && R >= +m) marks[m] = t;
  }
  console.log(`A. SHOP (greedy optimal): first absorb @ ${firstAt.toFixed(1)}s; ` +
    Object.entries(marks).map(([m, tt]) => `r=${m} @ ${tt < 0 ? 'never' : tt.toFixed(0) + 's'}`).join(', ') +
    `; full-clear r=${R.toFixed(3)}m after ${n} absorbs, t=${t.toFixed(0)}s`);
}

/* ============ shared filler growth-rate ODE term ============ */
function fillerRate(R, x, z) {
  const N = tierOf(R);
  let lambda = 0, lnGsum = 0;
  for (const band of [N - 1, N]) {
    if (band < 2) continue; // bands 0/1 curated-only
    if (band > 6 || !bandAllowedAt(x, z, band)) continue;
    const ws = WS(band);
    const density = (72 * densityKForBand(band)) / Math.pow(32 * ws, 2); // objs per real m^2
    const list = FILL_BY_BAND[band];
    let wAbs = 0, wTot = 0, lnG = 0, rMean = 0;
    for (const a of list) {
      wTot += a.w;
      if (a.r <= ABSORB_RATIO * R) {
        wAbs += a.w;
        lnG += a.w * Math.log(1 + growthKForObjR(a.r) * Math.pow(a.r / R, 3));
        rMean += a.w * a.r;
      }
    }
    if (wAbs === 0) continue;
    lnG /= wAbs; rMean /= wAbs;
    const width = 2 * ((1 + PICKUP_FORGIVE_K) * R + rMean);
    const lam = density * (wAbs / wTot) * width * SPEED_K * R;
    lambda += lam; lnGsum += lam * lnG;
  }
  return { lambda, lnG: lambda > 0 ? lnGsum / lambda : 0 };
}

/* ============ B. Hold-W corridor sim (shop exit -> east) ============ */
function corridorSim(label) {
  const cur = PLACEMENTS.filter((p) => !p.interior).map((p) => ({ ...p, eaten: false }));
  let R = 0.42, x = 4.6, z = 0, t = 0;
  const log = [];
  let next = 1;
  const dt = 0.02;
  while (t < 600 && R < GOAL_RADIUS_M && x < 1800) {
    const v = SPEED_K * R;
    x += v * dt; t += dt;
    const { lambda, lnG } = fillerRate(R, x, z);
    R *= Math.exp(lambda * lnG * dt);
    const reach = (1 + PICKUP_FORGIVE_K) * R;
    for (const p of cur) {
      if (p.eaten || p.radiusReal > ABSORB_RATIO * R) continue;
      if (p.releaseGated && R < SHOP_TERRAIN_RELEASE_M) continue;
      if (Math.abs(p.z - z) > reach + p.radiusReal || Math.abs(p.x - x) > reach + p.radiusReal) continue;
      R = grow(R, p.radiusReal, p.collectibleId >= 0 || p.landmarkId >= 0); p.eaten = true;
    }
    while (next <= R) { log.push(`r=${next}m @ t=${t.toFixed(1)}s x=${x.toFixed(0)}`); next *= 2; }
  }
  console.log(`B. HOLD-W corridor ${label}:\n   ` + log.join('\n   ') +
    `\n   END r=${R.toFixed(1)}m @ t=${t.toFixed(1)}s x=${x.toFixed(0)}`);
}

/* ============ C. Landmark ladder chain (landmarks keep K=10) ============ */
function ladder() {
  console.log('C. LANDMARK LADDER (threshold = dioramaR/0.65; jump = absorb at threshold, K=10 exempt):');
  for (const ld of LANDMARKS) {
    if (ld.landmarkId === 5 || ld.landmarkId === 0) continue;
    const th = ld.dioramaR / ABSORB_RATIO;
    const jump = grow(th, ld.dioramaR, true);
    console.log(`   L${ld.landmarkId} ${ld.nameJa}: absorbable @ ${th.toFixed(1)}m -> jumps to ${jump.toFixed(1)}m (x${(jump / th).toFixed(2)})`);
  }
  // chain sim: start at Tokyo Dome threshold, absorb every landmark the moment it's absorbable
  let R = 55 / ABSORB_RATIO;
  const seq = [6, 7, 8, 9, 9, 9, 10]; // dome, station, diet, 3 bridge spans, tower
  const names = { 6: 'ドーム', 7: '東京駅', 8: '議事堂', 9: '橋スパン', 10: 'タワー' };
  const out = [`start @ dome threshold ${R.toFixed(1)}m`];
  for (const id of seq) {
    const ld = LANDMARKS.find((l) => l.landmarkId === id);
    const th = ld.dioramaR / ABSORB_RATIO;
    if (R < th) { out.push(`(${names[id]} NOT yet: need ${th.toFixed(0)}m have ${R.toFixed(0)}m — filler required)`); continue; }
    R = grow(R, ld.dioramaR, true);
    out.push(`${names[id]} -> ${R.toFixed(0)}m`);
  }
  out.push(`goal ${GOAL_RADIUS_M}m: ${R >= GOAL_RADIUS_M ? 'REACHED by landmarks alone (BAD)' : 'not reached by landmarks alone (chain broken — GOOD)'}`);
  console.log('   chain: ' + out.join(' | '));
  const pts = [[-550, -120], [-120, 480], [-650, 650], [300, 1380], [440, 1430], [580, 1480], [-480, 1050], [SKYTREE_POS.x, SKYTREE_POS.z]];
  let tt = 0, Rt = 55 / ABSORB_RATIO;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    tt += d / (SPEED_K * Rt);
    Rt = i <= 6 ? grow(Rt, LANDMARKS.find((l) => l.landmarkId === seq[Math.min(i - 1, 6)]).dioramaR, true) : Rt;
  }
  console.log(`   landmark-tour travel time (dome->...->skytree at speed cap): ${tt.toFixed(0)}s`);
}

/* ============ D. curated street volume budget ============ */
function streetBudget() {
  let s = 0, n = 0;
  for (const p of PLACEMENTS) {
    if (p.interior || p.collectibleId >= 0 || p.landmarkId >= 0 || p.releaseGated) continue;
    if (p.x < 4.6 || p.x > 18 || Math.abs(p.z) > 180) continue;
    s += p.radiusReal ** 3; n++;
  }
  const Rend = Math.cbrt(0.42 ** 3 + GROWTH_K * s); // upper bound (K<=10)
  console.log(`D. 中央通り curated strip: ${n} placements, ΣR³=${s.toFixed(1)} m³ -> eating ONLY the strip from r=0.42m yields r<=${Rend.toFixed(1)}m (K=10 upper bound)`);
}

/* ============ E. region cascade ODE (player keeps absorbing locally) ============ */
function regionSim(x, z, R0, Rmax, tMax, label) {
  const cur = PLACEMENTS.filter((p) => !p.interior).map((p) => ({ ...p, eaten: false }));
  let R = R0, t = 0;
  const dt = 0.02; const log = [];
  let next = R0 * 2;
  let maxPerS = 0; let acc = 0; let odeAcc = 0; let maxAtR = 0;
  while (t < tMax && R < Rmax) {
    const { lambda, lnG } = fillerRate(R, x, z);
    const dLn = lambda * lnG * dt;
    R *= Math.exp(dLn);
    odeAcc += dLn; // filler-only growth (special curated jumps are designed)
    t += dt;
    const work = SPEED_K * R * 1.0;
    for (const p of cur) {
      if (p.eaten || p.radiusReal > ABSORB_RATIO * R) continue;
      if (p.releaseGated && R < SHOP_TERRAIN_RELEASE_M) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > work) continue;
      const special = p.collectibleId >= 0 || p.landmarkId >= 0;
      const before = R;
      R = grow(R, p.radiusReal, special); p.eaten = true;
      if (!special) odeAcc += Math.log(R / before); // curated dressing counts
    }
    acc += dt;
    if (acc >= 1) {
      acc -= 1;
      const ratio = Math.exp(odeAcc);
      if (ratio > maxPerS) { maxPerS = ratio; maxAtR = R; }
      odeAcc = 0;
    }
    while (R >= next) { log.push(`r=${next.toFixed(1)} @ ${t.toFixed(1)}s`); next *= 2; }
  }
  console.log(`E. REGION (${label}) from r=${R0}m: ` + log.join(' | ') +
    ` | end r=${R.toFixed(1)} @ ${t.toFixed(1)}s | max NON-special growth per held second x${maxPerS.toFixed(2)} (near r=${maxAtR.toFixed(1)})`);
}

/* ============ F. street cluster leakage check (post rect-clamp) ============ */
function leakage() {
  let inStrip = 0, outStrip = 0;
  for (const p of PLACEMENTS) {
    if (p.interior || p.collectibleId >= 0 || p.landmarkId >= 0 || p.releaseGated) continue;
    if (Math.abs(p.z) > 180 || p.x > 90) continue;
    if (p.x >= 4.6 && p.x <= 18) inStrip++; else outStrip++;
  }
  console.log(`F. STREET/GUTTER placements: ${inStrip} inside the x[4.6,18] strip, ${outStrip} leaked outside`);
}

shopSim();
corridorSim('(shipped law: growthKForObjR + per-band density)');
ladder();
streetBudget();
regionSim(11, 0, 0.42, 600, 600, 'exit gate x=11 from 0.42m');
regionSim(120, 30, 0.5, 600, 600, 'Akiba blocks x=120 from shop-exit 0.5m');
regionSim(120, 30, 2, 600, 600, 'Akiba blocks x=120 from 2m');
regionSim(400, 300, 12, 600, 600, 'general fill x=400 from 12m');
regionSim(400, 300, 60, 600, 600, 'general fill T5 entry 60m');
leakage();
