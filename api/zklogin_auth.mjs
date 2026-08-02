// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One server-side zkLogin personal-message verifier for the sponsor's routes.

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
 * The half of the gate that costs NOTHING: challenge shape, sender binding, freshness, signature scheme and
 * issuer — every check decidable from the request alone, with no socket opened. Pure and synchronous, so it is
 * safe to run as a fast-fail before any network work is dispatched.
 *
 * Split out of `assert_zklogin_challenge` (#1853) rather than duplicated: the sponsor's reserve path now
 * dispatches the balance read in PARALLEL with the signature verification, and a caller who has not even sent
 * a well-formed, unexpired challenge must not be able to buy a fullnode round-trip with it. This function is
 * that pre-pass; `assert_zklogin_challenge` below still runs it, so the complete gate stays one call.
 *
 * @param {{
 *   sender: string, challenge: string, signature: string, purpose: string,
 *   ttl_ms?: number, now?: () => number, issuers?: string
 * }} input
 */
export function assert_zklogin_challenge_local({
  sender,
  challenge,
  signature,
  purpose,
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
}

/**
 * Verify a fresh `<purpose>:<sender>:<epoch-ms>` challenge and require an allowlisted zkLogin signature.
 * THE complete gate: the local pre-pass above plus the one check that needs the chain. Callers that ran the
 * pre-pass separately still call this — the local checks are pure, so repeating them costs microseconds and
 * keeps "the full challenge is verified here" true of exactly one function.
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
  ttl_ms,
  now,
  issuers,
}) {
  assert_zklogin_challenge_local({ sender, challenge, signature, purpose, ttl_ms, now, issuers })
  await verifyPersonalMessageSignature(new TextEncoder().encode(challenge), signature, { client, address: sender })
  return sender
}
