// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  commission_request_ptb,
  commission_accept_ptb,
  commission_execute_ptb,
  commission_cancel_ptb,
  commission_redeem_xp_ptb,
} from '../src/sui/write/commission.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  targets,
  find_call,
} from './_onchain_fixtures.js'

const A = IDS.aresrpg

const request_args = {
  artisan: id('artisan'),
  recipe_id: id('r0'),
  amount_mist: 5000n,
}
const accept_args = {
  request_id: id('rq0'),
  recipe_id: id('r0'),
  artisan_kiosk_id: id('ak0'),
  personal_kiosk_cap_id: id('apk0'),
  character_id: id('ch0'),
}
const execute_args = {
  request_id: id('rq0'),
  recipe_id: id('r0'),
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  input_item_ids: [id('i0'), id('i1')],
  output_template_id: id('ot0'),
}
const cancel_args = { request_id: id('rq0') }
const redeem_args = {
  voucher_id: id('v0'),
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
}

describe('commission v2 builders — refuse loudly when the package is undeployed', () => {
  test('request / accept / execute / cancel / redeem all throw', () => {
    expect(() =>
      commission_request_ptb(undeployed_context)(request_args),
    ).toThrow(/not deployed/)
    expect(() =>
      commission_accept_ptb(undeployed_context)(accept_args),
    ).toThrow(/not deployed/)
    expect(() =>
      commission_execute_ptb(undeployed_context)(execute_args),
    ).toThrow(/not deployed/)
    expect(() =>
      commission_cancel_ptb(undeployed_context)(cancel_args),
    ).toThrow(/not deployed/)
    expect(() =>
      commission_redeem_xp_ptb(undeployed_context)(redeem_args),
    ).toThrow(/not deployed/)
  })
})

describe('commission_request — commission::request, escrow split off gas', () => {
  test('single target commission::request at LATEST (5 args)', () => {
    const tx = commission_request_ptb(deployed_context)(request_args)
    expect(targets(tx)).toEqual(['header::aresrpg', 'commission::request'])
    const req = find_call(tx, 'commission::request')
    expect(req.package).toBe(A.LATEST_PACKAGE_ID)
    expect(req.args).toBe(5)
  })
  test(
    'a ZERO / missing payment still BUILDS client-side (this builder does not pre-validate business floors) — ' +
      'the chain REJECTS it at runtime below the 0.1 SUI floor (EAmountTooLow)',
    () => {
      expect(() =>
        commission_request_ptb(deployed_context)({
          artisan: id('artisan'),
          recipe_id: id('r0'),
          amount_mist: 0n,
        }),
      ).not.toThrow()
      expect(() =>
        commission_request_ptb(deployed_context)({
          artisan: id('artisan'),
          recipe_id: id('r0'),
        }),
      ).not.toThrow()
    },
  )
  test('missing artisan or recipe_id refuses', () => {
    expect(() =>
      commission_request_ptb(deployed_context)({ recipe_id: id('r0') }),
    ).toThrow(/artisan and recipe_id are required/)
    expect(() =>
      commission_request_ptb(deployed_context)({ artisan: id('artisan') }),
    ).toThrow(/artisan and recipe_id are required/)
  })
})

describe('commission_accept — the artisan proves knowledge (commission::accept)', () => {
  test('single target commission::accept at LATEST (7 args)', () => {
    const tx = commission_accept_ptb(deployed_context)(accept_args)
    expect(targets(tx)).toEqual(['header::aresrpg', 'commission::accept'])
    const acc = find_call(tx, 'commission::accept')
    expect(acc.package).toBe(A.LATEST_PACKAGE_ID)
    expect(acc.args).toBe(7)
  })
  test('any missing required arg refuses', () => {
    expect(() =>
      commission_accept_ptb(deployed_context)({
        ...accept_args,
        character_id: undefined,
      }),
    ).toThrow(/are all required/)
  })
})

describe('commission_execute — runs the craft on the customer kiosk (terminal &Random, no receipt tail)', () => {
  const tx = commission_execute_ptb(deployed_context)(execute_args)
  test('single target commission::execute at LATEST (11 args: + input_item_ids, output, policies, &Random)', () => {
    expect(targets(tx)).toEqual(['header::aresrpg', 'commission::execute'])
    const exe = find_call(tx, 'commission::execute')
    expect(exe.package).toBe(A.LATEST_PACKAGE_ID)
    expect(exe.args).toBe(11)
  })
  test('empty input_item_ids or missing output_template refuses', () => {
    expect(() =>
      commission_execute_ptb(deployed_context)({
        ...execute_args,
        input_item_ids: [],
      }),
    ).toThrow(/non-empty array/)
    expect(() =>
      commission_execute_ptb(deployed_context)({
        ...execute_args,
        output_template_id: undefined,
      }),
    ).toThrow(/are required/)
  })
})

describe('commission_cancel — refund (commission::cancel; no config/version gate)', () => {
  test('single target commission::cancel at LATEST (1 arg)', () => {
    const tx = commission_cancel_ptb(deployed_context)(cancel_args)
    expect(targets(tx)).toEqual(['header::aresrpg', 'commission::cancel'])
    const cancel = find_call(tx, 'commission::cancel')
    expect(cancel.package).toBe(A.LATEST_PACKAGE_ID)
    expect(cancel.args).toBe(1)
  })
})

describe('commission_redeem_xp — the artisan banks their voucher (commission::redeem_craft_xp)', () => {
  test('single target commission::redeem_craft_xp at LATEST (4 args)', () => {
    const tx = commission_redeem_xp_ptb(deployed_context)(redeem_args)
    expect(targets(tx)).toEqual([
      'header::aresrpg',
      'commission::redeem_craft_xp',
    ])
    const redeem = find_call(tx, 'commission::redeem_craft_xp')
    expect(redeem.package).toBe(A.LATEST_PACKAGE_ID)
    expect(redeem.args).toBe(4)
  })
  test('any missing required arg refuses', () => {
    expect(() =>
      commission_redeem_xp_ptb(deployed_context)({ voucher_id: id('v0') }),
    ).toThrow(/are all required/)
  })
})
