// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ClosableFightRow, FightResolutionRow, ServerPacket } from '@aresrpg/protocol'
import { player_max_hp, xp_award_of, type Fighter, type HydratedFightCheckpoint } from '@aresrpg/fight'
import { item_is_stackable, level_from_xp } from '@aresrpg/immutable'

import { encyclopedia_catalog } from '../content/catalog.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

import { observe_fight_results } from './fight_result_observer.ts'
import { fight_duration, fight_resolution_dungeon, fight_result_available } from './fight_result_view.ts'

export {
  compact_xp,
  fight_duration,
  fight_resolution_dungeon,
  fight_result_available,
  fight_result_complete,
  fight_result_surface,
  format_fight_duration,
  kolizeum_wager_outcome,
  result_participant_shows_progress,
  result_xp_progress,
} from './fight_result_view.ts'

export type ResultLoot = Readonly<{ item_type: string; qty: number }>
export const fight_experience_after = (experience: number, xp_awarded: number, settled: boolean): number =>
  settled ? experience : experience + xp_awarded

export type ResultParticipant = Readonly<{
  seat: number
  team: number
  character_id: string | null
  name: string
  level_before: number
  level_after: number
  experience_before: number
  experience_after: number
  hp: number
  max_hp: number
  dead: boolean
  forfeited: boolean
  settled: boolean
  xp_awarded: number
  loot: readonly ResultLoot[]
}>

export type FightResult = Readonly<{
  fight: string
  dungeon: Readonly<{ world: string; room: number }> | null
  kolizeum: string | null
  /** Immutable stake plus certified gross payout; absent for non-Kolizeum and recovery without terms. */
  kolizeum_wager: Readonly<{ stake_mist: bigint; payout_mist: bigint | null }> | null
  winner: number | null
  duration_ms: number | null
  /** This wallet's net executed fight cost: computation + storage - rebate. */
  gas_spent_mist: bigint
  participants: readonly ResultParticipant[]
  own_seat: number | null
  /** Immutable template set needed to compose settlement without waiting for the graph. */
  loot_types: readonly string[]
  /** A certified settlement receipt, or an empty durable recovery snapshot, proved completion. */
  settlement_confirmed: boolean
  /** The projected Character row caught up to this fight's expected experience. */
  progression_synced: boolean
  error: string | null
  /** Result first, level-up second. The current record survives Continue until both are acknowledged. */
  result_open: boolean
  level_up_open: boolean
  level_up_acknowledged: boolean
}>

export type FightResultState = Readonly<{
  current_by_character: Readonly<Record<string, FightResult>>
  resolutions: readonly FightResolutionRow[]
  closable_fights: readonly ClosableFightRow[]
}>

export type FightResultInput =
  | Readonly<{
      type: 'fight_result/checkpoint'
      character_id: string
      checkpoint: HydratedFightCheckpoint
      observed_at_ms: number
      gas_spent_mist: bigint
    }>
  | Readonly<{ type: 'fight_result/gas_updated'; character_id: string; fight: string; gas_spent_mist: bigint }>
  | Readonly<{ type: 'fight_result/retry'; character_id: string }>
  | Readonly<{ type: 'fight_result/claim_failed'; character_id: string; fight: string; error: string }>
  | Readonly<{ type: 'fight_result/settled'; character_id: string; fight: string; paid_mist: bigint | null }>
  | Readonly<{ type: 'fight_result/level_acknowledged'; character_id: string }>
  | Readonly<{ type: 'fight_result/closed'; character_id: string }>
  | Readonly<{ type: 'fight_result/close_succeeded'; fight: string }>

export const initial_fight_result_state = (): FightResultState =>
  Object.freeze({ current_by_character: Object.freeze({}), resolutions: [], closable_fights: [] })

export const aggregate_result_loot = (
  drops: readonly Readonly<{ item_type: string; qty: bigint | number }>[]
): readonly ResultLoot[] =>
  Object.freeze(
    Object.entries(
      drops.reduce<Record<string, number>>((rows, drop) => {
        const category = encyclopedia_catalog.item(drop.item_type)?.item.category
        const qty = category && !item_is_stackable(category) ? 1 : Number(drop.qty)
        return { ...rows, [drop.item_type]: (rows[drop.item_type] ?? 0) + qty }
      }, {})
    ).map(([item_type, qty]) => Object.freeze({ item_type, qty }))
  )

