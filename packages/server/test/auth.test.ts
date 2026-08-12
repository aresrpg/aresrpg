// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The single door: a genuine personal-message signature over `aresrpg::<uuid>` admits its own
// address and nothing else. Plain ed25519 verifies offline — no network in this test.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toBase64 } from '@mysten/sui/utils'

import { verify_login } from '../src/auth.ts'

const keypair = new Ed25519Keypair()
const address = keypair.toSuiAddress()
const uuid = 'f00d-1234'
const message = new TextEncoder().encode(`aresrpg::${uuid}`)

describe('the login door', () => {
  test('a genuine signature admits its own address', async () => {
    const { signature } = await keypair.signPersonalMessage(message)
    expect(await verify_login({ bytes: toBase64(message), signature, address, uuid })).toBe(true)
  })

  test('a stale/foreign uuid is refused (replay shield)', async () => {
    const { signature } = await keypair.signPersonalMessage(message)
    expect(await verify_login({ bytes: toBase64(message), signature, address, uuid: 'other' })).toBe(false)
  })

  test('a signature cannot admit someone else’s address', async () => {
    const { signature } = await keypair.signPersonalMessage(message)
    const thief = new Ed25519Keypair().toSuiAddress()
    expect(await verify_login({ bytes: toBase64(message), signature, address: thief, uuid })).toBe(false)
  })

  test('garbage never throws out of the door — it refuses', async () => {
    expect(await verify_login({ bytes: 'AAAA', signature: 'trash', address, uuid })).toBe(false)
  })
})
