// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// Presenter census: every renderer-neutral beat kind must either have one playback home or be an explicitly
// named bookkeeping silence. A producer can otherwise build a correct beat that the adapter silently drops.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'
import { produce_receipt_render_turns } from '@aresrpg/fight/fight_render_events'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path) => readFileSync(join(here, path), 'utf8')
const fight_src = '../../../fight/src'
const producers = [read(`${fight_src}/fight_render_events.js`), read(`${fight_src}/fight_predicted_render.js`)].join(
  '\n'
)
const presenter = read('./voxel_fight_adapter.js')

/** append_to(turn, 'kind', …), append('kind', …), and the trap/status ternary used by both producers. */
const PRODUCED = new Set([
  ...[...producers.matchAll(/append(?:_to)?\(\s*(?:[a-z_]+,\s*)?'([a-z_]+)'/g)].map((match) => match[1]),
  ...[...producers.matchAll(/\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'\s*,\s*\d/g)].flatMap((match) => [match[1], match[2]]),
])

/** Every kind with an explicit playback arm in the board presenter. */
const PLAYED = new Set([...presenter.matchAll(/spec\.kind === '([a-z_]+)'/g)].map((match) => match[1]))

const SILENT = {
  fight_end: 'phase transition; the result projection owns its surface',
  turn_start: 'HUD and clock bookkeeping',
  turn_end: 'HUD and clock bookkeeping',
  turn_skip: 'HUD and clock bookkeeping',
}

describe('every render beat kind is played or an explicitly named bookkeeping silence', () => {
  test('the census parses both producer and presenter vocabularies', () => {
    expect(PRODUCED.size).toBeGreaterThan(8)
    expect(PLAYED.size).toBeGreaterThan(8)
    expect(PRODUCED.has('cast')).toBe(true)
    expect(PLAYED.has('damage')).toBe(true)
  })

  test('no produced beat kind is silently dropped by the presenter', () => {
    const dropped = [...PRODUCED].filter((kind) => !PLAYED.has(kind) && !(kind in SILENT)).toSorted()
    expect(dropped).toEqual([])
  })

  test('status is asserted as played, never carried as a named silence', () => {
    expect(PRODUCED.has('status')).toBe(true)
    expect(PLAYED.has('status')).toBe(true)
    expect('status' in SILENT).toBe(false)
  })

  test('every named silence is still produced and still intentionally unplayed', () => {
    for (const kind of Object.keys(SILENT)) {
      expect(PRODUCED.has(kind)).toBe(true)
      expect(PLAYED.has(kind)).toBe(false)
    }
  })
})

describe('standalone status outcomes have one played beat home', () => {
  const fight_id = 'status-beats:1'
  const cast = {
    type: '0xsim::fight_events::Cast',
    parsedJson: { fight: fight_id, caster_is_mob: false, caster_idx: '0', target_cell: '22' },
  }

  for (const status of ['SHIELD', 'STUN', 'POISON', 'GLYPH'])
    test(`${status} reaches the played status beat`, () => {
      const beats = produce_receipt_render_turns([cast], {
        fight_id,
        resolve_fighter_id: ({ is_mob, idx }) => (is_mob ? `mob-${idx}` : `player-${idx}`),
        resolve_cast: () => ({ statuses: [{ status, target_id: 'mob-0' }] }),
      }).turns.flatMap((turn) => turn.events ?? [])
      const status_beat = beats.find((beat) => beat.kind === 'status' && beat.payload.status === status)
      expect(status_beat).toBeDefined()
      expect(PLAYED.has(status_beat.kind)).toBe(true)
    })
})
