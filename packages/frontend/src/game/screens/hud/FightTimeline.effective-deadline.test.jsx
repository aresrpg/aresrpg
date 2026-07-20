// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIX 2 — the VISIBLE turn timer must count to the EFFECTIVE deadline (deadline − COMMIT_BUFFER_MS) while I hold
// a live draft, so it never reads "time left" after the draft has already auto-committed. This is
// the DISPLAY proof: FightTimeline rendered through the REAL stores (renderToStaticMarkup, the FightReport.test
// harness — no jsdom) with the SAME fight seeded twice, differing ONLY by whether a draft exists. The whole-second
// buffer shifts rendered ceil-seconds exactly, so the assertion is timing-independent.
// The pure effective_deadline math is locked separately in draft-budget.test.js; this proves the WIRING reaches
// the DOM.

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FightTimeline } from './FightTimeline.jsx'
import { seed_fight_core, reset_fight_core } from '../../../test_helpers/fight_core_harness.js'
import { COMMIT_BUFFER_MS } from '@aresrpg/fight/draft_budget'
import { fight_store } from '@aresrpg/fight/store'

const ME = '0xme'

const stage_draft = (cell) => fight_store.getState().input({ type: 'stage', intent: { kind: 0, target: cell } })
const unstage_draft = () => fight_store.getState().input({ type: 'clear_staged' })

// Seed a live, my-turn fight through the CORE's own input door (S2 mirror kill: components read the projected
// view synchronously — no async dispatch pump to await anymore). Deadline sits MID-second (+30_500ms) so
// neither render lands on a ceil boundary.
const seed_my_turn_fight = (deadline_ms) =>
  seed_fight_core({ fight_id: 'fight-test', my: ME, active: ME, turn_deadline_ms: deadline_ms })

const timer_seconds = (html) => {
  const m = html.match(/hud-turn__timer-num[^>]*>(\d+)s</)
  return m ? Number(m[1]) : null
}

// turn_order = [seat(s)…, mob(s)…] (seed_fight_core's queue) → the 2nd hp-num match is the lone default mob's card.
const hp_numbers = (html) => [...html.matchAll(/hud-turn__hp-num[^>]*>(\d+)</g)].map((m) => Number(m[1]))

afterEach(() => {
  unstage_draft()
})

afterAll(reset_fight_core) // the core is a process-wide singleton — leave no live fight for later test files

describe('FightTimeline — the visible timer counts to the EFFECTIVE deadline while a draft exists', () => {
  test('a live draft shows a countdown one COMMIT_BUFFER_MS shorter than the raw-deadline idle turn', async () => {
    seed_my_turn_fight(Date.now() + 30_500)

    // IDLE (no draft) → counts to the RAW deadline.
    unstage_draft()
    const idle_secs = timer_seconds(renderToStaticMarkup(<FightTimeline />))

    // DRAFT (a drafted move step) → counts to deadline − COMMIT_BUFFER_MS (the auto-commit moment).
    stage_draft(42)
    const draft_secs = timer_seconds(renderToStaticMarkup(<FightTimeline />))

    expect(idle_secs).not.toBeNull()
    expect(draft_secs).not.toBeNull()
    // the honest clock ends at the same buffered auto-submit point — no "time left but locked".
    expect(idle_secs - draft_secs).toBe(COMMIT_BUFFER_MS / 1000)
  })

  test('with no draft the timer renders at all (the active card owns it) — a control for the diff above', async () => {
    seed_my_turn_fight(Date.now() + 30_500)
    unstage_draft()
    const html = renderToStaticMarkup(<FightTimeline />)
    expect(html).toContain('hud-turn__timer-num')
    expect(timer_seconds(html)).toBeGreaterThan(0)
  })

})

// engine_view (packages/fight project.js, LEG P) exposes `presented_health` on every fighter: the paced fold while
// a wave presents, the CHAIN-COMMITTED value once idle — deliberately conservative over `health` (the effective/
// predicted fold, which includes MY OWN not-yet-confirmed optimistic intents). Ground-truthed against engine_view
// directly before writing this fixture: a literal "wave presenting" receipt does NOT diverge the two fields (both
// read the SAME paced source while `presenting` is true, per the project.js formula) — the divergence that exists
// to prove is IDLE, with an unconfirmed local prediction on the board. That is the fixture below.
describe('FightTimeline — the HP card reads presented_health (chain-anchored), not my own unconfirmed prediction', () => {
  test('a not-yet-committed optimistic Hit on the mob holds the card at last-COMMITTED hp, not the predicted one', () => {
    seed_my_turn_fight(Date.now() + 90_000) // default seed: my seat 50 hp, one mob ('mob-0') at 30 hp

    // MY OWN optimistic cast prediction against the mob — source 'intent', excluded from committed_state until a
    // receipt lands (the exact shape packages/fight/src/optimistic_hp.test.js locks for this input door).
    fight_store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: 105, damaging: true }, version: 2, event_idx: 0 })
    fight_store.getState().input({
      type: 'intent',
      intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 10 },
      version: 2,
      event_idx: 1,
    })

    const mob_hp = hp_numbers(renderToStaticMarkup(<FightTimeline />))[1]
    expect(mob_hp, 'the card holds committed truth (30) — never the unconfirmed predicted 10').toBe(30)
  })
})
