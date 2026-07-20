// S-85 ULTRA godrays proof (real-GPU headed, studio-metal). Two independent fixes make the shadow-volume
// GodraysNode shippable inside the HIGH (ceiling) tier, each proven by a DIFFERENT pose:
//  • BASE strength cut (GODRAYS_GAIN 0.4→0.026): the term is added in LINEAR HDR × the bright ~8 sun
//    radiance, so the old peak (+1.6) clipped every terrain-filled frame to a milky whiteout. 0.026 lands
//    the peak at ≈ +0.10 linear — a subtle sheen that never washes. Proven by the LEVEL "beauty" pose.
//  • PITCH/SUN-ELEVATION GAIN (godray_gain.js → u_godray_gain): fades the shafts out at steep-DOWN
//    framings (near terrain over-accumulates) and at/under the horizon (night). Proven by the DOWNWARD
//    "artifact" pose (the ladder lane's measured whiteout: pitch -0.5 rad, tod 0.25). The elevation gate
//    (golden hour keeps rays / night → 0) is exhaustively proven in godray_gain.test.js and shown here.
//
// Screenshots under /tmp/aresrpg-engine-artifacts/ are the authoritative proof (compare to the preserved
// ORIGINAL whiteout). Drives the frozen engine facade (window.__engine) under ?nocam=1 — the demo's own
// rAF camera loop would otherwise overwrite our pose each frame. window.__ARES_GODRAYS_NOGAIN is the live
// per-frame bypass post_stack.update() reads, so one boot A/Bs the gain without a reload.
//
// PRE-EXISTING BLOCKER (unrelated to godrays, one-line finding): at HIGH the 128px block-texture atlas can
// exceed the device default maxTextureArrayLayers (256) once enough biomes stream — the engine never
// requests the adapter's higher 2048 limit (zero `requiredLimits` in renderer init). It fires as a
// GPUValidationError that blacks the frame. Captured FAST (before full streaming) to win the race; the
// GPU-error assert filters that class out. If a run blacks, re-run — the render is a streaming race.
import { test, expect } from '@playwright/test'

import {
  DEMO_ORIGIN,
  probe_gpu_adapter,
  attach_gpu_error_watcher,
  capture_canvas_screenshot,
  sample_canvas_colors,
} from './harness.js'

/** Rec.709 luminance of a {r,g,b} (0-255) mean-color sample. */
const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

const ARTIFACT_POSE = { pos: [70, 175, 70], yaw: Math.PI / 4, pitch: -0.5 } // the measured downward whiteout
const BEAUTY_POSE = { pos: [70, 175, 70], yaw: Math.PI / 4, pitch: -0.18 } // near-level (≈ -10°): full gain
const HALO_POSE = { pos: [70, 175, 70], yaw: Math.PI / 4, pitch: 0.1 } // up toward the bright band / ridge edge

