// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The world's server-streamed surroundings; one reducer feeds the compass and minimap.

import { chain_to_client_coordinate, client_to_chain_coordinate, world_size } from '@aresrpg/immutable'
import {
  live_mob_groups,
  live_resource_packs,
  travel_proof_ready,
  ZONE_RESEARCH_TTL_MS,
  zone_of,
  type FightRow,
  type DungeonPortalRow,
  type MobGroupRow,
  type PresenceRow,
  type ResourcePackRow,
  type ServerPacket,
  type ZoneRow,
} from '@aresrpg/protocol'

import { copy_text } from '../i18n/copy.ts'
import { read_pose } from '../game/core/pose_feed.ts'
import { play_procedural_cue } from '../game/audio/procedural_cues.ts'
import { toast } from '../toast.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

import { character_custody, selected_character } from './session.ts'
import {
  begin_pending_engage,
  engage_conflict_refusal,
  new_pending_engages,
  remove_pending_engage,
  submit_pending_engage,
} from './world_engage.ts'
import { fold_cached_world, project_world_window, retain_world_characters } from './world_cache.ts'
import {
  gather_state_input,
  gathering_from_characters,
  observe_world_gather,
  reduce_gathering,
  type PendingGather,
  type WorldGatherInput,
} from './world_gather.ts'
import {
  dungeon_portal_markers,
  live_spawns,
  mob_group_id,
  parse_mob_group_id,
  parse_resource_pack_id,
} from './world_spawns.ts'
export {
  mob_group_id,
  resource_pack_id,
  parse_mob_group_id,
  parse_resource_pack_id,
  live_spawns,
  spawn_markers,
  dungeon_portal_markers,
  type SpawnMarker,
  type DungeonPortalMarker,
} from './world_spawns.ts'

export { engage_sword_markers } from './world_engage.ts'

export type WorldState = Readonly<{
  windows: Readonly<Record<string, Readonly<{ world: string; zones: readonly { zx: number; zz: number }[] }>>>
  all_zones: Readonly<Record<string, ZoneRow>>
  all_players: Readonly<Record<string, PresenceRow>>
  all_spawns: Readonly<Record<string, ZonePopulation>>
  all_fights: Readonly<Record<string, FightRow>>
  tracked_world: string | null
  /** searched zones by `world:zx:zz` — presence of a row means DISCOVERED (seed drawn) */
  zones: Readonly<Record<string, ZoneRow>>
  players: Readonly<Record<string, PresenceRow>>
  /** tracked zones' SEED populations by `world:zx:zz` — server-derived (zone_math twin), with
   *  consumption NOT applied: it changes only when a zone re-rolls. What is still standing is
   *  this crossed with the zone row's bitmaps — always read it through `live_spawns`. */
  spawns: Readonly<Record<string, ZonePopulation>>
  fights: Readonly<Record<string, FightRow>>
  pending_engages: Readonly<Record<string, PendingEngage>>
  pending_zone_searches: Readonly<Record<string, true>>
  player_menu: PlayerMenu | null
  /** Optimistic immediately, then corrected to the chain checkpoint's future timestamp. */
  gathering: PendingGather | null
  zone_reveal: ZoneReveal | null
}>

export type ZoneReveal = Readonly<{
  id: string
  zx: number
  zz: number
  mobs: number
  resources: number
  dungeon: boolean
}>

export type ZonePopulation = Readonly<{
  mobs: readonly MobGroupRow[]
  resources: readonly ResourcePackRow[]
  portal: DungeonPortalRow | null
}>

export type { PendingGather } from './world_gather.ts'

export type PendingEngage = Readonly<{
  group: string
  key: string
  index: number
  world: string
  x: number
  z: number
  members: readonly Readonly<{ mob_type: string; level_scalar: number }>[]
  started_at_ms: number
  access: 0 | 1
  fight: string | null
}>

/** Only a menu opened on a nearby body may offer a distance-proven duel. */
export type PlayerMenu = Readonly<{
  character_id: string
  name?: string
  owner?: string
  x: number
  y: number
  source: 'body' | 'chat' | 'party'
}>

