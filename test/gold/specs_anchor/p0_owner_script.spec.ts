// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import {
  boot_fixture_world,
  cell_key,
  click_cell,
  draft_move,
  engage_by_mouse,
  gold_manifest,
  human_click_locator,
  snapshot,
  wait_player_turn,
  type Cell,
  type FightFixture,
  type GoldWallet,
} from './fight_mouse_helpers'

// P0 RECORDED REPRO — the reported verbatim v35 fight-sync script (recorded 2026-07-19):
//   "play with the yajin in the test and cast trap, walk, try to escape, get tackled, push mobs into trap,
//    record to verify if the sim kills them they won't reappear dumbly"
// reported symptom: "everything is being rolled back, invisibility and traps are appearing then disappearing
// then appearing again (or not) mobs are dying then being rolledback alive, half of the turns are being not
// validated or tx fails". Six beats, mouse-verified against the LAGGED projection (proxy_lag — the symptoms are
// latency-shaped) and RECORDED for a human to read.
//
// ── ATTEMPT-2 CURE (this rewrite): the attempt-1 lane DIED DARK — boot_fixture_world threw at search_zone on an
//    OWNED-OBJECT lock ("already locked by a different transaction") and no artifact was written. Two fixes:
//    (1) NEVER DIE DARK — a top-level finally ALWAYS writes the artifact (beats + the tx-outcome column + the
//        recorder rows), so even a boot lock produces the diagnostic JSON + the video, never a silent death.
//    (2) THE NATIVE TX-OUTCOME COLUMN (seat order) — every turn-commit is classified from the app's OWN
//        `window.__ARES_FIGHT_TRACE` (fight_state_trace.js, armed by /?dev&fighttrace=1) into one of five
//        statuses — the ①-vs-② disease discriminator. Lock-contention retries the BEAT once; the first refusal
//        stays in the artifact verbatim.
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out', 'p0_owner_script')
const manifest = gold_manifest

type Formation = { mob: any; stage: Cell; trap: Cell; direction: Cell; path: Cell[] }
type BeatRow = { beat: string; label: string; status: 'PASS' | 'FAIL' | 'OBSERVED' | 'NOT-OBSERVED'; note: string }

// ── THE TX-OUTCOME COLUMN — the five NATIVE outcomes of a signed turn/action tx, read from the app's own trace.
type TxStatus = 'landed-matching' | 'never-landed' | 'landed-divergent' | 'lock-contention' | 'reserve-refused'
type TxRow = {
  beat: string
  attempt: number
  turn_key: string | null
  digest: string | null
  status: TxStatus
  receipt_status: string | null
  ok: boolean
  error: string | null
  at_ms: number
}
const tx_rows: TxRow[] = []

// Owned-object equivocation / stale-version refusals (ZERO gas, pre-execution — the class that killed attempt 1).
const LOCK_RE =
  /already locked|locked by a different|ObjectLock|not available for consumption|unavailable for consumption|needs to be rebuilt|reserved for another|equivocat|conflicting transaction|WrongEpoch/i
// Sponsor/gas-station reserve refusals (the sponsor-first path — a ≤0.2-SUI wallet's /reserve rejected).
const RESERVE_RE = /reserve|sponsor|gas ?station|Failed to fetch|daily.*(cap|limit)|anti.?drain|\b429\b|no gas coin/i

async function read_trace(page: Page): Promise<any[]> {
  return page.evaluate(() => ((window as any).__ARES_FIGHT_TRACE ?? []) as any[])
}
async function trace_seq(page: Page): Promise<number> {
  const rows = await read_trace(page)
  return rows.length ? Number(rows[rows.length - 1].sequence ?? 0) : 0
}
// A divergence (reconcile "prediction diverged, chain truth adopted") since t0 — the fight-store signal the
// install_recorder subscription captures synchronously into __P0_ROWS. This is the ok-commit divergent discriminator.
async function divergence_since(page: Page, t0: number): Promise<boolean> {
  return page.evaluate(
    (t) => ((window as any).__P0_ROWS ?? []).some((r: any) => r.kind === 'divergence' && r.at_ms >= t),
    t0
  )
}

/** Classify a single commit from the trace rows that fired AFTER seq_before. Anchors on the LAST commit's
 *  turn_key so a concurrent background (deadline) auto-commit in the same window can't pollute the verdict.
 *  Order matters: an executed digest (gas burned on-chain) always outranks a message match — proof the tx LANDED. */
