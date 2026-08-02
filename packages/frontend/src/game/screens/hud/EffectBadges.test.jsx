// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// (#451) ACTIVE EFFECT ROWS — the turn card renders the same visible localized rows as the board hover:
// effect name/value + remaining turns, directly in the card rather than hidden inside a nested tooltip.
//
// engine_view.fighters[].effects (packages/fight/src/project.js `effects_of`, LEG Q) is the live per-fighter
// effect+duration list this component renders — wired via the one-line prop-pass in FightTimeline.jsx
// (`f.effects`). This suite proves the pure projection (effect_badge_view) + the render output against
// fixtures shaped exactly like that getter's rows.

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { status_row_of } from '@aresrpg/fight/statuses'
import { normalize_chain_spell_corpus } from '@aresrpg/sim/chain_spell_corpus'
import { find_entity } from '@aresrpg/sim/fight_state'
import { create_fight_state, reduce } from '@aresrpg/sim/reduce'

import en from '../../../i18n/locales/en.json'
import corpus from '../../../simulator/spell_corpus_l2.fixture.json'
import { EffectBadges, effect_badge_view } from './EffectBadges.jsx'

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = (key, params) => i18n.t(key, params)

const render = (effects) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <EffectBadges effects={effects} />
    </I18nextProvider>
  )
const text_of = (html) => html.replace(/<[^>]*>/g, '')

// fixture rows shaped exactly like the proposed engine_view getter: the raw chain FighterStatus + its nested
// Effect fields (spell_board.move FighterStatus{fighter,kind,effect,remaining_turns,source} flattened) — kind
// is the numeric spell_effect.move id (27 = INVISIBILITY, 9 = ALTER_STAT), never pre-decoded to a string.
const invisibility_2t = { id: 'st-1', kind: 27, remaining_turns: 2 }
const vitality_ward_3t = { id: 'st-2', kind: 9, stat: 5, value: 10, remaining_turns: 3 }
const poison_2t = { id: 'st-3', kind: 21, value: 2, remaining_turns: 2 }

describe('EffectBadges — compact persistent-effect rows on the turn card', () => {
  test('2 active effects render 2 visible localized rows with their values and remaining turns', () => {
    const html = render([invisibility_2t, vitality_ward_3t])
    const text = text_of(html)
    expect([...html.matchAll(/class="fxl"/g)]).toHaveLength(2)
    expect(text).toContain('Become invisible · 2 turns')
    expect(text).toContain('+10 Vitality · 3 turns')
  })

  test('0 active effects renders NOTHING — no empty container element', () => {
    expect(render([])).toBe('')
  })

  test('a missing effects prop (the getter not merged yet at HEAD) also renders nothing, never crashes', () => {
    expect(render(undefined)).toBe('')
  })

  // #2000 (D42) — a 0 counter is the row's LAST COVERED TURN, not an expired row: it is live on chain and owed a
  // badge. Expiry reaches this component as an ABSENT row (the fold's `age_statuses` drops it), never as a 0.
  // #2000 (D42) — the CAST WINDOW, the other end of the same arc: an authored-2 row that has not yet been aged
  // (another fighter holds the active turn) reads its authored number, never one more. This is what makes the
  // floor above a floor and not a blanket increment.
  test('a freshly cast row displays its authored duration, not one more', () => {
    expect(effect_badge_view(t, { id: 'cast', kind: 27, remaining_turns: 2 }).turns).toBe(2)
  })

  test('a row on its last covered turn (remaining_turns 0) still renders', () => {
    expect(render([{ id: 'last', kind: 27, remaining_turns: 0 }])).toContain('Become invisible')
  })

  test('every active projection row stays readable rather than collapsing behind an overflow count', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, kind: 27, remaining_turns: i + 1 }))
    const html = render(many)
    expect([...html.matchAll(/class="fxl"/g)]).toHaveLength(6)
    expect(text_of(html)).toContain('Become invisible · 6 turns')
  })

  test('effect_badge_view reuses the EXISTING spells.fx_invisibility house grammar — no invented copy', () => {
    const view = effect_badge_view(t, invisibility_2t)
    expect(view.turns).toBe(2)
    expect(view.label).toBe(t('spells.fx_invisibility') + ' · ' + t('spells.fx_turns', { count: 2 }))
  })

  test('effect_badge_view exposes the shared structured line view for the renderer', () => {
    const view = effect_badge_view(t, vitality_ward_3t)
    expect(view.view).toMatchObject({ pre: '+', value: '10', post: ' Vitality', meta: '3 turns' })
  })

  test('damage-over-time uses its projected element when present and omits a genuinely absent source', () => {
    expect(effect_badge_view(t, { ...poison_2t, element: 3 }).label).toBe('2 Air damage per turn · 2 turns')
    expect(effect_badge_view(t, poison_2t).label).toBe('2 damage per turn · 2 turns')
    expect(effect_badge_view(t, poison_2t).label).not.toContain('spells.')
  })

  test('#1744 Quakebed keeps one badge turn while its second damage tick fires', () => {
    const published = corpus.rows.find((spell) => spell.id === 'mori_quakebed')
    const base_level = published.levels[0]
    const quakebed = {
      ...published,
      levels: [{ ...base_level, crit_rate: 0, crit_effects: [] }],
    }
    const spell_templates = normalize_chain_spell_corpus([quakebed])
    const arena = {
      width: 11,
      height: 11,
      cells: new Uint8Array(121),
      spawns_a: [],
      spawns_b: [],
    }
    const fighter = (id, cell, is_player) => ({
      id,
      name: id,
      cell,
      health: 30,
      health_max: 30,
      ap: 6,
      ap_max: 6,
      mp: 3,
      mp_max: 3,
      ap_used: 0,
      mp_used: 0,
      is_player,
      template_id: is_player ? 'mori' : 'quakebed-target',
      level: 3,
      stats: {},
      effects: [],
      spell_levels: is_player ? { [quakebed.id]: 1 } : {},
      ap_reserve: 0,
    })
    const initial = create_fight_state({
      fight_id: 'quakebed-badge-boundary',
      arena_seed: 1744,
      arena_radius: 0,
      arena,
      team0: [fighter('p0', { x: 5, y: 5 }, true)],
      team1: [fighter('m0', { x: 6, y: 5 }, false)],
    })
    const ctx = { arena, spell_templates }
    let state = {
      ...initial,
      started: true,
      turn_order: ['p0', 'm0'],
      current_turn_idx: 0,
    }
    state = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: quakebed.id,
        target: { x: 5, y: 5 },
      },
      ctx,
    ).state

    // First victim turn: tick once, then end it. Cycle the caster so the second victim turn begins.
    state = reduce(
      state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    ).state
    state = reduce(
      state,
      { type: 'end_turn', entity_id: 'm0' },
      ctx,
    ).state
    const second_turn = reduce(
      state,
      { type: 'end_turn', entity_id: 'p0' },
      ctx,
    )
    const tick = second_turn.events
      .find((event) => event.type === 'fight_turn_effects')
      ?.effects.find((effect) => effect.target_id === 'm0')
    expect(tick).toMatchObject({ damage: 2, new_health: 26 })

    const dot = find_entity(second_turn.state, 'm0')?.effects
      .map(status_row_of)
      .find((row) => row?.kind === 21)
    expect(dot).toBeDefined()
    expect(effect_badge_view(t, dot).turns).toBe(1)
  })
})
