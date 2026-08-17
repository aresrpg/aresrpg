// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SINGLE DOOR (legacy port, packages/server/src/sui.js of aresrpg-legacy): a connection is
// admitted only if it presents a personal-message signature over `aresrpg::<uuid>` whose
// recovered address matches the claimed one. zkLogin signatures verify through the shared Sui
// client; plain keypairs verify offline. Anything else: refused, closed.

import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { fromBase64 } from '@mysten/sui/utils'

import logger from './logger.ts'
import { sui_client } from './sui.ts'

const log = logger(import.meta)

export type LoginProof = { bytes: string; signature: string; address: string; uuid: string }

/**
 * Verify one login: `bytes` is the base64 personal message (`aresrpg::<uuid>`), `signature`
 * its signature, `address` the claimed sender, `uuid` the fresh per-socket challenge.
 * `false` is a refusal, never an exception — the door drops quietly.
 */
export async function verify_login({ bytes, signature, address, uuid }: LoginProof): Promise<boolean> {
  try {
    const [prefix, id] = Buffer.from(bytes, 'base64').toString().split('::')
    if (prefix !== 'aresrpg' || id !== uuid) return false
    const public_key = await verifyPersonalMessageSignature(fromBase64(bytes), signature, { client: sui_client })
    return public_key.toSuiAddress() === address
  } catch (error) {
    log.warn({ address, error: (error as Error).message }, 'login verification refused')
    return false
  }
}
