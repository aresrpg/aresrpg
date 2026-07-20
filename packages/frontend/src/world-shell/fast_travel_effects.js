// FAST-TRAVEL EFFECTS (plan leg F / §3.2·§3.6) — the async edges wired ONCE per session (mirrors
// wire_group_loop / wire_party_p2p, idempotent): the RESOLVE effect (phase 'resolving' → read the /v1 docs +
// gate → dispatch resolved/refused), the JOIN effect (phase 'joining' → join_world_action → world_joined/
// refused; an executed failure is NEVER auto-refired — join_world_action's own latch), and the NOTICE effect
// (the lifecycle toasts). No async callback ever set()s the store — each edge dispatches an INPUT folded by the
// reducer (FP constitution). The boot pickup (awaiting_boot → boot_ready) + the flight live in the player edge.

import { get_characters, get_encyclopedia } from '../rpc/client'
import { T62_WORLDS } from '../chain/deployment'
import { context } from '../game/store.js'
import { push_event_toast } from '../game/core/toast.js'
import { game_log } from '../core/log.js'
import i18n from '../i18n'

import { fast_travel_store } from './fast_travel_store.js'
import { resolve_route } from './fast_travel_target.js'
import { join_world_action } from './world_join.js'

const REALM_UNREACHABLE = 'fast_travel.realm_unreachable'

/** The friend's ACTIVE character — the one currently in a world (else the first). Address-only seams need it. */
const primary_of = (chars) => (chars ?? []).find((c) => c && c.world) ?? (chars ?? [])[0] ?? null

/** The target peer's live broadcast position by character id (same-world retarget seed), or null. */
const peer_pos_of = (cid) => {
  const entry = context.get_state().visible_characters?.get(cid)
  const p = entry?.position ?? entry?.target_position
  return p && Number.isFinite(p.x) ? { x: p.x, z: p.z } : null
}

const dispatch = (input) => fast_travel_store.getState().input(input)

/** RESOLVE — /v1 world truth + gate facts → the reducer's `resolved`/`refused` input (the routing law). */
async function run_resolve(target) {
  try {
    const my_id = context.get_state().selected_character_id ?? null
    const target_doc = target.character_id
      ? ((await get_characters({ id: target.character_id }))[0] ?? null)
      : target.address
        ? primary_of(await get_characters({ owner: target.address }))
        : null
    const my_doc = my_id ? ((await get_characters({ id: my_id }))[0] ?? null) : null
    const worlds = (await get_encyclopedia('worlds'))?.worlds ?? []
    const required_level_by_world = new Map(worlds.map((w) => [w.world_id, Number(w.required_level ?? 1)]))
    const catalog_ids = new Set(T62_WORLDS.map((w) => w.id))
    const cid = target_doc?.id ?? target.character_id ?? null
    const out = resolve_route({
      target_doc,
      my_doc,
      required_level_by_world,
      catalog_ids,
      live_pos: cid ? peer_pos_of(cid) : null,
    })
    dispatch(out.ok ? { type: 'resolved', character_id: cid, ...out.facts } : { type: 'refused', reason: out.reason })
  } catch (error) {
    game_log('fast-travel', 'resolve failed', error)
    dispatch({ type: 'refused', reason: REALM_UNREACHABLE })
  }
}

/** JOIN — the EXISTING self-pay world-join tx (a0070b64 receipt seeds the checkpoint). Executed failure never
 *  auto-refires (join_world_action latches); we surface it as the realm refusal and reset. */
async function run_join(target) {
  const my_id = context.get_state().selected_character_id ?? null
  if (!my_id || !target.world_id) return dispatch({ type: 'refused', reason: REALM_UNREACHABLE })
  try {
    await join_world_action({ character_id: my_id, world_id: target.world_id })
    dispatch({ type: 'world_joined' }) // the session gate swaps spectate→resident; the player edge boots then flies
  } catch (error) {
    game_log('fast-travel', 'cross-world join failed', error)
    dispatch({ type: 'refused', reason: REALM_UNREACHABLE })
  }
}

/** The lifecycle toasts (single home). Derived from the store transition — no state field needed. */
function fire_notice(state, prev) {
  const toast = (key, kind = 'info') => push_event_toast({ state: kind, title: i18n.t(key) })
  if (state.refusal && state.refusal !== prev.refusal) toast(state.refusal) // realm-unreachable / other refusal
  if (state.phase === 'flying' && prev.phase !== 'flying') toast('fast_travel.flying', 'success') // takeoff
  if (state.phase === 'landing' && prev.phase !== 'landing') toast('fast_travel.arrived', 'success') // arrival drop
  if (state.phase === 'flying' && prev.phase === 'flying' && prev.target?.live && state.target && !state.target.live)
    toast('fast_travel.target_lost') // the target left — landing at last-known
  // Cancelled = an ACTIVE flow returned to idle without a refusal and NOT via the arrival path (landing→idle).
  if (state.phase === 'idle' && prev.phase !== 'idle' && prev.phase !== 'landing' && !state.refusal)
    toast('fast_travel.cancelled')
}

let wired = false

/** Arm the fast-travel effect edges (idempotent — one subscription for the app lifetime). Called on session
 *  boot beside wire_group_loop; the singleton store + this one subscription survive cross-world session swaps. */
export function wire_fast_travel_effects() {
  if (wired) return
  wired = true
  fast_travel_store.subscribe((state, prev) => {
    fire_notice(state, prev)
    if (state.phase === 'resolving' && prev.phase !== 'resolving') run_resolve(state.target)
    if (state.phase === 'joining' && prev.phase !== 'joining') run_join(state.target)
  })
}
