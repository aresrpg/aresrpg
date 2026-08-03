// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1740 — the re-entrant fold CAP fires in a real coop session ("still queued: ctx"). The roster adopter is a
// fight-store SUBSCRIBER, so its `publish` lands as a QUEUED input (the door is already folding); the guard that
// decides whether to re-publish compared the freshly composed rows against `ctx.roster`, which still lags by one
// fold. Every notification therefore minted a NEW rows identity that the next notification could never match —
// a treadmill, one queued `ctx` per fold, forever. Coop is where it bites: a peer's fighter entering the view
// changes the roster signature INSIDE a notification, which is the only way the first publish is a queued one.

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'

import { create_fight_roster_adoption } from '../../../../src/game/core/modules/fight_roster_adoption.js'

const ALICE = '0xalice'
const BOB = '0xbob'

const player = (character_id) => ({ is_player: true, character_id })

/** The coop shape: my seat plus a peer's, both already present as player fighters in the adopted view. */
const coop_fighters = () =>
  new Map([
    [ALICE, player(ALICE)],
    [BOB, player(BOB)],
  ])

describe('#1740 fight roster adoption converges inside a store notification', () => {
  test('a coop roster published from a subscriber reaches a fixed point (no re-entrant storm)', () => {
    const store = create_fight_store()
    const ensure_roster = create_fight_roster_adoption({
      get_mine: () => [{ id: ALICE, name: 'Kaelen' }],
      get_fighters: coop_fighters,
      get_session_key: () => 'fight-a:1',
      get_carried: () => store.getState().ctx?.roster ?? [],
      publish: (rows) => store.getState().input({ type: 'ctx', ctx: { roster: rows } }),
      resolve_characters: async () => new Map(),
    })

    // The production wiring (game/core/modules/fight.js `sync`): the adopter runs on EVERY notification.
    store.subscribe(() => ensure_roster())

    // One outer input is enough — the peer's fighter is in the view, so the first publish is a queued one.
    expect(() => store.getState().input({ type: 'ctx', ctx: {} }, 1_000)).not.toThrow()

    // And the fixed point is the real roster, not an empty surrender. #1993 WP3 — "real" now means RESOLVED:
    // BOB's doc never came back (`resolve_characters` returns an empty Map), so he gets no row rather than a
    // placeholder wearing a name field. The identity book names his seat by its own short id, so nothing he
    // renders changed; what changed is that the roster no longer claims to have resolved him.
    expect((store.getState().ctx?.roster ?? []).map((row) => row.id).sort()).toEqual([ALICE])
  })
})
