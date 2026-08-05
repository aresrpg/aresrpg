// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D211 ("I should have been teleported in the cave directly, no questions asked") — the CAVE
// TRANSITION. The dungeon plane always published off dungeon_store.in_session (optimistic, pre-tx), but
// its only consumer was roam.js — DEAD since D139: join/create/resume all set state into the void and the
// player stayed in the lobby staring at a card. THIS module is the voxel consumer: in_session flips true
// → mount the ENG-17 cave room (deterministic per dungeon id) + teleport the controller to its floor +
// swap the collision oracle to the room's own sampler (the streamed ring never sees standalone cave
// chunks — D141); in_session drops → teardown + teleport back where you stood. Create, JOIN and RESUME
// all ride this for free (they all drive in_session). NO tx logic here — dungeon_store owns the chain.

import { create_cave_room } from '@aresrpg/engine3/cave'

import { use_dungeon } from '../world-shell/dungeon_store.js'
import { use_auth } from '../auth'
// D224 SIDE-EFFECT IMPORT — dungeon_dimension.wire() (roster publisher + engage listener) runs at module
// load, and its old static importers (roam + the pre-voxel HUD) were DELETED: the module silently stopped
// loading, so the room roster never reached visible_mobs_group and the cave stayed empty. The cave is the
// voxel consumer — it owns the revival.
import '../world-shell/dungeon_dimension.js'
import { create_cave_mobs } from './cave_mobs.js'
import { plant_fight_sword } from './fight_sword.js'
import { context } from './store.js'
import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'

/** Deterministic cave seed from the dungeon object id — every participant digs the same room. */
const seed_from = (/** @type {string} */ dungeon_id) => Number.parseInt(dungeon_id.slice(2, 10), 16) || 1

const STATUS_OPEN = 0 // dungeon.move status — the pre-fight waiting room (the only auto-release window)
// D287 leg-a — WALK-OUT RELEASE tuning. The room is generated SEALED (cave_room.js builds solid-first), so a
// legit on-foot walk-out doesn't exist — but displaced bodies (the D213 fall-through class, the dev fly camera)
// end up roaming the overworld while the character sits escrowed in an OPEN dungeon, and nothing reacted
// (cave_scene exposes `bounds` for a soft-clamp that was never wired). Horizontal-only check on purpose: a
// straight-down fall keeps x/z inside the footprint and is the floor net's job (it returns the body to the
// cave entry well inside the settle window), so a fall can never false-fire an abandon.
const OUT_MARGIN = 8 // blocks beyond the room's interior extents before a body counts as outside
const OUT_TICKS = 4 // consecutive 1s ticks outside before the release fires (settle window — no boundary flicker)

/**
 * @param {{ engine: any, ctl: any, canvas?: HTMLElement | null, swap_sampler: (fn: ((x:number,y:number,z:number)=>number) | null) => void,
 *   set_home: (pos: [number, number, number] | null) => void,
 *   overlay_root: ReturnType<import('./world_overlay_root.js').create_world_overlay_root> }} args `set_home` re-targets the D188 floor
 *   net (a fall INSIDE the cave must return to the CAVE entry, never the overworld spawn — body/state
 *   divergence class, qa-caught). `canvas` = the WORLD canvas (D232 — plate projection rect).
 * @returns {{ dispose: () => void, get_board_anchor: () => { x: number, y: number, z: number } | null }}
 */
