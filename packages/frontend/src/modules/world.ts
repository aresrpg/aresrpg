// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The world's server-streamed surroundings: searched-zone rows and nearby players' live
// positions. One reducer folds the packets; the compass and minimap render this slice.

import { chain_to_client_coordinate, client_to_chain_coordinate } from '@aresrpg/immutable'
import {
  live_mob_groups,
  live_resource_packs,
  zone_of,
  type FightRow,
  type MobGroupRow,
  type PresenceRow,
  type ResourcePackRow,
  type ServerPacket,
  type ZoneRow,
} from '@aresrpg/protocol'

import { copy_text } from '../i18n/copy.ts'
import { read_pose } from '../game/core/pose_feed.ts'
import { play_procedural_cue } from '../game/audio/procedural_cues.ts'
import { parse_resource_node_id } from '../game/resource_nodes.ts'
import { gather_gate } from '../game/gather_gate.ts'
import { content_catalog } from '../content/catalog.ts'
import { toast } from '../toast.ts'
import { stack_merge_target } from '../inventory_stacks.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

import { character_custody, selected_character } from './session.ts'
import { begin_pending_engage, remove_pending_engage, submit_pending_engage } from './world_engage.ts'
import { fold_cached_world, project_world_window, retain_world_characters } from './world_cache.ts'

export { engage_sword_markers } from './world_engage.ts'

export type WorldState = Readonly<{
  windows: Readonly<Record<string, Readonly<{ world: string; zones: readonly { zx: number; zz: number }[] }>>>
  all_zones: Readonly<Record<string, ZoneRow>>
  all_players: Readonly<Record<string, PresenceRow>>
  all_spawns: Readonly<
    Record<string, Readonly<{ mobs: readonly MobGroupRow[]; resources: readonly ResourcePackRow[] }>>
  >
  all_fights: Readonly<Record<string, FightRow>>
  /** world owning the current server subscription window */
  tracked_world: string | null
  /** searched zones by `world:zx:zz` — presence of a row means DISCOVERED (seed drawn) */
  zones: Readonly<Record<string, ZoneRow>>
  /** nearby players by character id — live positions ride packet/player_moved */
  players: Readonly<Record<string, PresenceRow>>
  /** tracked zones' SEED populations by `world:zx:zz` — server-derived (zone_math twin), with
   *  consumption NOT applied: it changes only when a zone re-rolls. What is still standing is
   *  this crossed with the zone row's bitmaps — always read it through `live_spawns`. */
  spawns: Readonly<Record<string, Readonly<{ mobs: readonly MobGroupRow[]; resources: readonly ResourcePackRow[] }>>>
  /** live fights in the tracked zones by fight id — the sword markers render this slice */
  fights: Readonly<Record<string, FightRow>>
  /** reversible local prediction: hide the pressed group and plant the shared sword while its
   * transaction/projection is pending. Canonical zone/fight state still decides the outcome. */
  pending_engages: Readonly<Record<string, PendingEngage>>
  /** the right-clicked nearby player — the context menu renders while this holds a target */
  player_menu: PlayerMenu | null
}>

export type PendingEngage = Readonly<{
  group: string
  key: string
  index: number
  world: string
  x: number
  z: number
  members: readonly Readonly<{ mob_type: string; level_scalar: number }>[]
  started_at_ms: number
  fight: string | null
}>

/** WHERE the menu was opened from decides what it may offer: a duel needs the two characters
 *  standing together (the chain proves the walk to the fight cell), and a name clicked in the
 *  chat log proves nothing about distance. Only the menu opened ON a body is a duel door. */
export type PlayerMenu = Readonly<{
  character_id: string
  x: number
  y: number
  source: 'body' | 'chat'
}>

