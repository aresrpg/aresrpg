// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Chat — serverless P2P (no WS server exists). `send_chat_message` broadcasts a line to the
// Trystero lobby (or the party room for GROUP) via lobby-room.js and echoes it locally. Incoming PEER
// messages flow through @aresrpg/world's presence atom (D770a W3b — the WS-era `packet/chatMessage` shim is
// dead): the transport dispatches `chat_received`, the core carries the chat stream head, and this module's
// `observe` subscribes to it and folds each row into message_history (session-local, no backlog). CHANNEL
// routes the render color; `address` (= the sender's character id off the wire) drives the "me" test.

import { subscribe_chat } from '@aresrpg/world/presence'

import { context } from '../game.js'
import { broadcast_chat, broadcast_party_chat } from '../../../p2p/lobby-room.js'
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

/**
 * Send a chat line (or a `/command`) on a channel. Requires a selected on-chain character (the
 * server rejects otherwise). The address + sender name are filled server-side.
 * @param {string} message
 * @param {string} [channel] proto ChatChannel name (default general)
 * @param {string} [target]  PRIVATE only: the target character NAME
 */
export function send_chat_message(
  message,
  channel = CHANNEL.general,
  target = '',
) {
  const { selected_character_id, sui } = context.get_state()
  // PURE P2P chat: no WS server exists — broadcast to the serverless Trystero lobby room.
  // No server resolves name/address for peers, so fill them from the chain-direct roster here, and echo
  // locally (Trystero never delivers our own send back to us). Receive: lobby-room.js dispatches incoming peer
  // messages as `chat_received` into the presence core → observe's subscribe_chat folds them into message_history.
  if (selected_character_id) {
    const me = sui.characters.find((c) => c.id === selected_character_id)
    const name = me?.name ?? ''
    // Owner v2: PARTY posts route over the dedicated party p2p room (members only); everything else over the
    // shared `world` lobby. The GENERAL|PARTY speak selector is the only source of `channel` on send.
    if (channel === CHANNEL.group) broadcast_party_chat(selected_character_id, name, message, channel, target)
    else broadcast_chat(selected_character_id, name, message, channel, target)
    context.dispatch('action/chat_message', {
      id: selected_character_id,
      message,
      address: selected_character_id,
      name: me?.name ?? '',
      channel,
      target,
      from_me: true,
    })
  }
}

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
      // delivers each row exactly once, in order — fold it into message_history. from_me is false for peers
      // (a peer's address never equals my own selected wallet); my own lines echo locally in send_chat_message.
      subscribe_chat(
        presence_store,
        ({ id, message, address, name = '', channel = CHANNEL.general, target = '' }) => {
          dispatch('action/chat_message', {
            id,
            message,
            address,
            name,
            channel,
            target,
            from_me: address === get_state().sui.selected_address,
          })
        },
      )
    },
  }
}