export const merge_result_loot = (
  current: readonly ResultLoot[],
  incoming: readonly ResultLoot[]
): readonly ResultLoot[] => {
  const quantities = new Map(current.map((row) => [row.item_type, row.qty]))
  for (const row of incoming) quantities.set(row.item_type, Math.max(quantities.get(row.item_type) ?? 0, row.qty))
  return Object.freeze([...quantities].map(([item_type, qty]) => Object.freeze({ item_type, qty })))
}

const result_accounting = (
  indexed_started_ms: bigint | null,
  indexed_ended_ms: bigint | null,
  observed_started_ms: number | null,
  observed_at_ms: number,
  gas_spent_mist: bigint,
  existing: FightResult | null
) =>
  Object.freeze({
    duration_ms:
      existing?.duration_ms ??
      fight_duration(indexed_started_ms ?? observed_started_ms, indexed_ended_ms ?? observed_at_ms),
    gas_spent_mist,
  })

const participant_from = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  fighter: Readonly<Fighter>,
  seat: number
): ResultParticipant => {
  const source = fighter.kind.type === 'player' ? checkpoint.sources.players[fighter.kind.character] : null
  const experience_before = Number(source?.experience ?? 0n)
  const xp_awarded = Number(xp_award_of(checkpoint, BigInt(seat)))
  const experience_after = fight_experience_after(experience_before, xp_awarded, fighter.settled)
  return Object.freeze({
    seat,
    team: Number(fighter.team),
    character_id: fighter.kind.type === 'player' ? fighter.kind.character : null,
    name:
      source?.name ??
      (fighter.kind.type === 'mob'
        ? (encyclopedia_catalog.mob(fighter.kind.snapshot.mob_type)?.mob.name ?? fighter.kind.snapshot.mob_type)
        : fighter.kind.character),
    level_before: Number(source?.level ?? (fighter.kind.type === 'mob' ? fighter.kind.snapshot.level : 1n)),
    level_after: fighter.kind.type === 'player' ? level_from_xp(experience_after) : Number(fighter.kind.snapshot.level),
    experience_before,
    experience_after,
    hp: Number(fighter.hp),
    max_hp: Number(fighter.kind.type === 'mob' ? fighter.kind.snapshot.max_hp : source ? player_max_hp(source) : 1n),
    dead: fighter.dead,
    forfeited: fighter.forfeited,
    settled: fighter.settled,
    xp_awarded,
    loot: aggregate_result_loot(fighter.drops),
  })
}

const loot_types_for = (checkpoint: Readonly<HydratedFightCheckpoint>, own_seat: number): readonly string[] => {
  const own = checkpoint.contract.fighters[own_seat]
  if (!own || checkpoint.contract.winner !== own.team) return Object.freeze([])
  return Object.freeze([
    ...new Set(
      checkpoint.contract.fighters.flatMap((fighter) =>
        fighter.team === own.team || fighter.kind.type !== 'mob'
          ? []
          : fighter.kind.snapshot.loot.map(({ item_type }) => item_type)
      )
    ),
  ])
}

const merge_participants = (
  incoming: readonly ResultParticipant[],
  existing: FightResult | null
): readonly ResultParticipant[] =>
  Object.freeze(
    incoming.map((row) => {
      const before = existing?.participants.find(({ seat }) => seat === row.seat)
      return before
        ? Object.freeze({
            ...row,
            level_before: before.level_before,
            experience_before: before.experience_before,
            experience_after: Math.max(before.experience_after, row.experience_after),
            level_after: Math.max(before.level_after, row.level_after),
            settled: before.settled || row.settled,
            xp_awarded: Math.max(before.xp_awarded, row.xp_awarded),
            loot: merge_result_loot(before.loot, row.loot),
          })
        : row
    })
  )

const projected_dungeon = (
  checkpoint: Readonly<HydratedFightCheckpoint>
): Readonly<{ world: string; room: number }> | null =>
  checkpoint.contract.dungeon === null
    ? null
    : Object.freeze({ world: checkpoint.contract.world, room: Number(checkpoint.contract.dungeon) })

