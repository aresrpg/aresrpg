// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2167 — fight-end settlement spoils are a SHARED comparison table: every decoded participant
// row carries its own chain-resolved XP and drops; the viewer identity only styles one row, never filters.

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FightReport } from '../../../../src/game/screens/hud/FightReport.jsx'

const t = (key) => key

const decoded_settlement = {
  participants: [
    {
      id: 'fighter-ares',
      name: 'Ares',
      label: 'Ares',
      resolved: true,
      level: 12,
      is_me: true,
      is_player: true,
      alive: true,
      hp_pct: 74,
      spoils: {
        xp: 84,
        tokens: 0,
        loot: [{ template_id: 'wooling-fleece', item_type: 'resource', name: 'Wooling Fleece', amount: 2 }],
      },
    },
    {
      id: 'fighter-shogo',
      name: 'Shogo',
      label: 'Shogo',
      resolved: true,
      level: 10,
      is_me: false,
      is_player: true,
      alive: true,
      hp_pct: 61,
      spoils: {
        xp: 63,
        tokens: 0,
        loot: [{ template_id: 'gobball-horn', item_type: 'resource', name: 'Gobball Horn', amount: 1 }],
      },
    },
  ],
}

describe('#2167 — a coop settlement renders the shared fight-end table', () => {
  test('both fighters render their own XP and drops while only the viewer row is accented', () => {
    const html = renderToStaticMarkup(
      <FightReport
        verdict="Victory"
        party={decoded_settlement.participants}
        enemies={[]}
        spoils={decoded_settlement.participants[0].spoils}
        cost={null}
        t={t}
        on_close={() => {}}
      />
    )

    expect(html).toContain('Ares')
    expect(html).toContain('+84')
    expect(html).toContain('aria-label="Wooling Fleece"')
    expect(html).toContain('Shogo')
    expect(html).toContain('+63')
    expect(html).toContain('aria-label="Gobball Horn"')
    expect(html.split(' is-you').length - 1).toBe(1)
    expect(html).not.toContain('fe-row__spoils--hidden')
  })
})
