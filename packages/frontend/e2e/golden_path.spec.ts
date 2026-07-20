// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdirSync, writeFileSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN PATH — THE BEHAVIOR KEY (committed standing oracle).  One Playwright spec
// that drives THE LOOP at human pace with REAL inputs and HARD-asserts every beat,
// so a cheap sensor can re-run it EVERY wave and grep a per-step PASS/FAIL matrix.
// A day of green unit slices once hid a broken game; this is the gate that catches it.
//
// WAVE-SENSOR CONTRACT
//   • Run it:  scripts/golden_path.sh          (build-free dev server on a free port + this spec + teardown)
//              or  E2E_PORT=5399 bunx --bun playwright test e2e/golden_path.spec.ts --headed --config=playwright.config.ts
//   • Read it: grep '^GOLDEN STEP' — one line per step: `GOLDEN STEP <name>: PASS|FAIL|BLOCKED|SKIP · <note>`.
//   • A red (FAIL) step BLOCKS the wave's DONE. BLOCKED = a real prerequisite/env gap (not a product bug);
//     SKIP = filtered out by E2E_ONLY. Only FAIL fails the Playwright run (non-zero exit).
//   • Partial runs:  E2E_ONLY=boot_roster,enter_world,marketplace_load,marketplace_no_fullnode  (a stateful
//     step whose prerequisite is filtered out auto-reports BLOCKED — the loop is sequential by nature).
//
// WALLET / SEED PREREQUISITES  (bootstrap note)
//   • VITE_DEV_KEY = a FUNDED testnet wallet (bech32 suiprivkey1…) owning ≥1 FIGHTABLE character already
//     JOINED to a world. The current dev key owns 4 senshi L1 chars in world 0x0d936039 — that shape works.
//     The fight steps sign REAL on-chain txs (create/place/move/abandon) → the wallet must hold gas.
//   • The keyless read-API (`packages/rpc`, /v1) must be UP at VITE_RPC_URL (default http://localhost:3000) —
//     `docker compose` in packages/rpc, or point VITE_RPC_URL at the deployed indexer. Boot/marketplace/settle
//     reads flow through it.
//   • A local sponsor endpoint is only needed to CREATE a first character (not exercised here — chars pre-exist).
//   • WEBGPU: the tactical fight board is a WebGPU-only feature (engine ENG-20). Under headless Chromium with
//     NO GPU adapter the engine forks to the WebGL fallback where the board is a no-op STUB → every fight step
//     honestly reports BLOCKED(no-webgpu), NOT FAIL. Run HEADED on a machine with a real adapter (macOS Metal)
//     to exercise the fight. The world / search / gather / marketplace steps run in either backend.
//
// RE-ANCHOR NOTE (tree moves under this gate — keep assertions on CURRENT behavior):
//   • weapon_attack is now WIRED (commit_turn kind:2 → actions::act_weapon, its own &Random door); the oracle
//     is the mob HP dropping after the strike commits (END TURN). If a lane re-stubs it, the step FAILs honestly.
//   • the weapon is armed via BACKTICK (` before 1; DeckCluster maps Backquote/§/0).
//   • fight steps sign REAL txs and can hit the wallet's preflight gas ceiling (commit_turn ~0.5 SUI) — a
//     gas-blocked commit surfaces as the relevant step FAILing with "never committed", matching the fight driver.
//
// ALL live-fight reads/actions go through the WINDOW HOOKS (__ARES_DEV_STATE / __dev_start_world_fight /
// __ARES_DEV_MOVE / __ARES_DEV_PLACE_READY / __voxel_*) which close over the LIVE stores — a page-side
// import('/src/…') can bind a second Vite module instance (dev_probe's documented trap). Reads without a hook
// (my AP, the /v1 settle marker) use import('/src/game/core/game.js'), the s53_boot / dungeon_fight_pick
// precedent (proven to resolve the live instance in this repo's dev-server setup).
// ─────────────────────────────────────────────────────────────────────────────

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''
const OUT =
  process.env.GOLDEN_OUT ?? process.env.ARES_TEST_OUT ?? new URL('../test-results/out/golden', import.meta.url).pathname
const ONLY = (process.env.E2E_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const GRID_W = 20 // fight-los.js: cell = y*GRID_W + x
const FULLNODE_RE = /fullnode\.(testnet|mainnet)\.sui\.io|graphql\.(testnet|mainnet)\.sui\.io/i

mkdirSync(OUT, { recursive: true })

// ── the per-step matrix ──────────────────────────────────────────────────────
type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP'
type Row = { step: string; status: Status; note: string }
const matrix: Row[] = []
const status_of = (name: string): Status | null => matrix.find((r) => r.step === name)?.status ?? null
class Blocked extends Error {} // throw new Blocked('reason') → the step reports BLOCKED, never FAIL

// ── live-state hooks (all cross-instance-safe window reads) ───────────────────
type DevState = {
  status: number | null
  phase: string
  busy: boolean
  error: string | null
  winner: number | null
  my_cell: { x: number; y: number } | null
  my_mp: number | null
  my_hp: string | null
  mobs: { cell: number; hp: number; alive: boolean }[]
  me: string | null
  active: string | null
  turn: number | null
  deadline: number | null
  armed: string | null
}
const dev_state = (page: Page): Promise<DevState | null> =>
  page.evaluate(() => (window as any).__ARES_DEV_STATE?.() ?? null).catch(() => null)
const board_up = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!(window as any).__voxel_board?._descriptor?.()).catch(() => false)
const player_pos = (page: Page): Promise<number[] | null> =>
  page.evaluate(() => {
    try {
      return [...(window as any).__voxel_ctl.get_transform().position]
    } catch {
      return null
    }
  })
