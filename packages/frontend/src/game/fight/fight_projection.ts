// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One presentation projection for every fight surface. It joins combat truth with display
// identity, but stores nothing: HUD and engine consume the same immutable result.

import {
  CONTRACT_CONSTANTS,
  player_max_hp,
  type ActiveEffect,
  type Fighter,
  type FightMode,
  type HydratedFightCheckpoint,
  type SpellLevel,
} from '@aresrpg/fight'

export type FightSpellView = Readonly<{
  name: string
  level: bigint
  details: SpellLevel
  cooldown: bigint
}>

export type FightFighterView = Readonly<{
  seat: bigint
  team: bigint
  name: string
  level: bigint
  character_id: string | null
  owned: boolean
  active: boolean
  dead: boolean
  settled: boolean
  hp: bigint
  max_hp: bigint
  ap: bigint
  mp: bigint
  effects: readonly ActiveEffect[]
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
}>

const fighter_max_hp = (checkpoint: Readonly<HydratedFightCheckpoint>, fighter: Readonly<Fighter>): bigint =>
  fighter.kind.type === 'mob'
    ? fighter.kind.snapshot.max_hp
    : player_max_hp(checkpoint.sources.players[fighter.kind.character])

const fighter_spells = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  fighter: Readonly<Fighter>
): readonly FightSpellView[] => {
  if (fighter.kind.type !== 'player') return Object.freeze([])
  const source = checkpoint.sources.players[fighter.kind.character]
  if (!source) return Object.freeze([])
  return Object.freeze(
    Object.entries(checkpoint.sources.spells).flatMap(([name, spell]) => {
      if (spell.classe !== source.classe || source.level < spell.unlock_level) return []
      const level = source.spell_levels[name] ?? 1n
      const details = spell.levels[Number(level - 1n)]
      if (!details) return []
      return [
        Object.freeze({
          name,
          level,
          details,
          cooldown: fighter.cooldowns.find((row) => row.spell === name)?.left ?? 0n,
        }),
      ]
    })
  )
}

const selected_seat = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  owner: string | null,
  active_seat: bigint | null
): bigint | null => {
  const { fighters, queue, turn_ptr } = checkpoint.contract
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
  names,
}: Readonly<{
  checkpoint: HydratedFightCheckpoint
  mode: FightMode
  owner: string | null
  names: Readonly<Record<string, string>>
}>): FightView => {
  const { contract } = checkpoint
  const phase = contract.ended ? 'ended' : contract.round === 0n ? 'placement' : 'active'
  const active_seat = phase === 'active' ? (contract.queue[Number(contract.turn_ptr)] ?? null) : null
  const focus = selected_seat(checkpoint, owner, active_seat)
  const project = (seat: bigint): FightFighterView => {
    const fighter = contract.fighters[Number(seat)]!
    const character_id = fighter.kind.type === 'player' ? fighter.kind.character : null
    const fallback_name = fighter.kind.type === 'player' ? fighter.kind.character : fighter.kind.snapshot.mob_type
    return Object.freeze({
      seat,
      team: fighter.team,
      name: names[character_id ?? fallback_name] ?? fallback_name,
      level:
        fighter.kind.type === 'mob'
          ? fighter.kind.snapshot.level
          : (checkpoint.sources.players[fighter.kind.character]?.level ?? 1n),
      character_id,
      owned: fighter.kind.type === 'player' && fighter.kind.owner === owner,
      active: seat === active_seat,
      dead: fighter.dead,
      settled: fighter.settled,
      hp: fighter.hp,
      max_hp: fighter_max_hp(checkpoint, fighter),
      ap: fighter.ap,
      mp: fighter.mp,
      effects: Object.freeze([...fighter.effects]),
      spells: fighter_spells(checkpoint, fighter),
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
  })
}
