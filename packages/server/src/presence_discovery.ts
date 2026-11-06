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
  const { watch, unwatch } = create_watcher(pubsub, signal)
  const reply_to = mesh.presence_reply(crypto.randomUUID())
  const requests = new Map<string, string>()
  let target: Readonly<{ owner: string; character_id: string; request: string }> | null = null
  const ready = watch(reply_to, (fact: MeshFact) => {
    if (fact.kind !== 'reply') return
    const { zx, zz } = zone_of(fact.player.x, fact.player.z)
    const targeted =
      target?.request === fact.request &&
      target.owner === fact.address &&
      target.character_id === fact.player.character_id
    if (!targeted && requests.get(`${fact.player.world}:${zx}:${zz}`) !== fact.request) return
    receive(fact.player, fact.address)
  })
  return {
    target: (owner: string | null, character_id: string | null): void => {
      if (target) unwatch(mesh.presence_owner(target.owner))
      target = owner && character_id ? { owner, character_id, request: crypto.randomUUID() } : null
      const requested = target
      if (!requested) return
      const observed = watch(mesh.presence_owner(requested.owner), (fact: MeshFact) => {
        if (
          target !== requested ||
          fact.kind !== 'appear' ||
          fact.address !== requested.owner ||
          fact.player.character_id !== requested.character_id
        )
          return
        receive(fact.player, fact.address)
      })
      void Promise.all([ready, observed])
        .then(async () => {
          if (signal.aborted || target !== requested) return
          await pubsub.mesh.publish(mesh.presence_owner(requested.owner), {
            kind: 'who',
            character_id: requested.character_id,
            address,
            world: '',
            zx: 0,
            zz: 0,
            reply_to,
            request: requested.request,
          })
        })
        .catch((error: unknown) => log.warn({ err: error }, 'target presence discovery failed'))
    },
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
