// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1746 — slot 0 projects the escrow weapon itself. Pure projection + presentational tooltip render: no fight
// stores, canvas placement, or browser drive can hide a real equipped line behind the bare-hands fallback.

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { weapon_socket_projection } from './deck-weapon-socket.js'
import { SpellSeedTip } from './tooltip-content.jsx'

const t = (key, values = {}) =>
  ({
    'fight.weapon_bare': 'Bare Hands',
    'fight.weapon_attack': 'Weapon Attack',
    'fight.ap': 'AP',
    'fight.weapon_reach': 'Reach',
    'fight.next_hit': 'Next hit',
    'spells.damage': 'Damage',
    'spells.element': 'Element',
    'spells.crit_val': `Critical ${values.value}`,
    'encyclopedia.element.fire': 'Fire',
    'encyclopedia.element.water': 'Water',
    'encyclopedia.element.earth': 'Earth',
    'encyclopedia.element.air': 'Air',
    'encyclopedia.element.neutral': 'Neutral',
  })[key] ?? key

const tooltip_html = ({ name, facts }) =>
  renderToStaticMarkup(createElement(SpellSeedTip, { t, name, weapon: facts }))

describe('#1746 — fight weapon socket projection', () => {
  test('renders the equipped weapon line instead of Bare Hands', () => {
    const weapon = {
      element: 0,
      damage: 12,
      damage_max: 12,
      crit_damage: 19,
      crit_damage_max: 19,
      crit_rate: 5,
      ap_cost: 4,
      reach: 3,
      lines: [],
    }

    const view = weapon_socket_projection({ weapon, glow: false, clock: null, t })

    expect(view.is_bare_hands).toBe(false)
    expect(view.facts).toMatchObject({
      element: 0,
      damage: 12,
      crit_damage: 19,
      crit_rate: 5,
      ap_cost: 4,
      reach: 3,
      element_name: 'Fire',
    })
    const html = tooltip_html(view)
    expect(html).toContain('Weapon Attack')
    expect(html).not.toContain('Bare Hands')
    expect(html).toContain('<dd>4</dd>')
    expect(html).toContain('>12 (Critical 19)</dd>')
    expect(html).toContain('<dd>3</dd>')
    expect(html).toContain('>Fire</dd>')
  })

  test('renders Bare Hands only for the exact unarmed signature', () => {
    const weapon = {
      element: 2,
      damage: 4,
      damage_max: 4,
      crit_damage: 6,
      crit_damage_max: 6,
      crit_rate: 30,
      ap_cost: 3,
      reach: 1,
      lines: [],
    }

    const view = weapon_socket_projection({ weapon, glow: false, clock: null, t })

    expect(view.is_bare_hands).toBe(true)
    expect(view.facts).toMatchObject({ element: 2, damage: 4, ap_cost: 3, reach: 1, element_name: 'Earth' })
    expect(tooltip_html(view)).toContain('Bare Hands')
  })
})