function classify(beat: string, window_rows: any[], has_divergence: boolean): TxRow {
  const keyed = window_rows.filter((r) => r.turn_key != null && /^commit_/.test(String(r.event)))
  const target = keyed.length ? keyed[keyed.length - 1].turn_key : null
  const rows = target
    ? window_rows.filter((r) => r.turn_key === target)
    : window_rows.filter((r) => /^commit_/.test(String(r.event)))
  const at = (e: string) => rows.filter((r) => r.event === e)
  const finished = at('commit_finished')
  const failed = at('commit_failed')
  const receipt = at('commit_receipt')
  const rejected = rows.find((r) => r.event === 'commit_rejected_locally')
  const blocked = rows.find((r) => r.event === 'commit_auto_blocked')
  const turn_key = target ?? (finished[0] ?? failed[0] ?? rejected ?? blocked)?.turn_key ?? null
  const receipt_status = receipt.length ? String(receipt[receipt.length - 1].status ?? '') : null
  const ok = finished.some((r) => r.ok === true)
  const base = { beat, attempt: 1, turn_key, receipt_status, at_ms: Date.now() }
  if (failed.length) {
    const f = failed[failed.length - 1]
    const digest = (f.executed_digest as string) || null
    const msg = String(f.message ?? '')
    const status: TxStatus = digest
      ? 'landed-divergent' // the tx EXECUTED and aborted — landed, diverged from the predicted success
      : LOCK_RE.test(msg)
        ? 'lock-contention'
        : RESERVE_RE.test(msg)
          ? 'reserve-refused'
          : 'never-landed'
    return { ...base, digest, status, ok: false, error: msg }
  }
  if (ok)
    return {
      ...base,
      digest: null, // fight_state_trace omits the success digest (commit_receipt logs status only) — status is the verdict
      status: has_divergence ? 'landed-divergent' : 'landed-matching',
      ok: true,
      error: null,
    }
  if (rejected)
    return {
      ...base,
      digest: null,
      status: 'never-landed',
      ok: false,
      error: `commit rejected locally (busy=${rejected.busy} has_fight=${rejected.has_fight})`,
    }
  if (blocked)
    return {
      ...base,
      digest: (blocked.executed_digest as string) || null,
      status: 'never-landed',
      ok: false,
      error: 'auto-commit blocked — latched executed failure (burn law, no auto-retry)',
    }
  return { ...base, digest: null, status: 'never-landed', ok: false, error: 'no terminal commit trace observed' }
}

// ── extra state the exported snapshot() does not carry: live trap cells + the store's reconcile-divergence log.
async function read_extra(page: Page) {
  return page.evaluate(async () => {
    const { fight_view, fight_store, decode } = await import('/@id/@aresrpg/fight')
    const fight = fight_view()
    const store_state = fight_store.getState()
    return {
      my_traps: ((fight?.my_traps ?? []) as number[]).map((c) => decode(c)) as Cell[],
      divergence: (store_state as any)?.divergence ?? null,
    }
  })
}

// ── the page-side recorder: subscribes the fight store, the engine combat-log stream, and the toast stacks
//    SYNCHRONOUSLY so a transient flicker between two Playwright polls is never missed. Trap-set membership +
//    divergence + toast + per-fighter dead-flip (revive) — the exact shapes of "rolled back" the report named.
async function install_recorder(page: Page) {
  await page.evaluate(async () => {
    const w = window as any
    const [{ fight_store, engine_view_of, decode }, toast] = await Promise.all([
      import('/@id/@aresrpg/fight'),
      import('/src/game/core/toast.js'),
    ])
    w.__P0_OFF?.()
    w.__P0_ROWS = []
    const view = () => engine_view_of(fight_store.getState())
    const push = (row: any) => w.__P0_ROWS.push({ at_ms: Date.now(), ...row })
    let prev_traps = JSON.stringify(((view()?.my_traps ?? []) as number[]).slice().sort())
    const prev_cells: Record<string, { x: number; y: number }> = {}
    const prev_dead: Record<string, boolean> = {}
    let prev_presenting = !!view()?.presenting
    let prev_divergence_version: number | null = null
    let message_count = w.__ARES_ENGINE.get_state().message_history?.length ?? 0
    const on_fight = () => {
      const v = view()
      const presenting = !!v?.presenting
      const traps_key = JSON.stringify(((v?.my_traps ?? []) as number[]).slice().sort())
      if (traps_key !== prev_traps) {
        push({ kind: 'trap_set_change', traps: ((v?.my_traps ?? []) as number[]).map(decode), presenting })
        prev_traps = traps_key
      }
      for (const [id, f] of (v?.fighters ?? new Map()) as Map<string, any>) {
        const prior = prev_cells[id]
        const cur = f.cell
        if (cur && (!prior || prior.x !== cur.x || prior.y !== cur.y))
          push({ kind: 'cell_change', id, from: prior ?? null, to: { x: cur.x, y: cur.y }, presenting })
        if (cur) prev_cells[id] = { x: cur.x, y: cur.y }
        const now_dead = !!f.dead
        if (prev_dead[id] === true && now_dead === false) push({ kind: 'revive', id, presenting })
        prev_dead[id] = now_dead
      }
      if (prev_presenting && !presenting) push({ kind: 'queue_idle', presenting })
      prev_presenting = presenting
      const store_state = fight_store.getState() as any
      const dv = store_state?.divergence ?? null
      const dv_version = dv ? (dv.version ?? -1) : null
      if (dv && dv_version !== prev_divergence_version) {
        push({ kind: 'divergence', action: dv.action ?? null, version: dv.version, deferred: !!dv.deferred })
        prev_divergence_version = dv_version
      }
    }
    const unsubscribe_fight = fight_store.subscribe(on_fight)
    const on_message = (state: any) => {
      const presenting = !!view()?.presenting
      const messages = state.message_history ?? []
      for (const m of messages.slice(message_count))
        if (m.channel === 'CLIENT_COMBAT') push({ kind: 'combat_log', message: m.message, presenting })
      message_count = messages.length
    }
    w.__ARES_ENGINE.events.on('STATE_UPDATED', on_message)
    const seen_toasts = new Set<number>()
    const unsubscribe_toast = toast.event_toast_store.subscribe(() => {
      for (const t of toast.event_toast_store.get()) {
        if (seen_toasts.has(t.id)) continue
        seen_toasts.add(t.id)
        push({ kind: 'toast', state: t.state, title: t.title, message: t.message })
      }
    })
    w.__P0_OFF = () => {
      w.__ARES_ENGINE.events.off('STATE_UPDATED', on_message)
      unsubscribe_fight()
      unsubscribe_toast()
    }
  })
}

