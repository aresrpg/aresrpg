// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { randomUUID } from 'node:crypto'

import type { AgentObservation, InventoryPacket } from '@aresrpg/protocol'
import { owner_agent_identity } from '@aresrpg/sdk/agent-pairing'

import type { PlayerContext, PlayerModule } from '../player.ts'
import { create_inventory_reader } from '../inventory_reader.ts'
import { get_fight_checkpoint } from '../reads/get_fight_checkpoint.ts'
import { get_fight_resolutions } from '../reads/get_fight_resolutions.ts'
import { get_characters } from '../reads/get_characters.ts'
import { get_my_listings } from '../reads/get_user_economy.ts'
import { coalesced_reader } from '../latest_read.ts'
import { create_watcher } from '../pubsub_bus.ts'
import type { EventEnvelope } from '../protocol.ts'
import logger from '../logger.ts'

const log = logger(import.meta)

/** A second read-only account scope uses the ordinary indexed inventory stream, never a second login. */
const observe_inventory = (
  context: PlayerContext,
  id: number,
  observation: AgentObservation,
  controller: AbortController
): void => {
  const { graph, pubsub, channels } = context
  const { signal } = controller
  const { address } = observation.pairing
  const send = (packet: InventoryPacket) => {
    if (!signal.aborted) context.send({ type: 'packet/inventory_observed', id, packet })
  }
  const inventory = create_inventory_reader({
    graph,
    pubsub,
    address,
    signal,
    send: (packet) => {
      if (packet.type === 'packet/item_updated' || packet.type === 'packet/item_removed') {
        send(packet)
      }
    },
  })
  const { watch, unwatch, watched } = create_watcher(pubsub, signal)
  const read = coalesced_reader(
    async () => {
      const revision = inventory.revision()
      const [items, characters, listings, resolutions] = await Promise.all([
        inventory.read(),
        get_characters(graph, { address }),
        get_my_listings(graph, { address }),
        get_fight_resolutions(graph, { address }),
      ])
      if (signal.aborted) return null
      const wanted = new Set(characters.map(({ id: character_id }) => channels.character(character_id)))
      for (const channel of watched())
        if (channel.startsWith('evt:character:') && !wanted.has(channel)) unwatch(channel)
      const fresh = [...wanted].filter((channel) => !watched().includes(channel))
      await Promise.all(fresh.map((channel) => watch(channel, refresh)))
      if (fresh.length) {
        refresh()
        return null
      }
      const fights = await Promise.all(
        [...new Set(characters.flatMap(({ active_fight }) => (active_fight ? [active_fight.id] : [])))].map(
          async (fight) => ({ fight, state: await get_fight_checkpoint(graph, { fight_id: fight }) })
        )
      )
      if (inventory.revision() !== revision) {
        refresh()
        return null
      }
      return { items, characters, listings, resolutions, fights }
    },
    (snapshot) => {
      if (!snapshot) return
      send({ type: 'packet/characters', characters: snapshot.characters })
      send({ type: 'packet/listings', ...snapshot.listings })
      send({ type: 'packet/fight_resolutions', resolutions: snapshot.resolutions })
      for (const { fight, state } of snapshot.fights)
        if (state) send({ type: 'packet/fight_state', fight, state, seats: {} })
      send({ type: 'packet/inventory', items: snapshot.items })
    },
    signal
  )
  const fail = (error: unknown) => {
    if (signal.aborted) return
    log.warn({ err: error }, 'inventory observation failed')
    context.send({ type: 'packet/inventory_observed', id, packet: null })
    controller.abort()
  }
  const refresh = () => {
    void read().catch(fail)
  }
  void Promise.all([
    watch(channels.social(address), (payload: EventEnvelope) => {
      if (payload.type !== 'ItemProjected') refresh()
    }),
    watch(channels.economy, (payload: EventEnvelope) => {
      if (payload.data.seller === address) refresh()
    }),
  ])
    .then(refresh)
    .catch(fail)
}

export default {
  name: 'player_inventory_observation',
  observe: (context) => {
    let lifetime: AbortController | null = null
    context.events.on('packet/inventory_observe', ({ id, observation }) => {
      lifetime?.abort()
      lifetime = null
      if (!observation) return
      try {
        owner_agent_identity(observation.pairing, {
          version: 1,
          nonce: randomUUID(),
          network: 'mainnet',
          owner: context.address,
          zklogin_public_identifier: observation.public_identifier,
        })
        const controller = new AbortController()
        lifetime = controller
        observe_inventory(context, id, observation, controller)
      } catch (error) {
        log.warn({ err: error }, 'inventory observation identity rejected')
        context.send({ type: 'packet/inventory_observed', id, packet: null })
      }
    })
    context.signal.addEventListener('abort', () => lifetime?.abort(), { once: true })
  },
} satisfies PlayerModule
