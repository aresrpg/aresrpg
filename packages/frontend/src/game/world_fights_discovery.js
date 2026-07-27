// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD FIGHTS DISCOVERY — the "See fights in the area" proximity loop: players within 50 blocks of a fight
// see a "see fights in the area" prompt (the same idiom as "press to gather"), opening a panel with the
// current fights in range. A SIBLING of world_spawns.js: same
// world binding, same get_player_pos, same 6s cadence, same PromptStack idiom. It folds the /v1/fights?world
// read into the EXISTING state.visible_fights Map (the seam FightsModal already reads; its dead WS packet
// source is gone) and arms a [V] prompt whenever a fight sits within 50 blocks — the prompt's OWN label
// folds in the in-range count (owner 2026-07-23: the separate raw count-card indicator was an unstyled
// duplicate of this same signal and is deleted; this pill is the ONE surface for it now). RULING 2026-07-19:
// when someone starts a fight, other players must see the sword too — a FORMING (placement) fight
// in range also plants the SAME fight_sword.js herald every player sees when *I* start one (ground-sampled at
// its own x/z, never my own feet Y — mirrors remote_players.js's per-entity grounding), diffed+despawned every
// poll off forming_fight_sword_markers (@aresrpg/world, unit-tested). Suspended inside a dungeon (the cave has
// its own room-fight panel + ceremony). Reuses the keyless RPC read layer — zero new network layer.

import { get_world } from '@aresrpg/sdk/game'
import { world_offsets, chain_to_world } from '@aresrpg/sdk/coords'
import { ground_surface_y } from '@aresrpg/engine3/player'
import {
  to_fight_marker,
  to_dungeon_fight,
  forming_fight_sword_markers,
  FIGHT_PROXIMITY_M,
} from '@aresrpg/world/nearby_fights'

import i18n from '../i18n'
import { get_fights, get_dungeon_runs } from '../rpc/client'
import { use_world_binding } from '../world-shell/session_gate.js'
import { use_dungeon } from '../world-shell/dungeon_store.js'
import { use_party } from '../world-shell/party_store.js'
import { use_prompt_stack } from '../world-shell/prompt_stack.js'
import { feet_of } from './ambient_placement.js'
import { plant_fight_sword } from './fight_sword.js'

import { get_sdk } from '../chain/sdk'
import { context } from './core/game.js'

const POLL_MS = 6000 // the world_spawns zone cadence — one more read on the same beat, never a second loop tempo
const PROMPT_ID = 'fights'
const PROMPT_KEY = 'V' // [V]iew fights — E/F/G/R are taken (dungeon/search/gather/attack); AZERTY-safe (KeyV)

/** The [V] prompt's copy — the base "see fights" verb folded with the pluralized in-range count (owner
 *  2026-07-23: this replaces the deleted raw count-card indicator as the ONE surface for the signal). Composes
 *  two already-translated, already-6-locale keys rather than adding a third — one home per fact. */
export const fights_prompt_label = (/** @type {number} */ count) =>
  `${i18n.t('fights.see_nearby')} · ${i18n.t('fights.fights_nearby', { count })}`

/**
 * Drive the nearby-fights discovery loop on the given player-position getter. Returns `{ dispose }`.
 * @param {{ get_player_pos: () => ArrayLike<number>, engine?: any }} args `engine` is the live engine facade
 *   (add_to_scene/remove_from_scene/sample_block) — omitted (tests, or a future headless caller) simply never
 *   plants a sword, the list/prompt discovery half is unaffected.
 */
