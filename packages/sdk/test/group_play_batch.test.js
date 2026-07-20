import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import {
  activate_ptb,
  activate_many_ptb,
  join_fight_ptb as join_dungeon_fight_ptb,
} from '../src/dungeon.js'
import { join_fight_ptb } from '../src/fight.js'
import { party_invite_accept_own_ptb } from '../src/social.js'

import {
  IDS,
  id,
  move_calls,
  stub_kiosk_client,
  targets,
} from './_onchain_fixtures.js'

const ctx = {
  network: 'testnet',
  kiosk_client: stub_kiosk_client,
  ids: IDS,
}

const fight_id = id('team-fight')
const world_id = id('team-world')
const creator_pass_id = id('creator-pass')

const compose_members =
  append_member =>
  ({ members = [], tx = new Transaction() } = {}) => {
    for (const member of members) append_member({ ...member, tx })
    return tx
  }

const fight_member = tag => ({
  fight_id,
  kiosk_id: id(`${tag}-kiosk`),
  personal_kiosk_cap_id: id(`${tag}-cap`),
  character_id: id(`${tag}-character`),
  party_id: id('party'),
  raised_spell_ids: [id(`${tag}-spell`)],
})

const activation_member = tag => ({
  world_id,
  kiosk_id: id(`${tag}-character-kiosk`),
  personal_kiosk_cap_id: id(`${tag}-character-cap`),
  character_id: id(`${tag}-character`),
  key_item_id: id(`${tag}-key`),
  key_kiosk_id: id(`${tag}-key-kiosk`),
  key_kiosk_cap_id: id(`${tag}-key-cap`),
})

const dungeon_join_member = tag => ({
  fight_id,
  run_pass_id: id(`${tag}-pass`),
  creator_pass_id,
  kiosk_id: id(`${tag}-kiosk`),
  personal_kiosk_cap_id: id(`${tag}-cap`),
  character_id: id(`${tag}-character`),
  raised_spell_ids: [id(`${tag}-spell`)],
})

function argument_object_id(tx, argument) {
  if (argument?.$kind !== 'Input') return null
  const input = tx.getData().inputs[argument.Input]
  return (
    input?.UnresolvedObject?.objectId ??
    input?.Object?.SharedObject?.objectId ??
    input?.Object?.ImmOrOwnedObject?.objectId ??
    null
  )
}

describe('group fight joins — one PTB, caller order', () => {
  test('appends one unchanged 11-argument fight::join per member', () => {
    const first = fight_member('first')
    const second = fight_member('second')
    const supplied_tx = new Transaction()
    const tx = compose_members(join_fight_ptb(ctx))({
      members: [first, second],
      tx: supplied_tx,
    })

    expect(tx).toBe(supplied_tx)
    expect(targets(tx)).toEqual(['fight::join', 'fight::join'])
    expect(move_calls(tx).map(call => call.args)).toEqual([11, 11])
    expect(move_calls(tx).map(call => call.package)).toEqual([
      IDS.aresrpg.LATEST_PACKAGE_ID,
      IDS.aresrpg.LATEST_PACKAGE_ID,
    ])
    const { commands } = tx.getData()
    expect(argument_object_id(tx, commands.at(0).MoveCall.arguments[2])).toBe(
      first.kiosk_id,
    )
    expect(argument_object_id(tx, commands.at(1).MoveCall.arguments[2])).toBe(
      second.kiosk_id,
    )
    expect(typeof tx.serialize()).toBe('string')
  })

  test('same-wallet members may reuse one kiosk/cap input without duplicating its transaction input', () => {
    const first = fight_member('shared')
    const second = {
      ...fight_member('second-character'),
      kiosk_id: first.kiosk_id,
      personal_kiosk_cap_id: first.personal_kiosk_cap_id,
    }
    const tx = compose_members(join_fight_ptb(ctx))({
      members: [first, second],
    })
    const [first_call, second_call] = tx.getData().commands

    expect(first_call.MoveCall.arguments[2]).toEqual(
      second_call.MoveCall.arguments[2],
    )
    expect(first_call.MoveCall.arguments[3]).toEqual(
      second_call.MoveCall.arguments[3],
    )
    expect(typeof tx.serialize()).toBe('string')
  })
})

