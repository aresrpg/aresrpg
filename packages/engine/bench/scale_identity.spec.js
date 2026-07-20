// B2 PER-BIOME SCALE IDENTITY contact sheet (ENGINE_AAA_PLAN §8 B2 proof bar, P4 "scale as emotion").
// Boots ?proctrees=1 and captures a VISTA per contact-sheet biome (taiga / temperate_forest / swamp /
// desert) on the real GPU, then composes a 2×2 side-by-side sheet that SHOWS the scale contrast: taiga
// pine cathedrals tower, temperate oak/birch sit mid, swamp presses low + draped, desert is sparse/flat.
//
// HONEST-FRAMING LAW: all four vistas use the SAME camera geometry (OFF/CAM_H/LOOK_H) relative to each
// biome's tree cluster + surface_y — so the trees' REAL height bands (species.js) create the contrast,
// not a per-biome camera cheat. Cluster anchors located by bench/scale_anchors_scan.mjs on the DEFAULT
// "aresrpg" world (grove + density + biome gate — the decorator's own pure placement decision).
//
// ONE TEST PER BIOME, fresh page each (the biomes are >10 000 blocks apart — teleporting across them in
// one tab OOM-crashes the renderer; proctrees_poses.spec.js hit this at ±600). load_radius=5 caps the
// ring. Plus a taiga UNDER-CROWN pose for the cy-seam relight-band check (§9 tree-wave risk), and a
// tier=medium FPS witness at the taiga vista (the densest pines) for the ≤0.3 ms budget.
//
// Run: `bunx playwright test scale_identity` (headed Metal). Frozen-default byte-identity + roster
// coherence live in src/gen/surface_decorator.test.js + world_gen_config.test.js.

import { mkdir, writeFile, readFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN } from './harness.js'
import { seize_camera, park_camera, settle_stream } from './_shared.js'

const OUT = '/tmp/aresrpg-engine-artifacts/scale_identity'

// Cluster center [x,z] + surface_y per biome (bench/scale_anchors_scan.mjs, DEFAULT "aresrpg" seed).
/** @type {Record<string, { center: [number,number], surf: number, idx: number }>} */
const BIOMES = {
  taiga: { center: [-2320, -4016], surf: 143, idx: 1 }, // 87 pine anchors in one 32² cell — dense cathedral
  temperate_forest: { center: [-4176, -4272], surf: 185, idx: 2 }, // mixed oak/birch
  swamp: { center: [7408, -400], surf: 137, idx: 3 }, // buttress + drowned snags, low
  desert: { center: [-2032, 7472], surf: 147, idx: 4 }, // 9 anchors — sparse by design (horizontal)
}

// SHARED framing (identical for all 4 ⇒ scale contrast is the trees, not the camera).
const OFF = -40 // camera SW of the cluster (diag ≈ 57 blocks back — full tree silhouettes in frame)
const CAM_H = 8 // eye height above the REAL ground at the camera column
const LOOK_H = 22 // look target height above the cluster ground (up into the canopy band)

// Euler convention mirrors demo/main.js + cube_planes.spec.js (fwd = [-cos p·sin y, sin p, -cos p·cos y]).
/** @param {[number,number,number]} campos @param {[number,number,number]} target */
const look_at = (campos, target) => {
  const lx = target[0] - campos[0]
  const ly = target[1] - campos[1]
  const lz = target[2] - campos[2]
  const len = Math.hypot(lx, ly, lz) || 1
  return { pitch: Math.asin(ly / len), yaw: Math.atan2(-lx / len, -lz / len) }
}

const FAULT_RE =
  /mesher|occupancy|invisible|bald|shader|WGSL|naga|nesting|light|shadow|relight|NaN|device lost|boot_error/i

/** Hide the HUD + lil-gui so the contact sheet is pure world (cube_planes idiom). */
const hide_ui = (page) =>
  page.evaluate(() => {
    const hud = document.getElementById('hud')
    if (hud) hud.style.display = 'none'
    const gui = document.querySelector('.lil-gui')
    if (gui) /** @type {HTMLElement} */ (gui).style.display = 'none'
  })

