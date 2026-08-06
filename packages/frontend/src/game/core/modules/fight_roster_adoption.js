// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight edge's ONE roster-adoption effect. A co-fighter's identity comes from OUR OWN read layer — one
// `/v1/characters?ids=` batch through resolve_character_docs, the door every other identity surface already
// reads — and its async result can only re-enter fight truth as a ctx input. No callback mutates a store
// snapshot.
//
// THE SECOND INGESTION DOOR IS GONE (#2200). This used to call `read_character` against the PUBLIC SUI FULLNODE,
// one round trip per fighter: a private read path around the keyless layer that already serves these exact
// facts (`packages/rpc/api/views.js` — "bulk profiles for world-presence rendering", the same door the peer
// appearance cache and every name lookup use). The architecture is reads-via-/v1; a fight is not an exception.
//
// This effect runs on EVERY fold, and the fight clock folds 4×/s for a whole fight, so what it declines to read
// is as load-bearing as what it reads: an id that did not resolve waits out CHARACTER_READ_TTL_MS before it is
// asked again.

import { fight_view } from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'

import {
  CHARACTER_READ_TTL_MS,
  compose_fight_roster,
  fight_roster_signature,
  missing_roster_character_ids,
  resolve_character_docs,
} from '../../../world-shell/character_name_resolve.js'

/**
 * THE PRODUCTION RESOLVER — the `/v1` read.
 *
 * The seam is the `/v1` FETCH — never the resolver: there is exactly one read door in this file and a test can
 * only prove which query left through it, not swap it for another one.
 * @param {string[]} ids
 * @param {{ fetch_characters?: (query:{ids:string[]})=>Promise<any[]> }} [seams]
 * @returns {Promise<Map<string, any>>}
 */
export const resolve_roster_appearances = (ids, { fetch_characters } = {}) =>
  resolve_character_docs(ids, fetch_characters)

const fight_session_key = () => {
  const state = fight_store.getState()
  return `${state.core.session_generation ?? 0}:${state.fight_id ?? ''}`
}

const empty_adoption = (session_key) => ({
  session_key,
  known: new Map(),
  /** id → the ms stamp of its last FAILED resolve. See the retry floor in the adopter below. */
  unresolved: new Map(),
  last_signature: null,
})

// The `/v1` doc's IDENTITY subset, carried through UNRESHAPED — `class` and nested `colors` are the wire's own
// names, and the identity book (packages/fight/src/identity_book.js) already decodes exactly this shape for raw
// `/v1` teammate docs. Re-flattening them here would be a second normalizer for one fact. The doc's progression
// (level/experience) is deliberately not carried: the carried row already holds it, from this same door.
const appearance_roster_row = (character) => ({
  id: character.id,
  name: character.name,
  class: character.class,
  male: character.male,
  colors: character.colors,
})

/**
 * Create the live fight's roster adopter. Effects are injected for tests; production defaults read/write only at
 * this edge. The returned function is synchronous: it publishes the provisional book now and schedules a second
 * reducer input if a partner's `/v1` identity lands later. Session identity fences async fight-A results out of
 * fight B and resets the appearance cache so a returning partner is read fresh.
 * @param {{
 *   get_mine: ()=>any[],
 *   get_fighters?: ()=>Map<string, any> | undefined,
 *   get_carried?: ()=>any[],
 *   get_session_key?: ()=>string,
 *   publish?: (rows:any[])=>void,
 *   resolve_characters?: (ids:string[])=>Promise<Map<string, any>>,
 *   now?: ()=>number,
 * }} effects
 * @returns {()=>void}
 */