export type WorldInput =
  | Readonly<{ type: 'server/packet'; packet: Readonly<ServerPacket> }>
  | Readonly<{ type: 'world/player_menu'; menu: PlayerMenu | null }>
  /** search the zone the character is standing in; the chain proves the walk */
  | Readonly<{ type: 'world/search_zone'; target: ZoneSearchTarget }>
  | Readonly<{ type: 'world/search_zone_failed'; key: string }>
  | Readonly<{ type: 'world/search_zone_confirmed'; key: string }>
  | Readonly<{ type: 'world/zone_revealed'; reveal: ZoneReveal }>
  | Readonly<{ type: 'world/zone_reveal_cleared'; id: string }>
  /** engage the mob group under the E prompt — `group` is a `mob_group_id` */
  | Readonly<{ type: 'world/engage'; group: string; access: 0 | 1; started_at_ms: number }>
  | Readonly<{ type: 'world/engage_submitted'; group: string; fight: string; character_id: string }>
  | Readonly<{ type: 'world/engage_failed'; group: string }>
  | Readonly<{ type: 'world/engage_confirmed'; group: string }>
  | WorldGatherInput

export const zone_key = (world: string, zx: number, zz: number): string => `${world}:${zx}:${zz}`

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
    pending_zone_searches: {},
    player_menu: null,
    gathering: null,
    zone_reveal: null,
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
        [key]: Object.freeze({
          mobs: Object.freeze(packet.mobs),
          resources: Object.freeze(packet.resources),
          portal: packet.portal ? Object.freeze(packet.portal) : null,
        }),
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
  if (input.type === 'world/search_zone')
    return state.world.pending_zone_searches[input.target.key]
      ? state
      : with_world(
          state,
          Object.freeze({
            ...state.world,
            pending_zone_searches: Object.freeze({ ...state.world.pending_zone_searches, [input.target.key]: true }),
          })
        )
  if (input.type === 'world/search_zone_failed' || input.type === 'world/search_zone_confirmed') {
    if (!state.world.pending_zone_searches[input.key]) return state
    return with_world(
      state,
      Object.freeze({
        ...state.world,
        pending_zone_searches: Object.freeze(
          Object.fromEntries(Object.entries(state.world.pending_zone_searches).filter(([key]) => key !== input.key))
        ),
      })
    )
  }
  if (input.type === 'world/zone_revealed')
    return with_world(state, Object.freeze({ ...state.world, zone_reveal: input.reveal }))
  if (input.type === 'world/zone_reveal_cleared' && state.world.zone_reveal?.id === input.id)
    return with_world(state, Object.freeze({ ...state.world, zone_reveal: null }))
  if (input.type === 'world/engage') {
    const next = begin_pending_engage(
      state.world,
      input.group,
      input.access,
      input.started_at_ms,
      parse_mob_group_id(input.group)
    )
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
  if (gather_state_input(input)) {
    const gathering = reduce_gathering(state.world.gathering, input)
    return gathering === state.world.gathering ? state : with_world(state, Object.freeze({ ...state.world, gathering }))
  }
  // these are EFFECTS, not state changes: what they produce comes back as chain truth
  if (input.type === 'world/gather' || input.type === 'world/resolve_ambush') return state
  if (input.type !== 'server/packet') return state
  if (input.packet.type === 'packet/characters') {
    const retained = retain_world_characters(
      state.world,
      new Set(input.packet.characters.map(({ id }) => id)),
      state.session.selected_character_id
    )
    const reconciled = gathering_from_characters(retained.gathering, input.packet.characters)
    return with_world(state, Object.freeze({ ...retained, gathering: reconciled }))
  }
  const next = fold_cached_world(state.world, input.packet, state.session.selected_character_id, fold_union)
  return next === state.world ? state : with_world(state, next)
}

// the no-op observe keeps the MODULES union uniform (chat.ts precedent)
/** The chain search door has two useful states: a missing row discovers, while an expired row
 * rerolls. A fresh row is a successful no-op on chain, so the UI suppresses that gas burn. */
