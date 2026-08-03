// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1993 WP2b item 2 — THE TIMELINE'S MY-TURN GATE IS THE SAME ONE THE CUE USES.
//
// FightTimeline's own header says its my-turn read is "the same my-turn gate TurnBanner.jsx uses for the 'turn'
// chime — the 5s tick is part of the SAME silence-zone contract (§3.2) so it must agree on whose turn counts as
// mine". TurnBanner moved to `fight.playable` (#1808); the timeline stayed on `!fight.presenting`. The two have
// disagreed ever since, and the comment asserting agreement was the load-bearing part of the lie.
//
// The gap is the POST-HANDOVER WINDOW: nothing is replaying locally (`presenting` false) but the chain is still
// spending the mob-resolution budget its own deadline was widened by. The rendered discriminator is the visible
// countdown: `has_draft = my_turn ∧ draft_count > 0` switches the clock between the raw deadline and the
// buffered auto-commit instant, so a wrong my_turn is a wrong number on screen.

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { COMMIT_BUFFER_MS } from '@aresrpg/fight/draft_budget'
import { fight_store } from '@aresrpg/fight/store'

import { FightTimeline } from '../../../../src/game/screens/hud/FightTimeline.jsx'
import { seed_fight_core, reset_fight_core } from '../../../../src/test_helpers/fight_core_harness.js'

const ME = '0xme'
const TURN_MS = 45_000
const MOB_RESOLVE_MS = 3_000 // actions.move: `deadline = start + turn_ms + 3s × resolved mobs`

const stage_draft = (cell) => fight_store.getState().input({ type: 'stage', intent: { kind: 0, target: cell } })
const unstage_draft = () => fight_store.getState().input({ type: 'clear_staged' })
const timer_seconds = (html) => {
  const m = html.match(/hud-turn__timer-num[^>]*>(\d+)s</)
  return m ? Number(m[1]) : null
}
const render = () => renderToStaticMarkup(createElement(FightTimeline))

/** My turn, widened by `mobs_replayed` mobs' resolution. The handover instant is `deadline − turn_ms`, so the
 *  −500ms lands an unwidened turn just PAST it (playable now) and every render mid-second, clear of a ceil
 *  boundary; a widened one sits `mobs × 3s` before it, the window the two gates disagree about. */
const seed_turn = ({ mobs_replayed }) =>
  seed_fight_core({
    fight_id: 'fight-handover',
    my: ME,
    active: ME,
    turn_ms: TURN_MS,
    turn_deadline_ms: Date.now() + TURN_MS - 500 + mobs_replayed * MOB_RESOLVE_MS,
  })

afterEach(unstage_draft)
afterAll(reset_fight_core) // the core is a process-wide singleton — leave no live fight for later test files

describe('#1993 — FightTimeline and TurnBanner agree on whose turn counts as mine', () => {
  test('an ordinary turn is mine in both homes — the buffered clock still arms', () => {
    seed_turn({ mobs_replayed: 0 })
    expect(fight_store.getState().turn_playable).toBe(true)
    const idle = timer_seconds(render())
    stage_draft(42)
    const drafted = timer_seconds(render())
    expect(idle).not.toBeNull()
    expect(idle - drafted, 'my turn ⇒ the clock counts to the auto-commit instant').toBe(COMMIT_BUFFER_MS / 1000)
  })

  test('the POST-HANDOVER WINDOW is NOT my turn — the timeline stops claiming it is', () => {
    // `presenting` is false here (nothing replaying) while the chain still owes four mobs' resolution. The old
    // `!fight.presenting` gate called this mine; `fight.playable` — TurnBanner's gate — does not.
    seed_turn({ mobs_replayed: 4 })
    expect(fight_store.getState().wave.length, 'nothing is replaying — only the chain budget is outstanding').toBe(0)
    expect(fight_store.getState().turn_playable, 'the chain has not handed the turn over').toBe(false)
    const idle = timer_seconds(render())
    stage_draft(42)
    const drafted = timer_seconds(render())
    expect(idle).not.toBeNull()
    expect(drafted, 'a turn that is not mine yet counts to the RAW deadline, buffer-free').toBe(idle)
  })

  test('the two gates are the same expression — the §3.2 silence-zone contract, in code', async () => {
    // `presenting` legitimately survives ELSEWHERE in the timeline (the presentation-synced active card and its
    // timer suppression read the eye's clock on purpose), so this compares the my_turn EXPRESSIONS, not the files.
    const my_turn_expr = async (path) => {
      const source = await Bun.file(new URL(path, import.meta.url)).text()
      const expr = source.match(/const my_turn =([\s\S]*?)\n\n/)?.[1]
      expect(expr, `no my_turn expression found in ${path}`).toBeDefined()
      return expr.replace(/\s+/g, ' ').trim()
    }
    const timeline = await my_turn_expr('../../../../src/game/screens/hud/FightTimeline.jsx')
    const banner = await my_turn_expr('../../../../src/game/screens/hud/TurnBanner.jsx')
    expect(timeline, 'the two silence-zone gates are one expression, character for character').toBe(banner)
    expect(timeline).toContain('fight.playable')
    expect(timeline, 'the pre-#1808 boundary is gone from the gate').not.toContain('presenting')
  })
})
