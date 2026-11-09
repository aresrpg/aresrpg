// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import type { EnvelopeCipher } from './transaction_journal.ts'

/** A trusted-backend mounted encryption secret, never a wallet key. Keep its backup separate
 * from the DB and public TLS proxy. Missing keys fail closed; there is no random replacement. */
export const create_envelope_cipher = (key: Uint8Array, key_id: string): EnvelopeCipher => {
  if (key.byteLength !== 32 || !key_id) throw new Error('INVALID_ENVELOPE_KEY')
  const secret = Buffer.from(key)
  return {
    encrypt: async (plaintext, context) => {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', secret, nonce)
      cipher.setAAD(Buffer.from(`${key_id}:${context}`))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return JSON.stringify({
        key_id,
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        bytes: ciphertext.toString('base64'),
      })
    },
    decrypt: async (encoded, context) => {
      const data = JSON.parse(encoded) as { key_id: string; nonce: string; tag: string; bytes: string }
      if (data.key_id !== key_id) throw new Error('ENVELOPE_KEY_MISSING')
      const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(data.nonce, 'base64'))
      decipher.setAAD(Buffer.from(`${key_id}:${context}`))
      decipher.setAuthTag(Buffer.from(data.tag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(data.bytes, 'base64')), decipher.final()]).toString('utf8')
    },
  }
}
