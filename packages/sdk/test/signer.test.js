import { test, expect } from 'bun:test'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { fromBase64 } from '@mysten/sui/utils'

import {
  create_keypair_signer,
  generate_keypair_signer,
} from '../src/signer.js'

// The dapp's challenge prefix (packages/dapp/src/assets/translations/en.yaml
// WALLET_SIGN_MESSAGE). The server validates ONLY the `::uuid` suffix + that the
// signature recovers to the address, so the prefix is cosmetic — but a real
// client signs this exact string, so the test signs it too.
const CHALLENGE_PREFIX =
  '[AresRPG] This is a verification message to prove that you own this address. It will allow you to connect to the server'

// Replicates packages/server/src/sui.js `sui_verify_login_signature`. Crucially
// calls verifyPersonalMessageSignature WITHOUT a gql client — proving an Ed25519
// personal-message signature is self-contained (no zkLogin path needed).
async function server_verifies({ bytes, signature, address, uuid }) {
  const [, id] = Buffer.from(bytes, 'base64').toString().split('::')
  const public_key = await verifyPersonalMessageSignature(
    fromBase64(bytes),
    signature,
  )
  return uuid === id && public_key.toSuiAddress() === address
}

test('generated keypair signer passes the server login verification', async () => {
  const signer = generate_keypair_signer()
  const uuid = crypto.randomUUID()
  const message = `${CHALLENGE_PREFIX}\n\n::${uuid}`

  const { bytes, signature } = await signer.signPersonalMessage(message)

  expect(
    await server_verifies({ bytes, signature, address: signer.address, uuid }),
  ).toBe(true)
})

test('signer rebuilt from a bech32 secret yields the same address and verifies', async () => {
  const original = generate_keypair_signer()
  const restored = create_keypair_signer(original.keypair.getSecretKey())

  expect(restored.address).toBe(original.address)

  const uuid = crypto.randomUUID()
  const message = `${CHALLENGE_PREFIX}\n\n::${uuid}`
  const { bytes, signature } = await restored.signPersonalMessage(message)

  expect(
    await server_verifies({
      bytes,
      signature,
      address: restored.address,
      uuid,
    }),
  ).toBe(true)
})

test('a signature from a different uuid is rejected (suffix is bound)', async () => {
  const signer = generate_keypair_signer()
  const message = `${CHALLENGE_PREFIX}\n\n::${crypto.randomUUID()}`
  const { bytes, signature } = await signer.signPersonalMessage(message)

  // server challenged with a different uuid than the one that was signed
  expect(
    await server_verifies({
      bytes,
      signature,
      address: signer.address,
      uuid: crypto.randomUUID(),
    }),
  ).toBe(false)
})