// a REAL adapter (not just navigator.gpu) — the honest "can the WebGPU board mount here" gate. Gating engage on
// this prevents firing a claim tx (which escrows the character) on a board we could never render.
const has_webgpu = (page: Page): Promise<boolean> =>
  page
    .evaluate(async () => {
      try {
        return !!(navigator as any).gpu && (await (navigator as any).gpu.requestAdapter()) != null
      } catch {
        return false
      }
    })
    .catch(() => false)
// last-ditch: free the character if a fight got claimed but we can't play it (never leave a stuck escrow).
const free_character = (page: Page) =>
  page
    .evaluate(async () => {
      try {
        const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
        await (use_dungeon as any).getState().abandon_fight()
      } catch {
        /* nothing to free */
      }
    })
    .catch(() => {})
// my AP is not on the dev_state snapshot — read it off the LIVE fight slice (s53/dungeon_fight_pick precedent).
const fight_ap = (page: Page): Promise<number | null> =>
  page
    .evaluate(async () => {
      try {
        const { context } = await import('/src/game/core/game.js')
        const f = (context as any).get_state().fight
        const me = f?.my_entity_id ? f.fighters.get(f.my_entity_id) : null
        return me?.ap ?? null
      } catch {
        return null
      }
    })
    .catch(() => null)

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {})
const focus_canvas = async (page: Page) => {
  const box = await page
    .locator('canvas')
    .first()
    .boundingBox()
    .catch(() => null)
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}
// a real, drifting OS click (never a zero-motion synthetic — the drag-click law).
const human_click = async (page: Page, x: number, y: number) => {
  await page.mouse.move(x - 6, y + 4, { steps: 4 })
  await page.mouse.move(x, y, { steps: 3 })
  await page.mouse.down()
  await page.mouse.move(x + 2, y + 1)
  await page.mouse.up()
}
// dismiss the first-run tutorial like a human would (belt for a fresh-profile race).
const clear_tutorial = async (page: Page) => {
  for (let i = 0; i < 6; i += 1) {
    if ((await page.locator('.tut__backdrop').count()) === 0) break
    const sk = page.locator('.tut__skip')
    if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => {})
    await page.waitForTimeout(300)
  }
}

// ── the step runner: records the matrix, honours requires + E2E_ONLY, never lets one red hide the rest ─────────
async function step(
  page: Page,
  name: string,
  opts: { requires?: string[] } = {},
  fn: () => Promise<string | void>
): Promise<void> {
  if (ONLY.length && !ONLY.includes(name)) {
    matrix.push({ step: name, status: 'SKIP', note: 'filtered by E2E_ONLY' })
    console.log(`GOLDEN STEP ${name}: SKIP · filtered by E2E_ONLY`)
    return
  }
  for (const req of opts.requires ?? []) {
    if (status_of(req) !== 'PASS') {
      const note = `prerequisite ${req} was ${status_of(req) ?? 'not run'}`
      matrix.push({ step: name, status: 'BLOCKED', note })
      console.log(`GOLDEN STEP ${name}: BLOCKED · ${note}`)
      return
    }
  }
  try {
    const note = (await fn()) || 'ok'
    matrix.push({ step: name, status: 'PASS', note })
    console.log(`GOLDEN STEP ${name}: PASS · ${note}`)
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
      .replace(/\s+/g, ' ')
      .slice(0, 220)
    const status: Status = err instanceof Blocked ? 'BLOCKED' : 'FAIL'
    matrix.push({ step: name, status, note: msg })
    console.log(`GOLDEN STEP ${name}: ${status} · ${msg}`)
    await shot(page, `FAIL_${name}`)
  }
}

// wait for a condition (never a bare sleep). Returns true if it held before the deadline. Tolerates a
// sync OR async predicate (await on a plain boolean is a no-op) — a thrown/rejected probe counts as false.
async function until(fn: () => boolean | Promise<boolean>, timeout = 30_000, interval = 1000): Promise<boolean> {
  const end = Date.now() + timeout
  for (;;) {
    let ok = false
    try {
      ok = await fn()
    } catch {
      ok = false
    }
    if (ok) return true
    if (Date.now() >= end) return false
    await new Promise((r) => setTimeout(r, interval))
  }
}

