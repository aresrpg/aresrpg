// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1495 — MERGE AT THE DOOR. The duplicate a boot sweep has to clean up is a duplicate that should never have
// been created: the doors whose arriving item id is KNOWN at composition time fold it into the stack the
// player already owns, in the acquiring PTB itself. These assertions are on the SERIALIZED command list —
// the only proof that the merges ride the same transaction as the acquisition.
import { describe, expect, test } from 'bun:test'

import { gift_claim_ptb } from '../src/sui/write/gift.js'
import { marketplace_buy_item_ptb } from '../src/sui/write/items_marketplace.js'
import {
  MAX_FOLDS_PER_ACQUISITION,
  fold_stacks_ptb,
  plan_stack_folds,
  same_template_stack_ids,
} from '../src/sui/write/item_stacks.js'

import { IDS, deployed_context, id, targets } from './_onchain_fixtures.js'

const MERGE = 'extract::merge_locked_stacks_and_relock'
const BASE_RULE = id('base-rule')
const PERSONAL_RULE = id('personal-rule')

const item_policy = {
  id: IDS.aresrpg.ITEM_POLICY,
  rules: [
    `${BASE_RULE}::royalty_rule::Rule`,
    `${BASE_RULE}::kiosk_lock_rule::Rule`,
    `${PERSONAL_RULE}::personal_kiosk_rule::Rule`,
    `${IDS.aresrpg.PACKAGE_ID}::item::ListingRule`,
    `${IDS.aresrpg.PACKAGE_ID}::item::LotRule`,
  ],
}

const KIOSK = id('buyer-kiosk')
const CAP = id('buyer-personal-cap')
// Two siblings whose SORT order is not their declaration order — the survivor must be the LOWEST id, always.
const SIBLING_LOW = id('aaa-sibling')
const SIBLING_HIGH = id('zzz-sibling')
const ARRIVING = id('arriving-stack')

/** Every merge command's (target_id, source_id) pure inputs, in command order. */
const merge_pairs = tx => {
  const { commands, inputs } = tx.getData()
  return commands
    .filter(
      command =>
        command.$kind === 'MoveCall' &&
        `${command.MoveCall.module}::${command.MoveCall.function}` === MERGE,
    )
    .map(command => [
      inputs[command.MoveCall.arguments[2].Input].Pure.bytes,
      inputs[command.MoveCall.arguments[3].Input].Pure.bytes,
    ])
}

/** The pure input bytes an object id serializes to, read off a reference merge command. */
const id_bytes = item_id =>
  merge_pairs(
    fold_stacks_ptb(deployed_context)({
      kiosk_id: KIOSK,
      personal_kiosk_cap_id: CAP,
      folds: [
        { sibling_item_ids: [item_id], incoming_item_ids: [id('probe')] },
      ],
    }),
  )[0][0]

describe('plan_stack_folds — the pure fold plan', () => {
  test('the LOWEST sibling id survives; every other sibling and the arrival fold into it', () => {
    expect(
      plan_stack_folds([
        {
          sibling_item_ids: [SIBLING_HIGH, SIBLING_LOW],
          incoming_item_ids: [ARRIVING],
        },
      ]),
    ).toEqual([
      { target_item_id: SIBLING_LOW, source_item_id: SIBLING_HIGH },
      { target_item_id: SIBLING_LOW, source_item_id: ARRIVING },
    ])
  })

  test('zero siblings is a NO-OP — a first acquisition never pays for a merge', () => {
    expect(
      plan_stack_folds([
        { sibling_item_ids: [], incoming_item_ids: [ARRIVING] },
      ]),
    ).toEqual([])
    expect(plan_stack_folds([])).toEqual([])
    expect(plan_stack_folds(undefined)).toEqual([])
  })

  test('N templates fold independently, each into its own lowest survivor', () => {
    const other_low = id('bbb-other')
    expect(
      plan_stack_folds([
        { sibling_item_ids: [SIBLING_LOW], incoming_item_ids: [ARRIVING] },
        {
          sibling_item_ids: [other_low],
          incoming_item_ids: [id('other-arriving')],
        },
      ]),
    ).toEqual([
      { target_item_id: SIBLING_LOW, source_item_id: ARRIVING },
      { target_item_id: other_low, source_item_id: id('other-arriving') },
    ])
  })
})

