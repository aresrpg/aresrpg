// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE WORLD MODULE (the legacy synchronizer, ported to zones). Split per the reducer law:
//   reduce — PURE: folds validated per-character tracking / movement / equipment / close.
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
  type CharacterRow,
  type VisibleSlot,
} from '@aresrpg/protocol'

import { channels, mesh, type EventEnvelope, type MeshFact } from '../protocol.ts'
import { dungeon_portal, mob_groups, resource_packs, world_population } from '../zone_spawns.ts'
import { get_owned_character } from '../reads/get_owned_character.ts'
import { get_friends } from '../reads/get_friends.ts'
import { get_zones } from '../reads/get_zones.ts'
import { get_world_fights } from '../reads/get_world_fights.ts'
import { get_fight } from '../reads/get_fight.ts'
import { get_item } from '../reads/get_item.ts'
import { get_characters } from '../reads/get_characters.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerContext, PlayerAction, PlayerState, Embodied } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

const log = logger(import.meta)

/** Tracked radius in zones around the player — 3×3 of 512-block squares. */
const TRACKING_RADIUS = 1
/** The travel bucket banks at most this much time — the burst allowance between packets.
 *  (2026-08-20: pricing each packet against a re-anchored wall clock dropped legal walks —
 *  a network stall flushes buffered positions in ONE millisecond, and a zero-second window
 *  reads any step as infinite speed. A bucket spends distance against banked time instead.) */
const BUDGET_CAP_S = 1
/** Physics-transient allowance on top of the authored budget (jump arcs, terrain snaps). */
const TRANSIENT_SLACK_BLOCKS = 3
/** Visible-player ceiling per connection (owner 2026-08-12): crowded zones never bloat the
 *  client — the cap drops strangers past 100, FRIENDS always pass. A capped-out stranger
 *  becomes visible on its next zone-cross (appears republish there). */
