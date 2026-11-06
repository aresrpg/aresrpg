// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'

import { parse_agent_pairing_request, verify_agent_pairing } from '../src/agent_pairing.ts'
import { bootstrap_disposable_agent } from '../examples/agent_bootstrap.ts'

const request = () => {
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  return {
    version: 1,
    nonce: crypto.randomUUID(),
    network: 'mainnet',
    owner: google.toSuiAddress(),
    zklogin_public_identifier: google.toBase64(),
  }
}

test('disposable public pairing derives the same identity and retains a usable multisig signer', async () => {
  const pending = request()
  const client = await bootstrap_disposable_agent(pending)
  const paired = await verify_agent_pairing(pending, client.response)
  expect(paired.address).toBe(client.signer.address)
  expect(paired.multisig_public_key).toBe(client.signer.public_key.toBase64())
  expect(Object.keys(client.response).sort()).toEqual(['agent_public_key', 'signature', 'signer_mode'])
  const challenge = new TextEncoder().encode(`aresrpg::${crypto.randomUUID()}`)
  const proof = await client.signer.sign_personal_message(challenge)
  const verified = await verifyPersonalMessageSignature(challenge, proof.signature, { address: paired.address })
  expect(verified.toSuiAddress()).toBe(paired.address)
})

test('rejects stale request, changed network, substituted key and malformed owner metadata', async () => {
  const pending = request()
  const client = await bootstrap_disposable_agent(pending)
  const other = await bootstrap_disposable_agent(pending)
  await expect(verify_agent_pairing(request(), client.response)).rejects.toThrow()
  await expect(verify_agent_pairing({ ...pending, network: 'testnet' }, client.response)).rejects.toThrow()
  await expect(
    verify_agent_pairing(pending, { ...client.response, agent_public_key: other.response.agent_public_key })
  ).rejects.toThrow()
  expect(() => parse_agent_pairing_request({ ...pending, owner: `0x${'0'.repeat(64)}` })).toThrow()
  expect(() => parse_agent_pairing_request({ ...pending, private_key: 'forbidden' })).toThrow()
})

test('supports a legacy Google owner but rejects a non-Google or malformed identifier', async () => {
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: true })
  const pending = { ...request(), owner: google.toSuiAddress(), zklogin_public_identifier: google.toBase64() }
  const client = await bootstrap_disposable_agent(pending)
  expect((await verify_agent_pairing(pending, client.response)).address).toBe(client.signer.address)
  const other = toZkLoginPublicIdentifier(1n, 'https://example.com', { legacyAddress: false })
  expect(() =>
    parse_agent_pairing_request({
      ...pending,
      owner: other.toSuiAddress(),
      zklogin_public_identifier: other.toBase64(),
    })
  ).toThrow('INVALID_GOOGLE_IDENTIFIER')
  expect(() => parse_agent_pairing_request({ ...pending, zklogin_public_identifier: 'AA==' })).toThrow()
})

test('pairing requires mainnet and rejects all other networks or coerced values', () => {
  const pending = request()
  expect(parse_agent_pairing_request(pending).network).toBe('mainnet')
  for (const network of [
    'testnet',
    'devnet',
    'localnet',
    undefined,
    null,
    '',
    'MAINNET',
    'mainnet ',
    'unknown',
    ['mainnet'],
    { toString: () => 'mainnet' },
  ])
    expect(() => parse_agent_pairing_request({ ...pending, network })).toThrow('INVALID_PAIRING_REQUEST')
})

test('signer capability cannot be upgraded independently of its signed proof', async () => {
  const pending = request()
  const client = await bootstrap_disposable_agent(pending)
  expect((await verify_agent_pairing(pending, client.response)).signer_mode).toBe('disposable')
  await expect(verify_agent_pairing(pending, { ...client.response, signer_mode: 'host-persistent' })).rejects.toThrow()
  await expect(verify_agent_pairing(pending, { ...client.response, signer_mode: 'unknown' as never })).rejects.toThrow()
})
