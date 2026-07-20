// FLAGSHIP VFX bench — fires each ported preset on the standalone probe (bench/../demo/vfx_presets_probe.html,
// its OWN WebGPURenderer) and captures a DETERMINISTIC frame series per archetype: ?preset&t sets the exact
// age, so each screenshot is a named build-up→peak→dissipation frame. Proves (1) no GPU/init error, (2) the
// burst is VISIBLE (bright pixels over the near-black bg), (3) build ms per preset (the burst-frame spike).
// The in-engine AgX-survival capture is a separate demo; this proves the raw render + timing.
//
// Run: `bunx playwright test vfx_presets` (headed Metal).

import { mkdir, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts/vfx_presets'

// The 6 archetypes the brief names, each with a build-up→peak→dissipate age series (seconds).
const ARCHETYPES = [
  // _debug is the low-instance-count REGRESSION GUARD (3 count-1 emitters — the storage-buffer read path that
  // a raw instancedBufferAttribute misbinds at count 1/2; keep it firing so that fix can never silently rot).
  { preset: '_debug', ts: [0.1] },
  { preset: 'ground_explosion_01', ts: [0.04, 0.15, 0.5, 1.2, 2.2] },
  { preset: 'air_explosion_00', ts: [0.04, 0.15, 0.5, 1.2] },
  { preset: 'burst_explosion_01', ts: [0.04, 0.15, 0.5, 1.2] },
  { preset: 'nuke_explosion_01', ts: [0.06, 0.3, 1.0, 2.5] },
  { preset: 'hit_01', ts: [0.03, 0.12, 0.3, 0.6] },
  { preset: 'impact_01', ts: [0.04, 0.15, 0.4, 0.9] },
  { preset: 'big_impact_01', ts: [0.04, 0.15, 0.4, 0.9] },
  { preset: 'strike_01', ts: [0.03, 0.12, 0.3, 0.6] },
  // ── PHASE-2 SPELL-CHAIN FAMILIES (the layers that used to play sprite sheets — now 3D). A cast chain reads
  // windup(charge) → delivery(bolt, with a moving wake) → impact(above) → remnant(loop); the three bursts are the
  // mob-relevant strikes (earth eruption / death KO / weapon slash — the sprite seen on a mob attack).
  { preset: 'charge_fire', ts: [0.12, 0.3, 0.45], scale: 2 }, // WINDUP — the gathering-energy implosion
  { preset: 'bolt_fire', ts: [0.18, 0.26], scale: 2, travel: '13,4,0' }, // DELIVERY — the moving comet + world-static trail wake
  { preset: 'eruption_earth', ts: [0.06, 0.2, 0.5, 0.9], scale: 1.6 }, // BURST — the earth ground eruption
  { preset: 'soul_death', ts: [0.06, 0.2, 0.5], scale: 1.6 }, // BURST — the death KO soul-burst
  { preset: 'slash_weapon', ts: [0.05, 0.15, 0.3], scale: 1.6 }, // BURST — the weapon melee slash (mob physical)
  { preset: 'remnant_fire', ts: [1.0, 2.0], scale: 2 }, // REMNANT — the lingering element residue LOOP (full density past one cycle)
  { preset: 'status_poison', ts: [1.0, 2.0], scale: 2 }, // STATUS — a reserved aura LOOP (now the real StatusFX `bubble`)
  // ── PHASE-B PACK PORTS (ElementalMagic/Electric/Battle/Status real .gdshader looks): each exercises a NEW
  // appearance family so the WGSL compile + render is proven on real Metal (the generic FBM flame is gone).
  { preset: 'charge_water', ts: [0.12, 0.3, 0.45], scale: 2 }, // ElementalMagic: elem_orb gather + elem_flare core + elem_mote embers
  { preset: 'bolt_water', ts: [0.18, 0.26], scale: 2, travel: '13,4,0' }, // elem_orb head + elem_tail wake + elem_streak aura
  { preset: 'bolt_air', ts: [0.18, 0.26], scale: 2, travel: '13,4,0' }, // ElectricFX: the zap lightning arc + aura_mote
  { preset: 'charge_neutral', ts: [0.12, 0.3, 0.45], scale: 2 }, // BattleFX: the arcane_mote
  { preset: 'bolt_heal', ts: [0.18, 0.26], scale: 2, travel: '13,4,0' }, // StatusFX: the heal_cross projectile
  { preset: 'status_ice', ts: [1.0, 2.0], scale: 2 }, // StatusFX aura: the ice_flake crystal snowflake loop
  // ── PHASE-B2 PACK PORTS (the FINAL exactness lane — the last generic FBM `spark`/`star4` borrows replaced by each
  // scene's OWN .gdshader). Each exercises a NEW appearance family so the WGSL compile + render is proven on real
  // Metal: impact_slash/spiral_dust (impact/big above), area_glow, dark_ring/lift/glow/flares, fire 2-hue.
  { preset: 'trap_fire', ts: [1.0, 2.0], scale: 2.5 }, // ElementalMagic area_glow curtain + elem_area seat (audit #9)
  { preset: 'dark_zone_void', ts: [1.0, 2.0], scale: 2.5 }, // DarkMagic dark_ring + dark_lift + area_dark pool (audit sec3)
  { preset: 'dark_bolt_void', ts: [0.18, 0.26], scale: 2, travel: '13,4,0' }, // DarkMagic dark_flares head + dark_glow + trail_blade
  { preset: 'flame_variant_cold', ts: [1.0, 2.0], scale: 2.5 }, // FlameFX fire 2-hue (pale-gold body + magenta-red licks)
  // ── LOCOMOTION one-shot (double-jump): the feet BOUNCE puff — explo_smoke dust billow +
  // explo_rings ground ripple (both already-proven pack appearances). build → peak → dissipate of the ~0.55 s kick.
  { preset: 'dust_puff', ts: [0.05, 0.2, 0.4] },
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

for (const spec of ARCHETYPES) {
  test(`VFX preset — ${spec.preset} renders a visible burst series`, async ({ page }) => {
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
      const url = new URL(`${DEMO_ORIGIN}/demo/vfx_presets_probe.html`)
      url.searchParams.set('preset', spec.preset)
      url.searchParams.set('t', String(t))
      if (spec.scale) url.searchParams.set('scale', String(spec.scale)) // spell presets frame a touch bigger
      if (spec.travel) url.searchParams.set('travel', spec.travel) // moving-emitter wake proof (bolt)
      await page.goto(url.toString())
      await page.waitForFunction(() => Boolean(window.__probe_ready) || Boolean(window.__probe_err), null, {
        timeout: 40_000,
      })
      const err = await page.evaluate(() => window.__probe_err ?? null)
      expect(err, `probe init error for ${spec.preset}@${t}`).toBeNull()
      await page.waitForTimeout(250) // let the fixed-age frame settle
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
      `[vfx] ${spec.preset}: build ${build_ms.toFixed(2)}ms · ${particles} particles · ${draws} draws · ` +
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

// IN-ENGINE AgX SURVIVAL — the honest proof the NORMAL-blend bright-glow choice (board_vfx/title_aura law)
// reads through the real create_engine AgX tone-map + grade + bloom post stack, not just a bare renderer.
// Plays ground_explosion_01 (the impact_big-class Explosion preset fire's heavy hit maps to) on a flat
// open-sky fight board and captures a WARM-BRIGHT burst against the lit sky — the brief's "one in-fight
// impact_big capture". ONE preset only: a second full create_engine boot in one run OOMs the browser (V8).
for (const preset of ['ground_explosion_01']) {
  test(`VFX in-engine AgX — ${preset} survives the tone-map on a fight board`, async ({ page }) => {
    test.setTimeout(180_000)
    await mkdir(OUT, { recursive: true })
    /** @type {string[]} */
    const gpu_errors = []
    page.on('console', (m) => {
      if (m.type() === 'error' && /webgpu|gpuvalidation|device lost|renderpass|createtexture/i.test(m.text()))
        gpu_errors.push(m.text())
    })
    page.on('pageerror', (e) => gpu_errors.push(String(e)))

    const url = new URL(`${DEMO_ORIGIN}/demo/vfx_fight.html`)
    url.searchParams.set('preset', preset)
    await page.goto(url.toString())
    await page.waitForFunction(() => Boolean(window.__vfx_ready), null, { timeout: 90_000 })
    await page.waitForTimeout(1_500) // let the board settle + the looping burst reach a lit frame

    // Capture a few frames across ~1.6 s (the burst loops); keep the WARMEST-bright one — the explosion is warm
    // (r≫b) against the cool lit sky, so warm-bright pixels isolate the burst from the AgX-toned background.
    let best = { warm: 0, path: '' }
    for (let f = 0; f < 5; f += 1) {
      const png = `${OUT}/agx_${preset}_${f}.png`
      const shot = await page.screenshot({ path: png })
      const warm = await page.evaluate(
        async (u) => {
          const img = new Image()
          await new Promise((res, rej) => {
            img.onload = res
            img.onerror = rej
            img.src = u
          })
          const cv = document.createElement('canvas')
          cv.width = img.width
          cv.height = img.height
          const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'))
          g.drawImage(img, 0, 0)
          const d = g.getImageData(0, 0, img.width, img.height).data
          let n = 0
          for (let i = 0; i < d.length; i += 4)
            if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > 170 && d[i] - d[i + 2] > 40) n += 1
          return n
        },
        `data:image/png;base64,${shot.toString('base64')}`
      )
      if (warm > best.warm) best = { warm, path: png }
      await page.waitForTimeout(350)
    }
    console.log(`[vfx-agx] ${preset}: warmest burst frame ${best.warm}px → ${best.path}`)
    expect(gpu_errors, `${preset} AgX GPU errors:\n${gpu_errors.join('\n')}`).toEqual([])
    expect(
      best.warm,
      `${preset} burst is invisible through AgX (crushed — the blend/luma choice failed)`
    ).toBeGreaterThan(400)
  })
}