export type ZoneSearchTarget = Readonly<{
  key: string
  world: string
  x: number
  z: number
  kind: 'discover' | 'reroll'
  previous_searched_at_ms: number | null
}>

export const searchable_zone = (state: AppState, observed_at_ms = Date.now()): ZoneSearchTarget | null => {
  const character = selected_character(state.session)
  const pose = read_pose()
  if (!character?.world || !pose) return null
  const x = Math.round(client_to_chain_coordinate(pose.x))
  const z = Math.round(client_to_chain_coordinate(pose.z))
  if (x < 0 || z < 0 || x >= world_size || z >= world_size) return null
  const { checkpoint_world, x: from_x, z: from_z, at_ms: from_ms } = character
  if (checkpoint_world !== character.world || from_x === undefined || from_z === undefined || from_ms === undefined)
    return null
  if (
    !travel_proof_ready({
      from_x,
      from_z,
      from_ms,
      pet_at_start: character.pet === true,
      to_x: x,
      to_z: z,
      now_ms: observed_at_ms,
      pet_now: character.equipment.some(({ slot }) => slot === 'pet'),
    })
  )
    return null
  const { zx, zz } = zone_of(x, z)
  const key = zone_key(character.world, zx, zz)
  if (state.world.pending_zone_searches[key]) return null
  const existing = state.world.zones[key] ?? null
  if (existing && observed_at_ms < existing.searched_at_ms + ZONE_RESEARCH_TTL_MS) return null
  return Object.freeze({
    key,
    world: character.world,
    x,
    z,
    kind: existing ? 'reroll' : 'discover',
    previous_searched_at_ms: existing?.searched_at_ms ?? null,
  })
}

export const zone_search_arrived = (
  zone: Readonly<ZoneRow> | undefined,
  previous_searched_at_ms: number | null
): boolean => !!zone && (previous_searched_at_ms === null || zone.searched_at_ms > previous_searched_at_ms)

export const zone_discovery_arrived = (
  zone: Readonly<ZoneRow> | undefined,
  population: Readonly<ZonePopulation> | undefined,
  previous_searched_at_ms: number | null
): population is Readonly<ZonePopulation> =>
  zone_search_arrived(zone, previous_searched_at_ms) && population !== undefined

export const zone_discovery_summary = (
  population: Readonly<ZonePopulation>
): Readonly<{ mobs: number; resources: number; dungeon: boolean }> =>
  Object.freeze({
    mobs: population.mobs.reduce((total, group) => total + group.members.length, 0),
    resources: population.resources.reduce((total, pack) => total + pack.nodes, 0),
    dungeon: population.portal !== null,
  })

/** How long the world has to actually SHOW a searched zone before we call it a failure. The
 *  transaction is certified in a second or two; the row still has to be projected by the indexer
 *  and streamed by the server. Generous, because a slow answer is not a wrong one. */
const ZONE_ARRIVAL_TIMEOUT_MS = 30_000

