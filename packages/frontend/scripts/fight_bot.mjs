// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE SCRIPTED FIGHT BOT (#1100) — the committed rig that plays a fight end to end and asserts as it plays.
//
// Ruling it implements: fights are driven by a BOT, never by an agent clicking one cell at a time. Manual
// driving cost hours per verification bar; this is `node scripts/fight_bot.mjs`, headless, repeatable, and
// every future fight verification is a run of this file.
//
// THREE LAYERS, ON PURPOSE — the honesty of the result depends on the split:
//   (a) SEAM CLIENT (below) — a thin wrapper over the DEV window seams. It transports; it never decides.
//   (b) POLICY (@aresrpg/fight/bot, pure, unit-tested headless in packages/fight/test/bot) — state → the
//       next turn. No browser anywhere near it, so its behaviour is proven by fixtures, not by a run.
//   (c) RUNNER (this file's tail) — boots the page, loops turns, and writes the machine-readable sheet.
//
// WHAT IT PROVES. Every action carries the delta it expects; after the commit the assertions read the
// COMMITTED fold and compare. A cast that reports success without its damage, a push that "landed" without
// moving anyone, an AP spend that never happened — each is a FAIL row in the sheet, never a warning.
//
// SURFACE: the SIMULATOR (`/simulator`) — the local sim chain, deterministic, no transaction, no gas. The
// seams it drives are registered identically on the world HUD (game/dev/dev_bot_seam.js is one module,
// registered by both surfaces), so the world scenario is a base-URL and a fight-entry change, not a rewrite.
//
// Usage:
//   node scripts/fight_bot.mjs                       # the default scenario, headless
//   FIGHT_BOT_PORT=4401 FIGHT_BOT_CLASS=senshi node scripts/fight_bot.mjs
//   FIGHT_BOT_HEADED=1 node scripts/fight_bot.mjs    # watch it play
// Exit code 0 = every assertion passed AND the fight reached a terminal; 1 = anything else.

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { assert_traps_sprung, assert_turn, plan_turn, summarise } from '@aresrpg/fight/bot'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(HERE, '..')
const REPO = resolve(FRONTEND, '../..')

// 4400 family — 5173 (the owner's dev server) and 9528 are untouchable, and --strictPort makes a collision
// a loud failure instead of a silent second port.
const PORT = Number(process.env.FIGHT_BOT_PORT ?? 4400)
const BASE = `http://localhost:${PORT}/`
const OUT_DIR = process.env.FIGHT_BOT_OUT ?? resolve(FRONTEND, 'smoke-out')
const HEADED = process.env.FIGHT_BOT_HEADED === '1'

/** THE SCENARIO. Everything content-shaped is a knob, so the matrix (#1100's "any class, any level, any
 *  spell set") is env, not an edit. A scenario FILE format is the obvious next step; this is its shape. */
const SCENARIO = {
  name: process.env.FIGHT_BOT_SCENARIO ?? 'solo-yajin-vs-one-mob',
  seed: Number(process.env.FIGHT_BOT_SEED ?? 0xc81f3a92) >>> 0,
  // yajin is the default because its seed kit is the widest: DAMAGE, PUSH, PLACE_TRAP, ALTER_STAT and a DoT
  // all unlock inside 60 levels — one fight exercises move + cast + trap + push, which is the bar #1100 sets.
  class_id: process.env.FIGHT_BOT_CLASS ?? 'yajin',
  level: Number(process.env.FIGHT_BOT_LEVEL ?? 200),
  // Which listed mob to fight, by rank in the corpus' level order — deterministic, and never a pinned
  // object id (those move on every republish). Rank 65 is the first authored BOSS: a one-shot kill is a
  // fine victory and a useless instrument, and a mob that survives a cast is what makes the trap get walked
  // into and the push have somewhere to go.
  mob_rank: Number(process.env.FIGHT_BOT_MOB_RANK ?? 65),
  mob_level: Number(process.env.FIGHT_BOT_MOB_LEVEL ?? 60),
  max_turns: Number(process.env.FIGHT_BOT_MAX_TURNS ?? 40),
  policy_seed: Number(process.env.FIGHT_BOT_POLICY_SEED ?? 1),
}

const log = (...args) => console.log(...args)

// ╔══════════════════ [ (a) THE SEAM CLIENT — transport only, never a decision ] ═══════════════════════ ]

