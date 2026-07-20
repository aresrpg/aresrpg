// PURE zkLogin address-seed derivation + the mandatory address guard (P0 create fix, coordinator-ruled).
// Why this exists: Enoki generates the zkLogin PROOF lazily on the first SIGN (`createZkLoginZkp`), so a
// fresh Google login reaching first-character-create has `session.proof` (and its addressSeed) undefined.
// The seed is still fully determined by (salt, sub, aud): seed = genAddressSeed(salt, 'sub', sub, aud) —
// the exact computation the zkLogin address derives from. This module is SIDE-EFFECT-FREE (no i18n, no
// wallet, no network) so the derivation + refusal are unit-provable; auth/index.ts owns the I/O (session
// JWT + Enoki salt fetch) and humanizes any throw.
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { computeZkLoginAddressFromSeed, decodeJwt, genAddressSeed } from '@mysten/sui/zklogin'

/**
 * Derive the zkLogin address seed from the session JWT + the account's Enoki salt, and REFUSE unless the
 * derived seed actually produces the connected session address (both address flavors checked — Enoki may
 * hold a `legacy` zkLogin address). The guard means a wrong salt/JWT can never yield a "guessable" seed:
 * a mismatch throws here, client-side, before any tx is built (a wrong seed would also refuse at dry-run
 * with zero gas — this is the earlier, mechanical gate).
 * Throws plain Errors (the caller maps every failure to the humanized i18n zklogin error).
 */
export function derive_zklogin_seed({ jwt, salt, address }: { jwt: string; salt: string; address: string }): string {
  const { sub, aud, iss } = decodeJwt(jwt)
  if (!sub || !aud || !iss) throw new Error('JWT is missing sub/aud/iss claims')
  const seed = genAddressSeed(BigInt(salt), 'sub', sub, aud)
  const expected = normalizeSuiAddress(address)
  const matches = [false, true].some((legacy) => computeZkLoginAddressFromSeed(seed, iss, legacy) === expected)
  if (!matches)
    throw new Error(`Derived zkLogin seed does not produce the connected address ${expected} — refusing the seed`)
  return seed.toString()
}
