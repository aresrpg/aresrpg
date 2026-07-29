// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Outbound chat composition edge: reads the selected character, broadcasts to the p2p room, then echoes MY
// OWN line through the game reducer door. Kept outside modules/chat.js so the reducer pipeline never imports
// its own game root.

import { broadcast_chat, broadcast_party_chat } from '../../p2p/lobby-room.js'

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

  // No server resolves name/address for peers, so fill them from the chain roster and echo locally: a data
  // channel never delivers my own send back to me, so without this echo my line would appear on every screen
  // except mine.
  const me = sui.characters.find((character) => character.id === selected_character_id)
  const name = me?.name ?? ''
  if (channel === CHANNEL.group) broadcast_party_chat(selected_character_id, name, message, channel, target)
  else broadcast_chat(selected_character_id, name, message, channel, target)
  context.dispatch('action/chat_message', {
    id: selected_character_id,
    message,
    address: selected_character_id,
    name,
    channel,
    target,
    from_me: true,
  })
}
