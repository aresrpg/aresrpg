// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GROUP LOOP production binding (MULTICHAR lane) — arms the DI wiring core (group_wiring_core.js) with the
// real edges: the party/roster feeders, the throttled pose feed, the fight-view watcher, and the executors
// (self-pay `join_world_action` per alt, the per-member world-fight join, the fight store's ctx seat door,
// the presence layer the remote-player renderer consumes). Wired ONCE per session next to wire_party_p2p.
// The reducer (@aresrpg/party group_loop) owns every decision; nothing here decides — it feeds and obeys.

import { fight_store } from '@aresrpg/fight/store'
import { fight_view } from '@aresrpg/fight/project'

import { context } from '../game/store.js'
import { use_auth } from '../auth'
import { run_fight_entry } from '../game/fight_engage.js'
import { game_log } from '../core/log.js'
import i18n from '../i18n'

import { use_party } from './party_store.js'
import { use_dungeon } from './dungeon_store.js'
import { join_world_action } from './world_join.js'
import { join_owned_world_fight } from './owned_team_actions.js'
import { as_one_toast } from './dungeon_actions.js'
import { error_executed_digest } from './tx_digest_error.js'
import { read_checkpoint_spawn, resolve_checkpoint_spawn, write_follow_checkpoint } from './world_checkpoint.js'
import { ft_dispatch } from './fast_travel_store.js'
import { recover_fight_entry_refusal } from './dungeon_settlement.js'
import { create_group_wiring, build_follow_entries, fight_facts_of } from './group_wiring_core.js'

/** A dragon catch-up flight — fixed, run-pace-ish, non-blocking (the leader keeps roaming while it flies). */
const DRAGON_FLIGHT_MS = 12_000

/** Fly a NON-active follower to the leader through the SAME keyed fast-travel store the player's own dragon uses
 *  (owner ruling: drive my characters exactly as I would). A same-world coordinate flight — begin + a direct
 *  same-world `resolved` skip the resolve/join edges (the follower already stands in the leader's world). The
 *  slot goes `flying`, so switching to the follower mid-air hands the existing pilot its live flight; the timer
 *  then lands + clears it (the group loop seats the follower beside the leader on follow_dragon_arrived). */
function dragon_catch_up(character_id, world_id, target) {
  ft_dispatch({ traveler_id: character_id, type: 'begin', character_id, world_id, x: target.x, z: target.z })
  ft_dispatch({
    traveler_id: character_id,
    type: 'resolved',
    world_id,
    my_world_id: world_id,
    x: target.x,
    z: target.z,
    live: false,
  })
  return new Promise((resolve) => setTimeout(resolve, DRAGON_FLIGHT_MS)).then(() => {
    ft_dispatch({ traveler_id: character_id, type: 'arrived' }) // flying → landing
    ft_dispatch({ traveler_id: character_id, type: 'reset' }) // clear the slot; the group loop owns the seating
  })
}

/** @type {ReturnType<typeof create_group_wiring> | null} */
// eslint-disable-next-line functional/no-let -- one app-lifetime wiring instance, initialized by wire_group_loop.
let wiring = null
// eslint-disable-next-line functional/no-let -- the renderer's current owned-follow identity set.
let applied_ids = new Set()
const follow_listeners = new Set()
const idle_follow = Object.freeze({
  enabled: false,
  leader_character_id: null,
  follower_character_ids: Object.freeze([]),
  followers: Object.freeze({}),
  dungeon_background: false,
})

/** React/read-model door: subscribe to the reducer-owned follow projection without duplicating it in a UI store. */
export const subscribe_group_follow = (listener) => {
  follow_listeners.add(listener)
  return () => follow_listeners.delete(listener)
}
export const get_group_follow_snapshot = () => wiring?.store.getState().follow ?? idle_follow
const notify_follow = () => {
  for (const listener of follow_listeners) listener()
}

/** Apply the reducer's follow rows to presence's stable Map; remote_players polls this Map every frame. */
function apply_follow(rows) {
  const state = context.get_state()
  const visible = state.visible_characters
  if (!(visible instanceof Map)) return
  const roster = state.sui?.characters ?? []
  const cards = new Map(roster.filter((card) => card?.id).map((card) => [card.id, card]))
  const leader_character_id = wiring?.store.getState().follow.leader_character_id
  const leader = roster.find((card) => card.id === leader_character_id)
  const entries = build_follow_entries(rows, cards, leader?.world_id ?? null)
  const next_ids = new Set(entries.map((row) => row.id))
  for (const id of applied_ids) if (!next_ids.has(id) && visible.get(id)?.owned_follow) visible.delete(id)
  for (const row of entries) {
    visible.set(row.id, row.entry)
  }
  applied_ids = next_ids
}

/** Dungeon state only changes the transit row modifier; its own party/run flow remains untouched. */
function dungeon_active() {
  const phase = use_dungeon.getState()
  return !!(phase.in_session || phase.run_pass_id || phase.dungeon || phase.dungeon_id || phase.fight_id)
}

