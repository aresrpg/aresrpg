// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { assert_lease, create_control_service, lane_key_for, type Lane, type Observe } from './control.ts'
import type { BotConfig } from './model.ts'
import type { LocalOwnerControl } from './owner_control.ts'
import type { ControlStore } from './store.ts'

/** This fails if ownership changes after routing but before the control mutation commits.
 * Include the lane in every CAS and check the same fence at both transaction boundaries. */
export const create_owner_dispatch =
  (store: ControlStore, config: BotConfig, observe: Observe, now = Date.now): LocalOwnerControl =>
  async (grant, method, args, expected) => {
    const key = lane_key_for(grant)
    const guard = (lane: Lane | null) => {
      if (now() >= expected.deadline) throw new Error('observation_timeout')
      assert_lease(lane, expected.actor_id, expected.fence, now())
      if (lane?.transport_stopped) throw new Error('ACTOR_TERMINAL')
    }
    const fenced: ControlStore = {
      ...store,
      transaction: (keys, operation) =>
        store.transaction([...new Set([...keys, key])], async (tx) => {
          guard(await tx.get<Lane>(key))
          const value = await operation(tx)
          guard(await tx.get<Lane>(key))
          return value
        }),
    }
    guard(await store.read<Lane>(key))
    const local = create_control_service(fenced, config, config.observation_freshness_ms, now, observe)
    const operation = local[method] as (
      current: import('./model.ts').Grant,
      ...args: readonly unknown[]
    ) => Promise<unknown>
    return operation(grant, ...args)
  }
