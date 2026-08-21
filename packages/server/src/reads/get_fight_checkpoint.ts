// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The full projected fight for client hydration — @aresrpg/fight replays it as-is. The
// contract is the indexer's machine document reshaped only where the graph's storage form
// differs from the fight core's decode form (fighter kind tagging); every player fighter's
// replay source joins from its Character node: base stats, the chain's OWN folded gear total
// (equipment::FoldedKey projection — never recomputed here), the spell book, and the equipped
// weapon's damage lines. Spell templates are seed content the client already holds.

import type { FightPlayerSourceRow, FightStateRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

import { stats_record_of } from './stat_block.ts'

type MachineFighter = {
  kind: { player?: { character: string; owner: string }; mob?: Record<string, unknown> }
} & Record<string, unknown>

/** graph storage form → fight-core decode form (the only reshape this read performs) */
const tag_fighter_kind = (fighter: MachineFighter) => ({
  ...fighter,
  kind: fighter.kind.player ? { type: 'player', ...fighter.kind.player } : { type: 'mob', snapshot: fighter.kind.mob },
})

const weapon_of = (item: Record<string, unknown> | null): FightPlayerSourceRow['weapon'] => {
  if (!item) return null
  const damages = typeof item.damages === 'string' ? (JSON.parse(item.damages) as Record<string, unknown>[]) : []
  return {
    category: String(item.category ?? ''),
    damages: damages.map((line) => ({
      element: String(line.element),
      from: String(line.from),
      to: String(line.to),
    })),
  }
}

const player_source_of = (character: Record<string, unknown>, weapon: Record<string, unknown> | null) =>
  ({
    name: String(character.name),
    classe: String(character.classe),
    level: Number(character.level),
    vitality: Number(character.vitality),
    wisdom: Number(character.wisdom),
    strength: Number(character.strength),
    intelligence: Number(character.intelligence),
    chance: Number(character.chance),
    agility: Number(character.agility),
    spell_levels: typeof character.spells === 'string' ? (JSON.parse(character.spells) as Record<string, number>) : {},
    folded_stats: stats_record_of(character.folded_stats),
    weapon: weapon_of(weapon),
  }) satisfies FightPlayerSourceRow

export async function get_fight_checkpoint(
  graph: Graph,
  { fight_id }: { fight_id: string }
): Promise<FightStateRow | null> {
  const rows = await graph.read(
    `MATCH (f:Fight {id: $fight_id})
     OPTIONAL MATCH (f)-[:FIGHTER]->(c:Character)
     OPTIONAL MATCH (c)-[:EQUIPS {slot: 'weapon'}]->(w:Item)
     RETURN f AS fight, collect({ character: c, weapon: w }) AS seats`,
    { fight_id }
  )
  const [row] = rows
  if (!row?.fight) return null
  const fight = (row.fight as Exclude<Node, null | undefined>).properties
  const machine = JSON.parse((fight.machine as string) ?? '{}') as Record<string, unknown> & {
    fighters?: MachineFighter[]
  }
  const contract = {
    ...machine,
    fighters: (machine.fighters ?? []).map(tag_fighter_kind),
    id: fight.id,
    world: fight.world,
    x: fight.x,
    z: fight.z,
    access_a: fight.access_a,
    access_b: fight.access_b,
    ended: fight.phase === 'ended',
    winner: fight.winner ?? null,
    dungeon: fight.dungeon_room ?? null,
    managed: Boolean(fight.managed),
    wagered: Boolean(fight.wagered),
    drops_rolled: Boolean(fight.drops_rolled),
    turn_ptr: fight.turn_ptr,
    round: fight.round,
    turn_seed: fight.turn_seed,
    placement_ms: fight.placement_ms,
    turn_started_ms: fight.turn_started_ms,
  }
  const players = Object.fromEntries(
    (row.seats as { character: Node; weapon: Node }[])
      .filter((seat) => seat.character)
      .map((seat) => [
        seat.character!.properties.id as string,
        player_source_of(seat.character!.properties, seat.weapon?.properties ?? null),
      ])
  )
  return { contract, players }
}
