// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-57 — raw chain reads for the RUN + FIGHT driver (extracted from dungeon_store.js for the ≤600-LoC law).
// gRPC Core only (json + object version — the W1 monotonic guard consumes the version); every read degrades to
// null/empty on error at the CALLER (honest-empty law) — nothing here fabricates.

/** Read one object's flattened json + version (null when unreadable/gone). */
export async function read_object(/** @type {any} */ sdk, /** @type {string} */ id) {
  const { object } = await sdk.grpc_client.core.getObject({ objectId: id, include: { json: true } })
  if (!object?.json) return null
  return { json: /** @type {any} */ (object.json), version: object.version ?? 0 }
}

/** "Object gone" discrimination — a burned/settled shared object read is a recovery SIGNAL, not an error (a
 *  terminal Fight/RunPass is deleted on settle). The read layer's single home for it (was fight_bridge's). */
export const is_gone_error = (/** @type {any} */ error) => {
  const codes = [error?.code, error?.cause?.code, error?.error?.code, error?.response?.error?.code]
  if (codes.some((code) => /deleted|not.?found|not.?exists/i.test(String(code ?? '')))) return true
  return /not\s*found|notExists|deleted|does not exist/i.test(String(error?.message ?? error ?? ''))
}

/** Flattened Move Option → value | null (gRPC json flattens `Option` to null / value / { vec: [...] }). */
export const opt = (/** @type {any} */ v) => (v == null ? null : Array.isArray(v?.vec) ? (v.vec[0] ?? null) : v)

/** Decode a `run::RunPass` object read (null when gone). `fight` = the latched room fight (null = free). */
export function decode_pass(/** @type {any} */ read) {
  if (!read) return null
  const { json, version } = read
  const commit = opt(json.commit)
  return {
    id: json.id,
    world: json.world,
    room: Number(json.room ?? 1),
    owner: json.owner,
    return_x: Number(json.return_x ?? 0),
    return_z: Number(json.return_z ?? 0),
    fight: commit?.fight ?? null,
    version,
  }
}

/**
 * World dungeon meta: ordered room rosters + the key template (world.move `dungeon_rooms` /
 * `dungeon_key_template`) + mob identity (name / min_level / element) off each distinct MobTemplate shared
 * object. `element` (mob_template.move `element: u8` — 0=fire 1=water 2=earth 3=air, 255=none) is what the
 * fight board resolves a mob's basic-attack cast VFX/SFX on (fight_view mob row → vfx_map.resolve_cast_element).
 */
export async function load_world_meta(/** @type {any} */ sdk, /** @type {string} */ world_id) {
  const read = await read_object(sdk, world_id)
  if (!read) throw new Error('World not found on-chain')
  const rooms = (read.json.dungeon_rooms ?? []).map((/** @type {any} */ r) => r?.mobs ?? [])
  const key_template = opt(read.json.dungeon_key_template)
  const distinct = [...new Set(rooms.flat())]
  const mob_names = /** @type {Record<string,string>} */ ({})
  const mob_levels = /** @type {Record<string,number>} */ ({})
  const mob_elements = /** @type {Record<string,number>} */ ({})
  await Promise.all(
    distinct.map(async (id) => {
      const t = await read_object(sdk, id).catch(() => null)
      if (!t) return
      mob_names[id] = t.json.name ?? 'Mob'
      mob_levels[id] = Number(t.json.min_level ?? 1)
      mob_elements[id] = Number(t.json.element ?? 255)
    })
  )
  return { rooms, key_template, mob_names, mob_levels, mob_elements }
}

/** Runaway guard on how many already-held bag candidates are chain-verified per pass — a wallet holds at most a
 *  handful of distinct key STACKS (keys stack), so this is never reached in practice. */
const KEY_CANDIDATE_CAP = 8

/**
 * Resolve the §9 entry key for the burn PTB — the FAST PATH that killed the ~10s entry stall (a live
 * regression: "Entering the dungeon… ~10s, this is a violation"). The loaded bag (`s.sui.items`, the SAME rows DungeonsModal
 * renders) already threads each key's {id, kiosk_id, kiosk_cap_id} triple (get_owned_items captured it), so the
 * client HOLDS the key's provenance; only the template needs checking. Each `candidate` is RE-VALIDATED at press
 * time with ONE read (still on-chain AND really this world's key template — a consumed/moved key fails and is
 * skipped); the FIRST that verifies wins, so a fresh single-key bag costs exactly ONE round trip.
 *
 * FALLBACK (V1 sweep — the old O(kiosks×items) live kiosk walk is DELETED): when NO candidate verifies (empty
 * bag on the dev-rig path, or an all-stale bag), do ONE `/v1` refetch of owned items via the injected `refetch`
 * (the SAME owner-items read the bag/store uses — /v1-first, get_owned_items), re-derive candidates, and verify
 * ONCE more. Still nothing → honest null (the caller refuses with `dungeons.no_key`). NEVER a chain-direct kiosk
 * scan. The activate PTB then dry-runs the whole burn leg before any gas (S-54 simulate-first), so even a
 * stale-kiosk pick refuses at SIMULATION with ZERO gas, never a burn.
 * @param {any} sdk
 * @param {{ key_template: string, candidates?: { id: string, kiosk_id: string, kiosk_cap_id: string }[],
 *           refetch?: () => Promise<{ id: string, kiosk_id: string, kiosk_cap_id: string }[]> }} p
 *   `refetch` re-reads owned items via /v1 and returns freshly-derived key candidates (dungeon_store wires it to
 *   get_owned_items → key_candidates); omitted → a miss is a straight null (pure candidate verify).
 * @returns {Promise<{ id: string, kiosk_id: string, kiosk_cap_id: string } | null>}
 */
export async function resolve_entry_key(sdk, { key_template, candidates = [], refetch }) {
  const verify = async (/** @type {{ id: string, kiosk_id: string, kiosk_cap_id: string }[]} */ cands) => {
    for (const c of (cands ?? []).slice(0, KEY_CANDIDATE_CAP)) {
      const read = await read_object(sdk, c.id).catch(() => null)
      if (read && String(read.json.template) === String(key_template))
        return { id: c.id, kiosk_id: c.kiosk_id, kiosk_cap_id: c.kiosk_cap_id }
    }
    return null
  }
  const hit = await verify(candidates)
  if (hit || !refetch) return hit
  // Empty/stale bag — ONE /v1 refetch of owned items, re-derive candidates, verify ONCE more. Never a kiosk walk.
  return verify(await refetch())
}
