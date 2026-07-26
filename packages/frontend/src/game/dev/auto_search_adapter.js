// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-SEARCH ADAPTER (#1106) — the effect edge of the dev scouter's pure core (auto_search.js). It owns
// THE one store instance, ferries the world into the fold as ONE snapshot input, and performs the fold's
// command rows against the seams the game already has. It invents nothing:
//
//   walk      → `context.events.emit('map/auto_run', …)` — the SAME steerer a big-map marker click drives
//               (auto_run.js), asked for a bare 'point' target so it never triggers an interaction on arrival.
//   search    → `trigger_prompt('search')` — the SAME [F] lever a human presses (DiscoveryPrompts registers
//               it, and it owns the kiosk resolve, the progress toast, the tx and the receipt into the door).
//   found     → the house event toast + the fold's own auto-disable.
//   halt      → the steerer's cancel, so a stopped loop never leaves the body running.
//
// RECEIPTS come back off the spawns core's OWN pending map: a search subject that leaves `pending` while the
// zones map was replaced is a receipt (fold_zone_searched rebuilds it); one that leaves with the zones map
// untouched is a failure. One subscription, both signals, and no dependence on event ordering.
//
// Every zone search the loop fires is a real, gas-burning transaction, so the arming safety is the FEE
// CONFIRMATION the pure core demands before it ever sets `armed` (auto_search.js). The panel mounts on the
// hack grid of every build (GameWorldHud), so the build mode guards nothing here and never did the money work.

import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { spawn_markers, subscribe_fight_entry } from '@aresrpg/world/spawns_zones'
import { zone_searchable } from '@aresrpg/world/spawns_reconcile'

import i18n from '../../i18n'
import { context } from '../store.js'
import { push_event_toast } from '../core/toast.js'
import { use_prompt_stack } from '../../world-shell/prompt_stack.js'
import { spawns_store } from '../../world-shell/spawns_adapter.js'
import { use_world_binding } from '../../world-shell/session_gate.js'
import { use_zones_view } from '../../rpc/zones_poll'
import { use_rpc_view } from '../../rpc/use_view'
import { get_encyclopedia } from '../../rpc/client'
import { is_living_mob } from '../../pages/encyclopedia/living_corpus'
import { display_mob_name } from '../../content/mob_name_overrides'

import { blank_auto_search, reduce_auto_search, zone_key_of } from './auto_search.js'

/** How often the world snapshot is ferried into the fold while the loop is armed. */
const TICK_MS = 500

/** THE one scouter atom — the fold behind one `input(msg, now)` door (the spawns_adapter idiom). */
export const use_auto_search = create((set, get) => ({
  ...blank_auto_search(),
  input: (input, now = Date.now()) => {
    const state = get()
    const next = reduce_auto_search(state, input, now)
    if (next !== state) set(next, true)
  },
}))

/** Dispatch one typed scouter input without exposing store plumbing at call sites. */
export const auto_search_input = (input, now) => use_auto_search.getState().input(input, now)

/**
 * The live mob roster the config modal picks from — the SAME /v1 door the bestiary reads
 * (`get_encyclopedia('mobs')` behind the living-generation fence), never a second corpus copy.
 * @param {boolean} enabled
 * @returns {{ rows: { template_id: string, name: string }[], loading: boolean }}
 */
