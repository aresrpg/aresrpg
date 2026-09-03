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
  { dungeon }: Readonly<{ dungeon: string }>
): Promise<DungeonLobbyRow> => {
  const [occupant_rows, fight_rows] = await Promise.all([
    graph.read(
      `
      MATCH (c:Character {dungeon: $dungeon})
      RETURN c.id AS character_id, c.name AS name, c.level AS level, c.dungeon_room AS room`,
      { dungeon }
    ),
    graph.read(
      `
      MATCH (f:Fight {dungeon: $dungeon})
      WHERE f.phase <> 'ended'
      OPTIONAL MATCH (f)-[:FIGHTER]->(c:Character)
      RETURN f AS fight, collect({ character_id: c.id, name: c.name, level: c.level, room: c.dungeon_room }) AS players`,
      { dungeon }
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
  return Object.freeze({ dungeon, players, fights })
}
