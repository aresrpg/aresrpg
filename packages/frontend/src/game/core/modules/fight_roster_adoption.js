// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight edge's ONE roster-adoption effect. Remote player ids resolve through read_character — the same
// normalized custody/display read as the viewer's own avatar — and its async result can only re-enter fight
// truth as a ctx input. No callback mutates a store snapshot.

import { fight_view } from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'

import { with_timeout } from '../../../utils/with_timeout'
import {
  compose_fight_roster,
  fight_roster_signature,
  missing_roster_character_ids,
} from '../../../world-shell/character_name_resolve.js'

const APPEARANCE_READ_TIMEOUT_MS = 10_000

/**
 * Resolve player Character ids through the canonical custody/display read. Dependencies are injectable so tests
 * prove the exact get_sdk → read_character route without replacing process-global modules.
 * @param {string[]} ids
 * @param {{
 *   get_sdk?: ()=>Promise<{grpc_client:any}>,
 *   read_character?: (grpc_client:any, id:string)=>Promise<any>,
 * }} [effects]
 * @returns {Promise<Map<string, any>>}
 */
export async function resolve_fight_roster_appearances(ids, effects = {}) {
  const unique = [...new Set((ids ?? []).filter(Boolean).map(String))]
  if (unique.length === 0) return new Map()

  let get_sdk = effects.get_sdk
  let read_character = effects.read_character
  if (!get_sdk || !read_character) {
    try {
      const [sdk_module, character_module] = await Promise.all([
        import('../../../chain/sdk'),
        import('../../../chain/read_character.js'),
      ])
      get_sdk = sdk_module.get_sdk
      read_character = character_module.read_character
    } catch {
      return new Map()
    }
  }

  try {
    const { grpc_client } = await with_timeout(get_sdk(), APPEARANCE_READ_TIMEOUT_MS, 'fight roster sdk')
    const rows = await Promise.all(
      unique.map((id) =>
        with_timeout(
          Promise.resolve(read_character(grpc_client, id)),
          APPEARANCE_READ_TIMEOUT_MS,
          `fight roster character ${id}`
        ).catch(() => null)
      )
    )
    return new Map(rows.filter((row) => row?.id).map((row) => [String(row.id), row]))
  } catch {
    return new Map()
  }
}

const fight_session_key = () => {
  const state = fight_store.getState()
  return `${state.session_generation ?? 0}:${state.fight_id ?? ''}`
}

const empty_adoption = (session_key) => ({
  session_key,
  known: new Map(),
  last_signature: null,
  last_roster: /** @type {any[]} */ ([]),
})

/**
 * Create the live fight's roster adopter. Effects are injected for tests; production defaults read/write only at
 * this edge. The returned function is synchronous: it publishes the provisional book now and schedules a second
 * reducer input if a normalized partner appearance lands later. Session identity fences async fight-A results
 * out of fight B and resets the appearance cache so a returning partner is read fresh.
 * @param {{
 *   get_mine: ()=>any[],
 *   get_fighters?: ()=>Map<string, any> | undefined,
 *   get_carried?: ()=>any[],
 *   get_session_key?: ()=>string,
 *   publish?: (rows:any[])=>void,
 *   resolve_characters?: (ids:string[])=>Promise<Map<string, any>>,
 * }} effects
 * @returns {()=>void}
 */
export function create_fight_roster_adoption({
  get_mine,
  get_fighters = () => fight_view()?.fighters,
  get_carried = () => fight_store.getState().ctx?.roster ?? [],
  get_session_key = fight_session_key,
  publish = (rows) => fight_store.getState().input({ type: 'ctx', ctx: { roster: rows } }),
  resolve_characters = resolve_fight_roster_appearances,
}) {
  let adoption = empty_adoption(Symbol('uninitialized'))

  const push_roster = (session_key) => {
    if (get_session_key() !== session_key || adoption.session_key !== session_key) return
    const rows = compose_fight_roster({
      mine: get_mine(),
      resolved: [...adoption.known.values()].filter(Boolean),
      carried: get_carried(),
      fighters: get_fighters(),
    })
    if (!rows.length) return
    const signature = fight_roster_signature(rows)
    if (signature === adoption.last_signature && get_carried() === adoption.last_roster) return
    adoption = { ...adoption, last_signature: signature, last_roster: rows }
    publish(rows)
  }

  return () => {
    const session_key = get_session_key()
    if (adoption.session_key !== session_key) adoption = empty_adoption(session_key)
    const missing = missing_roster_character_ids(get_fighters(), get_mine(), adoption.known)
    adoption = {
      ...adoption,
      known: new Map([...adoption.known, ...missing.map((id) => [id, undefined])]),
    }
    if (missing.length)
      void resolve_characters(missing).then(
        (characters) => {
          if (get_session_key() !== session_key || adoption.session_key !== session_key) return
          const known = new Map(adoption.known)
          for (const id of missing) {
            if (characters.has(id)) known.set(id, characters.get(id))
            else known.delete(id)
          }
          adoption = { ...adoption, known }
          if (characters.size) push_roster(session_key)
        },
        () => {
          if (get_session_key() !== session_key || adoption.session_key !== session_key) return
          const known = new Map(adoption.known)
          for (const id of missing) if (known.get(id) === undefined) known.delete(id)
          adoption = { ...adoption, known }
        }
      )
    push_roster(session_key)
  }
}