describe('Party owned-alt admission — one same-signer PTB', () => {
  test('invite+accept-own appends both calls with distinct same-signer ownership proofs', () => {
    const party_id = id('party')
    const leader_kiosk_id = id('leader-party-kiosk')
    const leader_personal_kiosk_cap_id = id('leader-party-cap')
    const invited_kiosk_id = id('invited-party-kiosk')
    const invited_personal_kiosk_cap_id = id('invited-party-cap')
    const supplied_tx = new Transaction()
    const tx = party_invite_accept_own_ptb(ctx)({
      party_id,
      leader_kiosk_id,
      leader_personal_kiosk_cap_id,
      invited_kiosk_id,
      invited_personal_kiosk_cap_id,
      leader_character_id: id('leader-character'),
      invited_character_id: id('owned-alt-character'),
      invited_owner: id('same-wallet'),
      tx: supplied_tx,
    })
    const [invite, accept] = tx.getData().commands

    expect(tx).toBe(supplied_tx)
    expect(targets(tx)).toEqual(['party::invite', 'party::accept'])
    expect(move_calls(tx).map(call => call.args)).toEqual([7, 5])
    expect(move_calls(tx).map(call => call.package)).toEqual([
      IDS.aresrpg.SOCIAL_LATEST_PACKAGE_ID,
      IDS.aresrpg.SOCIAL_LATEST_PACKAGE_ID,
    ])
    expect(move_calls(tx).map(call => call.types)).toEqual([
      [`${IDS.aresrpg.PACKAGE_ID}::character::Character`],
      [`${IDS.aresrpg.PACKAGE_ID}::character::Character`],
    ])
    expect(invite.MoveCall.arguments[0]).toEqual(accept.MoveCall.arguments[0])
    expect(invite.MoveCall.arguments[1]).not.toEqual(
      accept.MoveCall.arguments[1],
    )
    expect(invite.MoveCall.arguments[2]).not.toEqual(
      accept.MoveCall.arguments[2],
    )
    expect(invite.MoveCall.arguments[4]).toEqual(accept.MoveCall.arguments[3])
    expect(invite.MoveCall.arguments[6]).toEqual(accept.MoveCall.arguments[4])
    expect(argument_object_id(tx, invite.MoveCall.arguments[0])).toBe(party_id)
    expect(argument_object_id(tx, invite.MoveCall.arguments[1])).toBe(
      leader_kiosk_id,
    )
    expect(argument_object_id(tx, invite.MoveCall.arguments[2])).toBe(
      leader_personal_kiosk_cap_id,
    )
    expect(argument_object_id(tx, accept.MoveCall.arguments[1])).toBe(
      invited_kiosk_id,
    )
    expect(argument_object_id(tx, accept.MoveCall.arguments[2])).toBe(
      invited_personal_kiosk_cap_id,
    )
    expect(typeof tx.serialize()).toBe('string')
  })
})

describe('dungeon team activation — one PTB, caller order', () => {
  test('appends each unchanged 2-command activation composite in member order', () => {
    const first = activation_member('first')
    const second = activation_member('second')
    const supplied_tx = new Transaction()
    const tx = compose_members(activate_ptb(ctx))({
      members: [first, second],
      tx: supplied_tx,
    })
    const one_activation = [
      'extract::extract_one_for_burn',
      'dungeon::activate',
    ]

    expect(tx).toBe(supplied_tx)
    expect(targets(tx)).toEqual([...one_activation, ...one_activation])
    expect(move_calls(tx).map(call => call.args)).toEqual([5, 9, 5, 9])
    const { commands } = tx.getData()
    expect(argument_object_id(tx, commands.at(0).MoveCall.arguments[0])).toBe(
      first.key_kiosk_id,
    )
    expect(argument_object_id(tx, commands.at(2).MoveCall.arguments[0])).toBe(
      second.key_kiosk_id,
    )
    expect(argument_object_id(tx, commands.at(1).MoveCall.arguments[2])).toBe(
      first.kiosk_id,
    )
    expect(argument_object_id(tx, commands.at(3).MoveCall.arguments[2])).toBe(
      second.kiosk_id,
    )
    expect(
      move_calls(tx)
        .filter(call => call.target === 'dungeon::activate')
        .map(call => call.package),
    ).toEqual([IDS.aresrpg.DUNGEON_PACKAGE_ID, IDS.aresrpg.DUNGEON_PACKAGE_ID])
    expect(typeof tx.serialize()).toBe('string')
  })
})

