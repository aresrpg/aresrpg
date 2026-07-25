// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/mount.js — the board VIEWPORT (docs/design/simulator_rebuild_spec.md §7, setup phase).
//
// The page's imperative 3D composition, the `packages/engine/demo/board_demo.js` standalone precedent
// upgraded to production wiring: ONE engine streaming the REAL world terrain around the board's anchor, the
// production tactical board mounted ON that ground, and the setup-phase paints applied from a scene the pure
// fold (simulator/board_paint.ts) computed. It decides NOTHING: a cell click is relayed as a fact ("cell
// (3,4) was clicked"), and legality is the reducer's, whose oracle is simulator/board.ts.
//
// This file is glue by construction — every decision it could have made lives in board_paint.ts or
// ground_probe.js, both of which are tested headless. It is the one module a bun test cannot import (the
// tactical facade pulls the character avatar's GLB), which is exactly why it holds no logic.
//
// L4 (the fight phase) mounts `create_voxel_fight_adapter` + the locked-iso fight camera over this SAME
// engine + board handle: the calls below are the setup-phase subset of the adapter's own channels, so the
// cutover is an addition, never a rewrite.

import { create_engine, world_config_for_biome } from '@aresrpg/engine3'
import { create_tactical_board, TEAM_COLORS } from '@aresrpg/engine3/tactical'
import { ground_surface_y } from '@aresrpg/engine3/player'

import { get_saved_quality, LABEL_TO_TIER } from '../game/screens/hud/world/quality_pref.js'

import { build_spec_of } from './board'
import { wait_for_ground, board_mount_key } from './ground_probe.js'

/** The lobby world recipe — the terrain a player already knows from the world tab. */
const SIMULATOR_BIOME = 'rainforest'
/** Mid-morning: warm enough to read the two start-band paints against the ground. */
const BOARD_TIME_OF_DAY = 0.28

const raf_frame = () =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve(undefined))
  })

/**
 * Create the setup-phase board viewport on `canvas`. Nothing is on screen until `show()` resolves.
 * @param {object} args
 * @param {HTMLCanvasElement} args.canvas
 * @param {object} [args.deps] injectable factories — production passes nothing
 * @returns {{ show: (board: any, scene: any) => Promise<void>,
 *   on_cell_click: (cb: (cell: { x: number, y: number }) => void) => (() => void), destroy: () => void }}
 */
export function create_board_viewport({ canvas, deps = {} }) {
  const {
    engine_factory = create_engine,
    board_factory = create_tactical_board,
    next_frame = raf_frame,
    now = () => performance.now(),
  } = /** @type {any} */ (deps)

  const engine = engine_factory({
    canvas,
    tier: LABEL_TO_TIER[get_saved_quality()] ?? undefined,
    zone_origin: [0, 0],
    load_radius: 4,
    world_config: world_config_for_biome(SIMULATOR_BIOME),
  })
  engine.start?.()
  engine.set_time_of_day?.(BOARD_TIME_OF_DAY)
  const board = board_factory({ engine, canvas })

  let destroyed = false
  /** the board currently mounted — a repaint must not re-stream terrain that has not changed */
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
     * Mount `sim_board` over the real terrain at its anchor and paint `scene`. Re-showing the SAME board
     * only repaints — the terrain wait and the geometry bake never run twice.
     */
    async show(sim_board, scene) {
      if (destroyed) return
      const key = board_mount_key(sim_board)
      if (key === mounted_key) return paint(scene)

      // Aim the streaming ring at the site, then WAIT for real ground: the board grounds itself off the
      // land at build() time, so the column must be resident first (the demo's D167-B discipline).
      const center_x = sim_board.anchor.x + sim_board.width
      const center_z = sim_board.anchor.z + sim_board.height
      engine.set_camera_position?.([center_x, 175, center_z + 40])
      engine.set_camera_orientation?.(Math.PI, -0.5)
      const floor_y = await wait_for_ground({
        surface_at: (x, z) => ground_surface_y((bx, by, bz) => engine.sample_block(bx, by, bz), x, z),
        sample_block: (x, y, z) => engine.sample_block(x, y, z),
        next_frame,
        now,
        x: Math.floor(center_x),
        z: Math.floor(center_z),
      })
      if (destroyed) return

      await board.build(build_spec_of(sim_board, { x: sim_board.anchor.x, y: floor_y, z: sim_board.anchor.z }))
      if (destroyed) return
      mounted_key = key
      mounted_ids = []
      board.camera_lock()
      paint(scene)
    },

    /** Subscribe to raw cell clicks (board-local {x,y}); returns the unsubscribe. */
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