const observe: NonNullable<AppModule['observe']> = (context) => {
  const { events, get_state, dispatch } = context
  /** the world transactions this tab has already fired, by their target's key. Neither door is
   *  instant, and the chain refuses neither for a repeat — a second search re-reads the same
   *  seed, a second engage aborts on a group already taken — so an unguarded double press
   *  only burns gas. Zone keys and group ids never collide (a group id ends in `:mN`). */
  const in_flight = new Set<string>()
  observe_world_gather(context)
  let reveal_timer: ReturnType<typeof setTimeout> | null = null
  /** transactions whose projected result is not visible yet — zone rows and fight boards use
   * the same observed-delta completion rule. */
  const awaiting = new Map<
    string,
    Readonly<{
      lock_key: string
      notice: ReturnType<typeof toast.loading>
      timer: number
      previous_searched_at_ms: number | null
    }>
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

  events.on('world/search_zone', ({ target }) => {
    const state = get_state()
    const { wallet, selected_character_id } = state.session
    const character = selected_character(state.session)
    const { key } = target
    if (!wallet || !selected_character_id || !character || character.world !== target.world || in_flight.has(key)) {
      dispatch({ type: 'world/search_zone_failed', key })
      return
    }
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
          previous_searched_at_ms: target.previous_searched_at_ms,
          timer: setTimeout(() => {
            settle(key, (pending) => pending.error(new Error(text('zone_never_arrived'))))
            dispatch({ type: 'world/search_zone_failed', key })
          }, ZONE_ARRIVAL_TIMEOUT_MS) as unknown as number,
        })
        // it may ALREADY be here — the stream can beat the receipt, and a fold that only ever
        // fires on the next delta would hang on the fast path
        settle_arrivals(get_state())
      })
      .catch((error: unknown) => {
        in_flight.delete(key)
        dispatch({ type: 'world/search_zone_failed', key })
        console.error('Zone search failed.', error)
        notice.error(error)
      })
  })

  /** THE ARRIVAL DOOR: a transaction is done when its projected result is visible. */
  const settle_arrivals = (state: AppState): void => {
    if (awaiting.size === 0) return
    for (const [key, awaited] of awaiting) {
      const population = state.world.spawns[key]
      if (zone_discovery_arrived(state.world.zones[key], population, awaited.previous_searched_at_ms)) {
        const summary = zone_discovery_summary(population)
        const zone = state.world.zones[key]!
        const reveal = Object.freeze({
          id: `${key}:${zone.seed}:${zone.searched_at_ms}`,
          zx: zone.zx,
          zz: zone.zz,
          ...summary,
        })
        settle(key, (pending) => {
          play_procedural_cue('discovery')
          pending.dismiss()
        })
        dispatch({ type: 'world/zone_revealed', reveal })
        if (reveal_timer) clearTimeout(reveal_timer)
        reveal_timer = setTimeout(() => dispatch({ type: 'world/zone_reveal_cleared', id: reveal.id }), 2_500)
        dispatch({ type: 'world/search_zone_confirmed', key })
      } else if (state.fight.mounted && state.fight.checkpoint?.contract.id === key) {
        const pending = awaiting.get(key)
        if (pending) dispatch({ type: 'world/engage_confirmed', group: pending.lock_key })
        settle(key, (notice) => notice.dismiss())
      }
    }
  }

  // One newly-pending state row opens one transaction; repeats produce no delta.
  const submit_engage = (state: AppState, pending_engage: PendingEngage): void => {
    const { group } = pending_engage
    const { wallet, selected_character_id } = state.session
    const character = selected_character(state.session)
    if (!wallet || !selected_character_id || !character?.world) {
      dispatch({ type: 'world/engage_failed', group })
      return
    }
    if (in_flight.has(group)) return
    const [, zx = '0', zz = '0'] = pending_engage.key.split(':')
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
        group_index: pending_engage.index,
        access: pending_engage.access,
        // the ROSTER the chain will seat, in the order it drew it — the members are the fight
        mob_types: pending_engage.members.map(({ mob_type }) => mob_type),
      })
      .then(({ fight }) => {
        dispatch({ type: 'world/engage_submitted', group, fight, character_id: selected_character_id })
        awaiting.set(fight, {
          lock_key: group,
          notice,
          previous_searched_at_ms: null,
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
        notice.error(engage_conflict_refusal(error) ? new Error(text('spawn_engage_conflict')) : error)
      })
  }

  events.on('STATE_UPDATED', (state: AppState, previous: AppState) => {
    if (
      state.world.zones !== previous.world.zones ||
      state.world.spawns !== previous.world.spawns ||
      state.fight !== previous.fight
    )
      settle_arrivals(state)
    new_pending_engages(state.world, previous.world).forEach((pending) => submit_engage(state, pending))
  })
  context.signal.addEventListener('abort', () => {
    if (reveal_timer) clearTimeout(reveal_timer)
    reveal_timer = null
  })
}

export default Object.freeze({ name: 'world', reduce, observe }) satisfies AppModule
