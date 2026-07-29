// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  list_ptb,
  list_stack_ptb,
  delist_ptb,
  is_legal_lot_size,
  marketplace_fee_mist,
  marketplace_purchase_total_mist,
  marketplace_total_mist,
  marketplace_buy_item_ptb,
  marketplace_buy_character_ptb,
} from '../src/sui/write/items_marketplace.js'
import {
  policy_rule_package,
  resolve_marketplace_rule_targets,
} from '../src/sui/transfer_policies.js'
import { SDK } from '../src/sui.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  targets,
  find_call,
} from './_onchain_fixtures.js'

const BASE_RULE_DEFINING_PACKAGE = id('base-rule')
const PERSONAL_RULE_DEFINING_PACKAGE = id('personal-rule')
const SUI_FRAMEWORK = `0x${'2'.padStart(64, '0')}`

const policy_fixture = kind => ({
  id: kind === 'item' ? IDS.aresrpg.ITEM_POLICY : IDS.aresrpg.CHARACTER_POLICY,
  type: `0x2::transfer_policy::TransferPolicy<${IDS.aresrpg.PACKAGE_ID}::${kind}::${kind === 'item' ? 'Item' : 'Character'}>`,
  rules: [
    `${BASE_RULE_DEFINING_PACKAGE}::royalty_rule::Rule`,
    `${BASE_RULE_DEFINING_PACKAGE}::kiosk_lock_rule::Rule`,
    `${PERSONAL_RULE_DEFINING_PACKAGE}::personal_kiosk_rule::Rule`,
    ...(kind === 'item'
      ? [`${IDS.aresrpg.PACKAGE_ID}::item::ListingRule`]
      : [`${IDS.aresrpg.PACKAGE_ID}::character_listing_rule::Rule`]),
    ...(kind === 'item' ? [`${IDS.aresrpg.PACKAGE_ID}::item::LotRule`] : []),
  ],
})

const item_policy = policy_fixture('item')
const character_policy = policy_fixture('character')

const list_args = {
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  item_id: id('i0'),
  price_mist: 5000n,
  policy: item_policy,
}
const delist_args = {
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  item_id: id('i0'),
  policy: item_policy,
}

const command_map = tx =>
  tx
    .getData()
    .commands.map(command =>
      command.$kind === 'MoveCall'
        ? `${command.MoveCall.package}::${command.MoveCall.module}::${command.MoveCall.function}`
        : command.$kind,
    )

const listed_id_arg = tx => {
  const command = tx.getData().commands[targets(tx).indexOf('kiosk::list')]
  const [, , listed] = command.MoveCall.arguments
  return listed
}

describe('marketplace builders — refuse loudly when items undeployed', () => {
  test('list / delist refuse', () => {
    expect(() => list_ptb(undeployed_context)(list_args)).toThrow(
      /not deployed/,
    )
    expect(() => delist_ptb(undeployed_context)(delist_args)).toThrow(
      /not deployed/,
    )
  })
})

