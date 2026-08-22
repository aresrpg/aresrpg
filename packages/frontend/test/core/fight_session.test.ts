// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { decode_fight_action, encode_fight_action, fight_path_to, reachable_fight_cells } from '@aresrpg/fight'

import { create_fight_session, fight_should_close } from '../../src/modules/fight.ts'
import { initial_simulator_state, reduce_simulator_state, simulator_board } from '../../src/modules/simulator.ts'
import { simulator_fight_setup } from '../../src/simulator/fight_setup.ts'

const ready_setup = () => {
  const character = {
    id: 'local_senshi',
    name: 'Local Senshi',
    classe: 'senshi',
    male: true,
    colors: ['#ffffff', '#d9af57', '#8b6539'] as const,
    level: 1,
    vitality: 0,
    wisdom: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
    spell_levels: {},
    loadout: {},
  }
  const authored = reduce_simulator_state(initial_simulator_state(), {
    type: 'simulator/character_saved',
    character,
  })
  const board = simulator_board(authored)
  const ally = reduce_simulator_state(authored, {
    type: 'simulator/character_placed',
    cell: board.start_cells_a[0]!,
    character_id: character.id,
  })
  return reduce_simulator_state(ally, {
    type: 'simulator/mob_placed',
    cell: board.start_cells_b[0]!,
    mob_type: 'alley_bunny',
    level: 4,
    level_min: 1,
    level_max: 6,
  })
}

