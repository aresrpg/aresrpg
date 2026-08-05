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
//   approach  → the same steerer, plus the "spotted it, running over" toast (the loop is unattended).
//   found     → the house event toast + a SOFT ALARM (`play_fight_sfx('warn')`) + the fold's own auto-disable.
//   halt      → the steerer's cancel, so a stopped loop never leaves the body running.
//
// The steerer talks BACK too: `subscribe_auto_run_cancelled` reports every cancellation and its reason, so the
// player taking manual control disarms the fold instead of leaving the toggle lying about a dead run.
//
// RECEIPTS come back off the spawns core's OWN pending map: a search subject that leaves `pending` while the
// zones map was replaced is a receipt (fold_zone_searched rebuilds it); one that leaves with the zones map
// untouched is a failure. One subscription, both signals, and no dependence on event ordering.
//
// Every zone search the loop fires is a real, gas-burning transaction, so the arming safety is the FEE
// CONFIRMATION the pure core demands before it ever sets `armed` (auto_search.js). The panel mounts on the
// hack grid of every build (GameWorldHud), so the build mode guards nothing here and never did the money work.

import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { spawn_markers, subscribe_fight_entry } from '@aresrpg/world/spawns_zones'
import { zone_searchable } from '@aresrpg/world/spawns_reconcile'

import i18n from '../../i18n'
import { context } from '../store.js'
import { push_event_toast } from '../core/toast.js'
import { play_fight_sfx } from '../core/audio/sfx.js'
import { subscribe_auto_run_cancelled } from '../auto_run.js'
import { use_prompt_stack } from '../../world-shell/prompt_stack.js'
import { spawns_store } from '../../world-shell/spawns_adapter.js'
import { use_world_binding } from '../../world-shell/session_gate.js'
import { use_zones_view } from '../../rpc/zones_poll'
import { useRpcView } from '../../rpc/use_view'
import { get_encyclopedia } from '../../rpc/client'
import { display_mob_name } from '../../content/mob_name_overrides'

import { zone_world_doc } from '../zone_rows.js'

import { blank_auto_search, reduce_auto_search, settings_of, zone_key_of } from './auto_search.js'
import { read_auto_search_settings, save_auto_search_settings } from './auto_search_pref.js'

/** How often the world snapshot is ferried into the fold while the loop is armed. */
const TICK_MS = 500

/** Did this fold step change what the player CONFIGURED (as opposed to what the run is doing)? */
const settings_changed = (before, after) =>
  before.from_m !== after.from_m ||
  before.to_m !== after.to_m ||
  before.targets !== after.targets ||
  before.wanted !== after.wanted ||
  before.wanted_resources !== after.wanted_resources

/**
 * THE one scouter atom — the fold behind one `input(msg, now)` door (the spawns_adapter idiom).
 *
 * PERSISTENCE (#2029) is exactly two lines at this edge, and only here: the atom is BORN hydrated from the
 * saved settings group, and a step that changed that group writes it back. The fold itself stays pure and
 * knows nothing about storage. The run state is never persisted — arming spends real gas, so it is always
 * the player's live decision (auto_search_pref.js carries the full reasoning).
 */
export const useAutoSearch = create((set, get) => ({
  ...blank_auto_search(),
  ...read_auto_search_settings(),
  input: (input, now = Date.now()) => {
    const state = get()
    const next = reduce_auto_search(state, input, now)
    if (next === state) return
    set(next, true)
    if (settings_changed(state, next)) save_auto_search_settings(settings_of(next))
  },
}))

/** Dispatch one typed scouter input without exposing store plumbing at call sites. */
export const auto_search_input = (input, now) => useAutoSearch.getState().input(input, now)

/**
 * THE CURRENT WORLD'S mob table — the template ids that can actually spawn here. Read off the World doc the
 * zone derivation already caches (`zone_world_doc`, one chain read per world, config-grade), never a new
 * fetch and never a second copy of the table. `null` = not known yet / unreadable, which every caller reads
 * as UNKNOWN (fail shut), never as "this world has no mobs".
 *
 * It also carries that truth into the fold the moment it lands: a selected template that this world cannot
 * spawn is an unfindable target, so `world_mobs` prunes it — one typed input through the door, never a
 * callback writing the store.
 * @returns {Set<string> | null}
 */
