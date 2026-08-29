// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { decode_fight_action, type FightInput, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { FightStateRow } from '@aresrpg/protocol'

import { catalog_spell_sources } from '../content/fight_sources.ts'
import { project_fight_chat_lines } from '../game/fight/fight_chat_lines.ts'
import { auto_switch_fighter_from } from '../game/core/settings.ts'
import type { AppModule, AppState } from '../store.ts'

import { active_owned_character, holds_character_seat } from './fight_identity.ts'
import type { FightKolizeumManager } from './fight.ts'
import { fight_should_close, terminal_remote_draft_needs_commit } from './fight_lifecycle.ts'
import { create_fight_session, type ActiveFightSession } from './fight_session.ts'

export type FightPhaseRank = 0 | 1 | 2

export const fight_checkpoint_phase_rank = (contract: unknown): FightPhaseRank => {
  if (!contract || typeof contract !== 'object') return 0
  return Reflect.get(contract, 'ended') === true ? 2 : Number(Reflect.get(contract, 'round') ?? 0) > 0 ? 1 : 0
}

export const fight_state_regresses = (floor: FightPhaseRank, contract: unknown) =>
  fight_checkpoint_phase_rank(contract) < floor

const kolizeum_manager = (row: FightStateRow['kolizeum']): FightKolizeumManager | null =>
  row ? Object.freeze({ id: row.id, pledge_mist: BigInt(row.pledge_mist) }) : null

export const streamed_witness_boundary = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  observed_ms: bigint
): FightInput | null => {
  if (checkpoint.contract.round === 0n) return Object.freeze({ type: 'start', observed_ms })
  const fighter = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]
  return fighter === undefined ? null : Object.freeze({ type: 'end_turn', fighter, observed_ms })
}

export const apply_streamed_witness = (
  session: Pick<ReturnType<typeof create_fight_session>, 'apply' | 'state'>,
  witness: Readonly<Extract<FightInput, { type: 'turn_seed' }>>,
  observed_ms: bigint
): void => {
  session.apply(witness)
  if (session.state()?.error?.code !== 'unexpected_turn_seed') return
  const checkpoint = session.state()?.checkpoint
  const boundary = checkpoint ? streamed_witness_boundary(checkpoint, observed_ms) : null
  if (boundary) session.apply(boundary)
  session.apply(witness)
}

const viewed_owned_turn = (state: Readonly<AppState>): string | null => {
  const checkpoint = state.fight.mode === 'remote' ? state.fight.checkpoint : null
  const selected = state.session.selected_character_id
  const owner = state.session.wallet?.address ?? null
  if (!checkpoint || !holds_character_seat(checkpoint, selected, owner)) return null
  return active_owned_character(checkpoint, owner, new Set(state.session.characters.map(({ id }) => id)))
}

export const automatic_turn_character = (state: Readonly<AppState>, previous: Readonly<AppState>): string | null => {
  if (!auto_switch_fighter_from(state.settings.auto_switch_fighter)) return null
  const active = viewed_owned_turn(state)
  if (!active || active === state.session.selected_character_id) return null
  const previous_active =
    previous.fight.checkpoint?.contract.id === state.fight.checkpoint?.contract.id ? viewed_owned_turn(previous) : null
  return active === previous_active ? null : active
}

