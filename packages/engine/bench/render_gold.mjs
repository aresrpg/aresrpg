// RENDER GOLD — the first two golden PIXEL rows of the fight render suite (acceptance gate,
// BACKLOG 🎥 row; lane BEAT_PLAYBACK 2026-07-18):
//
//   ROW A — "rendering a damage floater": a `board.entity_beat(id, { anim:'hit', float })` on the REAL
//           tactical board (?board=1 demo, real WebGPU/Metal) must put NEW damage-red glyph pixels on
//           screen at the struck entity. This is the layer NO unit could see: the adapter suite proves the
//           mount CALL fires (voxel_fight_beat_playback.test.js) and board_entities' units prove the pure
//           curves — but a dead sprite upload / a dead tick / a broken material renders NOTHING while every
//           data oracle stays green (the v1.12.28 class, and the exact shape of the
//           "no more floating numbers in fights" report this suite was born from).
//   ROW B — "rendering a cast VFX": a `create_vfx_preset(PRESETS[...])` mounted at the entity through the
//           SAME engine door the app's fight_cast_vfx uses (add_to_scene + update(dt), overlay route) must
//           visibly brighten the frame region — the additive fight-bar pass actually presenting.
//
// ORACLES (tolerance-based, REGION-SCOPED, provenance below):
//   · degenerate floor  — bench/degenerate_render.js verdict on the AFTER frame (never a dead canvas green)
//   · ROW A new-red     — pixels that are damage-red in AFTER but were not in BEFORE, censused ONLY inside
//                         the float band (a crop projected from the entity's live anchor + head height —
//                         the exact world-locked-plate math the app's tooltip uses). The float body is
//                         FLOAT_COLOR damage #ff2f1c, toneMapped:false.
//   · ROW B brighter    — pixels whose luma rose > BRIGHT_DELTA inside the burst crop (an additive burst
//                         adds light where it mounts).
//   REGION-SCOPED because the demo world is ALIVE: waving grass + drifting clouds + the mob's idle sway
//   churn a WHOLE-FRAME census far above any glyph (first calibration: full-frame twin new_red 3586 vs the
//   live float's 1422 — the un-cropped oracle could not discriminate at all). Every floor is proven to BITE
//   by the CONTROLLED RED TWIN: the same capture window + the same crops with NO beat and NO preset measure
//   the in-crop noise; each floor sits ≥3× that noise, so a dead render CANNOT pass and a live one clears
//   with headroom.
//
// Run:  node packages/engine/bench/render_gold.mjs            (boots its own isolated vite :5263)
//       RENDER_GOLD_ORIGIN=http://localhost:5262 node ...     (reuse a running engine dev server)
// Wired as `bun ares test render` (scripts/ares.mjs) — a selector leg like gold/anchor: it needs a real
// GPU browser, so it never rides the default no-selector pipeline.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ART = '/tmp/aresrpg-engine-artifacts/render_gold'
const PORT = 5263 // isolated — NEVER any of the app's primary dev ports, nor the engine dev :5199
const ORIGIN = process.env.RENDER_GOLD_ORIGIN ?? `http://localhost:${PORT}`

// PROVENANCE (measured 2026-07-18, HEAD 445e65d, headed Metal, 1280×720@1x, ?board=1 + m1 wolfling at
// (6,3), dolly 12, float crop 340×240 above the head anchor, burst crop 460×340 at chest — calibration
// captures in /tmp/aresrpg-engine-artifacts/render_gold): in-crop twin noise new_red 32 px; live float
// (salmon predicate) fresh 4865 px over a 70 px static base; the big_impact_05 fireball saturates most of
// its crop (tens of thousands of brighter px). Floors sit ≥3× the twin noise with ≥4× live headroom.
const NEW_RED_FLOOR = 800 // px — ≥20× in-crop twin noise, ~6× under the live glyph census (see PROVENANCE)
const BRIGHTER_FLOOR = 10_000 // px — the fireball core is blown white; twin day-drift stays far under at Δ80
const BRIGHT_DELTA = 80 // luma step counting as "lit up" — above cloud/day drift, trivial for the burst core
const FLOAT_CROP = { w: 340, h: 240 } // screen px around the float band (head → head + rise)
const BURST_CROP = { w: 460, h: 340 } // screen px around the burst mount (chest height, wide splash)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function wait_http(url, deadline_ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < deadline_ms) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await sleep(300)
  }
  return false
}

