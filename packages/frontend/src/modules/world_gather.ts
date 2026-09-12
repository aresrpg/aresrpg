// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gathering's client boundary: mirror the chain root, suppress doomed repeats, and project the
// receipt's exact reward. World population remains in world.ts; this module owns the
// characters' in-progress harvests. Selection changes presentation, never ownership.

import { gather_time_ms, job_level_from_xp } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import { item_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import { play_procedural_cue } from '../game/audio/procedural_cues.ts'
import { gather_gate } from '../game/gather_gate.ts'
import { parse_resource_node_id } from '../game/resource_nodes.ts'
import { copy_text } from '../i18n/copy.ts'
import { encumbered_asset_ids, stack_merge_target } from '../inventory_stacks.ts'
import type { AppContext, AppState } from '../store.ts'
import { toast } from '../toast.ts'

import { character_custody, selected_character } from './session.ts'
import { live_spawns, parse_resource_pack_id } from './world_spawns.ts'
import { world_action_failure } from './world_action_failure.ts'

export type PendingGather = Readonly<{
  attempt_id: string
  character_id: string
  item_type: string
  protector: string
  started_at_ms: number
  duration_ms: number
  ends_at_ms: number
  confirmed: boolean
  authoritative: boolean
  ambushed: boolean
  quantity: number | null
}>

export type WorldGatherInput =
  | Readonly<{ type: 'world/gather'; node: string }>
  | Readonly<{ type: 'world/gather_started'; gathering: PendingGather }>
  | Readonly<{
      type: 'world/gather_confirmed'
      attempt_id: string
      character_id: string
      fallback_ends_at_ms: number
      ambushed: boolean
      quantity: number
    }>
  | Readonly<{ type: 'world/gather_failed'; character_id: string; attempt_id: string; retry_at_ms?: number }>
  | Readonly<{ type: 'world/gather_finished'; character_id: string; attempt_id: string; ends_at_ms: number }>
  | Readonly<{ type: 'world/resolve_ambush'; character_id: string }>
  | Readonly<{ type: 'world/ambush_resolved'; character_id: string; attempt_id: string | null; fight: string }>
  | Readonly<{ type: 'world/ambush_failed'; character_id: string; attempt_id: string | null }>

export type Gatherings = Readonly<Record<string, PendingGather>>
export const selected_gathering = (state: Readonly<Pick<AppState, 'world' | 'session'>>): PendingGather | null =>
  state.world.gathering[state.session.selected_character_id ?? ''] ?? null

const world_ambush = (state: Readonly<AppState>, character_id: string | null): string | null => {
  const character = state.session.characters.find(({ id }) => id === character_id)
  if (!character) return null
  if (character.ambush) return character.ambush.protector
  const gathering = state.world.gathering[character.id]
  return gathering?.character_id === character.id && gathering.ambushed ? gathering.protector : null
}

export const selected_world_ambush = (state: Readonly<AppState>): string | null =>
  world_ambush(state, state.session.selected_character_id)

export const selected_world_action_lock = (
  state: Readonly<AppState>
): Readonly<{ character_id: string; animation: 'gather' | null }> | null => {
  const character = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!character) return null
  const gathering = selected_gathering(state)
  if (gathering) return Object.freeze({ character_id: character.id, animation: gathering.ambushed ? null : 'gather' })
  if (character.dungeon_run) return Object.freeze({ character_id: character.id, animation: null })
  return character.ambush ? Object.freeze({ character_id: character.id, animation: null }) : null
}

export const gather_state_input = (
  input: Readonly<{ type: string }>
): input is Extract<WorldGatherInput, { type: `world/gather_${string}` }> => input.type.startsWith('world/gather_')

export const reduce_gathering = (
  gathering: Readonly<PendingGather> | null,
  input: Extract<WorldGatherInput, { type: `world/gather_${string}` }>
): PendingGather | null => {
  if (input.type === 'world/gather_started') return input.gathering
  if (!gathering || gathering.attempt_id !== input.attempt_id) return gathering
  if (input.type === 'world/gather_failed') return null
  if (input.type === 'world/gather_finished') return gathering.ends_at_ms === input.ends_at_ms ? null : gathering
  return Object.freeze({
    ...gathering,
    confirmed: true,
    ambushed: input.ambushed,
    quantity: input.quantity,
    ends_at_ms: gathering.authoritative
      ? gathering.ends_at_ms
      : Math.max(gathering.ends_at_ms, input.fallback_ends_at_ms),
  })
}

export const reduce_gatherings = (
  rows: Gatherings,
  input: Extract<WorldGatherInput, { type: `world/gather_${string}` }>
): Gatherings => {
  const id = input.type === 'world/gather_started' ? input.gathering.character_id : input.character_id
  const previous = rows[id] ?? null
  if (input.type === 'world/gather_started' && previous) return rows
  const next = reduce_gathering(previous, input)
  if (next === previous) return rows
  return Object.freeze(
    next ? { ...rows, [id]: next } : Object.fromEntries(Object.entries(rows).filter(([key]) => key !== id))
  )
}

