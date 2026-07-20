/**
 * Whether a chat line belongs in the current world/fight log after its channel checkbox passed. Combat is a
 * client-local presentation stream and has no p2p peer scope; treating its synthetic id like a peer hid the whole
 * log as soon as the player entered a dungeon. Party and own lines retain their cross-instance behavior.
 * @param {{from_me?:boolean,channel?:string}} line
 * @param {{group:string,combat:string}} channels
 * @param {string|null} my_dungeon_id
 * @param {string|null} peer_dungeon_id
 * @param {boolean} [fight_active]
 */
export function chat_line_in_scope(line, channels, my_dungeon_id, peer_dungeon_id, fight_active = false) {
  // Entering a fight must not replace the existing log with an empty instance-scoped view. The same compact chat
  // stays readable for the entire presentation; combat's synthetic lines are likewise peerless and always local.
  if (fight_active || line.from_me || line.channel === channels.group || line.channel === channels.combat) return true
  return peer_dungeon_id === my_dungeon_id
}
