// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure reducers own tracking state; validated packets and state deltas own effects.
// Presence stays ephemeral, and impossible movement drops the connection.

import { zone_of, SPEED_BUDGET_BLOCKS_PER_SECOND, PET_SPEED_MULTIPLIER, type CharacterRow } from '@aresrpg/protocol'

import { channels, mesh, type EventEnvelope, type MeshFact } from '../protocol.ts'
import { get_owned_character } from '../reads/get_owned_character.ts'
import { get_world_fights } from '../reads/get_world_fights.ts'
import { get_fight } from '../reads/get_fight.ts'
import { refreshed_roster_anchors, refreshed_world_anchor } from '../world_anchor.ts'
import logger from '../logger.ts'
import { create_visible_players } from '../visible_players.ts'
import { presence_discovery } from '../presence_discovery.ts'
import type { PlayerModule, PlayerContext, PlayerAction, PlayerState, Embodied } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

const log = logger(import.meta)

const TRACKING_RADIUS = 1
/** The travel bucket banks at most this much time — the burst allowance between packets.
 *  (2026-08-20: pricing each packet against a re-anchored wall clock dropped legal walks —
 *  a network stall flushes buffered positions in ONE millisecond, and a zero-second window
 *  reads any step as infinite speed. A bucket spends distance against banked time instead.) */
const BUDGET_CAP_S = 1
const TRANSIENT_SLACK_BLOCKS = 3
/** The spiral: every zone within TRACKING_RADIUS of the center. */
const spiral = (zx: number, zz: number) =>
  Array.from({ length: (2 * TRACKING_RADIUS + 1) ** 2 }, (_, index) => ({
    zx: zx + ((index % (2 * TRACKING_RADIUS + 1)) - TRACKING_RADIUS),
    zz: zz + (Math.floor(index / (2 * TRACKING_RADIUS + 1)) - TRACKING_RADIUS),
  }))

/** The same mount, still standing? — a move/refit; anything else remounts whole. */
const same_mount = (before: Embodied, current: Embodied) =>
  before.character_id === current.character_id && before.world === current.world