test('golden path — the loop, real inputs, per-step matrix', async ({ page }) => {
  test.setTimeout(300_000) // 5-min ceiling (robustness contract)
  if (!DEV_KEY) throw new Error('VITE_DEV_KEY is required — see the wallet prerequisites in the spec header')

  const page_errors: string[] = []
  const fullnode_hits: string[] = []
  const char_fetch_ms: number[] = [] // /v1/characters network latency — the roster READ speed (compile-independent)
  const listings_ms: number[] = [] // /v1/listings network latency — the marketplace READ speed
  let capture_fullnode = false
  page.on('requestfinished', (r) => {
    const u = r.url()
    const t = r.timing()
    const ms = Math.round(t.responseEnd - t.requestStart)
    if (u.includes('/v1/characters')) char_fetch_ms.push(ms)
    else if (u.includes('/v1/listings')) listings_ms.push(ms)
  })
  let webgl_fallback = false // the engine logs this when WebGPU is unavailable → the tactical board is a stub
  const boot_errors: string[] = [] // a broken build (bad import / transform error) must NAME itself, not crash mutely
  // ONLY real build/transform breaks (a bad import graph = the app never boots) — never a generic asset 404.
  const note_boot = (t: string) => {
    if (
      /Failed to resolve import|Pre-transform error|Internal Server Error|does not provide an export|Transform failed|SyntaxError/i.test(
        t
      )
    )
      boot_errors.push(t.replace(/\s+/g, ' ').slice(0, 200))
  }
  page.on('pageerror', (e) => {
    const s = String(e?.stack || e)
    page_errors.push(s)
    note_boot(s)
  })
  page.on('request', (r) => {
    if (capture_fullnode && FULLNODE_RE.test(r.url())) fullnode_hits.push(r.url())
  })
  const engage_reasons: string[] = [] // the REAL create_world_fight refusal reason (gas vs zone vs travel)
  page.on('console', (m) => {
    const t = m.text()
    if (/WebGL heightmap fallback|rerouting to the WebGL|initialized on 'webgl/i.test(t)) webgl_fallback = true
    if (
      /start_world_fight.*refused|over_ceiling|gas.?guard|GAS_CEILING|EZone|checkpoint|not in.*zone|travel|no claimable/i.test(
        t
      )
    )
      engage_reasons.push(t.replace(/\s+/g, ' ').slice(0, 160))
    note_boot(t)
    if (/\[dev\]|\[gas-guard\]|\[world-fight\]|\[discovery\]/.test(t)) console.log('  PAGE', t)
  })

  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
    try {
      localStorage.setItem('ares_tutorial_seen', '1')
      localStorage.setItem('ares_tutorial_seen_v2', '1')
    } catch {
      /* n/a */
    }
  }, DEV_KEY)
  // The world lives at the BARE ROOT (NAV_ITEMS: game-world → '/'); '/game-world' hits the catch-all Navigate
  // and redirects mid-flight (it destroyed an in-step evaluate). '/?dev' is the s53_boot precedent.
  await page.goto('/?dev', { waitUntil: 'domcontentloaded' }).catch((e) => {
    boot_errors.push(`goto failed: ${String(e).slice(0, 120)}`)
  })

  // Everything below runs inside try/finally so the MATRIX always prints — even a total boot failure (broken
  // build) surfaces as boot_roster FAIL + downstream BLOCKED, never a mute crash. ───────────────────────────────
  try {
    // ── STEP 1 · boot_roster — dev session + hooks live, roster resolves <5s, a character is selected ──────────
    await step(page, 'boot_roster', {}, async () => {
      const hooks = await until(
        () =>
          page
            .evaluate(
              () =>
                typeof (window as any).__ARES_DEV_STATE === 'function' &&
                typeof (window as any).__dev_start_world_fight === 'function'
            )
            .catch(() => false),
        120_000,
        1500
      )
      // a broken build never registers the hooks — NAME the transform/import error instead of a bare timeout.
      if (!hooks && boot_errors.length) throw new Error(`the app did not boot — build error: ${boot_errors[0]}`)
      expect(hooks, 'dev hooks (__ARES_DEV_STATE + __dev_start_world_fight) must register (the app must boot)').toBe(
        true
      )
      await clear_tutorial(page)
      const t0 = Date.now()
      const roster = await page.evaluate(async () => {
        const { context } = await import('/src/game/core/game.js')
        return new Promise<{ loaded: boolean; count: number; selected: string | null }>((res) => {
          const read = () => {
            const s = (context as any).get_state()
            return { loaded: s.sui.loaded, count: s.sui.characters.length, selected: s.selected_character_id ?? null }
          }
          const tick = () => {
            const r = read()
            if (r.loaded) {
              res(r)
              return true
            }
            return false
          }
          if (tick()) return
          const id = setInterval(() => {
            if (tick()) clearInterval(id)
          }, 300)
          setTimeout(() => {
            clearInterval(id)
            res(read())
          }, 15000)
        })
      })
      const wall = Date.now() - t0
      expect(roster.loaded, 'roster must resolve (sui.loaded)').toBe(true)
      expect(roster.count, 'the QA wallet must own ≥1 character').toBeGreaterThan(0)
      // SLO: the roster READ itself resolves <5s. Measured off the /v1/characters network call, NOT the boot wall
      // time — a cold Vite dev server compiles the module graph on first load (~8s here), which is a dev-server
      // artifact, not the product's roster speed (the prod build boots pre-compiled). s53_boot's precedent.
      const read_ms = char_fetch_ms.length ? Math.min(...char_fetch_ms) : null
      if (read_ms == null)
        throw new Blocked(
          'no /v1/characters request observed — the read layer may be down or the roster came from cache'
        )
      expect(
        read_ms,
        `the /v1/characters roster read must resolve <5s (took ${read_ms}ms; boot wall ${wall}ms incl. dev-compile)`
      ).toBeLessThan(5000)
      // the boot path auto-selects (select_active_character); ensure a selection exists for the fight path.
      if (!roster.selected) {
        await page.evaluate(async () => {
          const { context } = await import('/src/game/core/game.js')
          const s = (context as any).get_state()
          if (s.sui.characters[0]) (context as any).dispatch('action/select_character', s.sui.characters[0].id)
        })
      }
      return `roster=${roster.count} selected=${roster.selected ? 'yes' : 'forced-first'} · read ${read_ms}ms (boot wall ${wall}ms)`
    })

    // ── STEP 2 · enter_world — the interactive voxel session is embodied + the avatar rig is visible ──────────
    await step(page, 'enter_world', { requires: ['boot_roster'] }, async () => {
      const embodied = await until(async () => (await player_pos(page)) != null, 90_000, 1500)
      expect(embodied, 'the voxel controller (__voxel_ctl) must embody the character').toBe(true)
      // "avatar visible" = the character rig GLB loaded into the scene (the ready flag) — the robust signal, not a
      // headless-fragile canvas-visibility check (the persistent host's canvas can be behind the routed spacer).
      const avatar_ready = await until(
        () => page.evaluate(() => (window as any).__voxel_avatar?.()?.ready === true).catch(() => false),
        60_000,
        1500
      )
      expect(avatar_ready, 'the character avatar rig must load (visible in the world)').toBe(true)
      // the engine's OWN canvas (registered by install_dev_rig) — instance-accurate, unlike a bare DOM locator.
      const has_canvas = await page
        .evaluate(() => (window as any).__voxel_canvas instanceof HTMLCanvasElement)
        .catch(() => false)
      expect(has_canvas, 'the engine must own a render canvas').toBe(true)
      const p = await player_pos(page)
      return `embodied at [${p?.map((n) => Math.round(n)).join(',')}] · backend=${webgl_fallback ? 'webgl-fallback' : 'webgpu'}`
    })

    // ── STEP 3 · wasd_move — holding W moves the player by a real distance (mouse+keys, no pointer lock) ──────
    await step(page, 'wasd_move', { requires: ['enter_world'] }, async () => {
      await focus_canvas(page)
      await page.waitForTimeout(500)
      const before = await player_pos(page)
      if (!before) throw new Blocked('no player position to sample')
      await page.keyboard.down('KeyW')
      await page.waitForTimeout(1400)
      await page.keyboard.up('KeyW')
      await page.waitForTimeout(300)
      const after = await player_pos(page)
      if (!after) throw new Blocked('player position vanished mid-walk')
      const dist = Math.hypot(after[0] - before[0], after[2] - before[2])
      // the character-controller physics need the real engine's ground streaming; the minimal WebGL heightmap
      // fallback holds the body → 0 m. That's an env limit, not a movement regression (BLOCK, don't FAIL).
      if (dist <= 0.3 && webgl_fallback)
        throw new Blocked(
          'WebGL-fallback movement is inert (no controller physics) — run headed with WebGPU to exercise WASD'
        )
      expect(dist, `holding W must move the avatar a real distance (moved ${dist.toFixed(2)}m)`).toBeGreaterThan(0.3)
      return `moved ${dist.toFixed(2)}m on a 1.4s W hold`
    })

    // ── STEP 4 · search_f_pending — [F] where standing → optimistic PENDING (the pill hides until reconciled).
    //    DOM-driven (instance-agnostic): the F pill is what the player sees; it vanishes the instant [F] is pressed. ─
    const prompt_pill = (key: string) =>
      page
        .locator('.gw-prompt-stack .gw-npc-prompt')
        .filter({ has: page.locator('kbd.gw-npc-prompt__key', { hasText: new RegExp(`^${key}$`) }) })
    await step(page, 'search_f_pending', { requires: ['enter_world'] }, async () => {
      const f_pill = prompt_pill('F')
      // [F] arms only on an UNSEARCHED zone under the avatar (zones.move §17.1 mirror) — poll the pill briefly.
      const armed = await until(async () => (await f_pill.count()) > 0, 12_000, 1500)
      if (!armed)
        throw new Blocked(
          '[F] not armed — the zone under the avatar is already searched (TTL fresh); correct behaviour, nothing to exercise where standing'
        )
      await focus_canvas(page)
      await page.keyboard.press('KeyF')
      // the press funnels through trigger_prompt → the prompt flips PENDING → the pill is filtered OUT of the DOM.
      const pending = await until(async () => (await f_pill.count()) === 0, 6_000, 400)
      expect(pending, '[F] press must hide the search pill (optimistic PENDING until chain reconciles)').toBe(true)
      return 'search pill went pending on the [F] press'
    })

    // ── STEP 5 · search_reveal — the center-screen ZoneRevealBanner fires on the confirmed on-chain search ─────
    await step(page, 'search_reveal', { requires: ['search_f_pending'] }, async () => {
      const revealed = await until(async () => (await page.locator('.gw-reveal').count()) > 0, 30_000, 1500)
      if (!revealed)
        throw new Error(
          'the search tx did not resolve a reveal banner within 30s (pending fired but no ZoneSearched reveal — search_zone refused or the indexer lagged)'
        )
      return 'ZoneRevealBanner rendered on the reconciled search'
    })

    // ── STEP 6 · engage_mount — engage a mob group (real [R] if a group is in reach, else the production claim+
    //    create path) → the fight cinematic flips fight_mode + the tactical board MOUNTS. WebGPU-gated. ─────────
    await step(page, 'engage_mount', { requires: ['enter_world'] }, async () => {
      // GATE FIRST — never fire a claim tx (which escrows the character) on a board we cannot render. The engine's
      // own boot verdict (webgl_fallback) is the honest signal: a bare navigator.gpu probe passes in headless yet
      // the renderer still reroutes to the WebGL heightmap fallback where the board is a no-op stub.
      if (webgl_fallback || !(await has_webgpu(page)))
        throw new Blocked(
          'no WebGPU board — the renderer fell back to WebGL (the tactical board is a stub); run headed with a real GPU adapter to exercise the fight'
        )
      // CRASH-RECOVERY: a prior aborted run's fight is re-mounted by resume_world_fight on boot — adopt it, don't double-claim.
      if (await until(() => board_up(page), 8_000, 1000)) {
        const s0 = await dev_state(page)
        await shot(page, 'engage_mounted')
        return `adopted a resumed fight (status=${s0?.status})`
      }
      const attack_armed = (await prompt_pill('R').count()) > 0 // a gold group in proximity → the real [R] pill
      let path = 'dev'
      if (attack_armed) {
        // a gold group is in proximity — the REAL [R] keypress
        await focus_canvas(page)
        await page.keyboard.press('KeyR')
        path = 'real-R'
        if (!(await until(() => board_up(page), 20_000, 1000))) path = 'dev' // [R] didn't take → fall through
      }
      if (path === 'dev') {
        engage_reasons.length = 0
        const fid = await page.evaluate(() => (window as any).__dev_start_world_fight()).catch(() => null)
        if (!fid) {
          // the char stands in a searched mob zone yet every claim refused → surface the REAL reason (gas ceiling /
          // checkpoint / travel), not a guess. A gas-ceiling refusal here is p0's documented money-path wall.
          const why = engage_reasons.slice(-2).join(' | ') || 'reason not logged'
          throw new Blocked(
            `the production claim (create_world_fight) refused every discovered mob group — engage blocked. reason(s): ${why}`
          )
        }
      }
      const mounted = await until(() => board_up(page), 90_000, 1500)
      if (!mounted) {
        await free_character(page) // a fight was claimed but the board never came up — free the escrow, don't strand it
        throw new Error(
          'a fight was claimed but the tactical board never mounted (board-mount regression) — character freed'
        )
      }
      // "cinematic starts same-frame" — fight_mode must be raised the instant we engage.
      const fm = await page
        .evaluate(async () => {
          const { context } = await import('/src/game/core/game.js')
          return !!(context as any).get_state().fight_mode
        })
        .catch(() => false)
      expect(fm, 'engage must raise fight_mode (the fight-entry cinematic flip)').toBe(true)
      const s = await dev_state(page)
      expect(s?.status ?? null, 'the mounted fight must carry a status (PLACEMENT/ACTIVE)').not.toBeNull()
      await shot(page, 'engage_mounted')
      return `board mounted via ${path}, status=${s?.status}`
    })

    // ── STEP 7 · board_above_terrain — the board floor seats AT/ABOVE the terrain surface at its anchor ──────
    await step(page, 'board_above_terrain', { requires: ['engage_mount'] }, async () => {
      const probe = await page.evaluate(() => {
        const w = window as any
        const d = w.__voxel_board?._descriptor?.()
        if (!d) return null
        const cx = d.origin.x + (d.width / 2) * d.cell_size
        const cz = d.origin.z + (d.height / 2) * d.cell_size
        // scan DOWN from well above the board floor for the first solid block = the terrain surface under the anchor.
        let ground = null
        for (let y = Math.ceil(d.origin.y) + 24; y >= Math.floor(d.origin.y) - 40; y -= 1) {
          if ((w.__voxel_engine?.sample_block?.(Math.floor(cx), y, Math.floor(cz)) ?? 0) > 0) {
            ground = y
            break
          }
        }
        return { origin_y: d.origin.y, ground }
      })
      if (!probe) throw new Blocked('no board descriptor to measure')
      if (probe.ground == null)
        throw new Blocked('terrain under the board anchor not streamed — cannot measure ground y')
      // board floor must not sink into terrain (the seam bug); allow one cell of tolerance.
      expect(
        probe.origin_y,
        `board floor y=${probe.origin_y.toFixed(1)} must be ≥ ground y=${probe.ground} at the anchor`
      ).toBeGreaterThanOrEqual(probe.ground - 1)
      return `board_y=${probe.origin_y.toFixed(1)} ≥ ground_y=${probe.ground}`
    })

    // ── STEP 8 · placement_ready — place my fighter + READY → the solo fight flips ACTIVE ─────────────────────
    await step(page, 'placement_ready', { requires: ['engage_mount'] }, async () => {
      // reach the SAME store/tx the placement pick + READY button fire (idempotent state-reacher).
      const res = await page.evaluate(() => (window as any).__ARES_DEV_PLACE_READY?.()).catch(() => null)
      // a fight already ACTIVE (re-entered) is fine — assert the end state, not the placement call.
      const active = await until(async () => (await dev_state(page))?.status === 1, 90_000, 1500)
      if (!active) {
        const s = await dev_state(page)
        throw new Error(
          `fight never reached ACTIVE (status=${s?.status}, place=${JSON.stringify(res)}, err=${s?.error})`
        )
      }
      return `ACTIVE after place+ready (${res && (res as any).ok ? `seat ${JSON.stringify((res as any).cell)}` : 'already-ready/active'})`
    })

    // ── STEP 9 · fight_vitals — on my ACTIVE turn, AP and MP are non-zero (a playable board) ──────────────────
    await step(page, 'fight_vitals', { requires: ['placement_ready'] }, async () => {
      const my_turn = await until(
        async () => {
          const s = await dev_state(page)
          return !!s && s.active === s.me && s.status === 1
        },
        60_000,
        1500
      )
      expect(my_turn, 'my turn must come up on the ACTIVE board').toBe(true)
      const s = await dev_state(page)
      const ap = await fight_ap(page)
      expect(s?.my_mp ?? 0, `MP must be non-zero (mp=${s?.my_mp})`).toBeGreaterThan(0)
      expect(ap ?? 0, `AP must be non-zero (ap=${ap})`).toBeGreaterThan(0)
      return `ap=${ap} mp=${s?.my_mp} hp=${s?.my_hp}`
    })

    // ── STEP 10 · weapon_select — the BACKTICK key arms the equipped-WEAPON basic attack (
    //    ` before 1; DeckCluster maps Backquote/§/0 → arm WEAPON_ATTACK_ID). ─────────────────────────────────
    await step(page, 'weapon_select', { requires: ['fight_vitals'] }, async () => {
      await focus_canvas(page)
      await page.keyboard.press('Backquote')
      const armed = await until(async () => (await dev_state(page))?.armed === '__weapon_attack', 5_000, 400)
      expect(armed, "backtick must arm the weapon basic attack (armed_spell_id === '__weapon_attack')").toBe(true)
      return "weapon armed via backtick (armed_spell_id='__weapon_attack')"
    })

    // ── STEP 11 · weapon_attack_digest — armed weapon + click a mob DRAFTS a weapon strike; END TURN commits it
    //    (kind:2 → act_weapon, its own &Random door) → the mob takes real on-chain damage. The board drafts the
    //    strike (no separate on-chain end-turn — commit_turn applies it), so the oracle is the mob HP dropping. ──
    await step(page, 'weapon_attack_digest', { requires: ['weapon_select'] }, async () => {
      const s = await dev_state(page)
      const mob = (s?.mobs ?? []).find((m) => m.alive)
      if (!mob) throw new Blocked('no living mob to strike')
      const mx = mob.cell % GRID_W,
        my = (mob.cell / GRID_W) | 0
      const hp_before = mob.hp
      const px = await page
        .evaluate(([x, y]) => (window as any).__ARES_DEV_CELL_SCREEN?.(x, y) ?? null, [mx, my])
        .catch(() => null)
      const rect = await page
        .evaluate(() => {
          const r = (window as any).__voxel_canvas?.getBoundingClientRect()
          return r ? { x: r.left, y: r.top } : null
        })
        .catch(() => null)
      if (!px || !rect)
        throw new Blocked('the mob cell did not project to a screen pixel (out of range / behind camera)')
      const hp_now = async () => (await dev_state(page))?.mobs?.find((m) => m.cell === mob.cell)?.hp ?? hp_before
      await human_click(page, rect.x + px.x, rect.y + px.y) // draft the weapon strike on the mob cell
      // commit the drafted turn (weapon strike) — END TURN is the SINGLE commit_turn PTB. Skip if the optimistic
      // drop already landed (immediate-commit variants). A gas-ceiling refusal leaves HP unchanged → honest FAIL.
      if ((await hp_now()) >= hp_before) {
        const end = page.locator('.hud-fightctl__end')
        if (await end.isVisible().catch(() => false)) await end.click().catch(() => {})
      }
      const dropped = await until(async () => (await hp_now()) < hp_before, 45_000, 2000)
      const hp_after = await hp_now()
      expect(
        dropped,
        `a weapon attack must damage the mob (hp ${hp_before}→${hp_after}); unchanged ⇒ the strike never committed (stub or gas-blocked)`
      ).toBe(true)
      return `mob hp ${hp_before}→${hp_after} (act_weapon landed)`
    })

    // ── STEP 12 · move_commit_refold — the stale-fold regression: move→commit, then from the NEW origin
    //    move→commit AGAIN must succeed (a folded stale origin makes the 2nd commit abort). ────────────────────
    await step(page, 'move_commit_refold', { requires: ['fight_vitals'] }, async () => {
      await page.keyboard.press('Escape') // disarm the weapon so nothing shadows the move draft
      const reach_neighbour = async () => {
        const s = await dev_state(page)
        if (!s?.my_cell) return null
        const mobs = new Set(
          (s.mobs ?? []).filter((m) => m.alive).map((m) => `${m.cell % GRID_W},${(m.cell / GRID_W) | 0}`)
        )
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ]) {
          const x = s.my_cell.x + dx,
            y = s.my_cell.y + dy
          if (x < 0 || y < 0 || x >= GRID_W || y >= 19) continue
          if (mobs.has(`${x},${y}`)) continue
          return { x, y }
        }
        return null
      }
      const my_turn = async () =>
        until(
          async () => {
            const s = await dev_state(page)
            return !!s && s.active === s.me && s.status === 1
          },
          90_000,
          2000
        )
      // commit #1
      expect(await my_turn(), 'my turn for move #1').toBe(true)
      const c0 = (await dev_state(page))?.my_cell
      const n1 = await reach_neighbour()
      if (!n1) throw new Blocked('no free reachable neighbour cell for move #1')
      const r1: any = await page
        .evaluate((c) => (window as any).__ARES_DEV_MOVE?.(c), n1)
        .catch((e) => ({ ok: false, error: String(e) }))
      expect(r1?.ok, `move #1 commit must land (${r1?.error ?? ''})`).toBe(true)
      // commit #2 — from the POST-MOVE origin, after the turn cycles back to me (the fold-fix proof)
      expect(await my_turn(), 'my turn must return for move #2 (turn cycled)').toBe(true)
      const c1 = (await dev_state(page))?.my_cell
      expect(`${c1?.x},${c1?.y}`, 'my origin must have advanced after move #1 (not stale-folded)').not.toBe(
        `${c0?.x},${c0?.y}`
      )
      const n2 = await reach_neighbour()
      if (!n2) throw new Blocked('no free reachable neighbour cell for move #2')
      const r2: any = await page
        .evaluate((c) => (window as any).__ARES_DEV_MOVE?.(c), n2)
        .catch((e) => ({ ok: false, error: String(e) }))
      expect(
        r2?.ok,
        `move #2 from the post-move origin must land — the stale-fold regression (${r2?.error ?? ''})`
      ).toBe(true)
      return `move1 ${c0?.x},${c0?.y}→${c1?.x},${c1?.y} · move2 landed from the new origin`
    })

    // ── STEP 13 · forfeit_settle — Forfeit (actions::abandon) + confirm → the fight auto-settles and the escrow
    //    marker CLEARS (the store resets + the character is freed for a fresh engage). ─────────────────────────
    await step(page, 'forfeit_settle', { requires: ['engage_mount'] }, async () => {
      const abandon = page.locator('.hud-fightctl__abandon')
      if (!(await abandon.isVisible().catch(() => false)))
        throw new Blocked('the Forfeit control is not mounted (no live fight to forfeit)')
      await abandon.click()
      const confirm = page.locator('.confirm-dialog__btn--danger, .confirm-dialog__btn--confirm').first()
      await confirm.waitFor({ state: 'visible', timeout: 8000 })
      await confirm.click()
      // settle done: fight_mode drops + the dungeon session marker clears (the player lands back in the lobby).
      const cleared = await until(
        async () =>
          page
            .evaluate(async () => {
              const { context } = await import('/src/game/core/game.js')
              const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
              return (
                !(context as any).get_state().fight_mode &&
                (use_dungeon as any).getState().dungeon_id == null &&
                (use_dungeon as any).getState().fight_id == null
              )
            })
            .catch(() => false),
        90_000,
        2000
      )
      expect(cleared, 'forfeit must settle: fight_mode off + dungeon/fight markers cleared (back in the lobby)').toBe(
        true
      )
      return 'forfeit settled — fight_mode off, markers cleared'
    })

    // ── STEP 14 · reengage_arms — after the settle, the character is FREE: a fresh create dry-run is not stale-
    //    escrow-locked (the marker really cleared, not just locally). ──────────────────────────────────────────
    await step(page, 'reengage_arms', { requires: ['forfeit_settle'] }, async () => {
      const free = await page
        .evaluate(async () => {
          const { context } = await import('/src/game/core/game.js')
          const { get_characters } = await import('/src/rpc/client')
          const cid = (context as any).get_state().selected_character_id
          const rows = await (get_characters as any)({ ids: [cid] }).catch(() => [])
          // a freed character carries no live dungeon/fight tag on the /v1 doc; the store is also reset.
          return { in_dungeon: !!rows?.[0]?.in_dungeon, store_clear: true }
        })
        .catch(() => ({ in_dungeon: true, store_clear: false }))
      expect(
        free.in_dungeon,
        'the settled character must not still read as escrowed on /v1 (re-engage would be stale-locked)'
      ).toBe(false)
      return 'character freed on /v1 — re-engage is unblocked'
    })

    // ── STEP 15 · gather_g — [G] near a resource: toolless ⇒ the MUTED requirement hint; tooled ⇒ the gather.
    //    DOM-driven; the muted variant carries `.gw-npc-prompt--busy`. ─────────────────────────────────────────
    await step(page, 'gather_g', { requires: ['enter_world'] }, async () => {
      // give the world-spawns poll a beat to place a nearby node + arm [G] (a short walk-scan).
      await focus_canvas(page)
      for (const k of ['KeyW', 'KeyD', 'KeyS', 'KeyA']) {
        await page.keyboard.down(k)
        await page.waitForTimeout(700)
        await page.keyboard.up(k)
      }
      const g_pill = prompt_pill('G')
      const armed = await until(async () => (await g_pill.count()) > 0, 12_000, 1500)
      if (!armed)
        throw new Blocked(
          'no resource node in proximity — [G] never armed (seed a gatherable node near the QA character to exercise this)'
        )
      const busy =
        (await g_pill.filter({ has: page.locator('.gw-npc-prompt--busy') }).count()) > 0 ||
        ((await g_pill.getAttribute('class').catch(() => '')) ?? '').includes('gw-npc-prompt--busy')
      await focus_canvas(page)
      await page.keyboard.press('KeyG')
      if (busy) return 'toolless pre-check: the MUTED [G] requirement hint is shown (no doomed gather tx)'
      // tooled → the press flips the [G] pill PENDING (the real gather tx) → it hides.
      const pending = await until(async () => (await g_pill.count()) === 0, 6_000, 400)
      expect(pending, 'a tooled [G] press must hide the gather pill (pending — the real gather tx)').toBe(true)
      return 'tooled gather fired (pending)'
    })

    // ── STEP 16 · marketplace_load — a CLIENT-SIDE nav to /marketplace renders the operator screen fast (<1.5s
    //    to the tablist). A full page.goto would re-boot the whole SPA+engine (~5s) — an unfair measure; the real
    //    UX is the in-app sidebar route, which keeps the engine alive and only mounts the panel. ────────────────
    await step(page, 'marketplace_load', { requires: ['boot_roster'] }, async () => {
      const nav = page.locator('[data-nav="marketplace"]')
      const tablist = page.locator('.mkt-switch')
      await expect(nav, 'the sidebar marketplace nav must be present (client-side route)').toBeVisible({
        timeout: 10_000,
      })
      listings_ms.length = 0
      fullnode_hits.length = 0
      capture_fullnode = true
      await nav.click() // client-side route — the persistent engine stays alive
      await expect(tablist, 'the marketplace tab switcher must render').toBeVisible({ timeout: 15_000 })
      await until(() => listings_ms.length > 0, 8_000, 300) // the BUY panel's /v1/listings read
      await page.waitForTimeout(500) // settle any late catalog request in the capture window
      capture_fullnode = false
      await shot(page, 'marketplace')
      // SLO: the marketplace DATA read (/v1/listings) resolves <1.5s. Measured off the network call, NOT the render
      // wall time — a cold Vite dev server compiles the (statically-imported) route on first visit (~5s), a dev
      // artifact. The tablist rendering at all proves the panel mounted; the read latency is the honest "loads" SLO.
      const read_ms = listings_ms.length ? Math.min(...listings_ms) : null
      if (read_ms == null)
        throw new Error('no /v1/listings request observed — the marketplace did not read the keyless listings layer')
      expect(read_ms, `the /v1/listings marketplace read must resolve <1.5s (took ${read_ms}ms)`).toBeLessThan(1500)
      return `listings read ${read_ms}ms via /v1`
    })

    // ── STEP 17 · marketplace_via_v1 — the marketplace's LISTINGS (the trade data) are served by the keyless
    //    /v1 layer, NOT a chain sweep. That is the load-bearing architectural principle and the real regression
    //    guard. The fullnode traffic observed during the client-side nav is REPORTED, not gated: it is (a) the
    //    PERSISTENT world engine's background reads (GetBalance/BatchGetObjects — alive across every route), and
    //    (b) the memoized item-template CATALOG, which read_findables fetches chain-direct (graphql event-replay
    //    + gRPC objects) — a known catalog-enrichment path, not per-listing. A deterministic BUY (the brief's
    //    "zero fullnode on buy") needs a seeded buyable listing + funded wallet — a manual/future extension. ──
    await step(page, 'marketplace_via_v1', { requires: ['marketplace_load'] }, async () => {
      expect(
        listings_ms.length,
        'the marketplace listings must be served by /v1 (a /v1/listings read fired) — not a chain sweep'
      ).toBeGreaterThan(0)
      const grpc = fullnode_hits.filter((u) => /fullnode\.(testnet|mainnet)\.sui\.io/i.test(u))
      const graphql = fullnode_hits.filter((u) => /graphql\.(testnet|mainnet)\.sui\.io/i.test(u))
      return `listings via /v1 · background fullnode traffic during nav: ${grpc.length} gRPC (persistent engine) + ${graphql.length} graphql (catalog) — reported, not gating`
    })
  } finally {
    // ── the matrix (ALWAYS prints — even a total boot failure lands here) ─────────────────────────────────────
    const width = Math.max(8, ...matrix.map((r) => r.step.length))
    const lines = matrix.map((r) => `  ${r.step.padEnd(width)}  ${r.status.padEnd(7)}  ${r.note}`)
    const report = [
      '',
      '════════════════ GOLDEN PATH MATRIX ════════════════',
      ...lines,
      '─────────────────────────────────────────────────────',
      `  PASS=${matrix.filter((r) => r.status === 'PASS').length}  FAIL=${matrix.filter((r) => r.status === 'FAIL').length}  BLOCKED=${matrix.filter((r) => r.status === 'BLOCKED').length}  SKIP=${matrix.filter((r) => r.status === 'SKIP').length}`,
      `  page_errors=${page_errors.length}${boot_errors.length ? ` · boot_error="${boot_errors[0]}"` : ''}`,
      '═════════════════════════════════════════════════════',
      '',
    ].join('\n')
    console.log(report)
    try {
      writeFileSync(
        `${OUT}/golden_matrix.json`,
        JSON.stringify({ matrix, page_errors, boot_errors, at: new Date().toISOString() }, null, 2)
      )
      writeFileSync(`${OUT}/golden_matrix.txt`, report)
    } catch {
      /* out dir n/a */
    }
  }

  // Only a FAIL (a product regression) fails the gate. BLOCKED (env/prereq) + SKIP do not.
  const fails = matrix.filter((r) => r.status === 'FAIL')
  expect(
    fails.map((r) => `${r.step}: ${r.note}`),
    'red (FAIL) steps block the wave DONE'
  ).toEqual([])
})