describe('same_template_stack_ids — sibling resolution off the bag rows the client already reads', () => {
  const rows = [
    {
      id: SIBLING_HIGH,
      kiosk_id: KIOSK,
      template_id: 'bread',
      item_category: 'consumable',
    },
    {
      id: SIBLING_LOW,
      kiosk_id: KIOSK,
      template_id: 'bread',
      item_category: 'consumable',
    },
    // excluded: another kiosk, another template, a listed row, and a row with no template identity
    {
      id: id('other-kiosk'),
      kiosk_id: id('kiosk-2'),
      template_id: 'bread',
      item_category: 'consumable',
    },
    {
      id: id('other-template'),
      kiosk_id: KIOSK,
      template_id: 'wood',
      item_category: 'resource',
    },
    {
      id: id('listed'),
      kiosk_id: KIOSK,
      template_id: 'bread',
      item_category: 'consumable',
      listed: true,
    },
    { id: id('no-template'), kiosk_id: KIOSK, item_category: 'consumable' },
  ]
  const bread = {
    items: rows,
    kiosk_id: KIOSK,
    template_id: 'bread',
    item_category: 'consumable',
  }

  test('same kiosk + same template + unlisted, ascending', () => {
    expect(same_template_stack_ids(bread)).toEqual([SIBLING_LOW, SIBLING_HIGH])
  })

  test('a NON-STACKABLE category resolves nothing — gear never folds', () => {
    expect(
      same_template_stack_ids({
        items: [
          {
            id: id('sword-a'),
            kiosk_id: KIOSK,
            template_id: 'sword',
            item_category: 'sword',
          },
          {
            id: id('sword-b'),
            kiosk_id: KIOSK,
            template_id: 'sword',
            item_category: 'sword',
          },
        ],
        kiosk_id: KIOSK,
        template_id: 'sword',
        item_category: 'sword',
      }),
    ).toEqual([])
  })

  test('exclusions and a missing kiosk resolve nothing', () => {
    expect(
      same_template_stack_ids({ ...bread, exclude_item_ids: [SIBLING_LOW] }),
    ).toEqual([SIBLING_HIGH])
    expect(same_template_stack_ids({ ...bread, kiosk_id: '' })).toEqual([])
    expect(same_template_stack_ids({ ...bread, items: undefined })).toEqual([])
  })
})

describe('fold_stacks_ptb — the acquisition fold budget', () => {
  // A 16-stack gift meeting 3 siblings per template plans 48 merges — the shape that would otherwise
  // compose a PTB heavy enough for the sponsor's per-tx ceiling to refuse the ACQUISITION itself.
  const heavy = Array.from({ length: 16 }, (_, index) => ({
    sibling_item_ids: [
      id(`t${index}-a`),
      id(`t${index}-b`),
      id(`t${index}-c`),
    ],
    incoming_item_ids: [id(`t${index}-in`)],
  }))

  test('the plan is unbounded but the COMPOSER is capped — leftovers stay for the sweep', () => {
    expect(plan_stack_folds(heavy)).toHaveLength(48)
    const tx = fold_stacks_ptb(deployed_context)({
      kiosk_id: KIOSK,
      personal_kiosk_cap_id: CAP,
      folds: heavy,
    })
    expect(targets(tx)).toHaveLength(MAX_FOLDS_PER_ACQUISITION)
    expect(new Set(targets(tx))).toEqual(new Set([MERGE]))
  })

  test('the cap truncates the PLAN order — the first folds always compose', () => {
    const capped = fold_stacks_ptb(deployed_context)({
      kiosk_id: KIOSK,
      personal_kiosk_cap_id: CAP,
      folds: heavy,
    })
    expect(merge_pairs(capped)[0]).toEqual([
      id_bytes(id('t0-a')),
      id_bytes(id('t0-b')),
    ])
  })
})

