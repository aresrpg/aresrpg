// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  CONTRACT_CONSTANTS,
  spell_level_of,
  weapon_level_of,
  type HydratedFightCheckpoint,
  type SpellLevel,
} from '@aresrpg/fight'

import {
  fight_checkpoint_id,
  gameplay_json,
  gameplay_observed_ms,
  hydrate_gameplay_fight,
  type GameplayContext,
} from './gameplay.ts'
import { profession_knowledge } from './profession_catalog.ts'
import { spell_knowledge } from './spell_catalog.ts'

type Context = Pick<GameplayContext, 'snapshot' | 'address' | 'now' | 'freshness_ms'>
type Definition = Readonly<Record<string, unknown>>
type Seat = Readonly<{
  fighter_idx: string
  character_id: string
  spells: readonly Readonly<{ name: string; definition: Definition }>[]
  weapon: Definition | null
}>
type Knowledge = Readonly<{
  professions?: ReturnType<typeof profession_knowledge>
  spells?: ReturnType<typeof spell_knowledge>
  available: boolean
  reason?: string
  guides: typeof guides
  timing: typeof timing
  fights: Readonly<
    Record<string, Readonly<{ checkpoint_id: string; active_fighter_idx: string | null; seats: readonly Seat[] }>>
  >
}>
const guides = Object.freeze({
  combat: 'https://aresrpg.world/agents/combat.txt',
  world: 'https://aresrpg.world/agents/world.txt',
})
const timing = Object.freeze({
  placement_force_ms: CONTRACT_CONSTANTS.placement_force_ms.toString(),
  turn_min_ms: CONTRACT_CONSTANTS.turn_min_ms.toString(),
  turn_max_ms: CONTRACT_CONSTANTS.turn_max_ms.toString(),
})
const wire_definition = (level: SpellLevel): Definition => JSON.parse(gameplay_json(level)) as Definition
const owned_seats = (context: Context, checkpoint: HydratedFightCheckpoint): readonly Seat[] =>
  checkpoint.contract.fighters.flatMap((fighter, index) => {
    if (fighter.kind.type !== 'player') return []
    const character_id = fighter.kind.character
    const character = context.snapshot.characters.find((row) => row.id === character_id)
    if (!character?.active_fight) return []
    const owns = [
      fighter.kind.owner === context.address,
      !fighter.settled,
      !fighter.forfeited,
      character.custody === 'fight',
      character.active_fight.id === checkpoint.contract.id,
      character.active_fight.seat === index,
    ].every(Boolean)
    if (!owns) return []
    const seat = BigInt(index)
    const weapon = weapon_level_of(checkpoint, seat)
    return [
      {
        fighter_idx: seat.toString(),
        character_id,
        weapon: weapon ? wire_definition(weapon) : null,
        spells: Object.keys(checkpoint.sources.spells).flatMap((name) => {
          const level = spell_level_of(checkpoint, seat, name)
          return level ? [{ name, definition: wire_definition(level) }] : []
        }),
      },
    ]
  })
/** Read-only planning context from the same authored content and fight twin used for validation.
 * It grants no authority; every write is independently rechecked at signing and submission. */
export const gameplay_knowledge = (
  context: Context,
  recipes?: readonly string[],
  spells?: readonly string[]
): Knowledge => {
  try {
    gameplay_observed_ms(context)
  } catch {
    return { available: false, reason: 'needs_resync', guides, timing, fights: {} }
  }
  const fights = Object.fromEntries(
    Object.entries(context.snapshot.fights).flatMap(([id, row]) => {
      const checkpoint = hydrate_gameplay_fight(row)
      const seats = owned_seats(context, checkpoint)
      if (seats.length === 0) return []
      const active = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]
      return [[id, { checkpoint_id: fight_checkpoint_id(row), active_fighter_idx: active?.toString() ?? null, seats }]]
    })
  )
  return {
    available: true,
    guides,
    timing,
    fights,
    professions: profession_knowledge(context.snapshot, recipes),
    ...(spells ? { spells: spell_knowledge(context.snapshot.characters, spells) } : {}),
  }
}