export default {
  name: 'player_world',

  reduce: (state, action) => {
    if (action.type === 'action/track_character') {
      if (!state.allowed_characters.has(action.character.character_id)) return state
      const existing = state.characters[action.character.character_id]
      const refreshed = refreshed_world_anchor(existing, action.character, action.at_ms)
      return {
        ...state,
        characters: {
          ...state.characters,
          [action.character.character_id]: {
            ...refreshed,
            party: action.party,
            fight: action.fight,
            fight_seat: action.fight_seat,
            active_fighter: null,
            dungeon_run: action.dungeon_run,
          },
        },
      }
    }
    if (action.type === 'action/character_roster') {
      const signatures = Object.freeze(
        Object.fromEntries(
          action.characters.map((character) => [
            character.id,
            `${character.world ?? ''}:${character.checkpoint_world ?? ''}:${character.at_ms ?? 0}:${character.custody}:${JSON.stringify(character.dungeon_run ?? null)}`,
          ])
        )
      )
      const character_ids = new Set(Object.keys(signatures))
      return {
        ...state,
        allowed_characters: character_ids,
        character_signatures: signatures,
        roster_fights: Object.freeze(
          Object.fromEntries(
            action.characters.flatMap((character) =>
              character.active_fight ? [[character.id, character.active_fight.id] as const] : []
            )
          )
        ),
        characters: refreshed_roster_anchors(state.characters, action.characters),
      }
    }
    if (action.type === 'action/move') {
      const tracked = state.characters[action.character_id]
      if (!tracked) return state
      return {
        ...state,
        characters: {
          ...state.characters,
          [action.character_id]: {
            ...tracked,
            presence: { ...tracked.presence, x: action.x, y: action.y, z: action.z, riding: action.riding },
            move_anchor: { x: action.x, z: action.z, at_ms: action.at_ms, blocks: action.budget_blocks },
          },
        },
      }
    }
    if (action.type === 'action/equip') {
      const tracked = state.characters[action.character_id]
      if (!tracked) return state
      return {
        ...state,
        characters: {
          ...state.characters,
          [action.character_id]: {
            ...tracked,
            presence: { ...tracked.presence, [action.slot]: action.item_type },
          },
        },
      }
    }
    if (action.type === 'close') return Object.keys(state.characters).length ? { ...state, characters: {} } : state
    return state
  },

  observe: (context: PlayerContext) => {
    const { graph, pubsub, events, signal, send, address, dispatch, get_state, drop, public_world } = context
    const tracking_generations = new Map<string, number>()

    /** channel → forwarder — the subscription machinery, rebuilt by mount/unmount */
    const { watch, unwatch, has, watched } = create_watcher(pubsub, signal)
    const visible = create_visible_players(context)
    /** `world:zx:zz` → the seed whose population this connection has already been sent. The
     *  population is pure in the seed, so this is the whole condition for re-sending it: a
     *  consumption update ships the row alone, a re-roll ships the row and the new population. */
    const seeds = new Map<string, string>()
    /** One tracking window per owned character; subscriptions are the union of these sets. */
    const windows = new Map<string, Readonly<{ world: string; zones: readonly { zx: number; zz: number }[] }>>()
    events.on('action/friends', () => {
      const probes = new Set(
        [...windows.values()].flatMap(({ world, zones }) => zones.map(({ zx, zz }) => `${world}:${zx}:${zz}`))
      )
      probes.forEach((key) => {
        const [world = '', zx = '0', zz = '0'] = key.split(':')
        discovery.probe(world, Number(zx), Number(zz))
      })
    })

    const zone_watches = new Map<string, () => void>()

    const forward_presence = (scope: Readonly<{ world: string; zx: number; zz: number }>) => (fact: MeshFact) => {
      if (fact.kind === 'appear' || fact.kind === 'leave') return visible.receive(scope.world, fact)
      if (fact.address === address) return
      if (fact.kind === 'who') {
        // a later joiner probes the zone it now tracks — only a player STANDING there answers
        Object.values(get_state().characters).forEach(({ presence: me, fight, dungeon_run }) => {
          if (fight || dungeon_run) return
          if (me.world !== fact.world) return
          const my_zone = zone_of(me.x, me.z)
          if (my_zone.zx !== fact.zx || my_zone.zz !== fact.zz) return
          void pubsub.mesh.publish(fact.reply_to, {
            kind: 'reply',
            request: fact.request,
            player: me,
            address,
          })
        })
      }
    }

    const discovery = presence_discovery(pubsub, signal, address, (player, owner) => {
      const at = zone_of(player.x, player.z)
      if (!has(mesh.pos(player.world, at.zx, at.zz))) return
      forward_presence({ world: player.world, ...at })({ kind: 'appear', player, address: owner })
    })

    const watch_zone = (world: string, zx: number, zz: number): void => {
      const key = `${world}:${zx}:${zz}`
      if (zone_watches.has(key)) return
      zone_watches.set(
        key,
        public_world.zones.watch(
          key,
          (value) => {
            if (!value || signal.aborted) return
            send({ type: 'packet/zones', zones: [value.zone] })
            if (seeds.get(key) === value.zone.seed) return
            seeds.set(key, value.zone.seed)
            if (value.spawns) send(value.spawns)
          },
          (error) => {
            log.warn({ key, err: error }, 'zone refresh failed')
            drop('SNAPSHOT_FAILED')
          }
        )
      )
    }
    const release_zone = (key: string): void => {
      zone_watches.get(key)?.()
      zone_watches.delete(key)
      seeds.delete(key)
    }

    // Fight markers share the zone channel; public_world owns population invalidation.
    const forward_zone_event = (payload: EventEnvelope) => {
      if (payload.type === 'FightCreated') {
        const { fight } = payload.data as { fight: string }
        void get_fight(graph, { fight_id: fight })
          .then(([row]) => row && send({ type: 'packet/fight_created', fight: row }))
          .catch((error: Error) => log.warn({ fight, error: error.message }, 'fight marker read failed'))
      }
      if (payload.type === 'FightStarted' || payload.type === 'FightEnded')
        send({
          type: 'packet/fight_phase',
          fight: (payload.data as { fight: string }).fight,
          phase: payload.type === 'FightStarted' ? 'active' : 'ended',
        })
    }

    const wanted_zone_keys = (): Set<string> =>
      new Set([...windows.values()].flatMap(({ world, zones }) => zones.map(({ zx, zz }) => `${world}:${zx}:${zz}`)))

    /** Push one character's window while sharing every overlapping Redis subscription. */
    const track = async (character_id: string, world: string, next: readonly { zx: number; zz: number }[]) => {
      if (signal.aborted) return
      windows.set(character_id, Object.freeze({ world, zones: Object.freeze([...next]) }))
      send({ type: 'packet/tracked_zones', character_id, world, zones: [...next] })
      const wanted_keys = wanted_zone_keys()
      discovery.retain(wanted_keys)
      const wanted_channels = new Set([
        ...[...wanted_keys].flatMap((key) => {
          const [w = '', zx = '0', zz = '0'] = key.split(':')
          return [mesh.pos(w, Number(zx), Number(zz)), channels.zone(w, Number(zx), Number(zz))]
        }),
      ])
      visible.retain(wanted_keys)
      for (const key of zone_watches.keys()) if (!wanted_keys.has(key)) release_zone(key)
      for (const channel of watched()) if (!wanted_channels.has(channel)) unwatch(channel)
      const fresh = next.filter(({ zx, zz }) => !has(mesh.pos(world, zx, zz)))
      await Promise.all(fresh.map(({ zx, zz }) => watch(mesh.pos(world, zx, zz), forward_presence({ world, zx, zz }))))
      const still_wanted = ({ zx, zz }: { zx: number; zz: number }) => wanted_zone_keys().has(`${world}:${zx}:${zz}`)
      await Promise.all(
        fresh
          .filter(still_wanted)
          .map(({ zx, zz }) => watch(channels.zone(world, zx, zz), forward_zone_event as (payload: never) => void))
      )
      if (signal.aborted) return
      const retained = fresh.filter(still_wanted)
      for (const { zx, zz } of retained) discovery.probe(world, zx, zz)
      if (retained.length === 0) return
      retained.forEach(({ zx, zz }) => watch_zone(world, zx, zz))
      const fights = await get_world_fights(graph, { world, zones: retained })
      const current = fights.filter((fight) => still_wanted(zone_of(fight.x, fight.z)))
      if (!signal.aborted && current.length) send({ type: 'packet/fights', fights: current })
    }

    const appear = (character: Embodied): void => {
      const { zx, zz } = zone_of(character.x, character.z)
      void pubsub.mesh.publish(mesh.pos(character.world, zx, zz), { kind: 'appear', player: character, address })
    }

    const leave = (character: Embodied): void => {
      const { zx, zz } = zone_of(character.x, character.z)
      void pubsub.mesh.publish(mesh.pos(character.world, zx, zz), {
        kind: 'leave',
        character_id: character.character_id,
        address,
      })
    }

    const mount = async (character: Embodied, present: boolean) => {
      const { zx, zz } = zone_of(character.x, character.z)
      await track(character.character_id, character.world, spiral(zx, zz))
      const tracked = get_state().characters[character.character_id]
      if (
        !signal.aborted &&
        present &&
        tracked?.presence.world === character.world &&
        !tracked.fight &&
        !tracked.dungeon_run
      )
        appear(tracked.presence)
    }

    const unmount = (character: Embodied) => {
      leave(character)
      windows.delete(character.character_id)
      const wanted = wanted_zone_keys()
      discovery.retain(wanted)
      visible.retain(wanted)
      for (const key of zone_watches.keys()) if (!wanted.has(key)) release_zone(key)
      for (const channel of watched()) {
        if (channel.startsWith('pos:')) {
          const key = channel.slice(4)
          if (!wanted.has(key)) unwatch(channel)
        }
        if (channel.startsWith('evt:zone:')) {
          const key = channel.slice('evt:zone:'.length)
          if (!wanted.has(key)) unwatch(channel)
        }
      }
    }

    const move = (before: Embodied, current: Embodied) => {
      // a refit, not a move — but a mount toggle while standing still IS presence news
      if (
        before.x === current.x &&
        before.y === current.y &&
        before.z === current.z &&
        before.riding === current.riding
      )
        return
      const previous_zone = zone_of(before.x, before.z)
      const current_zone = zone_of(current.x, current.z)
      if (current_zone.zx !== previous_zone.zx || current_zone.zz !== previous_zone.zz) {
        void track(current.character_id, current.world, spiral(current_zone.zx, current_zone.zz))
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
        riding: current.riding,
      })
    }

    // THE VALIDATION DOOR — nothing here writes state; what survives re-enters as an action.
    const track_character = (character_id: string, refresh = false): void => {
      if (!get_state().allowed_characters.has(character_id)) return
      if (!refresh && get_state().characters[character_id]) return
      const generation = (tracking_generations.get(character_id) ?? 0) + 1
      tracking_generations.set(character_id, generation)
      void (async () => {
        const owned = await get_owned_character(graph, { address, character_id })
        if (
          signal.aborted ||
          generation !== tracking_generations.get(character_id) ||
          !get_state().allowed_characters.has(character_id)
        )
          return
        if (!owned) {
          send({ type: 'packet/error', reason: 'not your character' })
          return
        }
        const { character, visuals, party, fight } = owned
        const world = (character.world ?? character.checkpoint_world) as string | undefined
        if (!world) return // never joined a world yet — nothing to mount
        const { id: fight_id, seat: fight_seat } = fight ?? { id: null, seat: null }
        dispatch({
          type: 'action/track_character',
          character: {
            character_id: character.id as string,
            owner: address,
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
            riding: false,
            world,
          },
          party,
          fight: fight_id,
          fight_seat,
          dungeon_run: (character.dungeon_run as CharacterRow['dungeon_run']) ?? null,
          // THE CHECKPOINT'S OWN TIMESTAMP, never the tracking-request wall-clock (chain travel_ok
          // semantics): the travel budget accrues from the last PROVEN position — a player
          // legitimately far off an old anchor must not read as a speed hack on first move
          // (2026-08-19: that misread drop-looped every session into load-snapshot spam).
          at_ms: (character.at_ms as number) ?? 0,
        })
      })().catch((error: Error) => {
        if (generation !== tracking_generations.get(character_id)) return
        log.error({ address, error: error.message }, 'character tracking failed')
        send({ type: 'packet/error', reason: 'character tracking failed' })
      })
    }

    events.on('action/character_watch_ready', ({ character_id }: { character_id: string }) => {
      track_character(character_id, true)
    })
    events.on('packet/position', (action: Extract<PlayerAction, { type: 'packet/position' }>) => {
      const tracked = get_state().characters[action.character_id]
      if (!tracked || tracked.fight || tracked.dungeon_run || action.checkpoint !== tracked.checkpoint) return
      const { presence: character, move_anchor } = tracked
      const now = Date.now()
      // THE AUTHORED SPEED LAW as a token bucket: time banks travel allowance (uncapped
      // accrual — the chain's travel_ok semantics: a long gap legitimately covers a long
      // walk), each step SPENDS its distance, and the leftover carries capped at one banked
      // second — so a burst of buffered packets spends the bank instead of dividing by zero,
      // while a sustained overspeed drains it and a teleport overdraws it instantly.
      const ceiling = SPEED_BUDGET_BLOCKS_PER_SECOND * (character.pet !== null ? PET_SPEED_MULTIPLIER : 1)
      const available = move_anchor.blocks + ceiling * Math.max(0, (now - move_anchor.at_ms) / 1000)
      const step = Math.hypot(action.x - move_anchor.x, action.z - move_anchor.z)
      if (step > available + TRANSIENT_SLACK_BLOCKS) {
        log.warn({ address, step, available }, 'impossible speed — connection dropped')
        drop('SPEED')
        return
      }
      dispatch({
        type: 'action/move',
        character_id: action.character_id,
        x: action.x,
        y: action.y,
        z: action.z,
        // a petless rider is a lie — the flag only stands while a pet is equipped (chain truth)
        riding: action.riding && character.pet !== null,
        at_ms: now,
        budget_blocks: Math.min(Math.max(available - step, 0), ceiling * BUDGET_CAP_S),
      })
    })

    // THE EFFECT DOOR — everything the world does is a reaction to a state DELTA.
    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (state.character_signatures !== previous.character_signatures) {
        Object.keys(previous.characters).forEach((character_id) => {
          if (state.allowed_characters.has(character_id)) return
          tracking_generations.set(character_id, (tracking_generations.get(character_id) ?? 0) + 1)
        })
        Object.entries(state.character_signatures).forEach(([character_id, signature]) => {
          if (previous.character_signatures[character_id] !== signature) track_character(character_id, true)
        })
      }
      const ids = new Set([...Object.keys(previous.characters), ...Object.keys(state.characters)])
      ids.forEach((character_id) => {
        const before_tracked = previous.characters[character_id]
        const current_tracked = state.characters[character_id]
        const before = before_tracked?.presence
        const current = current_tracked?.presence
        if (before_tracked === current_tracked) return
        if (before && current && same_mount(before, current)) {
          if (!before_tracked.dungeon_run && current_tracked.dungeon_run) {
            unmount(before)
            send({ type: 'packet/tracked_zones', character_id, world: current.world, zones: [] })
            return
          }
          if (before_tracked.dungeon_run && !current_tracked.dungeon_run) {
            void mount(current, !current_tracked.fight).catch((error: Error) => {
              log.error({ address, character_id, error: error.message }, 'world remount failed')
              send({ type: 'packet/error', reason: 'world remount failed' })
            })
            return
          }
          if (current_tracked.dungeon_run) return
          if (!before_tracked.fight && current_tracked.fight) leave(before)
          else if (before_tracked.fight && !current_tracked.fight) appear(current)
          else if (!current_tracked.fight) move(before, current)
          else {
            const previous_zone = zone_of(before.x, before.z)
            const current_zone = zone_of(current.x, current.z)
            if (current_zone.zx !== previous_zone.zx || current_zone.zz !== previous_zone.zz)
              void track(current.character_id, current.world, spiral(current_zone.zx, current_zone.zz))
          }
          return
        }
        if (before) unmount(before)
        if (current && !current_tracked.dungeon_run)
          void mount(current, !current_tracked.fight).catch((error: Error) => {
            log.error({ address, character_id, error: error.message }, 'world mount failed')
            send({ type: 'packet/error', reason: 'world mount failed' })
          })
      })
    })

    signal.addEventListener('abort', () => {
      zone_watches.forEach((stop) => stop())
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