/** Membership + world truth resync — party members bind only while the SELECTED character is the basis. */
function resync() {
  if (!wiring) return
  const state = context.get_state()
  const { address } = use_auth.getState()
  const selected = state.selected_character_id ?? null
  const party_state = use_party.getState()
  const { follow, my_address, members } = wiring.store.getState()
  const captured_leader = follow.enabled ? follow.leader_character_id : null
  if (follow.enabled && my_address && address !== my_address) {
    wiring.reset()
    return
  }
  const leader_character_id = captured_leader ?? selected
  const bound =
    !!leader_character_id && !!address && party_state._party_character_id === leader_character_id && !!party_state.party
  const preserved_members = follow.enabled ? members : []
  wiring.sync_group({
    my_address: address ?? null,
    leader_character_id,
    members: bound ? party_state.party.members : preserved_members,
    worlds: (state.sui?.characters ?? []).map((card) => ({
      character_id: card.id,
      world_id: card.world_id ?? null,
    })),
  })
}

/** Batch enable door (invite-and-follow). IDs are explicit and captured by the reducer for this session. */
export function enable_group_follow({ leader_character_id, follower_character_ids }) {
  if (!wiring || !leader_character_id || !follower_character_ids?.length) return false
  resync()
  wiring.enable_follow({ leader_character_id, follower_character_ids })
  return true
}

/** Per-character follow toggle door (#496/#171). Default OFF, session-scoped, never persisted; the roster
 *  row dispatches this for ITS character. Disable needs no leader (the reducer releases it on the last off). */
export function set_group_follow({ character_id, enabled, leader_character_id = null }) {
  if (!wiring || !character_id) return false
  if (enabled && !(leader_character_id || wiring.store.getState().follow.leader_character_id)) return false
  resync()
  wiring.set_follow({ character_id, enabled, leader_character_id })
  return true
}

/** Explicit session teardown (logout/pagehide); no persisted follow preference exists. */
export function reset_group_follow() {
  wiring?.reset()
}

/** Wire the group loop once per session (embed_voxel, beside wire_party_p2p). Idempotent. */
export function wire_group_loop() {
  if (wiring) {
    resync()
    return
  }
  wiring = create_group_wiring({
    join_world: (character_id, world_id, { queued = false } = {}) =>
      join_world_action({ character_id, world_id, queued }),
    read_checkpoint: (character_id, world_id) =>
      read_checkpoint_spawn(character_id, world_id) ?? resolve_checkpoint_spawn(character_id, world_id),
    write_checkpoint: write_follow_checkpoint,
    join_fight: (character_id, fight_id, { queued = false } = {}) =>
      as_one_toast(i18n.t('fights.action_join_fight'), () =>
        run_fight_entry({
          submit: () =>
            join_owned_world_fight({
              fight_id,
              party_id: use_party.getState().party_id,
              members: [{ character_id }],
              queued,
            }),
          // The leader's world fight is already mounted while owned followers join it. Permit that world-only
          // store state, but keep busy transactions and dungeon RunPass sessions behind the normal guard.
          recover_refusal: (error) =>
            recover_fight_entry_refusal(use_dungeon, character_id, error, { live_world_fight_id: fight_id }),
        })
      ),
    dragon_fly: dragon_catch_up,
    // The EXISTING ctx door: my_entity_id re-resolves my_key against the adopted view (fight store), so the
    // HUD deck, prediction locality, and transaction_character_id all follow the acting owned seat.
    focus_seat: (character_id) => {
      game_log('group', `HUD focus → ${character_id.slice(0, 10)} (acting owned seat)`)
      fight_store.getState().input({ type: 'ctx', ctx: { my_entity_id: character_id } })
    },
    apply_follow,
    is_executed_failure: error_executed_digest,
    log: (message, data) => game_log('group', message, data),
  })
  wiring.store.subscribe(notify_follow)

  // membership/world feeder — ref-guarded so the hot STATE_UPDATED stream folds only real changes
  let seen = { selected: /** @type {any} */ (undefined), roster: /** @type {any} */ (undefined) }
  const maybe_resync = () => {
    const state = context.get_state()
    const party_state = use_party.getState()
    const next = {
      selected: state.selected_character_id ?? null,
      address: use_auth.getState().address ?? null,
      roster: state.sui?.characters,
      party: party_state.party,
      basis: party_state._party_character_id,
    }
    if (
      next.selected === seen.selected &&
      next.address === seen.address &&
      next.roster === seen.roster &&
      next.party === seen.party &&
      next.basis === seen.basis
    )
      return
    seen = next
    resync()
  }
  context.events.on('STATE_UPDATED', maybe_resync)
  use_party.subscribe(maybe_resync)
  use_auth.subscribe(maybe_resync)

  // pose feeder — the same throttled roam pose the p2p broadcast rides
  context.events.on('action/player_pose', (/** @type {any} */ pose) => {
    if (!pose) return
    wiring?.pose_tick(pose, { character_id: context.get_state().selected_character_id ?? null })
  })

  // Timer handles no state. It only emits reducer ticks, including while the dungeon owns the visible scene.
  setInterval(() => wiring?.transit_tick(Date.now()), 1000)

  let seen_dungeon = dungeon_active()
  use_dungeon.subscribe(() => {
    const active = dungeon_active()
    if (active === seen_dungeon) return
    seen_dungeon = active
    wiring?.dungeon_snapshot(active)
  })

  // fight feeder — the join window is open only while THIS session's WORLD fight (no RunPass) sits in
  // placement; dungeon room fights keep their RunPass join path and only feed seat focus here.
  fight_store.subscribe(() => {
    const view = fight_view()
    const phase = use_dungeon.getState()
    const join_open = !!view?.placement && phase.fight_id === view.fight_id && phase.run_pass_id == null
    wiring?.fight_snapshot(fight_facts_of(view), { join_open })
  })

  if (typeof window !== 'undefined') window.addEventListener('pagehide', reset_group_follow)

  resync()
}
