// P0 OOM REPRO / REGRESSION HARNESS — worker-realistic memory curve for the procedural-tree gen path.
// Drives generate_world_chunk (the EXACT gen_worker.js codepath) over a contiguous taiga region — one
// process = one gen worker's lifetime (the _tree_memo + the tree_gen scratch are module-level per worker).
//
// The OOM signal is PEAK RSS during a SUSTAINED stream (what V8's "potential OOM" predictor watches),
// NOT post-GC retained heap (too GC-timing-noisy to read). So this samples RSS every column WITHOUT
// forcing GC, reports the peak + the plateau, and separately drains to a retained floor at the end.
//
// Run: bun bench/tree_oom_rss.js [columns=200]
// PROOF BAR: peak RSS PLATEAUS over 200+ columns (no monotonic climb); ×~10 workers must fit memory.

import { set_gen_config, generate_world_chunk } from '../src/gen/world_gen.js'
import { create_gen_context, anchor_surface } from '../src/gen/column_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../src/config/world_gen_config.js'
import { get_biome_by_name } from '../src/config/biome_registry.js'

const CHUNK = 32
const want_cols = Number(process.argv[2] || 200)
const gc = () => (typeof Bun !== 'undefined' ? Bun.gc(true) : globalThis.gc?.())
const mb = (n) => (n / 1048576).toFixed(0)

set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
const ctx = create_gen_context(DEFAULT_WORLD_GEN_CONFIG)
const TAIGA = /** @type {number} */ (get_biome_by_name('taiga')?.id)
const is_taiga = (cx, cz) => anchor_surface(ctx, cx * CHUNK + 16, cz * CHUNK + 16).biome_id === TAIGA

// Locate the densest taiga raster block (worst case: pine_cathedral giants).
const side = Math.ceil(Math.sqrt(want_cols))
let best = { cx: -4, cz: 0, score: -1 }
for (let cz = -80; cz <= 80 - side; cz += 4)
  for (let cx = -80; cx <= 80 - side; cx += 4) {
    let s = 0
    for (let dz = 0; dz < side; dz += 2) for (let dx = 0; dx < side; dx += 2) if (is_taiga(cx + dx, cz + dz)) s += 1
    if (s > best.score) best = { cx, cz, score: s }
  }

// Sweep: raster the region, drive the surface cy band per column (as the ring manager would). Sample
// RSS every column WITHOUT forcing GC (peak = the churn headroom the OOM predictor sees).
let done = 0
let chunks = 0
let peak_rss = 0
const marks = []
const t0 = performance.now()
gc()
const base_rss = process.memoryUsage().rss
outer: for (let dz = 0; dz < side; dz += 1) {
  for (let dx = 0; dx < side; dx += 1) {
    if (done >= want_cols) break outer
    const cx = best.cx + dx
    const cz = best.cz + dz
    const surf = anchor_surface(ctx, cx * CHUNK + 16, cz * CHUNK + 16).surface_y
    for (let cy = Math.max(0, Math.floor(surf / CHUNK)); cy <= Math.floor((surf + 104) / CHUNK) + 1; cy += 1) {
      generate_world_chunk(cx, cy, cz)
      chunks += 1
    }
    done += 1
    const { rss } = process.memoryUsage()
    if (rss > peak_rss) peak_rss = rss
    if (done % 20 === 0 || done === want_cols) marks.push({ done, rss })
  }
}
// Retained floor: drain with repeated GC, take the min heapUsed seen.
let floor = Infinity
for (let i = 0; i < 6; i += 1) {
  gc()
  floor = Math.min(floor, process.memoryUsage().heapUsed)
}

console.log(
  `taiga block start (${best.cx},${best.cz}); ${done} cols / ${chunks} chunks; ${(performance.now() - t0).toFixed(0)}ms`
)
console.log('RSS marks (MB): ' + marks.map((m) => `${m.done}:${mb(m.rss)}`).join('  '))
const [early] = marks
const late = marks[marks.length - 1]
console.log(`base_rss=${mb(base_rss)}MB  PEAK_RSS=${mb(peak_rss)}MB  retained_floor=${mb(floor)}MB`)
console.log(
  `RSS climb col ${early.done}->${late.done}: ${late.rss >= early.rss ? '+' : ''}${mb(late.rss - early.rss)}MB`
)
console.log(mb(late.rss - early.rss) <= 40 ? 'VERDICT: PLATEAU' : 'VERDICT: CLIMBING')