/** Boot an isolated engine vite unless RENDER_GOLD_ORIGIN points at a live one. */
async function ensure_server() {
  if (process.env.RENDER_GOLD_ORIGIN) {
    if (!(await wait_http(`${ORIGIN}/demo/index.html`, 5_000)))
      throw new Error(`RENDER_GOLD_ORIGIN ${ORIGIN} is not serving /demo/index.html`)
    return null
  }
  const child = spawn('bunx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ENGINE,
    stdio: 'ignore',
    detached: false,
  })
  if (!(await wait_http(`${ORIGIN}/demo/index.html`, 30_000))) {
    child.kill('SIGKILL')
    throw new Error(`isolated vite :${PORT} never served /demo/index.html`)
  }
  return child
}

/** Boot the ?board=1 demo page and stand one mob on the board (the struck entity every row drives). */
async function boot_board(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(`${ORIGIN}/demo/index.html?board=1`)
  const gpu = await page.evaluate(async () => {
    if (!('gpu' in navigator)) return false
    return !!(await navigator.gpu.requestAdapter())
  })
  if (!gpu) throw new Error('no hardware WebGPU adapter — the render gold rows need headed Metal/Vulkan')
  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 40_000 })
  await page.waitForFunction(() => !!window.__board?._descriptor?.(), null, { timeout: 20_000 })
  await page.evaluate(() => {
    const board = window.__board
    board.entity_upsert({ id: 'm1', kind: 'mob', cell: { x: 6, y: 3 }, facing: 'north' })
    board.camera_rig?.dolly_to?.(12)
  })
  await sleep(2_000) // GLB load + camera settle — the BEFORE frames must be a settled scene
  return page
}

const capture = (page) => page.locator('#canvas').screenshot()

/** Project the m1 anchor (+`up_m` metres) to #canvas pixel coordinates — the same world-locked-plate math
 *  the app's entity tooltip rides (render_position_of + camera.project), so the crops track the REAL body. */
async function entity_screen_anchor(page, up_m) {
  return page.evaluate(
    async ({ up }) => {
      const board = window.__board
      const cam = window.__engine.get_camera?.()
      const at = board.render_position_of?.('m1') // {x,z} ONLY — the feed carries no y (facade contract)
      const d = board._descriptor?.()
      if (!cam || !at || !d) throw new Error('render gold: no camera/anchor/descriptor to project the crop from')
      const head = board.entity_height_of?.('m1') ?? 2
      // world y = the board floor (descriptor origin.y) + the avatar's measured head height + the band offset.
      // Manual clip-space projection (projection × view × world) — no three import: the /@id/ dev-server door
      // proved flaky across optimizer cache states, and 2 matrix multiplies need no library.
      cam.updateMatrixWorld(true)
      const wx = at.x
      const wy = d.origin.y + head + up
      const wz = at.z
      const apply = (m, x, y, z, w) => [
        m[0] * x + m[4] * y + m[8] * z + m[12] * w,
        m[1] * x + m[5] * y + m[9] * z + m[13] * w,
        m[2] * x + m[6] * y + m[10] * z + m[14] * w,
        m[3] * x + m[7] * y + m[11] * z + m[15] * w,
      ]
      const v = apply(cam.matrixWorldInverse.elements, wx, wy, wz, 1)
      const c = apply(cam.projectionMatrix.elements, v[0], v[1], v[2], v[3])
      const ndc_x = c[0] / c[3]
      const ndc_y = c[1] / c[3]
      const canvas = document.querySelector('#canvas')
      const rect = canvas.getBoundingClientRect()
      // canvas backing pixels (the screenshot space), not CSS pixels
      const sx = ((ndc_x + 1) / 2) * rect.width
      const sy = ((1 - ndc_y) / 2) * rect.height
      return { x: sx, y: sy }
    },
    { up: up_m }
  )
}

/** Clamp a centered crop box into a frame. */
const crop_box = (center, size, frame) => {
  const x = Math.max(0, Math.min(frame.w - size.w, Math.round(center.x - size.w / 2)))
  const y = Math.max(0, Math.min(frame.h - size.h, Math.round(center.y - size.h / 2)))
  return { x, y, w: size.w, h: size.h }
}

