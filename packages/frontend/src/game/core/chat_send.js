// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Outbound chat composition edge: reads the selected character and POSTs through the stateless courier.
// The presence SSE is the one receive path for every line, including our own accepted send.

import { broadcast_chat, broadcast_party_chat } from '../../courier/world.js'

import { context } from './game.js'
import { CHANNEL } from './modules/chat.js'

/**
 * Send a chat line (or a `/command`) on a channel. Requires a selected on-chain character.
 * @param {string} message
 * @param {string} [channel] proto ChatChannel name (default general)
 * @param {string} [target] PRIVATE only: the target character NAME
 */
export function send_chat_message(message, channel = CHANNEL.general, target = '') {
  const { selected_character_id, sui } = context.get_state()
  if (!selected_character_id) return

  // Name stays a caller-side rendering hint only; the stream row carries the verified wallet address and
  // character id. Do not echo here: accepted chat returns through the same presence SSE as every remote line.
  const me = sui.characters.find((character) => character.id === selected_character_id)
  const name = me?.name ?? ''
  if (channel === CHANNEL.group) broadcast_party_chat(selected_character_id, name, message, channel, target)
  else broadcast_chat(selected_character_id, name, message, channel, target)
}