async function read_rows(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__P0_ROWS ?? [])
}

// ── movement/formation geometry — copied from the proven in_turn_beats.spec.ts pattern (actively green),
//    retargeted onto the exported snapshot() shape (me/mobs/arena match 1:1).
function walkable(state: any, cell: Cell): boolean {
  const { arena } = state
  if (!arena || cell.x < 0 || cell.y < 0 || cell.x >= arena.width || cell.y >= arena.height) return false
  return arena.cells[cell.y * arena.width + cell.x] === 0
}

function path_to(state: any, target: Cell): Cell[] | null {
  const { me } = state
  if (!me || !state.arena) return null
  const occupied = new Set((state.mobs as any[]).filter((f) => !f.dead).map((f) => cell_key(f.cell)))
  const queue: Array<{ cell: Cell; path: Cell[] }> = [{ cell: me.cell, path: [] }]
  const seen = new Set([cell_key(me.cell)])
  while (queue.length) {
    const current = queue.shift()!
    if (cell_key(current.cell) === cell_key(target)) return current.path
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const cell = { x: current.cell.x + dx, y: current.cell.y + dy }
      const key = cell_key(cell)
      if (!walkable(state, cell) || occupied.has(key) || seen.has(key)) continue
      seen.add(key)
      queue.push({ cell, path: [...current.path, cell] })
    }
  }
  return null
}

function find_formation(state: any): Formation | null {
  const { me } = state
  if (!me || !state.arena) return null
  const occupied = new Set(([me, ...state.mobs] as any[]).filter((f) => !f.dead).map((f) => cell_key(f.cell)))
  const candidates: Formation[] = []
  for (const mob of (state.mobs as any[]).filter((f) => !f.dead)) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const stage = { x: mob.cell.x - dx, y: mob.cell.y - dy }
      const trap = { x: mob.cell.x + dx, y: mob.cell.y + dy }
      if (!walkable(state, stage) || !walkable(state, trap)) continue
      if (occupied.has(cell_key(stage)) && cell_key(stage) !== cell_key(me.cell)) continue
      if (occupied.has(cell_key(trap))) continue
      const path = path_to(state, stage)
      if (path) candidates.push({ mob, stage, trap, direction: { x: dx, y: dy }, path })
    }
  }
  candidates.sort((a, b) => a.path.length - b.path.length)
  return candidates[0] ?? null
}

/** Click END TURN and RECORD the native tx outcome. On success, wait out the mob wave (the render-path proof); on
 *  any failure, skip the wave wait (there is none) and return the classified row so the beat can decide to retry. */
async function commit_once(page: Page, beat: string): Promise<TxRow> {
  const seq_before = await trace_seq(page)
  const t0 = Date.now()
  const end = page.locator('.hud-fightctl__end')
  // A finishing kill can auto-flush (D37a) and unmount END TURN before the click — tolerate a vanished button
  // (the background auto-commit still traces its terminal), otherwise press it human-shaped.
  if (await end.isVisible().catch(() => false)) {
    await expect(end)
      .toBeEnabled({ timeout: 12_000 })
      .catch(() => {})
    if (await end.isEnabled().catch(() => false)) await human_click_locator(page, end)
  }
  await expect
    .poll(
      async () =>
        (await read_trace(page))
          .filter((r) => r.sequence > seq_before)
          .some((r) => /^commit_(finished|failed|rejected_locally|auto_blocked)$/.test(String(r.event))),
      { timeout: 45_000, message: `no terminal commit trace after END TURN on beat ${beat}` }
    )
    .toBe(true)
  const window_rows = (await read_trace(page)).filter((r) => r.sequence > seq_before)
  const row = classify(beat, window_rows, await divergence_since(page, t0))
  if (row.ok) {
    // The confirmed turn folds a mob wave — observe it present, then drain (never let a masking wave hide a regress).
    await expect
      .poll(() => snapshot(page).then((s) => s.presenting || !s.mobs.some((m) => !m.dead)), { timeout: 30_000 })
      .toBe(true)
      .catch(() => {})
    await expect
      .poll(() => snapshot(page).then((s) => !s.presenting), { timeout: 60_000 })
      .toBe(true)
      .catch(() => {})
  }
  return row
}

/** Commit a single-action beat and RECORD it. On lock-contention (a ZERO-gas pre-exec refusal that rolls the
 *  draft back) retry the BEAT ONCE: wait, re-stage the action, re-commit. BOTH rows land in the artifact — the
 *  first refusal is a P0 finding, not noise. An executed failure (digest) is NEVER retried (burn law). */
