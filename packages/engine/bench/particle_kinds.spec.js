// B7 BIOME PARTICLE KINDS pose proof (ENGINE_AAA_PLAN §8 B7 bar). Renders each PARTICLE_KINDS kind on a
// standalone WebGPURenderer (demo/particles_probe.html) and proves it actually draws a moving field —
// fireflies against night, pollen in a lit meadow, embers over scorched, snow, under-canopy leaf-fall.
//
// WHY STANDALONE (not the live engine): the ambient particle layer is DISABLED for release (the TORMENTOR
// arc-shell incident — atmosphere.js:726) and is NOT mounted into the engine scene, and the engine's
// WebGPU renderer isn't exposed to the bench — so the honest, isolated proof is the probe's own renderer.
// The NO-BLOOM law (emissive firefly/ember colours ≤ 1.0 ⇒ luma < the 2.05 bloom threshold) is a mechanical
// unit-test guarantee (particles.test.js "every kind colour channel ≤ 1.0"); this spec proves the RENDER.
//
// PROOF per kind: (1) no init/GPU error (window.__probe_err stays unset), (2) the field is VISIBLE — a
// non-trivial count of pixels brighter than the kind's background (the particles), i.e. not a blank frame.
//
// Run: `bunx playwright test particle_kinds` (headed Metal).

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts/particle_kinds'

/** @type {Array<{ kind:string, count:number, tod?:string, bg:number, label:string }>} */
const KINDS = [
  { kind: 'firefly', count: 350, tod: 'night', bg: 0x07070c, label: 'night-swamp fireflies (emissive, no halo)' },
  { kind: 'pollen', count: 800, tod: 'noon', bg: 0x33421f, label: 'noon-meadow pollen drift' },
  { kind: 'ember', count: 400, bg: 0x0c0604, label: 'scorched embers (rising, emissive)' },
  { kind: 'snow', count: 900, bg: 0x8a99a8, label: 'arctic snow motes' },
  { kind: 'leaf', count: 500, bg: 0x18280f, label: 'under-canopy leaf-fall' },
  // S-AMBIENCE kinds — bubbles rising underwater, sand wisps drifting over the dunes.
  { kind: 'bubble', count: 500, bg: 0x0a2735, label: 'underwater rising bubbles' },
  { kind: 'sand', count: 700, bg: 0x6b5836, label: 'desert wind-drifted sand wisps' },
]

const luma = (hex) => 0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)

for (const spec of KINDS) {
  test(`B7 particle kind — ${spec.kind} renders a visible field (${spec.label})`, async ({ page }) => {
    test.setTimeout(90_000)
    await mkdir(OUT, { recursive: true })

    /** @type {string[]} */
    const gpu_errors = []
    page.on('console', (m) => {
      if (m.type() === 'error' && /webgpu|gpuvalidation|device lost|renderpass|createtexture/i.test(m.text()))
        gpu_errors.push(m.text())
    })
    page.on('pageerror', (e) => gpu_errors.push(String(e)))

    const url = new URL(`${DEMO_ORIGIN}/demo/particles_probe.html`)
    url.searchParams.set('kind', spec.kind)
    url.searchParams.set('count', String(spec.count))
    if (spec.tod) url.searchParams.set('tod', spec.tod)
    await page.goto(url.toString())

    // Fail LOUD on an init error; otherwise wait for the first frame + let the field spread & gust breathe.
    await page.waitForFunction(
      () => Boolean(/** @type {any} */ (window).__probe_ready) || Boolean(/** @type {any} */ (window).__probe_err),
      null,
      { timeout: 40_000 }
    )
    const err = await page.evaluate(() => /** @type {any} */ (window).__probe_err ?? null)
    expect(err, `probe init error for ${spec.kind}`).toBeNull()
    await page.waitForTimeout(2_600) // field populates + advance_gust waves the sway

    const png_path = `${OUT}/${spec.kind}.png`
    const shot = await page.screenshot({ path: png_path })

    // VISIBLE-FIELD check: decode the frame in-page and count pixels brighter than the background by ≥30
    // luma — those ARE the particles — plus the PEAK luma. A blank frame (kind failed to mount) counts ~0.
    // NB: with the ROUND soft-sprite falloff (particles.js — the TORMENTOR fix), each sprite's bright core
    // is smaller than the old opaque square, so the small kinds (pollen/ember/sand, 0.05–0.07 m) legitimately
    // paint fewer bright pixels; visibility is asserted primarily on PEAK luma (size-independent), with a low
    // pixel-count floor that still catches a truly blank/failed mount.
    const data_url = `data:image/png;base64,${shot.toString('base64')}`
    const bright = await page.evaluate(
      async ({ url, bg_luma }) => {
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
          if (l > bg_luma + 30) n += 1
          if (l > peak) peak = l
        }
        return { n, peak, total: d.length / 4 }
      },
      { url: data_url, bg_luma: luma(spec.bg) }
    )

    console.log(
      `[particle-kinds] ${spec.kind}: ${bright.n} particle pixels (peak luma ${bright.peak.toFixed(0)}) → ${png_path}`
    )
    expect(gpu_errors, `${spec.kind} GPU errors:\n${gpu_errors.join('\n')}`).toEqual([])
    // a real field paints a clearly bright particle (peak ≫ bg) AND more than a handful of bright pixels;
    // a blank/failed mount has peak ≈ bg and ~0 bright pixels. Both floors clear the round-sprite counts.
    expect(bright.peak, `${spec.kind} field is invisible (peak luma ≈ background — mount/bake failed)`).toBeGreaterThan(
      luma(spec.bg) + 60
    )
    expect(bright.n, `${spec.kind} field is invisible (no bright pixels — mount/bake failed)`).toBeGreaterThan(20)
  })
}
