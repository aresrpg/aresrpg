// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Where the account's characters stand reaches the server here: one publisher for the controlled and the
// following characters, and the nearby fights the played character watches from where it stands.
import { character_checkpoint, POSITION_INTERVAL_MS, type ClientPacket } from '@aresrpg/protocol'
import { client_to_chain_coordinate } from '@aresrpg/immutable'

import { pose_matches_character, read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import { record_owned_character_position } from '../game/core/owned_character_feed.ts'
import { create_position_publisher } from '../game/core/position_publication.ts'
import type { AppModule } from '../store.ts'

import { nearby_watch_changes } from './nearby_fight.ts'

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  /** A position leaves only over a ready link; the publisher keeps one it could not send for its next turn. */
  const send = (packet: Readonly<ClientPacket>): boolean => {
    if (get_state().session.link_status !== 'ready') return false
    dispatch({ type: 'server/send', packet })
    return true
  }
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
    positions.publish(character_id, Object.freeze({ checkpoint, x, y, z, riding: false, gliding: false }), 100)
  })
  events.on('STATE_UPDATED', (next, prior) => {
    const reconnected = next.session.link_status === 'ready' && prior.session.link_status !== 'ready'
    // The server places a nearby watch where the character stands, so the position leaves first.
    nearby_watch_changes(next.fight.nearby, prior.fight.nearby, reconnected).forEach((packet) => {
      publish_selected_position(true)
      dispatch({ type: 'server/send', packet })
    })
    const departed = prior.session.selected_character_id
    if (departed && departed !== next.session.selected_character_id) positions.release(departed)
  })
  signal.addEventListener('abort', unsubscribe_pose, { once: true })
}

export default Object.freeze({ name: 'positions', observe }) satisfies AppModule