/** In-page frame analysis: degenerate floor on the WHOLE after frame + the two censuses INSIDE `region`. */
async function analyze(page, before, after, region) {
  return page.evaluate(
    async ({ b64_before, b64_after, bright_delta, box }) => {
      const { degenerate_render_verdict } = await import('/bench/degenerate_render.js')
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = `data:image/png;base64,${b64}`
        })
      const pixels = (img) => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const g = canvas.getContext('2d')
        g.drawImage(img, 0, 0)
        return g.getImageData(0, 0, img.width, img.height)
      }
      const a = pixels(await load(b64_before))
      const b = pixels(await load(b64_after))
      const floor = degenerate_render_verdict(b.data, { width: b.width, height: b.height })
      // the RENDERED damage glyph is the AA'd salmon family of FLOAT_COLOR #ff2f1c (measured body ≈
      // rgb(224,142,119) on the calibration capture) — the strict authored-hex predicate saw only the
      // handful of core texels (91 px) and missed the glyph. Calibrated: strict 91 vs salmon 4865 fresh px.
      const is_red = (d, i) => d[i] > 190 && d[i] - d[i + 1] > 40 && d[i] - d[i + 2] > 70
      const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      let new_red = 0
      let brighter = 0
      const { x: x0, y: y0 } = box
      const x1 = Math.min(b.width, box.x + box.w)
      const y1 = Math.min(b.height, box.y + box.h)
      for (let y = y0; y < y1; y += 1)
        for (let x = x0; x < x1; x += 1) {
          const i = (y * b.width + x) * 4
          if (is_red(b.data, i) && !is_red(a.data, i)) new_red += 1
          if (luma(b.data, i) - luma(a.data, i) > bright_delta) brighter += 1
        }
      return { floor: { code: floor.code, flags: floor.flags }, new_red, brighter, box }
    },
    {
      b64_before: before.toString('base64'),
      b64_after: after.toString('base64'),
      bright_delta: BRIGHT_DELTA,
      box: region,
    }
  )
}

