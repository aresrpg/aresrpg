// FLAGSHIP VFX bench — Wave-A b_spell (DarkMagic / ElectricFX / ElementalMagic / FlameFX variant) preset proof.
// Fires ONE representative preset per sub-family on the standalone probe (demo/vfx_wavea_spell_probe.html, its OWN
// WebGPURenderer), captures a build-up→peak frame series (?preset&t sets the exact age), and proves per preset:
// (1) no GPU/init/WGSL-compile error, (2) the effect is VISIBLE (bright pixels over the near-black bg), (3) build
// ms. Side-by-side stills land in /tmp/aresrpg-engine-artifacts/wavea_spell/. Run: `bunx playwright test vfx_wavea_spell`.

import { mkdir, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts/wavea_spell'

// One representative per b_spell sub-family (travel set on the projectiles so the world-static wake sheds).
const REPRESENTATIVE = [
  { preset: 'dark_orb_void', ts: [0.2, 0.5], scale: 2, travel: '13,4,0' }, // DarkMagic: void_particle head + void_aura corona + trail_blade wake
  { preset: 'air_bolt_orb_01', ts: [0.15, 0.4], scale: 2, travel: '13,4,0' }, // ElectricFX: the zap lightning arc + four_point_star sparks
  { preset: 'elem_variant_fire_bolt', ts: [0.15, 0.4], scale: 2, travel: '13,4,0' }, // ElementalMagic: elem_orb head + elem_tail wake + elem_streak
  { preset: 'flame_variant_green', ts: [1.0, 1.6], scale: 2 }, // FlameFX: the recoloured `fire` flame LOOP (past one cycle)
  { preset: 'dark_zone_void', ts: [1.0, 1.8], scale: 2 }, // DarkMagic ground: area_dark pool + void_aura ring + mist (bonus sub-shape)
]

/** count pixels brighter than the near-black probe bg by ≥ 24 luma, + the peak luma. */
async function bright_pixels(page, shot) {
  const data_url = `data:image/png;base64,${shot.toString('base64')}`
  return page.evaluate(async (url) => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = url
    })
    const cv = document.createElement('canvas')
    cv.width = img.width
    cv.height = img.height
    const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'))
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    let n = 0
    let peak = 0
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      if (l > 18 + 24) n += 1
      if (l > peak) peak = l
    }
    return { n, peak }
  }, data_url)
}

for (const spec of REPRESENTATIVE) {
  test(`VFX b_spell — ${spec.preset} renders a visible burst series`, async ({ page }) => {
    test.setTimeout(120_000)
    await mkdir(OUT, { recursive: true })

    /** @type {string[]} */
    const gpu_errors = []
    page.on('console', (m) => {
      if (m.type() === 'error' && /webgpu|gpuvalidation|device lost|renderpass|createtexture|pipeline/i.test(m.text()))
        gpu_errors.push(m.text())
    })
    page.on('pageerror', (e) => gpu_errors.push(String(e)))

    /** @type {{ t:number, n:number, peak:number }[]} */
    const series = []
    let build_ms = 0
    let particles = 0
    let draws = 0

    for (const t of spec.ts) {
      const url = new URL(`${DEMO_ORIGIN}/demo/vfx_wavea_spell_probe.html`)
      url.searchParams.set('preset', spec.preset)
      url.searchParams.set('t', String(t))
      if (spec.scale) url.searchParams.set('scale', String(spec.scale))
      if (spec.travel) url.searchParams.set('travel', spec.travel)
      await page.goto(url.toString())
      await page.waitForFunction(() => Boolean(window.__probe_ready) || Boolean(window.__probe_err), null, {
        timeout: 40_000,
      })
      const err = await page.evaluate(() => window.__probe_err ?? null)
      expect(err, `probe init error for ${spec.preset}@${t}`).toBeNull()
      await page.waitForTimeout(250)
      build_ms = await page.evaluate(() => window.__probe_ms ?? 0)
      particles = await page.evaluate(() => window.__probe_particles ?? 0)
      draws = await page.evaluate(() => window.__probe_draws ?? 0)

      const png = `${OUT}/${spec.preset}_t${String(t).replace('.', '_')}.png`
      const shot = await page.screenshot({ path: png })
      const { n, peak } = await bright_pixels(page, shot)
      series.push({ t, n, peak })
    }

    const peak_frame = series.reduce((a, b) => (b.n > a.n ? b : a), series[0])
    console.log(
      `[vfx-spell] ${spec.preset}: build ${build_ms.toFixed(2)}ms · ${particles} particles · ${draws} draws · ` +
        `peak frame t=${peak_frame.t} (${peak_frame.n}px, luma ${peak_frame.peak.toFixed(0)}) · ` +
        series.map((s) => `t${s.t}=${s.n}`).join(' ')
    )
    await writeFile(
      `${OUT}/${spec.preset}.json`,
      JSON.stringify({ preset: spec.preset, build_ms, particles, draws, series }, null, 2)
    )

    expect(gpu_errors, `${spec.preset} GPU errors:\n${gpu_errors.join('\n')}`).toEqual([])
    expect(peak_frame.n, `${spec.preset} never renders a visible burst (blank — mount/seed failed)`).toBeGreaterThan(
      200
    )
    expect(build_ms, `${spec.preset} build too slow (>16ms)`).toBeLessThan(16)
  })
}