describe('fight session owner', () => {
  test('mounts placement without starting, then retains one runtime across commands', () => {
    const reconciled: unknown[] = []
    let now = 60_000n
    const session = create_fight_session({
      now: () => now,
      reconcile: (result) => reconciled.push(result),
    })
    const simulator = ready_setup()

    session.open({ mode: 'local', setup: simulator_fight_setup(simulator), seed: simulator.seed })
    expect(session.state()?.checkpoint.contract.round).toBe(0n)
    session.apply({ type: 'start' })
    const started = session.state()
    const fighter = started?.checkpoint.contract.queue[Number(started.checkpoint.contract.turn_ptr)]
    now = 63_000n
    session.apply({ type: 'end_turn', fighter: fighter! })

    expect(reconciled).toHaveLength(3)
    expect(session.state()?.checkpoint.contract.round).toBeGreaterThanOrEqual(1n)
    expect(session.state()?.events.some(({ type }) => type === 'turn_switched')).toBeTrue()
    expect(session.state()?.error).toBeNull()
  })

  test('closing removes the runtime instead of leaving a hidden fight alive', () => {
    const session = create_fight_session({ now: () => 60_000n, reconcile: () => {} })
    const simulator = ready_setup()

    session.open({ mode: 'local', setup: simulator_fight_setup(simulator), seed: simulator.seed })
    session.close()

    expect(session.state()).toBeNull()
    expect(session.apply({ type: 'crank' })).toBeFalse()
  })

  test('rewinds only a local simulator runtime to its current turn boundary', () => {
    const session = create_fight_session({ now: () => 60_000n, reconcile: () => {} })
    const simulator = ready_setup()
    session.open({ mode: 'local', setup: simulator_fight_setup(simulator), seed: simulator.seed })
    session.apply({ type: 'start' })
    const started = session.state()!.checkpoint
    const fighter = started.contract.queue[Number(started.contract.turn_ptr)]!
    const target = reachable_fight_cells(started, fighter)[0]!
    session.apply({ type: 'move_to', fighter, path: fight_path_to(started, fighter, target)! })
    expect(session.state()!.checkpoint).not.toEqual(started)

    expect(session.reset_turn()).toBeTrue()
    expect(session.state()).toMatchObject({ checkpoint: started, events: [], error: null })

    const remote = create_fight_session({ now: () => 60_000n, reconcile: () => {} })
    remote.open({ mode: 'remote', setup: simulator_fight_setup(simulator), seed: simulator.seed })
    remote.reset_turn()
    expect(remote.state()?.error?.code).toBe('local_mode_required')
  })

  test('applies a streamed action through the same runtime path as a local action', () => {
    const local = create_fight_session({ now: () => 60_000n, reconcile: () => {} })
    const streamed = create_fight_session({ now: () => 60_000n, reconcile: () => {} })
    const simulator = ready_setup()
    const setup = simulator_fight_setup(simulator)

    local.open({ mode: 'local', setup, seed: simulator.seed })
    streamed.open({ mode: 'local', setup, seed: simulator.seed })
    local.apply({ type: 'start' })
    streamed.apply({ type: 'start' })
    const fighter = local.state()!.checkpoint.contract.queue[0]!
    const action = Object.freeze({ type: 'forfeit' as const, fighter })

    local.apply(action)
    streamed.apply(decode_fight_action(encode_fight_action(action)))

    expect(streamed.state()).toEqual(local.state())
  })

  test('returns a completed local fight to setup only after its presentation settles', () => {
    const session = create_fight_session({ now: () => 60_000n, reconcile: () => {} })
    const simulator = ready_setup()
    session.open({ mode: 'local', setup: simulator_fight_setup(simulator), seed: simulator.seed })
    session.apply({ type: 'start' })
    session.apply({ type: 'forfeit', fighter: 0n })
    const ended = session.state()!

    expect(ended.checkpoint.contract.ended).toBeTrue()
    expect(
      fight_should_close({ mode: ended.mode, checkpoint: ended.checkpoint, presentations: [{} as never] }, null)
    ).toBeFalse()
    expect(fight_should_close({ mode: ended.mode, checkpoint: ended.checkpoint, presentations: [] }, null)).toBeTrue()
  })

  test('a remote fight releases the surface once the viewer’s own seat is settled', () => {
    // THE DUEL INCIDENT (2026-08-21): win and loss both leave through the chain's FightEnded
    // packet, but a forfeit that does NOT end the fight emits nothing — the player is out of
    // the roster, his character is back in his kiosk, and his screen still shows the board.
    // Settled is the one fact common to all three exits the owner named: forfeit, loss, win.
    const session = create_fight_session({ now: () => 60_000n, reconcile: () => {} })
    const simulator = ready_setup()
    session.open({ mode: 'local', setup: simulator_fight_setup(simulator), seed: simulator.seed })
    session.apply({ type: 'start' })
    const owner = session.state()!.checkpoint.contract.fighters[0]!
    if (owner.kind.type !== 'player') throw new Error('seat 0 must be a player for this fixture')
    const address = owner.kind.owner
    const character_id = owner.kind.character
    const before = Object.freeze({ ...session.state()!, mode: 'remote' as const, events: Object.freeze([]) })

    expect(
      fight_should_close({ mode: before.mode, checkpoint: before.checkpoint, presentations: [] }, character_id)
    ).toBeFalse()

    session.apply({ type: 'forfeit', fighter: 0n })
    const after = Object.freeze({ ...session.state()!, mode: 'remote' as const, events: Object.freeze([]) })

    expect(
      fight_should_close({ mode: after.mode, checkpoint: after.checkpoint, presentations: [] }, character_id)
    ).toBeTrue()
    // a spectator holds no seat, so only the fight ENDING releases them — and this forfeit was
    // the side's last living fighter, so it did end
    expect(after.checkpoint.contract.ended).toBeTrue()
    expect(
      fight_should_close(
        { mode: after.mode, checkpoint: after.checkpoint, presentations: [], canonical_ended: true },
        '0xnobody'
      )
    ).toBeTrue()
    // while it still runs, a seatless viewer stays
    const running = Object.freeze({
      ...after,
      checkpoint: { ...after.checkpoint, contract: { ...after.checkpoint.contract, ended: false } },
    })
    expect(
      fight_should_close({ mode: running.mode, checkpoint: running.checkpoint, presentations: [] }, '0xnobody')
    ).toBeFalse()
    // …and the forfeiter still leaves, on their own settled seat alone
    expect(
      fight_should_close({ mode: running.mode, checkpoint: running.checkpoint, presentations: [] }, character_id)
    ).toBeTrue()

    const shared = {
      ...running,
      checkpoint: {
        ...running.checkpoint,
        contract: {
          ...running.checkpoint.contract,
          fighters: [
            ...running.checkpoint.contract.fighters,
            {
              ...running.checkpoint.contract.fighters[0]!,
              kind: { ...owner.kind, character: '0xother-character' },
              settled: false,
            },
          ],
        },
      },
    }
    expect(fight_should_close({ ...shared, presentations: [] }, '0xother-character')).toBeFalse()
    expect(fight_should_close({ ...shared, presentations: [] }, character_id)).toBeTrue()
  })

  test('the presentation drains before a remote surface closes', () => {
    // closing the instant the fold lands would cut the forfeiter's own death animation
    const session = create_fight_session({ now: () => 60_000n, reconcile: () => {} })
    const simulator = ready_setup()
    session.open({ mode: 'local', setup: simulator_fight_setup(simulator), seed: simulator.seed })
    session.apply({ type: 'start' })
    const seat = session.state()!.checkpoint.contract.fighters[0]!
    if (seat.kind.type !== 'player') throw new Error('seat 0 must be a player for this fixture')
    session.apply({ type: 'forfeit', fighter: 0n })
    const undrained = Object.freeze({ ...session.state()!, mode: 'remote' as const })

    expect(undrained.events.length).toBeGreaterThan(0)
    expect(
      fight_should_close(
        { mode: undrained.mode, checkpoint: undrained.checkpoint, presentations: [{} as never] },
        seat.kind.character
      )
    ).toBeFalse()
  })
})
