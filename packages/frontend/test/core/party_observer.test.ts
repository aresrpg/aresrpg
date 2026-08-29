// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { PartyRow } from '@aresrpg/protocol'

import { create_app } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('party acceptance stays single-flight through the receipt-to-projection gap', async () => {
  let accept_calls = 0
  const character = { id: '0xc', name: 'C', custody: 'kiosk' }
  const party: PartyRow = {
    id: '0xp',
    members: [{ character_id: '0xleader', name: 'Leader' }],
    invited: [{ character_id: character.id, name: character.name }],
  }
  const wallet = {
    address: '0xme',
    party: {
      accept: async () => {
        accept_calls += 1
        return { digest: 'accepted' }
      },
    },
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['party'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] as never } })
  app.dispatch({
    type: 'server/packet',
    packet: { type: 'packet/party_invites', character_id: character.id, parties: [party] },
  })

  app.dispatch({ type: 'party/accept', party: party.id })
  app.dispatch({ type: 'party/accept', party: party.id })
  await tick()
  app.dispatch({ type: 'party/accept', party: party.id })
  expect(accept_calls).toBe(1)
  expect(app.store.getState().party.pending_by_character[character.id]).toBe(`accept:${party.id}`)

  app.dispatch({ type: 'server/packet', packet: { type: 'packet/party', character_id: character.id, party } })
  expect(app.store.getState().party.pending_by_character[character.id]).toBeUndefined()
  stop()
})

test('run-to reads one external checkpoint and enables flat mode', async () => {
  const reads: string[] = []
  const own = {
    id: '0xown',
    name: 'Own',
    world: 'nauvis',
    checkpoint_world: 'nauvis',
    custody: 'kiosk',
    equipment: [],
  }
  const party: PartyRow = {
    id: '0xp',
    members: [
      { character_id: own.id, name: own.name },
      { character_id: '0xother', name: 'Other' },
    ],
    invited: [],
  }
  const wallet = {
    address: '0xme',
    read_character_checkpoint: async (character_id: string, world: string) => {
      reads.push(`${character_id}:${world}`)
      return { x: 50_010, z: 50_020 }
    },
  }
  const app = create_app()
  app.initialize(settings)
  const stop = app.observe(['party', 'run_to'])
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [own] as never } })
  app.dispatch({ type: 'server/packet', packet: { type: 'packet/party', character_id: own.id, party } })

  app.dispatch({ type: 'run_to/character', character_id: '0xother' })
  await tick()

  expect(reads).toEqual(['0xother:nauvis'])
  expect(app.store.getState().run_to.run).toMatchObject({ status: 'running', x: 50_010, z: 50_020 })
  expect(app.store.getState().settings.flat_mode).toBeTrue()
  app.dispatch({ type: 'run_to/position', world: 'nauvis', x: 50_030, z: 50_040 })
  expect(app.store.getState().run_to.run).toMatchObject({
    status: 'running',
    source: 'position',
    x: 50_030,
    z: 50_040,
  })
  expect(app.store.getState().run_to.restore_flat).toBeTrue()
  app.dispatch({ type: 'run_to/stopped', reason: 'arrived', restore_flat: true })
  expect(app.store.getState().settings.flat_mode).toBeFalse()
  expect(app.store.getState().run_to.run).toBeNull()
  stop()
})