export function create_cave_session({ engine, ctl, canvas = null, swap_sampler, set_home, overlay_root }) {
  /** @type {any} */ let cave = null
  /** @type {{ dispose: () => void } | null} */ let mobs = null
  /** @type {{ dispose: () => void } | null} */ let sword = null // D280 — the fight-start beacon (planted on engage)
  /** @type {[number, number, number] | null} */ let prev_pos = null
  let mounting = false
  /** @type {ReturnType<typeof setInterval> | null} */ let bounds_timer = null
  let outside_ticks = 0
  let auto_left = false

  // D287 leg-a — the WALK-OUT RELEASE (D27's invariant + the item-15 invariant: "if we are in a dungeon, then we
  // should be in it, not in the world"). While the cave is mounted, the run still OPEN (pre-fight) and EVERY
  // escrow seat mine (SOLO only — auto-abandoning a co-op seat would grief the party; members outside keep the
  // resume pill), a body outside the room's horizontal bounds for OUT_TICKS consecutive seconds fires the SAME
  // leave flow the DungeonLeaveButton runs: dungeon_store.abandon() — the tx releases the escrow (contract:
  // escrow_remove is status-unconditional), abandon's own single toast is the surface (one-toast law), its
  // roster refetch drops the in_dungeon tag, and the in_session drop unmounts this cave via the normal exit.
  const check_bounds = () => {
    if (!cave || auto_left) return
    const { dungeon } = use_dungeon.getState()
    const me = use_auth.getState().address
    const seats = dungeon?.escrow ?? []
    const solo = !!me && seats.length > 0 && seats.every((/** @type {any} */ p) => p.addr === me)
    if (dungeon?.status !== STATUS_OPEN || !solo) {
      outside_ticks = 0 // fight started / co-op / no read yet — never auto-release
      return
    }
    const [x, , z] = ctl.get_transform().position
    const b = cave.bounds
    const outside =
      x < b.min_x - OUT_MARGIN || x > b.max_x + OUT_MARGIN || z < b.min_z - OUT_MARGIN || z > b.max_z + OUT_MARGIN
    outside_ticks = outside ? outside_ticks + 1 : 0
    if (outside_ticks >= OUT_TICKS) {
      auto_left = true // one shot — abandon() drops in_session → exit() kills this watcher
      game_log('cave', 'body left the cave region while the dungeon sat OPEN (solo) — auto-releasing (D287/D27)')
      void use_dungeon.getState().abandon()
    }
  }
  const start_bounds_watch = () => {
    stop_bounds_watch()
    auto_left = false
    bounds_timer = setInterval(check_bounds, 1000)
  }
  const stop_bounds_watch = () => {
    if (bounds_timer) clearInterval(bounds_timer)
    bounds_timer = null
    outside_ticks = 0
  }

  // D280 — the FIGHT-START CEREMONY sword. We own the engine + the pack anchor (room.mob_spawn), so we render
  // the beacon; the lifecycle brain is dungeon_dimension.engage, which drives us over the shared events bus:
  // 'fight_ceremony/plant' at the mob-pack click, 'fight_ceremony/despawn' once the board mounts (or the start
  // aborts). Registered once per session, torn down on dispose.
  const plant_sword = () => {
    sword?.dispose()
    sword = cave ? plant_fight_sword({ engine, anchor: cave.mob_spawn }) : null
  }
  const despawn_sword = () => {
    sword?.dispose()
    sword = null
  }
  context.events.on('fight_ceremony/plant', plant_sword)
  context.events.on('fight_ceremony/despawn', despawn_sword)

  const enter = async (/** @type {string} */ seed_source) => {
    if (cave || mounting) return
    mounting = true
    try {
      // placeholder_mob:false — D224 mounts the room roster's REAL creature GLBs (cave_mobs) instead of
      // the engine's stand-in box (the designed swap per the cave_scene contract).
      const room = create_cave_room({ seed: seed_from(seed_source), placeholder_mob: false })
      // D213-REOPEN (qa: intermittent in-cave fall-through → net teleported to the OVERWORLD spawn while
      // in_session stayed true — body/state DIVERGENCE). ROOT CAUSE: the collision oracle, the teleport,
      // and the floor-net home all used to run AFTER `await room.mount` — but mount only builds the RENDER
      // (mesh + upload, `await wait_for_engine` up to 20 s). `room.sample_block` (the pure gen — physics
      // collision) and `room.player_spawn` are ready SYNCHRONOUSLY the instant `create_cave_room` returns.
      // Deferring the swap/teleport/home across that async gap left a window where in_session was honored
      // but the body still sampled the OVERWORLD at its old pose with a NULL cave home — a fall in that
      // window went to WORLD_SPAWN. FIX: arm collision + teleport in + set the net home NOW, before the
      // await; mount only paints the walls afterward. `cave` is set here too so the belt/discriminator see
      // an active cave immediately (a mount reject below tears it all back down in the catch).
      prev_pos = /** @type {[number,number,number]} */ ([...ctl.get_transform().position])
      swap_sampler(room.sample_block) // controller + camera collide with the CAVE while inside
      // D188-cave: set the floor-net home to the CAVE ENTRY *before* the body can be ticked in-cave, so an
      // in-cave fall (however it happens — the cave's sub-floor is void below y≈61) ALWAYS returns here,
      // never the overworld. Ordered before teleport: the net home is armed the instant the body moves.
      set_home(/** @type {[number,number,number]} */ ([...room.player_spawn]))
      ctl.teleport(/** @type {[number,number,number]} */ ([...room.player_spawn]))
      // D1 TELEPORT-FIRST proof: this teleport runs SYNCHRONOUSLY inside the store's optimistic set() (pre-tx),
      // so click→visible is one tick — the ~7s wait is gone (the store logs the click-side delta).
      game_log('DNG', `cave.enter: teleport → cave floor [${room.player_spawn.join(', ')}] (pre-tx, D1)`)
      cave = room
      start_bounds_watch() // D287 leg-a — armed the instant the body is cave-resident (dies in exit/catch)
      await room.mount(engine) // renders the room (mesh/upload); collision already lives off sample_block
      // D1 TELEPORT-FIRST race: the entry is now optimistic (fires pre-tx). If the tx failed FAST, exit() ran
      // DURING this async mount and already tore this room down + nulled `cave` — bail so we never paint mobs /
      // pause streaming / kill the fog for a cave the player was pulled back out of (a dark, frozen overworld).
      if (cave !== room) return
      // D224 — the room roster's mob pack (visible_mobs_group's voxel consumer): real GLBs at mob_spawn,
      // facing the entrance; clicking it in range fires the old roam engage wire. Dies with the cave.
      mobs = create_cave_mobs({
        engine,
        canvas, // D232 — the world canvas rect is the projection frame
        anchor: /** @type {[number,number,number]} */ ([...room.mob_spawn]),
        face_toward: /** @type {[number,number,number]} */ ([...room.player_spawn]),
        get_player_pos: () => ctl.get_transform().position,
        overlay_root,
      })
      // D211-addendum (in-cave screenshot: the E "enter the dungeons" box leaked INSIDE the cave):
      // lobby affordances are lobby-state — suppress the NPC prompt for the whole cave stay.
      context.dispatch('action/npc_prompt', null)
      // D213 ("only that room should generate"): pause the overworld ring while the cave is
      // mounted — the engine knob (set_streaming_paused: no new gen/mesh/uploads, resident chunks KEPT
      // for the exit teleport-back). Cave mood: crush the overworld height-fog (pale at cave depth).
      engine.set_streaming_paused?.(true)
      // Cave ambience (architect supersede): scene fog = max(height_f, range_f) — pushing far-fog out was
      // provably useless against the HEIGHT term. set_fog_scale(0) kills the whole fog stack at depth
      // (dark enclosed cave, sun-shaft pools, glowing mushrooms); restored to 1 on exit. Pre-boot-queued.
      engine.set_fog_scale?.(0)
      game_log('cave', `entered the dungeon cave at [${room.player_spawn.join(', ')}] (D211)`)
    } catch (error) {
      // D213-REOPEN: collision + net home + teleport now arm SYNCHRONOUSLY before `await room.mount`, so a
      // mount reject must fully revert — else we'd leave the body in-cave with the overworld render (the
      // divergence we're killing, inverted). Restore the overworld oracle, re-home the net, snap the body
      // back to where it stood, and clear `cave` so a retry can re-enter.
      game_log('cave', 'mount failed — reverting to overworld (world stays playable):', error)
      report_error(error, { area: 'dungeon', action: 'cave_mount' })
      stop_bounds_watch() // the watcher is cave-scoped — a reverted mount must not keep it ticking
      swap_sampler(null)
      set_home(null)
      if (prev_pos) ctl.teleport(prev_pos)
      cave = null
    } finally {
      mounting = false // MUST reset on every exit path (incl. the mid-mount race `return` above)
    }
  }

  const exit = () => {
    if (!cave) return
    stop_bounds_watch() // the watcher dies with the cave (loops law)
    despawn_sword() // D280 — the beacon never outlives the cave
    mobs?.dispose() // D224 — the pack (rigs + chip + click wire) dies before the room does
    mobs = null
    try {
      cave.teardown()
    } catch {
      /* already gone */
    }
    cave = null
    swap_sampler(null) // back to the world oracle
    set_home(null) // floor net back to the overworld spawn
    engine.set_streaming_paused?.(false) // D213 — the ring wakes with the overworld
    engine.set_fog_scale?.(1) // the overworld fog stack returns (architect's master gate)
    // the lobby affordance returns with the lobby (mirror of embed's D162 boot dispatch)
    context.dispatch('action/npc_prompt', { npc_id: 'dungeon_gate', label: 'dungeons' })
    if (prev_pos) ctl.teleport(prev_pos)
    game_log('cave', 'left the dungeon cave — back overworld (D211)')
  }

  const on_state = (/** @type {any} */ s) => {
    // D1 TELEPORT-FIRST: mount on the PRE-TX optimistic flip. `world_id` is seeded synchronously at entry (seconds
    // before the post-tx `dungeon_id`), and the cave seeds its room off it (co-op consistent — same world, same
    // room), so the teleport is near-instant. enter() is idempotent (the cave/mounting guard), so the later
    // dungeon_id arrival is a no-op. `?? dungeon_id` keeps the pre-D1 fallback for any path that lacks world_id.
    const seed = s.world_id ?? s.dungeon_id
    if (s.in_session && seed) void enter(seed)
    else if (!s.in_session) exit()
  }
  const unsub = use_dungeon.subscribe(on_state)
  on_state(use_dungeon.getState()) // a boot-resume may be in_session BEFORE this session mounted

  return {
    dispose() {
      unsub()
      context.events.off('fight_ceremony/plant', plant_sword) // D280 — release the beacon bus wires
      context.events.off('fight_ceremony/despawn', despawn_sword)
      exit() // despawns the sword + tears the cave down
    },
    /** D230 — the mounted cave's board anchor (world min-corner for the tactical board), null overworld.
     *  The fight adapter's origin_of consumes this so the board builds ON THE CAVE FLOOR (the fixed
     *  overworld origin built it at y=260 — an invisible sky board). */
    get_board_anchor() {
      return cave ? { x: cave.board_anchor[0], y: cave.board_anchor[1], z: cave.board_anchor[2] } : null
    },
    /** D213-REOPEN — the mounted cave's entry (player_spawn), null overworld. The embed's floor-net BELT
     *  reads this so an in-cave fall returns to the CAVE even if `net_home` were ever null (defence in
     *  depth against the body/state divergence — the net must NEVER send an in-cave body to WORLD_SPAWN). */
    get_cave_home() {
      return cave ? /** @type {[number,number,number]} */ ([...cave.player_spawn]) : null
    },
  }
}
