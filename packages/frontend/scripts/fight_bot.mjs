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
//   (a) SEAM CLIENT (fight_bot/seam.mjs) — a thin wrapper over the DEV window seams. It transports; it never decides.
//   (b) POLICY (@aresrpg/fight/bot, pure, unit-tested headless in packages/fight/test/bot) — state → the next
//       turn. No browser anywhere near it, so its behaviour is proven by fixtures, not by a run.
//   (c) RUNNER (fight_bot/drive.mjs + this file) — boots the pages, loops turns, writes the machine-readable sheet.
//
// WHAT IT PROVES. Every action carries the delta it expects; after the commit the assertions read the COMMITTED
// fold and compare. A cast that reports success without its damage, a push that "landed" without moving anyone,
// an AP spend that never happened — each is a FAIL row in the sheet, never a warning.
//
// THREE SURFACES, ONE BOT (the seams are one module — game/dev/dev_bot_seam.js — registered by the simulator
// AND by the world HUD, so none of this is a second implementation of anything):
//   sim   — `/simulator`, the local sim chain: deterministic, no transaction, no gas. The regression surface.
//   world — `/game-world` on testnet: a REAL chain-backed fight, one authenticated seat, real gas per turn.
//   coop  — the same world fight with TWO authenticated seats, both driven by the same policy, plus the proof
//           only two clients can give: what one seat's turn did is true on the OTHER seat's screen.
//
// Usage:
//   node scripts/fight_bot.mjs                            # sim, the default scenario, headless
//   FIGHT_BOT_MODE=world node scripts/fight_bot.mjs       # one real seat on testnet (alice)
//   FIGHT_BOT_MODE=coop node scripts/fight_bot.mjs        # two real seats (alice + bob) in one fight
//   FIGHT_BOT_PORT=4401 FIGHT_BOT_CLASS=senshi node scripts/fight_bot.mjs
//   FIGHT_BOT_HEADED=1 node scripts/fight_bot.mjs         # watch it play
// Exit code 0 = every assertion passed AND the fight reached a terminal; 1 = anything else.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { assert_prediction_proofs, assert_status_proof_ran, summarise } from '@aresrpg/fight/bot'

import { wait_for_server } from './fight_bot/seam.mjs'
import { drive_fight } from './fight_bot/drive.mjs'
import { open_sim_fight, pick_mob } from './fight_bot/sim_surface.mjs'
import { abandon_fight, open_world_fight } from './fight_bot/world_surface.mjs'
import { print_sheet } from './fight_bot/sheet.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(HERE, '..')
const REPO = resolve(FRONTEND, '../..')

// 4400 family — 5173 (the owner's dev server) and 9528 are untouchable, and --strictPort makes a collision
// a loud failure instead of a silent second port.
const PORT = Number(process.env.FIGHT_BOT_PORT ?? 4400)
const BASE = `http://localhost:${PORT}/`
const OUT_DIR = process.env.FIGHT_BOT_OUT ?? resolve(FRONTEND, 'smoke-out')
const HEADED = process.env.FIGHT_BOT_HEADED === '1'
const MODE = process.env.FIGHT_BOT_MODE ?? 'sim'
if (!['sim', 'world', 'coop'].includes(MODE))
  throw new Error(`FIGHT_BOT_MODE must be sim, world or coop — got "${MODE}"`)
const ON_CHAIN = MODE !== 'sim'

/** THE SCENARIO. Everything content-shaped is a knob, so the matrix (#1100's "any class, any level, any
 *  spell set") is env, not an edit. A scenario FILE format is the obvious next step; this is its shape.
 *  On the WORLD the opponent is whatever mob group the seat can claim, so the mob knobs simply do not apply —
 *  a world scenario's content is the chain's, which is the point of running there. */