export type WorldInput =
  | Readonly<{ type: 'server/packet'; packet: Readonly<ServerPacket> }>
  | Readonly<{ type: 'world/player_menu'; menu: PlayerMenu | null }>
  /** search the zone the character is STANDING in — the chain proves the walk, so there is no
   *  cell to name here */
  | Readonly<{ type: 'world/search_zone' }>
  /** engage the mob group under the E prompt — `group` is a `mob_group_id` */
  | Readonly<{ type: 'world/engage'; group: string; started_at_ms: number }>
  | Readonly<{ type: 'world/engage_submitted'; group: string; fight: string }>
  | Readonly<{ type: 'world/engage_failed'; group: string }>
  | Readonly<{ type: 'world/engage_confirmed'; group: string }>
  /** gather the resource node under E — the ordinal is visual; its pack id is the chain key */
  | Readonly<{ type: 'world/gather'; node: string }>
  | Readonly<{ type: 'world/resolve_ambush' }>

export const zone_key = (world: string, zx: number, zz: number): string => `${world}:${zx}:${zz}`

/** A rendered mob group's id — the zone it belongs to plus the group's own chain index, which is
 *  also the bit it owns in `mob_taken` and the key the engage door takes. Minted and read in one
 *  place because three surfaces need the same string: the HUD marker, the engine's entity id,
 *  and the nametag that has to find its group again. */
export const mob_group_id = (key: string, seed: string, index: number): string => `${key}:s${seed}:m${index}`
export const resource_pack_id = (key: string, seed: string, index: number): string => `${key}:s${seed}:r${index}`

/** The inverse — `null` when the id is not a mob group's (a resource pack's, or anything else). */
export const parse_mob_group_id = (id: string): Readonly<{ key: string; index: number }> | null => {
  const cut = id.lastIndexOf(':m')
  const seed_cut = id.lastIndexOf(':s', cut)
  if (cut < 0 || seed_cut < 0) return null
  const index = Number(id.slice(cut + 2))
  return Number.isInteger(index) && index >= 0 ? { key: id.slice(0, seed_cut), index } : null
}

export const parse_resource_pack_id = (id: string): Readonly<{ key: string; index: number }> | null => {
  const cut = id.lastIndexOf(':r')
  const seed_cut = id.lastIndexOf(':s', cut)
  if (cut < 0 || seed_cut < 0) return null
  const index = Number(id.slice(cut + 2))
  return Number.isInteger(index) && index >= 0 ? { key: id.slice(0, seed_cut), index } : null
}

/** A world spawn the HUD can point at — CLIENT-space x/z. */
export type SpawnMarker = Readonly<{
  kind: 'mob' | 'resource'
  spawn_id: string
  x: number
  z: number
  zx: number
  zz: number
  /** mob groups only — how many stand in the pack */
  size?: number
  /** resource packs only — the authored row's identity; job, tier, protector and the rare link
   *  all hang off it in the bundled seed, which is their one home */
  item_type?: string
}>

const EMPTY_POPULATION = Object.freeze({ mobs: Object.freeze([]), resources: Object.freeze([]) })

/** THE LIVE POPULATION of one tracked zone: the seed's draw crossed with the zone's own
 *  consumption. Every surface that shows a zone's contents goes through here — the HUD markers,
 *  the world's rendered mobs and nodes, the interaction targets — so none of them can disagree
 *  about whether a group is still standing. An undiscovered or unpopulated zone is honestly
 *  empty rather than absent. */
export const live_spawns = (
  world: WorldState,
  key: string
): Readonly<{ mobs: readonly MobGroupRow[]; resources: readonly ResourcePackRow[] }> => {
  const population = world.spawns[key]
  const zone = world.zones[key]
  // a population with no zone row states nothing about consumption; the seed only reaches the
  // client alongside its row, so this is a torn moment, not "nothing has been taken"
  if (!population || !zone) return EMPTY_POPULATION
  return Object.freeze({
    mobs: live_mob_groups(population.mobs, zone).filter(
      ({ index }) => !(mob_group_id(key, zone.seed, index) in world.pending_engages)
    ),
    resources: live_resource_packs(population.resources, zone),
  })
}

/** Mob/resource spawn markers of the tracked zones, in CLIENT space — the LIVE population of
 *  each (the zone_math twin runs server-side, never here). */
