// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one RpcCharacter → engine roster-card projection. Kept independent of both roster loaders so boot,
// background enrichment, and targeted post-fight reconciliation share the mapping without importing one
// another (or pulling the game composition root into their graph).

import { level_to_experience, experience_to_level } from '@aresrpg/sdk/experience'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { game_log } from '../core/log.js'
import { DEMO_NETWORK } from '../chain/deployment'

/**
 * Map an indexer RpcCharacter → the flat roster-card shape the engine store + CharactersDrawer render.
 * `class`→`classe`; `experience` is the REAL on-chain field and `level` derives from it via the SDK curve
 * (one home, floors to 1) so the card's xp_progress bar + level read the same truth (a null experience falls
 * back to the level's min-XP + warns). `_type` is stamped from the SSOT type-origin id so the card's max-HP gate
 * treats it as a typed character (on-chain formula). The signed equipment aggregate is already fight-equivalent
 * on the `/v1` wire. Colors/sex ride the RPC row (S-15c), while the avatar hydrate fills appearance chain-direct.
 * @param {import('../rpc/views').RpcCharacter} character
 */
export function rpc_to_card(character) {
  // RpcCharacter carries the REAL on-chain `experience` (S-57) — use it, and DERIVE level from it through the
  // SDK curve (experience_to_level FLOORS to 1: a 0-XP character is level 1, never 0). One derivation home, so
  // the roster card + every HUD level read can never drift. A null `experience` (indexer projection lag — the
  // field is "pending object-snapshot indexing") falls back to the level's min-XP and warns ONCE, never a
  // silent lvl-0. (Was: `experience: level_to_experience(level)` — synthesised from level, discarding the field.)
  let experience = Number(character.experience ?? NaN)
  if (!Number.isFinite(experience)) {
    game_log('roster', 'RpcCharacter missing `experience` — deriving from level (indexer projection lag)', character.id)
    experience = level_to_experience(Math.max(1, Number(character.level ?? 1) || 1))
  }
  const level = experience_to_level(experience)
  const pet_equipped = character.pet_equipped === true
  return {
    id: character.id,
    _type: `${aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')}::character::Character`,
    name: String(character.name ?? ''),
    classe: String(character.class ?? ''),
    level,
    experience,
    vitality: Number(character.vitality ?? 0),
    wisdom: Number(character.wisdom ?? 0),
    strength: Number(character.strength ?? 0),
    intelligence: Number(character.intelligence ?? 0),
    agility: Number(character.agility ?? 0),
    chance: Number(character.chance ?? 0),
    available_points: Number(character.available_points ?? 0),
    current_hp: character.current_hp == null ? null : Number(character.current_hp),
    hp_updated_ms: character.hp_updated_ms == null ? null : Number(character.hp_updated_ms),
    gear_vitality: character.gear_vitality == null ? null : Number(character.gear_vitality),
    equipment_stats:
      character.equipment_stats == null
        ? null
        : Object.fromEntries(Object.entries(character.equipment_stats).map(([key, value]) => [key, Number(value)])),
    world_id: character.world ?? null,
    jobs: character.jobs ?? {},
    // Keep the read-model's equipped-item projection intact for the Equipment tab. These rows are NOT
    // owner-items: equipped objects have left the loose kiosk-item bag, so dropping this field makes the
    // paper doll look empty whenever the chain-direct enrichment cannot read the kiosk-wrapped character.
    equipment: character.equipment ?? [],
    worn: character.worn ?? {},
    // Carry projection truth only. EquipmentMap owns the boolean and the sibling Item owns identity;
    // the later world lane decides how that pet becomes a companion or mount prompt. False suppresses
    // stale identity, while true + null preserves the honest sibling-snapshot gap.
    pet: pet_equipped ? (character.pet ?? null) : null,
    pet_equipped,
    // WORN COSMETICS (hat/cloak) — the /v1 read-model resolves each equipped cosmetic's category and
    // serves it under `worn` keyed by category; spread it here as the top-level slot fields
    // (character.hat / character.cloak) the render path's resolve_worn_cosmetics reads. Absent → nothing
    // spread (inert + back-compat). load_roster's `{...card, ...chain_read}` merge keeps these (the
    // chain-direct read carries no cosmetic-slot keys, so they survive the enrichment spread).
    ...(character.worn ?? {}),
  }
}
