// LOGIN BACKDROP GOLD — the golden pixel row proving the login page keeps its live 3D world backdrop
// rendering behind the login card; render-suite order — the render_gold idiom.
//
//   ROW — a COLD LOGGED-OUT visitor at `/` (fresh browser context, no stored session) must have the LIVE
//   3D world mounted and PRESENTING behind the glass login card. This is the layer no unit can see: the
//   plan_scene unit proves the pre-auth plan says 'spectate' (packages/world/src/session_gate.test.js,
//   the v30 P1 row), but a dead import, a swallowed boot, or a re-grown mount gate renders NOTHING while
//   that unit stays green — the d6d32bc "LOGIN CPU GATE" regression was exactly this shape.
//
// FIXTURE STATE IN: logged-out `/` against the live testnet stack (root .env defaults — the same doors
// the real visitor hits). SCREENSHOT: the viewport HOST region with every overlay layer (glass card,
// blur veil, chat, toasts) visibility-hidden for the capture instant — a Playwright element screenshot
// is a viewport CLIP, not isolated compositing, so without the hide the login card's own text/edges
// could satisfy the structure floors over a DEAD world (the lying-green shape this row must never take).
//
// ORACLES (all four must hold; artifacts land in ART):
//   1. mount     — a canvas EXISTS inside [data-testid="game-world-viewport"]. Pre-fix trees mount NO canvas on
//                  the login route (plan 'static'), so this wait alone turns the regression red.
//   2. floor     — bench/degenerate_render.js verdict code 0 on the full canvas frame (never a dead/flat
//                  present). The verdict's bite is corpus-proven by its own engine-bench unit suite
//                  (blank/flat/single-color trio fails; day/dusk/night scenes pass ≥2× headroom).
//   3. region    — the SAME verdict, region-scoped to the center terrain band (the world's structural
//                  heart: horizon + terrain edges), so a canvas presenting only a flat clear-color sky
//                  wash cannot pass on frame statistics alone.
//   4. pre-auth  — the glass login card is visible OVER the world (the row's whole point is coexistence:
//                  world backdrop + login surface, never one or the other).
//
// Run:  node packages/frontend/bench/login_backdrop_gold.mjs         (boots its own isolated vite :5601)
//       LOGIN_GOLD_ORIGIN=http://localhost:5601 node ...             (reuse a running frontend server)
// Wired as part of `bun ares test render` (scripts/ares.mjs) — needs a real GPU browser (headed
// Metal/Vulkan) + network to the live testnet read layer, so it rides the render selector leg, never the
// default no-selector pipeline.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(FRONTEND, '../..')
const ART = '/tmp/aresrpg-frontend-artifacts/login_backdrop_gold'
const PORT = 5601 // isolated — must never collide with the app's live dev ports
const ORIGIN = process.env.LOGIN_GOLD_ORIGIN ?? `http://localhost:${PORT}`

// The center terrain band, as viewport-relative fractions of the 1280×720 canvas: x spans the middle 70%,
// y from just under the horizon line to above the near-field fog floor — where terrain edges live in the
// spectate camera's default framing regardless of biome or day-phase.
const REGION = { x: 0.15, y: 0.45, w: 0.7, h: 0.35 }
const PRESENT_DEADLINE_MS = 120_000 // cold boot: game chunk + engine + first world chunks off the network
const POLL_MS = 3_000

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

/** Boot an isolated frontend vite unless LOGIN_GOLD_ORIGIN points at a live one. */
async function ensure_server() {
  if (process.env.LOGIN_GOLD_ORIGIN) {
    if (!(await wait_http(ORIGIN, 5_000))) throw new Error(`LOGIN_GOLD_ORIGIN ${ORIGIN} is not serving`)
    return null
  }
  const child = spawn('bunx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: FRONTEND,
    stdio: 'ignore',
    detached: false,
  })
  if (!(await wait_http(ORIGIN, 30_000))) {
    child.kill('SIGKILL')
    throw new Error(`isolated vite :${PORT} never served the app`)
  }
  return child
}

/** In-page frame analysis: the engine-bench degenerate verdict over one PNG, full frame + a region crop.
 *  The verdict module is served by the SAME vite through /@fs (monorepo root is the dev-server fs root),
 *  so this row and the engine's render rows share ONE floor implementation — no vendored copy. */
