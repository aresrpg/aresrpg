// S-57 — THE ONE kiosk-resolution home: NEVER pick a kiosk from the wallet's cap
// list — a zkLogin address accumulates kiosks across lineages (0x2 objects are lineage-agnostic) and a
// first-cap pick built PTBs against a kiosk that does NOT hold the character (a real live
// `0x2::kiosk::borrow_mut` abort 11 EItemNotFound, refused at dry-run). DERIVE the kiosk FROM the character
// instead — a kiosk-locked object's ownership chain IS its kiosk (chain-verified 07-09 on qasenshi):
//
//   character.owner = ObjectOwner(dynamic_object_field::Field<Wrapper<kiosk::Item>, ID>)   ← the DOF wrapper
//   field.owner     = ObjectOwner(kiosk id)                                                ← the Kiosk itself
//
// then match the wallet's PersonalKioskCap whose `kioskId` equals the derived id. Every PTB seam that takes
// (kiosk_id, personal_kiosk_cap_id, character_id) resolves through HERE — join/fight/dungeon/feed all share
// the same trap otherwise. Tolerant: a one-hop owner that already matches a cap is accepted (future kiosk
// impls may parent items directly).

/** Read one object's owner (gRPC Core; null when unreadable). */
import { game_log } from '../core/log.js'
import { get_personal_cap, get_personal_caps } from '../chain/kiosk_cap_cache.js'

async function owner_of(/** @type {any} */ sdk, /** @type {string} */ id) {
  const { object } = await sdk.grpc_client.core.getObject({ objectId: id, include: {} })
  return object?.owner ?? null
}

/**
 * Resolve the PERSONAL kiosk that HOLDS `character_id` by walking the character's ownership chain, then
 * matching the wallet's own PersonalKioskCap. Returns `{ kiosk_id, personal_kiosk_cap_id }` or null (not
 * kiosk-held / not this wallet's kiosk / no personal cap — `kiosk_resolve_last_failure()` names which).
 * @param {any} sdk the memoized SDK (grpc_client + kiosk_client)
 * @param {string} address the signed-in wallet
 * @param {string} character_id
 */
export async function kiosk_for_character(sdk, address, character_id) {
  // (1)+(2) IN PARALLEL — the character's owner (its DOF Field wrapper) and the wallet's personal kiosk caps
  // are INDEPENDENT reads, so fire them together: one fewer public-RPC round-trip on the HOT path (every
  // equip / buy / fight / dungeon-entry resolves a character's kiosk through here). The caps come from the
  // session cache (chain/kiosk_cap_cache) — a PersonalKioskCap is SOULBOUND, so a warm cache skips
  // getOwnedKiosks ENTIRELY and only the character-owner read hits the network (those repeated
  // discovery queries were the hidden 1-3s on every gameplay tx). Both candidates match this single caps set.
  const [first, personal] = await Promise.all([owner_of(sdk, character_id), get_personal_caps(sdk, address)])
  const first_id = first?.ObjectOwner ?? first?.object_owner ?? null

  // BRANCH-IDENTITY PROBE (BOOT24b kiosk-null hunt) — every exit names its branch so the four null
  // paths are distinguishable downstream without forensics (three boots were burned telling them
  // apart). `branch` + the ring feed kiosk_resolve_last_failure() and are LOAD-BEARING; the raw
  // first_raw/second_raw payloads remain the removable one-shot diagnostic half.
  const record_probe = (one_hop_hit, second_raw, branch) => {
    if (typeof window === 'undefined') return
    try {
      const json_safe = (raw) => {
        if (raw === undefined) return undefined
        try {
          return JSON.parse(JSON.stringify(raw, (_key, value) => (typeof value === 'bigint' ? String(value) : value)))
        } catch {
          return String(raw)
        }
      }
      const entry = {
        t: Date.now(),
        character_id,
        address,
        first_raw: json_safe(first),
        first_id,
        personal_count: personal.length,
        cap_kiosk_ids: personal.map((/** @type {any} */ c) => String(c.kioskId)),
        one_hop_hit,
        second_raw: json_safe(second_raw),
        branch,
        resolved: branch === 'resolved',
      }
      const ring = (globalThis.__ARES_KIOSK_PROBE ??= [])
      /* eslint-disable fp-law/no-mutating-methods -- the required one-shot window ring writes in place. */
      ring.push(entry)
      if (ring.length > 50) ring.splice(0, ring.length - 50)
      /* eslint-enable fp-law/no-mutating-methods */
      game_log('kiosk_probe', entry)
    } catch {
      // A temporary diagnostic must never alter kiosk resolution.
    }
  }

  if (!first_id) {
    record_probe(false, undefined, 'no_first_owner')
    return null
  }

  const by_kiosk = (/** @type {string} */ id) =>
    personal.find((/** @type {any} */ c) => String(c.kioskId) === String(id))

  let cap = by_kiosk(first_id) // one-hop (direct kiosk parenting)
  const one_hop_hit = Boolean(cap)
  let second_raw
  let second_kiosk_id = null
  if (!cap) {
    const second = await owner_of(sdk, first_id) // two-hop (DOF Field → kiosk)
    second_raw = second
    second_kiosk_id = second?.ObjectOwner ?? second?.object_owner ?? null
    if (second_kiosk_id) cap = by_kiosk(second_kiosk_id)
  }
  if (!cap) {
    // Null-path identity (mutually exclusive, root cause first): zero personal caps can never match,
    // whatever the walk found (b); else the two-hop read yielded no kiosk id (c) or an unmatched one (d).
    const branch = personal.length === 0 ? 'no_personal_caps' : second_kiosk_id ? 'no_cap_match' : 'two_hop_no_kiosk'
    record_probe(one_hop_hit, second_raw, branch)
    return null
  }
  record_probe(one_hop_hit, second_raw, 'resolved')
  return { kiosk_id: cap.kioskId, personal_kiosk_cap_id: cap.objectId }
}

