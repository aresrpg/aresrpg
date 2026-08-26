// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  FightTeams,
  fight_joinable_teams,
  fight_prompt_action,
  fight_prompt_checkpoint,
} from '../../src/components/FightPrompt.tsx'
import { fight_prompt_targets } from '../../src/game/core/fight_prompt_feed.ts'

const duel = {
  phase: 'placement',
  access_a: 1,
  access_b: 2,
  opener_a: '0xchallenger',
  opener_b: '0xtarget',
}

test('sword discovery stays public while the reserved side admits only the challenged character', () => {
  expect(fight_prompt_action(duel.phase)).toBe('join')
  expect(fight_joinable_teams(duel, '0xtarget')).toEqual([1])
  expect(fight_joinable_teams(duel, '0xbystander')).toEqual([])
})

test('an active sword always opens spectating', () => {
  expect(fight_prompt_action('active')).toBe('spectate')
})

test('the F modal resolves its own fight cache after another character is selected', () => {
  const checkpoint = { contract: { id: '0xf1' } } as never
  expect(fight_prompt_checkpoint({ checkpoint: null, cached: { '0xf1': checkpoint } } as never, '0xf1')).toBe(
    checkpoint
  )
})

test('normalized checkpoint integers preserve the same side admission rules', () => {
  expect(
    fight_joinable_teams(
      {
        ...duel,
        access_a: 1n,
        access_b: 2n,
      },
      '0xtarget'
    )
  ).toEqual([1])
})

test('a group side admits only characters whose party contains its opener', () => {
  const group = { phase: 'placement', access_a: 1, access_b: 0, opener_a: '0xleader', opener_b: null }
  expect(fight_joinable_teams(group, '0xmember', ['0xleader', '0xmember'])).toEqual([0, 1])
  expect(fight_joinable_teams(group, '0xstranger')).toEqual([1])
})

test('fight swords advertise at fifty blocks but become interactive only from nearby', () => {
  const markers = [
    { id: 'far', x: 49, z: 0 },
    { id: 'near', x: 3, z: 0 },
    { id: 'outside', x: 51, z: 0 },
  ]

  expect(fight_prompt_targets(markers, 0, 0)).toEqual({ visible_ids: ['near', 'far'], focused_id: 'near' })
  expect(fight_prompt_targets(markers.slice(0, 1), 0, 0)).toEqual({ visible_ids: ['far'], focused_id: null })
})

test('the active fight roster names player and mob seats with their levels', () => {
  const html = renderToStaticMarkup(
    FightTeams({
      action_a: null,
      action_b: null,
      empty_label: 'Empty',
      label_a: 'Side A',
      label_b: 'Side B',
      players: { '0xplayer': { name: 'Ryk-abdou', level: 45 } },
      team_a: [{ kind: { type: 'player', character: '0xplayer' }, team: 0 }],
      team_b: [{ kind: { type: 'mob', snapshot: { mob_type: 'misui__fire', level: 12 } }, team: 1 }],
      unknown_name: 'Unknown',
    })
  )

  expect(html).toContain('data-fight-roster=""')
  expect(html).toContain('data-fight-fighter="player"')
  expect(html).toContain('Ryk-abdou')
  expect(html).toContain('LV 45')
  expect(html).toContain('data-fight-fighter="mob"')
  expect(html).toContain('Misui Feu')
  expect(html).toContain('LV 12')
})
