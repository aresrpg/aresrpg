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
// L4 (the fight phase) mounts `create_voxel_fight_adapter` over this SAME engine + board handle — and that is
// exactly what `arm_fight()` below does. There is NO simulator fight renderer: the world's adapter builds the
// board, upserts the rigs, paints the range/target/LoS washes, plays every walk and cast beat and relays the
// turn clicks, off the same fight core the world reads. One board language, one implementation, no drift.

import { create_engine } from '@aresrpg/engine3'
import { create_tactical_board, TEAM_COLORS } from '@aresrpg/engine3/tactical'

import { get_saved_quality, LABEL_TO_TIER } from '../game/screens/hud/world/quality_pref.js'
import { fight_scope_sim } from '../world-shell/fight_session_scope.js'

import { board_key_of, build_spec_of } from './board'

/** Mid-morning: the sun angle the board's relief and the two start-band paints read best under. */
const BOARD_TIME_OF_DAY = 0.28
/** Where the board sits. Arbitrary — in the void there is nothing else to sit near. */
const BOARD_ORIGIN = { x: 0, y: 0, z: 0 }
/** Every highlight channel the setup painter writes — and therefore every one it must clear (#927). */
const SETUP_CHANNELS = ['start_a', 'start_b', 'ally_seat', 'enemy_seat']

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
  /** the WORLD's fight adapter while a fight owns this board (null in setup) */
  let adapter = /** @type {{ destroy: () => void } | null} */ (null)

  // THE QA DRIVE SEAMS (#1025) — the window API the world registers from GameWorldHud, over the board this page
  // mounts, so ONE headless rig drives both surfaces by cell instead of pixel-hunting a 3D raycast here. DEV
  // builds only, dynamically imported so the whole seam tree drops out of a production bundle (#1006's ruling,
  // pinned by packages/frontend/scripts/assert_clean_bundle.mjs).
  if (import.meta.env.DEV)
    void import('./dev_seams.js').then(({ register_sim_dev_seams }) => {
      if (!destroyed) void register_sim_dev_seams({ engine, board, canvas })
    })

  /**
   * THE PAINTER'S LAST ACT (#927) — every setup pixel off the board: both start bands, both seat channels,
   * every placed sprite. The handoff below cannot lean on the adapter's own `board.build()` to erase them:
   * build is a documented same-args NO-OP (contract v1.1), and the fight is fought on the very board the
   * player was just editing, so the args routinely match and nothing is rebuilt — the start zones stay
   * painted and every setup sprite keeps standing beside the fight's own rig. The one-writer law is the
   * painter's to keep, in pixels as in verbs: it erases itself, it does not hope to be overwritten.
   */
  const unpaint = () => {
    for (const channel of SETUP_CHANNELS) board.clear_states(channel)
    for (const id of mounted_ids) board.entity_remove(id)
    mounted_ids = []
  }

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

    /**
     * HAND THE BOARD TO THE FIGHT. `create_voxel_fight_adapter` is the world's own board driver: from here on
     * it owns the build, the rigs, the washes, the beats and the click relay, reading the SAME fight core and
     * dungeon store the world reads (fight_shim.js seeds both). The setup painter STANDS DOWN first
     * (`unpaint`, #927) and stays quiet for the duration — two writers on one board handle is the one thing
     * this seam must not do, and a residue left behind is that second writer's handwriting.
     *
     * Lazy-imported: the adapter drags the whole combat presentation tree (vfx, sfx, the fight folds), and a
     * setup session must not pay for it.
     */
    async arm_fight() {
      if (destroyed || adapter) return
      unpaint() // #927 — synchronously, BEFORE the await: no frame ever shows setup chrome under a live fight
      const { create_voxel_fight_adapter } = await import('../world-shell/voxel_fight_adapter.js')
      if (destroyed || adapter) return
      // The board floats at the origin in the void — the same seat the setup board is built on, so the fight
      // opens exactly where the player was just editing instead of flying somewhere else.
      adapter = create_voxel_fight_adapter(board, { origin: BOARD_ORIGIN, scope: fight_scope_sim, engine, canvas })
      mounted_key = null // the adapter rebuilds the board itself; the setup bake is no longer what stands
    },

    /** Take it back for setup. The next `show()` re-bakes the setup board from scratch (`mounted_key` null). */
    disarm_fight() {
      adapter?.destroy()
      adapter = null
      mounted_key = null
      mounted_ids = []
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      adapter?.destroy()
      adapter = null
      board.teardown()
      engine.dispose?.()
    },
  }
}
