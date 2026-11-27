// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The daily Mastery quest starts from the game's Mastery page: it needs the world tables, so only the game runs it.
import { content_catalog } from '../content/catalog.ts'
import { mastery_world_witness } from '../mastery/model.ts'
import type { AppModule } from '../store.ts'

import { mastery_outcomes } from './mastery.ts'
import { character_custody } from './session.ts'

const observe: NonNullable<AppModule['observe']> = (context) => {
  const { events, dispatch, get_state } = context
  const { finish, fail } = mastery_outcomes(context)
  events.on('mastery/start', ({ world: world_name }) => {
    const state = get_state()
    const { wallet, characters } = state.session
    const world = content_catalog.world(world_name)
    const witness = world ? mastery_world_witness(characters, world) : null
    if (!wallet || !world || !witness || state.mastery.pending) return
    dispatch({ type: 'mastery/pending', operation: 'start' })
    void wallet.mastery
      .start({ world: world.world, character_id: witness.id, custody: character_custody(witness) })
      .then(({ mastery }) => finish(wallet, mastery))
      .catch((error: unknown) => fail(wallet, error))
  })
}

export default Object.freeze({ name: 'mastery_quest', observe }) satisfies AppModule
