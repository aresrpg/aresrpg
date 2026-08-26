// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { KolizeumFighterRow, KolizeumLobbyRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

type MachineFighter = Readonly<{
  team: number
  settled: boolean
  kind: Readonly<{ player?: Readonly<{ character: string; owner: string; level: number }> }>
}>

const allowed_addresses = (value: unknown): readonly string[] => {
  const decoded = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!Array.isArray(decoded)) throw new Error('Kolizeum allowed-list projection is not an array.')
  return decoded.map(String)
}

const format_of = (value: unknown): 1 | 3 | 6 => {
  const format = Number(value)
  if (format !== 1 && format !== 3 && format !== 6) throw new Error(`Invalid projected Kolizeum format: ${format}`)
  return format
}

const team_of = (value: unknown): 0 | 1 => {
  const team = Number(value)
  if (team !== 0 && team !== 1) throw new Error(`Invalid projected Kolizeum team: ${team}`)
  return team
}

export async function get_kolizeums(graph: Graph, { address }: Readonly<{ address: string }>) {
  const rows = await graph.read(
    `MATCH (k:Kolizeum)
     OPTIONAL MATCH (f:Fight {id: k.fight_id})
     RETURN k AS kolizeum, f AS fight
     ORDER BY k.ckpt DESC
     LIMIT 100`,
    { address }
  )
  const decoded = rows.flatMap((row) => {
    if (!row.kolizeum || !row.fight) return []
    const kolizeum = (row.kolizeum as Node)!.properties
    const fight = (row.fight as Node)!.properties
    const machine = JSON.parse(String(fight.machine ?? '{}')) as { fighters?: MachineFighter[] }
    return [{ kolizeum, fight, fighters: machine.fighters ?? [] }]
  })
  const character_ids = [
    ...new Set(
      decoded.flatMap(({ fighters }) => fighters.flatMap(({ kind }) => (kind.player ? [kind.player.character] : [])))
    ),
  ]
  const characters = character_ids.length
    ? await graph.read(
        `MATCH (c:Character) WHERE c.id IN ${JSON.stringify(character_ids)}
         RETURN c.id AS id, c.name AS name, c.classe AS classe, c.level AS level`,
        { address }
      )
    : []
  const names = new Map(characters.map((row) => [String(row.id), row]))
  return decoded.map(({ kolizeum, fight, fighters }): KolizeumLobbyRow => {
    const player_fighters = fighters.flatMap((fighter, seat): KolizeumFighterRow[] => {
      if (!fighter.kind.player || (fight.phase === 'placement' && fighter.settled)) return []
      const character = names.get(fighter.kind.player.character)
      return [
        Object.freeze({
          seat,
          team: team_of(fighter.team),
          character_id: fighter.kind.player.character,
          name: String(character?.name ?? fighter.kind.player.character),
          classe: String(character?.classe ?? ''),
          level: Number(character?.level ?? fighter.kind.player.level),
          settled: Boolean(fighter.settled),
        }),
      ]
    })
    const creator = fighters.find(({ kind }) => kind.player)?.kind.player?.owner ?? ''
    const allowed =
      kolizeum.allowed === null || kolizeum.allowed === undefined ? null : allowed_addresses(kolizeum.allowed)
    return Object.freeze({
      id: String(kolizeum.id),
      fight: String(kolizeum.fight_id),
      creator,
      format: format_of(kolizeum.format),
      pledge_mist: String(kolizeum.pledge ?? 0),
      pot_mist: String(kolizeum.pot ?? 0),
      level_min: Number(kolizeum.level_min),
      level_max: Number(kolizeum.level_max),
      public: allowed === null,
      can_join: allowed === null || allowed.includes(address),
      status: fight.phase === 'placement' ? 'open' : fight.phase === 'ended' ? 'settling' : 'started',
      fighters: Object.freeze(player_fighters),
    })
  })
}
