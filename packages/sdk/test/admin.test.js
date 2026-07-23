// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { burn_mob_template_ptb, burn_sale_ptb } from '../src/sui/write/admin.js'

import {
  IDS,
  deployed_context,
  find_call,
  id,
  targets,
  undeployed_context,
} from './_onchain_fixtures.js'

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

describe('admin teardown composers', () => {
  const admin_cap_id = id('admin-cap')

  test('burn_mob_template is AdminCap-first, consumes the template, and passes Version', () => {
    const mob_template_id = id('mob-template')
    const supplied_tx = new Transaction()
    const tx = burn_mob_template_ptb(deployed_context)({
      admin_cap_id,
      mob_template_id,
      tx: supplied_tx,
    })
    const [command] = tx.getData().commands
    const call = find_call(tx, 'mob_template::burn_mob_template')

    expect(tx).toBe(supplied_tx)
    expect(targets(tx)).toEqual(['mob_template::burn_mob_template'])
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(3)
    expect(argument_object_id(tx, command.MoveCall.arguments[0])).toBe(
      admin_cap_id,
    )
    expect(argument_object_id(tx, command.MoveCall.arguments[1])).toBe(
      mob_template_id,
    )
    expect(typeof tx.serialize()).toBe('string')
  })

  test('burn_sale is the symmetric AdminCap-first 3-argument door', () => {
    const sale_id = id('sale')
    const tx = burn_sale_ptb(deployed_context)({ admin_cap_id, sale_id })
    // commands[0] is the header::aresrpg no-op — skip it.
    const [, command] = tx.getData().commands

    expect(targets(tx)).toEqual(['header::aresrpg', 'shop::burn_sale'])
    expect(find_call(tx, 'shop::burn_sale').args).toBe(3)
    expect(argument_object_id(tx, command.MoveCall.arguments[0])).toBe(
      admin_cap_id,
    )
    expect(argument_object_id(tx, command.MoveCall.arguments[1])).toBe(sale_id)
  })

  test('refuses missing authority or target ids before composing', () => {
    expect(() =>
      burn_mob_template_ptb(deployed_context)({
        admin_cap_id: '',
        mob_template_id: id('mob-template'),
      }),
    ).toThrow(/admin_cap_id and mob_template_id/)
    expect(() =>
      burn_sale_ptb(deployed_context)({ admin_cap_id, sale_id: '' }),
    ).toThrow(/admin_cap_id and sale_id/)
  })

  test('refuses an unstamped deployment', () => {
    expect(() =>
      burn_mob_template_ptb(undeployed_context)({
        admin_cap_id,
        mob_template_id: id('mob-template'),
      }),
    ).toThrow(/not deployed/)
    expect(() =>
      burn_sale_ptb(undeployed_context)({ admin_cap_id, sale_id: id('sale') }),
    ).toThrow(/not deployed/)
  })
})
