// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL EFFECTS (plan leg F / §3.2·§3.6) — the async edges wired ONCE per session (mirrors
// wire_group_loop / wire_party_p2p, idempotent): the RESOLVE effect (phase 'resolving' → read the /v1 docs +
// gate → dispatch resolved/refused), the JOIN effect (phase 'joining' → join_world_action → world_joined/
// refused; an executed failure is NEVER auto-refired — join_world_action's own latch), and the NOTICE effect
// (the lifecycle toasts). No async callback ever set()s the store — each edge dispatches an INPUT folded by the
// reducer (FP constitution). The boot pickup (awaiting_boot → boot_ready) + the flight live in the player edge.

import { get_characters } from '../rpc/client'
import { context } from '../game/store.js'
import { push_event_toast } from '../game/core/toast.js'
import { ft_dragon_glb_url, preload_mount_glb } from '../game/mount_rig.js'
import { game_log } from '../core/log.js'
import i18n from '../i18n'

import { fast_travel_store, initial_ft_state } from './fast_travel_store.js'
import { load_world_catalog } from './world_catalog.js'
import { resolve_route } from './fast_travel_target.js'
import { join_world_action } from './world_join.js'

const REALM_UNREACHABLE = 'fast_travel.realm_unreachable'

/** Address-only fallback: prefer a wallet character currently in a world, else the first. */
const primary_of = (chars) => (chars ?? []).find((c) => c && c.world) ?? (chars ?? [])[0] ?? null

/** The target peer's live broadcast position by character id (same-world retarget seed), or null. */
const peer_pos_of = (cid) => {
  const entry = context.get_state().visible_characters?.get(cid)
  const p = entry?.position ?? entry?.target_position
  return p && Number.isFinite(p.x) ? { x: p.x, z: p.z } : null
}

const dispatch = (input) => fast_travel_store.getState().input(input)

/** RESOLVE — /v1 world truth + gate facts → the reducer's `resolved`/`refused` input (the routing law).
 *  `traveler_id` is WHO is flying (the active player, or a steered follower) — its /v1 doc is the "my" gate. */
async function run_resolve(traveler_id, target) {
  try {
    // The picker already started this exact cache key at travel intent. Joining it here keeps route I/O in
    // parallel with the GLB work while enforcing the warm-only spawn invariant: no `resolved` input, and thus no
    // `flying` phase, can happen until the fully fetched+parsed dragon is cached.
    const dragon_ready = preload_mount_glb(ft_dragon_glb_url())
    const my_id = traveler_id
    // A friend begin carries the exact live character id, never an owner guess. Its p2p cell refines position only;
    // world + cross-world anchor still come together from this /v1 document (the routing law).
    const target_doc = target.character_id
      ? ((await get_characters({ id: target.character_id }))[0] ?? null)
      : target.address
        ? primary_of(await get_characters({ owner: target.address }))
        : null
    const my_doc = my_id ? ((await get_characters({ id: my_id }))[0] ?? null) : null
    // Both world facts come from ONE live home (world_catalog.js): the census a route is checked against and
    // the gate it is refused on. Reading the census off the build-time receipt while the gate came from /v1
    // is exactly the split #1510 filed — a throw here lands on the catch below, never a silent refusal.
    const worlds = await load_world_catalog()
    const required_level_by_world = new Map(worlds.map((w) => [w.id, w.required_level]))
    const catalog_ids = new Set(worlds.map((w) => w.id))
    const cid = target_doc?.id ?? target.character_id ?? null
    const out = resolve_route({
      target_doc,
      my_doc,
      required_level_by_world,
      catalog_ids,
      live_pos:
        target.live && Number.isFinite(target.x) && Number.isFinite(target.z)
          ? { x: target.x, z: target.z }
          : cid
            ? peer_pos_of(cid)
            : null,
    })
    if (out.ok && !(await dragon_ready)) return dispatch({ traveler_id, type: 'refused', reason: REALM_UNREACHABLE })
    dispatch(
      out.ok
        ? { traveler_id, type: 'resolved', character_id: cid, ...out.facts }
        : { traveler_id, type: 'refused', reason: out.reason }
    )
  } catch (error) {
    game_log('fast-travel', 'resolve failed', error)
    dispatch({ traveler_id, type: 'refused', reason: REALM_UNREACHABLE })
  }
}

/** JOIN — the EXISTING self-pay world-join tx (a0070b64 receipt seeds the checkpoint). Executed failure never
 *  auto-refires (join_world_action latches); we surface it as the realm refusal and reset. */
async function run_join(traveler_id, target) {
  const my_id = traveler_id
  if (!my_id || !target.world_id) return dispatch({ traveler_id, type: 'refused', reason: REALM_UNREACHABLE })
  try {
    await join_world_action({ character_id: my_id, world_id: target.world_id })
    dispatch({ traveler_id, type: 'world_joined' }) // session gate swaps spectate→resident; the edge boots then flies
  } catch (error) {
    game_log('fast-travel', 'cross-world join failed', error)
    dispatch({ traveler_id, type: 'refused', reason: REALM_UNREACHABLE })
  }
}

/** The lifecycle toasts (single home). refusal_seq makes every accepted preflight attempt observable. */
function fire_notice(state, prev) {
  const toast = (key, kind = 'info') => push_event_toast({ state: kind, title: i18n.t(key) })
  if (state.refusal && state.refusal_seq !== prev.refusal_seq) toast(state.refusal)
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
  // Per-traveler: each character's flight folds its own slice, so the edges fire per WHO transitioned. Lifecycle
  // toasts fire only for the character the player is driving (a follower's silent catch-up never spams the HUD).
  fast_travel_store.subscribe((state, prev) => {
    const active_id = context.get_state().selected_character_id ?? null
    for (const cid of new Set([...Object.keys(state.travelers), ...Object.keys(prev.travelers)])) {
      const ft = state.travelers[cid] ?? initial_ft_state()
      const prev_ft = prev.travelers[cid] ?? initial_ft_state()
      if (ft === prev_ft) continue
      if (cid === active_id) fire_notice(ft, prev_ft)
      if (ft.phase === 'resolving' && prev_ft.phase !== 'resolving') void run_resolve(cid, ft.target)
      if (ft.phase === 'joining' && prev_ft.phase !== 'joining') void run_join(cid, ft.target)
    }
  })
}
