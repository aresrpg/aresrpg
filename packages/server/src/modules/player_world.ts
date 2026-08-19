// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE WORLD MODULE (the legacy synchronizer, ported to zones). Split per the reducer law:
//   reduce — PURE: folds validated `action/embody` / `action/move` / `action/equip` / `close`.
//   events.on('packet/…') — the VALIDATION door: embody proves ownership at the read, position
//               proves the authored speed budget; what survives re-enters as an action dispatch.
//   events.on('STATE_UPDATED') — the EFFECT door: mounts/unmounts/moves read off the DELTA — the
//               tracked SPIRAL of zones (zone.move's 512-block squares) re-centers, presence
//               facts publish on ephemeral `pos:` mesh channels (published, never stored). The
//               mesh carries OFF-CHAIN facts only (owner law); a VISIBLE player's on-chain
//               equips arrive by forwarding THEIR evt:character stream, never re-broadcast.
//               A physically impossible move is a hacker: the connection drops, no negotiation.

import {
  zone_of,
  SPEED_BUDGET_BLOCKS_PER_SECOND,
  PET_SPEED_MULTIPLIER,
  VISIBLE_SLOTS,
  type VisibleSlot,
} from '@aresrpg/protocol'

import { channels, mesh, type EventEnvelope, type MeshFact } from '../protocol.ts'
import { mob_groups, resource_packs, world_population } from '../zone_spawns.ts'
import { get_owned_character } from '../reads/get_owned_character.ts'
import { get_friends } from '../reads/get_friends.ts'
import { get_zones } from '../reads/get_zones.ts'
import { get_world_fights } from '../reads/get_world_fights.ts'
import { get_item } from '../reads/get_item.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerContext, PlayerAction, PlayerState, Embodied } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

const log = logger(import.meta)

/** Tracked radius in zones around the player — 3×3 of 512-block squares. */
const TRACKING_RADIUS = 1
/** The speed anchor re-arms at most this often — the budget always prices a real time span. */
const ANCHOR_WINDOW_MS = 1_000
/** Physics-transient allowance on top of the authored budget (jump arcs, terrain snaps). */
const TRANSIENT_SLACK_BLOCKS = 3
/** Visible-player ceiling per connection (owner 2026-08-12): crowded zones never bloat the
 *  client — the cap drops strangers past 100, FRIENDS always pass. A capped-out stranger
 *  becomes visible on its next zone-cross (appears republish there). */
const VISIBLE_PLAYERS_CAP = 100

/** The spiral: every zone within TRACKING_RADIUS of the center. */
const spiral = (zx: number, zz: number) =>
  Array.from({ length: (2 * TRACKING_RADIUS + 1) ** 2 }, (_, index) => ({
    zx: zx + ((index % (2 * TRACKING_RADIUS + 1)) - TRACKING_RADIUS),
    zz: zz + (Math.floor(index / (2 * TRACKING_RADIUS + 1)) - TRACKING_RADIUS),
  }))

/** The same mount, still standing? — a move/refit; anything else remounts whole. */
const same_mount = (before: Embodied, current: Embodied) =>
  before.character_id === current.character_id && before.world === current.world

const is_visible_slot = (slot: string): slot is VisibleSlot => (VISIBLE_SLOTS as readonly string[]).includes(slot)