/**
 * The identity of the most recent `kiosk_for_character` outcome — read immediately after a null return
 * to learn WHICH null path fired: 'no_first_owner' (hop-1 owner read gave no ObjectOwner) |
 * 'no_personal_caps' (wallet holds zero personal caps) | 'two_hop_no_kiosk' (one-hop miss and the hop-2
 * owner read yielded no kiosk id) | 'no_cap_match' (a kiosk id was derived but matches no cap); a fresh
 * success reads 'resolved'. Derived from the SAME probe ring (one home, no new state); `character_id`
 * lets a caller confirm the entry is its own when resolves interleave. Null when nothing has recorded
 * yet (non-browser context or no call).
 * @returns {{branch:string, character_id:string, t:number}|null}
 */
export function kiosk_resolve_last_failure() {
  const ring = /** @type {any[]|undefined} */ (globalThis.__ARES_KIOSK_PROBE)
  const last = ring?.[ring.length - 1]
  return last ? { branch: last.branch, character_id: last.character_id, t: last.t } : null
}

// ── CREATE-EFFECTS MEMO (S-57 create→auto-join race, design ruling 2026-07-12) ─────────────────────────────────
// A character is kiosk-locked FOREVER (kiosk-lock constitution), so its (kiosk_id, personal_kiosk_cap_id) is
// IMMUTABLE the instant the create tx lands — and that tx's receipt NAMES all three ids (store.ts reads them off
// objectChanges). Stash them here at create time so the AUTO-JOIN firing seconds later (DiscoveryPrompts, off the
// world-less / index-lagged /v1 doc) resolves with ZERO reads instead of racing the chain-direct getOwnedKiosks /
// getObject on a just-minted object — the owned-object index lags a checkpoint or two, which is the "not in one of
// your kiosks" a real wallet hit on a fresh lineage. Session-scoped; entries are inert for any character the wallet
// can't join (character_ids are globally unique), so no cross-account leak and no eviction needed.
const created_kiosks = /** @type {Map<string, {kiosk_id:string, personal_kiosk_cap_id:string}>} */ (new Map())

/**
 * Record the kiosk pair a create tx just minted for `character_id` (read off the receipt's created objects). The
 * ONE writer is the create flow (roster/store.ts); everything else reads through `join_kiosk_for_character`.
 * @param {string} character_id @param {{kiosk_id?:string, personal_kiosk_cap_id?:string}} handle
 */
export function remember_character_kiosk(character_id, handle) {
  if (character_id && handle?.kiosk_id && handle?.personal_kiosk_cap_id)
    created_kiosks.set(String(character_id), {
      kiosk_id: String(handle.kiosk_id),
      personal_kiosk_cap_id: String(handle.personal_kiosk_cap_id),
    })
}

