// AIRDROP PTB builders (airdrop::claim + admin create/add/remove/close). OFFLINE: the deployment override seam
// builds each tx without a live publish; asserts the targets + arg shapes and the loud arg refusals. Reconciled
// against packages/move/aresrpg/sources/airdrop.move. Mirrors lootbox.test.js's builder-shape pattern.

import { describe, test, expect } from 'bun:test'

import {
  airdrop_claim_ptb,
  airdrop_create_ptb,
  airdrop_add_addresses_ptb,
  airdrop_remove_addresses_ptb,
  airdrop_close_ptb,
} from '../src/sui/write/airdrop.js'

import {
  deployed_context,
  undeployed_context,
  id,
  find_call,
  targets,
  IDS,
} from './_onchain_fixtures.js'

const CLAIM = {
  airdrop_id: id('airdrop'),
  template_id: id('tmpl'),
  kiosk_id: id('kiosk'),
  personal_kiosk_cap_id: id('pkcap'),
}

describe('airdrop_claim_ptb — airdrop::claim builder (mint-lock, no royalty)', () => {
  test('undeployed → refuses loudly', () => {
    expect(() => airdrop_claim_ptb(undeployed_context)(CLAIM)).toThrow(
      /not deployed/,
    )
  })

  test('deployed → airdrop::claim, 7 args, single moveCall into the merged package', () => {
    const tx = airdrop_claim_ptb(deployed_context)(CLAIM)
    const call = find_call(tx, 'airdrop::claim')
    expect(call.package).toBe(IDS.aresrpg.GIFTING_PACKAGE_ID)
    expect(call.args).toBe(7)
    expect(targets(tx)).toEqual(['airdrop::claim'])
    expect(typeof tx.serialize()).toBe('string')
  })

  test('refuses a missing airdrop_id / template_id / kiosk_id / pkcap', () => {
    expect(() =>
      airdrop_claim_ptb(deployed_context)({ ...CLAIM, template_id: undefined }),
    ).toThrow(/airdrop_id, template_id, kiosk_id and personal_kiosk_cap_id/)
  })
})

describe('airdrop admin builders — create / add / remove / close', () => {
  const admin_cap_id = id('admincap')
  const airdrop_id = id('airdrop')
  const addresses = [id('a'), id('b')]

  test('admin_create → airdrop::admin_create, 5 args', () => {
    const tx = airdrop_create_ptb(deployed_context)({
      admin_cap_id,
      template_id: id('tmpl'),
      name: 'Vaporeon Drop',
      description: 'For the community.',
    })
    const call = find_call(tx, 'airdrop::admin_create')
    expect(call.package).toBe(IDS.aresrpg.GIFTING_PACKAGE_ID)
    expect(call.args).toBe(5)
  })

  test('admin_add_addresses → airdrop::admin_add_addresses, 4 args', () => {
    const tx = airdrop_add_addresses_ptb(deployed_context)({
      admin_cap_id,
      airdrop_id,
      addresses,
    })
    const call = find_call(tx, 'airdrop::admin_add_addresses')
    expect(call.args).toBe(4)
  })

  test('admin_remove_addresses → airdrop::admin_remove_addresses, 4 args', () => {
    const tx = airdrop_remove_addresses_ptb(deployed_context)({
      admin_cap_id,
      airdrop_id,
      addresses,
    })
    const call = find_call(tx, 'airdrop::admin_remove_addresses')
    expect(call.args).toBe(4)
  })

  test('admin_close → airdrop::admin_close, 3 args', () => {
    const tx = airdrop_close_ptb(deployed_context)({ admin_cap_id, airdrop_id })
    const call = find_call(tx, 'airdrop::admin_close')
    expect(call.args).toBe(3)
  })

  test('add_addresses refuses an empty list', () => {
    expect(() =>
      airdrop_add_addresses_ptb(deployed_context)({
        admin_cap_id,
        airdrop_id,
        addresses: [],
      }),
    ).toThrow(/addresses must be a non-empty array/)
  })

  test('create refuses a missing name', () => {
    expect(() =>
      airdrop_create_ptb(deployed_context)({
        admin_cap_id,
        template_id: id('tmpl'),
        name: undefined,
      }),
    ).toThrow(/admin_cap_id, template_id and name are required/)
  })

  test('undeployed create → refuses loudly', () => {
    expect(() =>
      airdrop_create_ptb(undeployed_context)({
        admin_cap_id,
        template_id: id('tmpl'),
        name: 'X',
      }),
    ).toThrow(/not deployed/)
  })
})
