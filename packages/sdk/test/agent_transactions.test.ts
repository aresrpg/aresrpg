// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { KioskClient, type KioskOwnerCap } from '@mysten/kiosk'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { toBase64 } from '@mysten/sui/utils'

import { agent_character_transfer, create_agent_transaction_signer } from '../src/agent_transactions.ts'
import { create_agent_multisig } from '../src/agent_multisig.ts'
import { with_personal_kiosk } from '../src/ptb.ts'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const cap = (n: number): KioskOwnerCap => ({
  objectId: id(n),
  kioskId: id(n + 1),
  isPersonal: true,
  version: '1',
  digest: '11111111111111111111111111111111',
})
const client = new KioskClient({ client: {} as never, network: 'mainnet' })
const transfers = agent_character_transfer({
  game_type_package: id(1),
  doors: {
    equip_item: (tx: Transaction) => tx.moveCall({ target: `${id(2)}::api::equip_item` }),
    unequip_item: (tx: Transaction) => tx.moveCall({ target: `${id(2)}::api::unequip_item` }),
  },
  pins: {
    package: id(2),
    kiosk_package: id(3),
    character_policy: { id: id(4) },
    item_policy: { id: id(6) },
    version: { id: id(5) },
  },
  tx: () => new Transaction(),
  with_personal_kiosk: (
    tx: Transaction,
    owner_cap: KioskOwnerCap | null,
    compose: Parameters<typeof with_personal_kiosk>[3]
  ) => with_personal_kiosk(tx, client, owner_cap, compose),
} as never)
const calls = (tx: Transaction) => tx.getData().commands.flatMap((c) => (c.MoveCall ? [c.MoveCall] : []))

for (const [sender, recipient, seller, buyer] of [
  [id(10), id(11), cap(20), cap(30)],
  [id(11), id(10), cap(30), cap(20)],
] as const) {
  test(`offer and claim preserve policy settlement for ${sender} -> ${recipient}`, async () => {
    const offer = transfers.offer({ sender, recipient, character_id: id(40), kiosk_cap: seller })
    expect(offer.getData().sender).toBe(sender)
    expect(calls(offer).map((c) => c.function)).toContain('list_with_purchase_cap')
    expect(offer.getData().commands.filter((c) => c.TransferObjects)).toHaveLength(1)
    expect(calls(offer).some((c) => c.function === 'list')).toBe(false)
    const claim = transfers.claim({
      recipient,
      character_id: id(40),
      seller_kiosk: seller.kioskId,
      purchase_cap: id(41),
      kiosk_cap: buyer,
    })
    expect(claim.getData().sender).toBe(recipient)
    const sequence = calls(claim).map((c) => `${c.module}::${c.function}`)
    expect(sequence).toContain('kiosk::purchase_with_cap')
    expect(sequence).toContain('royalty_rule::pay')
    expect(sequence).toContain('personal_kiosk_rule::prove')
    expect(sequence.indexOf('kiosk::lock')).toBeLessThan(sequence.indexOf('naked_rule::prove'))
    expect(sequence.indexOf('naked_rule::prove')).toBeLessThan(sequence.indexOf('transfer_policy::confirm_request'))
    // Exercise real transaction serialization/deserialization, without resolving or submitting objects.
    expect(await Transaction.from(await claim.toJSON()).toJSON()).toBe(await claim.toJSON())
  })
}

test('first claim creates a personal kiosk; ordinary custody is refused', () => {
  const input = { recipient: id(11), character_id: id(40), seller_kiosk: id(21), purchase_cap: id(41) }
  expect(calls(transfers.claim({ ...input, kiosk_cap: null })).some((c) => c.module === 'personal_kiosk')).toBe(true)
  expect(() => transfers.claim({ ...input, kiosk_cap: { ...cap(20), isPersonal: false } })).toThrow('personal kiosk')
})

test('cancellation returns the exclusive capability without purchasing the character', () => {
  const tx = transfers.cancel({ holder: id(11), seller_kiosk: id(21), purchase_cap: id(41) })
  expect(tx.getData().sender).toBe(id(11))
  expect(calls(tx).map((c) => c.function)).toEqual(['return_purchase_cap'])
})

test('transaction signer rejects wrong sender before invoking signer', async () => {
  const identity = create_agent_multisig({
    agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(1)),
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false }),
    sign_personal_message: async () => {
      throw new Error('not used')
    },
  })
  const signer = create_agent_transaction_signer(identity, async () => {
    throw new Error('must not sign')
  })
  const tx = new Transaction()
  tx.setSender(id(10))
  await expect(signer(tx)).rejects.toThrow('sender mismatch')
})

test('transaction signer rejects changed bytes and isolates callback mutation', async () => {
  const identity = create_agent_multisig({
    agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(1)),
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false }),
    sign_personal_message: async () => {
      throw new Error('not used')
    },
  })
  const tx = new Transaction()
  tx.setSender(identity.address)
  tx.setGasPrice(1)
  tx.setGasBudget(1000000)
  tx.setGasPayment([{ objectId: id(50), version: '1', digest: '11111111111111111111111111111111' }])
  const original = await tx.build()
  const signer = create_agent_transaction_signer(identity, async (bytes) => {
    bytes.fill(0)
    return { bytes: toBase64(bytes), signature: '' }
  })
  await expect(signer(tx)).rejects.toThrow('changed transaction bytes')
  expect(await tx.build()).toEqual(original)
})

test('recall unequips before issuing its exclusive offer, in the same transaction', () => {
  const tx = transfers.offer({
    sender: id(10),
    recipient: id(11),
    character_id: id(40),
    kiosk_cap: cap(20),
    unequip: [{ slot: 'tool', item_id: id(60) }],
  })
  const sequence = calls(tx).map((call) => call.function)
  expect(sequence.indexOf('unequip_item')).toBeLessThan(sequence.indexOf('list_with_purchase_cap'))
})

test('current equipment travels with its character and re-equips atomically using existing policy doors', async () => {
  const equipment = [{ slot: 'hat', item_id: id(42), purchase_cap: id(43) }]
  const offer = transfers.offer({
    sender: id(10),
    recipient: id(11),
    character_id: id(40),
    kiosk_cap: cap(20),
    unequip: equipment,
  })
  expect(calls(offer).filter((c) => c.function === 'list_with_purchase_cap')).toHaveLength(2)
  expect(offer.getData().commands.filter((c) => c.TransferObjects)[0]!.TransferObjects!.objects).toHaveLength(2)
  const claim = transfers.claim({
    recipient: id(11),
    character_id: id(40),
    seller_kiosk: id(21),
    purchase_cap: id(41),
    kiosk_cap: cap(30),
    equipment,
  })
  const sequence = calls(claim).map((c) => c.function)
  expect(sequence.filter((name) => name === 'purchase_with_cap')).toHaveLength(2)
  expect(sequence.filter((name) => name === 'confirm_request')).toHaveLength(2)
  expect(sequence.indexOf('equip_item')).toBeGreaterThan(sequence.lastIndexOf('confirm_request'))
  expect(calls(claim).every((c) => c.module !== 'agent_loadout')).toBe(true)
  expect(await Transaction.from(await claim.toJSON()).toJSON()).toBe(await claim.toJSON())
  const cancel = transfers.cancel({ holder: id(11), seller_kiosk: id(21), purchase_cap: id(41), equipment })
  expect(calls(cancel).filter((c) => c.function === 'return_purchase_cap')).toHaveLength(2)
})
