// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { DungeonLobbyFightRow, DungeonLobbyPlayerRow, DungeonLobbyRow } from '@aresrpg/protocol'

import type { Graph, Node } from '../graph.ts'

const player_row = (row: Record<string, unknown>): DungeonLobbyPlayerRow =>
  Object.freeze({
    character_id: String(row.character_id),
    name: String(row.name),
    level: Number(row.level),
    room: Number(row.room),
  })

export const get_dungeon_lobby = async (
  graph: Graph,
  { world, x, z }: Readonly<{ world: string; x: number; z: number }>
): Promise<DungeonLobbyRow> => {
  const [occupant_rows, fight_rows] = await Promise.all([
    graph.read(
      `
      MATCH (c:Character {dungeon_world: $world, dungeon_x: $x, dungeon_z: $z})
      RETURN c.id AS character_id, c.name AS name, c.level AS level, c.dungeon_room AS room`,
      { world, x, z }
    ),
    graph.read(
      `
      MATCH (f:Fight {world: $world, x: $x, z: $z})
      WHERE f.dungeon_room IS NOT NULL AND f.phase <> 'ended'
      OPTIONAL MATCH (f)-[:FIGHTER]->(c:Character)
      RETURN f AS fight, collect({ character_id: c.id, name: c.name, level: c.level, room: c.dungeon_room }) AS players`,
      { world, x, z }
    ),
  ])
  const players = Object.freeze(
    occupant_rows.map(player_row).sort((left, right) => left.name.localeCompare(right.name))
  )
  const fights = Object.freeze(
    fight_rows
      .map((row): DungeonLobbyFightRow => {
        const fight = (row.fight as Exclude<Node, null | undefined>).properties
        const fight_players = ((row.players as Record<string, unknown>[]) ?? [])
          .filter(({ character_id }) => character_id !== null && character_id !== undefined)
          .map(player_row)
          .sort((left, right) => left.name.localeCompare(right.name))
        return Object.freeze({
          id: String(fight.id),
          room: Number(fight.dungeon_room),
          phase: String(fight.phase),
          access: Number(fight.access_a),
          opener: typeof fight.opener_a === 'string' ? fight.opener_a : null,
          players: Object.freeze(fight_players),
        })
      })
      .sort((left, right) => left.room - right.room || left.id.localeCompare(right.id))
  )
  return Object.freeze({ world, x, z, players, fights })
}