const progression_state = (
  state: AppState,
  character_id: string,
  existing: FightResult | null,
  previous_own: ResultParticipant | null | undefined,
  next_own: ResultParticipant | null
) => {
  const character = state.session.characters.find(({ id }) => id === character_id)
  const expected_experience = next_own?.experience_after ?? 0
  return Object.freeze({
    settlement_confirmed: existing?.settlement_confirmed ?? Boolean(next_own?.settled || next_own?.forfeited),
    progression_synced:
      existing?.progression_synced === true || Number(character?.experience ?? 0) >= expected_experience,
    level_up_open:
      existing?.level_up_open === true ||
      (!existing?.level_up_acknowledged &&
        !!next_own &&
        next_own.level_after > (previous_own?.level_before ?? next_own.level_before)),
  })
}

const result_kolizeum = (
  manager: Readonly<{ id: string; pledge_mist: bigint }> | undefined,
  existing: FightResult | null,
  forfeited: boolean
): Readonly<{
  kolizeum: string | null
  kolizeum_wager: FightResult['kolizeum_wager']
}> => {
  const retained_kolizeum = existing ? existing.kolizeum : null
  const retained_wager = existing ? existing.kolizeum_wager : null
  if (!manager)
    return Object.freeze({
      kolizeum: retained_kolizeum,
      kolizeum_wager: retained_wager,
    })
  if (retained_wager) return Object.freeze({ kolizeum: manager.id, kolizeum_wager: retained_wager })
  return Object.freeze({
    kolizeum: manager.id,
    kolizeum_wager: Object.freeze({ stake_mist: manager.pledge_mist, payout_mist: forfeited ? 0n : null }),
  })
}

const merge_checkpoint = (
  state: AppState,
  character_id: string,
  checkpoint: Readonly<HydratedFightCheckpoint>,
  observed_at_ms: number,
  gas_spent_mist: bigint
): FightResult | null => {
  if (!checkpoint.contract.ended) return null
  const stored = state.fight_result.current_by_character[character_id]
  const existing = stored?.fight === checkpoint.contract.id ? stored : null
  const incoming = checkpoint.contract.fighters.map((fighter, seat) => participant_from(checkpoint, fighter, seat))
  const participants = merge_participants(incoming, existing)
  const own_seat = checkpoint.contract.fighters.findIndex(
    (fighter) => fighter.kind.type === 'player' && fighter.kind.character === character_id
  )
  const previous_own = existing?.own_seat === null ? null : existing?.participants[existing.own_seat ?? -1]
  const next_own = own_seat < 0 ? null : participants[own_seat]
  const kolizeum_result = result_kolizeum(
    state.fight.kolizeum_by_fight[checkpoint.contract.id],
    existing,
    next_own?.forfeited === true
  )
  return Object.freeze({
    fight: checkpoint.contract.id,
    dungeon: projected_dungeon(checkpoint),
    ...kolizeum_result,
    winner: checkpoint.contract.winner === null ? null : Number(checkpoint.contract.winner),
    ...result_accounting(
      checkpoint.contract.started_ms,
      checkpoint.contract.ended_ms,
      state.fight.started_at_ms,
      observed_at_ms,
      gas_spent_mist,
      existing
    ),
    participants: Object.freeze(participants),
    own_seat: own_seat < 0 ? null : own_seat,
    loot_types: own_seat < 0 ? Object.freeze([]) : loot_types_for(checkpoint, own_seat),
    ...progression_state(state, character_id, existing, previous_own, next_own),
    error: existing?.error ?? null,
    result_open: existing?.result_open ?? true,
    level_up_acknowledged: existing?.level_up_acknowledged ?? false,
  })
}

const merge_resolution = (participant: ResultParticipant, row: Readonly<FightResolutionRow>): ResultParticipant => {
  return Object.freeze({
    ...participant,
    dead: row.dead,
    forfeited: participant.forfeited,
    settled: row.settled,
    xp_awarded: participant.xp_awarded,
    loot: merge_result_loot(participant.loot, aggregate_result_loot(row.drops)),
  })
}