const verdicts = []
const check = (row, name, ok, detail) => {
  verdicts.push({ row, name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} · ${row} · ${name} · ${detail}`)
}

async function main() {
  mkdirSync(ART, { recursive: true })
  const server = await ensure_server()
  const browser = await chromium.launch({ headless: false })
  try {
    const page = await boot_board(browser)
    const frame = { w: 1280, h: 720 }
    // the float band: from the head upward (the sprite spawns at head+0.4 and rises ~1m over its life)
    const float_center = await entity_screen_anchor(page, 0.9)
    const float_crop = crop_box(float_center, FLOAT_CROP, frame)
    // the burst mounts at chest height on the SAME anchor
    const burst_center = await entity_screen_anchor(page, -0.4)
    const burst_crop = crop_box(burst_center, BURST_CROP, frame)

    // ── CONTROLLED RED TWIN — the in-crop noise floor both oracles must tower over ────────────────
    const twin_before = await capture(page)
    await sleep(900)
    const twin_after = await capture(page)
    writeFileSync(path.join(ART, 'twin_before.png'), twin_before)
    writeFileSync(path.join(ART, 'twin_after.png'), twin_after)
    const twin_float = await analyze(page, twin_before, twin_after, float_crop)
    const twin_burst = await analyze(page, twin_before, twin_after, burst_crop)
    check(
      'TWIN',
      'noise stays under the floater floor',
      twin_float.new_red < NEW_RED_FLOOR,
      `new_red=${twin_float.new_red} < ${NEW_RED_FLOOR}`
    )
    check(
      'TWIN',
      'noise stays under the VFX floor',
      twin_burst.brighter < BRIGHTER_FLOOR,
      `brighter=${twin_burst.brighter} < ${BRIGHTER_FLOOR}`
    )

    // ── ROW A — rendering a damage floater ────────────────────────────────────────────────────────
    const a_before = await capture(page)
    await page.evaluate(() => {
      window.__board.entity_beat('m1', { anim: 'hit', float: { text: '-42', kind: 'damage' } })
    })
    // impact ≈ hit-clip impact frame + FLOAT_IMPACT_LAG 0.22s + pop 0.15s; sample mid-hang (~full opacity)
    await sleep(900)
    const a_after = await capture(page)
    writeFileSync(path.join(ART, 'floater_before.png'), a_before)
    writeFileSync(path.join(ART, 'floater_after.png'), a_after)
    const row_a = await analyze(page, a_before, a_after, float_crop)
    check('FLOATER', 'frame is not degenerate', row_a.floor.code === 0, `flags=[${row_a.floor.flags}]`)
    check(
      'FLOATER',
      'damage-red glyphs appeared',
      row_a.new_red >= NEW_RED_FLOOR,
      `new_red=${row_a.new_red} ≥ ${NEW_RED_FLOOR} in ${JSON.stringify(float_crop)}`
    )
    await sleep(1_200) // let the float expire fully before ROW B's BEFORE frame

    // ── ROW B — rendering a cast VFX (the app's exact mount door: preset + add_to_scene + update) ──
    const b_before = await capture(page)
    await page.evaluate(async () => {
      const { create_vfx_preset } = await import('/src/render/vfx_preset_engine.js')
      const { PRESETS } = await import('/src/render/vfx_presets_data.js')
      const board = window.__board
      const at = board.render_position_of?.('m1') // {x,z} only — no y on this feed (facade contract)
      const d = board._descriptor?.()
      if (!at || !d) throw new Error('render gold: no anchor/descriptor for the burst mount')
      // chest height over the BOARD FLOOR (descriptor origin.y) — the first calibration run mounted at
      // world y≈1.2 (`at.y ?? 0`) while the demo floor sits at y≈151: a burst 150 m underground, invisibly
      // "green" for the wrong reason. The y ALWAYS comes from the descriptor, never the xz feed.
      const pos = [at.x, d.origin.y + 1.2, at.z]
      const handle = create_vfx_preset(PRESETS.big_impact_05, { position: pos, scale: 1.5, overlay: true })
      window.__engine.add_to_scene(handle.object3d)
      window.__render_gold_vfx = handle
      let last = performance.now()
      const drive = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000)
        last = now
        if (handle.update(dt)) requestAnimationFrame(drive)
      }
      requestAnimationFrame(drive)
    })
    // the burst's brightness is PHASED (flash → body → embers over 1.5s) and a single sample lands where it
    // lands — census three windows and take the peak, so the row asserts "the burst ever lit the crop", not
    // "the 450ms frame happened to be the bright one" (a 1.19× single-sample margin flaked on calibration).
    writeFileSync(path.join(ART, 'cast_vfx_before.png'), b_before)
    let row_b = null
    for (const [i, wait_ms] of [250, 200, 200].entries()) {
      await sleep(wait_ms)
      const b_after = await capture(page)
      writeFileSync(path.join(ART, `cast_vfx_after_${i}.png`), b_after)
      const sample = await analyze(page, b_before, b_after, burst_crop)
      if (!row_b || sample.brighter > row_b.brighter) row_b = sample
    }
    check('CAST_VFX', 'frame is not degenerate', row_b.floor.code === 0, `flags=[${row_b.floor.flags}]`)
    check(
      'CAST_VFX',
      'the burst visibly lit the frame',
      row_b.brighter >= BRIGHTER_FLOOR,
      `peak brighter=${row_b.brighter} ≥ ${BRIGHTER_FLOOR} in ${JSON.stringify(burst_crop)}`
    )
    await page.evaluate(() => {
      const handle = window.__render_gold_vfx
      if (handle) {
        window.__engine.remove_from_scene(handle.object3d)
        handle.dispose()
      }
    })
  } finally {
    await browser.close()
    server?.kill('SIGKILL')
  }
  const failed = verdicts.filter((v) => !v.ok)
  writeFileSync(path.join(ART, 'verdict.json'), JSON.stringify({ t: Date.now(), verdicts }, null, 2))
  console.log(`render gold: ${verdicts.length - failed.length}/${verdicts.length} pass · artifacts ${ART}`)
  if (failed.length > 0) process.exit(1)
}

main().catch((error) => {
  console.error('render gold: BLOCKED —', error)
  process.exit(2)
})