/** Real terrain top at (x,z): scan the resident ring down from the sky for the first solid block. The
 *  scan anchor surface is the tree column's; the CAMERA column can be a steep hillside blocks higher —
 *  clamping to the real ground stops the camera burying inside a slope (the proctrees_poses hillside trap). */
const ground_y = (page, x, z) =>
  page.evaluate(
    ({ x, z }) => {
      const e = /** @type {any} */ (window).__engine
      for (let y = 260; y > 60; y -= 1) if (e.sample_block(x, y, z) !== 0) return y
      return 130
    },
    { x, z }
  )

for (const [biome, cfg] of Object.entries(BIOMES)) {
  test(`B2 scale identity — ${biome} vista renders with zero mesher/light faults`, async ({ page }) => {
    test.setTimeout(180_000)
    await mkdir(OUT, { recursive: true })

    /** @type {string[]} */
    const faults = []
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && FAULT_RE.test(m.text())) faults.push(m.text())
    })
    page.on('pageerror', (e) => faults.push(String(e)))

    await page.goto(`${DEMO_ORIGIN}/demo/?proctrees=1&tier=medium&load_radius=5&seed=aresrpg`)
    await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__engine), null, { timeout: 40_000 })
    await seize_camera(page)
    await hide_ui(page)

    const [cx, cz] = cfg.center
    // PHASE 1: park high above the cluster to stream the region in, so sample_block can read real ground.
    await park_camera(page, [cx + OFF, cfg.surf + 45, cz + OFF], 0, -0.35)
    await settle_stream(page, { min_ms: 3_000, deadline_ms: 30_000 })
    // PHASE 2: clamp the camera above the REAL terrain at its own column; look at the cluster canopy.
    const gcam = await ground_y(page, cx + OFF, cz + OFF)
    const gctr = await ground_y(page, cx, cz)
    const pos = /** @type {[number,number,number]} */ ([cx + OFF, gcam + CAM_H, cz + OFF])
    const tgt = /** @type {[number,number,number]} */ ([cx, gctr + LOOK_H, cz])
    const { yaw, pitch } = look_at(pos, tgt)
    await park_camera(page, pos, yaw, pitch)
    await settle_stream(page, { min_ms: 2_400, deadline_ms: 25_000 })
    await page.waitForTimeout(500)
    const vista = `${OUT}/${cfg.idx}_${biome}_vista.png`
    await page.screenshot({ path: vista })
    console.log(`[scale] ${biome} vista → ${vista} (cam ground ${gcam}, cluster ground ${gctr})`)

    // TAIGA extras: the under-crown cy-seam relight check + the tier=medium FPS witness.
    if (biome === 'taiga') {
      // UNDER-CROWN: forest-floor eye height (clamped above real ground), looking steeply UP into a pine
      // canopy. The 30-71-blk crowns cross the cy chunk seams (y=160/192 above ~143 ground); a relight band
      // at a seam would print a light/relight fault AND show as a horizontal brightness step in the shot.
      const gfloor = await ground_y(page, cx + 6, cz + 6)
      const upos = /** @type {[number,number,number]} */ ([cx + 6, gfloor + 3, cz + 6])
      const utgt = /** @type {[number,number,number]} */ ([cx, gfloor + 48, cz])
      const u = look_at(upos, utgt)
      await park_camera(page, upos, u.yaw, u.pitch)
      await settle_stream(page, { min_ms: 3_000, deadline_ms: 30_000 })
      await page.waitForTimeout(500)
      const seam = `${OUT}/taiga_undercrown_seam.png`
      await page.screenshot({ path: seam })
      console.log(`[scale] taiga under-crown floor ${gfloor} (cy-seam y=160/192 band check) → ${seam}`)

      // FPS witness at the vista (tier=medium budget = 9.3 ms p99). Same species COUNT as B1's roster —
      // only the MIX shifted spruce→pine — so this is the cost of the scale change; ≤0.3 ms delta ⇒ ≈budget.
      await park_camera(page, pos, yaw, pitch)
      await settle_stream(page, { min_ms: 2_000, deadline_ms: 20_000 })
      const frames = await page.evaluate(async () => {
        /** @type {number[]} */ const d = []
        let prev = await new Promise((r) => requestAnimationFrame(r))
        while (d.length < 120) {
          const now = await new Promise((r) => requestAnimationFrame(r))
          d.push(/** @type {number} */ (now) - /** @type {number} */ (prev))
          prev = now
        }
        return { d, stats: /** @type {any} */ (window).__ares_last_stats__ ?? {} }
      })
      const sorted = [...frames.d].sort((a, b) => a - b)
      const pct = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
      const fps = {
        p50: +pct(50).toFixed(2),
        p99: +pct(99).toFixed(2),
        quads: Number(frames.stats.quad_count ?? 0),
        draws: Number(frames.stats.draw_calls ?? 0),
      }
      await writeFile(`${OUT}/taiga_fps_medium.json`, JSON.stringify(fps, null, 2), 'utf8')
      console.log(`[scale] taiga MEDIUM fps: p50=${fps.p50}ms p99=${fps.p99}ms quads=${fps.quads} draws=${fps.draws}`)
    }

    if (faults.length) console.log(`[scale] ${biome} FAULTS:\n` + faults.map((f) => '  ' + f).join('\n'))
    expect(faults, `${biome}: mesher/light/shader faults`).toEqual([])
  })
}

