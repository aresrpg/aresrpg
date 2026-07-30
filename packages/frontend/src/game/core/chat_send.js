// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Outbound chat composition edge: reads the selected character and calls the ONE social transport home. That
// home keeps the courier alive while publishing the same line into the room during the additive transition.

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

  // A data channel does not echo a sender's own packet, so publish the local copy through the same reducer door
  // peer lines use. Peers resolve richer identity from room state; id remains the stable fallback.
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
