// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { randomUUID } from 'node:crypto'

import type { AgentObservation, AgentStatus, InventoryPacket } from '@aresrpg/protocol'
import { owner_agent_identity } from '@aresrpg/sdk/agent-pairing'

import type { PlayerContext, PlayerModule } from '../player.ts'
import { create_inventory_reader } from '../inventory_reader.ts'
import { get_fight_checkpoint } from '../reads/get_fight_checkpoint.ts'
import { get_fight_resolutions } from '../reads/get_fight_resolutions.ts'
import { get_characters } from '../reads/get_characters.ts'
import { get_my_listings } from '../reads/get_user_economy.ts'
import { get_trades } from '../reads/get_trades.ts'
import { coalesced_reader, latest_keyed_reader } from '../latest_read.ts'
import { create_watcher } from '../pubsub_bus.ts'
import { mesh, type EventEnvelope } from '../protocol.ts'
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
  /** A fight event moves only that fight: its newest checkpoint is pushed alone, never the whole account. */
  const read_fight = latest_keyed_reader(
    (fight: string) => get_fight_checkpoint(graph, { fight_id: fight }),
    (fight, state) => {
      if (state) send({ type: 'packet/fight_state', fight, state, seats: {} })
    }
  )
  const push_fight = (fight: string): void => {
    void read_fight(fight).catch((error: unknown) => log.warn({ err: error, fight }, 'observed fight read failed'))
  }
  const read = coalesced_reader(
    async () => {
      const revision = inventory.revision()
      const [items, characters, listings, trades, resolutions] = await Promise.all([
        inventory.read(),
        get_characters(graph, { address }),
        get_my_listings(graph, { address }),
        get_trades(graph, { address }),
        get_fight_resolutions(graph, { address }),
      ])
      if (signal.aborted) return null
      // A hero's seat changes with its own row; a fighter's health changes with its fight.
      const heroes = characters.map(({ id: character_id }) => channels.character(character_id))
      const seated = [...new Set(characters.flatMap(({ active_fight }) => (active_fight ? [active_fight.id] : [])))]
      const wanted = new Set([...heroes, ...seated.map(channels.fight)])
      for (const channel of watched())
        if (/^evt:(character|fight):/.test(channel) && !wanted.has(channel)) unwatch(channel)
      const fresh = (channel: string) => !watched().includes(channel)
      const joined = heroes.filter(fresh)
      await Promise.all([
        ...joined.map((channel) => watch(channel, refresh)),
        ...seated
          .filter((fight) => fresh(channels.fight(fight)))
          .map((fight) => watch(channels.fight(fight), () => push_fight(fight))),
      ])
      if (joined.length) {
        refresh()
        return null
      }
      const fights = await Promise.all(
        seated.map(async (fight) => ({ fight, state: await get_fight_checkpoint(graph, { fight_id: fight }) }))
      )
      if (inventory.revision() !== revision) {
        refresh()
        return null
      }
      return { items, characters, listings, trades, resolutions, fights }
    },
    (snapshot) => {
      if (!snapshot) return
      send({ type: 'packet/characters', characters: snapshot.characters })
      send({ type: 'packet/listings', ...snapshot.listings })
      // What locks an item is part of the bag: a listed or traded stack is never spendable.
      send({ type: 'packet/trades', trades: snapshot.trades })
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
  /** The status stream has no stored snapshot: the bot itself is asked for its current one. */
  const want_status = () => {
    void pubsub.mesh
      .publish(mesh.agent_status_wanted(address), null)
      .catch((error: unknown) => log.warn({ err: error }, 'agent status request failed'))
  }
  void Promise.all([
    // What only the bot knows about this account arrives from the bot's own socket, through the mesh.
    watch(mesh.agent_status(address), (status: AgentStatus | null) => {
      send({ type: 'packet/agent_status', status })
      // A closed socket may already be replaced: whichever socket holds the wallet now answers.
      if (!status) want_status()
    }),
    watch(channels.social(address), (payload: EventEnvelope) => {
      if (payload.type !== 'ItemProjected') refresh()
    }),
    watch(channels.economy, (payload: EventEnvelope) => {
      if (payload.data.seller === address) refresh()
    }),
  ])
    .then(() => {
      want_status()
      refresh()
    })
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
    // A status speaks only for the address that signed this socket; the server relays it and keeps nothing.
    const relay = (status: AgentStatus | null) => {
      void context.pubsub.mesh
        .publish(mesh.agent_status(context.address), status)
        .catch((error: unknown) => log.warn({ err: error }, 'agent status relay failed'))
    }
    let sharing = false
    context.events.on('packet/agent_status', ({ status }) => {
      if (!sharing) {
        sharing = true
        // From its first status on, this socket answers owners who start watching, and says when it closes.
        void create_watcher(context.pubsub, context.signal)
          .watch(mesh.agent_status_wanted(context.address), () => context.send({ type: 'packet/agent_status_wanted' }))
          .catch((error: unknown) => log.warn({ err: error }, 'agent status request watch failed'))
        context.signal.addEventListener('abort', () => relay(null), { once: true })
      }
      relay(status)
    })
    context.signal.addEventListener('abort', () => lifetime?.abort(), { once: true })
  },
} satisfies PlayerModule
