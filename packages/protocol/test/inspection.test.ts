// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { parse_client_packet, parse_server_packet } from '../src/packets.ts'

import fixture from './fixtures/inspection.testnet.json'

const address = `0x${'a'.repeat(64)}`
const parse = (query: unknown, id: unknown = 1) =>
  parse_client_packet(JSON.stringify({ type: 'packet/inspection_request', id, query }))

test('inspection accepts only bounded profile and exact-character queries, plus cancellation', () => {
  for (const query of [
    null,
    { kind: 'profile', address, after: null },
    { kind: 'profile', address, after: address },
    { kind: 'equipment', address, character_id: address },
  ] as const)
    expect(parse(query)).toEqual({ type: 'packet/inspection_request', id: 1, query })
  for (const query of [
    undefined,
    [],
    {},
    { kind: 'profile', address: 'anything', after: null },
    { kind: 'profile', address, after: -1 },
    { kind: 'profile', address },
    { kind: 'equipment', address, character_id: '0x1' },
    { kind: 'inventory', address },
  ])
    expect(() => parse(query)).toThrow()
  for (const id of [-1, 1.5, 1e20, '1', null]) expect(() => parse(null, id)).toThrow()
})

test('captured testnet profile and equipped-item wire retain identity, progression and actual rolls', () => {
  // Source object/version/checkpoint and capture date are recorded beside the original websocket bytes.
  const profile = parse_server_packet(fixture.messages[0]!)
  const equipment = parse_server_packet(fixture.messages[1]!)
  expect(profile).toMatchObject({
    type: 'packet/inspection_result',
    id: 1,
    result: {
      kind: 'profile',
      profile: {
        character_count: 1,
        next: null,
        characters: [{ id: fixture.provenance.character, classe: 'senshi', level: 30 }],
        jobs: expect.arrayContaining([
          { job: 'FARMER', level: 1 },
          { job: 'HERBALIST', level: 1 },
          { job: 'MINER', level: 1 },
        ]),
      },
    },
  })
  expect(equipment).toMatchObject({
    type: 'packet/inspection_result',
    id: 2,
    result: {
      kind: 'equipment',
      equipment: [
        {
          id: fixture.provenance.equipped_item,
          version: fixture.provenance.item_version,
          slot: 'relic_1',
          stats: { vitality: 33768, action: 32778, movement: 32778 },
        },
      ],
    },
  })
})
