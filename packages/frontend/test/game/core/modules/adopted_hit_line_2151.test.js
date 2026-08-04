// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2151 (caster half, presentation) — THE ADOPTED AMOUNT REPLACES THE OPTIMISTIC LINE, ONCE.
//
// My own cast writes its combat-log line at the click, from the prediction. The #2145 dig caught the caster
// keeping that predicted number forever after logging `fight prediction diverged; authoritative action adopted`
// — the chain committed 8, the history said 7, and no later frame ever disagreed with itself out loud.
//
// The store now carries the priced correction on the divergence (see packages/fight — one pricing home, the same
// pre-receipt committed oracle a peer's own line is built from). This suite seals the two halves the presentation
// owes: the chat reducer ADMITS a correction as a REPLACEMENT (same id ⇒ rewrite in place, never a second row),
// and the corrector addresses the exact line the prediction wrote. No duplicate line, no stale 7.

import { describe, expect, test } from 'bun:test'

import chat, { CHANNEL } from '../../../../src/game/core/modules/chat.js'
import { emit_effect_line } from '../../../../src/game/core/modules/fight.js'
import { emit_hit_correction } from '../../../../src/game/core/modules/fight_log_correction.js'

const ME = '0xcaster'
const MOB = 'mob-0'

const fighters = () =>
  new Map([
    [ME, { name: 'canaryalice' }],
    [MOB, { name: 'Pecker the Widow' }],
  ])

/** A rig that folds every dispatched chat line through the REAL reducer, so replacement is proven end-to-end. */
const rig = () => {
  const module = chat()
  let state = { message_history: [], fight: { fighters: fighters() } }
  const dispatch = (type, payload) => {
    state = module.reduce(state, { type, payload })
  }
  return {
    dispatch,
    get_state: () => state,
    combat_lines: () => state.message_history.filter((row) => row.channel === CHANNEL.combat),
  }
}

describe('#2151 — an adopted authoritative amount corrects the history line it superseded', () => {
  test('the optimistic 7 becomes the authoritative 8 — one line, rewritten in place', () => {
    const { dispatch, get_state, combat_lines } = rig()
    emit_effect_line(get_state, dispatch, {
      entity_id: ME,
      effect: { target_id: MOB, damage: 7, has_health: true },
      is_critical: false,
    })
    expect(combat_lines(), 'the click wrote exactly one line').toHaveLength(1)
    expect(combat_lines()[0].message).toContain('7')
    const optimistic_id = combat_lines()[0].id

    emit_hit_correction(get_state, dispatch, {
      entity_id: ME,
      correction: { target_id: MOB, kind: 'damage', amount: 8 },
    })

    // RED at HEAD: `emit_hit_correction` does not exist, and the reducer would have APPENDED a second row.
    expect(combat_lines(), 'a correction replaces, it never re-plays').toHaveLength(1)
    expect(combat_lines()[0].id, 'the same row — history keeps its place in the stream').toBe(optimistic_id)
    expect(combat_lines()[0].message).toContain('8')
    expect(combat_lines()[0].message).not.toContain('7')
  })

  test('the corrector addresses the line for ITS victim, leaving another victim untouched', () => {
    const { dispatch, get_state, combat_lines } = rig()
    const hit = (target_id, damage) =>
      emit_effect_line(get_state, dispatch, { entity_id: ME, effect: { target_id, damage }, is_critical: false })
    hit('mob-1', 4)
    hit(MOB, 7)
    emit_hit_correction(get_state, dispatch, {
      entity_id: ME,
      correction: { target_id: MOB, kind: 'damage', amount: 8 },
    })
    expect(combat_lines()).toHaveLength(2)
    expect(combat_lines()[0].message, "the other victim's line is not this correction's business").toContain('4')
    expect(combat_lines()[1].message).toContain('8')
  })

  test('a correction with no line to address writes nothing — never a bare orphan number', () => {
    const { dispatch, get_state, combat_lines } = rig()
    emit_hit_correction(get_state, dispatch, {
      entity_id: ME,
      correction: { target_id: MOB, kind: 'damage', amount: 8 },
    })
    expect(combat_lines(), 'a correction is a REPLACEMENT instruction, not a producer of history').toEqual([])
  })

  test('the reducer still APPENDS an ordinary new line — replacement is by id, not a blanket collapse', () => {
    const { dispatch, get_state, combat_lines } = rig()
    emit_effect_line(get_state, dispatch, { entity_id: ME, effect: { target_id: MOB, damage: 7 }, is_critical: false })
    emit_effect_line(get_state, dispatch, { entity_id: ME, effect: { target_id: MOB, damage: 5 }, is_critical: false })
    expect(combat_lines(), 'two real hits are two rows').toHaveLength(2)
  })
})
