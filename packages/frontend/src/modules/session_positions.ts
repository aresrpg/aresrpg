// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { character_checkpoint, POSITION_INTERVAL_MS, type ClientPacket } from '@aresrpg/protocol'
import { client_to_chain_coordinate } from '@aresrpg/immutable'

import { pose_matches_character, read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import { record_owned_character_position } from '../game/core/owned_character_feed.ts'
import { create_position_publisher } from '../game/core/position_publication.ts'
import type { AppContext } from '../store.ts'

/** The session's position effect lifetime: one publisher for controlled and following characters. */
export const observe_session_positions = (
  { events, get_state, signal }: Readonly<Pick<AppContext, 'events' | 'get_state' | 'signal'>>,
  send: (packet: Readonly<ClientPacket>) => boolean
) => {
  const positions = create_position_publisher({
    send: (character_id, position) => send({ type: 'packet/position', character_id, ...position }),
  })
  const publish_selected_position = (force = false): void => {
    const pose = read_pose()
    const state = get_state()
    if (pose === null && state.session.selected_character_id) positions.release(state.session.selected_character_id)
    if (state.session.link_status !== 'ready' || !pose_matches_character(pose, state.session.selected_character_id))
      return
    const character = state.session.characters.find(({ id }) => id === pose.character_id)
    const checkpoint = character ? character_checkpoint(character) : null
    if (!checkpoint) return
    const next = {
      checkpoint,
      x: client_to_chain_coordinate(pose.x),
      y: pose.y,
      z: client_to_chain_coordinate(pose.z),
      riding: pose.riding,
      gliding: pose.gliding,
    }
    record_owned_character_position(pose.character_id, character!.world!, next)
    positions.publish(pose.character_id, next, POSITION_INTERVAL_MS, force)
  }
  const unsubscribe_pose = subscribe_pose(publish_selected_position)
  events.on('party/follower_moved', ({ character_id, checkpoint, x, y, z }) => {
    if (get_state().session.link_status !== 'ready') return
    positions.publish(character_id, Object.freeze({ checkpoint, x, y, z, riding: false, gliding: false }), 100)
  })
  events.on('STATE_UPDATED', (next, prior) => {
    const departed = prior.session.selected_character_id
    if (departed && departed !== next.session.selected_character_id) positions.release(departed)
  })
  signal.addEventListener('abort', unsubscribe_pose, { once: true })
  return publish_selected_position
}