export function useWorldMobIds() {
  const world_id = use_world_binding((state) => state.world)
  const [ids, set_ids] = useState(/** @type {Set<string> | null} */ (null))

  useEffect(() => {
    set_ids(null) // a world switch un-knows the table until the new world's doc lands
    if (!world_id) return undefined
    let live = true
    zone_world_doc(world_id).then((doc) => {
      // An unreadable doc keeps the table UNKNOWN — pruning off a failed read would silently drop a
      // selection the player made, and listing off one would show the global bestiary again.
      if (!live || !doc?.mobs?.length) return
      const template_ids = doc.mobs.map((mob) => String(mob.template_id))
      set_ids(new Set(template_ids))
      auto_search_input({ type: 'world_mobs', template_ids })
    })
    return () => {
      live = false
    }
  }, [world_id])

  return ids
}

/**
 * The live mob roster the config modal picks from: the bestiary's own /v1 door
 * (`get_encyclopedia('mobs')` — the live rows themselves, never a build-time id set and never a second
 * corpus copy, #1467), SCOPED to the current world's spawn table. An unknown table serves NO rows (still `loading`) rather than the whole
 * global bestiary — the picker only ever offers mobs this world can actually spawn.
 * @param {boolean} enabled
 * @param {Set<string> | null} world_mob_ids the current world's table (`null` = not known yet)
 * @returns {{ rows: { template_id: string, name: string }[], loading: boolean }}
 */
export function useMobTemplates(enabled, world_mob_ids) {
  const view = useRpcView((signal) => get_encyclopedia('mobs', signal), { deps: [], enabled })
  const rows = world_mob_ids
    ? (view.data?.mobs ?? [])
        .filter((mob) => world_mob_ids.has(String(mob.template_id)))
        .map((mob) => ({ template_id: mob.template_id, name: display_mob_name(mob.name) || mob.template_id }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : []
  return { rows, loading: view.loading || (enabled && !world_mob_ids) }
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
    world_frame_ready: spawns.world_frame_ready,
    fresh_keys,
    search_armed: !!use_prompt_stack.getState().prompts.search,
    markers: spawn_markers(spawns),
  }
}

/** Steer the body to a bare world point (no interaction on arrival) through the existing auto-run seam. */
const walk_to = (x, z) => context.events.emit('map/auto_run', { type: 'point', position: { x, z } })
const halt_walk = () => context.events.emit('map/auto_run', { type: 'cancel' })

/** Perform ONE command row. The only place this feature touches the world. Exported for its driven unit test. */
export function perform(command, name_of) {
  switch (command.kind) {
    case 'walk':
      return walk_to(command.x, command.z)
    case 'approach': {
      // a walk that says what it saw — the scouter runs unattended, so a silent beeline reads as a stall
      walk_to(command.x, command.z)
      const mob = command.name || name_of(command.template_id)
      return push_event_toast({ state: 'info', title: i18n.t('auto_search.sighted', { mob }) })
    }
    case 'search':
      // the [F] prompt owns kiosk + tx + receipt; an unarmed prompt is a no-op the fold times out honestly
      return use_prompt_stack.getState().trigger_prompt('search')
    case 'found': {
      halt_walk()
      // THE SOFT ALARM: the scouter's whole point is running while the player looks elsewhere, so the find has
      // to be audible. `warn` is the registry's one restrained ATTENTION cue (a quiet low rising tone, never a
      // shrill beep) — the discovery chime is already spent on every zone reveal this loop fires, so reusing it
      // would bury the find in its own noise. Once per find: the fold's `found` row lands exactly once (seq).
      play_fight_sfx('warn')
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
export function useAutoSearchDriver(mob_rows) {
  const armed = useAutoSearch((state) => state.armed)
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
      useAutoSearch.subscribe((state, prev) => {
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

  // THE PLAYER TAKING THE BODY BACK: the steerer announces every cancellation and why (auto_run.js). Its own
  // churn — our next leg, our halt, an arrival, a stuck leg — rides the same door; the FOLD owns which reason
  // ends the run, so a scout the player interrupted can never leave the toggle armed.
  useEffect(() => subscribe_auto_run_cancelled((reason) => auto_search_input({ type: 'interrupted', reason })), [])

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
