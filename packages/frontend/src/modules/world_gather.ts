// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gathering's client boundary: mirror the chain root, suppress doomed repeats, and project the
// receipt's exact reward. World population remains in world.ts; this module owns only the one
// selected character's in-progress harvest.

import { gather_time_ms, job_level_from_xp } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import { item_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import { play_procedural_cue } from '../game/audio/procedural_cues.ts'
import { gather_gate } from '../game/gather_gate.ts'
import { parse_resource_node_id } from '../game/resource_nodes.ts'
import { copy_text } from '../i18n/copy.ts'
import { stack_merge_target } from '../inventory_stacks.ts'
import type { AppContext, AppState } from '../store.ts'
import { toast } from '../toast.ts'

import { character_custody, selected_character } from './session.ts'
import { live_spawns, parse_resource_pack_id } from './world_spawns.ts'

export type PendingGather = Readonly<{
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
      character_id: string
      fallback_ends_at_ms: number
      ambushed: boolean
      quantity: number
    }>
  | Readonly<{ type: 'world/gather_failed'; character_id: string }>
  | Readonly<{ type: 'world/gather_finished'; character_id: string; ends_at_ms: number }>
  | Readonly<{ type: 'world/resolve_ambush' }>

export const selected_world_ambush = (state: Readonly<AppState>): string | null => {
  const character = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!character) return null
  if (character.ambush) return character.ambush.protector
  const { gathering } = state.world
  return gathering?.character_id === character.id && gathering.ambushed ? gathering.protector : null
}

export const selected_world_action_lock = (
  state: Readonly<AppState>
): Readonly<{ character_id: string; animation: 'gather' | null }> | null => {
  const character = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!character) return null
  if (state.world.gathering?.character_id === character.id)
    return Object.freeze({ character_id: character.id, animation: state.world.gathering.ambushed ? null : 'gather' })
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
  if (!gathering || gathering.character_id !== input.character_id) return gathering
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

export const gather_completion_ready = (gathering: Readonly<PendingGather>, now_ms: number): boolean =>
  gathering.confirmed && gathering.quantity !== null && (gathering.ambushed || now_ms >= gathering.ends_at_ms)

export const automatic_ambush_input = (
  gathering: Readonly<PendingGather> | null
): Extract<WorldGatherInput, { type: 'world/resolve_ambush' }> | null =>
  gathering?.confirmed && gathering.ambushed && gathering.quantity !== null
    ? Object.freeze({ type: 'world/resolve_ambush' })
    : null

export const automatic_authoritative_ambush_input = (
  state: Readonly<AppState>
): Extract<WorldGatherInput, { type: 'world/resolve_ambush' }> | null =>
  state.world.gathering === null && selected_world_ambush(state)
    ? Object.freeze({ type: 'world/resolve_ambush' })
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

export const observe_world_gather = ({ events, get_state, dispatch, signal }: AppContext): void => {
  const in_flight = new Set<string>()
  const notices = new Map<string, ReturnType<typeof toast.loading>>()
  let gather_timer: ReturnType<typeof setTimeout> | null = null

  const complete_gather = (gathering: Readonly<PendingGather>): void => {
    const current = get_state().world.gathering
    if (
      !current ||
      current.character_id !== gathering.character_id ||
      current.ends_at_ms !== gathering.ends_at_ms ||
      !gather_completion_ready(current, Date.now())
    )
      return
    const notice = notices.get(current.character_id)
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
    notices.delete(current.character_id)
    if (!current.ambushed)
      dispatch({
        type: 'world/gather_finished',
        character_id: current.character_id,
        ends_at_ms: current.ends_at_ms,
      })
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
      state.world.gathering?.character_id === selected_character_id ||
      in_flight.has(node_id!.pack_id)
    )
      return
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
    const job_level = job_level_from_xp(Number(character.jobs[resource.job] ?? 0))
    const duration_ms = gather_time_ms(job_level)
    const started_at_ms = Date.now()
    dispatch({
      type: 'world/gather_started',
      gathering: Object.freeze({
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
    notices.set(selected_character_id, notice)
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
      .then(({ ambushed, quantity }) => {
        dispatch({
          type: 'world/gather_confirmed',
          character_id: selected_character_id,
          fallback_ends_at_ms: Date.now() + duration_ms,
          ambushed,
          quantity,
        })
      })
      .catch((error: unknown) => {
        dispatch({ type: 'world/gather_failed', character_id: selected_character_id })
        notices.delete(selected_character_id)
        console.error('Resource gathering failed.', error)
        notice.error(error)
      })
      .finally(() => in_flight.delete(node_id!.pack_id))
  })

  events.on('STATE_UPDATED', (state, previous) => {
    if (state.world.gathering !== previous.world.gathering) {
      if (gather_timer) clearTimeout(gather_timer)
      gather_timer = null
      const { gathering } = state.world
      if (gathering?.confirmed && gathering.quantity !== null) {
        if (gathering.ambushed) {
          complete_gather(gathering)
          const automatic = automatic_ambush_input(gathering)
          if (automatic) dispatch(automatic)
        } else
          gather_timer = setTimeout(() => complete_gather(gathering), Math.max(0, gathering.ends_at_ms - Date.now()))
      }
    }
    const current_ambush = selected_world_ambush(state)
    const previous_ambush = selected_world_ambush(previous)
    if (current_ambush !== previous_ambush) {
      const automatic = automatic_authoritative_ambush_input(state)
      if (automatic) dispatch(automatic)
    }
  })

  events.on('world/resolve_ambush', () => {
    const state = get_state()
    const character = selected_character(state.session)
    const ambush = selected_world_ambush(state)
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
        notice.dismiss()
        dispatch({ type: 'fight/watch', fight })
        const { gathering } = get_state().world
        if (gathering?.character_id === character.id)
          dispatch({ type: 'world/gather_finished', character_id: character.id, ends_at_ms: gathering.ends_at_ms })
      })
      .catch((error: unknown) => {
        console.error('Resource ambush resolution failed.', error)
        notice.error(error)
      })
      .finally(() => in_flight.delete(key))
  })

  const initial_automatic = automatic_authoritative_ambush_input(get_state())
  if (initial_automatic) dispatch(initial_automatic)

  signal.addEventListener('abort', () => {
    if (gather_timer) clearTimeout(gather_timer)
    gather_timer = null
    notices.forEach((notice) => notice.dismiss())
    notices.clear()
  })
}
