// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/vitals_record.js — THE entity vitals record (#1993 WP7).
//
// One fighter's life, folded ONCE from every transport that carries it, and named. Before this file the same
// fact was derived three times over — in `engine_view`'s rows, in `board_view`'s rows, and again in the
// visible view's builder — so a fighter's health had FOUR spellings (`health`, `presented_health`,
// `committed_health`, the snapshot's own `hp`) and its liveness had four more (`alive`, `committed_alive`,
// `committed_dead`, `dead`). Every live surface then picked a different one, which is exactly how the turn card
// and the HP gem came to render two different numbers for one entity in one frame.
//
// THE EVIDENCE, all of it an INPUT (never a second home):
//   · the adopted chain SNAPSHOT row — the object read's `hp` / `max_hp` / `alive`
//   · the COMMITTED fold — journal receipts and peer-confirmed hits, this client's own guesses excluded
//   · the PRESENTED fold — the same, PLUS this client's unacked local intents (its prediction)
//   · the PACING facts — whether a wave is draining, whether this fighter's killing beat is still unacked,
//     and whether a commit-flight optimistic kill is claimed against it
//
// THE THREE NUMBERS, each named once and each an answer to a different question:
//   · `committed` — CHAIN TRUTH. Every gameplay, legality and log question answers from here.
//   · `presented` — the presentation fold, this client's prediction included. It is the INPUT `display` is
//     derived from and the number the pacing tests read; it is never itself an answer.
//   · `display`   — THE number a bar renders. The paced presented value while a wave drains (so the HP moves
//     WITH the beat, never ahead of it), settled chain truth at rest (so an unconfirmed local prediction never
//     paints life the chain has not agreed to). One display HP for every live surface.
//
// LIVENESS IS DERIVED, never carried as a parallel boolean: `alive` is committed truth's, `presented_alive` is
// its presentation-fold twin (display's input, like `presented` above), and `display_alive` is the RENDERED
// one — masked by the death hold so a body falls on its killing beat rather than on the receipt. A reader that
// wants "dead" negates the one it means; that negation is not a fact of its own.
//
// THE HP FORMULA IS NOT HERE and never will be. Damage, healing, clamping and regen live in the sim / Move twin
// (`hp_math.js`, ANNEX §5.4). This file moves READERS onto one record; it does not compute a single point of HP.

/**
 * One entity's vitals, folded from every transport that carries them.
 *
 * Returned values are the SNAPSHOT's own spelling — a missing number stays missing rather than becoming a
 * fabricated 0, and the callers that publish a record (`visible_entities`) normalise absence to `null` at
 * their own edge, exactly as they did before this fold existed.
 *
 * @param {{ hp?: number, max_hp?: number, alive?: boolean } | null | undefined} snapshot the adopted board row
 * @param {{ hp?: number, alive?: boolean } | null | undefined} committed the committed fold's fighter
 * @param {{ hp?: number, alive?: boolean } | null | undefined} presented the presentation fold's fighter
 * @param {{ presenting?: boolean, death_held?: boolean, optimistic_dead?: boolean }} [pacing]
 *   `presenting` — a wave is draining, so the paced value is what the eye is on.
 *   `death_held` — this fighter's killing damage beat is unacked: it renders ALIVE until the beat lands.
 *   `optimistic_dead` — a commit-flight local kill is claimed against it.
 */
export const entity_vitals = (
  snapshot,
  committed,
  presented,
  { presenting = false, death_held = false, optimistic_dead = false } = {}
) => {
  const snapshot_hp = snapshot?.hp
  const committed_hp = committed?.hp ?? snapshot_hp
  const presented_hp = presented?.hp ?? snapshot_hp
  // A fold row without its own `hp` has not spoken about this fighter at all — its liveness flag is not an
  // opinion either, and the snapshot answers. (The pre-fold readers each spelled this same guard.)
  const alive = !!(committed?.hp != null ? committed.alive : snapshot?.alive)
  const presented_alive = !!(presented?.hp != null ? presented.alive : snapshot?.alive)
  return {
    committed: committed_hp,
    presented: presented_hp,
    display: presenting ? presented_hp : committed_hp,
    max: snapshot?.max_hp,
    alive,
    presented_alive,
    display_alive: death_held || !(optimistic_dead || !presented_alive),
  }
}
