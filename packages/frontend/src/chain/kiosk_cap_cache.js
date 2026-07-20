// CACHED getOwnedKiosks preflight — these per-flow discovery queries were slowing
// down the UX. Kills the per-flow-open `kiosk_client.getOwnedKiosks` discovery query that write_gift.js and
// write_listings.js each ran on their own before every gift/listing/buy PTB. S-51 owned-object law: the client
// is the ONLY mutator of its own kiosk objects, so its own read cache is authoritative between mutations.
//
// INVARIANT: a wallet's PersonalKioskCap is SOULBOUND (kiosk-lock constitution) — once minted, its id is
// stable for the wallet's whole lifetime. The cache therefore NEVER goes stale for an id it already holds.
// The only staleness window is the one-time "no kiosk yet" → "kiosk just created" transition (a wallet's
// FIRST kiosk-creating tx), closed by `invalidate()` below.
//
// Wiring:
//   - Resolved lazily, once per wallet address, the first time a caller asks.
//   - `invalidate(address)` is called by write_listings.js's buy_item/buy_character right after a tx where
//     `cap` was null (the KioskTransaction's `.createPersonal(true)` fallback fired — "first buy auto-creates"),
//     so the next read discovers the fresh cap instead of replaying the stale "none" result.
//   - `invalidate()` (no address) is called by game/wallet_session_reset.js — the existing single home for
//     wallet-switch/disconnect teardown (P0/D286) — so an outgoing account's cap can never leak onto the next.
//   - A FAILED read is never memoized (mirrors chain/sdk.js's own get_sdk law): a transient RPC hiccup
//     must not permanently wedge kiosk-cap resolution behind a rejected promise.

const cache = new Map() // address -> Promise<{kioskId, objectId, isPersonal}[]> (personal caps only)

async function load(sdk, address) {
  // limit 50 mirrors kiosk_resolve's former live read EXACTLY — the cache must return the same cap that
  // uncached read would (money-path equivalence): a wallet accumulating kiosks across lineages must never
  // page-miss the one that holds the active character.
  const { kioskOwnerCaps } = await sdk.kiosk_client.getOwnedKiosks({ address, pagination: { limit: 50 } })
  return (kioskOwnerCaps ?? []).filter((cap) => cap.isPersonal)
}

/**
 * The caller's full personal-kiosk cap list, cache-first (one `getOwnedKiosks` per address for the whole
 * session). The list form for a caller that must inspect EVERY cap — kiosk_resolve's character-derived walk
 * matches a derived kiosk id against the wallet's caps and needs the count to name its null branch. Same
 * cache, same soulbound-stability invariant as `get_personal_cap`.
 * @param {{ kiosk_client: { getOwnedKiosks: Function } }} sdk
 * @param {string} address
 * @returns {Promise<{kioskId: string, objectId: string, isPersonal: boolean}[]>}
 */
export async function get_personal_caps(sdk, address) {
  if (!cache.has(address)) {
    const pending = load(sdk, address)
      .then((caps) => {
        // THE CACHE LAW (DECISIONS 08:12: never cache absence without an invalidation edge). An EMPTY resolve is
        // the one-time "no kiosk yet → kiosk just created" window (header line 8) — a fresh wallet's soulbound cap
        // still lagging the owned-object index — and NO edge fires on character-create/world-join (invalidate runs
        // only post-buy + wallet-reset). Persisting [] would freeze that absence FOREVER (nulling the cap for the
        // seven gameplay callers). So return [] honestly to THIS caller but EVICT so the next call re-reads live; a
        // NON-EMPTY list is soulbound-stable (header line 6) → it stays memoized for the session (the buy-fix win).
        if (caps.length === 0) cache.delete(address)
        return caps
      })
      .catch((error) => {
        cache.delete(address) // never memoize a failed read — the next call retries
        throw error
      })
    cache.set(address, pending)
  }
  return cache.get(address)
}

/**
 * Resolve the caller's personal-kiosk owner cap, cache-first (one `getOwnedKiosks` per address for the whole
 * session). Mirrors the old per-file `find_personal_cap`: `kiosk_id` pins the exact kiosk (a player has one
 * personal kiosk from character creation); omit to take the first.
 * @param {{ kiosk_client: { getOwnedKiosks: Function } }} sdk
 * @param {string} address
 * @param {string} [kiosk_id]
 * @returns {Promise<{kioskId: string, objectId: string, isPersonal: boolean} | null>}
 */
export async function get_personal_cap(sdk, address, kiosk_id) {
  const personal = await get_personal_caps(sdk, address)
  if (kiosk_id) return personal.find((cap) => cap.kioskId === kiosk_id) ?? null
  return personal[0] ?? null
}

/**
 * Drop cached cap(s) so the next `get_personal_cap` re-fetches. Pass an address right after a kiosk-creating
 * tx for that wallet; omit it to clear everything (wallet switch/disconnect).
 * @param {string} [address]
 */
export function invalidate(address) {
  if (address) cache.delete(address)
  else cache.clear()
}