const seam_client = (page) => ({
  /** Are the bot's doors registered yet? (The seam tree is lazily imported behind the DEV gate.) */
  ready: () =>
    page.evaluate(() => typeof window.__ARES_DEV_READ === 'function' && typeof window.__ARES_DEV_TURN === 'function'),
  /** Every DEV seam this build exposes — the enumeration the brief asks a driver to take, not assume. */
  seams: () =>
    page.evaluate(() =>
      Object.keys(window)
        .filter((k) => k.startsWith('__ARES_DEV_'))
        .sort()
    ),
  read: () => page.evaluate(() => window.__ARES_DEV_READ()),
  /** Commit one whole player turn. `expect` riders are stripped: the seam takes kind/cell/spell_id only. */
  commit: (actions) =>
    page.evaluate(
      (rows) => window.__ARES_DEV_TURN(rows),
      actions.map(({ kind, cell, spell_id }) => ({ kind, cell, ...(spell_id ? { spell_id } : {}) }))
    ),
})

/** Wait until `predicate(read)` holds, polling the seam. Returns the read, or null on timeout. */
const wait_for = async (client, predicate, { timeout_ms = 60_000, poll_ms = 400 } = {}) => {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    const read = await client.read().catch(() => null)
    if (read?.ok && predicate(read)) return read
    await new Promise((r) => setTimeout(r, poll_ms))
  }
  return null
}

// ╔══════════════════ [ CONTENT — picked from the SAME published blobs the page resolves ] ═════════════ ]

/**
 * A mob the page is guaranteed to be able to resolve: it must exist in the published world corpus (which is
 * what the simulator's mob index is built from) AND carry a minted template id in the deployment pin. The
 * URL shape is `walrus_asset_url`'s own (`<aggregator>/data/<class>.json`), read off the manifest the app
 * boots from — never a second hardcoded host.
 */
const pick_mob = async () => {
  const manifest = JSON.parse(readFileSync(resolve(FRONTEND, 'public/asset_manifest.json'), 'utf8'))
  const pin = JSON.parse(readFileSync(resolve(REPO, 'packages/move/scripts/out/seed_manifest.json'), 'utf8'))
  const response = await fetch(`${manifest.aggregator}/data/world_corpus.json`)
  if (!response.ok)
    throw new Error(`world corpus unreachable (HTTP ${response.status}) — the bot needs published content`)
  const blob = await response.json()
  const rows = Object.values(blob)
    .flatMap((world) => world.mobs ?? [])
    // `is_listed_mob_role` — protectors guard gatherables and are not roster mobs.
    .filter((mob) => mob.role !== 'protector' && pin.mobs?.[mob.key]?.id)
    .map((mob) => ({
      key: mob.key,
      id: pin.mobs[mob.key].id,
      name: pin.mobs[mob.key].name ?? mob.key,
      level: Number(mob.minLevel ?? mob.level ?? 1),
    }))
    .sort((a, b) => a.level - b.level || a.key.localeCompare(b.key))
  const mob = rows[SCENARIO.mob_rank]
  if (!mob)
    throw new Error(
      `the published corpus lists ${rows.length} fightable mobs — rank ${SCENARIO.mob_rank} is out of range`
    )
  return { ...mob, level: SCENARIO.mob_level }
}

// ╔══════════════════ [ (c) THE RUNNER ] ═══════════════════════════════════════════════════════════════ ]

const wait_for_server = async (url, timeout_ms = 120_000) => {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`dev server never became ready at ${url}`)
}

/**
 * Seed the page's own persisted setup (IndexedDB `aresrpg_simulator`) with the scenario: one character on
 * the first ALLY start cell, one mob on the first ENEMY start cell. Both bands come from the page's OWN
 * board derivation (`simulator/board.ts`, evaluated in the page), so the cells are legal by construction —
 * the reducer drops a placement that is not on its band, and a dropped placement is a silently empty fight.
 */
