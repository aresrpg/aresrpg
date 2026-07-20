// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Cross-module RED cases — the flow must survive a file hop.
import { fight_slice } from './projection.js'
import { use_fight, use_hud } from './stores.js'

// RED 5 — A's state reaches B's write through an exported projection (interprocedural return flow).
export const adopt_projection = () => use_hud.setState({ fight: fight_slice() })

// RED 6 — a hook-selected value copied into another store: component glue is still a copy.
export const HudBridge = () => {
  const fight = use_fight((s) => s.fight)
  use_hud.setState({ fight })
  return null
}
