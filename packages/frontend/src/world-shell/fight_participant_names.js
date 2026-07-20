// Fight player identity enrichment. Engine Fight participants carry character ids + owners, but no names;
// resolve every seat in one keyless `/v1/characters?ids=` read before the view reaches build_fighters. Real
// names are immutable character identity, so successful rows are cached for the tab. Missing/error rows are
// deliberately NOT negative-cached: indexer lag may heal on the next 4s refresh, while build_fighters keeps its
// existing shortened-address fallback for this frame.

import { get_characters } from '../rpc/client'

/** @type {Map<string, string>} */
const participant_name_cache = new Map()

/** Non-empty character ids in stable seat order, deduplicated for the batched read. @param {any} view */
export function fight_participant_ids(view) {
  const seen = new Set()
  const ids = []
  for (const participant of view?.escrow ?? []) {
    const id = String(participant?.character ?? participant?.character_id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * Copy resolved character names onto escrow rows. An explicit name already carried by a view wins; an absent
 * lookup stays blank so build_fighters applies an owner-address fallback rather than inventing identity.
 * @param {any} view
 * @param {Map<string, string>} names
 */
export function apply_fight_participant_names(view, names) {
  let changed = false
  const escrow = (view?.escrow ?? []).map((participant) => {
    if (String(participant?.name ?? '').trim()) return participant
    const id = String(participant?.character ?? participant?.character_id ?? '').trim()
    const name = names.get(id)
    if (!name) return participant
    changed = true
    return { ...participant, name }
  })
  return changed ? { ...view, escrow } : view
}

/**
 * Best-effort batched id→Character-name enrichment. Dependency/cache args keep the event-fold seam pure under
 * scoped tests; production uses the read-API client and the tab-lifetime success cache above.
 * @param {any} view
 * @param {(query:{ids:string[]}) => Promise<Array<{id:string,name?:string|null}>>} [load]
 * @param {Map<string, string>} [cache]
 */
export async function resolve_fight_participant_names(view, load = get_characters, cache = participant_name_cache) {
  const missing = fight_participant_ids(view).filter((id) => !cache.has(id))
  if (missing.length) {
    try {
      const characters = await load({ ids: missing })
      for (const character of characters ?? []) {
        const id = String(character?.id ?? '').trim()
        const name = String(character?.name ?? '').trim()
        if (id && name) cache.set(id, name)
      }
    } catch {
      // Names decorate public fight state. A failed read never blocks the fight; the address fallback renders.
    }
  }
  return apply_fight_participant_names(view, cache)
}
