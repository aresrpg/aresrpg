// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The client already derived the Character ID from NameRegistry + name. This read answers only
// the non-derivable fact: the wallet that currently owns the kiosk/fight custody position.

import type { Graph } from '../graph.ts'

export type CharacterRecipient = Readonly<{
  character_id: string
  name: string
  owner: string
}>

export async function get_character_owner(
  graph: Graph,
  { character_id }: Readonly<{ character_id: string }>
): Promise<CharacterRecipient | null> {
  const [row] = await graph.read(
    `MATCH (c:Character {id: $character_id})
     WHERE c.owner IS NOT NULL
     RETURN c.id AS character_id, c.name AS name, c.owner AS owner
     LIMIT 1`,
    { character_id }
  )
  if (!row || typeof row.character_id !== 'string' || typeof row.name !== 'string' || typeof row.owner !== 'string')
    return null
  return Object.freeze({ character_id: row.character_id, name: row.name, owner: row.owner })
}