export const spawn_markers = (world: WorldState): readonly SpawnMarker[] =>
  Object.keys(world.spawns).flatMap((key) => {
    const population = live_spawns(world, key)
    const seed = world.zones[key]?.seed
    if (!seed) return []
    const [, zx = '0', zz = '0'] = key.split(':')
    return [
      ...population.mobs.map((group) => ({
        kind: 'mob' as const,
        spawn_id: mob_group_id(key, seed, group.index),
        x: chain_to_client_coordinate(group.x),
        z: chain_to_client_coordinate(group.z),
        zx: Number(zx),
        zz: Number(zz),
        size: group.members.length,
      })),
      ...population.resources.map((pack) => ({
        kind: 'resource' as const,
        spawn_id: resource_pack_id(key, seed, pack.index),
        x: chain_to_client_coordinate(pack.x),
        z: chain_to_client_coordinate(pack.z),
        zx: Number(zx),
        zz: Number(zz),
        item_type: pack.item_type,
      })),
    ]
  })

export const initial_world_state = (): WorldState =>
  Object.freeze({
    windows: {},
    all_zones: {},
    all_players: {},
    all_spawns: {},
    all_fights: {},
    tracked_world: null,
    zones: {},
    players: {},
    spawns: {},
    fights: {},
    pending_engages: {},
    player_menu: null,
  })

const with_world = (state: AppState, world: WorldState): AppState => Object.freeze({ ...state, world })

const fold_union = (world: WorldState, packet: Readonly<ServerPacket>): WorldState => {
  if (packet.type === 'packet/zones') {
    // ONE door for "a zone changed": a spiral push, a discovery, and a group being engaged all
    // arrive as the projected row. It MERGES — the server sends one row for a single change.
    const incoming = packet.zones.map((zone) => [zone_key(zone.world, zone.zx, zone.zz), zone] as const)
    const rerolled = new Set(
      incoming.flatMap(([key, zone]) => (world.zones[key] && world.zones[key]!.seed !== zone.seed ? [key] : []))
    )
    const zones = { ...world.zones, ...Object.fromEntries(incoming) }
    const spawns = rerolled.size
      ? Object.fromEntries(Object.entries(world.spawns).filter(([key]) => !rerolled.has(key)))
      : world.spawns
    const pending_engages = Object.fromEntries(
      Object.entries(world.pending_engages).filter(([, pending]) => {
        const zone = zones[pending.key]
        const population = spawns[pending.key]
        return (
          !!zone && !!population && live_mob_groups(population.mobs, zone).some(({ index }) => index === pending.index)
        )
      })
    )
    return Object.freeze({
      ...world,
      zones: Object.freeze(zones),
      spawns: Object.freeze(spawns),
      pending_engages: Object.freeze(pending_engages),
    })
  }
  if (packet.type === 'packet/zone_spawns') {
    // the SEED's whole population, consumption unapplied — it arrives once per zone per seed,
    // and what of it is alive derives from the zone row above
    const key = zone_key(packet.world, packet.zx, packet.zz)
    return Object.freeze({
      ...world,
      spawns: Object.freeze({
        ...world.spawns,
        [key]: Object.freeze({ mobs: Object.freeze(packet.mobs), resources: Object.freeze(packet.resources) }),
      }),
    })
  }
  if (packet.type === 'packet/fights') {
    const fights = Object.fromEntries(packet.fights.map((fight) => [fight.id, fight]))
    return Object.freeze({ ...world, fights: Object.freeze({ ...world.fights, ...fights }) })
  }
  if (packet.type === 'packet/fight_created')
    // the projected row lands whole — this fold never fills a field the wire did not carry
    return Object.freeze({
      ...world,
      fights: Object.freeze({ ...world.fights, [packet.fight.id]: packet.fight }),
    })
  if (packet.type === 'packet/fight_phase') {
    const known = world.fights[packet.fight]
    if (!known) return world
    if (packet.phase === 'ended') {
      const fights = Object.fromEntries(Object.entries(world.fights).filter(([id]) => id !== packet.fight))
      return Object.freeze({ ...world, fights: Object.freeze(fights) })
    }
    return Object.freeze({
      ...world,
      fights: Object.freeze({ ...world.fights, [packet.fight]: Object.freeze({ ...known, phase: packet.phase }) }),
    })
  }
  if (packet.type === 'packet/player_appeared')
    return Object.freeze({
      ...world,
      players: Object.freeze({ ...world.players, [packet.player.character_id]: packet.player }),
    })
  if (packet.type === 'packet/player_moved') {
    const known = world.players[packet.character_id]
    if (!known) return world
    return Object.freeze({
      ...world,
      players: Object.freeze({
        ...world.players,
        [packet.character_id]: Object.freeze({
          ...known,
          x: packet.x,
          y: packet.y,
          z: packet.z,
          riding: packet.riding,
        }),
      }),
    })
  }
  if (packet.type === 'packet/player_equipment') {
    const known = world.players[packet.character_id]
    if (!known) return world
    return Object.freeze({
      ...world,
      players: Object.freeze({
        ...world.players,
        [packet.character_id]: Object.freeze({ ...known, [packet.slot]: packet.item_type }),
      }),
    })
  }
  if (packet.type === 'packet/player_left') {
    if (!(packet.character_id in world.players)) return world
    const players = Object.fromEntries(
      Object.entries(world.players).filter(([character_id]) => character_id !== packet.character_id)
    )
    return Object.freeze({
      ...world,
      players: Object.freeze(players),
      // a vanished target takes its menu with it
      player_menu: world.player_menu?.character_id === packet.character_id ? null : world.player_menu,
    })
  }
  return world
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_world(state, initial_world_state())
  if (input.type === 'character/select') return with_world(state, project_world_window(state.world, input.character_id))
  if (input.type === 'world/player_menu')
    return with_world(state, Object.freeze({ ...state.world, player_menu: input.menu }))
  if (input.type === 'world/engage') {
    const next = begin_pending_engage(state.world, input.group, input.started_at_ms, parse_mob_group_id(input.group))
    return next === state.world ? state : with_world(state, next)
  }
  if (input.type === 'world/engage_submitted') {
    const next = submit_pending_engage(state.world, input.group, input.fight)
    return next === state.world ? state : with_world(state, next)
  }
  if (input.type === 'world/engage_failed' || input.type === 'world/engage_confirmed') {
    const next = remove_pending_engage(state.world, input.group)
    return next === state.world ? state : with_world(state, next)
  }
  // these are EFFECTS, not state changes: what they produce comes back as chain truth
  if (input.type === 'world/search_zone' || input.type === 'world/gather' || input.type === 'world/resolve_ambush')
    return state
  if (input.type !== 'server/packet') return state
  if (input.packet.type === 'packet/characters')
    return with_world(
      state,
      retain_world_characters(
        state.world,
        new Set(input.packet.characters.map(({ id }) => id)),
        state.session.selected_character_id
      )
    )
  const next = fold_cached_world(state.world, input.packet, state.session.selected_character_id, fold_union)
  return next === state.world ? state : with_world(state, next)
}