describe('marketplace list/delist — target strings + arg shapes', () => {
  test('list → kiosk::list at the Item type, 4 args, inside the personal-cap dance', () => {
    const tx = list_ptb(deployed_context)(list_args)
    expect(targets(tx)).toEqual([
      'personal_kiosk::borrow_val',
      'kiosk::list',
      'personal_kiosk::return_val',
    ])
    const call = find_call(tx, 'kiosk::list')
    expect(call.args).toBe(4)
    expect(call.types).toEqual([`${IDS.aresrpg.PACKAGE_ID}::item::Item`])
  })
  test('delist → kiosk::delist, 3 args', () => {
    const tx = delist_ptb(deployed_context)(delist_args)
    expect(targets(tx)).toEqual([
      'personal_kiosk::borrow_val',
      'kiosk::delist',
      'personal_kiosk::return_val',
    ])
    expect(find_call(tx, 'kiosk::delist').args).toBe(3)
  })

  test('list_stack accepts exactly the four legal amounts and delegates native kiosk::list', () => {
    for (const amount of [1, 10, 100, 1000]) {
      expect(is_legal_lot_size(amount)).toBe(true)
      const tx = list_stack_ptb(deployed_context)({
        ...list_args,
        stacks: [{ id: list_args.item_id, amount }],
        amount,
      })
      expect(targets(tx)).toEqual([
        'personal_kiosk::borrow_val',
        'kiosk::list',
        'personal_kiosk::return_val',
      ])
    }
  })

  test('list_stack rejects every non-lot amount before kiosk::list is composed', () => {
    for (const amount of [0, 2, 9, 11, 99, 101, 999, 1001, 'invalid']) {
      expect(is_legal_lot_size(amount)).toBe(false)
      expect(() =>
        list_stack_ptb(deployed_context)({
          ...list_args,
          stacks: [{ id: list_args.item_id, amount: 1000 }],
          amount,
        }),
      ).toThrow(/one of 1, 10, 100, 1000/)
    }
  })

  // #492 — a gathered stack is an ARBITRARY size, but a kiosk lot may only be 1/10/100/1000. Listing therefore has
  // to SHAPE the lot out of the stack it is given; requiring the seller to already hold a stack of exactly the lot
  // size is what made the sell flow uncompletable for every stack the world actually produces.
  test('list_stack splits the lot out of a larger stack, then lists the SPLIT CHILD', () => {
    const tx = list_stack_ptb(deployed_context)({
      ...list_args,
      stacks: [{ id: list_args.item_id, amount: 25 }],
      amount: 10,
    })
    expect(targets(tx)).toEqual([
      'extract::split_locked_stack',
      'personal_kiosk::borrow_val',
      'kiosk::list',
      'personal_kiosk::return_val',
    ])

    // The listed id must be the split's RESULT, never the source stack — listing the 25-unit source would abort
    // `ELotInvalid` at the buyer's `prove_lot`, leaving an unsellable listing (a money trap, not a refusal).
    const split_index = targets(tx).indexOf('extract::split_locked_stack')
    const listed = listed_id_arg(tx)
    expect(listed.$kind).toBe('NestedResult')
    expect(listed.NestedResult).toEqual([split_index, 0])
  })

  test('list_stack lists the source directly when it already IS the lot (no split)', () => {
    const tx = list_stack_ptb(deployed_context)({
      ...list_args,
      stacks: [{ id: list_args.item_id, amount: 10 }],
      amount: 10,
    })
    expect(targets(tx)).toEqual([
      'personal_kiosk::borrow_val',
      'kiosk::list',
      'personal_kiosk::return_val',
    ])
  })

  test('list_stack refuses a lot larger than the stack holds', () => {
    expect(() =>
      list_stack_ptb(deployed_context)({
        ...list_args,
        stacks: [{ id: list_args.item_id, amount: 25 }],
        amount: 100,
      }),
    ).toThrow(/hold 25 units/)
  })

  test('a 10-unit lot is covered across live stacks {4,4,5}, merged, split, then lists the child', () => {
    const tx = list_stack_ptb(deployed_context)({
      kiosk_id: list_args.kiosk_id,
      personal_kiosk_cap_id: list_args.personal_kiosk_cap_id,
      stacks: [
        { id: id('stack-four-a'), amount: 4 },
        { id: id('stack-four-b'), amount: 4 },
        { id: id('stack-five'), amount: 5 },
      ],
      amount: 10,
      price_mist: list_args.price_mist,
      policy: item_policy,
    })

    expect(targets(tx)).toEqual([
      'extract::merge_locked_stacks_and_relock',
      'extract::merge_locked_stacks_and_relock',
      'extract::split_locked_stack',
      'personal_kiosk::borrow_val',
      'kiosk::list',
      'personal_kiosk::return_val',
    ])
    const split_index = targets(tx).indexOf('extract::split_locked_stack')
    const listed = listed_id_arg(tx)
    expect(listed.$kind).toBe('NestedResult')
    expect(listed.NestedResult).toEqual([split_index, 0])
  })
})

describe('marketplace exact wallet debit', () => {
  const min_amount_mist = BigInt(IDS.aresrpg.ITEM_ROYALTY_MIN_MIST)

  test('total is ask + max(floor(10%), stamped minimum)', () => {
    expect(marketplace_fee_mist(50_000_000n, min_amount_mist)).toBe(10_000_000n)
    expect(marketplace_total_mist(50_000_000n, min_amount_mist)).toBe(
      60_000_000n,
    )
    expect(marketplace_fee_mist(200_000_000n, min_amount_mist)).toBe(
      20_000_000n,
    )
    expect(marketplace_total_mist(200_000_000n, min_amount_mist)).toBe(
      220_000_000n,
    )
  })

  test('context-bound helper uses the stamped Item-policy floor and rejects an unstamped floor', () => {
    expect(marketplace_purchase_total_mist(deployed_context)(50_000_000n)).toBe(
      60_000_000n,
    )
    expect(() =>
      marketplace_purchase_total_mist({
        ...deployed_context,
        ids: {
          aresrpg: { ...IDS.aresrpg, ITEM_ROYALTY_MIN_MIST: '' },
        },
      })(50_000_000n),
    ).toThrow(/min_amount_mist must be stamped/)
  })

  test('SDK factory exposes the lot, stack-shaping, purchase, and exact-total surface', async () => {
    const sdk = await SDK({ network: 'testnet' })
    expect(typeof sdk.marketplace_list_stack_ptb).toBe('function')
    expect(typeof sdk.marketplace_buy_item_ptb).toBe('function')
    expect(typeof sdk.split_stack_ptb).toBe('function')
    expect(typeof sdk.merge_stack_ptb).toBe('function')
    expect(sdk.marketplace_purchase_total_mist(50_000_000n)).toBe(60_000_000n)
  })

  // #422 — the pre-merge monolith's assets belong to an abandoned universe; nothing resolves their
  // TransferPolicy through the SDK anymore. Guards the deletion: a reintroduction would resurface here.
  test('SDK factory no longer exposes the dead legacy-monolith TransferPolicy surface', async () => {
    const sdk = await SDK({ network: 'testnet' })
    expect(sdk.TRANSFER_POLICIES).toBeUndefined()
    expect(sdk.get_policies_profit).toBeUndefined()
    expect(sdk.LEGACY_PACKAGE_ID).toBeUndefined()
    expect(sdk.LEGACY_ITEM_POLICY).toBeUndefined()
    expect(sdk.LEGACY_CHARACTER_POLICY).toBeUndefined()
  })
})

