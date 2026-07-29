// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { create_owned_team_actions } from './owned_team_actions_core.js'

const unused = async () => null

describe('owned team production sequencing', () => {
  it('joins distinct world-fight characters sequentially with their own exact arguments', async () => {
    const calls = []
    let in_flight = 0
    let max_in_flight = 0
    const actions = create_owned_team_actions({
      activate_run: unused,
      join_room_fight: unused,
      join_world_fight: async (args) => {
        calls.push(args)
        in_flight += 1
        max_in_flight = Math.max(max_in_flight, in_flight)
        await Promise.resolve()
        in_flight -= 1
        return `receipt-${args.character_id}`
      },
    })

    const receipts = await actions.join_owned_world_fight({
      fight_id: 'fight',
      party_id: 'party',
      members: [{ character_id: 'alt-a' }, { character_id: 'alt-a' }, 'alt-b'],
    })

    expect(calls).toEqual([
      // #1206: no per-member spell vector rides here — each door derives its OWN seat's raised spells.
      { fight_id: 'fight', character_id: 'alt-a', party_id: 'party' },
      { fight_id: 'fight', character_id: 'alt-b', party_id: 'party' },
    ])
    expect([...receipts]).toEqual([
      ['alt-a', 'receipt-alt-a'],
      ['alt-b', 'receipt-alt-b'],
    ])
    expect(max_in_flight).toBe(1)
  })

  it('activates one character per assigned key unit and returns the character-to-pass map', async () => {
    const calls = []
    const actions = create_owned_team_actions({
      join_world_fight: unused,
      join_room_fight: unused,
      activate_run: async (args) => {
        calls.push(args)
        return { receipt: `receipt-${args.character_id}`, run_pass_id: `pass-${args.character_id}` }
      },
    })
    const shared_key = {
      key_item_id: 'stack',
      key_kiosk_id: 'key-kiosk',
      key_kiosk_cap_id: 'key-cap',
    }

    const result = await actions.activate_owned_dungeon_runs({
      world_id: 'world',
      assignments: [
        { character_id: 'leader', ...shared_key },
        { character_id: 'alt', ...shared_key },
      ],
    })

    expect(calls).toEqual([
      { world_id: 'world', character_id: 'leader', ...shared_key },
      { world_id: 'world', character_id: 'alt', ...shared_key },
    ])
    expect([...result.run_pass_ids_by_character]).toEqual([
      ['leader', 'pass-leader'],
      ['alt', 'pass-alt'],
    ])
  })

  it('reports each confirmed activation before a later character refusal stops the sequence', async () => {
    const confirmed = []
    const refusal = new Error('second activation refused')
    const actions = create_owned_team_actions({
      join_world_fight: unused,
      join_room_fight: unused,
      activate_run: async ({ character_id }) => {
        if (character_id === 'alt') throw refusal
        return { receipt: `receipt-${character_id}`, run_pass_id: `pass-${character_id}` }
      },
    })

    const activation = actions.activate_owned_dungeon_runs({
      world_id: 'world',
      assignments: [{ character_id: 'leader' }, { character_id: 'alt' }],
      on_activated: (character_id, result) => confirmed.push([character_id, result.run_pass_id]),
    })

    await expect(activation).rejects.toBe(refusal)
    expect(confirmed).toEqual([['leader', 'pass-leader']])
  })

  it('settles and advances every owned alt pass from its exact leader-receipt outcome', async () => {
    const calls = []
    const actions = create_owned_team_actions({
      join_world_fight: unused,
      activate_run: unused,
      join_room_fight: unused,
      settle_run_and_open: async (args) => {
        calls.push(args)
        return { receipt: `receipt-${args.character_id}`, result_id: `result-${args.character_id}` }
      },
    })

    const settled = await actions.settle_owned_dungeon_runs({
      world_id: 'world',
      leader_character_id: 'leader',
      run_pass_ids_by_character: { leader: 'pass-leader', 'alt-a': 'pass-a', 'alt-b': 'pass-b' },
      outcome_ids_by_character: new Map([
        ['leader', 'outcome-leader'],
        ['alt-a', 'outcome-a'],
        ['alt-b', 'outcome-b'],
      ]),
    })

    // #1383: every companion open here is WIRE-fired off the leader's receipt — no player pressed anything —
    // so each declares itself `automated` and becomes the spend guard's subject (an executed failure retires
    // that one outcome's intent instead of re-burning on the next receipt).
    expect(calls).toEqual([
      { world_id: 'world', character_id: 'alt-a', run_pass_id: 'pass-a', outcome_id: 'outcome-a', automated: true },
      { world_id: 'world', character_id: 'alt-b', run_pass_id: 'pass-b', outcome_id: 'outcome-b', automated: true },
    ])
    expect([...settled.keys()]).toEqual(['alt-a', 'alt-b'])
  })

  it('stops dungeon room joins at the first refusal without retrying or running later characters', async () => {
    const calls = []
    const refusal = new Error('chain refusal')
    const actions = create_owned_team_actions({
      join_world_fight: unused,
      activate_run: unused,
      join_room_fight: async (args) => {
        calls.push(args.character_id)
        if (args.character_id === 'alt-b') throw refusal
        return `receipt-${args.character_id}`
      },
    })

    const joined = actions.join_owned_dungeon_room_fight({
      fight_id: 'fight',
      creator_pass_id: 'leader-pass',
      members: [
        { character_id: 'alt-a', run_pass_id: 'pass-a' },
        { character_id: 'alt-b', run_pass_id: 'pass-b' },
        { character_id: 'alt-c', run_pass_id: 'pass-c' },
      ],
    })

    await expect(joined).rejects.toBe(refusal)
    expect(calls).toEqual(['alt-a', 'alt-b'])
  })
})
