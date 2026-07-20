// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Characters meta-tab (P3). Drops the legacy WS-era `use_ws` link flow and renders the already-built
// CharactersDrawer (the on-chain roster switcher/creator, sourced from the game engine store +
// @aresrpg/sdk) inside the companion shell, scoped to `.gw-tab` (game-tab.css) so the game tokens
// never touch the companion :root. Per-row "Play"/Enter hot-swaps the active character (persists
// last-played via the drawer) and routes into the live world.
//
// The meta-tab renders the CharactersDrawer in its `page` variant: a wide master-detail
// = a boxed roster list (compact rows + per-row Enter) on the left and a borderless detail panel on the
// right (a persistent identity header + the EQUIPMENT/STATS/SPELLS/JOBS/RUNEFORGE tab strip, each tab
// reusing the already-built store-sourced drawer). Same component as the in-world HUD drawer (SSOT) —
// only the layout differs.
//
// Design correction (2026-07-10): RUNEFORGE was wrongly living HERE as a page-level sub-tab beside Characters
// (the S-65 rider). Forgemagie is PER-CHARACTER (scribing runes onto the selected character's gear), not
// a global surface — it moved into CharactersDrawer's own detail-tab row (EQUIPMENT/STATS/SPELLS/JOBS/
// RUNEFORGE), scoped by whichever roster character is selected. This page has no tab strip anymore.

import { lazy, Suspense } from 'react'

import { use_navigate_page } from '../hooks/use_navigate_page'
import { app_mobile_classes, use_mobile_mode } from '../game/screens/hud/mobile_layout.js'
import '../game/screens/hud/characters-drawer.css'

const CharactersDrawer = lazy(() =>
  import('../game/screens/hud/CharactersDrawer.jsx').then((m) => ({ default: m.CharactersDrawer }))
)

export function CharactersPage() {
  const navigate = use_navigate_page()
  const classes = app_mobile_classes(use_mobile_mode())
  return (
    <div className={`${classes.page} gw-tab flex flex-col`}>
      <Suspense fallback={<TabFallback />}>
        {/* on_switch fires after the drawer persists last-played + selects the character; entering the
           live world boots/embodies it (send_packet safely no-ops when the engine is not yet online). */}
        <CharactersDrawer variant="page" on_switch={() => navigate('game-world')} />
      </Suspense>
    </div>
  )
}

function TabFallback() {
  return <div className="text-muted text-[10px] tracking-[0.2em] uppercase animate-pulse p-4">Loading…</div>
}
