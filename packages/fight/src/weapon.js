// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/weapon.js — the equipped-WEAPON basic-attack sentinel (S-25) and its pre-read fallbacks, moved into
// the fight core from core/modules/fight.js (2026-07-17): the sentinel is fight-session vocabulary (it arms
// through the SAME armed_spell_id machinery every spell uses), and living here lets leaf consumers
// (fight-sfx, folds, the adapter) import it without touching the game-core module graph — the fight-sfx →
// modules/fight.js edge was a dependency cycle's entry. modules/fight.js re-exports these verbatim, so every
// existing import keeps working.

// The HAND / equipped-WEAPON basic attack occupies numkey slot 0 in the spell bar (S-25). It has NO seed
// row (it is not a spell), so it arms via this sentinel id through the SAME armed_spell_id machinery every
// spell uses (arm/disarm toggle, turn-flip clear, Escape) — one selection SSOT, no parallel state. Readers
// that resolve a seed row from armed_spell_id (DungeonSpellReadout, seed_range_of) return their safe empty
// default for it; the board special-cases it to paint a melee targeting ring and route the click to the
// documented S-12 §17.27 cast-dispatch seam. Double-underscore-prefixed so it can never collide with a
// seed name_key (all lower-snake words).
export const WEAPON_ATTACK_ID = '__weapon_attack'

// S-12 §17.27 — the PRE-READ FALLBACK for the weapon/hand basic attack. The LIVE range/AP come from the seat's
// on-chain Weapon (participant.move — reach/ap_cost, surfaced on the escrow row and read by DungeonBoard's
// cast_params); these constants only shape the melee ring for the split second before the escrow read lands.
// AP 0 = never gate on cost pre-read (the chain validates the real ap_cost); reach 1 = the unarmed melee floor.
export const WEAPON_ATTACK_RANGE = /** @type {[number, number]} */ ([1, 1])
export const WEAPON_ATTACK_AP = 0