const SCENARIO = {
  name: process.env.FIGHT_BOT_SCENARIO ?? (MODE === 'sim' ? 'solo-yajin-vs-one-mob' : `${MODE}-world-fight`),
  seed: Number(process.env.FIGHT_BOT_SEED ?? 0xc81f3a92) >>> 0,
  // yajin is the default because its seed kit is the widest: DAMAGE, PUSH, PLACE_TRAP, ALTER_STAT and a DoT
  // all unlock inside 60 levels — one fight exercises move + cast + trap + push, which is the bar #1100 sets.
  class_id: process.env.FIGHT_BOT_CLASS ?? 'yajin',
  level: Number(process.env.FIGHT_BOT_LEVEL ?? 200),
  // Which listed mob to fight, by rank in the corpus' level order — deterministic, and never a pinned object id
  // (those move on every republish). Rank 65 is the first authored BOSS: a one-shot kill is a fine victory and a
  // useless instrument, and a mob that survives a cast is what makes the trap get walked into and the push have
  // somewhere to go.
  mob_rank: Number(process.env.FIGHT_BOT_MOB_RANK ?? 65),
  mob_level: Number(process.env.FIGHT_BOT_MOB_LEVEL ?? 60),
  max_turns: Number(process.env.FIGHT_BOT_MAX_TURNS ?? (ON_CHAIN ? 30 : 40)),
  policy_seed: Number(process.env.FIGHT_BOT_POLICY_SEED ?? 1),
}

// THE SEATS, by NAME only. Key material is read at runtime from a file outside the repo and never appears in
// this process' arguments, its logs or its sheet (world_surface.mjs owns the reading; see its header).
const KEYS_PATH = process.env.FIGHT_BOT_KEYS ?? resolve(REPO, '.dev/keys.json')
const SEAT_NAMES =
  MODE === 'coop'
    ? [process.env.FIGHT_BOT_SEAT_A ?? 'alice', process.env.FIGHT_BOT_SEAT_B ?? 'bob']
    : [process.env.FIGHT_BOT_SEAT_A ?? 'alice']
// The world reads its content through the /v1 layer; in DEV the app defaults that to a LOCAL api (localhost:3000)
// which no bot run has. Point it at the live read API unless the caller says otherwise.
const RPC_URL = process.env.VITE_RPC_URL ?? 'https://rpc.aresrpg.world'

const log = (...args) => console.log(...args)

mkdirSync(OUT_DIR, { recursive: true })

const mob = MODE === 'sim' ? await pick_mob({ frontend: FRONTEND, repo: REPO, scenario: SCENARIO }) : null
if (mob)
  log(
    `[bot] scenario ${SCENARIO.name}: ${SCENARIO.class_id} lvl ${SCENARIO.level} vs ${mob.name} lvl ${mob.level} (${mob.key})`
  )
else log(`[bot] scenario ${SCENARIO.name}: ${MODE} on the live world — seats ${SEAT_NAMES.join(' + ')}`)

const dev_server = spawn('bunx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: FRONTEND,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ...(ON_CHAIN ? { VITE_RPC_URL: RPC_URL } : {}) },
})
let server_log = ''
dev_server.stdout.on('data', (d) => (server_log += d))
dev_server.stderr.on('data', (d) => (server_log += d))

const sheet = {
  scenario: { ...SCENARIO, mob },
  surface: MODE === 'sim' ? 'simulator' : `world (${SEAT_NAMES.join(' + ')})`,
  mode: MODE,
  started_at: new Date().toISOString(),
  seams: [],
  turns: [],
  run_rows: [],
  cross: null,
  outcome: 'not reached',
  summary: { checks: 0, passed: 0, failed: 0, verdict: 'FAIL' },
  errors: [],
}
let browser
const seats = []

