// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Outbound chat composition edge: reads the selected character and calls the ONE social transport home —
// the lobby room (docs/REALTIME.md lane 2). There is no second path a line could take.

import { publish_room_chat, publish_room_party_chat } from '../../p2p/lobby-room.js'

import i18n from '../../i18n'

import { context } from './game.js'
import { CHANNEL } from './modules/chat.js'
import { push_event_toast } from './toast.js'

/**
 * The honest verdict on a line the transport reported back on — PURE, so the copy law is provable without a
 * socket. `null` means it went out and there is nothing to say; anything else is the event toast that must
 * name the ACTUAL reason nobody received it. Presence — who is on the roster — is never that reason.
 * @param {string} channel @param {boolean} delivered @returns {{state:string,title:string,message:string}|null}
 */
export function chat_refusal_toast(channel, delivered) {
  if (delivered) return null
  const group = channel === CHANNEL.group
  return {
    state: 'error',
    title: i18n.t('world_chat.not_sent'),
    message: i18n.t(group ? 'world_chat.not_sent_no_party' : 'world_chat.not_sent_no_link'),
  }
}

/**
 * Send a chat line (or a `/command`) on a channel. Requires a selected on-chain character.
 * The local echo is immediate (a data channel never echoes the sender's own packet), and the transport's own
 * verdict lands behind it: a line NOBODY received says so out loud (#1815 — a swallowed send used to leave the
 * player reading their own words in an empty room, and the one toast that did fire blamed presence for it).
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
  const carried =
    channel === CHANNEL.group
      ? publish_room_party_chat(selected_character_id, name, message, channel, target)
      : publish_room_chat(selected_character_id, name, message, channel, target)
  Promise.resolve(carried).then(delivered => {
    const refusal = chat_refusal_toast(channel, delivered)
    if (refusal) push_event_toast(refusal)
  })
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
