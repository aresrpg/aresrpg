// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MONOTONIC FIGHT RESULT — the card outlives the board and never reads inventory. Checkpoints,
// DropsRolled, and durable RESULT_FOR rows may arrive in any order; each only adds facts.

import type { FightResolutionRow, ServerPacket } from '@aresrpg/protocol'
import { player_max_hp, xp_award_of, type Fighter, type HydratedFightCheckpoint } from '@aresrpg/fight'
import { experience_progress, item_is_stackable } from '@aresrpg/immutable'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { toast } from '../toast.ts'
import { stack_merge_target } from '../inventory_stacks.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export type ResultLoot = Readonly<{ item_type: string; qty: number }>
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
  settled: boolean
  xp_awarded: number
  loot: readonly ResultLoot[]
}>

export type FightResult = Readonly<{
  fight: string
  winner: number | null
  participants: readonly ResultParticipant[]
  own_seat: number | null
  resolution_synced: boolean
  error: string | null
  /** Result first, level-up second. The current record survives Continue until both are acknowledged. */
  result_open: boolean
  level_up_open: boolean
  level_up_acknowledged: boolean
}>

export type FightResultState = Readonly<{
  current: FightResult | null
  resolutions: readonly FightResolutionRow[]
}>

export type FightResultInput =
  | Readonly<{ type: 'fight_result/checkpoint'; checkpoint: HydratedFightCheckpoint }>
  | Readonly<{ type: 'fight_result/retry' }>
  | Readonly<{ type: 'fight_result/claim_failed'; fight: string; error: string }>
  | Readonly<{ type: 'fight_result/level_acknowledged' }>
  | Readonly<{ type: 'fight_result/closed' }>

export const initial_fight_result_state = (): FightResultState => Object.freeze({ current: null, resolutions: [] })

/** The live fight surface owns its terminal sequence. Result UI and settlement become eligible
 * only after that matching session closes, which happens after every presentation batch drains. */
export const fight_result_available = (
  fight: Readonly<{ checkpoint: Readonly<{ contract: Readonly<{ id: string }> }> | null }>,
  result_fight: string
): boolean => fight.checkpoint?.contract.id !== result_fight

export const fight_result_surface = (
  result: Readonly<Pick<FightResult, 'result_open' | 'level_up_open'>>
): 'result' | 'level_up' | null => (result.result_open ? 'result' : result.level_up_open ? 'level_up' : null)

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

export const result_xp_progress = (experience_before: number, experience_after: number) => {
  const before = experience_progress(experience_before)
  const after = experience_progress(experience_after)
  const same_level = before.level === after.level
  const before_percent = before.span > 0 ? (before.into / before.span) * 100 : 100
  const after_percent = after.span > 0 ? (after.into / after.span) * 100 : 100
  const base_percent = same_level ? before_percent : 0
  return Object.freeze({
    base_percent,
    gained_percent: Math.max(0, after_percent - base_percent),
    into: after.into,
    span: after.span,
  })
}

export const result_participant_shows_progress = (
  participant: Readonly<Pick<ResultParticipant, 'character_id'>>
): boolean => participant.character_id !== null

const participant_from = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  fighter: Readonly<Fighter>,
  seat: number
): ResultParticipant => {
  const source = fighter.kind.type === 'player' ? checkpoint.sources.players[fighter.kind.character] : null
  const experience_before = Number(source?.experience ?? 0n)
  const xp_awarded = Number(xp_award_of(checkpoint, BigInt(seat)))
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
    level_after: Number(source?.level ?? (fighter.kind.type === 'mob' ? fighter.kind.snapshot.level : 1n)),
    experience_before,
    experience_after: experience_before + xp_awarded,
    hp: Number(fighter.hp),
    max_hp: Number(fighter.kind.type === 'mob' ? fighter.kind.snapshot.max_hp : source ? player_max_hp(source) : 1n),
    dead: fighter.dead,
    settled: fighter.settled,
    xp_awarded,
    loot: aggregate_result_loot(fighter.drops),
  })
}

