// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Chat — serverless browser↔browser traffic in the world room. The composition edge echoes my own line through
// this reducer; peer lines enter through the presence atom's `chat_received` input and its subscription below.
// History stays session-local with no backlog. CHANNEL routes render color; `id` is character identity.

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
      // THE CORRECTION DOOR (#2151), made an EXPLICIT CONTRACT (#2218) — a dispatch rewrites an existing row only
      // when it says `replaces: <that row's id>`. It must be said out loud because `id` is the SPEAKER's identity,
      // not the message's: every line one character sends carries the same id, so inferring replacement from an
      // id collision silently ate each speaker's previous line. The correction earns its door — my own cast writes
      // its combat-log line at the click, and when the chain adopts a different amount the log must say so where it
      // already spoke, not append a second number for the player to reconcile by eye; being a REPLACEMENT is also
      // what keeps it from being a re-play. `replaces` is the instruction, spent here and never stored on the row.
      const { replaces = null, ...row } = payload
      if (replaces == null)
        return { ...state, message_history: [...state.message_history, payload].slice(-MAX_MESSAGES) }
      const at = state.message_history.findIndex((line) => line.id === replaces)
      // A replacement addressing a row that is gone (scrolled past MAX_MESSAGES, or a fight torn down) writes
      // NOTHING: a bare corrected number with no cast above it reads as a hit that never happened.
      if (at < 0) return state
      return {
        ...state,
        message_history: state.message_history.map((line, i) => (i === at ? { ...row, id: replaces } : line)),
      }
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