const recover_result = (state: AppState, row: Readonly<FightResolutionRow>): FightResult | null => {
  const character = state.session.characters.find(({ id }) => id === row.character)
  if (!character) return null
  const experience = Number(character.experience)
  const participant = Object.freeze({
    seat: row.fighter,
    team: row.team,
    character_id: row.character,
    name: character.name,
    level_before: character.level,
    level_after: character.level,
    experience_before: experience,
    experience_after: experience,
    hp: row.dead ? 0 : 1,
    max_hp: 1,
    dead: row.dead,
    forfeited: false,
    settled: row.settled,
    xp_awarded: 0,
    loot: aggregate_result_loot(row.drops),
  })
  return Object.freeze({
    fight: row.fight,
    dungeon: fight_resolution_dungeon(row),
    kolizeum: row.kolizeum,
    kolizeum_wager: null,
    winner: row.winner,
    duration_ms: null,
    gas_spent_mist: 0n,
    participants: Object.freeze([participant]),
    own_seat: 0,
    loot_types: Object.freeze([...row.loot_types]),
    settlement_confirmed: false,
    progression_synced: true,
    error: null,
    result_open: true,
    level_up_open: participant.level_after > participant.level_before,
    level_up_acknowledged: false,
  })
}

const fold_resolutions = (state: AppState, resolutions: readonly FightResolutionRow[]): AppState => {
  const incoming = new Map(resolutions.map((row) => [row.character, row]))
  const known_characters = new Set([...Object.keys(state.fight_result.current_by_character), ...incoming.keys()])
  const current_by_character = Object.freeze(
    Object.fromEntries(
      [...known_characters].flatMap((character_id): readonly [string, FightResult][] => {
        const row = incoming.get(character_id)
        const stored = state.fight_result.current_by_character[character_id]
        const current = stored ?? (row ? recover_result(state, row) : null)
        if (!current) return []
        const pending = row?.fight === current.fight ? row : undefined
        const was_pending = state.fight_result.resolutions.some(
          (candidate) => candidate.character === character_id && candidate.fight === current.fight
        )
        const participants = pending
          ? current.participants.map((participant) =>
              participant.character_id === character_id ? merge_resolution(participant, pending) : participant
            )
          : was_pending
            ? current.participants.map((participant, index) =>
                index === current.own_seat ? Object.freeze({ ...participant, settled: true }) : participant
              )
            : current.participants
        const own = current.own_seat === null ? null : participants[current.own_seat]
        return [
          [
            character_id,
            Object.freeze({
              ...current,
              participants: Object.freeze(participants),
              loot_types: pending ? Object.freeze([...pending.loot_types]) : current.loot_types,
              settlement_confirmed: current.settlement_confirmed || (!pending && was_pending),
              level_up_open:
                current.level_up_open ||
                (!current.level_up_acknowledged && !!own && own.level_after > own.level_before),
            }),
          ],
        ]
      })
    )
  )
  return Object.freeze({
    ...state,
    fight_result: Object.freeze({
      current_by_character,
      resolutions: Object.freeze([...resolutions]),
      closable_fights: state.fight_result.closable_fights,
    }),
  })
}

const fold_characters = (state: AppState): AppState => {
  const current_by_character = Object.freeze(
    Object.fromEntries(
      Object.entries(state.fight_result.current_by_character).flatMap(
        ([character_id, result]): readonly [string, FightResult][] => {
          const own_index = result.own_seat
          const own = own_index === null ? null : result.participants[own_index]
          const character = state.session.characters.find(({ id }) => id === own?.character_id)
          if (own_index === null || !own || !character) return [[character_id, result]]
          const experience = Number(character.experience)
          const progression_synced = experience >= own.experience_after
          const participants = result.participants.map((participant, index) =>
            index === own_index
              ? Object.freeze({
                  ...participant,
                  level_after: Math.max(participant.level_after, character.level),
                  experience_after: Math.max(participant.experience_after, experience),
                  hp: Number(character.hp),
                })
              : participant
          )
          const level_up_open =
            result.level_up_open ||
            (!result.level_up_acknowledged &&
              !!participants[own_index] &&
              participants[own_index]!.level_after > participants[own_index]!.level_before)
          if (!result.result_open && progression_synced && !level_up_open) return []
          return [
            [
              character_id,
              Object.freeze({
                ...result,
                participants: Object.freeze(participants),
                progression_synced,
                level_up_open,
              }),
            ],
          ]
        }
      )
    )
  )
  return Object.freeze({
    ...state,
    fight_result: Object.freeze({ ...state.fight_result, current_by_character }),
  })
}

