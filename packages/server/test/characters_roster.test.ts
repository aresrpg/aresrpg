// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import type { Graph, GraphRow } from '../src/graph.ts'
import { get_characters } from '../src/reads/get_characters.ts'

const character = (id: string) => ({
  properties: {
    id,
    name: 'sceat',
    classe: 'yajin',
    sex: 'male',
    level: 1,
    spells: '{}',
    available_spell_points: 0,
  },
})

const kiosk = { properties: { id: '0xk', personal_cap: '0xcap' } }

/** the two custody shapes answer their own cypher; anything else is an unexpected query */
const graph_of = (held: GraphRow[], seated: GraphRow[]): Graph => ({
  read: async (query: string) => {
    if (query.includes('[:HOLDS]->(c:Character)')) return held
    if (query.includes('[:FIGHTER]->(c:Character {owner:')) return seated
    throw new Error(`unexpected query: ${query}`)
  },
  close: async () => undefined,
})

describe('the roster', () => {
  test('a character seated in a fight stays on the roster, with the caller kiosk as its custody', async () => {
    // THE DUEL INCIDENT (2026-08-21): a seat severs the kiosk HOLDS edge, so a roster built
    // from custody alone returned NOTHING — the client dropped its selection, showed an empty
    // character list, and could no longer embody the character, let alone leave the fight.
    const graph = graph_of([], [{ character: character('0xseated'), kiosk_node: kiosk, equipment: [] }])
    expect(await get_characters(graph, { address: '0xme' })).toMatchObject([
      { id: '0xseated', kiosk: '0xk', kiosk_cap: '0xcap' },
    ])
  })

  test('both custody shapes land in one roster', async () => {
    const graph = graph_of(
      [{ character: character('0xheld'), kiosk_node: kiosk, equipment: [] }],
      [{ character: character('0xseated'), kiosk_node: kiosk, equipment: [] }]
    )
    expect((await get_characters(graph, { address: '0xme' })).map(({ id }) => id)).toEqual(['0xheld', '0xseated'])
  })

  test('a kiosk the indexer has not met yet yields no cap, never an undefined one', async () => {
    const graph = graph_of(
      [{ character: character('0xheld'), kiosk_node: { properties: { id: '0xk' } }, equipment: [] }],
      []
    )
    const [row] = await get_characters(graph, { address: '0xme' })
    expect(row.kiosk).toBe('0xk')
    expect('kiosk_cap' in row).toBe(false)
  })
})