const seed_setup = async (page, mob) => {
  const board = await page.evaluate(async (seed) => {
    const { board_of } = await import(/* @vite-ignore */ '/src/simulator/board.ts')
    const derived = board_of(seed, 0)
    return { ally: [...derived.start_cells_a], enemy: [...derived.start_cells_b] }
  }, SCENARIO.seed)
  if (!board.ally.length || !board.enemy.length)
    throw new Error(`seed ${SCENARIO.seed} derives a board with no start bands`)

  await page.evaluate(
    async ({ seed, ally_cell, enemy_cell, mob_id, mob_level, class_id, level }) => {
      const db = await new Promise((res, rej) => {
        const request = indexedDB.open('aresrpg_simulator', 1)
        request.onupgradeneeded = () => {
          for (const store of ['roster', 'setup', 'traces'])
            if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store)
        }
        request.onsuccess = () => res(request.result)
        request.onerror = () => rej(request.error)
      })
      await new Promise((res, rej) => {
        const tx = db.transaction(['roster', 'setup'], 'readwrite')
        tx.oncomplete = res
        tx.onerror = () => rej(tx.error)
        const roster = tx.objectStore('roster')
        roster.clear()
        roster.put(
          {
            id: 'bot_seat',
            name: 'BOT',
            class_id,
            male: true,
            level,
            stat_alloc: { vitality: 400, wisdom: 0, strength: 100, intelligence: 0, chance: 0, agility: 0 },
            spell_levels: {},
            loadout: {},
          },
          'bot_seat'
        )
        tx.objectStore('setup').put(
          {
            seed,
            focus_id: 'bot_seat',
            anchor_nonce: 0,
            placements: { [ally_cell]: 'bot_seat' },
            mob_picks: { [enemy_cell]: { template_id: mob_id, level: mob_level } },
          },
          'current'
        )
      })
      db.close()
    },
    {
      seed: SCENARIO.seed,
      ally_cell: board.ally[0],
      enemy_cell: board.enemy[0],
      mob_id: mob.id,
      mob_level: mob.level,
      class_id: SCENARIO.class_id,
      level: SCENARIO.level,
    }
  )
  return board
}

const cell_str = (c) => (c ? `${c.x},${c.y}` : '—')

/** Both pool clocks for one fighter — the presented bar and the committed anchor. */
const pick_pools = (read, id) => {
  const f = read?.fighters?.find((row) => row.id === id)
  return f
    ? { ap: f.ap, mp: f.mp, ap_committed: f.ap_committed, mp_committed: f.mp_committed, traps: read.my_traps }
    : null
}

/** The bar table — one line per assertion, the sheet's human face. */
const print_sheet = (sheet) => {
  log('')
  log(`  BAR SHEET — ${sheet.scenario.name}  (seed ${sheet.scenario.seed}, policy seed ${sheet.scenario.policy_seed})`)
  log('  ' + '─'.repeat(112))
  log(
    '  ' +
      ['TURN', 'ACTION', 'AT', 'CHECK', 'EXPECTED', 'ACTUAL', '']
        .map((h, i) => h.padEnd([6, 22, 8, 44, 14, 14, 4][i]))
        .join('')
  )
  log('  ' + '─'.repeat(112))
  for (const turn of sheet.turns)
    for (const row of turn.rows)
      log(
        '  ' +
          [
            String(turn.turn),
            String(row.kind).slice(0, 21),
            cell_str(row.at),
            String(row.check).slice(0, 43),
            String(row.expected).slice(0, 13),
            String(row.actual).slice(0, 13),
            row.pass ? 'PASS' : 'FAIL',
          ]
            .map((v, i) => v.padEnd([6, 22, 8, 44, 14, 14, 4][i]))
            .join('')
      )
  log('  ' + '─'.repeat(112))
  const { checks, passed, failed, verdict } = sheet.summary
  log(
    `  ${verdict} — ${passed}/${checks} checks passed, ${failed} failed · outcome: ${sheet.outcome} · ${sheet.turns.length} bot turns`
  )
  log('')
}

mkdirSync(OUT_DIR, { recursive: true })

const mob = await pick_mob()
log(
  `[bot] scenario ${SCENARIO.name}: ${SCENARIO.class_id} lvl ${SCENARIO.level} vs ${mob.name} lvl ${mob.level} (${mob.key})`
)

const dev_server = spawn('bunx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: FRONTEND,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
})
let server_log = ''
dev_server.stdout.on('data', (d) => (server_log += d))
dev_server.stderr.on('data', (d) => (server_log += d))

const sheet = {
  scenario: { ...SCENARIO, mob },
  surface: 'simulator',
  started_at: new Date().toISOString(),
  seams: [],
  turns: [],
  outcome: 'not reached',
  summary: { checks: 0, passed: 0, failed: 0, verdict: 'FAIL' },
  errors: [],
}
let browser
let live_page = null
let live_console = []

