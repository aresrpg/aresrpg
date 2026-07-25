// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The zkLogin address-seed READ, decoded ONCE at its seam (code-law: failures flow as data).
// Why this exists: the four mechanically distinct ways the seed read can fail used to collapse into a
// single "sign in with Google" toast — so a signed-in player whose Enoki SESSION was unreadable, whose
// SALT fetch 401'd, or whose derived seed mismatched all got told to do the one thing they had already
// done. This module owns the classification and nothing else: no i18n, no wallet, no network (auth/index.ts
// injects the I/O and maps the failure to copy), so every branch is unit-provable.
import type { derive_zklogin_seed } from './zklogin_seed'

export type ZkloginSession = { jwt?: string; proof?: { addressSeed?: string } } | null

/** The four distinct causes — each one gets its own honest player-facing message at the boundary. */
export type ZkloginSeedFailure =
  /** The connected wallet has no Enoki zkLogin session feature at all — a Google sign-in genuinely IS required. */
  | 'not_zklogin_wallet'
  /** Enoki holds no readable session (read threw, returned null, or carried no JWT) — sign in again. */
  | 'session_unavailable'
  /** The Enoki salt endpoint refused or was unreachable (401 jwt_error, network) — not the player's fault. */
  | 'salt_unavailable'
  /** The derived seed does not reproduce the connected address — refuse, never guess a seed. */
  | 'address_mismatch'

export type ZkloginSeedResult = { ok: true; seed: string } | { ok: false; failure: ZkloginSeedFailure; cause?: unknown }

export interface ZkloginSeedDeps {
  /** `null` when the wallet exposes no `enoki:getSession` feature. */
  get_session: (() => Promise<ZkloginSession>) | null
  /** The connected session address the derived seed must reproduce. */
  address: string | null
  /** Fetches the account salt from Enoki for this JWT. */
  fetch_salt: (jwt: string) => Promise<string>
  derive: typeof derive_zklogin_seed
}

/**
 * Read the zkLogin address seed, returning the cause as DATA instead of a lossy throw.
 * FAST PATH: Enoki generates the zkLogin proof lazily on the first SIGN, so a fresh Google login reaching
 * first-character-create has no `session.proof` — fall through to the DERIVE path (salt + JWT).
 */
export async function read_zklogin_seed({
  get_session,
  address,
  fetch_salt,
  derive,
}: ZkloginSeedDeps): Promise<ZkloginSeedResult> {
  if (!get_session) return { ok: false, failure: 'not_zklogin_wallet' }

  let session: ZkloginSession
  try {
    session = await get_session()
  } catch (cause) {
    return { ok: false, failure: 'session_unavailable', cause }
  }

  const proof_seed = session?.proof?.addressSeed
  if (proof_seed) return { ok: true, seed: String(proof_seed) }

  const jwt = session?.jwt
  // A missing address is an unreadable session too: without it the mandatory guard below cannot run.
  if (!jwt || !address) return { ok: false, failure: 'session_unavailable' }

  let salt: string
  try {
    salt = await fetch_salt(jwt)
  } catch (cause) {
    return { ok: false, failure: 'salt_unavailable', cause }
  }

  try {
    return { ok: true, seed: derive({ jwt, salt, address }) }
  } catch (cause) {
    return { ok: false, failure: 'address_mismatch', cause }
  }
}

/** The honest copy per cause — the mistranslation fix lives here, one home for the mapping. */
export const ZKLOGIN_FAILURE_COPY: Record<ZkloginSeedFailure, string> = {
  not_zklogin_wallet: 'errors.zklogin_required',
  session_unavailable: 'errors.zklogin_session_expired',
  salt_unavailable: 'errors.zklogin_salt_unavailable',
  address_mismatch: 'errors.zklogin_address_mismatch',
}
