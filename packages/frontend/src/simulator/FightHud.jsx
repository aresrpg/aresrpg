// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/FightHud.jsx — the §7.6 HUD BINDING: the simulator's fight phase mounts the PRODUCTION fight
// surface, it does not re-implement one.
//
// ── WHAT §7.6 DECIDED, AND WHAT WAS FOUND AT BUILD TIME ────────────────────────────────────────────────────
// The spec's binding note says to bind to "whatever the fight surface's mount component is at build time (grep
// GameWorldHud's fight branch), consume only its public mount + the seeded stores, and never copy the
// surface". Grepping it (game/screens/hud/world/GameWorldHud.jsx:296-330) shows the fight surface is NOT one
// component — it is a set of siblings inside a `fight_layer_class` layer, each a pure reader of the fight core
// and the dungeon store:
//
//   FightPlacementBanner · TurnBanner · FightTimeline · EntityTooltip · SpellBar · DungeonBoard
//   FightResult · FightSummary        (the result cards, gated on their own store slices)
//
// So the binding is: mount those same components, in the same layer class, gated by the same phase machine
// (`useFightPhase` → `should_mount_board`). Every one of them is imported from its shipped home — nothing is
// copied, forked, or re-styled, and the world-shell/fight_* modules the cutover lane owns are untouched.
//
// SEVEN OF EIGHT (issue #914). Every sibling above with a shipped home is mounted here. `SpellBar` is the one
// that is NOT: it is a PRIVATE component of GameWorldHud.jsx (declared inside the world HUD's composition
// root, never exported), so the cast bar and its vitals gems have no shared home to import — the only way to
// put them on this page today would be to copy them, which is precisely the divergence the zero-divergence law
// forbids. The extraction is boarded, not worked around here.
//
// ── WHY THIS NEEDS NO S5 EXTRACTION ────────────────────────────────────────────────────────────────────────
// S5 exists in case a chain claim is hard-wired inside the surface. It is not: `DungeonBoard.jsx:133-136` reads
// `commit_turn` / `claim` / `mint_loot` / `abandon` as STORE STATE off `use_dungeon`. fight_shim.js seeds all
// four with local implementations, so the terminal path runs its real code against local no-ops and the
// simulator is structurally unable to sign a transaction. No surface file is modified; the seam was already
// dependency-injected.
//
// The simulator page owns the layer's PLACEMENT (it is a page, not the world tab), so the shell wrapper below
// is the only markup this file contributes.

import { useTranslation } from 'react-i18next'

import { fight_layer_class } from '../game/screens/hud/mobile_layout.js'
import { should_mount_board } from '../fight-engine/phase.js'
import { useFightPhase } from '../game/screens/hud/world/use_fight_phase.js'
import { DungeonBoard } from '../game/screens/hud/world/DungeonBoard.jsx'
import { EntityTooltip } from '../game/screens/hud/EntityTooltip.jsx'
import { FightTimeline } from '../game/screens/hud/FightTimeline.jsx'
import { FightPlacementBanner } from '../game/screens/hud/FightPlacementBanner.jsx'
import { FightResult } from '../game/screens/hud/FightResult.jsx'
import { FightSummary } from '../game/screens/hud/FightSummary.jsx'
import { TurnBanner } from '../game/screens/hud/TurnBanner.jsx'
import { SpellBar } from '../game/screens/hud/SpellBar.jsx'

// THE HUD'S OWN STYLESHEETS. Every `.hud-*` / `.gw-fight-layer` rule the components below are built out of
// lives in these three files, and they were imported by exactly ONE module in the app: GameWorldHud.jsx, the
// world tab this page is not. So the whole layer mounted with no CSS at all — the turn timer and the HP
// numbers leaked out as bare text while the bar, the timeline cards and the board chrome had no box, no
// position and no z-index. The binding is not "mount the components", it is "mount the surface": it brings
// its styles with it, exactly like the world host does.
import '../game/screens/hud/hud.css'
import '../game/screens/hud/world/game-world-hud.css'
import '../game/screens/hud/mobile-fight-hud.css'
import './fight-hud.css'

/**
 * The fight-phase HUD. Renders nothing until the phase machine says a board is up, so the setup phase is never
 * covered by fight chrome and a mid-fight STOP tears the whole layer down with the phase.
 *
 * @param {{ draw?: boolean, slug_by_name?: Readonly<Record<string, string>> }} props `draw` paints the DRAW
 *   banner over the production defeat card — the sim's third outcome (winner 2) has no chain status of its own
 *   (spec §4.4, last row). The page composition root injects the authored item catalog.
 */
export function SimulatorFightHud({ draw = false, slug_by_name = {} }) {
  const { t } = useTranslation()
  const phase = useFightPhase()
  if (!should_mount_board(phase)) return null
  return (
    // `sim-fight-layer` marks this composition as the SIMULATOR's: it is what the sim-only CSS below hangs
    // off (the forfeit door — a sandbox has nothing to forfeit; STOP in the top bar is the one exit).
    <div className={`${fight_layer_class(false)} sim-fight-layer`}>
      {/* placement countdown + the "your turn" cue — both self-gate on the fight core's own phase */}
      <FightPlacementBanner />
      <TurnBanner />
      {/* turn-order cards (left-center) — a pure fight-view reader */}
      <FightTimeline />
      {/* the fighter under the cursor: name + team + HP */}
      <EntityTooltip />
      {/* the S-25 spell bar — gem Vitals on the left, the socket grid + XP strip on the right. #916 extracted it
          out of GameWorldHud.jsx (where it was unexported), so this is the SAME module the world fight mounts,
          not a sim copy: left-click a socket to arm, then a board cell to cast, or press 1-9 / ` for the weapon.
          No spectator branch here — a sandbox has no seatless observer, so the bar is unconditional. */}
      <SpellBar />
      {/* the turn-INPUT bridge: draft a move path, arm and drop a cast, end the turn. Its commit edge routes
          to `use_dungeon.commit_turn`, which fight_shim.js seeded with the local sim submit. */}
      <DungeonBoard />
      {/* the result cards gate on their own store slices, so they outlive the board teardown by a beat */}
      <FightResult slug_by_name={slug_by_name} />
      <FightSummary slug_by_name={slug_by_name} />
      {draw && (
        <div className="sim-draw-banner" role="status">
          {t('simulator.fight_draw')}
        </div>
      )}
    </div>
  )
}