export const observe_fights = ({
  dispatch,
  events,
  get_state,
}: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  type Runtime = ReturnType<typeof create_fight_session>
  const sessions = new Map<string, Runtime>()
  const phase_floors = new Map<string, FightPhaseRank>()
  const phase_syncing = new Set<string>()
  const witnesses = new Map<string, Set<string>>()
  const previews = new Map<string, string>()
  let local_session: Runtime | null = null
  let fight_instance = 0

  const state_fights = (state: ReturnType<typeof get_state>): Set<string> =>
    new Set([
      ...state.session.characters.flatMap(({ active_fight }) => (active_fight ? [active_fight.id] : [])),
      ...Object.values(state.fight.spectating_by_character),
    ])
  const evict_if_unreferenced = (fight: string): void => {
    if (state_fights(get_state()).has(fight) || [...previews.values()].includes(fight)) return
    sessions.get(fight)?.close()
    sessions.delete(fight)
    witnesses.delete(fight)
    phase_floors.delete(fight)
    phase_syncing.delete(fight)
    const state = get_state()
    if (state.fight.cached[fight] || state.fight.environments[fight]) dispatch({ type: 'fight/uncached', fight })
  }

  const selected_fight_id = (): string | null => {
    const state = get_state()
    const character = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
    return (
      character?.active_fight?.id ??
      state.fight.spectating_by_character[character?.id ?? ''] ??
      previews.get(character?.id ?? '') ??
      null
    )
  }
  const reconcile =
    (fight_id: string | null) =>
    ({
      mode,
      checkpoint,
      zone_ids,
      events: fight_events,
      presentation_batch,
      error,
      awaiting_turn_witness,
    }: ActiveFightSession) => {
      const state = get_state()
      const selected_character = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
      const legacy_seat =
        !selected_character?.active_fight &&
        holds_character_seat(checkpoint, state.session.selected_character_id, state.session.wallet?.address ?? null)
      dispatch({
        type: 'fight/reconciled',
        mode,
        checkpoint,
        zone_ids,
        events: fight_events,
        presentation_batch,
        error,
        awaiting_turn_witness,
        project: mode === 'local' || fight_id === selected_fight_id() || legacy_seat,
      })
    }
  const create_session = (fight_id: string | null): Runtime =>
    create_fight_session({ now: () => BigInt(Date.now()), reconcile: reconcile(fight_id) })
  const remote_session = (fight_id: string): Runtime => {
    const existing = sessions.get(fight_id)
    if (existing) return existing
    const created = create_session(fight_id)
    sessions.set(fight_id, created)
    witnesses.set(fight_id, new Set())
    return created
  }
  const project_session = (fight_id: string): void => {
    const session = sessions.get(fight_id)
    const current = session?.state()
    if (!session || !current) return
    // Arriving on a board owes no replay: stale unpresented events already happened off-screen.
    session.acknowledge(current.presentation_batch)
    reconcile(fight_id)(session.state() ?? current)
  }

  events.on('fight/watch', ({ character_id, fight }) => {
    const previous = previews.get(character_id)
    if (fight) previews.set(character_id, fight)
    else previews.delete(character_id)
    if (previous && previous !== fight) evict_if_unreferenced(previous)
  })
  events.on('fight/opened', () => {
    fight_instance += 1
  })
  events.on('fight/presented', ({ presentation }) => {
    const { checkpoint, events: fight_events, batch } = presentation
    if (fight_events.length === 0) return
    const state = get_state()
    const name_of = (seat: bigint): string => {
      const fighter = checkpoint.contract.fighters[Number(seat)]
      if (!fighter) return `#${seat}`
      if (fighter.kind.type === 'mob') return fighter.kind.snapshot.mob_type
      const { character } = fighter.kind
      return (
        state.session.characters.find(({ id }) => id === character)?.name ??
        state.simulator.characters.find(({ id }) => id === character)?.name ??
        `#${seat}`
      )
    }
    project_fight_chat_lines(checkpoint, fight_events, `${fight_instance}.${batch}`, name_of).forEach((line) =>
      dispatch({ type: 'chat/line', line })
    )
    if (state.fight.mode === 'local') local_session?.acknowledge(batch)
    else sessions.get(checkpoint.contract.id)?.acknowledge(batch)
  })
  events.on('fight/opened', ({ mode, seed, setup, state }) => {
    if (mode === 'local') {
      local_session = create_session(null)
      local_session.open({ mode, seed, setup, state })
      return
    }
    const fight_id = state?.contract.id
    if (!fight_id || !state) return
    phase_floors.set(fight_id, fight_checkpoint_phase_rank(state.contract))
    witnesses.get(fight_id)?.clear()
    remote_session(fight_id).open({ mode, state })
  })
  events.on('fight/input', ({ fight: fight_id, input, origin }) => {
    const state = get_state()
    if (origin === 'local' && fight_id && state.fight.environments[fight_id]?.transaction_pending) return
    const session = state.fight.mode === 'local' ? local_session : fight_id ? sessions.get(fight_id) : null
    if (!session) return
    if (origin === 'local' && input.type === 'start' && fight_id)
      dispatch({ type: 'fight/started_at', fight: fight_id, at_ms: Date.now() })
    const witness_key = input.type === 'turn_seed' ? `${input.fighter}:${input.seed}` : null
    const applied = fight_id ? witnesses.get(fight_id) : null
    if (witness_key && applied?.has(witness_key)) return
    session.apply(input)
    if (witness_key && session.state()?.error?.code !== 'unexpected_turn_seed') applied?.add(witness_key)
  })
  events.on('fight/runtime_input', ({ fight, input }) => {
    const session = sessions.get(fight)
    if (!session) return
    const witness_key = input.type === 'turn_seed' ? `${input.fighter}:${input.seed}` : null
    const applied = witnesses.get(fight)
    if (witness_key && applied?.has(witness_key)) return
    session.apply(input)
    if (witness_key && session.state()?.error?.code !== 'unexpected_turn_seed') applied?.add(witness_key)
  })
  events.on('fight/reset_turn', ({ fight }) => {
    if (fight) sessions.get(fight)?.reset_turn()
    else local_session?.reset_turn()
  })
  events.on('fight/cancel_pending_turn', ({ fight }) => sessions.get(fight)?.cancel_pending_turn())
  events.on('server/packet', ({ packet }) => {
    if (packet.type === 'packet/characters') {
      packet.characters.forEach((character) => {
        const preview = previews.get(character.id)
        if (preview && character.active_fight?.id === preview)
          dispatch({ type: 'fight/watch', character_id: character.id, fight: null })
      })
      return
    }
    if (packet.type === 'packet/fight_state') {
      const floor = phase_floors.get(packet.fight) ?? 0
      if (fight_state_regresses(floor, packet.state.contract)) return
      phase_floors.set(
        packet.fight,
        Math.max(floor, fight_checkpoint_phase_rank(packet.state.contract)) as FightPhaseRank
      )
      dispatch({
        type: 'fight/kolizeum',
        fight: packet.fight,
        kolizeum: kolizeum_manager(packet.state.kolizeum),
      })
      const wire_checkpoint = {
        contract: packet.state.contract,
        sources: { players: packet.state.players, spells: catalog_spell_sources() },
      } as unknown as HydratedFightCheckpoint
      const session = remote_session(packet.fight)
      if (session.state()) session.replace(wire_checkpoint)
      else session.open({ mode: 'remote', state: wire_checkpoint })
      // The runtime is the packet's one normalization door. Result math must consume this
      // bigint-native checkpoint, never the raw JSON object handed into that door.
      const normalized = session.state()
      if (!normalized) return
      const { checkpoint } = normalized
      if (phase_syncing.delete(packet.fight))
        dispatch({ type: 'fight/transaction_pending', fight: packet.fight, pending: false })
      const { ended } = checkpoint.contract
      dispatch({ type: 'fight/canonical_ended', fight: packet.fight, ended })
      if (ended) {
        const roster = new Set(get_state().session.characters.map(({ id }) => id))
        checkpoint.contract.fighters.forEach((fighter) => {
          if (fighter.kind.type !== 'player' || !roster.has(fighter.kind.character)) return
          dispatch({
            type: 'fight_result/checkpoint',
            character_id: fighter.kind.character,
            checkpoint,
            observed_at_ms: Date.now(),
            gas_spent_mist: get_state().session.wallet?.fight.gas_spent(packet.fight) ?? 0n,
          })
        })
      }
      return
    }
    if (!('fight' in packet) || typeof packet.fight !== 'string') return
    const fight_id = packet.fight
    const session = sessions.get(fight_id)
    if (!session) return
    const advance_phase = (floor: FightPhaseRank): void => {
      const previous = phase_floors.get(fight_id) ?? 0
      phase_floors.set(fight_id, Math.max(previous, floor) as FightPhaseRank)
      const current = session.state()?.checkpoint.contract
      if (!current || fight_checkpoint_phase_rank(current) >= floor || phase_syncing.has(fight_id)) return
      phase_syncing.add(fight_id)
      dispatch({ type: 'fight/transaction_pending', fight: fight_id, pending: true })
      dispatch({ type: 'fight/resync', fight: fight_id })
    }
    if (packet.type === 'packet/fight_phase') {
      advance_phase(packet.phase === 'ended' ? 2 : 1)
      return
    }
    if (packet.type === 'packet/fight_started') {
      advance_phase(1)
      dispatch({ type: 'fight/started_at', fight: fight_id, at_ms: Number(packet.started_ms ?? Date.now()) })
    }
    if (packet.type === 'packet/fight_ended') advance_phase(2)
    if (packet.type === 'packet/fight_action') {
      session.apply(decode_fight_action(packet.action))
      return
    }
    if (packet.type === 'packet/fighter_forfeited') {
      session.apply({ type: 'forfeit', fighter: BigInt(packet.fighter) })
      return
    }
    if (packet.type === 'packet/turn_seed') {
      const witness = Object.freeze({
        type: 'turn_seed' as const,
        fighter: BigInt(packet.seat),
        seed: BigInt(packet.seed),
      })
      const witness_key = `${witness.fighter}:${witness.seed}`
      const applied = witnesses.get(packet.fight)
      if (applied?.has(witness_key)) return
      apply_streamed_witness(session, witness, BigInt(Date.now()))
      if (session.state()?.error?.code !== 'unexpected_turn_seed') applied?.add(witness_key)
    }
  })
  events.on('STATE_UPDATED', (state, previous) => {
    const before_fights = state_fights(previous)
    const current_fights = state_fights(state)
    before_fights.forEach((fight) => {
      if (!current_fights.has(fight)) evict_if_unreferenced(fight)
    })
    if (state.session.link_status === 'ready' && previous.session.link_status !== 'ready')
      previews.forEach((fight, character_id) => dispatch({ type: 'fight/watch', character_id, fight }))
    if (state.fight !== previous.fight && terminal_remote_draft_needs_commit(state.fight)) {
      dispatch({ type: 'fight/end_turn_queued', fight: state.fight.checkpoint!.contract.id, queued: true })
      return
    }
    if (state.fight !== previous.fight && fight_should_close(state.fight, state.session.selected_character_id)) {
      const selected = state.session.selected_character_id
      if (state.fight.mode === 'remote' && !state.fight.checkpoint?.contract.ended && selected)
        dispatch({ type: 'fight/released', character_id: selected })
      else
        dispatch({
          type: 'fight/closed',
          fight: state.fight.mode === 'remote' ? (state.fight.checkpoint?.contract.id ?? null) : null,
        })
    }
  })
  events.on('character/select', ({ character_id }) => {
    const state = get_state()
    const character = state.session.characters.find(({ id }) => id === character_id)
    const fight_id = character?.active_fight?.id ?? state.fight.spectating_by_character[character_id]
    if (fight_id) project_session(fight_id)
  })
  events.on('STATE_UPDATED', (state, previous) => {
    const character_id = automatic_turn_character(state, previous)
    if (character_id) dispatch({ type: 'character/select', character_id })
  })
  events.on('fight/spectating', ({ character_id, fight }) => {
    if (get_state().session.selected_character_id === character_id) project_session(fight)
  })
  events.on('fight/replaced', ({ checkpoint }) => sessions.get(checkpoint.contract.id)?.replace(checkpoint))
  events.on('fight/restored', ({ checkpoint }) => sessions.get(checkpoint.contract.id)?.restore(checkpoint))
  const close_local_session = (): void => {
    local_session?.close()
    local_session = null
  }
  events.on('fight/closed', ({ fight }) => {
    if (fight === null) close_local_session()
    else {
      sessions.get(fight)?.close()
      sessions.delete(fight)
      witnesses.delete(fight)
      phase_floors.delete(fight)
      phase_syncing.delete(fight)
    }
  })
  events.on('fight/released', close_local_session)
  events.on('fight/preview_closed', ({ character_id }) => dispatch({ type: 'fight/watch', character_id, fight: null }))
}
