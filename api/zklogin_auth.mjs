// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One server-side zkLogin personal-message verifier for the sponsor's routes.

import { parseSerializedSignature } from '@mysten/sui/cryptography'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'

const DEFAULT_ISSUERS = 'https://accounts.google.com,accounts.google.com'
export const CHALLENGE_TTL_MS = Number(process.env.SPONSOR_CHALLENGE_TTL_MS || 5 * 60_000)

/** @param {string | undefined} csv */
const issuer_allowlist = (csv) =>
  new Set(
    String(csv || DEFAULT_ISSUERS)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )

/**
 * How long ago a `<purpose>:<sender>:<epoch-ms>` challenge was stamped, in ms — negative when the stamp is in
 * the future. `null` when the trailing field is not a well-formed epoch.
 *
 * ONE home for reading a challenge's clock (#2263): the freshness gate below and the refusal log in
 * sponsor.mjs both derive from it, so "how old is this challenge" is never re-parsed into a second answer.
 * @param {string | null | undefined} challenge
 * @param {number} [now]
 */
export function challenge_age_ms(challenge, now = Date.now()) {
  // EXACTLY three fields. Neither the purpose nor a Sui address contains a colon, so anything else is not this
  // shape — and reading the LAST field of a longer string would quietly start accepting `<p>:<s>:<junk>:<ts>`,
  // a challenge the freshness gate rejects today. The shape is the service's contract; this only reads it.
  const fields = String(challenge ?? '').split(':')
  if (fields.length !== 3) return null
  const [, , encoded_ts] = fields
  const timestamp = Number(encoded_ts)
  if (!encoded_ts || !Number.isFinite(timestamp) || String(timestamp) !== encoded_ts) return null
  return now - timestamp
}

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
  ttl_ms = CHALLENGE_TTL_MS,
  now = Date.now,
  issuers = process.env.SPONSOR_ZKLOGIN_ISS,
}) {
  if (!challenge || !signature) throw new Error('zklogin-required: challenge + signature required')
  const prefix = `${purpose}:${sender}:`
  if (!challenge.startsWith(prefix)) throw new Error('zklogin-invalid: challenge does not match sender')
  // The prefix is already proven above, so the trailing field IS the timestamp — read it through the one home.
  const age = challenge_age_ms(challenge, now())
  if (age == null) throw new Error('zklogin-invalid: malformed challenge timestamp')
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
