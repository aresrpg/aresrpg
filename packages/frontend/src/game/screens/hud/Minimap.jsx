// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Cube-World MINIMAP (top-right) — a live 3-D relief map of the REAL voxel world around the player. The
// terrain is the engine's analytic per-column {height, map-colour} (world_minimap_column), hill-shaded and
// drawn under an oblique tilt that ROTATES with the camera (an EASED heading, round 5 — see use_minimap.js)
// so the heading is always up (a fixed centre arrow, orbiting north tick) — the Cube-World convention. Mob
// GROUPS (red) + resource NODES (gold) plot from the live overworld spawn store; other PLAYERS (cyan) plot
// from the presence bridge (see below). Clicking opens the expanded modal map. The lens is a bare
// borderless mount — no ring/corner chrome, just the scanline overlay — with the terrain anchored off-centre
// toward the corner (see
// use_minimap.js's CORNER_BIAS). Self-gates on the walker's pose (null in spectate / pre-boot).
//
// PERF (brief law, re-measured round 5 @ 2x size + DPR backing): SAMPLING is lazy (a resample effect fires
// only when the player crosses a ~cell; measured ~7 ms), the per-frame DRAW re-projects the cached relief
// grid directly (render_oblique, no cached bitmap) — measured ~3.5ms/frame at this file's 400px size, inside
// the ≤4ms budget — and is skipped entirely on idle frames. See use_minimap.js.
//
// OTHER PLAYERS: peer dots project from the SAME presence bridge every other HUD surface reads —
// core/modules/presence.js's `state.visible_characters` — via presence_markers.js's pure adapter, never a
// second subscription to the p2p store. Computed fresh every render (not memoized on the Map — see that
// file's header for why) and concatenated with the spawn markers below.

import { useMemo, useRef, useState } from 'react'

import { use_game_state } from '../../store.js'
import { use_world_spawns } from '../../world_spawns_store.js'
import { use_minimap } from './use_minimap.js'
import { MinimapModal } from './MinimapModal.jsx'
import { peer_markers } from './presence_markers.js'
import './minimap.css'

const SIZE = 400 // doubled from the original 200 for legibility at a glance
const VIEW_RADIUS_BLOCKS = 48 // blocks from centre to the rim (the small-map zoom)
const SAMPLE_N = 80 // terrain bitmap resolution (≈2 blocks/texel over the covered span)

/** @returns {import('react').ReactElement | null} */
export function Minimap() {
  const pose = use_game_state((s) => s.player_pose)
  const spawns = use_world_spawns((s) => s.spawns)
  const visible_characters = use_game_state((s) => s.visible_characters)
  const canvas_ref = useRef(/** @type {HTMLCanvasElement | null} */ (null))
  const [open, set_open] = useState(false)

  // Markers: plot every live spawn (draw_minimap culls to the disc); dots only on the small map (no hover/click
  // — the whole lens is one click target that opens the big map). Spawn markers are memoised (spawns change
  // rarely — zone reconciliation); peer markers are recomputed fresh every render on purpose (presence_markers.js
  // — visible_characters is a stable Map mutated in place, so a memo keyed on it would never see a peer move).
  const spawn_markers = useMemo(
    () => spawns.map((s) => ({ x: s.x, z: s.z, kind: s.kind, key: s.key })),
    [spawns]
  )
  const markers = [...spawn_markers, ...peer_markers(visible_characters)]
  use_minimap(canvas_ref, { size: SIZE, view_radius_blocks: VIEW_RADIUS_BLOCKS, sample_n: SAMPLE_N, markers, enabled: !!pose })

  // Spectate / pre-first-frame: no pose published → no map (PartyFrame's render-nothing idiom).
  if (!pose) return null

  return (
    <>
      <div className="mm" style={{ '--mm-size': `${SIZE}px` }}>
        {/* The lens is a bare mount, zero frame/ring/corner
            chrome; the slab floats directly on the game view (its own silhouette is the only visible edge,
            per the round-3 no-mask convention). A hover cue survives as a drop-shadow ON THE CANVAS ALONE
            (minimap.css `.mm-lens:hover .mm-canvas`), so it hugs the terrain's alpha shape, not a box. */}
        <button
          type="button"
          className="mm-lens"
          aria-label="Open map"
          onClick={() => set_open(true)}
        >
          <canvas ref={canvas_ref} className="mm-canvas" width={SIZE} height={SIZE} />
          <span className="mm-scan" aria-hidden="true" />
        </button>
      </div>
      {open && <MinimapModal onClose={() => set_open(false)} />}
    </>
  )
}