const merge_checkpoint = (state: AppState, checkpoint: Readonly<HydratedFightCheckpoint>): FightResultState => {
  if (!checkpoint.contract.ended) return state.fight_result
  const existing = state.fight_result.current?.fight === checkpoint.contract.id ? state.fight_result.current : null
  const wallet = state.session.wallet?.address ?? null
  const incoming = checkpoint.contract.fighters.map((fighter, seat) => participant_from(checkpoint, fighter, seat))
  const participants = incoming.map((row) => {
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
  const own_seat = checkpoint.contract.fighters.findIndex(
    (fighter) => fighter.kind.type === 'player' && fighter.kind.owner === wallet
  )
  const previous_own = existing?.own_seat === null ? null : existing?.participants[existing.own_seat ?? -1]
  const next_own = own_seat < 0 ? null : participants[own_seat]
  return Object.freeze({
    ...state.fight_result,
    current: Object.freeze({
      fight: checkpoint.contract.id,
      winner: checkpoint.contract.winner === null ? null : Number(checkpoint.contract.winner),
      participants: Object.freeze(participants),
      own_seat: own_seat < 0 ? null : own_seat,
      resolution_synced:
        existing?.resolution_synced ??
        state.fight_result.resolutions.some(({ fight }) => fight === checkpoint.contract.id),
      error: existing?.error ?? null,
      result_open: existing?.result_open ?? true,
      level_up_open:
        existing?.level_up_open === true ||
        (!existing?.level_up_acknowledged &&
          !!next_own &&
          next_own.level_after > (previous_own?.level_before ?? next_own.level_before)),
      level_up_acknowledged: existing?.level_up_acknowledged ?? false,
    }),
  })
}

const merge_resolution = (participant: ResultParticipant, row: Readonly<FightResolutionRow>): ResultParticipant => {
  return Object.freeze({
    ...participant,
    level_before: participant.level_before,
    level_after: Math.max(participant.level_after, row.level),
    experience_after: Number(row.experience),
    dead: row.dead,
    settled: row.settled,
    xp_awarded: participant.xp_awarded,
    loot: merge_result_loot(participant.loot, aggregate_result_loot(row.drops)),
  })
}

const recover_result = (state: AppState, row: Readonly<FightResolutionRow>): FightResult => {
  const character = state.session.characters.find(({ id }) => id === row.character)
  const participant = Object.freeze({
    seat: row.fighter,
    team: row.team,
    character_id: row.character,
    name: character?.name ?? row.character,
    level_before: row.level,
    level_after: row.level,
    experience_before: Number(row.experience),
    experience_after: Number(row.experience),
    hp: row.dead ? 0 : 1,
    max_hp: 1,
    dead: row.dead,
    settled: row.settled,
    xp_awarded: 0,
    loot: aggregate_result_loot(row.drops),
  })
  return Object.freeze({
    fight: row.fight,
    winner: row.winner,
    participants: Object.freeze([participant]),
    own_seat: 0,
    resolution_synced: true,
    error: null,
    result_open: true,
    level_up_open: participant.level_after > participant.level_before,
    level_up_acknowledged: false,
  })
}

const fold_resolutions = (state: AppState, resolutions: readonly FightResolutionRow[]): AppState => {
  const current = state.fight_result.current ?? (resolutions[0] ? recover_result(state, resolutions[0]) : null)
  const matching = current ? resolutions.find(({ fight }) => fight === current.fight) : null
  const participants =
    current && matching
      ? current.participants.map((participant) =>
          participant.character_id === matching.character ? merge_resolution(participant, matching) : participant
        )
      : current?.participants.map((participant, seat) =>
          seat === current.own_seat && resolutions.length === 0
            ? Object.freeze({ ...participant, settled: true })
            : participant
        )
  const next_current = current
    ? Object.freeze({
        ...current,
        participants: Object.freeze(participants ?? current.participants),
        resolution_synced: true,
        level_up_open:
          current.level_up_open ||
          (!current.level_up_acknowledged &&
            !!participants?.some(
              (participant) =>
                participant.seat === current.own_seat && participant.level_after > participant.level_before
            )),
      })
    : null
  return Object.freeze({
    ...state,
    fight_result: Object.freeze({ current: next_current, resolutions: Object.freeze([...resolutions]) }),
  })
}

const fold_packet = (state: AppState, packet: Readonly<ServerPacket>): AppState => {
  if (packet.type === 'packet/fight_resolutions') return fold_resolutions(state, packet.resolutions)
  if (packet.type !== 'packet/fight_drops' || state.fight_result.current?.fight !== packet.fight) return state
  const fighter = Number(packet.fighter)
  const { current } = state.fight_result
  return Object.freeze({
    ...state,
    fight_result: Object.freeze({
      ...state.fight_result,
      current: Object.freeze({
        ...current,
        participants: Object.freeze(
          current.participants.map((participant) =>
            participant.seat === fighter
              ? Object.freeze({
                  ...participant,
                  loot: merge_result_loot(participant.loot, aggregate_result_loot(packet.drops)),
                })
              : participant
          )
        ),
      }),
    }),
  })
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'fight_result/checkpoint')
    return Object.freeze({ ...state, fight_result: merge_checkpoint(state, input.checkpoint) })
  if (input.type === 'server/packet') return fold_packet(state, input.packet)
  if (input.type === 'fight_result/claim_failed' && state.fight_result.current?.fight === input.fight)
    return Object.freeze({
      ...state,
      fight_result: Object.freeze({
        ...state.fight_result,
        current: Object.freeze({ ...state.fight_result.current, error: input.error }),
      }),
    })
  if (input.type === 'fight_result/retry' && state.fight_result.current)
    return Object.freeze({
      ...state,
      fight_result: Object.freeze({
        ...state.fight_result,
        current: Object.freeze({ ...state.fight_result.current, error: null }),
      }),
    })
  if (input.type === 'fight_result/level_acknowledged' && state.fight_result.current)
    return Object.freeze({
      ...state,
      fight_result: Object.freeze({
        ...state.fight_result,
        current: Object.freeze({
          ...state.fight_result.current,
          level_up_open: false,
          level_up_acknowledged: true,
        }),
      }),
    })
  if (input.type === 'fight_result/closed')
    return Object.freeze({
      ...state,
      fight_result: Object.freeze({
        ...state.fight_result,
        current: state.fight_result.current?.level_up_open
          ? Object.freeze({ ...state.fight_result.current, result_open: false })
          : state.fight_result.resolutions[0]
            ? recover_result(state, state.fight_result.resolutions[0])
            : null,
      }),
    })
  return state
}

type Attempt = Readonly<{ latched: boolean }>
const executed = (error: unknown): boolean => error instanceof Error && error.message.includes('failed on-chain')

export const next_fight_resolution_step = (
  row: Readonly<FightResolutionRow>
): Readonly<{ type: 'settle' }> | Readonly<{ type: 'claim'; item_type: string }> | null =>
  !row.settled
    ? Object.freeze({ type: 'settle' })
    : row.drops[0]
      ? Object.freeze({ type: 'claim', item_type: row.drops[0].item_type })
      : null

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state }) => {
  const attempts = new Map<string, Attempt>()
  let active: string | null = null
  let resolution_changed_while_active = false

  const sweep = (): void => {
    if (active) return
    const state = get_state()
    const { wallet, inventory, characters } = state.session
    if (!wallet || state.session.link_status !== 'ready') return
    const [pending] = state.fight_result.resolutions
    if (!pending) return
    if (!fight_result_available(state.fight, pending.fight)) return
    const step = next_fight_resolution_step(pending)
    if (!step) return
    const key = `${pending.fight}:${pending.fighter}:${step.type === 'claim' ? step.item_type : 'settle'}`
    if (attempts.get(key)?.latched) return
    const character = characters.find(({ id }) => id === pending.character)
    active = key
    const custody = character ? { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap } : undefined
    const existing =
      step.type === 'claim'
        ? stack_merge_target(inventory, state.marketplace.own_listings, step.item_type, custody?.kiosk)
        : null
    const transaction =
      step.type === 'claim'
        ? wallet.fight.claim_drop({
            fight: pending.fight,
            fighter_idx: BigInt(pending.fighter),
            item_type: step.item_type,
            existing,
            custody,
          })
        : wallet.fight.settle({ fight: pending.fight, fighter_idx: BigInt(pending.fighter), custody })
    void transaction
      .then(() => attempts.set(key, Object.freeze({ latched: true })))
      .catch((error: unknown) => {
        attempts.set(key, Object.freeze({ latched: executed(error) }))
        dispatch({
          type: 'fight_result/claim_failed',
          fight: pending.fight,
          error: error instanceof Error ? error.message : String(error),
        })
        toast.add(error)
      })
      .finally(() => {
        active = null
        if (resolution_changed_while_active) {
          resolution_changed_while_active = false
          sweep()
        }
      })
  }

  events.on('fight/reconciled', ({ checkpoint, mode }) => {
    if (mode === 'local') dispatch({ type: 'fight_result/checkpoint', checkpoint })
  })
  events.on('fight_result/retry', () => {
    const fight = get_state().fight_result.current?.fight
    if (fight) for (const key of [...attempts.keys()]) if (key.startsWith(`${fight}:`)) attempts.delete(key)
    sweep()
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.fight !== previous.fight) {
      sweep()
      return
    }
    if (state.fight_result.resolutions !== previous.fight_result.resolutions) {
      if (active) resolution_changed_while_active = true
      else sweep()
      return
    }
    if (
      state.session.inventory !== previous.session.inventory ||
      state.session.link_status !== previous.session.link_status
    )
      sweep()
  })
}

export const fight_result_complete = (state: Readonly<FightResultState>): boolean => {
  const result = state.current
  if (!result) return true
  if (result.own_seat === null) return true
  const own = result.participants[result.own_seat]
  return !!own?.settled && result.resolution_synced && !state.resolutions.some(({ fight }) => fight === result.fight)
}

export default Object.freeze({ name: 'fight_result', reduce, observe }) satisfies AppModule