export const gather_completion_ready = (gathering: Readonly<PendingGather>, now_ms: number): boolean =>
  gathering.confirmed && gathering.quantity !== null && (gathering.ambushed || now_ms >= gathering.ends_at_ms)

export const automatic_ambush_input = (
  gathering: Readonly<PendingGather> | null
): Extract<WorldGatherInput, { type: 'world/resolve_ambush' }> | null =>
  gathering?.confirmed && gathering.ambushed && gathering.quantity !== null
    ? Object.freeze({ type: 'world/resolve_ambush', character_id: gathering.character_id })
    : null

export const gathering_from_characters = (
  gathering: Readonly<PendingGather> | null,
  characters: readonly Readonly<CharacterRow>[]
): PendingGather | null => {
  if (!gathering) return null
  const character = characters.find(({ id }) => id === gathering.character_id)
  if (!character) return null
  if (character.ambush) return Object.freeze({ ...gathering, ambushed: true })
  return character.at_ms !== undefined && character.at_ms > gathering.started_at_ms
    ? Object.freeze({ ...gathering, ends_at_ms: character.at_ms, authoritative: true })
    : gathering
}

export const gatherings_from_characters = (
  rows: Gatherings,
  characters: readonly Readonly<CharacterRow>[]
): Gatherings =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(rows).flatMap(([id, gathering]) => {
        const next = gathering_from_characters(gathering, characters)
        return next ? [[id, next]] : []
      })
    )
  )

