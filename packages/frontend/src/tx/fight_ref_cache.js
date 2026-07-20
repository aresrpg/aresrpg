// ─────────────────────────────────────────────────────────────────────────────
//  PER-FIGHT-SESSION FIGHT SHARED-REF CACHE (latency lane 2)
// ─────────────────────────────────────────────────────────────────────────────
//  The pinned-shared-version system (SDK `aresrpg_shared_ref` — deployment singletons pass a STATIC
//  SharedObjectRef and skip the tx-build resolve round-trip) EXTENDED from the singletons to the one RUNTIME
//  shared object every act PTB touches: the Fight. The Fight is a SHARED object, so a static SharedObjectRef
//  needs only its IMMUTABLE `initial_shared_version` (Sui freezes it at share-time — it NEVER changes, so a
//  cached value is safe forever and can never go stale-wrong). Pass that pinned ref (via @aresrpg/sdk's
//  `as_object_arg` ref-or-id seam) instead of the bare id string and the act's build skips resolving the
//  Fight — the last runtime object the commit PTB resolved (singletons + Clock already pinned; Random pinned
//  in the SDK's &Random builders as of this lane), so a pinned-fight commit PTB builds FULLY OFFLINE.
//
//  IN-MEMORY ONLY (the client-cache law — in-memory is the app's ONLY client tier; no IndexedDB): one Map,
//  captured once per fight via a single authoritative owner-read, cleared at every fight boundary for hygiene.
//  Correctness never depends on the clear (the ISV is immutable); it only bounds the map. Degrades to the
//  id-string path (today's behavior — one resolve round-trip) on any read miss/failure — never a fabricated ref.
// ─────────────────────────────────────────────────────────────────────────────

/** fight_id → initialSharedVersion (string). Cleared at each fight boundary (see clear_fight_ref_cache). */
const store = new Map()

/** Cache a fight's immutable initial_shared_version (from an owner-read). @param {string} fight_id @param {string|number} isv */
export function remember_fight_shared_version(fight_id, isv) {
  if (fight_id && isv != null) store.set(String(fight_id), String(isv))
}

/**
 * A pinned SharedObjectRef for the fight, or null when its version isn't cached (⇒ the caller passes the id
 * string → `tx.object` → the resolve round-trip, exactly today's behavior — graceful, never a guessed ref).
 * @param {string} fight_id @param {boolean} [mutable] the act doors take `&mut Fight` / `Fight` by value ⇒ true
 * @returns {{ objectId: string, initialSharedVersion: string, mutable: boolean } | null}
 */
export function fight_shared_ref(fight_id, mutable = true) {
  const isv = fight_id && store.get(String(fight_id))
  return isv ? { objectId: String(fight_id), initialSharedVersion: isv, mutable } : null
}

/**
 * Resolve (and cache) the fight's pinned shared ref. On a cache miss it reads the Fight's IMMUTABLE
 * `owner.Shared.initialSharedVersion` ONCE via a single `getObject` and remembers it; every later call this
 * fight hits the cache (zero reads). Returns the pinned ref (`mutable:true`), or null on a read miss/failure
 * so the caller degrades to the id-string path. One read per FIGHT (not per turn) — amortized over the whole
 * fight, and it replaces the resolve the act's build would otherwise pay anyway.
 * @param {{ grpc_client: any }} sdk @param {string} fight_id @returns {Promise<object|null>}
 */
export async function ensure_fight_shared_ref(sdk, fight_id) {
  if (!fight_id) return null
  const hit = fight_shared_ref(fight_id, true)
  if (hit) return hit
  try {
    const { object } = await sdk.grpc_client.core.getObject({
      objectId: String(fight_id),
      include: { owner: true },
    })
    const isv = object?.owner?.Shared?.initialSharedVersion
    if (!isv) return null // not a shared object / unreadable — degrade to the id-string (resolve) path
    remember_fight_shared_version(fight_id, isv)
    return fight_shared_ref(fight_id, true)
  } catch {
    return null // read failed — never fabricate a ref; the id-string path still builds correctly
  }
}

/** Drop every cached fight ref — a fight boundary (fresh entry / result open). Hygiene only (ISV is immutable). */
export function clear_fight_ref_cache() {
  store.clear()
}