try {
  await wait_for_server(BASE)
  browser = await chromium.launch({ headless: !HEADED, args: ['--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  live_page = page
  const console_lines = []
  live_console = console_lines
  page.on('console', (m) => console_lines.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => console_lines.push(`[pageerror] ${String(e?.message ?? e)}`))

  // The sanctioned Playwright login (auth/dev_wallet.ts): a fresh, unfunded, throwaway keypair per run.
  // Nothing to fund and nothing to leak — the simulator signs no transaction at all (fight_shim.js).
  await page.addInitScript((key) => {
    window.__ARES_DEV_KEY = key
  }, Ed25519Keypair.generate().getSecretKey())

  await page.goto(`${BASE}simulator?dev`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForSelector('canvas', { timeout: 180_000 })
  await seed_setup(page, mob)
  // The page hydrates its setup from IndexedDB at mount, so the scenario needs one reload to be picked up.
  await page.goto(`${BASE}simulator?dev`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForSelector('canvas', { timeout: 180_000 })

  const client = seam_client(page)
  // THE SEAMS BEFORE THE FIGHT. Registration is a lazy dynamic import fired from the board viewport's mount
  // and guarded by its own destroy flag, so React's dev double-mount can race it away (observed: one run in
  // four booted a working board with no seams on it). A reload re-runs the mount and costs nothing — the
  // scenario lives in IndexedDB — whereas reloading AFTER START would throw away a live fight.
  for (let attempt = 1; attempt <= 3 && !(await client.ready()); attempt++) {
    await page
      .waitForFunction(
        () => typeof window.__ARES_DEV_READ === 'function' && typeof window.__ARES_DEV_TURN === 'function',
        null,
        { timeout: 45_000, polling: 1000 }
      )
      .catch(() => {})
    if (await client.ready()) break
    log(`[bot] the drive seams did not register on mount ${attempt} — reloading`)
    await page.goto(`${BASE}simulator?dev`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
    await page.waitForSelector('canvas', { timeout: 180_000 })
  }
  sheet.seams = await client.seams()
  log(`[bot] DEV seams live: ${sheet.seams.join(' ')}`)
  if (!(await client.ready())) throw new Error('the bot seams (__ARES_DEV_READ / __ARES_DEV_TURN) never registered')

  const start = page.getByRole('button', { name: /START FIGHT/i }).first()
  await start.waitFor({ timeout: 120_000 })
  if (!(await start.isEnabled()))
    throw new Error('START FIGHT is disabled — the scenario did not hydrate (roster or mob pick dropped)')
  await start.click()

  const opened = await wait_for(client, (r) => r.my_id && r.fighters.length > 1, { timeout_ms: 120_000 })
  if (!opened) throw new Error('the fight never opened (no seat in the read)')
  log(
    `[bot] fight ${opened.fight_id} open — ${opened.fighters.length} fighters, ${opened.spellbook.length} castable spells`
  )

  // THE BOT'S OWN MEMORY — what the snapshot cannot tell it. `casts` is the cooldown ledger (a card played
  // two turns ago is not playable again until its authored cooldown elapses); `blocked` holds any spell the
  // AUTHORITY refused, so one refusal is a FAIL row and not an infinite loop of the same refused turn.
  const history = { casts: {}, blocked: [], traps: [] }
  /** Traps the bot has armed and not yet seen sprung — the deferred assertion's ledger. */
  let armed_traps = []
  /** One re-read is allowed when the turn pointer moved between the read and the commit (a harness race,
   *  not a game failure); a second is a genuine stall and is recorded as the FAIL it is. */
  let races = 0

  for (let turn = 1; turn <= SCENARIO.max_turns; turn++) {
    const mine = await wait_for(
      client,
      (r) => r.winner !== -1 || (r.active_id === r.my_id && !r.busy && !r.presenting),
      { timeout_ms: 120_000 }
    )
    if (!mine) throw new Error(`turn ${turn}: the bot never got the turn back (the fight stalled)`)
    if (mine.winner !== -1) {
      sheet.outcome = mine.winner === 0 ? 'victory' : mine.winner === 1 ? 'defeat' : 'draw'
      break
    }
    const me = mine.fighters.find((f) => f.id === mine.my_id)
    if (!me?.alive_committed) {
      sheet.outcome = 'defeat'
      break
    }

    const plan = plan_turn(mine, { seed: SCENARIO.policy_seed, history })
    const mark = console_lines.length
    const result = await client.commit(plan.actions)
    // The shim logs WHICH staged action the sim declined and why; the store's boolean cannot carry it. A
    // refusal without its reason is exactly the silence this bot exists to end.
    const refusal = console_lines.slice(mark).filter((line) => /commit refused|did not fold|tripwire/i.test(line))
    if (!result.ok && refusal.length) result.error = `${result.error} — ${refusal[0]}`
    if (!result.ok && /not my turn/.test(result.error ?? '') && races++ < 2) {
      log(`[bot] turn ${turn}: the turn pointer moved between the read and the commit — re-reading`)
      turn -= 1
      await new Promise((r) => setTimeout(r, 1500))
      continue
    }
    for (const action of plan.actions)
      if (action.kind === 1) {
        history.casts[action.spell_id] = mine.turn_number ?? turn
        if (!result.ok && !history.blocked.includes(action.spell_id)) history.blocked.push(action.spell_id)
      }
    // A trap proves itself the turn something walks into it, not the turn it was cast — so the ledger of
    // armed cells is carried forward and checked against every later board.
    const sprung = result.ok
      ? assert_traps_sprung(armed_traps, result.before, result.after)
      : { rows: [], remaining: armed_traps }
    armed_traps = sprung.remaining
    if (result.ok)
      for (const action of plan.actions)
        if (action.expect?.type === 'trap') {
          armed_traps.push({ cell: action.expect.cell, turn, spell_key: action.spell_key })
          history.traps.push(action.expect.cell.y * 20 + action.expect.cell.x) // canonical stride-20 encode
        }
    const rows = [...assert_turn(plan, result), ...sprung.rows]
    sheet.turns.push({
      turn,
      ap: me.ap,
      mp: me.mp,
      hp: `${me.hp_committed}/${me.hp_max}`,
      at: me.cell_committed,
      enemies: mine.fighters
        .filter((f) => f.team !== me.team && f.alive_committed)
        .map((f) => ({ id: f.id, at: f.cell_committed, hp: f.hp_committed })),
      decisions: plan.decisions,
      actions: plan.actions,
      committed: { ok: result.ok, error: result.error ?? null },
      // The two pool clocks either side of the commit — the diagnostic that tells a red AP row apart from a
      // surface that simply never reconciles its pools.
      pools: {
        before: pick_pools(result.before, result.before?.my_id),
        after: pick_pools(result.after, result.after?.my_id),
      },
      rows,
    })
    const verdict = summarise(rows)
    log(
      `[bot] turn ${turn}: ${plan.actions.length} action(s) — ${plan.actions.map((a) => (a.kind === 0 ? `move→${cell_str(a.cell)}` : `${a.spell_key}→${cell_str(a.cell)}`)).join(', ') || 'pass'} · ${verdict.passed}/${verdict.checks} checks`
    )
    if (!result.ok) log(`[bot]   commit refused: ${result.error}`)
  }

  if (sheet.outcome === 'not reached') {
    const last = await client.read().catch(() => null)
    if (last?.ok && last.winner !== -1)
      sheet.outcome = last.winner === 0 ? 'victory' : last.winner === 1 ? 'defeat' : 'draw'
  }
} catch (error) {
  sheet.errors.push(String(error?.stack ?? error))
  log(`[bot] FATAL ${String(error?.message ?? error)}`)
} finally {
  // The page's own account of the run, written whatever happened — a failure with no console is a failure
  // nobody can diagnose, which is how the manual drives burned their hours.
  await live_page?.screenshot({ path: resolve(OUT_DIR, 'fight_bot_end.png') }).catch(() => {})
  writeFileSync(resolve(OUT_DIR, 'fight_bot_console.log'), live_console.join('\n'))
  await browser?.close().catch(() => {})
  dev_server.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 1500))
  if (!dev_server.killed) dev_server.kill('SIGKILL')
  writeFileSync(resolve(OUT_DIR, 'fight_bot_server.log'), server_log)
}

const all_rows = sheet.turns.flatMap((t) => t.rows)
sheet.summary = summarise(all_rows)
// A run that never reached a terminal proves nothing about the fight, however green its rows are.
if (sheet.outcome === 'not reached' || sheet.errors.length) sheet.summary.verdict = 'FAIL'
sheet.finished_at = new Date().toISOString()
writeFileSync(resolve(OUT_DIR, 'fight_bot_sheet.json'), JSON.stringify(sheet, null, 2))
print_sheet(sheet)
log(`[bot] sheet: ${resolve(OUT_DIR, 'fight_bot_sheet.json')}`)
for (const error of sheet.errors) log(error)
process.exit(sheet.summary.verdict === 'PASS' ? 0 : 1)
