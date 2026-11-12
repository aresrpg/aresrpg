// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ClientPacket } from '@aresrpg/protocol'

import { create_locomotion } from './locomotion.ts'
import { idle_travels } from './idle.ts'
import type { Lane } from './control.ts'
import { validate_gameplay, type GameplayContext } from './gameplay.ts'
import { gameplay_observation_ready } from './gameplay_context.ts'

export const create_actor_locomotion = (
  options: Readonly<{
    context: () => GameplayContext
    available: () => boolean
    admit: () => Promise<void>
    wait_for_resume: () => Promise<unknown>
    send: (packet: ClientPacket) => Promise<boolean>
    idle_lane: () => Promise<Lane | null>
    report_failure: (error: unknown) => void
  }>
) => {
  const locomotion = create_locomotion()
  let idling: Promise<void> | null = null
  const idle_authorize = async () => {
    if (!options.available()) return null
    if (!gameplay_observation_ready(options.context())) return null
    const lane = await options.idle_lane()
    if (!lane || !options.available()) return null
    const travels = idle_travels(options.context(), lane)
    return travels?.length ? travels : null
  }
  const authorize = async () => {
    if (!options.available()) {
      locomotion.clear()
      throw new Error('needs_resync')
    }
    await options.admit()
    const plan = validate_gameplay(options.context())
    return 'travel' in plan ? (plan.travel ?? null) : null
  }
  return {
    idle: () => {
      if (idling) return
      idling = locomotion
        .idle(idle_authorize, options.send)
        .finally(async () => {
          if (options.available()) await locomotion.rest(options.send)
        })
        .catch((error) => {
          options.report_failure(error)
        })
        .finally(() => {
          idling = null
        })
    },
    settle_idle: async () => {
      await idling
    },
    observe: (status: string) => {
      if (['connecting', 'disconnected', 'failed', 'stopped'].includes(status)) locomotion.clear()
    },
    walk: async () => {
      try {
        await locomotion.walk(authorize, options.send)
        return true
      } catch (error) {
        // No transaction has been prepared: a maintenance pause retains the accepted intent.
        if (options.context().snapshot.frozen && (await options.wait_for_resume()) === null) return false
        throw error
      }
    },
  }
}
