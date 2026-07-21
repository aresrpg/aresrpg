// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// (#301) RED-FIRST — active fight effects (buffs/debuffs) were tracked in fight state but rendered NOWHERE:
// no nametag indicator, no remaining-turns count. RED at HEAD: status_dot_view does not exist in
// tooltip_card.jsx and TooltipCard never renders a status row — this file proves the gap, then the projection
// + the render output that closes it. Pure-props (`t` rides in, renderToStaticMarkup — no jsdom, no store),
// same convention as entity_tooltip_render.test.jsx.

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { status_dot_view, TooltipCard } from './tooltip_card.jsx'

const t = (key) => key // stub — status_dot_view's colour never depends on the translated STRING (see seed-effect-line.js)

// kind ids straight off spell_effect.js (the sim's own numbering): 9 = ALTER_STAT, 21 = APPLY_DOT, 27 = INVISIBILITY.
const buff = { id: 's-buff', kind: 9, stat: 9, value: 1, remaining_turns: 3 } // +1 raw damage, 3 turns (Oathblade)
const debuff = { id: 's-debuff', kind: 9, stat: 9, value: -1, remaining_turns: 2 }
const dot_fire = { id: 's-dot', kind: 21, element: 0, value: 5, remaining_turns: 1 } // fire DoT
const invis = { id: 's-inv', kind: 27, remaining_turns: 4 }
const expired = { id: 's-gone', kind: 9, stat: 9, value: 1, remaining_turns: 0 }

describe('status_dot_view — the projection: fighter effects → the colored-dot model (kinds, counts, overflow)', () => {
  test('one active effect → one dot, coloured by the SAME kind→tone grammar the spell card renders', () => {
    expect(status_dot_view(t, [buff])).toEqual({ dots: [{ id: 's-buff', color: '#4fd6a0' }], overflow: 0 })
  })

  test('a debuff (negative value) dots the penalty red, not the buff green', () => {
    expect(status_dot_view(t, [debuff])).toEqual({ dots: [{ id: 's-debuff', color: '#ff6b6b' }], overflow: 0 })
  })

  test('a damage-class DoT dots the ELEMENT colour (fire), matching the fight board floats', () => {
    expect(status_dot_view(t, [dot_fire])).toEqual({ dots: [{ id: 's-dot', color: '#e0664a' }], overflow: 0 })
  })

  test('a flag-valued state kind (invisibility) still dots — falls back to its sentence tone', () => {
    expect(status_dot_view(t, [invis])).toEqual({ dots: [{ id: 's-inv', color: '#4fd6a0' }], overflow: 0 })
  })

  test('an expired row (remaining_turns 0) is filtered out — never a stale dot', () => {
    expect(status_dot_view(t, [expired])).toEqual({ dots: [], overflow: 0 })
  })

  test('no effects / undefined → empty model, never throws', () => {
    expect(status_dot_view(t, [])).toEqual({ dots: [], overflow: 0 })
    expect(status_dot_view(t, undefined)).toEqual({ dots: [], overflow: 0 })
  })

  test('more than the cap collapses to 4 dots + an overflow count — the nametag never grows unbounded', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, kind: 27, remaining_turns: i + 1 }))
    const { dots, overflow } = status_dot_view(t, six)
    expect(dots.length).toBe(4)
    expect(overflow).toBe(2)
  })
})

const base_props = { team: 0, style: {}, exiting: false, name: 'Alice', shown_hp: 10, displacement: null, effects: [], t }

describe('TooltipCard ("the board nameplate") — active-effect dots render alongside the head', () => {
  test('active status effects render a dot row with the right dot count', () => {
    const html = renderToStaticMarkup(
      <TooltipCard {...base_props} outcome={null} status_effects={[buff, dot_fire]} />
    )
    expect(html).toContain('ent-tt__statuses')
    expect([...html.matchAll(/class="hud-dot"/g)].length).toBe(2)
  })

  test('no active status effects (absent prop) renders NO status row — the common out-of-fight/no-buff case', () => {
    const html = renderToStaticMarkup(<TooltipCard {...base_props} outcome={null} />)
    expect(html).not.toContain('ent-tt__statuses')
  })

  test('overflow past the cap shows "+N" beside the capped dots', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, kind: 27, remaining_turns: i + 1 }))
    const html = renderToStaticMarkup(<TooltipCard {...base_props} outcome={null} status_effects={six} />)
    expect([...html.matchAll(/class="hud-dot"/g)].length).toBe(4)
    expect(html).toContain('+2')
  })
})