// COMPOSE the 2×2 side-by-side contact sheet from the four vista PNGs (best-effort visual deliverable).
test('B2 scale identity — compose the 2×2 contact sheet', async ({ page }) => {
  test.setTimeout(60_000)
  await mkdir(OUT, { recursive: true })
  /** @type {Array<{ biome:string, b64:string }>} */
  const tiles = []
  for (const [biome, cfg] of Object.entries(BIOMES)) {
    const p = `${OUT}/${cfg.idx}_${biome}_vista.png`
    try {
      tiles.push({ biome, b64: (await readFile(p)).toString('base64') })
    } catch {
      console.log(`[scale] contact sheet: MISSING ${p} (biome test must run first)`)
    }
  }
  expect(tiles.length, 'need all 4 vistas to compose the sheet — run the biome tests first').toBe(4)

  // A DOM canvas draws the 4 PNGs into a labelled 2×2 grid. Any booted page works (pure canvas, no engine).
  await page.goto(`${DEMO_ORIGIN}/demo/?proctrees=1&tier=potato&load_radius=1&seed=aresrpg`)
  await page.waitForTimeout(1_500)
  const sheet = await page.evaluate(async (tiles) => {
    const load = (/** @type {string} */ b64) =>
      new Promise((res, rej) => {
        const img = new Image()
        img.onload = () => res(img)
        img.onerror = rej
        img.src = `data:image/png;base64,${b64}`
      })
    const imgs = await Promise.all(tiles.map((t) => load(t.b64)))
    const tw = 640
    const th = 360
    const pad = 8
    const cv = document.createElement('canvas')
    cv.width = tw * 2 + pad * 3
    cv.height = th * 2 + pad * 3
    const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'))
    g.fillStyle = '#0a0a0f'
    g.fillRect(0, 0, cv.width, cv.height)
    for (let i = 0; i < imgs.length; i += 1) {
      const col = i % 2
      const row = Math.floor(i / 2)
      const x = pad + col * (tw + pad)
      const y = pad + row * (th + pad)
      g.drawImage(/** @type {CanvasImageSource} */ (imgs[i]), x, y, tw, th)
      g.fillStyle = 'rgba(10,10,15,0.7)'
      g.fillRect(x, y, 220, 22)
      g.fillStyle = '#c8963c'
      g.font = '14px monospace'
      g.fillText(tiles[i].biome.toUpperCase(), x + 6, y + 16)
    }
    return cv.toDataURL('image/png')
  }, tiles)

  const out = `${OUT}/scale_identity_contact_sheet.png`
  await writeFile(out, Buffer.from(sheet.replace(/^data:image\/png;base64,/, ''), 'base64'))
  console.log(`[scale] contact sheet → ${out}`)
})