describe('dungeon RunPass batch entry — one locked stack funds N characters', () => {
  test('appends N literal extract_one+activate pairs against the same remainder id', () => {
    const first = activation_member('first')
    const second = activation_member('second')
    const shared_key = {
      key_item_id: id('shared-key-stack'),
      key_kiosk_id: id('shared-key-kiosk'),
      key_kiosk_cap_id: id('shared-key-cap'),
    }
    const supplied_tx = new Transaction()
    const tx = activate_many_ptb(ctx)({
      members: [
        { ...first, ...shared_key },
        { ...second, ...shared_key },
      ],
      tx: supplied_tx,
    })
    const [extract_first, activate_first, extract_second, activate_second] =
      tx.getData().commands

    expect(tx).toBe(supplied_tx)
    expect(targets(tx)).toEqual([
      'extract::extract_one_for_burn',
      'dungeon::activate',
      'extract::extract_one_for_burn',
      'dungeon::activate',
    ])
    expect(move_calls(tx).map(call => call.args)).toEqual([5, 9, 5, 9])
    expect(move_calls(tx).map(call => call.package)).toEqual([
      IDS.aresrpg.LATEST_PACKAGE_ID,
      IDS.aresrpg.DUNGEON_PACKAGE_ID,
      IDS.aresrpg.LATEST_PACKAGE_ID,
      IDS.aresrpg.DUNGEON_PACKAGE_ID,
    ])

    // Both extraction calls address the SAME kiosk-locked stack id. Move preserves/re-locks that remainder id
    // before the next command, while each activate consumes only the new single-unit result handle.
    expect(extract_first.MoveCall.arguments[0]).toEqual(
      extract_second.MoveCall.arguments[0],
    )
    expect(extract_first.MoveCall.arguments[1]).toEqual(
      extract_second.MoveCall.arguments[1],
    )
    const first_key_input =
      tx.getData().inputs[extract_first.MoveCall.arguments[2].Input]
    const second_key_input =
      tx.getData().inputs[extract_second.MoveCall.arguments[2].Input]
    expect(first_key_input).toEqual(second_key_input)
    expect(argument_object_id(tx, activate_first.MoveCall.arguments[2])).toBe(
      first.kiosk_id,
    )
    expect(argument_object_id(tx, activate_second.MoveCall.arguments[2])).toBe(
      second.kiosk_id,
    )
    expect(typeof tx.serialize()).toBe('string')
  })

  test('empty members return the supplied transaction unchanged', () => {
    const tx = new Transaction()
    expect(activate_many_ptb(ctx)({ members: [], tx })).toBe(tx)
    expect(targets(tx)).toEqual([])
  })
})

describe('dungeon fight joins — one PTB, caller order', () => {
  test('appends one unchanged 13-argument dungeon::join_fight per member', () => {
    const first = dungeon_join_member('first')
    const second = dungeon_join_member('second')
    const supplied_tx = new Transaction()
    const tx = compose_members(join_dungeon_fight_ptb(ctx))({
      members: [first, second],
      tx: supplied_tx,
    })

    expect(tx).toBe(supplied_tx)
    expect(targets(tx)).toEqual(['dungeon::join_fight', 'dungeon::join_fight'])
    expect(move_calls(tx).map(call => call.args)).toEqual([13, 13])
    expect(move_calls(tx).map(call => call.package)).toEqual([
      IDS.aresrpg.DUNGEON_PACKAGE_ID,
      IDS.aresrpg.DUNGEON_PACKAGE_ID,
    ])
    const { commands } = tx.getData()
    expect(argument_object_id(tx, commands.at(0).MoveCall.arguments[4])).toBe(
      first.kiosk_id,
    )
    expect(argument_object_id(tx, commands.at(1).MoveCall.arguments[4])).toBe(
      second.kiosk_id,
    )
    expect(typeof tx.serialize()).toBe('string')
  })
})

describe('team composers — empty input', () => {
  const cases = [
    ['fight joins', join_fight_ptb],
    ['dungeon activations', activate_ptb],
    ['dungeon fight joins', join_dungeon_fight_ptb],
  ]

  for (const [name, builder] of cases) {
    test(`${name} return the supplied empty transaction unchanged`, () => {
      const tx = new Transaction()
      expect(compose_members(builder(ctx))({ members: [], tx })).toBe(tx)
      expect(targets(tx)).toEqual([])
    })

    test(`${name} default to a new empty transaction`, () => {
      const tx = compose_members(builder(ctx))()
      expect(tx).toBeInstanceOf(Transaction)
      expect(targets(tx)).toEqual([])
      expect(typeof tx.serialize()).toBe('string')
    })
  }
})