// the no-op observe keeps the MODULES union uniform (chat.ts precedent)
/** Is the zone under this character still unsearched? The row's ABSENCE is the answer — the
 *  graph holds a zone only once a search drew its seed, so nothing is ever "present and empty".
 *  Out-of-bounds coordinates have no zone at all. */
export const searchable_zone = (state: AppState): Readonly<{ world: string; x: number; z: number }> | null => {
  const character = selected_character(state.session)
  const pose = read_pose()
  if (!character?.world || !pose) return null
  const x = Math.round(client_to_chain_coordinate(pose.x))
  const z = Math.round(client_to_chain_coordinate(pose.z))
  if (x < 0 || z < 0) return null
  const { zx, zz } = zone_of(x, z)
  return zone_key(character.world, zx, zz) in state.world.zones ? null : { world: character.world, x, z }
}

/** How long the world has to actually SHOW a searched zone before we call it a failure. The
 *  transaction is certified in a second or two; the row still has to be projected by the indexer
 *  and streamed by the server. Generous, because a slow answer is not a wrong one. */
const ZONE_ARRIVAL_TIMEOUT_MS = 30_000

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch }) => {
  /** the world transactions this tab has already fired, by their target's key. Neither door is
   *  instant, and the chain refuses neither for a repeat — a second search re-reads the same
   *  seed, a second engage aborts on a group already taken — so an unguarded double press
   *  only burns gas. Zone keys and group ids never collide (a group id ends in `:mN`). */
  const in_flight = new Set<string>()
  /** transactions whose projected result is not visible yet — zone rows and fight boards use
   * the same observed-delta completion rule. */
  const awaiting = new Map<
    string,
    Readonly<{ lock_key: string; notice: ReturnType<typeof toast.loading>; timer: number }>
  >()

  const settle = (key: string, finish: (pending: ReturnType<typeof toast.loading>) => void): void => {
    const pending = awaiting.get(key)
    if (!pending) return
    clearTimeout(pending.timer)
    awaiting.delete(key)
    // the press re-arms only now: a search stays "in flight" until its zone SHOWS UP, not until
    // its transaction lands. Re-searching inside the 2h TTL is a successful no-op on chain
    // (zone.move returns the same seed with `fresh: false`), so nothing would refuse the extra
    // presses — they would just burn gas while the player waits on a row that is already paid for
    in_flight.delete(pending.lock_key)
    finish(pending.notice)
  }

  events.on('world/search_zone', () => {
    const state = get_state()
    const { wallet, selected_character_id } = state.session
    const character = selected_character(state.session)
    const target = searchable_zone(state)
    if (!wallet || !selected_character_id || !character || !target) return
    const { zx, zz } = zone_of(target.x, target.z)
    const key = zone_key(target.world, zx, zz)
    if (in_flight.has(key)) return
    in_flight.add(key)
    const text = state.copy ? copy_text(state.copy.world_hud) : (value: string) => value
    const notice = toast.loading(text('zone_searching'))
    void wallet.character
      .search_zone({
        character_id: selected_character_id,
        world: target.world,
        x: target.x,
        z: target.z,
        custody: character_custody(character),
      })
      // The receipt proves submission, not the projected zone. Keep the notice pending until
      // the streamed row becomes visible; the stream may arrive before or after the receipt.
      .then(() => {
        awaiting.set(key, {
          lock_key: key,
          notice,
          timer: setTimeout(
            () => settle(key, (pending) => pending.error(new Error(text('zone_never_arrived')))),
            ZONE_ARRIVAL_TIMEOUT_MS
          ) as unknown as number,
        })
        // it may ALREADY be here — the stream can beat the receipt, and a fold that only ever
        // fires on the next delta would hang on the fast path
        settle_arrivals(get_state())
      })
      .catch((error: unknown) => {
        in_flight.delete(key)
        console.error('Zone search failed.', error)
        notice.error(error)
      })
  })

  /** THE ARRIVAL DOOR: a transaction is done when its projected result is visible. */
  const settle_arrivals = (state: AppState): void => {
    if (awaiting.size === 0) return
    const text = state.copy ? copy_text(state.copy.world_hud) : (value: string) => value
    for (const key of [...awaiting.keys()])
      if (key in state.world.zones)
        settle(key, (pending) => {
          play_procedural_cue('discovery')
          pending.success(text('zone_searched_toast'))
        })
      else if (state.fight.mounted && state.fight.checkpoint?.contract.id === key) {
        const pending = awaiting.get(key)
        if (pending) dispatch({ type: 'world/engage_confirmed', group: pending.lock_key })
        settle(key, (notice) => notice.dismiss())
      }
  }

  events.on('STATE_UPDATED', (state: AppState, previous: AppState) => {
    if (state.world.zones !== previous.world.zones || state.fight !== previous.fight) settle_arrivals(state)
  })

  // ENGAGE — one transaction opens the fight, seats our character in it, and adds every member
  // of the pack. Nothing mounts a board here: a SEAT IS THE MOUNT (fight.ts), so the board
  // appears off the seat the chain just gave us, exactly as it does for a duel.
  events.on('world/engage', ({ group }) => {
    const state = get_state()
    const { wallet, selected_character_id } = state.session
    const found = parse_mob_group_id(group)
    const character = selected_character(state.session)
    if (!wallet || !selected_character_id || !found || !character?.world) {
      dispatch({ type: 'world/engage_failed', group })
      return
    }
    if (in_flight.has(group)) return
    const pending_engage = state.world.pending_engages[group]
    // the pack is already gone — somebody engaged it first, and the bit that says so has landed
    if (!pending_engage) return
    const [, zx = '0', zz = '0'] = found.key.split(':')
    in_flight.add(group)
    const text = state.copy ? copy_text(state.copy.world_hud) : (value: string) => value
    const notice = toast.loading(text('spawn_engaging'))
    void wallet.fight
      .engage({
        character_id: selected_character_id,
        custody: character_custody(character),
        world: character.world,
        zx: Number(zx),
        zz: Number(zz),
        group_index: found.index,
        // the ROSTER the chain will seat, in the order it drew it — the members are the fight
        mob_types: pending_engage.members.map(({ mob_type }) => mob_type),
      })
      .then(({ fight }) => {
        dispatch({ type: 'world/engage_submitted', group, fight })
        awaiting.set(fight, {
          lock_key: group,
          notice,
          timer: setTimeout(
            () => settle(fight, (pending) => pending.error(new Error(text('spawn_never_arrived')))),
            ZONE_ARRIVAL_TIMEOUT_MS
          ) as unknown as number,
        })
        settle_arrivals(get_state())
      })
      .catch((error: unknown) => {
        in_flight.delete(group)
        dispatch({ type: 'world/engage_failed', group })
        console.error('Mob engagement failed.', error)
        notice.error(error)
      })
  })

  events.on('world/gather', ({ node }) => {
    const state = get_state()
    const { wallet, selected_character_id } = state.session
    const character = selected_character(state.session)
    const node_id = parse_resource_node_id(node)
    const found = node_id ? parse_resource_pack_id(node_id.pack_id) : null
    if (!wallet || !selected_character_id || !character?.world || !found || in_flight.has(node_id!.pack_id)) return
    const pack = live_spawns(state.world, found.key).resources.find(({ index }) => index === found.index)
    const resource = pack
      ? content_catalog.world(character.world)?.resources.find(({ item_type }) => item_type === pack.item_type)
      : null
    if (!pack || !resource || !gather_gate(character, resource).ok) return
    const [, zx = '0', zz = '0'] = found.key.split(':')
    const existing = stack_merge_target(
      state.session.inventory,
      state.marketplace.own_listings,
      pack.item_type,
      character.kiosk
    )
    const rare_item_type = resource.rare_item_type || null
    const existing_rare = rare_item_type
      ? stack_merge_target(state.session.inventory, state.marketplace.own_listings, rare_item_type, character.kiosk)
      : null
    in_flight.add(node_id!.pack_id)
    const text = state.copy ? copy_text(state.copy.world_hud) : (value: string) => value
    const notice = toast.loading(text('resource_gathering'))
    void wallet.character
      .gather({
        character_id: selected_character_id,
        world: character.world,
        zx: Number(zx),
        zz: Number(zz),
        pack_index: found.index,
        item_type: pack.item_type,
        rare_item_type,
        existing,
        existing_rare,
        custody: character_custody(character),
      })
      .then(({ ambushed }) => {
        play_procedural_cue('gather')
        notice.success(text(ambushed ? 'resource_ambushed' : 'resource_gathered'))
      })
      .catch((error: unknown) => {
        console.error('Resource gathering failed.', error)
        notice.error(error)
      })
      .finally(() => in_flight.delete(node_id!.pack_id))
  })

  events.on('world/resolve_ambush', () => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    if (!wallet || !character?.ambush) return
    const key = `ambush:${character.id}`
    if (in_flight.has(key)) return
    in_flight.add(key)
    const text = state.copy ? copy_text(state.copy.world_hud) : (value: string) => value
    const notice = toast.loading(text('resource_resolving_ambush'))
    void wallet.character
      .resolve_ambush({
        character_id: character.id,
        protector_mob_type: character.ambush.protector,
        custody: character_custody(character),
      })
      .then(() => notice.dismiss())
      .catch((error: unknown) => {
        console.error('Resource ambush resolution failed.', error)
        notice.error(error)
      })
      .finally(() => in_flight.delete(key))
  })
}

export default Object.freeze({ name: 'world', reduce, observe }) satisfies AppModule
