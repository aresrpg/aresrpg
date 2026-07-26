// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEAT FOLLOW (#948) — the HUD binds to the seat you can actually play.
//
// A fight can seat SEVERAL characters you control (the production multi-account path; every simulator seat is
// owned by the one mock address precisely so that path drives it). Everything turn-scoped hangs off ONE fact —
// the core's `my_entity_id`, re-resolved into `my_key` by the ctx door — so a focus stuck on seat #1 means
// seat #2's turn has no HUD at all: its deck is unreachable, and the deadline auto-pass (whose `enabled`
// requires `state.active === state.my_key`, fight/store.js) never fires for it either, so an away second seat
// stalls the whole fight. One binding, both symptoms — scoping the follow to EVERY controlled seat fixes the
// HUD and the janitor in the same move.
//
// This is the production group path's rule, lifted to the fight edge so every composition gets it:
// @aresrpg/party's group_loop answers `turn_started` for an OWNED member with a `hud_focus` output that
// group_wiring routes into this same ctx door. That reducer only knows GROUP members, so a fight seated any
// other way (a simulator sandbox, a coop fight joined outside the party flow) had no follower at all.
//
// TURN-EDGE, NOT LEVEL (group_loop's own semantics): the follow fires once per turn change, so a manual pick
// (a click on another controlled turn card) holds for the rest of that turn instead of being yanked back.

import { fight_store } from '@aresrpg/fight/store'

/**
 * The seat the HUD should re-bind to for this view, or null to stay put. PURE.
 *
 * `active_controlled_character_id` is engine_view's own verdict (the active entity ∩ my controlled seats), so
 * a mob turn, a peer's turn and a spectator view all answer null by construction — never a second ownership
 * rule here. An already-focused seat answers null too, which keeps every caller idempotent.
 *
 * @param {{ active_controlled_character_id?: string | null, my_entity_id?: string | null } | null} view
 * @returns {string | null}
 */
export const next_seat_focus = (view) => {
  const active = view?.active_controlled_character_id ?? null
  if (!active || active === view?.my_entity_id) return null
  return active
}

/**
 * A follower with the turn latch: `follow(view)` answers the seat to bind ONLY on a turn change (the edge
 * group_loop's `turn_started` fires on), null otherwise. The latch is per-follower closure state — the caller
 * owns the effect, this owns the decision.
 * A torn-down fight (no view) reads as a null turn, which re-arms the latch by itself — no lifecycle call.
 * @returns {{ follow: (view: any) => string | null }}
 */
export const create_seat_follower = () => {
  let last_turn = /** @type {string | null} */ (null)
  return {
    follow(view) {
      const active = view?.active_entity_id ?? null
      if (active === last_turn) return null
      last_turn = active
      return next_seat_focus(view)
    },
  }
}

/** Bind the HUD to a controlled seat through the core's ONE ctx door (the same door group_wiring drives). */
export const focus_seat = (character_id, store = fight_store) =>
  store.getState().input({ type: 'ctx', ctx: { my_entity_id: character_id } })