export function create_fight_roster_adoption({
  get_mine,
  get_fighters = () => fight_view()?.fighters,
  get_carried = () => fight_store.getState().ctx?.roster ?? [],
  get_session_key = fight_session_key,
  publish = (rows) => fight_store.getState().input({ type: 'ctx', ctx: { roster: rows } }),
  resolve_characters = resolve_roster_appearances,
  now = () => Date.now(),
}) {
  let adoption = empty_adoption(Symbol('uninitialized'))

  const push_roster = (session_key) => {
    if (get_session_key() !== session_key || adoption.session_key !== session_key) return
    const carried = get_carried()
    const carried_by_id = new Map(carried.map((row) => [String(row?.id), row]))
    const resolved = [...adoption.known.values()]
      .filter(Boolean)
      .map((character) => ({
        ...(carried_by_id.get(String(character.id)) ?? {}),
        ...appearance_roster_row(character),
      }))
    // Only what was really RESOLVED enters the book's roster input (#1993 WP3): the provisional short-id row this
    // used to seed off `get_fighters()` is deleted, so an unresolved seat has no roster row at all and the
    // identity book reports it unresolved instead of inheriting a placeholder that reads like a name.
    const rows = compose_fight_roster({ mine: get_mine(), resolved, carried })
    if (!rows.length) return
    // OBSERVE THE DELTA, NOT THE ARRIVAL (#2027). The gate is CONTENT — this signature — and nothing else. It
    // used to also demand that the store still hold the exact array we last published, which cannot converge:
    // this adopter is subscribed to the store, so its publish re-enters the SAME door and is QUEUED (store.js's
    // flat drain), leaving `ctx.roster` at least one publish behind. Two notifications while one publish is in
    // flight and the reference never agrees again — every fold republished a content-identical roster until the
    // re-entrancy breaker fired mid-fight and its throw killed the post-fight pipeline. A roster whose content
    // did change still republishes: `rows` is composed FROM `carried`, so any foreign write moves the signature.
    // A new session is covered by the session key above, which resets this gate wholesale.
    const signature = fight_roster_signature(rows)
    if (signature === adoption.last_signature) return
    adoption = { ...adoption, last_signature: signature }
    publish(rows)
  }

  /** A failed resolve is FORGOTTEN, never re-asked, once its retry window has passed. */
  const forget_failure = (unresolved, at) => {
    const kept = new Map(unresolved)
    for (const [id, failed_at] of kept) if (at - failed_at > CHARACTER_READ_TTL_MS) kept.delete(id)
    return kept
  }

  return () => {
    const session_key = get_session_key()
    if (adoption.session_key !== session_key) adoption = empty_adoption(session_key)
    // NEVER RE-ASK EVERY FOLD. This adopter is subscribed to the fight store and the fight clock feeds it a tick
    // 4×/s (world-shell/fight_core_clock.js) for the whole fight, so "ask again next fold" IS "ask again in
    // 250ms". A failed resolve used to simply `delete` the id, which made it missing again on the very next
    // notification: one read per unresolved fighter, four times a second, forever. A failure is now remembered
    // with its stamp and retried on the SAME bounded window a resolved character is refreshed on
    // (CHARACTER_READ_TTL_MS — the one home in character_name_resolve.js): never permanent (a seat the index has
    // not snapshotted yet still heals), never per tick.
    const at = now()
    const unresolved = forget_failure(adoption.unresolved, at)
    adoption = { ...adoption, unresolved }
    const already_asked = { has: (id) => adoption.known.has(id) || adoption.unresolved.has(id) }
    const missing = missing_roster_character_ids(get_fighters(), get_mine(), already_asked)
    adoption = {
      ...adoption,
      known: new Map([...adoption.known, ...missing.map((id) => [id, undefined])]),
    }
    if (missing.length)
      void resolve_characters(missing).then(
        (characters) => {
          if (get_session_key() !== session_key || adoption.session_key !== session_key) return
          const known = new Map(adoption.known)
          const failures = new Map(adoption.unresolved)
          const landed_at = now()
          for (const id of missing) {
            if (characters.has(id)) {
              known.set(id, characters.get(id))
              failures.delete(id)
            } else {
              known.delete(id)
              failures.set(id, landed_at)
            }
          }
          adoption = { ...adoption, known, unresolved: failures }
          if (characters.size) push_roster(session_key)
        },
        () => {
          if (get_session_key() !== session_key || adoption.session_key !== session_key) return
          const known = new Map(adoption.known)
          const failures = new Map(adoption.unresolved)
          const landed_at = now()
          for (const id of missing)
            if (known.get(id) === undefined) {
              known.delete(id)
              failures.set(id, landed_at)
            }
          adoption = { ...adoption, known, unresolved: failures }
        }
      )
    push_roster(session_key)
  }
}
