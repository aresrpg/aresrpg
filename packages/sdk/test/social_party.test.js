import { describe, test, expect } from 'bun:test'

import {
  create_party_ptb,
  party_invite_ptb,
  party_accept_ptb,
  party_decline_ptb,
  party_invite_accept_own_ptb,
  party_leave_ptb,
  party_kick_ptb,
  party_disband_ptb,
} from '../src/social.js'

import { EMPTY_IDS, IDS, id, find_call, targets } from './_onchain_fixtures.js'

const ctx = { network: 'testnet', ids: IDS }
const undeployed = { network: 'testnet', ids: EMPTY_IDS }
// core stamped but the social call target/version unset — the party guard must name the missing ids.
const no_social = {
  network: 'testnet',
  ids: {
    aresrpg: {
      ...IDS.aresrpg,
      SOCIAL_LATEST_PACKAGE_ID: '',
      SOCIAL_VERSION: '',
    },
  },
}

const PARTY_ARGS = {
  party_id: id('party'),
  kiosk_id: id('kiosk'),
  personal_kiosk_cap_id: id('pkcap'),
  leader_kiosk_id: id('kiosk'),
  leader_personal_kiosk_cap_id: id('pkcap'),
  leader_character_id: id('leader-character'),
  invited_character_id: id('invited-character'),
  invited_owner: id('invited-owner'),
  character_id: id('invited-character'),
  target_character_id: id('target-character'),
}

describe('Party builders — character-keyed ABI and current-owner proof arguments', () => {
  const CASES = [
    ['create', create_party_ptb, 'party::create', 4],
    ['invite', party_invite_ptb, 'party::invite', 7],
    ['accept', party_accept_ptb, 'party::accept', 5],
    ['decline', party_decline_ptb, 'party::decline', 5],
    ['leave', party_leave_ptb, 'party::leave', 5],
    ['kick', party_kick_ptb, 'party::kick', 6],
    ['disband', party_disband_ptb, 'party::disband', 5],
  ]

  for (const [name, builder, target, arg_count] of CASES) {
    test(`${name} → ${target} (${arg_count} args, typed social latest)`, () => {
      const tx = builder(ctx)(PARTY_ARGS)
      expect(targets(tx)).toEqual([target])
      const call = find_call(tx, target)
      expect(call.args).toBe(arg_count)
      expect(call.package).toBe(IDS.aresrpg.SOCIAL_LATEST_PACKAGE_ID)
      expect(call.types).toEqual([
        `${IDS.aresrpg.PACKAGE_ID}::character::Character`,
      ])
      expect(typeof tx.serialize()).toBe('string')
    })
  }

  test('invite_accept_own → invite(7) then accept(5) on the same social package', () => {
    const tx = party_invite_accept_own_ptb(ctx)(PARTY_ARGS)
    expect(targets(tx)).toEqual(['party::invite', 'party::accept'])
    expect(find_call(tx, 'party::invite').args).toBe(7)
    expect(find_call(tx, 'party::accept').args).toBe(5)
    expect(find_call(tx, 'party::invite').package).toBe(
      IDS.aresrpg.SOCIAL_LATEST_PACKAGE_ID,
    )
    expect(find_call(tx, 'party::accept').package).toBe(
      IDS.aresrpg.SOCIAL_LATEST_PACKAGE_ID,
    )
    expect(typeof tx.serialize()).toBe('string')
  })

  test('refuses at the existing social deployment guard', () => {
    expect(() => create_party_ptb(no_social)(PARTY_ARGS)).toThrow(/aresrpg_social/)
    expect(() => party_accept_ptb(undeployed)(PARTY_ARGS)).toThrow(/not deployed/)
  })
})
