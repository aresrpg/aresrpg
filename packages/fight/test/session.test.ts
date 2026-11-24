// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Remote fights replay chain witnesses; local fights draw seeds themselves. Both reach the same state.

import { describe, expect, test } from 'bun:test'

import {
  CONTRACT_CONSTANTS,
  create_fight,
  create_fight_session,
  fight_path_to,
  reachable_fight_cells,
  type ActiveFightSession,
} from '../src/index.ts'
import { mix } from '../src/prng.ts'

import { fixture, started } from './helpers.ts'

/** The seed a local fight created with `seed` draws for its `index`-th turn. */
const local_seed = (seed: bigint, index: bigint): bigint => (mix(seed, index * 2n) << 32n) | mix(seed, index * 2n + 1n)

describe('remote witnesses', () => {
  test('streamed mob witnesses reproduce the local turn exactly', () => {
    const local = started(fixture())
    const remote = create_fight({ state: local.state(), mode: 'remote' })
    const expected = local.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n })
    expect(expected.events.some(({ type }) => type === 'spell_cast')).toBeTrue()

    expect(remote.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n })).toMatchObject({
      events: [],
      error: null,
    })
    const mob_turn = remote.apply({ type: 'turn_seed', fighter: 1n, seed: local_seed(91n, 1n) })
    expect(mob_turn.error).toBeNull()
    expect(remote.awaiting_witness()).toBeTrue()
    const final_events = remote.replace(expected.state)
    expect([...mob_turn.events, ...final_events]).toEqual([...expected.events])
    expect(remote.awaiting_witness()).toBeFalse()
    expect(remote.state()).toEqual(expected.state)
  })

  test('a remote start replays a leading mob wave from streamed seeds', () => {
    const checkpoint = fixture()
    const [player, mob] = checkpoint.contract.fighters
    player!.team = 1n
    player!.cell = checkpoint.contract.board.start_cells_b[0]!
    mob!.team = 0n
    mob!.cell = checkpoint.contract.board.start_cells_a[0]!
    const local = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    const remote = create_fight({ state: checkpoint, mode: 'remote' })
    const expected = local.apply({ type: 'start', observed_ms: 60_000n })

    expect(remote.apply({ type: 'start', observed_ms: 60_000n })).toMatchObject({ events: [], error: null })
    expect(remote.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n }).error?.code).toBe(
      'turn_witnesses_pending'
    )
    const witnessed = remote.apply({ type: 'turn_seed', fighter: 1n, seed: local_seed(91n, 0n) })
    expect(witnessed.error).toBeNull()
    expect([...witnessed.events, ...remote.replace(expected.state)]).toEqual([...expected.events])
    expect(remote.state()).toEqual(expected.state)
  })

  test('a remote forfeit replays mob turns once, however often it arrives', () => {
    const local = create_fight({ state: fixture(), mode: 'local', seed: 91n })
    const source = local.state().sources.players['0xc1']!
    local.apply({ type: 'join', team: 0n, character: '0xc2', owner: '0xa2', hp: 100n, source })
    local.apply({ type: 'ready', fighter: 2n })
    local.apply({ type: 'start', observed_ms: 60_000n })
    const remote = create_fight({ state: local.state(), mode: 'remote' })
    const forfeit = { type: 'forfeit' as const, fighter: 0n, observed_ms: 60_001n }
    const expected = local.apply(forfeit)

    // The same forfeit arrives through the actor's receipt and the indexed event.
    expect(remote.apply(forfeit)).toMatchObject({ events: [], error: null })
    expect(remote.apply(forfeit)).toMatchObject({ events: [], error: null })
    expect(remote.awaiting_witness()).toBeTrue()
    const witnessed = remote.apply({ type: 'turn_seed', fighter: 1n, seed: local_seed(91n, 1n) })
    expect([...witnessed.events, ...remote.replace(expected.state)]).toEqual([...expected.events])
    expect(remote.state()).toEqual(expected.state)
    expect(remote.apply(forfeit)).toMatchObject({ events: [], error: null })
  })

  test('a refused remote boundary keeps its draft, and only a local fight can reset its turn', () => {
    const local = started(fixture())
    const boundary = local.state()
    const remote = create_fight({ state: boundary, mode: 'remote' })
    const target = reachable_fight_cells(boundary, 0n)[0]!
    const path = fight_path_to(boundary, 0n, target)!
    expect(path.length).toBeGreaterThan(0)
    remote.apply({ type: 'move_to', fighter: 0n, path })
    const drafted = remote.state()
    remote.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n })
    expect(remote.awaiting_witness()).toBeTrue()
    expect(remote.cancel_pending_turn()).toEqual({ state: drafted, events: [], error: null })
    expect(remote.awaiting_witness()).toBeFalse()
    expect(remote.apply({ type: 'turn_seed', fighter: 1n, seed: 7n }).error?.code).toBe('unexpected_turn_seed')
    expect(remote.state()).toEqual(drafted)
    remote.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_500n })
    expect(remote.awaiting_witness()).toBeTrue()
    expect(remote.reset_turn().error?.code).toBe('local_mode_required')
    expect(remote.simulate_turn({ observed_ms: 63_000n }).error?.code).toBe('local_mode_required')

    local.apply({ type: 'move_to', fighter: 0n, path })
    expect(local.state()).not.toEqual(boundary)
    expect(local.reset_turn()).toEqual({ state: boundary, events: [], error: null })
    expect(local.state()).toEqual(boundary)
    expect(create_fight({ state: fixture(), mode: 'local' }).reset_turn().error?.code).toBe('no_turn_boundary')
    expect(() => create_fight({})).toThrow(/state or setup/)
  })
})

