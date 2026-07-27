// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One server-side zkLogin personal-message verifier for the sponsor and its stateless courier sibling.

import { parseSerializedSignature } from '@mysten/sui/cryptography'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'

const DEFAULT_ISSUERS = 'https://accounts.google.com,accounts.google.com'

/** @param {string | undefined} csv */
const issuer_allowlist = (csv) =>
  new Set(
    String(csv || DEFAULT_ISSUERS)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )

/**
 * Verify a fresh `<purpose>:<sender>:<epoch-ms>` challenge and require an allowlisted zkLogin signature.
 * @param {{
 *   sender: string, challenge: string, signature: string, purpose: string,
 *   client: any, ttl_ms?: number, now?: () => number, issuers?: string
 * }} input
 */
export async function assert_zklogin_challenge({
  sender,
  challenge,
  signature,
  purpose,
  client,
  ttl_ms = 5 * 60_000,
  now = Date.now,
  issuers = process.env.SPONSOR_ZKLOGIN_ISS,
}) {
  if (!challenge || !signature) throw new Error('zklogin-required: challenge + signature required')
  const prefix = `${purpose}:${sender}:`
  if (!challenge.startsWith(prefix)) throw new Error('zklogin-invalid: challenge does not match sender')
  const encoded_ts = challenge.slice(prefix.length)
  const timestamp = Number(encoded_ts)
  if (!Number.isFinite(timestamp) || String(timestamp) !== encoded_ts)
    throw new Error('zklogin-invalid: malformed challenge timestamp')
  const age = now() - timestamp
  if (age < 0 || age >= ttl_ms) throw new Error('zklogin-stale: challenge expired — retry')

  let parsed
  try {
    parsed = parseSerializedSignature(signature)
  } catch {
    throw new Error('zklogin-invalid: unparseable signature')
  }
  if (parsed.signatureScheme !== 'ZkLogin')
    throw new Error(`zklogin-required: signature scheme is ${parsed.signatureScheme}, not zkLogin`)
  const issuer = parsed.zkLogin?.iss
  if (!issuer_allowlist(issuers).has(issuer))
    throw new Error(`zklogin-issuer: issuer ${issuer ?? '(none)'} is not allowed`)
  await verifyPersonalMessageSignature(new TextEncoder().encode(challenge), signature, { client, address: sender })
  return sender
}