try {
  await wait_for_server(BASE)
  browser = await chromium.launch({ headless: !HEADED, args: ['--enable-unsafe-swiftshader'] })
  // Seats register the MOMENT they boot — `seats` IS the registry, so a failure during the opening still writes
  // that page's console below instead of leaving the one artefact that explains it unwritten.
  const on_seat = (seat) => seats.push(seat)
  const opened =
    MODE === 'sim'
      ? await open_sim_fight({ browser, base: BASE, scenario: SCENARIO, mob, log, on_seat })
      : await open_world_fight({ browser, base: BASE, keys_path: KEYS_PATH, seat_names: SEAT_NAMES, log, on_seat })
  sheet.seams = opened.seams
  sheet.fight_id = opened.fight_id
  if (opened.addresses) sheet.addresses = opened.addresses

  const played = await drive_fight({
    seats: opened.seats,
    max_turns: SCENARIO.max_turns,
    policy_seed: SCENARIO.policy_seed,
    log,
    // A chain turn is a signed transaction and a confirmation, not a frame — give it room before calling a stall.
    turn_timeout_ms: ON_CHAIN ? 300_000 : 120_000,
    observe_timeout_ms: ON_CHAIN ? 120_000 : 60_000,
  })
  sheet.turns = played.turns
  sheet.outcome = played.outcome
  sheet.cross = played.cross
  sheet.parity = played.parity
  // THE PARITY ROW, on every surface (#1144). Every other row in this sheet reads the committed fold on both
  // sides; this one compares what the client PREDICTED against what the authority resolved. A run that never
  // landed one such comparison has not swept parity, whatever else it proved — so it fails and names why.
  sheet.run_rows.push(...assert_prediction_proofs(played.parity))
  // THE COOP RULING'S OWN ROW. A coop run that never landed a status across clients has not shown what coop was
  // built to show, so it says so — with the reason, and as a FAIL. A skip dressed as a pass is worse than a gap.
  if (MODE === 'coop')
    sheet.run_rows.push(
      ...assert_status_proof_ran(
        played.cross.status_proofs,
        'no seat ever planned a status-only cast — check the seats’ level against the first buff/debuff in their class book'
      )
    )
} catch (error) {
  sheet.errors.push(String(error?.stack ?? error))
  log(`[bot] FATAL ${String(error?.message ?? error)}`)
} finally {
  // RELEASE WHAT THIS RUN DID NOT FINISH — in the TEARDOWN, because the run can fail with a fight already
  // created (the first coop attempt died at its placement, holding both seats). A chain fight left open keeps its
  // characters escrowed, and the NEXT run then finds no claimable group and no honest way to say why. The rig
  // wants a free seat, never that fight's rewards. `__ARES_DEV_ABANDON` self-guards, so a seat holding nothing
  // simply answers that it has nothing to release.
  if (ON_CHAIN && sheet.outcome === 'not reached') for (const seat of seats) await abandon_fight({ seat, log })
  // The pages' own account of the run, written whatever happened — a failure with no console is a failure
  // nobody can diagnose, which is how the manual drives burned their hours.
  for (const seat of seats) {
    await seat.page?.screenshot({ path: resolve(OUT_DIR, `fight_bot_end_${seat.name}.png`) }).catch(() => {})
    writeFileSync(resolve(OUT_DIR, `fight_bot_console_${seat.name}.log`), seat.console_lines.join('\n'))
  }
  await browser?.close().catch(() => {})
  dev_server.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 1500))
  if (!dev_server.killed) dev_server.kill('SIGKILL')
  writeFileSync(resolve(OUT_DIR, 'fight_bot_server.log'), server_log)
}

const all_rows = [...sheet.turns.flatMap((t) => t.rows), ...sheet.run_rows]
sheet.summary = summarise(all_rows)
// A run that never reached a terminal proves nothing about the fight, however green its rows are.
if (sheet.outcome === 'not reached' || sheet.errors.length) sheet.summary.verdict = 'FAIL'
sheet.finished_at = new Date().toISOString()
const sheet_path = resolve(OUT_DIR, `fight_bot_sheet${MODE === 'sim' ? '' : `_${MODE}`}.json`)
writeFileSync(sheet_path, JSON.stringify(sheet, null, 2))
print_sheet(sheet, log)
log(`[bot] sheet: ${sheet_path}`)
for (const error of sheet.errors) log(error)
process.exit(sheet.summary.verdict === 'PASS' ? 0 : 1)
