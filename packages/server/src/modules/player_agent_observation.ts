// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { randomUUID } from 'node:crypto'

import type { AgentObservation, CharacterRow } from '@aresrpg/protocol'
import { owner_agent_identity } from '@aresrpg/sdk/agent-pairing'

import { get_characters } from '../reads/get_characters.ts'
import { coalesced_reader } from '../latest_read.ts'
import { channels } from '../protocol.ts'
import { create_watcher } from '../pubsub_bus.ts'
import type { PlayerModule, PlayerState } from '../player.ts'
import logger from '../logger.ts'

const log = logger(import.meta)
export type AgentWatch = Readonly<{
  request: Readonly<{ id: number; observation: AgentObservation }>
  characters: readonly CharacterRow[]
}>
export const observed_character = (state: PlayerState): CharacterRow | null => {
  const watch = state.agent_watch
  if (!watch) return null
  const selected = watch.request.observation.character_id
  return (selected ? watch.characters.find(({ id }) => id === selected) : watch.characters[0]) ?? null
}

export default {
  name: 'player_agent_observation',
  reduce: (state, input) => {
    if (input.type === 'close') return { ...state, agent_watch: null }
    if (input.type === 'action/agent_watch') return { ...state, agent_watch: input.watch }
    if (input.type !== 'action/agent_rows' || state.agent_watch?.request !== input.request) return state
    return { ...state, agent_watch: { ...state.agent_watch, characters: input.characters } }
  },
  observe: ({ events, dispatch, get_state, address, graph, pubsub, send, signal }) => {
    let lifetime: AbortController | null = null
    events.on('packet/agent_observe', ({ id, observation }) => {
      try {
        if (observation)
          owner_agent_identity(observation.pairing, {
            version: 1,
            nonce: randomUUID(),
            network: 'mainnet',
            owner: address,
            zklogin_public_identifier: observation.public_identifier,
          })
        dispatch({
          type: 'action/agent_watch',
          watch: observation ? { request: { id, observation }, characters: [] } : null,
        })
      } catch (error) {
        log.warn({ err: error }, 'agent observation identity rejected')
        dispatch({ type: 'action/agent_watch', watch: null })
        send({ type: 'packet/agent_observed', id, characters: [], selected_character_id: null, failed: true })
      }
    })
    events.on('STATE_UPDATED', (state, previous) => {
      const current = state.agent_watch
      if (current?.request !== previous.agent_watch?.request) {
        lifetime?.abort()
        lifetime = null
        if (!current) return
        const controller = new AbortController()
        lifetime = controller
        const { request } = current
        const valid = () => !controller.signal.aborted && get_state().agent_watch?.request === request
        const { watch, unwatch, watched } = create_watcher(pubsub, controller.signal)
        const refresh = coalesced_reader(
          async () => {
            const rows = await get_characters(graph, { address: request.observation.pairing.address })
            if (!valid()) return []
            const wanted = new Set(rows.map((row) => channels.character(row.id)))
            for (const channel of watched())
              if (channel.startsWith('evt:character:') && !wanted.has(channel)) unwatch(channel)
            const fresh = [...wanted].filter((channel) => !watched().includes(channel))
            await Promise.all(fresh.map((channel) => watch(channel, changed)))
            return fresh.length ? get_characters(graph, { address: request.observation.pairing.address }) : rows
          },
          (characters) => {
            if (valid()) dispatch({ type: 'action/agent_rows', request, characters })
          },
          controller.signal
        )
        const changed = () => {
          void refresh().catch((error) => {
            if (!valid()) return
            log.warn({ err: error }, 'agent observation read failed')
            dispatch({ type: 'action/agent_watch', watch: null })
            send({
              type: 'packet/agent_observed',
              id: request.id,
              characters: [],
              selected_character_id: null,
              failed: true,
            })
          })
        }
        void watch(channels.social(request.observation.pairing.address), changed)
          .then(changed)
          .catch((error) => {
            if (!valid()) return
            log.warn({ err: error }, 'agent observation subscription failed')
            dispatch({ type: 'action/agent_watch', watch: null })
            send({
              type: 'packet/agent_observed',
              id: request.id,
              characters: [],
              selected_character_id: null,
              failed: true,
            })
          })
      }
      if (current && current.characters !== previous.agent_watch?.characters)
        send({
          type: 'packet/agent_observed',
          id: current.request.id,
          characters: current.characters,
          selected_character_id: observed_character(state)?.id ?? null,
          failed: false,
        })
    })
    signal.addEventListener('abort', () => lifetime?.abort(), { once: true })
  },
} satisfies PlayerModule
