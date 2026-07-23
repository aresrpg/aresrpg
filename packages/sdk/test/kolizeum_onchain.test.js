// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  kolizeum_deployment,
  kolizeum_deployment_ready,
} from '../src/deployment/kolizeum.js'
import {
  create_public_ptb,
  create_friends_only_ptb,
  join_ptb,
  exit_ptb,
  cancel_ptb,
  sweep_ptb,
} from '../src/sui/write/kolizeum_lobby.js'
import { get_kolizeum, KOLIZEUM_STATUS } from '../src/sui/read/kolizeum.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  targets,
  find_call,
} from './_onchain_fixtures.js'

describe('kolizeum_deployment — the loud unset gate (shim over the ONE merged home)', () => {
  test('testnet is STAMPED (post-ceremony); mainnet stays DARK until its ceremony', () => {
    expect(kolizeum_deployment_ready('testnet')).toBe(true)
    expect(kolizeum_deployment_ready('mainnet')).toBe(false)
    expect(() => kolizeum_deployment('testnet')).not.toThrow()
    expect(() => kolizeum_deployment('mainnet')).toThrow(/not deployed/)
    expect(() => kolizeum_deployment('mainnet')).toThrow(/PACKAGE_ID/)
  })
  test('unknown network throws the distinct message; the override seam resolves', () => {
    expect(() => kolizeum_deployment('devnet')).toThrow(/no aresrpg ids/)
    expect(kolizeum_deployment('testnet', IDS.aresrpg).VERSION).toBe(
      IDS.aresrpg.VERSION,
    )
  })
})

const seat = {
  character_id: id('ca0'),
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
}
const create_args = {
  format_slots: 3,
  pledge_amount: 1000,
  max_level_diff: 20,
  ...seat,
}
const lobby = { kolizeum_id: id('c0') }

describe('kolizeum builders — refuse loudly when undeployed', () => {
  test('every lobby builder refuses', () => {
    expect(() => create_public_ptb(undeployed_context)(create_args)).toThrow(
      /not deployed/,
    )
    expect(() =>
      join_ptb(undeployed_context)({ ...lobby, pledge_amount: 1000, ...seat }),
    ).toThrow(/not deployed/)
    expect(() => exit_ptb(undeployed_context)(lobby)).toThrow(/not deployed/)
    expect(() => sweep_ptb(undeployed_context)(lobby)).toThrow(/not deployed/)
  })
})

describe('kolizeum builders — target strings + arg shapes', () => {
  test('create_public: borrow dance wraps kolizeum::create_public (7 args)', () => {
    const tx = create_public_ptb(deployed_context)(create_args)
    const t = targets(tx)
    // the locked-character borrow-val dance brackets the call
    expect(t).toEqual([
      'header::aresrpg',
      'personal_kiosk::borrow_val',
      'kiosk::borrow_val',
      'kolizeum::create_public',
      'kiosk::return_val',
      'personal_kiosk::return_val',
    ])
    const call = find_call(tx, 'kolizeum::create_public')
    // package-split 2026-07-11: the lobby money core moved to the sibling aresrpg_kolizeum package too
    expect(call.package).toBe(IDS.aresrpg.KOLIZEUM_PACKAGE_ID)
    expect(call.package).not.toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(7)
    // the character is borrowed at the merged package's Character type
    expect(find_call(tx, 'kiosk::borrow_val').types).toEqual([
      `${IDS.aresrpg.PACKAGE_ID}::character::Character`,
    ])
  })
  test('create_friends_only → 8 args', () => {
    const call = find_call(
      create_friends_only_ptb(deployed_context)({
        ...create_args,
        friend_list_id: id('f0'),
      }),
      'kolizeum::create_friends_only',
    )
    expect(call.args).toBe(8)
  })
  test('join → kolizeum::join, 5 args (S-51b arity fix: the deployed door takes config — the S-46 kill-switch bit)', () => {
    const call = find_call(
      join_ptb(deployed_context)({ ...lobby, pledge_amount: 1000, ...seat }),
      'kolizeum::join',
    )
    expect(call.args).toBe(5)
    expect(call.package).toBe(IDS.aresrpg.KOLIZEUM_PACKAGE_ID)
  })
  test('exit / cancel → 2 args; sweep → 1 arg (by value)', () => {
    expect(
      find_call(exit_ptb(deployed_context)(lobby), 'kolizeum::exit').args,
    ).toBe(2)
    expect(
      find_call(cancel_ptb(deployed_context)(lobby), 'kolizeum::cancel').args,
    ).toBe(2)
    expect(
      find_call(sweep_ptb(deployed_context)(lobby), 'kolizeum::sweep').args,
    ).toBe(1)
    // all lobby targets ride the sibling aresrpg_kolizeum package (package-split re-point)
    expect(
      find_call(exit_ptb(deployed_context)(lobby), 'kolizeum::exit').package,
    ).toBe(IDS.aresrpg.KOLIZEUM_PACKAGE_ID)
    expect(
      find_call(sweep_ptb(deployed_context)(lobby), 'kolizeum::sweep').package,
    ).toBe(IDS.aresrpg.KOLIZEUM_PACKAGE_ID)
  })
})

describe('kiosk-rule-linkage — create/join borrow personal_kiosk::* ALONGSIDE a kolizeum:: aresrpg call, so it MUST target the aresrpg-bound fork', () => {
  test('create_public / create_friends_only / join resolve personal_kiosk at KIOSK_ROYALTY_RULE_PACKAGE_ID', () => {
    expect(
      find_call(
        create_public_ptb(deployed_context)(create_args),
        'personal_kiosk::borrow_val',
      ).package,
    ).toBe(IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID)
    expect(
      find_call(
        create_friends_only_ptb(deployed_context)({
          ...create_args,
          friend_list_id: id('f0'),
        }),
        'personal_kiosk::borrow_val',
      ).package,
    ).toBe(IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID)
    expect(
      find_call(
        join_ptb(deployed_context)({ ...lobby, pledge_amount: 1000, ...seat }),
        'personal_kiosk::borrow_val',
      ).package,
    ).toBe(IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID)
  })
})

describe('get_kolizeum — lobby read', () => {
  test('returns null when unreadable', async () => {
    const grpc_client = { core: { getObject: async () => ({ object: null }) } }
    expect(await get_kolizeum({ grpc_client })(id('c0'))).toBeNull()
  })
  test('decodes status + pot + side rosters', async () => {
    const grpc_client = {
      core: {
        getObject: async () => ({
          object: {
            json: {
              id: id('c0'),
              creator: id('0a'),
              status: KOLIZEUM_STATUS.OPEN,
              format_slots: '3',
              pledge_amount: '1000',
              pot: { value: '2000' },
              is_public: true,
              max_level_diff: '20',
              creator_level: '30',
              allow: [],
              side_a: [
                {
                  owner: id('0a'),
                  character: id('ca0'),
                  level: '30',
                  join_order: '0',
                },
              ],
              side_b: [],
            },
          },
        }),
      },
    }
    const k = await get_kolizeum({ grpc_client })(id('c0'))
    expect(k.status).toBe(KOLIZEUM_STATUS.OPEN)
    expect(k.pot).toBe(2000n)
    expect(k.side_a).toHaveLength(1)
    expect(k.side_a[0].level).toBe(30n)
  })
})
