// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Outbound chat composition edge: reads the selected character and calls the ONE social transport home —
// the lobby room (docs/REALTIME.md lane 2). There is no second path a line could take.

import { publish_room_chat, publish_room_party_chat } from '../../p2p/lobby-room.js'

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
  if (channel === CHANNEL.group) publish_room_party_chat(selected_character_id, name, message, channel, target)
  else publish_room_chat(selected_character_id, name, message, channel, target)
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