async function analyze(page, png, region) {
  return page.evaluate(
    async ({ b64, box, fs_path }) => {
      const { degenerate_render_verdict } = await import(/* @vite-ignore */ fs_path)
      const img = await new Promise((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = reject
        el.src = `data:image/png;base64,${b64}`
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const g = canvas.getContext('2d')
      g.drawImage(img, 0, 0)
      const frame = g.getImageData(0, 0, img.width, img.height)
      const full = degenerate_render_verdict(frame.data, { width: img.width, height: img.height })
      const crop = {
        x: Math.round(box.x * img.width),
        y: Math.round(box.y * img.height),
        w: Math.round(box.w * img.width),
        h: Math.round(box.h * img.height),
      }
      const band = g.getImageData(crop.x, crop.y, crop.w, crop.h)
      const region_verdict = degenerate_render_verdict(band.data, { width: crop.w, height: crop.h })
      return {
        full: { code: full.code, flags: full.flags, metrics: full.metrics },
        region: { code: region_verdict.code, flags: region_verdict.flags, metrics: region_verdict.metrics, crop },
      }
    },
    {
      b64: png.toString('base64'),
      box: region,
      fs_path: `/@fs${REPO}/packages/engine/bench/degenerate_render.js`,
    }
  )
}

const verdicts = []
const check = (name, ok, detail) => {
  verdicts.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} · LOGIN_BACKDROP · ${name} · ${detail}`)
}

/** Hide every DOM layer outside the world host for the capture instant (element screenshots are viewport
 *  clips — the glass card would otherwise paint INTO the "world" frame and could fake its structure; the
 *  first cut hid live node refs and a React re-render repainted the buttons mid-capture). A CSS RULE keyed
 *  on a body class is immune to re-renders: whatever React re-creates still matches the selector. The
 *  host's ancestors go visibility:hidden too, so the host subtree is force-revisibled — CSS visibility is
 *  exactly the model where a visible child paints inside a hidden parent. */
const ISOLATE_CSS =
  'body.__login_gold_iso *:not([data-testid="game-world-viewport"]):not([data-testid="game-world-viewport"] *)' +
  '{ visibility: hidden !important }' +
  'body.__login_gold_iso [data-testid="game-world-viewport"], body.__login_gold_iso [data-testid="game-world-viewport"] *' +
  '{ visibility: visible !important }'

/** One overlay-free capture of the world host region. */
async function capture_world(page, host) {
  await page.evaluate(() => document.body.classList.add('__login_gold_iso'))
  try {
    return await host.screenshot({ animations: 'disabled' })
  } finally {
    await page.evaluate(() => document.body.classList.remove('__login_gold_iso'))
  }
}

/** The app's OWN readiness signal (D161/D205): the boot veil — a backdrop-blur div INSIDE the host — melts
 *  and self-removes when the world is honestly ready (spectate: first resident chunk; 10s cap otherwise).
 *  Sampling before it is gone measures the veil, not the world. */
const wait_veil_gone = (page, timeout) =>
  page.waitForFunction(
    () => {
      const host = document.querySelector('[data-testid="game-world-viewport"]')
      if (!host) return false
      return ![...host.querySelectorAll('div')].some((el) => (el.style.backdropFilter ?? '').includes('blur'))
    },
    null,
    { timeout }
  )

async function main() {
  mkdirSync(ART, { recursive: true })
  const server = await ensure_server()
  const browser = await chromium.launch({ headless: false })
  try {
    // Fresh context = a cold logged-out visitor (no stored Enoki session, no spectate opt-in).
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    // Honest-red channel: a swallowed world-boot failure must surface in the verdict, not vanish.
    const console_errors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') console_errors.push(msg.text().slice(0, 300))
    })
    await page.goto(`${ORIGIN}/`)
    await page.addStyleTag({ content: ISOLATE_CSS })

    // ── ORACLE 1 — the world canvas MOUNTS on the pre-auth login route ───────────────────────────
    const host = page.locator('[data-testid="game-world-viewport"]')
    const canvas = host.locator('canvas').first()
    let mounted = true
    try {
      await canvas.waitFor({ state: 'attached', timeout: 60_000 })
    } catch {
      mounted = false
    }
    check(
      'world canvas mounts pre-auth',
      mounted,
      mounted
        ? 'canvas attached in the viewport host'
        : 'NO canvas — the login page is world-less (the v30 P1 regression shape)'
    )
    if (!mounted) {
      writeFileSync(path.join(ART, 'login_no_world.png'), await page.screenshot())
      throw new Error('login backdrop gold: no world canvas on the logged-out landing')
    }

    // ── ORACLES 2+3 — wait out the app's OWN reveal (the D161 boot veil melts on first resident
    // chunk), then poll the overlay-free world frame to the floors. Sampling under the veil measures
    // blur, not world; the veil's 10s cap means a void world still gets judged — by its pixels.
    await wait_veil_gone(page, 60_000).catch(() => {
      console.log('login backdrop gold: boot veil still up after 60s — judging raw frames anyway')
    })
    const t0 = Date.now()
    let last = null
    let frame = null
    while (Date.now() - t0 < PRESENT_DEADLINE_MS) {
      frame = await capture_world(page, host)
      last = await analyze(page, frame, REGION)
      if (last.full.code === 0 && last.region.code === 0) break
      await sleep(POLL_MS)
    }
    writeFileSync(path.join(ART, 'login_backdrop.png'), frame)
    check(
      'frame is not degenerate',
      last?.full.code === 0,
      `flags=[${last?.full.flags}] metrics=${JSON.stringify(last?.full.metrics)}`
    )
    check(
      'terrain band shows real structure',
      last?.region.code === 0,
      `flags=[${last?.region.flags}] crop=${JSON.stringify(last?.region.crop)} metrics=${JSON.stringify(last?.region.metrics)}`
    )
    if (console_errors.length > 0)
      console.log(`login backdrop gold: ${console_errors.length} console error(s) — first: ${console_errors[0]}`)

    // ── ORACLE 4 — the glass login card floats OVER the live world (coexistence, the row's point) ─
    const card_up = await page
      .locator('.glass-panel')
      .first()
      .isVisible()
      .catch(() => false)
    check('glass login card is up over the world', card_up, card_up ? 'pre-auth surface present' : 'no login card')
    writeFileSync(path.join(ART, 'login_page_full.png'), await page.screenshot())
  } finally {
    await browser.close()
    server?.kill('SIGKILL')
  }
  const failed = verdicts.filter((v) => !v.ok)
  writeFileSync(path.join(ART, 'verdict.json'), JSON.stringify({ t: Date.now(), verdicts }, null, 2))
  console.log(`login backdrop gold: ${verdicts.length - failed.length}/${verdicts.length} pass · artifacts ${ART}`)
  if (failed.length > 0) process.exit(1)
}

main().catch((error) => {
  console.error('login backdrop gold: BLOCKED —', error)
  process.exit(2)
})
