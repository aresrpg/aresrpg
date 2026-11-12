// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { parse_client_packet, type AgentObservation } from '@aresrpg/protocol'

import { create_agent_identity } from '../../sdk/src/agent_multisig.ts'
import { mesh, channels } from '../src/protocol.ts'

import { create_player } from './helpers/player.ts'
import { wire, make_character, flush } from './helpers/world_wire.ts'

const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const owner = google.toSuiAddress()
const identity = create_agent_identity({
  agent_public_key: Ed25519Keypair.generate().getPublicKey(),
  zklogin_public_identifier: google,
})
const character_id = `0x${'a'.repeat(64)}`
const observation: AgentObservation = {
  public_identifier: google.toBase64(),
  character_id,
  pairing: {
    address: identity.address,
    multisig_public_key: identity.public_key.toBase64(),
    signer_mode: 'disposable',
  },
}
const settle = async () => {
  for (let index = 0; index < 6; index++) await flush()
}
const fixture = (
  hold?: () => Promise<void>,
  fighting = false,
  party_read?: () => Promise<Record<string, unknown>[]>
) => {
  const base = wire({ owns: false, character_ids: [] })
  const row = {
    character: make_character({ id: character_id }),
    kiosk_node: { properties: { id: 'kiosk' } },
    equipment: [],
    ...(fighting ? { active_fight: { id: 'observed-fight', seat: 0 } } : {}),
  }
  const graph = {
    ...base.graph,
    read: async (cypher: string, params?: Record<string, unknown>) => {
      if (cypher.includes('Tournament')) return []
      if (cypher.includes('MATCH (:Character {id: $character_id})-[:MEMBER_OF]')) return party_read ? party_read() : []
      if (
        params?.address === identity.address &&
        (cypher.includes('[:HOLDS]->(c:Character)') || cypher.includes(':FIGHTER]->(c:Character {owner:'))
      ) {
        await hold?.()
        const seated_query = cypher.includes(':FIGHTER]->')
        return seated_query === fighting ? [row] : []
      }
      return base.graph.read(cypher, params)
    },
  }
  const player = create_player({ ...base, graph, address: owner, admin: false })
  const watch = (id = 1, request: AgentObservation | null = observation) =>
    player.on_message(JSON.stringify({ type: 'packet/agent_observe', id, observation: request }))
  return { ...base, graph, player, watch }
}

test('verified viewer with no owned characters receives an observed roster without movement or relay authority', async () => {
  const f = fixture()
  try {
    await settle()
    f.watch()
    await settle()
    expect(f.player.online_characters()).toEqual([])
    expect(f.sent.filter((p) => p.type === 'packet/agent_observed').at(-1)).toMatchObject({
      selected_character_id: character_id,
      characters: [{ id: character_id }],
      failed: false,
    })
    f.published.length = 0
    f.player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id,
        checkpoint: f.checkpoint(character_id),
        x: 101,
        y: 0,
        z: 100,
        riding: false,
        gliding: false,
      })
    )
    f.player.dispatch({
      type: 'packet/fight_action',
      fight: 'observed-fight',
      action: { type: 'move', fighter: '0', path: ['1'] },
    } as never)
    expect(f.published.filter(({ payload }) => ['appear', 'leave', 'move', 'action'].includes(payload.kind))).toEqual(
      []
    )
  } finally {
    f.player.on_close()
  }
})

test('wrong Google membership is rejected and fighting custody remains observable', async () => {
  const f = fixture(undefined, true)
  try {
    f.watch()
    await settle()
    expect(f.sent.filter((p) => p.type === 'packet/agent_observed').at(-1)).toMatchObject({
      characters: [{ custody: 'fight', active_fight: { id: 'observed-fight', seat: 0 } }],
    })
    const foreign = toZkLoginPublicIdentifier(2n, 'https://accounts.google.com', { legacyAddress: false })
    f.watch(2, { ...observation, public_identifier: foreign.toBase64() })
    await settle()
    expect(f.sent.filter((p) => p.type === 'packet/agent_observed').at(-1)).toMatchObject({
      id: 2,
      failed: true,
      characters: [],
    })
    expect(f.player.online_characters()).toEqual([])
    expect(() => parse_client_packet(JSON.stringify({ type: 'packet/agent_observe', id: -1, observation }))).toThrow()
  } finally {
    f.player.on_close()
  }
})

