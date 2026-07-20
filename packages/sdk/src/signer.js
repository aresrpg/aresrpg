// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { fromBase64 } from '@mysten/sui/utils'

/**
 * @typedef {Object} KeypairSigner
 * @property {string} address - the Sui address controlled by this signer
 * @property {import('@mysten/sui/keypairs/ed25519').Ed25519Keypair} keypair
 * @property {(message: string) => Promise<{ bytes: string, signature: string }>} signPersonalMessage
 * @property {(tx_bytes: string) => Promise<{ signature: string }>} signTransactionBytes
 */

/**
 * Keypair-backed game signer for headless surfaces (bot, MCP). Mirrors the
 * wallet-standard shape the dapp's client consumes, minus the browser wallet.
 * The gas sponsor signs the same way — see
 * `api/sponsor.mjs` (Ed25519 fromSecretKey + signTransaction).
 *
 * The handshake (`signPersonalMessage`) and the sponsored-tx step
 * (`signTransactionBytes`) are the only signing a sponsored flow needs; both
 * return the exact base64 shape the sponsor + on-chain auth verify.
 *
 * @param {string} bech32_secret - a `suiprivkey1...` Bech32-encoded private key
 * @returns {KeypairSigner}
 */
export function create_keypair_signer(bech32_secret) {
  const keypair = Ed25519Keypair.fromSecretKey(
    decodeSuiPrivateKey(bech32_secret).secretKey,
  )
  const address = keypair.getPublicKey().toSuiAddress()

  return {
    address,
    keypair,
    /**
     * Sign the login challenge as a personal message. `bytes` is the base64 of
     * the raw UTF-8 message, which the server reads back via
     * `Buffer.from(bytes, 'base64').toString()` and verifies with
     * `verifyPersonalMessageSignature(fromBase64(bytes), signature)`.
     * @param {string} message - the full `<prefix>::<uuid>` challenge string
     */
    signPersonalMessage(message) {
      return keypair.signPersonalMessage(new TextEncoder().encode(message))
    },
    /**
     * Sign server-sponsored transaction bytes (sender-only). The server already
     * holds the bytes; it executes with `[user_signature, sponsor_signature]`.
     * @param {string} tx_bytes - base64 bytes from `packet/transactionSignRequest`
     */
    async signTransactionBytes(tx_bytes) {
      const { signature } = await keypair.signTransaction(fromBase64(tx_bytes))
      return { signature }
    },
  }
}

/**
 * Generate a fresh keypair signer (a brand-new player identity).
 * @returns {KeypairSigner}
 */
export function generate_keypair_signer() {
  return create_keypair_signer(Ed25519Keypair.generate().getSecretKey())
}