const fold_packet = (state: AppState, packet: Readonly<ServerPacket>): AppState => {
  if (packet.type === 'packet/closable_fights')
    return Object.freeze({
      ...state,
      fight_result: Object.freeze({
        ...state.fight_result,
        closable_fights: Object.freeze([...packet.fights]),
      }),
    })
  if (packet.type === 'packet/fight_resolutions') return fold_resolutions(state, packet.resolutions)
  if (packet.type === 'packet/characters')
    return fold_characters(fold_resolutions(state, state.fight_result.resolutions))
  if (packet.type !== 'packet/fight_drops') return state
  const fighter = Number(packet.fighter)
  const current_by_character = Object.freeze(
    Object.fromEntries(
      Object.entries(state.fight_result.current_by_character).map(([character_id, result]) => [
        character_id,
        result.fight !== packet.fight
          ? result
          : Object.freeze({
              ...result,
              participants: Object.freeze(
                result.participants.map((participant) =>
                  participant.seat === fighter
                    ? Object.freeze({
                        ...participant,
                        loot: merge_result_loot(participant.loot, aggregate_result_loot(packet.drops)),
                      })
                    : participant
                )
              ),
            }),
      ])
    )
  )
  return Object.freeze({
    ...state,
    fight_result: Object.freeze({
      ...state.fight_result,
      current_by_character,
    }),
  })
}

const update_result = (
  state: AppState,
  character_id: string,
  update: (result: FightResult) => FightResult | null
): AppState => {
  const current = state.fight_result.current_by_character[character_id]
  if (!current) return state
  const next = update(current)
  const current_by_character = Object.freeze({
    ...Object.fromEntries(
      Object.entries(state.fight_result.current_by_character).filter(([id]) => id !== character_id)
    ),
    ...(next ? { [character_id]: next } : {}),
  })
  return Object.freeze({
    ...state,
    fight_result: Object.freeze({
      ...state.fight_result,
      current_by_character,
    }),
  })
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'fight_result/checkpoint') {
    const projected = merge_checkpoint(
      state,
      input.character_id,
      input.checkpoint,
      input.observed_at_ms,
      input.gas_spent_mist
    )
    if (!projected) return state
    return Object.freeze({
      ...state,
      fight_result: Object.freeze({
        ...state.fight_result,
        current_by_character: Object.freeze({
          ...state.fight_result.current_by_character,
          [input.character_id]: projected,
        }),
      }),
    })
  }
  if (input.type === 'fight_result/gas_updated')
    return update_result(state, input.character_id, (result) =>
      result.fight === input.fight ? Object.freeze({ ...result, gas_spent_mist: input.gas_spent_mist }) : result
    )
  if (input.type === 'server/packet') return fold_packet(state, input.packet)
  if (input.type === 'fight_result/claim_failed')
    return update_result(state, input.character_id, (result) =>
      result.fight === input.fight ? Object.freeze({ ...result, error: input.error }) : result
    )
  if (input.type === 'fight_result/settled')
    return update_result(state, input.character_id, (result) =>
      result.fight !== input.fight
        ? result
        : Object.freeze({
            ...result,
            kolizeum_wager:
              input.paid_mist === null || !result.kolizeum_wager
                ? result.kolizeum_wager
                : Object.freeze({ ...result.kolizeum_wager, payout_mist: input.paid_mist }),
            settlement_confirmed: true,
            participants: Object.freeze(
              result.participants.map((participant, index) =>
                index === result.own_seat ? Object.freeze({ ...participant, settled: true }) : participant
              )
            ),
          })
    )
  if (input.type === 'fight_result/retry')
    return update_result(state, input.character_id, (result) => Object.freeze({ ...result, error: null }))
  if (input.type === 'fight_result/level_acknowledged')
    return update_result(state, input.character_id, (result) =>
      result.result_open ? Object.freeze({ ...result, level_up_open: false, level_up_acknowledged: true }) : null
    )
  if (input.type === 'fight_result/closed')
    return update_result(state, input.character_id, (result) =>
      result.level_up_open || !result.progression_synced ? Object.freeze({ ...result, result_open: false }) : null
    )
  if (input.type === 'fight_result/close_succeeded')
    return Object.freeze({
      ...state,
      fight_result: Object.freeze({
        ...state.fight_result,
        closable_fights: Object.freeze(state.fight_result.closable_fights.filter(({ fight }) => fight !== input.fight)),
      }),
    })
  return state
}

export const next_fight_resolution_step = (_row: Readonly<FightResolutionRow>): Readonly<{ type: 'settle' }> =>
  Object.freeze({ type: 'settle' })

export default Object.freeze({ name: 'fight_result', reduce, observe: observe_fight_results }) satisfies AppModule
