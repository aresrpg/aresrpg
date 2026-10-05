// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useSyncExternalStore } from 'react'

import { selected_party } from '../../modules/party.ts'
import { useAppStore } from '../../store.ts'
import {
  owned_character_presence_rows,
  read_owned_character_positions,
  subscribe_owned_character_positions,
} from '../core/owned_character_feed.ts'

import { map_players } from './map_players.ts'

export const useMapPlayers = () => {
  const session = useAppStore(({ session }) => session)
  const remote = useAppStore(({ world }) => world.players)
  const party = useAppStore(selected_party)
  // Reuse the world renderer's live feed and checkpoint-validated owned presence projection.
  useSyncExternalStore(subscribe_owned_character_positions, read_owned_character_positions)
  const world = session.characters.find(({ id }) => id === session.selected_character_id)?.world ?? null
  return map_players(
    remote,
    owned_character_presence_rows(session.characters, session.wallet?.address ?? '', world, () => 0),
    party,
    session.selected_character_id,
    world
  )
}