export function use_mob_templates(enabled) {
  const view = use_rpc_view((signal) => get_encyclopedia('mobs', signal), { deps: [], enabled })
  const rows = (view.data?.mobs ?? [])
    .filter(is_living_mob)
    .map((mob) => ({ template_id: mob.template_id, name: display_mob_name(mob.name) || mob.template_id }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { rows, loading: view.loading }
}

/** The world snapshot the fold reduces — assembled from the stores that already hold each fact. */
function world_snapshot(zones_rows, now) {
  const cell = context.get_state().player_cell ?? null
  const spawns = spawns_store.getState()
  const fresh_keys = (zones_rows ?? [])
    .filter((row) => !zone_searchable(row, spawns.zone_ttl_ms, now))
    .map((row) => zone_key_of(row.zx, row.zy))
  return {
    type: 'world',
    // player_cell is SIGNED WORLD space and its `.y` is the world Z of the 2-D cell (the [F] gate's own read)
    player: cell ? { x: Number(cell.x), z: Number(cell.y) } : null,
    zone_size: spawns.zone_size,
    offset_x: spawns.offset_x,
    offset_z: spawns.offset_z,
    fresh_keys,
    search_armed: !!use_prompt_stack.getState().prompts.search,
    markers: spawn_markers(spawns),
  }
}

/** Steer the body to a bare world point (no interaction on arrival) through the existing auto-run seam. */
const walk_to = (x, z) => context.events.emit('map/auto_run', { type: 'point', position: { x, z } })
const halt_walk = () => context.events.emit('map/auto_run', { type: 'cancel' })

/** Perform ONE command row. The only place this feature touches the world. */
function perform(command, name_of) {
  switch (command.kind) {
    case 'walk':
      return walk_to(command.x, command.z)
    case 'search':
      // the [F] prompt owns kiosk + tx + receipt; an unarmed prompt is a no-op the fold times out honestly
      return use_prompt_stack.getState().trigger_prompt('search')
    case 'found': {
      halt_walk()
      const mob = command.name || name_of(command.template_id)
      return push_event_toast({ state: 'info', title: i18n.t('auto_search.found', { mob }) })
    }
    case 'exhausted':
      halt_walk()
      return push_event_toast({ state: 'info', title: i18n.t('auto_search.exhausted') })
    case 'halt':
      return halt_walk()
    default:
      return undefined
  }
}

/**
 * THE driver: mounts the scouter's effect edge for as long as the panel is on screen. Unmounting (a fight,
 * a world teardown, leaving the world HUD) is itself a hard stop.
 * @param {{ template_id: string, name: string }[]} mob_rows the roster used to name a find
 */
export function use_auto_search_driver(mob_rows) {
  const armed = use_auto_search((state) => state.armed)
  const world_id = use_world_binding((state) => state.world)
  // The shared /v1 zones poll (never a second poller) — idles while the loop is off.
  const zones_view = use_zones_view(armed ? world_id : null)

  // Live refs the tick reads: the poll's rows and the roster, without re-arming the interval on every poll.
  const zones_ref = useRef(null)
  const names_ref = useRef(new Map())
  zones_ref.current = zones_view.data?.zones ?? null
  names_ref.current = new Map((mob_rows ?? []).map((row) => [row.template_id, row.name]))

  // Command performance — one subscription for the life of the mount.
  useEffect(
    () =>
      use_auto_search.subscribe((state, prev) => {
        if (state.command && state.command !== prev.command)
          perform(state.command, (id) => names_ref.current.get(id) ?? id)
      }),
    []
  )

  // RECEIPTS + FAILURES off the spawns core's pending map (see the file header — no event ordering games).
  useEffect(
    () =>
      spawns_store.subscribe((state, prev) => {
        if (state.pending === prev.pending) return
        for (const key of prev.pending.keys()) {
          if (state.pending.has(key) || !key.startsWith('search:')) continue
          const [, zx, zy] = key.split(':')
          const receipt = state.zones !== prev.zones // a receipt rebuilds the zones map; a failure never does
          auto_search_input({ type: receipt ? 'zone_searched' : 'search_failed', zx: Number(zx), zy: Number(zy) })
        }
      }),
    []
  )

  // HARD STOPS: the claim → fight handoff, and any world rebind.
  useEffect(() => subscribe_fight_entry(spawns_store, () => auto_search_input({ type: 'fight_entry' })), [])
  useEffect(
    () =>
      use_world_binding.subscribe((state, prev) => {
        if (state.world !== prev.world) auto_search_input({ type: 'world_unbound' })
      }),
    []
  )

  // THE TICK: one world snapshot per beat while armed — the fold's only clock.
  useEffect(() => {
    if (!armed) return undefined
    const beat = setInterval(() => auto_search_input(world_snapshot(zones_ref.current, Date.now())), TICK_MS)
    return () => clearInterval(beat)
  }, [armed])

  // Unmounting the panel (fight chrome, world teardown, character loss) stops the loop.
  useEffect(() => () => auto_search_input({ type: 'world_unbound' }), [])
}
