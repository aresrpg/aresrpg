// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { zone_of, type PresenceRow } from '@aresrpg/protocol'

import { mesh, type MeshFact } from './protocol.ts'
import { create_watcher, type Pubsub } from './pubsub_bus.ts'
import logger from './logger.ts'

const log = logger(import.meta)
/** Probe replies belong to one connection and one acquisition of its zone window. */
export const presence_discovery = (
  pubsub: Pubsub,
  signal: AbortSignal,
  address: string,
  receive: (player: PresenceRow, owner: string) => void
) => {
  const { watch } = create_watcher(pubsub, signal)
  const reply_to = mesh.presence_reply(crypto.randomUUID())
  const requests = new Map<string, string>()
  const ready = watch(reply_to, (fact: MeshFact) => {
    if (fact.kind !== 'reply') return
    const { zx, zz } = zone_of(fact.player.x, fact.player.z)
    if (requests.get(`${fact.player.world}:${zx}:${zz}`) !== fact.request) return
    receive(fact.player, fact.address)
  })
  return {
    retain: (wanted: ReadonlySet<string>): void => {
      for (const key of requests.keys()) if (!wanted.has(key)) requests.delete(key)
    },
    probe: (world: string, zx: number, zz: number): void => {
      const request = crypto.randomUUID()
      requests.set(`${world}:${zx}:${zz}`, request)
      void ready
        .then(async () => {
          if (signal.aborted || requests.get(`${world}:${zx}:${zz}`) !== request) return
          await pubsub.mesh.publish(mesh.pos(world, zx, zz), { kind: 'who', address, world, zx, zz, reply_to, request })
        })
        .catch((error: unknown) => log.warn({ err: error, world, zx, zz }, 'presence discovery failed'))
    },
  }
}
