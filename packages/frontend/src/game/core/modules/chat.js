// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Chat — stateless courier POSTs fan out on the world presence SSE. Incoming messages flow through
// @aresrpg/world's presence atom: the stream adapter dispatches `chat_received`, the core carries the chat head, and this module's
// `observe` subscribes to it and folds each row into message_history (session-local, no backlog). CHANNEL
// routes the render color; `id` is the character identity used for the "me" test, while `address` is the
// zkLogin-verified wallet address.

import { subscribe_chat } from '@aresrpg/world/presence'

import { presence_store } from '../../../world-shell/presence_adapter.js'

const MAX_MESSAGES = 100

// Proto enums travel as their STRING name on the wire (same convention as the Action enum:
// e.g. action 'IDLE'/'WALK'). A channel is its proto ChatChannel name, not its tag number.
export const CHANNEL = /** @type {const} */ ({
  general: 'CHAT_GENERAL',
  commerce: 'CHAT_COMMERCE',
  group: 'CHAT_GROUP',
  guild: 'CHAT_GUILD',
  private: 'CHAT_PRIVATE',
  server: 'CHAT_SERVER',
  // CLIENT-ONLY combat log (cast + death lines). NEVER sent on the wire (no proto enum) — fight.js renders
  // these locally off the authoritative event stream, so each client builds its own identical green
  // system lines (no server fan-out). Rendered headerless + green by Chat.jsx.
  combat: 'CLIENT_COMBAT',
})

/** @type {import('../game.js').Module} */
export default function chat() {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      if (type !== 'action/chat_message') return state
      const next = [...state.message_history, payload].slice(-MAX_MESSAGES)
      return { ...state, message_history: next }
    },
    /** @param {import('../game.js').Context} context */
    observe({ get_state, dispatch }) {
      // Incoming PEER chat: the presence core's chat stream head (fed `chat_received` by the transport)
      // delivers each row exactly once, in order — fold it into message_history. from_me compares the
      // sender's character id against MY active character. `address` is the zkLogin-verified wallet address,
      // while `id` remains the character identity used for the local/remote display verdict.
      subscribe_chat(presence_store, ({ id, message, address, name = '', channel = CHANNEL.general, target = '' }) => {
        dispatch('action/chat_message', {
          id,
          message,
          address,
          name,
          channel,
          target,
          from_me: id === get_state().selected_character_id,
        })
      })
    },
  }
}
