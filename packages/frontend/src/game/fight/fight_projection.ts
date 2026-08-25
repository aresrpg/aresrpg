// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One presentation projection for every fight surface. It joins combat truth with display
// identity, but stores nothing: HUD and engine consume the same immutable result.

import {
  CONTRACT_CONSTANTS,
  living_count,
  player_max_hp,
  players_ready_after,
  project_spell_turn,
  project_weapon_turn,
  weapon_level_of,
  type ActiveEffect,
  type Fighter,
  type FightMode,
  type HydratedFightCheckpoint,
  type SpellLevel,
  type SpellSource,
  type SpellTurnProjection,
} from '@aresrpg/fight'
import type { FightPresentationCue } from '@aresrpg/engine'

export const turn_seconds_remaining = (turn_started_ms: bigint, now: number): number =>
  Math.max(0, Math.ceil((Number(turn_started_ms + CONTRACT_CONSTANTS.turn_max_ms) - now) / 1_000))

export const presented_turn_after_cue = (
  current: bigint | null,
  cue: Readonly<FightPresentationCue>,
  phase: 'start' | 'complete'
): bigint | null => {
  if (cue.type !== 'turn') return current
  const seat = Number(cue.entity_id.split('_').at(-1))
  if (!Number.isInteger(seat)) return current
  // Completion of the TURN cue is not completion of the turn: the presenter holds the card until
  // the next turn cue while movement/casts play. The whole presentation batch clears it.
  return phase === 'start' ? BigInt(seat) : current
}

export const presented_turn_after_queue = (current: bigint | null, queued_batches: number): bigint | null =>
  queued_batches > 0 ? current : null

export type FightSpellView = Readonly<{
  name: string
  level: bigint
  details: SpellLevel
  source: SpellSource
  cooldown: bigint
  turn: SpellTurnProjection | null
}>

export type FightWeaponView = Readonly<{
  bare_hands: boolean
  details: SpellLevel
  turn: SpellTurnProjection | null
}>

export type FightActionSelection = Readonly<{ type: 'spell'; name: string }> | Readonly<{ type: 'weapon' }> | null

export type FightFighterView = Readonly<{
  seat: bigint
  team: bigint
  name: string
  level: bigint
  character_id: string | null
  mob_type: string | null
  owned: boolean
  active: boolean
  dead: boolean
  settled: boolean
  hp: bigint
  max_hp: bigint
  ap: bigint
  mp: bigint
  effects: readonly ActiveEffect[]
  weapon: FightWeaponView | null
  spells: readonly FightSpellView[]
}>

export type FightView = Readonly<{
  phase: 'placement' | 'active' | 'ended'
  active_seat: bigint | null
  selected: FightFighterView | null
  timeline: readonly FightFighterView[]
  placement_deadline_ms: bigint | null
  can_end_turn: boolean
  can_forfeit: boolean
  /** both sides hold a living fighter — the chain's own precondition for starting a fight */
  sides_manned: boolean
  /** this selected player's ready transaction also starts the fight */
  ready_starts_fight: boolean
  /** the 45-second force-pass matters only when another human can invoke it */
  show_turn_timer: boolean
}>

export type FightFighterDisplay = Readonly<{ seat: number; hp: string; dead: boolean }>

export const fight_view_with_display = (
  view: Readonly<FightView>,
  display: readonly FightFighterDisplay[]
): FightView => {
  if (display.length === 0) return view
  const by_seat = new Map(display.map((row) => [row.seat, row]))
  const timeline = Object.freeze(
    view.timeline.map((fighter) => {
      const row = by_seat.get(Number(fighter.seat))
      return row ? Object.freeze({ ...fighter, hp: BigInt(row.hp), dead: row.dead }) : fighter
    })
  )
  const selected = view.selected ? (timeline.find(({ seat }) => seat === view.selected?.seat) ?? view.selected) : null
  return Object.freeze({ ...view, timeline, selected })
}

const fighter_max_hp = (checkpoint: Readonly<HydratedFightCheckpoint>, fighter: Readonly<Fighter>): bigint =>
  fighter.kind.type === 'mob'
    ? fighter.kind.snapshot.max_hp
    : player_max_hp(checkpoint.sources.players[fighter.kind.character])

const fighter_spells = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  fighter: Readonly<Fighter>,
  seat: bigint,
  active_seat: bigint | null
): readonly FightSpellView[] => {
  if (fighter.kind.type !== 'player') return Object.freeze([])
  const source = checkpoint.sources.players[fighter.kind.character]
  if (!source) return Object.freeze([])
  return Object.freeze(
    Object.entries(checkpoint.sources.spells)
      .flatMap(([name, spell]) => {
        if (spell.classe !== source.classe || source.level < spell.unlock_level) return []
        const level = source.spell_levels[name] ?? 1n
        const details = spell.levels[Number(level - 1n)]
        if (!details) return []
        const turn = seat === active_seat ? project_spell_turn(checkpoint, seat, name) : null
        return [
          Object.freeze({
            name,
            level,
            details,
            source: spell,
            cooldown: fighter.cooldowns.find((row) => row.spell === name)?.left ?? 0n,
            turn,
          }),
        ]
      })
      .toSorted((left, right) =>
        left.source.unlock_level === right.source.unlock_level
          ? left.name.localeCompare(right.name)
          : Number(left.source.unlock_level - right.source.unlock_level)
      )
  )
}