describe('the shared session', () => {
  test('a session stamps boundaries, starts a ready local fight, and publishes each batch once', () => {
    const published: ActiveFightSession[] = []
    let clock = 1n
    const session = create_fight_session({ now: () => clock, reconcile: (state) => published.push(state) })
    expect(session.apply({ type: 'ready', fighter: 0n })).toBeFalse()
    expect(session.simulate_turn()).toBeFalse()

    const checkpoint = fixture()
    checkpoint.contract.fighters[0]!.ready = false
    session.open({ state: checkpoint, mode: 'local', seed: 91n })
    expect(session.state()).toMatchObject({ mode: 'local', events: [], presentation_batch: 0, error: null })
    // The last ready player starts a local fight at once, stamped with the session clock.
    expect(session.apply({ type: 'ready', fighter: 0n })).toBeTrue()
    const opened = session.state()!
    expect(opened.checkpoint.contract.round).toBe(1n)
    expect(opened.events[0]).toEqual({ type: 'fight_started', payload: { queue: [0n, 1n], round: 1n } })
    expect(opened.checkpoint.contract.turn_started_ms).toBe(1n)
    session.acknowledge(opened.presentation_batch - 1)
    expect(session.state()!.events).toHaveLength(opened.events.length)
    session.acknowledge(opened.presentation_batch)
    expect(session.state()!.events).toEqual([])

    // The mob plays its whole turn behind one local boundary, never before the minimum turn time.
    clock = 0n
    expect(session.simulate_turn()).toBeTrue()
    const after = session.state()!
    expect(after.presentation_batch).toBe(opened.presentation_batch + 1)
    expect(after.checkpoint.contract.turn_started_ms).toBe(
      opened.checkpoint.contract.turn_started_ms + 2n * CONTRACT_CONSTANTS.turn_min_ms
    )
    expect(after.events.some(({ type }) => type === 'spell_cast')).toBeTrue()

    const remote = create_fight_session({ now: () => 0n, reconcile: (state) => published.push(state) })
    remote.open({ state: after.checkpoint, mode: 'remote' })
    expect(remote.simulate_turn()).toBeFalse()
    expect(remote.apply({ type: 'end_turn', fighter: 0n })).toBeTrue()
    expect(remote.state()).toMatchObject({ awaiting_turn_witness: true, events: [], error: null })
    expect(remote.cancel_pending_turn()).toBeTrue()
    expect(remote.state()!.awaiting_turn_witness).toBeFalse()
    expect(remote.reset_turn()).toBeTrue()
    expect(remote.state()!.error?.code).toBe('local_mode_required')
    expect(remote.replace(opened.checkpoint)).toBeTrue()
    expect(remote.state()).toMatchObject({ checkpoint: opened.checkpoint, error: null })
    expect(remote.restore(after.checkpoint)).toBeTrue()
    expect(remote.state()).toMatchObject({ mode: 'remote', checkpoint: after.checkpoint })
    remote.close()
    expect(remote.state()).toBeNull()
    expect([
      remote.apply({ type: 'crank' }),
      remote.replace(after.checkpoint),
      remote.restore(after.checkpoint),
    ]).toEqual([false, false, false])
    expect([remote.cancel_pending_turn(), remote.reset_turn()]).toEqual([false, false])
    expect(published.length).toBeGreaterThan(6)
  })
})