export function create_world_fights_discovery({ get_player_pos, engine = null }) {
  let disposed = false
  let polling = false
  let offsets_resolved = false
  let offset_x = 0
  let offset_z = 0
  let armed_count = 0 // 0 = the [V] prompt is unregistered; otherwise the exact count it was last armed with
  /** @type {Map<string, { dispose: () => void }>} */
  const planted_swords = new Map()
  const sample = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
    engine?.sample_block?.(x, y, z) ?? 0

  // OBSERVER SWORD CEREMONY — plant/despawn off the pure projection above. Ground-samples each marker's OWN
  // (x,z) rather than reusing the local player's feet Y (a forming fight elsewhere can sit at a different
  // elevation). No-op without an engine (list/prompt discovery still works headless/unit-tested).
  const sync_swords = (/** @type {Map<string, any>} */ map) => {
    if (!engine) return
    const forming = forming_fight_sword_markers(map)
    const next_ids = new Set(forming.map((m) => m.id))
    for (const [id, sword] of planted_swords)
      if (!next_ids.has(id)) {
        sword.dispose()
        planted_swords.delete(id)
      }
    for (const m of forming) {
      if (planted_swords.has(m.id)) continue
      const gy = feet_of(ground_surface_y(sample, Math.floor(m.position.x), Math.floor(m.position.z)))
      planted_swords.set(m.id, plant_fight_sword({ engine, anchor: [m.position.x, gy, m.position.z] }))
    }
  }
  const despawn_all_swords = () => {
    for (const sword of planted_swords.values()) sword.dispose()
    planted_swords.clear()
  }

  // The world the SELECTED character is bound to (mirrors world_spawns.current_world_id — the same one-home gate).
  const current_world_id = () => {
    const character_id = context.get_state().selected_character_id
    const b = use_world_binding.getState()
    return b.character_id === character_id ? (b.world ?? null) : null
  }

  const arm_prompt = (/** @type {number} */ count) => {
    if (armed_count === count) return // same count as last poll — skip the re-register (stable pill identity)
    armed_count = count
    use_prompt_stack.getState().register_prompt({
      id: PROMPT_ID,
      key: PROMPT_KEY,
      label: fights_prompt_label(count),
      priority: 70, // below gather/attack (a fight you can act on) but a visible ambient affordance
      on_trigger: () => context.dispatch('action/fights_modal', { focus_id: null }),
    })
  }
  const clear_prompt = () => {
    if (!armed_count) return
    armed_count = 0
    use_prompt_stack.getState().clear_prompt(PROMPT_ID)
  }

  const clear_world = () => {
    if (context.get_state().visible_fights.size) context.dispatch('action/set_visible_fights', new Map())
    despawn_all_swords() // dungeon-suspended / world unresolved — nothing left to herald
  }
  const clear_dungeon = () => {
    if (context.get_state().visible_dungeon_fights.size)
      context.dispatch('action/set_visible_dungeon_fights', new Map())
  }

  const poll = async () => {
    if (disposed || polling || document.hidden) return
    polling = true
    try {
      // In a dungeon → the room-fights of my PARTY (the "team up for the boss" join panel). In the overworld →
      // the world fights within 50 blocks. One prompt ([V]), one panel — the mode follows dungeon_id.
      const in_dungeon = use_dungeon.getState().dungeon_id != null
      const world_id = current_world_id()
      let count = 0
      if (in_dungeon) {
        clear_world()
        count = await poll_dungeon(world_id)
      } else if (world_id) {
        clear_dungeon()
        count = await poll_world(world_id)
      } else {
        clear_world()
        clear_dungeon()
      }
      if (count > 0) arm_prompt(count)
      else clear_prompt()
    } finally {
      polling = false
    }
  }

  // OVERWORLD — /v1/fights?world proximity-filtered to 50 blocks. Returns the in-range count (prompt gate).
  const poll_world = async (/** @type {string} */ world_id) => {
    if (!offsets_resolved) {
      const sdk = await get_sdk()
      const doc = await get_world({ grpc_client: sdk.grpc_client })(world_id).catch(() => null)
      const off = world_offsets(doc)
      offset_x = off.x
      offset_z = off.z
      offsets_resolved = true
    }
    // FRESH (#1317): the JOIN affordance lagged the fight it advertises by ~16s, and the poll interval was the
    // smallest term — the read sat in the shared world-poll FIFO behind the zone neighbourhood's staggered
    // reads, then could still be answered from a 3s-old LRU entry another view warmed. A fight's join window is
    // ~60s of wall clock; this read declares itself time-critical and takes the scheduler's priority lane.
    const fights = await get_fights({ world: world_id }, undefined, true).catch(() => null)
    if (disposed || !fights) return context.get_state().visible_fights.size
    const my_id = context.get_state().selected_character_id
    const p = get_player_pos()
    const px = Number(p[0])
    const pz = Number(p[2])
    // Shape → bring the chain-space anchor into signed WORLD space (per-axis offset, like world_spawns) →
    // distance; keep only OTHER players' fights within the 50-block ring (my own live fight mounts its own board
    // via world_fight.js — it is never a roam marker, mirroring the old visible_fights gate).
    const map = new Map()
    for (const f of fights) {
      const marker = to_fight_marker(f)
      if (!marker) continue
      if (my_id && marker.participant_ids.includes(my_id)) continue // my own fight — not a discovery row
      marker.position = {
        x: chain_to_world(marker.position.x, offset_x),
        z: chain_to_world(marker.position.z, offset_z),
      }
      marker.distance = Math.hypot(marker.position.x - px, marker.position.z - pz)
      if (marker.distance <= FIGHT_PROXIMITY_M) map.set(marker.id, marker)
    }
    context.dispatch('action/set_visible_fights', map)
    sync_swords(map)
    return map.size
  }

  // DUNGEON — my PARTY members' current room-fights (team up for the boss fight). Each member's run
  // (/v1/dungeon-runs?owner) carries its current room + latched fight; resolve that fight (/v1/fights?id) into a
  // joinable row (dungeon::join_fight re-derives the same-room proof on-chain). No proximity — an instance is
  // co-located. Returns the row count (prompt gate).
  const poll_dungeon = async (/** @type {string|null} */ world_id) => {
    const members = use_party.getState().party?.members ?? []
    const my_id = context.get_state().selected_character_id
    // Party members minus my exact character (my own room-fight isn't a join target). The dungeon-runs view is
    // still owner-filtered, so collapse repeated owners after preserving character-keyed membership here.
    const others = members.filter((member) => member?.character && member.character !== my_id)
    if (others.length === 0) {
      clear_dungeon()
      return 0
    }
    const allowed_character_ids = new Set(others.map((member) => member.character))
    const owners = [...new Set(others.map((member) => member.owner).filter(Boolean))]
    const runs = (await Promise.all(owners.map((owner) => get_dungeon_runs({ owner }).catch(() => [])))).flat()
    // Owner lookup can return an unaccepted same-wallet alt. Keep only exact accepted Member.character rows in MY
    // world with a latched fight (tolerate the served `fight_id` + the stale `fight` twin).
    const live = runs.filter(
      (r) =>
        allowed_character_ids.has(r?.character) &&
        (r?.fight_id ?? r?.fight) &&
        (!world_id || !r.world || r.world === world_id)
    )
    const markers = await Promise.all(
      live.map((r) =>
        get_fights({ id: r.fight_id ?? r.fight })
          .then((fs) => (fs?.[0] ? to_dungeon_fight(r, to_fight_marker(fs[0])) : null))
          .catch(() => null)
      )
    )
    if (disposed) return context.get_state().visible_dungeon_fights.size
    const map = new Map()
    for (const row of markers) {
      if (!row) continue
      if (my_id && row.participant_ids.includes(my_id)) continue // already in it — not a join row
      map.set(row.id, row)
    }
    context.dispatch('action/set_visible_dungeon_fights', map)
    return map.size
  }

  void poll()
  const timer = setInterval(poll, POLL_MS)

  return {
    dispose() {
      disposed = true
      clearInterval(timer)
      clear_prompt()
      despawn_all_swords()
    },
  }
}
