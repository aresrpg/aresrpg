// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/mount.js — the board VIEWPORT (docs/design/simulator_rebuild_spec.md §7, setup phase).
//
// THE BOARD FLOATS IN THE VOID. The simulator is not a place in the world: it is one fight board, alone,
// under a TRUE ISOMETRIC camera. So the engine boots WORLDLESS (`presentation: 'void'` — no streaming ring, no far
// shell, no materialization grid, no cloud deck, no ambient particles, a near-black backdrop, and an
// ORTHOGRAPHIC render camera) and the board mounts flat at the origin. There is no terrain to stream,
// nothing to wait for, and nothing to bury the camera in.
//
// What it is NOT is a second renderer. Every pixel comes from the SAME modules the world's fights render
// through — `create_engine` (renderer, lighting, camera seam), `create_tactical_board` (geometry,
// highlights, entities, picking, the locked-iso rig), the same `build`/`highlight`/`set_cell_state`/
// `entity_upsert` calls `world-shell/voxel_fight_adapter.js` drives in a live fight. The only difference
// between this scene and a real one is that the world isn't in it.
//
// It decides NOTHING: a cell click is relayed as a fact ("cell (3,4) was clicked"), and legality is the
// reducer's, whose oracle is simulator/board.ts. Every decision it could have made lives in board_paint.ts,
// tested headless — this file is glue, which is why a bun test never needs to import it (the tactical
// facade pulls the character avatar's GLB).
//
// L4 (the fight phase) mounts `create_voxel_fight_adapter` over this SAME engine + board handle: the calls
// below are the setup-phase subset of the adapter's own channels, so the cutover is an addition.

import { create_engine } from '@aresrpg/engine3'
import { create_tactical_board, TEAM_COLORS } from '@aresrpg/engine3/tactical'

import { get_saved_quality, LABEL_TO_TIER } from '../game/screens/hud/world/quality_pref.js'

import { board_key_of, build_spec_of } from './board'

/** Mid-morning: the sun angle the board's relief and the two start-band paints read best under. */
const BOARD_TIME_OF_DAY = 0.28
/** Where the board sits. Arbitrary — in the void there is nothing else to sit near. */
const BOARD_ORIGIN = { x: 0, y: 0, z: 0 }

/**
 * Create the setup-phase board viewport on `canvas`. Nothing is on screen until `show()` resolves.
 * @param {object} args
 * @param {HTMLCanvasElement} args.canvas
 * @param {object} [args.deps] injectable factories — production passes nothing
 * @returns {{ show: (board: any, scene: any) => Promise<void>,
 *   on_cell_click: (cb: (cell: { x: number, y: number } | null) => void) => (() => void), destroy: () => void }}
 */
export function create_board_viewport({ canvas, deps = {} }) {
  const { engine_factory = create_engine, board_factory = create_tactical_board } = /** @type {any} */ (deps)

  const engine = engine_factory({
    canvas,
    tier: LABEL_TO_TIER[get_saved_quality()] ?? undefined,
    // THE VOID (the engine's shared `presentation` fork, beside 'terrain' and hack mode's 'hackgrid'):
    // the world composition minus the world — same renderer, same post stack, same lighting, same mount
    // seams; no terrain, no sky, no dressing, and an ORTHOGRAPHIC camera. `zone_size_m: 0` leaves the
    // border wall unarmed: there is no world to fence.
    presentation: 'void',
    zone_size_m: 0,
  })
  engine.start?.()
  engine.set_time_of_day?.(BOARD_TIME_OF_DAY)
  const board = board_factory({ engine, canvas })

  let destroyed = false
  /** the board currently mounted — a repaint must not re-bake geometry that has not changed */
  let mounted_key = /** @type {string | null} */ (null)
  /** every fighter id on the board, so an unpicked mob / unplaced character is actually despawned */
  let mounted_ids = /** @type {string[]} */ ([])

  /** Apply a folded scene (simulator/board_paint.ts) to the board handle. */
  const paint = (/** @type {any} */ scene) => {
    board.highlight('start_a', scene.start_a, true)
    board.highlight('start_b', scene.start_b, true)
    board.set_cell_state(scene.ally_seats, 'ally_seat')
    board.set_cell_state(scene.enemy_seats, 'enemy_seat')

    const live = scene.fighters.map((/** @type {any} */ fighter) => fighter.id)
    for (const id of mounted_ids) if (!live.includes(id)) board.entity_remove(id)
    mounted_ids = live
    for (const fighter of scene.fighters)
      board.entity_upsert({
        id: fighter.id,
        kind: fighter.kind,
        glb_variant: fighter.glb_variant, // absent ⇒ the engine's S4 capsule stands in
        hair_url: fighter.hair_url,
        colors: fighter.colors ?? null,
        cell: fighter.cell,
        facing: fighter.kind === 'mob' ? 'north' : 'south',
        outline: fighter.kind === 'mob' ? TEAM_COLORS.enemy : TEAM_COLORS.ally,
      })
  }

  return {
    /**
     * Mount `sim_board` in the void and paint `scene`. Re-showing the SAME layout only repaints — the
     * geometry bake never runs twice.
     */
    async show(sim_board, scene) {
      if (destroyed) return
      const key = board_key_of(sim_board)
      if (key === mounted_key) return paint(scene)

      // flat:true — the board is dead flat at BOARD_ORIGIN.y instead of following ground per cell. There
      // is no ground: the terrain-relief path would sample an empty world and hoist the board onto nothing.
      await board.build(build_spec_of(sim_board, BOARD_ORIGIN))
      if (destroyed) return
      mounted_key = key
      mounted_ids = []
      // The locked-iso rig (engine tactical/board_camera.js): polar frozen at 50°, target = the board
      // centroid, azimuth drag + wheel zoom live. The SAME rig every live fight locks onto — it just sizes
      // an orthographic frustum here instead of setting a fov, so the framing math is never duplicated.
      board.camera_lock()
      paint(scene)
    },

    /** Subscribe to raw cell clicks — board-local {x,y}, or NULL when the click missed the board (the
     *  engine's contract v1.2: a miss is an event, not silence). Returns the unsubscribe. */
    on_cell_click(callback) {
      return board.on('cell_click', /** @type {any} */ (callback))
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      board.teardown()
      engine.dispose?.()
    },
  }
}
