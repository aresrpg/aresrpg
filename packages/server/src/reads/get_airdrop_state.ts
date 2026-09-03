// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mutable airdrop truth. Immutable presentation stays in seed/ and never enters the graph packet.

import type { AirdropState } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

const properties_of = (node: Node): Record<string, unknown> => node?.properties ?? {}

export async function get_airdrop_state(
  graph: Graph,
  { address }: { address: string }
): Promise<readonly AirdropState[]> {
  const holder = address.toLowerCase()
  const airdrop_rows = await graph.read(`MATCH (a:Airdrop) RETURN a AS airdrop`)
  return Object.freeze(
    airdrop_rows.map(({ airdrop }) => {
      const properties = properties_of(airdrop as Node)
      const whitelist = Array.isArray(properties.whitelist) ? (properties.whitelist as string[]) : []
      return {
        drop_id: String(properties.drop_id),
        eligible: whitelist.some((candidate) => candidate.toLowerCase() === holder),
        eligible_count: whitelist.length,
      }
    })
  )
}