export const observe_world_gather = ({ events, get_state, dispatch, signal }: AppContext): void => {
  const in_flight = new Set<string>()
  const notices = new Map<string, ReturnType<typeof toast.loading>>()
  const gather_timers = new Map<string, ReturnType<typeof setTimeout>>()

  const complete_gather = (gathering: Readonly<PendingGather>): void => {
    const current = get_state().world.gathering[gathering.character_id]
    if (
      !current ||
      current.attempt_id !== gathering.attempt_id ||
      current.ends_at_ms !== gathering.ends_at_ms ||
      !gather_completion_ready(current, Date.now())
    )
      return
    // State completion is independent of audio and toast lifetimes.
    if (!current.ambushed)
      dispatch({
        type: 'world/gather_finished',
        character_id: current.character_id,
        attempt_id: current.attempt_id,
        ends_at_ms: current.ends_at_ms,
      })
    const notice = notices.get(current.attempt_id)
    notices.delete(current.attempt_id)
    if (!notice || current.quantity === null) return
    const state = get_state()
    const text = state.copy ? copy_text(state.copy.world_hud) : (value: string) => value
    const item_name = content_catalog.item(current.item_type)?.item.name ?? current.item_type
    play_procedural_cue('gather')
    notice.success(
      text(current.ambushed ? 'resource_gathered_amount_ambushed' : 'resource_gathered_amount', {
        quantity: current.quantity,
        name: item_name,
      }),
      item_icon(current.item_type) ?? undefined
    )
  }

  const schedule_gather = (gathering: PendingGather): void => {
    if (signal.aborted || !gathering.confirmed || gathering.quantity === null) return
    const automatic = automatic_ambush_input(gathering)
    if (automatic) dispatch(automatic)
    if (gather_completion_ready(gathering, Date.now())) complete_gather(gathering)
    else
      gather_timers.set(
        gathering.attempt_id,
        setTimeout(
          () => {
            const current = get_state().world.gathering[gathering.character_id]
            if (current?.attempt_id === gathering.attempt_id) schedule_gather(current)
          },
          Math.max(1, gathering.ends_at_ms - Date.now())
        )
      )
  }

  const sync_gathers = (): void => {
    gather_timers.forEach(clearTimeout)
    gather_timers.clear()
    Object.values(get_state().world.gathering).forEach(schedule_gather)
  }

  events.on('world/gather', ({ node }) => {
    const state = get_state()
    const { wallet, selected_character_id } = state.session
    const character = selected_character(state.session)
    const node_id = parse_resource_node_id(node)
    const found = node_id ? parse_resource_pack_id(node_id.pack_id) : null
    if (
      !wallet ||
      !selected_character_id ||
      !character?.world ||
      !found ||
      state.world.gathering[selected_character_id] ||
      in_flight.has(node_id!.pack_id)
    )
      return
    const pack = live_spawns(state.world, found.key).resources.find(({ index }) => index === found.index)
    const resource = pack
      ? content_catalog.world(character.world)?.resources.find(({ item_type }) => item_type === pack.item_type)
      : null
    if (!pack || !resource || !gather_gate(character, resource).ok) return
    const [, zx = '0', zz = '0'] = found.key.split(':')
    const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
    const existing = stack_merge_target(state.session.inventory, encumbered, pack.item_type, character.kiosk)
    const rare_item_type = resource.rare_item_type || null
    const existing_rare = rare_item_type
      ? stack_merge_target(state.session.inventory, encumbered, rare_item_type, character.kiosk)
      : null
    const job_level = job_level_from_xp(Number(character.jobs[resource.job] ?? 0))
    const duration_ms = gather_time_ms(job_level)
    const started_at_ms = Date.now()
    const attempt_id = crypto.randomUUID()
    dispatch({
      type: 'world/gather_started',
      gathering: Object.freeze({
        attempt_id,
        character_id: selected_character_id,
        item_type: pack.item_type,
        protector: resource.protector,
        started_at_ms,
        duration_ms,
        ends_at_ms: started_at_ms + duration_ms,
        confirmed: false,
        authoritative: false,
        ambushed: false,
        quantity: null,
      }),
    })
    in_flight.add(node_id!.pack_id)
    const text = state.copy ? copy_text(state.copy.world_hud) : (value: string) => value
    const notice = toast.loading(text('resource_gathering'))
    notices.set(attempt_id, notice)
    const is_current = (): boolean => {
      const current =
        get_state().session.wallet === wallet &&
        get_state().world.gathering[selected_character_id]?.attempt_id === attempt_id
      if (!current) {
        notice.dismiss()
        notices.delete(attempt_id)
      }
      return current
    }
    void wallet.character
      .gather({
        character_id: selected_character_id,
        world: character.world,
        zone_x: Number(zx),
        zone_z: Number(zz),
        pack_index: found.index,
        item_type: pack.item_type,
        rare_item_type,
        existing,
        existing_rare,
        custody: character_custody(character),
      })
      .then(({ ambushed, quantity }) => {
        // Release before publishing completion: an elapsed root can permit the next harvest now.
        in_flight.delete(node_id!.pack_id)
        if (!is_current()) return
        dispatch({
          type: 'world/gather_confirmed',
          attempt_id,
          character_id: selected_character_id,
          fallback_ends_at_ms: Date.now() + duration_ms,
          ambushed,
          quantity,
        })
      })
      .catch((error: unknown) => {
        in_flight.delete(node_id!.pack_id)
        if (!is_current()) return
        dispatch({
          type: 'world/gather_failed',
          character_id: selected_character_id,
          attempt_id,
          ...world_action_failure(error, performance.now()),
        })
        notices.delete(attempt_id)
        console.error('Resource gathering failed.', error)
        notice.error(error)
      })
  })

  events.on('STATE_UPDATED', (state, previous) => {
    if (state.world.gathering !== previous.world.gathering) sync_gathers()
    state.session.characters.forEach((character) => {
      const before = previous.session.characters.find(({ id }) => id === character.id)
      if (character.ambush && character.ambush.board_seed !== before?.ambush?.board_seed)
        dispatch({ type: 'world/resolve_ambush', character_id: character.id })
    })
  })

  events.on('world/resolve_ambush', ({ character_id }) => {
    const state = get_state()
    const character = state.session.characters.find(({ id }) => id === character_id)
    const gathering = state.world.gathering[character_id]
    const ambush = world_ambush(state, character_id)
    const { wallet } = state.session
    if (!wallet || !character || !ambush) return
    const key = `ambush:${character.id}`
    if (in_flight.has(key)) return
    in_flight.add(key)
    const text = state.copy ? copy_text(state.copy.world_hud) : (value: string) => value
    const notice = toast.loading(text('resource_resolving_ambush'))
    void wallet.character
      .resolve_ambush({
        character_id: character.id,
        protector_mob_type: ambush,
        custody: character_custody(character),
      })
      .then(({ fight }) => {
        if (get_state().session.wallet !== wallet) return
        notice.dismiss()
        dispatch({ type: 'world/ambush_resolved', character_id, attempt_id: gathering?.attempt_id ?? null, fight })
        dispatch({ type: 'fight/watch', character_id: character.id, fight })
        const current = get_state().world.gathering[character.id]
        if (current && current.attempt_id === gathering?.attempt_id)
          dispatch({
            type: 'world/gather_finished',
            character_id: character.id,
            attempt_id: current.attempt_id,
            ends_at_ms: current.ends_at_ms,
          })
      })
      .catch((error: unknown) => {
        console.error('Resource ambush resolution failed.', error)
        if (get_state().session.wallet === wallet)
          dispatch({ type: 'world/ambush_failed', character_id, attempt_id: gathering?.attempt_id ?? null })
        notice.error(error)
      })
      .finally(() => in_flight.delete(key))
  })

  sync_gathers()
  get_state().session.characters.forEach((character) => {
    if (character.ambush) dispatch({ type: 'world/resolve_ambush', character_id: character.id })
  })

  signal.addEventListener('abort', () => {
    gather_timers.forEach(clearTimeout)
    gather_timers.clear()
    notices.forEach((notice) => notice.dismiss())
    notices.clear()
  })
}