const selected_seat = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  owner: string | null,
  active_seat: bigint | null,
  character_id: string | null
): bigint | null => {
  const { fighters, queue, turn_ptr } = checkpoint.contract
  if (character_id) {
    const seat = fighters.findIndex(
      (fighter) =>
        fighter.kind.type === 'player' &&
        fighter.kind.character === character_id &&
        fighter.kind.owner === owner &&
        !fighter.settled
    )
    return seat < 0 ? null : BigInt(seat)
  }
  const owned = (seat: bigint): boolean => {
    const fighter = fighters[Number(seat)]
    return (
      !!fighter && !fighter.dead && !fighter.settled && fighter.kind.type === 'player' && fighter.kind.owner === owner
    )
  }
  if (queue.length === 0 || active_seat === null)
    return fighters.reduce<bigint | null>(
      (found, _, index) => found ?? (owned(BigInt(index)) ? BigInt(index) : null),
      null
    )
  return queue.map((_, offset) => queue[(Number(turn_ptr) + offset) % queue.length]!).find(owned) ?? null
}

export const select_fight_view = ({
  checkpoint,
  mode,
  owner,
  character_id = null,
  canonical_ended = false,
  names,
}: Readonly<{
  checkpoint: HydratedFightCheckpoint
  mode: FightMode
  owner: string | null
  character_id?: string | null
  canonical_ended?: boolean
  names: Readonly<Record<string, string>>
}>): FightView => {
  const { contract } = checkpoint
  const phase =
    contract.ended && (mode === 'local' || canonical_ended) ? 'ended' : contract.round === 0n ? 'placement' : 'active'
  const active_seat = phase === 'active' ? (contract.queue[Number(contract.turn_ptr)] ?? null) : null
  const focus = selected_seat(checkpoint, owner, active_seat, character_id)
  const project = (seat: bigint): FightFighterView => {
    const fighter = contract.fighters[Number(seat)]!
    const character_id = fighter.kind.type === 'player' ? fighter.kind.character : null
    const fallback_name = fighter.kind.type === 'player' ? fighter.kind.character : fighter.kind.snapshot.mob_type
    const player_source = fighter.kind.type === 'player' ? checkpoint.sources.players[fighter.kind.character] : null
    const weapon_level = weapon_level_of(checkpoint, seat)
    return Object.freeze({
      seat,
      team: fighter.team,
      name: names[character_id ?? fallback_name] ?? player_source?.name ?? fallback_name,
      level:
        fighter.kind.type === 'mob'
          ? fighter.kind.snapshot.level
          : (checkpoint.sources.players[fighter.kind.character]?.level ?? 1n),
      character_id,
      mob_type: fighter.kind.type === 'mob' ? fighter.kind.snapshot.mob_type : null,
      owned: fighter.kind.type === 'player' && fighter.kind.owner === owner,
      active: seat === active_seat,
      dead: fighter.dead,
      settled: fighter.settled,
      hp: fighter.hp,
      max_hp: fighter_max_hp(checkpoint, fighter),
      ap: fighter.ap,
      mp: fighter.mp,
      effects: Object.freeze([...fighter.effects]),
      weapon:
        player_source && weapon_level
          ? Object.freeze({
              bare_hands: !player_source.weapon || player_source.weapon.damages.length === 0,
              details: weapon_level,
              turn: seat === active_seat ? project_weapon_turn(checkpoint, seat) : null,
            })
          : null,
      spells: fighter_spells(checkpoint, fighter, seat, active_seat),
    })
  }
  const timeline_seats = contract.queue.length > 0 ? contract.queue : contract.fighters.map((_, index) => BigInt(index))
  const timeline = Object.freeze(timeline_seats.map(project))
  const selected = focus === null ? null : project(focus)
  return Object.freeze({
    phase,
    active_seat,
    selected,
    timeline,
    placement_deadline_ms:
      phase === 'placement' && mode === 'remote' ? contract.placement_ms + CONTRACT_CONSTANTS.placement_force_ms : null,
    can_end_turn: phase === 'active' && selected?.seat === active_seat && !!selected.owned,
    can_forfeit: phase !== 'ended' && !!selected?.owned && !selected.dead && !selected.settled,
    // Both sides hold a living fighter. The chain refuses to start otherwise — "nobody fights
    // an empty side; a challenge nobody accepted exits via placement-forfeit" (fight.move
    // `start`) — so a UI that offers a start here would only ever compose an aborting
    // transaction. This says NOTHING about readiness or the placement deadline.
    sides_manned: living_count(contract.fighters, 0n) > 0n && living_count(contract.fighters, 1n) > 0n,
    ready_starts_fight: phase === 'placement' && focus !== null && players_ready_after(contract.fighters, focus),
    show_turn_timer: contract.fighters.filter((fighter) => fighter.kind.type === 'player').length > 1,
  })
}