/** @param {number} ms */
const default_sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Resolve the kiosk pair for a WORLD JOIN — create-effects FIRST (a just-minted character's pair is known EXACTLY
 * from its receipt: zero reads, zero race), else the derive-from-character resolver with a bounded READ-ONLY retry
 * (a very recently minted character can still lag the chain-direct owned-object index; read retries are lawful —
 * the JOIN TX is NEVER retried here). ~3 tries over ~3.2s, then the honest absence (null → the caller's toast; the
 * manual switcher is the retry). `sleep` is injectable so the backoff is instant under test.
 * @param {any} sdk @param {string} address @param {string} character_id
 * @param {(ms:number)=>Promise<void>} [sleep]
 */
export async function join_kiosk_for_character(sdk, address, character_id, sleep = default_sleep) {
  const remembered = created_kiosks.get(String(character_id))
  if (remembered) {
    game_log('join', `create-effects → join args (kiosk ${remembered.kiosk_id})`)
    return remembered
  }
  // Miss (rejoin / legacy-unjoined / a refresh that wiped the session memo mid-create-window): DERIVE through the
  // resolver, retrying the READ a few times — never the tx. Kiosk-lock is forever, so a resolved handle is final.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const handle = await kiosk_for_character(sdk, address, character_id)
    if (handle) {
      game_log('join', `resolver walk → join args (kiosk ${handle.kiosk_id}, attempt ${attempt})`)
      return handle
    }
    game_log('join', `resolver retry ${attempt} — character kiosk not yet visible`)
    if (attempt < 3) await sleep(1600)
  }
  return null
}

/**
 * ANY personal kiosk of mine — the LOCK-TARGET resolver (mint_rolled / loot lands into any personal kiosk;
 * no character binding). First personal cap is correct here BY DESIGN — never use this for a character op.
 * @param {any} sdk @param {string} address
 */
export async function any_personal_kiosk(sdk, address) {
  const cap = await get_personal_cap(sdk, address) // first personal cap, off the shared session caps cache
  return cap ? { kiosk_id: cap.kioskId, personal_kiosk_cap_id: cap.objectId } : null
}

/**
 * Resolve a wallet's PersonalKioskCap object id FROM an already-known kiosk id — the inverse of
 * `kiosk_for_character` (that one derives the kiosk FROM an object; this derives the cap FROM the kiosk).
 * For a caller that already knows WHICH kiosk holds an item (e.g. the union bag's `kiosk_id` row —
 * read_staking.js) but only cheaply has the kiosk id, not its cap. Returns the cap id or null (not this
 * wallet's personal kiosk).
 * @param {any} sdk @param {string} address @param {string} kiosk_id
 */
export async function cap_for_kiosk(sdk, address, kiosk_id) {
  const cap = await get_personal_cap(sdk, address, kiosk_id) // inverse lookup, off the same session caps cache
  return cap ? cap.objectId : null
}

/**
 * The kiosk a PURCHASE should lock into (kiosk-resolve law, mirror of the settlement bug): the ACTIVE
 * character's kiosk — the SAME seam equip / dungeon-burn resolve via `kiosk_for_character` — so the bought item
 * lands where those flows will look for it. A first-cap pick (`any_personal_kiosk`) strands the item in a sibling
 * kiosk on a multi-kiosk wallet (a real live bug: keys locked into cap[0], the character in another kiosk,
 * so the dungeon activate could never take them). Falls back to any personal kiosk — LOGGED, never silent —
 * when there is no active character (a roster-screen buy) or its kiosk can't be resolved (e.g. an escrowed
 * character). Returns a handle or null (no personal kiosk at all → the caller onboards one).
 * @param {any} sdk @param {string} address @param {string|null|undefined} active_character_id
 */
export async function buy_destination_kiosk(sdk, address, active_character_id) {
  if (active_character_id) {
    const handle = await kiosk_for_character(sdk, address, active_character_id)
    if (handle) return handle
  }
  const fallback = await any_personal_kiosk(sdk, address)
  if (fallback)
    game_log('buy', `no active-character kiosk resolved — landing purchase in personal kiosk ${fallback.kiosk_id}`)
  return fallback
}
