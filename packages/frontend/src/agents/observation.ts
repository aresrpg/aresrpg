// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentObservation, CharacterRow, ClientPacket } from '@aresrpg/protocol'

import type { AppInput } from '../store.ts'
import type { SessionState } from '../modules/session.ts'

import { fold_agent_activity, type AgentActivity } from './activity.ts'

export type AgentView = Readonly<{
  serial: number
  request: AgentObservation | null
  characters: readonly CharacterRow[]
  activity: readonly AgentActivity[]
  status: 'idle' | 'loading' | 'ready' | 'failed'
  return_character_id: string | null
}>
export type AgentViewInput = Readonly<{ type: 'agent/watch'; observation: AgentObservation | null }>
export const initial_agent_view = (): AgentView => ({
  serial: 0,
  request: null,
  characters: [],
  activity: [],
  status: 'idle',
  return_character_id: null,
})
export const agent_watching = (session: SessionState): boolean => session.agent_view.request !== null
export const displayed_character = (session: SessionState): CharacterRow | null => {
  const { agent_view: view, selected_character_id } = session
  const rows = agent_watching(session) ? view.characters : session.characters
  const selected = rows.find(({ id }) => id === selected_character_id)
  if (selected) return selected
  // The indexed tab already owns this display row while the world subscription is authorized.
  if (view.status !== 'loading' || session.inventory_pairing?.address !== view.request?.pairing.address) return null
  return session.agent_inventory.characters.find(({ id }) => id === selected_character_id) ?? null
}
const stop = (session: SessionState, selected_character_id?: string): SessionState => ({
  ...session,
  selected_character_id:
    selected_character_id ??
    session.characters.find(({ id }) => id === session.agent_view.return_character_id)?.id ??
    session.characters[0]?.id ??
    null,
  agent_view: { ...initial_agent_view(), serial: session.agent_view.serial + 1 },
})
const watch = (session: SessionState, observation: AgentObservation | null, restore_id?: string): SessionState => {
  const { agent_view: view } = session
  if (!observation) return stop(session, restore_id)
  return {
    ...session,
    selected_character_id: observation.character_id,
    agent_view: {
      serial: view.serial + 1,
      request: observation,
      characters: view.request?.pairing.address === observation.pairing.address ? view.characters : [],
      activity: [],
      status: 'loading',
      return_character_id: view.request ? view.return_character_id : session.selected_character_id,
    },
  }
}
export const fold_agent_view = (session: SessionState, input: AppInput): SessionState => {
  const { agent_view: view } = session
  switch (input.type) {
    case 'agent/watch':
      return watch(session, input.observation)
    case 'character/select': {
      if (!view.request) return session
      if (session.characters.some(({ id }) => id === input.character_id))
        return watch(session, null, input.character_id)
      if (!view.characters.some(({ id }) => id === input.character_id)) return session
      return watch(session, { ...view.request, character_id: input.character_id })
    }
    case 'server/packet': {
      const { packet } = input
      if (packet.type !== 'packet/agent_observed') return session
      if (!view.request || packet.id !== view.serial) return session
      return {
        ...session,
        selected_character_id: packet.selected_character_id,
        agent_view: {
          ...view,
          characters: packet.characters,
          status: packet.failed ? 'failed' : 'ready',
          activity: fold_agent_activity(
            view.activity,
            view.characters.find(({ id }) => id === session.selected_character_id),
            packet.characters.find(({ id }) => id === packet.selected_character_id),
            view.status,
            packet.failed
          ),
        },
      }
    }
    default:
      return session
  }
}

export const agent_subscription = (session: SessionState, previous: SessionState): readonly ClientPacket[] => {
  if (session.link_status !== 'ready') return []
  if (session.agent_view.serial === previous.agent_view.serial && previous.link_status === 'ready') return []
  return [{ type: 'packet/agent_observe', id: session.agent_view.serial, observation: session.agent_view.request }]
}