async function commit_beat(page: Page, beat: string, stage: () => Promise<void>): Promise<TxRow> {
  let row = await commit_once(page, beat)
  tx_rows.push(row)
  if (row.status === 'lock-contention') {
    await page.waitForTimeout(2_500)
    await wait_player_turn(page).catch(() => {})
    await stage().catch(() => {})
    row = { ...(await commit_once(page, beat)), attempt: 2 }
    tx_rows.push(row)
  }
  return row
}

/** BEAT ② — walk toward `target` across up to `max_turns` player turns; MP>1 covers SEVERAL cells per commit
 *  (the script's literal "walk"). Self-heals a lock-contention: a refused move never advances me.cell, so the next
 *  loop iteration re-paths and re-commits. Every commit is recorded into the tx column, tagged `beat`. */
async function walk_multi_cell(page: Page, target: Cell, max_turns: number, beat: string) {
  for (let turn = 0; turn < max_turns; turn += 1) {
    await wait_player_turn(page)
    const state = await snapshot(page)
    const me = state.me!
    if (cell_key(me.cell) === cell_key(target)) return state
    const path = path_to(state, target)
    expect(path, `no walkable path from ${cell_key(me.cell)} to ${cell_key(target)}`).toBeTruthy()
    const step_count = Math.max(1, Math.min(me.mp, path!.length))
    const destination = path![step_count - 1]
    expect(state.armed, 'a move click must begin with no spell armed').toBeNull()
    const pressed = await click_cell(page, destination)
    if (pressed !== 'pressed') continue // never aligned — the next turn's poll retries fresh
    tx_rows.push(await commit_once(page, beat))
  }
  return snapshot(page)
}

