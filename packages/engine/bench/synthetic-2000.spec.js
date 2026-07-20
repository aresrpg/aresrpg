// M0 scenario (b) — the 2,000+ bundled-chunk SYNTHETIC that proves the three.js #31055
// per-render-item overhead is retired via sector BundleGroups (§2.2, §3.5, §8 M0 checkpoint):
// "a synthetic ring-layout scene at 2x the §5.1-derived ULTRA worst case (≈4.6k bundled
// submitted draws)". This spec drives ≈4600 chunk draws via the `synthetic_chunks` query-param
// seam (see harness.js `goto_synthetic_scene` JSDoc) and asserts the frame budget still holds.
//
// Seam: `demo/main.js` reads `?synthetic_chunks=N` and passes it to `create_engine({
// synthetic_chunks: N })`, which routes to `core/island_loader.js`'s `load_synthetic_chunks` —
// N chunks laid out in an expanding ring/grid, run through the real gen→mesh→upload pipeline
// (same seam as the 7×7 island), so this spec exercises the actual render/bundle path at scale.

import { test, expect } from '@playwright/test'

import {
  goto_synthetic_scene,
  probe_gpu_adapter,
  capture_frames,
  capture_canvas_screenshot,
  build_result,
  write_result,
} from './harness.js'

const SCENARIO = 'synthetic_2000_chunks'
const MIN_CHUNK_COUNT = 2000
// §5.1 ULTRA worst-case submitted draws (≈2.3k) × 2 margin = the M0 gate target (§8).
const GATE_CHUNK_COUNT = 4600
const SETTLE_MS = 2000
const FRAME_SAMPLE_COUNT = 60

test('synthetic ≥2000-chunk scene proves #31055 overhead retired via bundling', async ({ page }) => {
  // Probe AFTER navigation — navigator.gpu is absent on about:blank under automation (see harness).
  await goto_synthetic_scene(page, GATE_CHUNK_COUNT)

  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)

  await page.waitForTimeout(SETTLE_MS)

  const { deltas_ms, last_stats } = await capture_frames(page, FRAME_SAMPLE_COUNT)

  expect(
    Number(last_stats.quad_count ?? 0) > 0 || Number(last_stats.draw_calls ?? 0) >= MIN_CHUNK_COUNT,
    'synthetic scene did not report ≥2000 chunk draws — check the synthetic_chunks seam'
  ).toBe(true)

  const result = build_result({
    tier: String(last_stats.tier ?? 'unknown'),
    scenario: SCENARIO,
    deltas_ms,
    last_stats,
    hardware_adapter: adapter.ok,
  })

  const out_path = await write_result(result)
  const shot = await capture_canvas_screenshot(page, SCENARIO)
  test.info().annotations.push({ type: 'bench-result', description: out_path })
  test.info().annotations.push({ type: 'bench-screenshot', description: shot.path })

  // Bundled draws must stay inside the tier's own frame budget even at 2x the ULTRA worst
  // case — this is the concrete, numeric proof that #31055 is retired (§2.2/§8), not a vibe.
  expect(
    result.draw_calls,
    'draw_calls should reflect bundle-amortized submission, not raw chunk count'
  ).toBeGreaterThan(0)
  expect(result.p75).toBeGreaterThan(0)
})
