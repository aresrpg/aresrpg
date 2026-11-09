// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterRow, FightStateRow, ServerPacket } from '@aresrpg/protocol'

import {
  empty_snapshot,
  reduce_actor_snapshot,
  actor_snapshot_transition,
  type ActorSnapshot,
} from '../src/actor_snapshot.ts'

const fold = (snapshot: ActorSnapshot, packet: ServerPacket, now = 100) =>
  reduce_actor_snapshot(
    snapshot,
    { status: 'ready', characters: snapshot.characters, last_packet: packet, error: null },
    now,
    20
  )
const heartbeat = (timestamp: number | null, age: number | null = 0) =>
  ({
    type: 'packet/server_info',
    chain_timestamp_ms: timestamp,
    chain_sample_age_ms: age,
    indexing_lag: 0,
  }) as ServerPacket
const checkpoint = (round: string, ended = false): ServerPacket => ({
  type: 'packet/fight_state',
  fight: 'fight',
  seats: {},
  state: { contract: { round, ended } } as FightStateRow,
})
const initial = () =>
  fold(
    {
      ...empty_snapshot(),
      frozen: false,
      characters: [{ id: 'character', active_fight: { id: 'fight' } } as CharacterRow],
    },
    heartbeat(1_000)
  )

test('duplicate and older heartbeat samples neither rewind nor renew freshness', () => {
  const snapshot = fold(empty_snapshot(), heartbeat(1_000))
  expect(snapshot.clock).toEqual({ chain_ms: 1_000, observed_at: 100 })
  for (const timestamp of [1_000, 999])
    expect(fold(snapshot, heartbeat(timestamp), 20_000).clock).toEqual(snapshot.clock)
  expect(fold(snapshot, heartbeat(2_000, 50), 200).clock).toEqual({ chain_ms: 2_000, observed_at: 150 })
  for (const timestamp of [null, 0, -1, 1.5, NaN, Infinity])
    expect(fold(snapshot, heartbeat(timestamp)).clock).toBeNull()
  expect(fold(snapshot, heartbeat(2_000, null)).clock).toBeNull()
})

test('fight invalidations block writes until a matching phase arrives and reject regression', () => {
  for (const packet of [
    { type: 'packet/fight_started', fight: 'fight', queue: [] },
    { type: 'packet/fight_phase', fight: 'fight', phase: 'active' },
    { type: 'packet/fight_ended', fight: 'fight', winner: null },
    { type: 'packet/fight_phase', fight: 'fight', phase: 'ended' },
  ] as ServerPacket[]) {
    const placement = fold(initial(), checkpoint('0'))
    expect(placement.ready).toBeTrue()
    const invalidated = fold(placement, packet)
    expect(invalidated.ready).toBeFalse()
    expect(fold(invalidated, checkpoint('0')).ready).toBeFalse()
    const ended =
      packet.type === 'packet/fight_ended' || (packet.type === 'packet/fight_phase' && packet.phase === 'ended')
    const fresh = fold(invalidated, checkpoint('1', ended))
    expect(fresh.ready).toBeTrue()
    expect(fold(fresh, checkpoint('0')).fights).toEqual(fresh.fights)
    expect(fold(fresh, { type: 'packet/characters', characters: [] }).ready).toBeTrue()
  }
})

test('fight phase refresh is requested once and floors retire with custody', () => {
  const placement = fold(initial(), checkpoint('0'))
  const packet = { type: 'packet/fight_started', fight: 'fight', queue: [] } as const
  const state = {
    status: 'ready',
    characters: placement.characters,
    last_packet: { ...packet, queue: [] as string[] },
    error: null,
  } as const
  const first = actor_snapshot_transition(placement, state, 100, 20)
  expect(first.resync_fights).toEqual(['fight'])
  expect(actor_snapshot_transition(first.snapshot, state, 101, 20).resync_fights).toEqual([])
  const removed = fold(first.snapshot, { type: 'packet/characters', characters: [] })
  expect(removed.fight_phases).toEqual({})
  expect(removed.fights).toEqual({})
})

test('phase invalidation before baseline still asks for a fresh checkpoint', () => {
  const snapshot = initial()
  const state = {
    status: 'ready' as const,
    characters: snapshot.characters,
    error: null,
    last_packet: { type: 'packet/fight_ended', fight: 'fight', winner: null } as ServerPacket,
  }
  const transition = actor_snapshot_transition(snapshot, state, 100, 20)
  expect(transition.resync_fights).toEqual(['fight'])
  expect(transition.snapshot.ready).toBeFalse()
  expect(fold(transition.snapshot, checkpoint('1')).ready).toBeFalse()
})