describe('kiosk-rule-linkage — list/delist never mix personal_kiosk::* with an aresrpg call (plain 0x2::kiosk only), but still resolve ONE consistent id', () => {
  test('list / delist validate the policy rules, then resolve personal_kiosk at the fresh linkage target', () => {
    expect(
      find_call(
        list_ptb(deployed_context)(list_args),
        'personal_kiosk::borrow_val',
      ).package,
    ).toBe(IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID)
    expect(
      find_call(
        delist_ptb(deployed_context)(delist_args),
        'personal_kiosk::borrow_val',
      ).package,
    ).toBe(IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID)
  })
})

describe('marketplace TransferPolicy rule resolution', () => {
  test('reads each defining package from the policy rule TypeName fixture', () => {
    expect(policy_rule_package(item_policy, 'royalty_rule')).toBe(
      BASE_RULE_DEFINING_PACKAGE,
    )
    expect(policy_rule_package(item_policy, 'personal_kiosk_rule')).toBe(
      PERSONAL_RULE_DEFINING_PACKAGE,
    )
    expect(policy_rule_package(item_policy, 'item', 'ListingRule')).toBe(
      IDS.aresrpg.PACKAGE_ID,
    )
    expect(policy_rule_package(item_policy, 'item', 'LotRule')).toBe(
      IDS.aresrpg.PACKAGE_ID,
    )
  })

  test('fresh-package fixture: every resolved call target equals its policy rule-type package', () => {
    const fresh_kiosk = id('fresh-kiosk')
    const fresh_core = id('fresh-core')
    const policy = {
      id: id('fresh-policy'),
      rules: [
        `${fresh_kiosk}::royalty_rule::Rule`,
        `${fresh_kiosk}::kiosk_lock_rule::Rule`,
        `${fresh_kiosk}::personal_kiosk_rule::Rule`,
        `${fresh_core}::item::ListingRule`,
      ],
    }
    const resolved = resolve_marketplace_rule_targets({
      policy,
      kiosk_rule_package_id: fresh_kiosk,
      listing_rule_module: 'item',
      listing_rule_type: 'ListingRule',
      listing_rule_package_id: fresh_core,
    })
    expect(resolved.royalty_rule).toBe(
      policy_rule_package(policy, 'royalty_rule'),
    )
    expect(resolved.kiosk_lock_rule).toBe(
      policy_rule_package(policy, 'kiosk_lock_rule'),
    )
    expect(resolved.personal_kiosk_rule).toBe(
      policy_rule_package(policy, 'personal_kiosk_rule'),
    )
    expect(resolved.listing_rule).toBe(
      policy_rule_package(policy, 'item', 'ListingRule'),
    )
  })

  test('upgraded lineage: rule tags prove presence while all base calls use the restamped linkage target', () => {
    const resolved = resolve_marketplace_rule_targets({
      policy: item_policy,
      kiosk_rule_package_id: IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      listing_rule_module: 'item',
      listing_rule_type: 'ListingRule',
      listing_rule_package_id: IDS.aresrpg.LATEST_PACKAGE_ID,
    })
    expect(resolved).toEqual({
      royalty_rule: IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      kiosk_lock_rule: IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      personal_kiosk_rule: IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      listing_rule: IDS.aresrpg.LATEST_PACKAGE_ID,
    })
    expect(resolved.personal_kiosk_rule).not.toBe(
      policy_rule_package(item_policy, 'personal_kiosk_rule'),
    )
  })

  test('missing, duplicate, and malformed policy tags refuse before a money PTB is built', () => {
    const args = {
      kiosk_rule_package_id: IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      listing_rule_module: 'item',
      listing_rule_type: 'ListingRule',
      listing_rule_package_id: IDS.aresrpg.LATEST_PACKAGE_ID,
    }
    expect(() =>
      resolve_marketplace_rule_targets({
        ...args,
        policy: {
          ...item_policy,
          rules: item_policy.rules.filter(
            type => !type.includes('personal_kiosk_rule'),
          ),
        },
      }),
    ).toThrow(/personal_kiosk_rule::Rule tag \(found 0\)/)
    expect(() =>
      resolve_marketplace_rule_targets({
        ...args,
        policy: {
          ...item_policy,
          rules: [...item_policy.rules, item_policy.rules[0]],
        },
      }),
    ).toThrow(/royalty_rule::Rule tag \(found 2\)/)
    expect(() =>
      resolve_marketplace_rule_targets({
        ...args,
        policy: { ...item_policy, rules: { contents: [{}] } },
      }),
    ).toThrow(/malformed rule tag/)
  })
})