const VISIBLE_PLAYERS_CAP = 100
/** Legacy-tuned distance throttle: past this range a visible player's moves forward at 1/4 rate. */
const FAR_PLAYER_BLOCKS = 100
const FAR_MOVE_SKIP = 3

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
    if (action.type === 'action/track_character') {
      if (!state.allowed_characters.has(action.character.character_id)) return state
      return {
        ...state,
        characters: {
          ...state.characters,
          [action.character.character_id]: {
            presence: action.character,
            move_anchor: { x: action.character.x, z: action.character.z, at_ms: action.at_ms, blocks: 0 },
            party: action.party,
            fight: action.fight,
            fight_seat: action.fight_seat,
            active_fighter: null,
            dungeon_run: action.dungeon_run,
          },
        },
        friends: action.friends,
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
        characters: Object.fromEntries(
          Object.entries(state.characters).filter(([character_id]) => character_ids.has(character_id))
        ),
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
    const { graph, pubsub, events, signal, send, address, dispatch, get_state, drop } = context
    const tracking_generations = new Map<string, number>()

    /** channel → forwarder — the subscription machinery, rebuilt by mount/unmount */
    const { watch, unwatch, has, watched } = create_watcher(pubsub)
    /** Rendered players with their latest chain-space zone, so a subscription-window shift can
     *  retire them without waiting for a packet from a channel we just left. */
    const visible = new Map<string, Readonly<{ address: string; world: string; zx: number; zz: number }>>()
    /** character_id → skipped-move count — far players forward at 1/4 rate (legacy tuning) */
    const move_skips = new Map<string, number>()
    /** character_id → the mount state last forwarded — a toggle always beats the throttle */
    const riding_seen = new Map<string, boolean>()
    /** `world:zx:zz` → the seed whose population this connection has already been sent. The
     *  population is pure in the seed, so this is the whole condition for re-sending it: a
     *  consumption update ships the row alone, a re-roll ships the row and the new population. */
    const seeds = new Map<string, string>()
    /** One tracking window per owned character; subscriptions are the union of these sets. */
    const windows = new Map<string, Readonly<{ world: string; zones: readonly { zx: number; zz: number }[] }>>()

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

    const drop_visible = (character_id: string): void => {
      if (!visible.delete(character_id)) return
      move_skips.delete(character_id)
      riding_seen.delete(character_id)
      unwatch(channels.character(character_id))
      send({ type: 'packet/player_left', character_id })
    }

    const forward_presence = (scope: Readonly<{ world: string; zx: number; zz: number }>) => (fact: MeshFact) => {
      if (fact.address === address) return // never echo the player to himself
      if (fact.kind === 'appear') {
        // THE VISIBILITY CAP (owner 2026-08-12): a crowded zone never bloats the client —
        // strangers drop past the cap, FRIENDS always pass. A capped-out stranger becomes
        // visible on its next zone-cross (appear republishes there).
        const known = visible.has(fact.player.character_id)
        if (!known && !get_state().friends.has(fact.address) && visible.size >= VISIBLE_PLAYERS_CAP) return
        const at = zone_of(fact.player.x, fact.player.z)
        visible.set(fact.player.character_id, Object.freeze({ address: fact.address, world: scope.world, ...at }))
        riding_seen.set(fact.player.character_id, fact.player.riding)
        if (!known)
          watch(channels.character(fact.player.character_id), forward_visible_equipment as (payload: never) => void)
        send({ type: 'packet/player_appeared', player: fact.player })
      }
      if (fact.kind === 'move') {
        const known = visible.get(fact.character_id)
        if (!known) return // never appeared to us — silent until it does
        const at = zone_of(fact.x, fact.z)
        visible.set(fact.character_id, Object.freeze({ ...known, ...at }))
        const far = !Object.values(get_state().characters).some(
          ({ presence: me }) =>
            me.world === known.world && Math.hypot(fact.x - me.x, fact.z - me.z) <= FAR_PLAYER_BLOCKS
        )
        const skipped = move_skips.get(fact.character_id) ?? 0
        // the distance throttle drops POSITIONS, never a mount toggle: a player who mounts and
        // stands still far away would otherwise never send another fact to carry the change
        const toggled = riding_seen.get(fact.character_id) !== fact.riding
        if (far && !toggled && skipped < FAR_MOVE_SKIP) {
          move_skips.set(fact.character_id, skipped + 1)
          return
        }
        move_skips.set(fact.character_id, 0)
        riding_seen.set(fact.character_id, fact.riding)
        send({
          type: 'packet/player_moved',
          character_id: fact.character_id,
          x: fact.x,
          y: fact.y,
          z: fact.z,
          riding: fact.riding,
        })
      }
      if (fact.kind === 'leave') {
        drop_visible(fact.character_id)
      }
      if (fact.kind === 'who') {
        // a later joiner probes the zone it now tracks — only a player STANDING there answers
        Object.values(get_state().characters).forEach(({ presence: me, fight, dungeon_run }) => {
          if (fight || dungeon_run) return
          if (me.world !== fact.world) return
          const my_zone = zone_of(me.x, me.z)
          if (my_zone.zx !== fact.zx || my_zone.zz !== fact.zz) return
          void pubsub.mesh.publish(mesh.pos(me.world, my_zone.zx, my_zone.zz), {
            kind: 'appear',
            player: me,
            address,
          })
        })
      }
    }

    /** A zone's SEED-DERIVED population (zone_math twin) — the derivation the client never
     *  runs. Pure in the seed, so it ships once per zone per seed; what is still alive comes
     *  from the zone row's own bitmaps, which ride `packet/zones`. */
    const send_zone_spawns = (w: string, zx: number, zz: number, seed: string) => {
      const population = world_population(w)
      if (!population) return
      send({
        type: 'packet/zone_spawns',
        world: w,
        zx,
        zz,
        mobs: [...mob_groups(population, zx, zz, BigInt(seed))],
        resources: [...resource_packs(population, zx, zz, BigInt(seed))],
        portal: dungeon_portal(population, zx, zz, BigInt(seed)),
      })
    }

    /** THE ZONE-STATE DOOR. Anything that consumes a zone (a group engaged, a node gathered)
     *  or re-rolls it lands here: re-read the projected row and ship it. The event is only the
     *  TRIGGER — `pipeline.rs` orders graph writes before publishes, so the row already carries
     *  the change. Every tracker of the zone learns it from ~200 bytes, and a re-roll (a seed
     *  the client has no population for) pulls the population down with it. */
    const push_zone = (w: string, zx: number, zz: number) =>
      get_zones(graph, { world: w, zones: [{ zx, zz }] })
        .then(([zone]) => {
          if (!zone) return
          const known = seeds.get(`${w}:${zx}:${zz}`)
          send({ type: 'packet/zones', zones: [zone] })
          if (known === zone.seed) return
          seeds.set(`${w}:${zx}:${zz}`, zone.seed)
          send_zone_spawns(zone.world, zone.zx, zone.zz, zone.seed)
        })
        .catch((error: Error) => log.warn({ world: w, zx, zz, error: error.message }, 'zone push failed'))

    /** A tracked ZONE's facts (evt:zone channels) — sword markers, zone re-rolls, gathers.
     *  NOTHING rides a world-global channel anymore: presence is zone-scoped by law. */
    const forward_zone_event = (payload: EventEnvelope) => {
      if (payload.type === 'FightCreated') {
        // the event is the TRIGGER, the graph is the truth: the projection already wrote this
        // fight's node (pipeline.rs orders graph writes before publishes), so the marker ships
        // as the same projected row the zone snapshot carries — the client never fills a gap.
        const { fight, world: w, x, z } = payload.data as { fight: string; world: string; x: number; z: number }
        void get_fight(graph, { fight_id: fight })
          .then(([row]) => row && send({ type: 'packet/fight_created', fight: row }))
          .catch((error: Error) => log.warn({ fight, error: error.message }, 'fight marker read failed'))
        // a mob engage CONSUMED the group it was born on — the zone's own bitmap says which,
        // so the row alone retires the group for every tracker (a duel or a dungeon birth
        // simply changes nothing in it)
        const born = zone_of(x, z)
        if (has(mesh.pos(w, born.zx, born.zz))) void push_zone(w, born.zx, born.zz)
      }
      if (payload.type === 'FightStarted' || payload.type === 'FightEnded')
        send({
          type: 'packet/fight_phase',
          fight: (payload.data as { fight: string }).fight,
          phase: payload.type === 'FightStarted' ? 'active' : 'ended',
        })
      if (payload.type === 'ZoneSearched') {
        // a TRACKED zone was discovered or re-rolled: the row carries the real seed and the
        // real searched_at_ms, and a seed this connection has no population for pulls the
        // population down with it. Nothing here invents a field the chain owns.
        const { world: w, zx, zz } = payload.data as { world: string; zx: number; zz: number }
        if (has(mesh.pos(w, zx, zz))) void push_zone(w, zx, zz)
      }
      if (payload.type === 'ResourceGathered') {
        const { world: w, gatherer } = payload.data as { world: string; gatherer: string }
        // No gather-result packet: ItemWritten streams base and rare stacks through player_items;
        // packet/zones carries consumption; the roster below carries job XP and the verdict.
        // Re-sending the receipt's quantity would create a fourth, duplicate fold path.
        // The same checkpoint writes job xp and the gas-uniform ambush verdict. A fired verdict
        // roots the character until its projected row tells the owner which protector to face.
        if (gatherer === address)
          void get_characters(graph, { address })
            .then((characters) => {
              dispatch({ type: 'action/character_roster', characters })
              send({ type: 'packet/characters', characters })
            })
            .catch((error: Error) => log.error({ address, error: error.message }, 'post-gather roster refresh failed'))
        // one node left the pack — the zone's res_taken says which pack and how many
        const { x, z } = payload.data as { x: number; z: number }
        const at = zone_of(x, z)
        if (has(mesh.pos(w, at.zx, at.zz))) void push_zone(w, at.zx, at.zz)
      }
    }

    const wanted_zone_keys = (): Set<string> =>
      new Set([...windows.values()].flatMap(({ world, zones }) => zones.map(({ zx, zz }) => `${world}:${zx}:${zz}`)))

    /** Push one character's window while sharing every overlapping Redis subscription. */
    const track = async (character_id: string, world: string, next: readonly { zx: number; zz: number }[]) => {
      windows.set(character_id, Object.freeze({ world, zones: Object.freeze([...next]) }))
      send({ type: 'packet/tracked_zones', character_id, world, zones: [...next] })
      const wanted_keys = wanted_zone_keys()
      const wanted_presence = new Set([...wanted_keys].map((key) => `pos:${key}`))
      const wanted_events = new Set(
        [...wanted_keys].map((key) => {
          const [w = '', zx = '0', zz = '0'] = key.split(':')
          return channels.zone(w, Number(zx), Number(zz))
        })
      )
      for (const [visible_id, row] of visible)
        if (!wanted_keys.has(`${row.world}:${row.zx}:${row.zz}`)) drop_visible(visible_id)
      for (const key of [...seeds.keys()]) if (!wanted_keys.has(key)) seeds.delete(key)
      for (const channel of watched()) {
        if (channel.startsWith('pos:') && !wanted_presence.has(channel)) unwatch(channel)
        if (channel.startsWith('evt:zone:') && !wanted_events.has(channel)) unwatch(channel)
      }
      const fresh = next.filter(({ zx, zz }) => !has(mesh.pos(world, zx, zz)))
      await Promise.all(fresh.map(({ zx, zz }) => watch(mesh.pos(world, zx, zz), forward_presence({ world, zx, zz }))))
      await Promise.all(
        fresh.map(({ zx, zz }) => watch(channels.zone(world, zx, zz), forward_zone_event as (payload: never) => void))
      )
      for (const { zx, zz } of fresh)
        void pubsub.mesh.publish(mesh.pos(world, zx, zz), { kind: 'who', address, world, zx, zz })
      if (fresh.length === 0) return
      const [zones, fights] = await Promise.all([
        get_zones(graph, { world, zones: fresh }),
        get_world_fights(graph, { world, zones: fresh }),
      ])
      if (zones.length) send({ type: 'packet/zones', zones })
      if (fights.length) send({ type: 'packet/fights', fights })
      for (const zone of zones) {
        seeds.set(`${zone.world}:${zone.zx}:${zone.zz}`, zone.seed)
        send_zone_spawns(zone.world, zone.zx, zone.zz, zone.seed)
      }
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
      if (present) appear(character)
    }

    const unmount = (character: Embodied) => {
      leave(character)
      windows.delete(character.character_id)
      const wanted = wanted_zone_keys()
      for (const [visible_id, row] of visible)
        if (!wanted.has(`${row.world}:${row.zx}:${row.zz}`)) drop_visible(visible_id)
      for (const key of [...seeds.keys()]) if (!wanted.has(key)) seeds.delete(key)
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
        if (generation !== tracking_generations.get(character_id) || !get_state().allowed_characters.has(character_id))
          return
        if (!owned) {
          send({ type: 'packet/error', reason: 'not your character' })
          return
        }
        const { character, visuals, party, fight } = owned
        const world = (character.world ?? character.checkpoint_world ?? null) as string | null
        if (!world) return // never joined a world yet — nothing to mount
        const friends = new Set((await get_friends(graph, { address })).map((friend) => friend.address as string))
        if (generation !== tracking_generations.get(character_id) || !get_state().allowed_characters.has(character_id))
          return
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
          friends,
          party,
          fight: fight?.id ?? null,
          fight_seat: fight?.seat ?? null,
          dungeon_run: (character.dungeon_run as CharacterRow['dungeon_run']) ?? null,
          // THE CHECKPOINT'S OWN TIMESTAMP, never the tracking-request wall-clock (chain travel_ok
          // semantics): the travel budget accrues from the last PROVEN position — a player
          // legitimately far off an old anchor must not read as a speed hack on first move
          // (2026-08-19: that misread drop-looped every session into load-snapshot spam).
          at_ms: (character.at_ms as number) ?? 0,
        })
        send({ type: 'packet/character_tracked', character_id: character.id as string, fight: fight?.id ?? null })
      })().catch((error: Error) => {
        if (generation !== tracking_generations.get(character_id)) return
        log.error({ address, error: error.message }, 'character tracking failed')
        send({ type: 'packet/error', reason: 'character tracking failed' })
      })
    }

    events.on('packet/position', (action: Extract<PlayerAction, { type: 'packet/position' }>) => {
      const tracked = get_state().characters[action.character_id]
      if (!tracked || tracked.fight || tracked.dungeon_run) return
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
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