export default {
  name: 'player_world',

  reduce: (state, action) => {
    if (action.type === 'action/embody')
      return {
        ...state,
        character: action.character,
        friends: action.friends,
        party: action.party,
        fight: action.fight,
        move_anchor: { x: action.character.x, z: action.character.z, at_ms: action.at_ms },
      }
    if (action.type === 'action/move') {
      if (!state.character) return state
      const anchor_aged = !state.move_anchor || action.at_ms - state.move_anchor.at_ms >= ANCHOR_WINDOW_MS
      return {
        ...state,
        character: { ...state.character, x: action.x, y: action.y, z: action.z },
        // re-anchor at most once per window — the budget always prices a real span of time
        move_anchor: anchor_aged ? { x: action.x, z: action.z, at_ms: action.at_ms } : state.move_anchor,
      }
    }
    if (action.type === 'action/equip') {
      if (!state.character) return state
      return { ...state, character: { ...state.character, [action.slot]: action.item_type } }
    }
    if (action.type === 'close') return state.character ? { ...state, character: null } : state
    return state
  },

  observe: (context: PlayerContext) => {
    const { graph, pubsub, events, signal, send, address, dispatch, get_state, drop } = context

    /** channel → forwarder — the subscription machinery, rebuilt by mount/unmount */
    const { watch, unwatch, has, watched } = create_watcher(pubsub)
    /** character_id → address of players this connection currently renders (the cap's ledger) */
    const visible = new Map<string, string>()

    /** A VISIBLE player's own chain stream — their visible-slot equips forward as packets. */
    const forward_visible_equipment = (payload: EventEnvelope) => {
      if (payload.type !== 'ItemEquipped' && payload.type !== 'ItemUnequipped') return
      const { character, slot, item } = payload.data as { character: string; slot: string; item: string }
      if (!is_visible_slot(slot)) return
      if (payload.type === 'ItemUnequipped') {
        send({ type: 'packet/player_equipment', character_id: character, slot, item_type: null })
        return
      }
      get_item(graph, { id: item })
        .then((row) => {
          if (row) send({ type: 'packet/player_equipment', character_id: character, slot, item_type: row.item_type })
        })
        .catch((error: Error) => log.warn({ item, error: error.message }, 'equipment enrichment failed'))
    }

    const forward_presence = (fact: MeshFact) => {
      if (fact.address === address) return // never echo the player to himself
      if (fact.kind === 'appear') {
        // THE VISIBILITY CAP (owner 2026-08-12): a crowded zone never bloats the client —
        // strangers drop past the cap, FRIENDS always pass. A capped-out stranger becomes
        // visible on its next zone-cross (appear republishes there).
        const known = visible.has(fact.player.character_id)
        if (!known && !get_state().friends.has(fact.address) && visible.size >= VISIBLE_PLAYERS_CAP) return
        visible.set(fact.player.character_id, fact.address)
        if (!known)
          watch(channels.character(fact.player.character_id), forward_visible_equipment as (payload: never) => void)
        send({ type: 'packet/player_appeared', player: fact.player })
      }
      if (fact.kind === 'move') {
        if (!visible.has(fact.character_id)) return // never appeared to us — silent until it does
        send({ type: 'packet/player_moved', character_id: fact.character_id, x: fact.x, y: fact.y, z: fact.z })
      }
      if (fact.kind === 'leave') {
        if (!visible.delete(fact.character_id)) return
        unwatch(channels.character(fact.character_id))
        send({ type: 'packet/player_left', character_id: fact.character_id })
      }
    }

    /** A zone's live population (zone_math twin) — the derivation the client never runs. */
    const send_zone_spawns = (
      w: string,
      zx: number,
      zz: number,
      seed: string,
      mob_taken: string,
      res_taken: readonly number[]
    ) => {
      const population = world_population(w)
      if (!population) return
      send({
        type: 'packet/zone_spawns',
        world: w,
        zx,
        zz,
        mobs: [...mob_groups(population, zx, zz, BigInt(seed), BigInt(mob_taken))],
        resources: [...resource_packs(population, zx, zz, BigInt(seed), res_taken)],
      })
    }

    const forward_world_event = (payload: EventEnvelope) => {
      if (payload.type === 'ZoneSearched') {
        const { world: w, zx, zz, seed } = payload.data as { world: string; zx: number; zz: number; seed: string }
        send({ type: 'packet/zone_searched', world: w, zx, zz, seed })
        // a TRACKED zone just (re)rolled — fresh seed means fresh, unconsumed spawns
        if (has(mesh.pos(w, zx, zz))) send_zone_spawns(w, zx, zz, seed, '0', [])
      }
      if (payload.type === 'FightCreated') {
        const { fight, world: w, x, z } = payload.data as { fight: string; world: string; x: number; z: number }
        send({ type: 'packet/fight_created', fight, world: w, x, z })
      }
      if (payload.type === 'ResourceGathered') {
        const {
          world: w,
          gatherer,
          item_type,
          tier,
          quantity,
        } = payload.data as {
          world: string
          gatherer: string
          item_type: string
          tier: number
          quantity: number
        }
        send({ type: 'packet/resource_gathered', world: w, gatherer, item_type, tier, quantity })
      }
      if (payload.type === 'RareGathered') {
        const {
          world: w,
          gatherer,
          item_type,
          rare_item_type,
        } = payload.data as { world: string; gatherer: string; item_type: string; rare_item_type: string }
        send({ type: 'packet/rare_gathered', world: w, gatherer, item_type, rare_item_type })
      }
    }

    /** Push the states of newly tracked zones + their fights, and (re)wire the mesh channels. */
    const track = async (world: string, next: { zx: number; zz: number }[]) => {
      const wanted = new Set(next.map(({ zx, zz }) => mesh.pos(world, zx, zz)))
      const fresh = next.filter(({ zx, zz }) => !has(mesh.pos(world, zx, zz)))
      for (const channel of watched()) {
        if (channel.startsWith('pos:') && !wanted.has(channel)) unwatch(channel)
      }
      for (const { zx, zz } of fresh) watch(mesh.pos(world, zx, zz), forward_presence)
      if (fresh.length === 0) return
      const [zones, fights] = await Promise.all([
        get_zones(graph, { world, zones: fresh }),
        get_world_fights(graph, { world, zones: fresh }),
      ])
      if (zones.length) send({ type: 'packet/zones', zones })
      if (fights.length) send({ type: 'packet/fights', fights })
      // every newly tracked DISCOVERED zone carries its live population
      for (const zone of zones)
        send_zone_spawns(zone.world, zone.zx, zone.zz, zone.seed, zone.mob_taken, zone.res_taken)
    }

    const mount = async (character: Embodied) => {
      watch(channels.world(character.world), forward_world_event as (payload: never) => void)
      const { zx, zz } = zone_of(character.x, character.z)
      await track(character.world, spiral(zx, zz))
      void pubsub.mesh.publish(mesh.pos(character.world, zx, zz), { kind: 'appear', player: character, address })
    }

    const unmount = (character: Embodied) => {
      const { zx, zz } = zone_of(character.x, character.z)
      void pubsub.mesh.publish(mesh.pos(character.world, zx, zz), {
        kind: 'leave',
        character_id: character.character_id,
        address,
      })
      for (const channel of watched()) unwatch(channel)
      visible.clear()
    }

    const move = (before: Embodied, current: Embodied) => {
      if (before.x === current.x && before.y === current.y && before.z === current.z) return // a refit, not a move
      const previous_zone = zone_of(before.x, before.z)
      const current_zone = zone_of(current.x, current.z)
      if (current_zone.zx !== previous_zone.zx || current_zone.zz !== previous_zone.zz) {
        void track(current.world, spiral(current_zone.zx, current_zone.zz))
        void pubsub.mesh.publish(mesh.pos(current.world, previous_zone.zx, previous_zone.zz), {
          kind: 'leave',
          character_id: current.character_id,
          address,
        })
        void pubsub.mesh.publish(mesh.pos(current.world, current_zone.zx, current_zone.zz), {
          kind: 'appear',
          player: current,
          address,
        })
        return
      }
      void pubsub.mesh.publish(mesh.pos(current.world, current_zone.zx, current_zone.zz), {
        kind: 'move',
        character_id: current.character_id,
        address,
        x: current.x,
        y: current.y,
        z: current.z,
      })
    }

    // THE VALIDATION DOOR — nothing here writes state; what survives re-enters as an action.
    events.on('packet/embody', (action: Extract<PlayerAction, { type: 'packet/embody' }>) => {
      void (async () => {
        const owned = await get_owned_character(graph, { address, character_id: action.character_id })
        if (!owned) {
          send({ type: 'packet/error', reason: 'not your character' })
          return
        }
        const { character, visuals, party, fight } = owned
        const world = (character.world ?? character.checkpoint_world ?? null) as string | null
        if (!world) return // never joined a world yet — nothing to mount
        const friends = new Set((await get_friends(graph, { address })).map((friend) => friend.address as string))
        dispatch({
          type: 'action/embody',
          character: {
            character_id: character.id as string,
            name: character.name as string,
            classe: character.classe as string,
            sex: character.sex as string,
            level: character.level as number,
            color_1: character.color_1 as number,
            color_2: character.color_2 as number,
            color_3: character.color_3 as number,
            ...visuals,
            x: (character.x as number) ?? 0,
            y: 0,
            z: (character.z as number) ?? 0,
            world,
          },
          friends,
          party,
          fight: fight?.id ?? null,
          // THE CHECKPOINT'S OWN TIMESTAMP, never the embody wall-clock (chain travel_ok
          // semantics): the travel budget accrues from the last PROVEN position — a player
          // legitimately far off an old anchor must not read as a speed hack on first move
          // (2026-08-19: that misread drop-looped every session into load-snapshot spam).
          at_ms: (character.at_ms as number) ?? 0,
        })
      })().catch((error: Error) => {
        log.error({ address, error: error.message }, 'embody failed')
        send({ type: 'packet/error', reason: 'embody failed' })
      })
    })

    events.on('packet/position', (action: Extract<PlayerAction, { type: 'packet/position' }>) => {
      const { character, move_anchor } = get_state()
      if (!character || !move_anchor) return // position before embody is noise
      const now = Date.now()
      const elapsed_s = (now - move_anchor.at_ms) / 1000
      const travelled = Math.hypot(action.x - move_anchor.x, action.z - move_anchor.z)
      // THE AUTHORED SPEED LAW, priced the chain's way (travel_ok): distance FROM THE ANCHOR
      // over elapsed SINCE THE ANCHOR, plus a small jitter slack — a 50ms sample of a jump arc
      // is not a speed hack, a sustained overspeed still runs out of budget inside one window.
      const ceiling = SPEED_BUDGET_BLOCKS_PER_SECOND * (character.pet !== null ? PET_SPEED_MULTIPLIER : 1)
      if (travelled > ceiling * elapsed_s + TRANSIENT_SLACK_BLOCKS) {
        log.warn({ address, travelled, elapsed_s }, 'impossible speed — connection dropped')
        drop('SPEED')
        return
      }
      dispatch({ type: 'action/move', x: action.x, y: action.y, z: action.z, at_ms: now })
    })

    // THE EFFECT DOOR — everything the world does is a reaction to a state DELTA.
    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      const before = previous.character
      const current = state.character
      if (before === current) return
      if (before && current && same_mount(before, current)) {
        move(before, current)
        return
      }
      if (before) unmount(before)
      if (current)
        void mount(current).catch((error: Error) => {
          log.error({ address, error: error.message }, 'world mount failed')
          send({ type: 'packet/error', reason: 'world mount failed' })
        })
    })

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
