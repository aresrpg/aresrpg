// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_player as mount_player } from '../../src/player.ts'
import { create_public_market } from '../../src/public_market.ts'
import { create_public_world } from '../../src/public_world.ts'

type Wires = Parameters<typeof mount_player>[0]
/** Isolated tests own a runtime; multi-connection fixtures inject their shared public_world. */
export const create_player = (
  wires: Omit<Wires, 'public_world' | 'public_market'> & Partial<Pick<Wires, 'public_world' | 'public_market'>>
) =>
  mount_player({
    ...wires,
    public_world: wires.public_world ?? create_public_world(wires.graph, wires.pubsub.graph),
    public_market: wires.public_market ?? create_public_market(wires.graph, wires.pubsub.graph),
  })