describe('marketplace buy — full policy receipt tail', () => {
  const buyer = {
    kiosk_id: id('buyer-kiosk'),
    personal_kiosk_cap_id: id('buyer-personal-cap'),
    seller_kiosk_id: id('seller-kiosk'),
    price_mist: 5000n,
  }

  test('item buy resolves the five policy receipts at their fresh linkage targets', () => {
    const tx = marketplace_buy_item_ptb(deployed_context)({
      ...buyer,
      item_id: id('listed-item'),
      policy: item_policy,
    })
    expect(command_map(tx)).toEqual([
      `${IDS.aresrpg.LATEST_PACKAGE_ID}::header::aresrpg`,
      `${IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID}::personal_kiosk::borrow_val`,
      'SplitCoins',
      `${SUI_FRAMEWORK}::kiosk::purchase`,
      `${IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID}::royalty_rule::fee_amount`,
      'SplitCoins',
      `${IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID}::royalty_rule::pay`,
      `${IDS.aresrpg.LATEST_PACKAGE_ID}::item::prove_listing_amount`,
      `${IDS.aresrpg.LATEST_PACKAGE_ID}::item::prove_lot`,
      `${SUI_FRAMEWORK}::kiosk::lock`,
      `${IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID}::kiosk_lock_rule::prove`,
      `${IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID}::personal_kiosk_rule::prove`,
      `${SUI_FRAMEWORK}::transfer_policy::confirm_request`,
      `${IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID}::personal_kiosk::return_val`,
    ])
  })

  test('item buy requires the lot rule and resolves it at the latest Ares linkage target', () => {
    const tx = marketplace_buy_item_ptb(deployed_context)({
      ...buyer,
      item_id: id('lot-item'),
      policy: item_policy,
    })
    const lot = find_call(tx, 'item::prove_lot')
    expect(lot.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(lot.args).toBe(2)

    expect(() =>
      marketplace_buy_item_ptb(deployed_context)({
        ...buyer,
        item_id: id('missing-lot-item'),
        policy: {
          ...item_policy,
          rules: item_policy.rules.filter(type => !type.includes('LotRule')),
        },
      }),
    ).toThrow(/item::LotRule tag \(found 0\)/)
  })

  test('character buy resolves the same linkage target and its own listing rule', () => {
    const tx = marketplace_buy_character_ptb(deployed_context)({
      ...buyer,
      character_id: id('listed-character'),
      policy: character_policy,
    })
    expect(find_call(tx, 'royalty_rule::pay').package).toBe(
      IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
    )
    expect(find_call(tx, 'kiosk_lock_rule::prove').package).toBe(
      IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
    )
    expect(find_call(tx, 'personal_kiosk_rule::prove').package).toBe(
      IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
    )
    expect(find_call(tx, 'character_listing_rule::prove_level').package).toBe(
      IDS.aresrpg.LATEST_PACKAGE_ID,
    )
    expect(targets(tx).some(target => target === 'item::prove_lot')).toBe(false)
  })

  test('first buy creates a personal kiosk with the same fresh linkage target', () => {
    const tx = marketplace_buy_item_ptb(deployed_context)({
      item_id: id('first-listed-item'),
      seller_kiosk_id: buyer.seller_kiosk_id,
      price_mist: buyer.price_mist,
      policy: item_policy,
    })
    for (const target of [
      'personal_kiosk::new',
      'personal_kiosk::borrow_val',
      'royalty_rule::pay',
      'kiosk_lock_rule::prove',
      'personal_kiosk_rule::prove',
      'personal_kiosk::return_val',
      'personal_kiosk::transfer_to_sender',
    ])
      expect(find_call(tx, target).package).toBe(
        IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      )
  })
})
