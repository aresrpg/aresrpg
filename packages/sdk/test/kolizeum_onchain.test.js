// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  aresrpg_deployment,
  aresrpg_deployment_ready,
} from '../src/deployment/aresrpg.js'
import {
  create_public_ptb,
  create_friends_only_ptb,
  join_ptb,
  exit_ptb,
  cancel_ptb,
  sweep_ptb,
} from '../src/sui/write/kolizeum_lobby.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  targets,
  find_call,
} from './_onchain_fixtures.js'

describe('aresrpg_deployment — the loud unset gate (the ONE merged id home)', () => {
  test('testnet is STAMPED (post-ceremony); mainnet stays DARK until its ceremony', () => {
    expect(aresrpg_deployment_ready('testnet')).toBe(true)
    expect(aresrpg_deployment_ready('mainnet')).toBe(false)
    expect(() => aresrpg_deployment('testnet')).not.toThrow()
    expect(() => aresrpg_deployment('mainnet')).toThrow(/not deployed/)
    expect(() => aresrpg_deployment('mainnet')).toThrow(/PACKAGE_ID/)
  })
  test('unknown network throws the distinct message; the override seam resolves', () => {
    expect(() => aresrpg_deployment('devnet')).toThrow(/no aresrpg ids/)
    expect(aresrpg_deployment('testnet', IDS.aresrpg).VERSION).toBe(
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