describe('marketplace buy — the bought stack folds into the ones already owned', () => {
  const buy = extra =>
    marketplace_buy_item_ptb(deployed_context)({
      item_id: ARRIVING,
      seller_kiosk_id: id('seller-kiosk'),
      price_mist: 5000n,
      kiosk_id: KIOSK,
      personal_kiosk_cap_id: CAP,
      policy: item_policy,
      ...extra,
    })

  test('two siblings → two merges, LAST in the PTB, on the lowest sibling', () => {
    const tx = buy({ existing_stack_ids: [SIBLING_HIGH, SIBLING_LOW] })
    const command_targets = targets(tx)
    expect(command_targets.slice(-2)).toEqual([MERGE, MERGE])
    // the folds ride AFTER the cap is returned — the Move door borrows its owner cap out of the pkcap itself
    expect(command_targets.indexOf('personal_kiosk::return_val')).toBeLessThan(
      command_targets.indexOf(MERGE),
    )
    expect(merge_pairs(tx)).toEqual([
      [id_bytes(SIBLING_LOW), id_bytes(SIBLING_HIGH)],
      [id_bytes(SIBLING_LOW), id_bytes(ARRIVING)],
    ])
  })

  test('one sibling → exactly one merge: the purchase folds in', () => {
    expect(merge_pairs(buy({ existing_stack_ids: [SIBLING_LOW] }))).toEqual([
      [id_bytes(SIBLING_LOW), id_bytes(ARRIVING)],
    ])
  })

  test('zero siblings (and the untouched call shape) compose NO merge commands', () => {
    expect(targets(buy({ existing_stack_ids: [] }))).not.toContain(MERGE)
    expect(targets(buy({}))).not.toContain(MERGE)
  })

  test('a first-time buyer creating their kiosk has nothing to fold into', () => {
    const tx = marketplace_buy_item_ptb(deployed_context)({
      item_id: ARRIVING,
      seller_kiosk_id: id('seller-kiosk'),
      price_mist: 5000n,
      policy: item_policy,
    })
    expect(targets(tx)).not.toContain(MERGE)
  })

  test('siblings without the kiosk that holds them refuse — never a silent skip', () => {
    expect(() =>
      marketplace_buy_item_ptb(deployed_context)({
        item_id: ARRIVING,
        seller_kiosk_id: id('seller-kiosk'),
        price_mist: 5000n,
        policy: item_policy,
        existing_stack_ids: [SIBLING_LOW],
      }),
    ).toThrow(/needs kiosk_id and personal_kiosk_cap_id/)
  })
})

describe('gift claim — the claimed stacks fold into the recipient bag', () => {
  const claim = extra =>
    gift_claim_ptb(deployed_context)({
      gift_id: id('gift'),
      sender_kiosk_id: id('sender-kiosk'),
      recipient_kiosk_id: KIOSK,
      personal_kiosk_cap_id: CAP,
      ...extra,
    })

  test('two siblings → the same fold shape as the buy, after gift::claim', () => {
    const tx = claim({
      stack_folds: [
        {
          sibling_item_ids: [SIBLING_HIGH, SIBLING_LOW],
          incoming_item_ids: [ARRIVING],
        },
      ],
    })
    expect(targets(tx)).toEqual(['gift::claim', MERGE, MERGE])
    expect(merge_pairs(tx)).toEqual([
      [id_bytes(SIBLING_LOW), id_bytes(SIBLING_HIGH)],
      [id_bytes(SIBLING_LOW), id_bytes(ARRIVING)],
    ])
  })

  test('a multi-template gift folds each template into its own survivor', () => {
    const wood_low = id('bbb-wood')
    const wood_arriving = id('wood-arriving')
    const tx = claim({
      stack_folds: [
        { sibling_item_ids: [SIBLING_LOW], incoming_item_ids: [ARRIVING] },
        { sibling_item_ids: [wood_low], incoming_item_ids: [wood_arriving] },
      ],
    })
    expect(merge_pairs(tx)).toEqual([
      [id_bytes(SIBLING_LOW), id_bytes(ARRIVING)],
      [id_bytes(wood_low), id_bytes(wood_arriving)],
    ])
  })

  test('no folds (and an empty-sibling fold) leave the claim a single call', () => {
    expect(targets(claim({}))).toEqual(['gift::claim'])
    expect(
      targets(
        claim({
          stack_folds: [
            { sibling_item_ids: [], incoming_item_ids: [ARRIVING] },
          ],
        }),
      ),
    ).toEqual(['gift::claim'])
  })
})