test.describe('S-85 ULTRA godrays gain', () => {
  test('downward whiteout killed by the gain, level rays survive at the reduced base', async ({ page }) => {
    const watcher = attach_gpu_error_watcher(page)
    const url = new URL(`${DEMO_ORIGIN}/demo/index.html`)
    url.searchParams.set('seed', 'aresrpg')
    url.searchParams.set('tier', 'high')
    url.searchParams.set('godrays', '1') // godrays are DEFAULT-OFF (#71/#73/#74 pitch-wash revert) — opt in explicitly to test them
    url.searchParams.set('nocam', '1') // WE own the camera (see header)
    await page.goto(url.toString())
    await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 20_000 })
    expect((await probe_gpu_adapter(page)).ok, 'hardware GPU required (§7)').toBeTruthy()

    const set_pose = (p) =>
      page.evaluate(({ pos, yaw, pitch }) => {
        window.__engine.set_camera_position(pos)
        window.__engine.set_camera_orientation(yaw, pitch)
      }, p)
    const set_tod = (tod) => page.evaluate((t) => window.__engine.set_time_of_day(t), tod)
    const set_gain = (on) =>
      page.evaluate((flag) => {
        if (flag) delete window.__ARES_GODRAYS_NOGAIN
        else window.__ARES_GODRAYS_NOGAIN = 1
      }, on)

    // Frame the artifact pose + settle just enough for the near ring to stream and godrays to lazily mount
    // (needs one shadow render). Kept SHORT on purpose — capture before the block atlas over-streams past
    // the 256-layer device limit (see header). The asserted A/B (artifact, beauty) is captured first.
    await set_tod(0.25)
    await set_pose(ARTIFACT_POSE)
    await set_gain(true)
    await page.waitForTimeout(3200)

    // ── ARTIFACT POSE (steep down) — the PITCH gain fades the shafts to 0 → whiteout gone ─────────
    const art_fixed = await sample_canvas_colors(page)
    const p_art_fixed = await capture_canvas_screenshot(page, 'godrays_artifact_fixed')
    await set_gain(false) // bypass the gain: the reduced-base veil the pitch gate removes at this pose
    await page.waitForTimeout(400)
    const art_nogain = await sample_canvas_colors(page)
    const p_art_nogain = await capture_canvas_screenshot(page, 'godrays_artifact_nogain')

    // ── BEAUTY POSE (near level) — the reduced BASE keeps rays subtle, terrain reads through ──────
    await set_gain(true)
    await set_pose(BEAUTY_POSE)
    await page.waitForTimeout(700)
    const beauty = await sample_canvas_colors(page)
    const p_beauty = await capture_canvas_screenshot(page, 'godrays_beauty_fixed')

    // ── SUN-THROUGH-TERRAIN-EDGES — halo class (screen-space pass deleted → must stay ring-free) ──
    await set_pose(HALO_POSE)
    await page.waitForTimeout(600)
    const halo = await sample_canvas_colors(page)
    const p_halo = await capture_canvas_screenshot(page, 'godrays_halo_edge')

    // ── GOLDEN HOUR (sun ≈9° at tod 0.71) + NIGHT (below horizon, tod 0.85) — elevation-gate visuals
    // (rigorously proven in godray_gain.test.js). Best-effort; no assertions.
    await set_tod(0.71)
    await set_pose(BEAUTY_POSE)
    await page.waitForTimeout(1000)
    const golden = await sample_canvas_colors(page)
    const p_golden = await capture_canvas_screenshot(page, 'godrays_goldenhour')
    await set_tod(0.85)
    await page.waitForTimeout(900)
    const p_night = await capture_canvas_screenshot(page, 'godrays_night')

    console.log(
      '\n[godrays gain] center luma —',
      JSON.stringify(
        {
          artifact_fixed: +luma(art_fixed.center).toFixed(1),
          artifact_nogain: +luma(art_nogain.center).toFixed(1),
          beauty_fixed: +luma(beauty.center).toFixed(1),
          golden_hour: +luma(golden.center).toFixed(1),
          halo_edge: +luma(halo.center).toFixed(1),
        },
        null,
        0
      ),
      '\n[godrays gain] screenshots —\n  ' +
        [p_art_fixed, p_art_nogain, p_beauty, p_golden, p_night, p_halo].map((p) => p.path).join('\n  ')
    )

    // Fail fast with a CLEAR message if this run lost the atlas-streaming race (black frame) — it's the
    // pre-existing limit, not a godrays regression; re-run. A real render has the sky strip well-lit.
    expect(luma(art_fixed.sky), 'black frame = pre-existing block-atlas 256-layer overflow; re-run').toBeGreaterThan(30)

    // PITCH GAIN: at the steep-down artifact pose the shafts fade to 0, so the frame reads as the real
    // (blue-river) scene — luma ~113, nowhere near the ORIGINAL ~224 whiteout (preserved reference). A
    // whiteout is also DESATURATED (r≈g≈b, near-white); the real scene keeps clear channel spread.
    expect(luma(art_fixed.center), 'artifact/gain-on must NOT be washed white (orig whiteout ≈224)').toBeLessThan(175)
    const spread =
      Math.max(art_fixed.center.r, art_fixed.center.g, art_fixed.center.b) -
      Math.min(art_fixed.center.r, art_fixed.center.g, art_fixed.center.b)
    expect(spread, 'artifact center must keep real-scene color, not desaturate to white').toBeGreaterThan(12)
    // …and the gain is doing that work: bypassing it lets the reduced-base veil back over the downward frame.
    expect(
      luma(art_nogain.center) - luma(art_fixed.center),
      'the pitch gain must measurably remove the downward veil'
    ).toBeGreaterThan(6)

    // BASE FIX: at the level beauty pose the shafts stay ON (gain ≈ 1) yet the frame is NOT washed — the
    // reduced base keeps it far below the original ~223 whiteout while terrain reads through.
    expect(luma(beauty.center), 'level-framing rays must be subtle, not a whiteout').toBeLessThan(200)

    // No godrays-INDUCED GPU validation errors (halo/ring class is architecturally impossible — the
    // screen-space pass is deleted — confirmed visually in godrays_halo_edge.png). The pre-existing
    // block-atlas / far_field texture-array-layers limit (unrelated to godrays) is filtered out.
    const godrays_errors = watcher.errors.filter(
      (e) => !/depthorarraylayers|maxtexturearraylayers|exceeded maximum texture size|invalid texture/i.test(e)
    )
    expect(godrays_errors, godrays_errors.join('\n')).toHaveLength(0)
  })
})