test('cancelled pending reads cannot restore an observation', async () => {
  let release = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const f = fixture(() => pending)
  try {
    f.watch()
    await settle()
    expect(f.sent.filter((packet) => packet.type === 'packet/agent_observed')).toEqual([])
    f.watch(2, null)
    const before = f.sent.length
    release()
    await settle()
    expect(f.sent.slice(before).filter((p) => p.type === 'packet/agent_observed')).toEqual([])
  } finally {
    release()
    f.player.on_close()
  }
})

test('late agent connection discovers far-away presence; cancellation rejects old probe replies', async () => {
  const f = fixture()
  try {
    f.watch()
    await settle()
    const probe = f.published.find(
      ({ payload }) => payload.kind === 'who' && payload.character_id === character_id
    )!.payload
    const player = {
      character_id,
      owner: identity.address,
      name: 'Agent',
      classe: 'senshi',
      sex: 'male',
      level: 1,
      color_1: 1,
      color_2: 2,
      color_3: 3,
      world: 'overworld',
      x: 5000,
      y: 5,
      z: 5000,
      riding: false,
      gliding: false,
      hat: null,
      cloak: null,
      pet: null,
      weapon: null,
      title: null,
    }
    await f.pubsub.mesh.publish(mesh.presence_owner(identity.address), {
      kind: 'appear',
      address: identity.address,
      player,
    })
    await settle()
    expect(
      f.sent.some(
        (p) => p.type === 'packet/player_appeared' && p.player.character_id === character_id && p.player.x === 5000
      )
    ).toBe(true)
    f.watch(2, null)
    await settle()
    const before = f.sent.length
    await f.pubsub.mesh.publish(probe.reply_to, {
      kind: 'reply',
      address: identity.address,
      player,
      request: probe.request,
    })
    await settle()
    expect(f.sent.slice(before).some((p) => p.type === 'packet/player_appeared')).toBe(false)
  } finally {
    f.player.on_close()
  }
})

test('observed public party follows membership changes without chat authority, and cancellation clears it', async () => {
  let members = [{ order: 0, character: { properties: { id: character_id, name: 'Agent' } } }]
  let exists = true
  const f = fixture(undefined, false, async () =>
    exists ? [{ party: { properties: { id: 'party' } }, members, invited: [] }] : []
  )
  try {
    f.watch()
    await settle()
    expect(f.sent.filter((p) => p.type === 'packet/party').at(-1)).toMatchObject({
      character_id,
      party: { id: 'party', members: [{ name: 'Agent' }] },
    })
    expect(f.pubsub.emitter.listenerCount(mesh.chat_party('party'))).toBe(0)
    expect(f.player.online_characters()).toEqual([])
    members = [...members, { order: 1, character: { properties: { id: 'companion', name: 'Companion' } } }]
    f.pubsub.graph.emitter.emit(channels.party('party'), { type: 'PartyJoined', data: { party: 'party' } })
    await settle()
    expect(f.sent.filter((p) => p.type === 'packet/party').at(-1)).toMatchObject({
      party: { members: [{ name: 'Agent' }, { name: 'Companion' }] },
    })
    exists = false
    f.pubsub.graph.emitter.emit(channels.character(character_id), { type: 'PartyLeft', data: { party: 'party' } })
    await settle()
    expect(f.sent.filter((p) => p.type === 'packet/party').at(-1)).toMatchObject({ party: null })
    f.watch(2, null)
    await settle()
    expect(f.pubsub.graph.emitter.listenerCount(channels.party('party'))).toBe(0)
  } finally {
    f.player.on_close()
  }
})
