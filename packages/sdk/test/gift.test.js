// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GIFT PTB builders (gift::send / gift::claim / gift::recall). OFFLINE: the deployment override seam
// (context.ids.aresrpg) builds each tx without a live publish; send's royalty-floor funding reads the STAMPED
// ITEM_ROYALTY_MIN_MIST constant off that same seam (no chain read, no gRPC stub
// needed). Asserts the targets + arg shapes, the exact/refused royalty funding, that claim resolves the policy
// receipt INSIDE one moveCall (no offline kiosk-rule calls), and the loud arg refusals. Mirrors lootbox.test.js's
// builder-shape pattern. Reconciled against packages/move/aresrpg/sources/gift.move.

import { describe, test, expect } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'

import {
  gift_send_ptb,
  gift_claim_ptb,
  gift_recall_ptb,
} from '../src/sui/write/gift.js'

import {
  deployed_context,
  undeployed_context,
  id,
  find_call,
  targets,
  IDS,
} from './_onchain_fixtures.js'

// The stamped floor (packages/sdk/src/deployment/aresrpg.js ITEM_ROYALTY_MIN_MIST) the fixture context carries.
const ROYALTY_MIN = BigInt(IDS.aresrpg.ITEM_ROYALTY_MIN_MIST)

/** Decode the tx's pure u64 inputs (the royalty split amount is the only 8-byte pure in a send). */
const pure_u64s = tx =>
  tx
    .getData()
    .inputs.filter(input => input.$kind === 'Pure')
    .map(input => fromBase64(input.Pure.bytes))
    .filter(bytes => bytes.length === 8)
    .map(bytes => BigInt(bcs.u64().parse(bytes)))

const SEND = {
  kiosk_id: id('skiosk'),
  personal_kiosk_cap_id: id('pkcap'),
  item_ids: [id('item1'), id('item2')],
  recipient: id('recipient'),
  royalty_mist: 20_000_000,
}

const CLAIM = {
  gift_id: id('gift'),
  sender_kiosk_id: id('skiosk'),
  recipient_kiosk_id: id('rkiosk'),
  personal_kiosk_cap_id: id('rpkcap'),
}

const RECALL = { gift_id: id('gift'), sender_kiosk_id: id('skiosk') }

describe('gift_send_ptb — gift::send builder (funds off the STAMPED royalty floor, no chain read)', () => {
  test('undeployed → refuses loudly', () => {
    expect(() => gift_send_ptb(undeployed_context)(SEND)).toThrow(
      /not deployed/,
    )
  })

  test('deployed → gift::send, 7 args, merged package, royalty split off gas', () => {
    const tx = gift_send_ptb(deployed_context)(SEND)
    const call = find_call(tx, 'gift::send')
    expect(call.package).toBe(IDS.aresrpg.GIFTING_PACKAGE_ID)
    expect(call.args).toBe(7)
    // The royalty coin is split off gas before the send moveCall (SplitCoins is not a MoveCall).
    expect(targets(tx)).toEqual(['gift::send'])
    expect(typeof tx.serialize()).toBe('string')
  })

  test('omitted royalty_mist → funds EXACTLY the stamped floor (N × ITEM_ROYALTY_MIN_MIST)', () => {
    const { royalty_mist, ...no_royalty } = SEND
    void royalty_mist
    const tx = gift_send_ptb(deployed_context)(no_royalty)
    // 2 items × the stamped floor — the split amount is the tx's only 8-byte pure input.
    expect(pure_u64s(tx)).toEqual([2n * ROYALTY_MIN])
  })

  test('explicit royalty_mist BELOW the stamped floor → refuses loudly (under-funded = unclaimable)', () => {
    expect(() =>
      gift_send_ptb(deployed_context)({ ...SEND, royalty_mist: 19_999_999 }),
    ).toThrow(/below the stamped floor/)
  })

  test('missing ITEM_ROYALTY_MIN_MIST stamp → refuses loudly (never build an underfunded gift)', () => {
    const unstamped = {
      ...deployed_context,
      ids: { aresrpg: { ...IDS.aresrpg, ITEM_ROYALTY_MIN_MIST: '' } },
    }
    expect(() => gift_send_ptb(unstamped)(SEND)).toThrow(/not stamped/)
  })

  test('zero ITEM_ROYALTY_MIN_MIST stamp → refuses loudly', () => {
    const zero_stamped = {
      ...deployed_context,
      ids: { aresrpg: { ...IDS.aresrpg, ITEM_ROYALTY_MIN_MIST: '0' } },
    }
    expect(() => gift_send_ptb(zero_stamped)(SEND)).toThrow(/not stamped/)
  })

  test('refuses an empty item_ids array (no items to gift)', () => {
    expect(() =>
      gift_send_ptb(deployed_context)({ ...SEND, item_ids: [] }),
    ).toThrow(/item_ids must be a non-empty array/)
  })

  test('refuses a missing recipient / kiosk_id', () => {
    expect(() =>
      gift_send_ptb(deployed_context)({ ...SEND, recipient: undefined }),
    ).toThrow(/kiosk_id, personal_kiosk_cap_id and recipient are required/)
  })
})

describe('gift_claim_ptb — gift::claim builder (receipt tail resolved IN Move)', () => {
  test('undeployed → refuses loudly', () => {
    expect(() => gift_claim_ptb(undeployed_context)(CLAIM)).toThrow(
      /not deployed/,
    )
  })

  test('deployed → gift::claim, 7 args, ONE moveCall (no offline rule resolution)', () => {
    const tx = gift_claim_ptb(deployed_context)(CLAIM)
    const call = find_call(tx, 'gift::claim')
    expect(call.package).toBe(IDS.aresrpg.GIFTING_PACKAGE_ID)
    expect(call.args).toBe(7)
    // The FULL royalty + lock receipt is resolved on-chain inside gift::claim → the PTB is a single call, with
    // ZERO royalty_rule/kiosk_lock_rule moveCalls (the InvalidLinkage money-path risk items_marketplace flags).
    expect(targets(tx)).toEqual(['gift::claim'])
    expect(typeof tx.serialize()).toBe('string')
  })

  test('refuses missing gift_id / sender_kiosk_id / recipient_kiosk_id / pkcap', () => {
    expect(() =>
      gift_claim_ptb(deployed_context)({
        ...CLAIM,
        sender_kiosk_id: undefined,
      }),
    ).toThrow(
      /gift_id, sender_kiosk_id, recipient_kiosk_id and personal_kiosk_cap_id/,
    )
  })
})

describe('gift_recall_ptb — gift::recall builder', () => {
  test('undeployed → refuses loudly', () => {
    expect(() => gift_recall_ptb(undeployed_context)(RECALL)).toThrow(
      /not deployed/,
    )
  })

  test('deployed → gift::recall, 2 args (ownership-only, no config/version)', () => {
    const tx = gift_recall_ptb(deployed_context)(RECALL)
    const call = find_call(tx, 'gift::recall')
    expect(call.package).toBe(IDS.aresrpg.GIFTING_PACKAGE_ID)
    expect(call.args).toBe(2)
    expect(targets(tx)).toEqual(['gift::recall'])
  })

  test('refuses a missing gift_id / sender_kiosk_id', () => {
    expect(() =>
      gift_recall_ptb(deployed_context)({ ...RECALL, gift_id: undefined }),
    ).toThrow(/gift_id and sender_kiosk_id are required/)
  })
})
