// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  PROFILE_PAGE_SIZE,
  type InspectionQuery,
  type InspectionResult,
  type ProfileCharacter,
  type EquippedItem,
} from '@aresrpg/protocol'

import type { Graph, Node } from '../graph.ts'

import { PROFILE_JOB_COLUMNS, profile_jobs } from './profile_jobs.ts'
import { shape_item } from './stat_block.ts'

export const get_player_profile = async (
  graph: Graph,
  { address, after }: Extract<InspectionQuery, { kind: 'profile' }>
): Promise<Extract<InspectionResult, { kind: 'profile' }>> => {
  const [summary, rows] = await Promise.all([
    graph.read(`MATCH (c:Character {owner: $address}) RETURN count(c) AS total, ${PROFILE_JOB_COLUMNS}`, { address }),
    graph.read(
      `MATCH (c:Character {owner: $address}) WHERE c.id > $after
      RETURN c.id AS id, c.name AS name, c.classe AS classe, c.level AS level
      ORDER BY c.id LIMIT ${PROFILE_PAGE_SIZE + 1}`,
      { address, after: after ?? '' }
    ),
  ])
  const characters = rows.slice(0, PROFILE_PAGE_SIZE) as ProfileCharacter[]
  const character_count = Number(summary[0]?.total ?? 0)
  return {
    kind: 'profile',
    profile: {
      characters,
      character_count,
      next: rows.length > PROFILE_PAGE_SIZE ? characters.at(-1)!.id : null,
      jobs: character_count ? profile_jobs(summary[0] ?? {}) : [],
    },
  }
}

export const get_profile_equipment = async (
  graph: Graph,
  { address, character_id }: Extract<InspectionQuery, { kind: 'equipment' }>
): Promise<Extract<InspectionResult, { kind: 'equipment' }>> => {
  const rows = await graph.read(
    `MATCH (c:Character {id: $character_id, owner: $address})
    OPTIONAL MATCH (c)-[e:EQUIPS]->(i:Item)
    RETURN e.slot AS slot, i AS item`,
    { address, character_id }
  )
  // An owned, bare character returns one null optional row; a transferred/deleted character returns none.
  const equipment = rows.flatMap(({ slot, item }) => {
    const node = item as Node
    return node ? [{ slot, ...shape_item(node.properties) } as EquippedItem] : []
  })
  return { kind: 'equipment', equipment: rows.length ? equipment : null }
}

export const read_inspection = (graph: Graph, query: InspectionQuery): Promise<InspectionResult> =>
  query.kind === 'profile' ? get_player_profile(graph, query) : get_profile_equipment(graph, query)