test.describe('P0 RECORDED REPRO — v35 fight-sync regression, reported verbatim script', () => {
  test.skip(!manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed @lagged P0 SCRIPT · trap, walk, escape, tackle, push-into-trap, stays dead', async ({ page }) => {
    test.setTimeout(560_000)
    const beats: BeatRow[] = []
    // FIXTURE — the `win` world (Razkin hp12, ideal for a one-combo push-kill) proved ENGAGE-HOSTILE under the
    // lagged rig: boot searched it into a canopy_jungle-over-water zone where all mob groups render "floated / no
    // dry footing" (nodes=0/48 interactive scene nodes), so spawn_point can never project a claimable rig (90s
    // timeout — attempt 1). `multi_turn` (Strawman hp30) is the @lagged-ENGAGE-PROVEN dry world (fight_record_verify
    // is green under lagged on it), so it RELIABLY reaches the beats — the tx-outcome column's whole point. hp30
    // survives one push+trap (≈9-13 dmg), so beat ⑥'s kill/stays-dead sub-check is tolerant (OBSERVED, not FAIL);
    // the rollback / trap-flicker / turn-not-validated symptoms (the reported dominant complaints) are fully tested
    // across every fold regardless. The kill-specific stays-dead check wants a low-HP mob in a dry world (follow-up).
    const fixture = manifest.fight_fixtures?.multi_turn as FightFixture | undefined
    const [, wallet] = manifest.wallets as GoldWallet[] // wallet[1] = yajin (CLASSES[1] in up_gold.mjs)
    expect(fixture, 'gold bootstrap did not publish fight_fixtures.multi_turn (Strawman)').toBeTruthy()
    expect(wallet, 'gold bootstrap did not publish wallet 1 (yajin)').toBeTruthy()

    let mob_id = ''
    let formation: Formation | null = null
    let first_fail: string | null = null
    const note_first_fail = (msg: string) => {
      if (!first_fail) first_fail = msg
    }

    // ── ALWAYS-WRITE ARTIFACT — the attempt-1 dark-death cure. Runs on EVERY exit path (boot lock, beat throw,
    //    clean finish) so the tx-outcome column + recorder rows are never lost. Beside the video AND under out/.
    const write_artifact = async () => {
      const all_rows = await read_rows(page).catch(() => [] as any[])
      const trace = await read_trace(page).catch(() => [] as any[])
      const status_counts = tx_rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1
        return acc
      }, {})
      const divergences = all_rows.filter((r) => r.kind === 'divergence')
      const turn_lost_toasts = all_rows.filter(
        (r) => r.kind === 'toast' && r.state === 'error' && String(r.title ?? '').includes('Turn lost')
      )
      const board_corrected_toasts = all_rows.filter(
        (r) => r.kind === 'toast' && String(r.message ?? r.title ?? '').includes('board was corrected')
      )
      const payload = {
        script: 'yajin — trap · walk · escape · tackle · push-into-trap · stays-dead',
        beats,
        tx_outcomes: tx_rows,
        tx_status_counts: status_counts,
        first_failing_beat: first_fail,
        divergences,
        turn_lost_toasts,
        board_corrected_toasts,
        recorder_rows: all_rows,
        fight_state_trace: trace,
      }
      const json = JSON.stringify(payload, null, 2)
      fs.mkdirSync(OUT_DIR, { recursive: true })
      fs.writeFileSync(path.join(OUT_DIR, 'p0_tx_outcomes.json'), json)
      // Beside the video: the per-test video dir (best-effort — the file finalizes on context close, the dir exists now).
      const video_path = await page
        .video()
        ?.path()
        .catch(() => null)
      if (video_path) {
        fs.mkdirSync(path.dirname(video_path), { recursive: true })
        fs.writeFileSync(path.join(path.dirname(video_path), 'p0_tx_outcomes.json'), json)
      }
      console.log('[p0-owner-script] TX-OUTCOME COLUMN:', JSON.stringify(status_counts))
      for (const r of tx_rows)
        console.log(
          `  tx[${r.beat}#${r.attempt}] ${r.status.padEnd(16)} digest=${r.digest ?? '—'} ${r.error ? `· ${r.error.slice(0, 120)}` : ''}`
        )
      console.log('[p0-owner-script] BEAT TABLE:')
      for (const b of beats) console.log(`  [${b.beat}] ${b.status.padEnd(12)} ${b.label} — ${b.note}`)
      console.log(`[p0-owner-script] artifact: ${path.join(OUT_DIR, 'p0_tx_outcomes.json')}`)
    }

    try {
      // BOOT — the proven resilient path (join → checkpoint-settle → zone search → STALE-FIGHT recovery). Wrapped
      // so a search lock (the attempt-1 killer) records a boot row + is classified, then re-thrown — never dark.
      try {
        // wallet[1]'s ROSTER order is not slot order — join_fixture_world defaults to rows[0] = the slot-1
        // TOMODA (0x9014…, spells Beast Ward/Ghost Talon/Lashline), NOT the yajin. Pass the slot-0 YAJIN
        // character id (manifest.characters wallet_index:1 slot:0) so the trap/push script has its spells.
        await boot_fixture_world(
          page,
          wallet,
          fixture!,
          '0xa7d35ac9bade1f8953de4896215666d7dc4ab7247ee3cdda1a0e035223ed0c4f'
        )
      } catch (error: any) {
        const msg = String(error?.message ?? error)
        const status: TxStatus = LOCK_RE.test(msg)
          ? 'lock-contention'
          : RESERVE_RE.test(msg)
            ? 'reserve-refused'
            : 'never-landed'
        tx_rows.push({
          beat: 'boot/search_zone',
          attempt: 1,
          turn_key: null,
          digest: null,
          status,
          receipt_status: null,
          ok: false,
          error: msg.slice(0, 500),
          at_ms: Date.now(),
        })
        note_first_fail(`BOOT search_zone ${status}: ${msg.slice(0, 200)}`)
        throw error
      }
      const spawn_id = await engage_by_mouse(page, fixture!)
      await install_recorder(page)

      // PLACEMENT — a cell a few tiles from the mob so the approach genuinely "walks" (several cells).
      await expect.poll(() => snapshot(page).then((s) => s.placement)).toBe(true)
      let state = await snapshot(page)
      const mob0 = state.mobs.find((m) => !m.dead)!
      mob_id = mob0.id
      const occupied = new Set(state.mobs.filter((m) => !m.dead).map((m) => cell_key(m.cell)))
      const scored = state.placement_cells
        .filter((c) => !occupied.has(cell_key(c)))
        .map((c) => ({ c, d: Math.abs(c.x - mob0.cell.x) + Math.abs(c.y - mob0.cell.y) }))
        .sort((a, b) => Math.abs(a.d - 3) - Math.abs(b.d - 3))
      const place = scored[0]?.c ?? state.me!.cell
      // PLACEMENT ROBUST (attempt-2 fix): me.cell is the CHAIN participant cell and does NOT optimistically
      // reflect a placement pick (resolve_seat orphan — the SAME class as move_target-vs-me.cell in draft_move,
      // proven in the b5 pass). The LOCAL pick truth is use_dungeon_turn.placement_pick — assert THAT, not
      // me.cell (the attempt-1 blocker: me.cell stayed at spawn 3:0 while the pick was what actually registered).
      const read_pick = (): Promise<Cell | null> =>
        page.evaluate(async () => {
          const [{ use_dungeon_turn }, { decode }] = await Promise.all([
            import('/src/game/screens/dungeon-turn.js'),
            import('/@id/@aresrpg/fight'),
          ])
          const p = (use_dungeon_turn.getState() as any).placement_pick
          return p == null ? null : (decode(p) as Cell)
        })
      const candidates = scored.map((s) => s.c).slice(0, 6)
      if (!candidates.length) candidates.push(place)
      let picked: Cell | null = null
      for (const cand of candidates) {
        const pressed = await click_cell(page, cand)
        const pick = pressed === 'pressed' ? await read_pick().catch(() => null) : null
        console.log(
          `[p0] placement try ${cell_key(cand)}: pressed=${pressed} placement_pick=${pick ? cell_key(pick) : 'null'} me=${cell_key((await snapshot(page)).me!.cell)}`
        )
        if (pick) {
          picked = pick
          break
        }
      }
      // A never-registered placement pick under lag IS the reported "clicking doesn't move" — record it as beat 0,
      // but keep going (READY may still place at a default) so the 6 beats still get recorded.
      beats.push({
        beat: '0',
        label: 'PLACEMENT pick registers (local placement_pick)',
        status: picked ? 'PASS' : 'FAIL',
        note: picked
          ? `placement_pick=${cell_key(picked)} after ${candidates.length} candidate(s)`
          : `NO placement_pick registered after ${candidates.length} verified presses — dead placement click under lagged`,
      })
      if (!picked)
        note_first_fail(
          `PLACEMENT: no placement_pick registered after ${candidates.length} verified presses (dead placement click under lagged)`
        )
      await human_click_locator(page, page.locator('.hud-fightctl__ready'))
      await expect.poll(() => snapshot(page).then((s) => !s.placement), { timeout: 60_000 }).toBe(true)

      // ── BEAT ② — WALK toward the mob (several cells) until adjacent, deriving the push formation en route.
      await wait_player_turn(page)
      state = await snapshot(page)
      const seed_formation = find_formation(state)
      expect(seed_formation, 'no reachable player→mob→trap formation exists on this board').toBeTruthy()
      formation = seed_formation!
      const before_walk = state.me!.cell
      await walk_multi_cell(page, formation.stage, 8, '2')
      state = await snapshot(page)
      const reached_stage = cell_key(state.me!.cell) === cell_key(formation.stage)
      beats.push({
        beat: '2',
        label: 'WALK (move several cells)',
        status: reached_stage ? 'PASS' : 'FAIL',
        note: `from ${cell_key(before_walk)} to ${cell_key(state.me!.cell)} (target stage ${cell_key(formation.stage)})`,
      })
      if (!reached_stage)
        note_first_fail(
          `BEAT 2 WALK: never reached stage ${cell_key(formation.stage)} (at ${cell_key(state.me!.cell)})`
        )
      expect(reached_stage, `never reached the formation stage cell ${cell_key(formation.stage)}`).toBe(true)

      // ── BEAT ① — CAST A TRAP on the pre-derived trap cell (Fanged Snare — yajin unlock-1, ap 2, free-cell).
      await wait_player_turn(page)
      const before_trap = await snapshot(page)
      const stage_trap = async () => {
        const snare = page.getByRole('button', { name: 'Fanged Snare', exact: true })
        await expect(snare, 'full-corpus Yajin must carry Fanged Snare at level 1').toBeEnabled()
        await snare.click()
        await expect.poll(() => snapshot(page).then((s) => s.armed)).toBe('fanged_snare')
        expect(
          await click_cell(page, formation!.trap),
          `Fanged Snare aim never aligned a verified press pixel on ${cell_key(formation!.trap)}`
        ).toBe('pressed')
      }
      await stage_trap()
      const ap_after_arm = await snapshot(page).then((s) => s.me?.ap)
      const trap_commit = await commit_beat(page, '1', stage_trap)
      const extra_after_trap = await read_extra(page)
      const trap_live = extra_after_trap.my_traps.some((c) => cell_key(c) === cell_key(formation!.trap))
      beats.push({
        beat: '1',
        label: 'CAST A TRAP on a cell',
        status: trap_live ? 'PASS' : 'FAIL',
        note: `armed AP=${before_trap.me!.ap}→${ap_after_arm} (cost 2); tx=${trap_commit.status}; my_traps live=${trap_live} at ${cell_key(formation.trap)}`,
      })
      if (!trap_live)
        note_first_fail(
          `BEAT 1 TRAP: Fanged Snare on ${cell_key(formation.trap)} never appeared live (commit ${trap_commit.status})`
        )
      expect(trap_live, `Fanged Snare cast on ${cell_key(formation.trap)} never appeared live in my_traps`).toBe(true)

      // FLIP-GREEN SCOPE (coordinator): beat-1 trap-persist-through-the-mob-wave IS the cured-code verdict — stop
      // here, because a GREEN path (trap persists) would otherwise run beats 3-6 and blow the 10-min foreground cap.
      if (process.env.P0_BEAT1_ONLY === '1') return

      // ── BEAT ③ / ④ — TRY TO ESCAPE the adjacent mob → GET TACKLED (or escape) via the ordinary-movement
      //    contest (apply_move fires it automatically when adjacent enemies exist). Bounded ≤3 attempts.
      let escape_attempted = false
      let tackled_observed = false
      let escape_note = ''
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await wait_player_turn(page)
        state = await snapshot(page)
        const live_mob = state.mobs.find((m) => m.id === mob_id)
        if (!live_mob || live_mob.dead) break
        const distance = Math.abs(state.me!.cell.x - live_mob.cell.x) + Math.abs(state.me!.cell.y - live_mob.cell.y)
        if (distance !== 1) {
          await walk_multi_cell(page, formation.stage, 4, '3')
          continue
        }
        escape_attempted = true
        const before_e = await snapshot(page)
        await draft_move(page, true, 'away')
        const e_commit = await commit_once(page, '3')
        tx_rows.push(e_commit)
        const after_e = await snapshot(page)
        const extra_e = await read_extra(page)
        const stayed = cell_key(after_e.me!.cell) === cell_key(before_e.me!.cell)
        const resource_lost = after_e.me!.ap < before_e.me!.ap || after_e.me!.mp < before_e.me!.mp
        const divergence_tackled = String(extra_e.divergence?.action ?? '').startsWith('Tackled:')
        const tackled = stayed && (resource_lost || divergence_tackled)
        escape_note = `attempt ${attempt + 1}: ${
          tackled ? 'TACKLED' : stayed ? 'DEAD-CLICK (no move, no resource loss)' : 'ESCAPED'
        } (ap ${before_e.me!.ap}→${after_e.me!.ap}, mp ${before_e.me!.mp}→${after_e.me!.mp}, cell ${cell_key(before_e.me!.cell)}→${cell_key(after_e.me!.cell)}, tx ${e_commit.status})`
        if (tackled) {
          tackled_observed = true
          break
        }
      }
      beats.push({
        beat: '3',
        label: 'TRY TO ESCAPE the fight (walk away)',
        status: escape_attempted ? 'PASS' : 'FAIL',
        note: escape_note || 'never reached an adjacent-to-mob state to attempt an escape',
      })
      if (!escape_attempted) note_first_fail('BEAT 3 ESCAPE: never reached adjacency to attempt an escape')
      beats.push({
        beat: '4',
        label: 'GET TACKLED by an adjacent mob',
        status: tackled_observed ? 'OBSERVED' : 'NOT-OBSERVED',
        note: tackled_observed
          ? escape_note
          : 'the tackle contest is a real agility roll — escaping every attempt is a legal outcome, not a bug',
      })

      // Trap-persistence checkpoint: it must still be live BEFORE the push (survived the walk + escape folds).
      const extra_pre_push = await read_extra(page)
      const trap_persisted = extra_pre_push.my_traps.some((c) => cell_key(c) === cell_key(formation.trap))
      if (!trap_persisted)
        note_first_fail(`TRAP PERSIST: Fanged Snare at ${cell_key(formation.trap)} vanished before the push`)
      expect(
        trap_persisted,
        `Fanged Snare at ${cell_key(formation.trap)} vanished before the push beat — did not persist across the walk + escape folds`
      ).toBe(true)

      // ── BEAT ⑤ — PUSH the mob INTO the trap (Gutterknife — melee, damage + K_PUSH 2). Re-derive the formation
      // fresh if the mob drifted off the placed trap's line; cast a second Snare at the fresh trap cell if needed.
      state = await snapshot(page)
      let mob = state.mobs.find((m) => m.id === mob_id)
      expect(mob && !mob.dead, 'the tracked mob died before the push beat could run').toBeTruthy()
      let push_formation = formation
      const aligned =
        Math.abs(mob!.cell.x - formation.trap.x) + Math.abs(mob!.cell.y - formation.trap.y) === 1 &&
        Math.abs(mob!.cell.x - formation.stage.x) + Math.abs(mob!.cell.y - formation.stage.y) === 1
      if (!aligned) {
        const fresh = find_formation(state)
        expect(fresh, 'mob drifted off the placed trap and no fresh push formation is reachable').toBeTruthy()
        push_formation = fresh!
        if (cell_key(push_formation.trap) !== cell_key(formation.trap)) {
          await walk_multi_cell(page, push_formation.stage, 6, '5')
          await wait_player_turn(page)
          const stage_snare2 = async () => {
            const snare2 = page.getByRole('button', { name: 'Fanged Snare', exact: true })
            await expect(snare2).toBeEnabled()
            await snare2.click()
            await expect.poll(() => snapshot(page).then((s) => s.armed)).toBe('fanged_snare')
            expect(await click_cell(page, push_formation.trap)).toBe('pressed')
          }
          await stage_snare2()
          tx_rows.push(await commit_beat(page, '5', stage_snare2))
        }
      }
      await walk_multi_cell(page, push_formation.stage, 6, '5')
      await wait_player_turn(page)
      state = await snapshot(page)
      mob = state.mobs.find((m) => m.id === mob_id)
      expect(mob && !mob.dead, 'the tracked mob died/vanished before the push cast').toBeTruthy()
      const stage_push = async () => {
        const gutterknife = page.getByRole('button', { name: 'Gutterknife', exact: true })
        await expect(gutterknife, 'full-corpus Yajin must carry Gutterknife at level 1').toBeEnabled()
        await gutterknife.click()
        await expect.poll(() => snapshot(page).then((s) => s.armed)).toBe('gutterknife')
        expect(
          await click_cell(page, mob!.cell),
          `Gutterknife aim never aligned a verified press pixel on ${cell_key(mob!.cell)}`
        ).toBe('pressed')
      }
      await stage_push()
      const push_commit = await commit_beat(page, '5', stage_push)
      beats.push({
        beat: '5',
        label: 'PUSH a mob INTO the trap',
        status: push_commit.status === 'lock-contention' || push_commit.status === 'never-landed' ? 'FAIL' : 'PASS',
        note: `Gutterknife on ${cell_key(mob!.cell)} from stage ${cell_key(push_formation.stage)}, trap ${cell_key(push_formation.trap)}; tx=${push_commit.status}`,
      })
      if (push_commit.status === 'lock-contention' || push_commit.status === 'never-landed')
        note_first_fail(
          `BEAT 5 PUSH: commit ${push_commit.status}${push_commit.error ? ` · ${push_commit.error.slice(0, 120)}` : ''}`
        )

      // ── BEAT ⑥ — VERIFY: if the sim kills it, it STAYS DEAD across ≥3 subsequent folds. Fast 400ms poll +
      // the recorder's synchronous kind:'revive' — read BOTH so a brief revive-then-redie is never missed.
      const death_samples: Array<{ at: number; dead: boolean | null }> = []
      const deadline = Date.now() + 25_000
      let trap_triggered = false
      let saw_dead = false
      while (Date.now() < deadline) {
        const s = await snapshot(page)
        const row = s.mobs.find((m) => m.id === mob_id)
        death_samples.push({ at: Date.now(), dead: row ? row.dead : null })
        if (row?.dead) saw_dead = true
        const rows_now = await read_rows(page)
        if (rows_now.some((r) => r.kind === 'combat_log' && /triggered a trap for \d+/.test(r.message ?? '')))
          trap_triggered = true
        if (saw_dead && death_samples.length >= 5) break
        await page.waitForTimeout(400)
      }
      const rows = await read_rows(page)
      const revive_rows = rows.filter((r) => r.kind === 'revive' && r.id === mob_id)
      const dead_flip_regression = death_samples.some(
        (s, i) => i > 0 && death_samples[i - 1].dead === true && s.dead === false
      )
      const stays_dead = saw_dead && revive_rows.length === 0 && !dead_flip_regression
      const mob_now = (await snapshot(page)).mobs.find((m) => m.id === mob_id)
      beats.push({
        beat: '6',
        label: 'VERIFY pushed mob dies AND stays dead',
        status: saw_dead ? (stays_dead ? 'PASS' : 'FAIL') : 'OBSERVED',
        note: `trap_triggered=${trap_triggered} saw_dead=${saw_dead} mob_hp_now=${mob_now?.health ?? '—'} recorder_revives=${revive_rows.length} poll_flip=${dead_flip_regression} samples=${death_samples.length}${saw_dead ? '' : ' · hp30 Strawman survives one push+trap (≈9-13 dmg) — kill/stays-dead N/A on this fixture'}`,
      })
      // The KILL is not guaranteed on an hp30 mob, so a no-kill is OBSERVED, never a hard FAIL. But the reported
      // "dying then rolled back alive" regression IS asserted the instant a real kill lands: a revive/dead-flip on
      // a mob that DID register dead is the bug. A survival simply leaves stays-dead untested on this fixture.
      if (saw_dead && !stays_dead)
        note_first_fail(
          `BEAT 6 STAYS-DEAD: mob REVIVED (recorder_revives=${revive_rows.length} poll_flip=${dead_flip_regression}) — the roll-back-alive regression`
        )
      if (saw_dead) {
        expect(
          revive_rows.length,
          `the recorder observed ${revive_rows.length} revive event(s) on the killed mob — this IS the "dying then rolled back alive" regression`
        ).toBe(0)
        expect(dead_flip_regression, 'a poll sample saw dead=true then a LATER sample saw dead=false').toBe(false)
      }

      // ── CROSS-CUTTING REGRESSION SIGNALS — the store's own reconcile-divergence + turn-lost toasts. ANY firing
      // during a scripted, deliberate sequence this short is itself evidence of the regression.
      const all_rows = await read_rows(page)
      const divergences = all_rows.filter((r) => r.kind === 'divergence')
      const turn_lost_toasts = all_rows.filter(
        (r) => r.kind === 'toast' && r.state === 'error' && String(r.title ?? '').includes('Turn lost')
      )
      if (divergences.length)
        note_first_fail(`RECONCILE DIVERGENCE ×${divergences.length}: ${JSON.stringify(divergences[0])}`)
      if (turn_lost_toasts.length)
        note_first_fail(`TURN LOST ×${turn_lost_toasts.length}: ${JSON.stringify(turn_lost_toasts[0])}`)
      void spawn_id
      expect(
        divergences.length,
        `the store logged ${divergences.length} reconcile-divergence event(s): ${JSON.stringify(divergences)}`
      ).toBe(0)
      expect(
        turn_lost_toasts.length,
        `${turn_lost_toasts.length} turn(s) were lost/not-validated on-chain: ${JSON.stringify(turn_lost_toasts)}`
      ).toBe(0)
    } finally {
      // ARTIFACT FIRST — always, before any cleanup, so a mid-beat throw still yields the tx column + video.
      await write_artifact().catch((e) => console.log('[p0-owner-script] artifact write failed:', String(e)))
      await page.evaluate(() => (window as any).__P0_OFF?.()).catch(() => {})
      const victory = page.locator('[role="dialog"][aria-label^="Victory:"]')
      const defeat = page.locator('[role="dialog"][aria-label^="Defeat:"]')
      if (
        await victory
          .or(defeat)
          .first()
          .isVisible({ timeout: 5_000 })
          .catch(() => false)
      ) {
        await page
          .getByRole('button', { name: 'Continue', exact: true })
          .click({ timeout: 10_000 })
          .catch(() => {})
        const later = page.getByRole('button', { name: 'Later', exact: true })
        if (await later.isVisible({ timeout: 2_000 }).catch(() => false)) await later.click().catch(() => {})
      } else {
        await page
          .evaluate(async () => {
            const { use_dungeon } = await import('/src/world-shell/dungeon_store.js')
            if ((await import('/@id/@aresrpg/fight')).fight_view()) await use_dungeon.getState().abandon_fight()
          })
          .catch(() => {})
      }
    }
  })
})
