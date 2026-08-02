// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — party and character facts both come from the fight-visible projection.
export const resolve_member = (world_fight_view, character_id) =>
  world_fight_view.characters.find((character) => character.id === character_id)

export const party_frame_state = (world_fight_view) => world_fight_view.party
