// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — game and expedition source bypasses, shaped like SpellBar.jsx:53.
export const vitals = () => {
  const character = use_game_state((state) => state.selected_character)
  const expedition = use_expedition((state) => state.expedition)
  return { character, expedition }
}
