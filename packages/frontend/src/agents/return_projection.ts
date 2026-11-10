// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import type { AgentReturnProjection } from '@aresrpg/sdk/agent-return'

import type { AuthSession } from '../auth.ts'
import { dispatch_app, read_app_state, subscribe_app } from '../store.ts'

import { same_inventory_pairing } from './inventory_state.ts'

/** Subscribe before requesting the normal account baseline; receipt conditions advance on real packets, never a delay. */
export const read_return_projection = (
  wallet: AuthSession,
  pairing: AgentPairingIdentity,
  accept: (value: AgentReturnProjection) => boolean = () => true
): Promise<AgentReturnProjection> =>
  new Promise((resolve, reject) => {
    let stop = () => {}
    const serial = read_app_state().session.agent_inventory.serial + 1
    const changed = () => {
      const { session } = read_app_state()
      const view = session.agent_inventory
      if (session.wallet !== wallet || !same_inventory_pairing(session.inventory_pairing, pairing)) {
        stop()
        reject(new Error('The return wallet changed.'))
        return
      }
      if (session.link_status !== 'ready' || view.phase === 'failed') {
        stop()
        reject(new Error('The inventory connection is unavailable.'))
        return
      }
      if (view.serial < serial || view.phase !== 'ready') return
      const value = {
        characters: view.characters,
        inventory: view.inventory,
        fights: view.fights,
        resolutions: view.resolutions,
      }
      if (!accept(value)) return
      stop()
      resolve(value)
    }
    stop = subscribe_app(changed)
    dispatch_app({ type: 'agent/inventory_refresh' })
    changed()
  })
