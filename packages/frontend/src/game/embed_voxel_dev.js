// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY qa rig for the voxel session (split from embed_voxel.js at the 600-LoC law). Window hooks
// the probes/qa drives lean on (pointer lock is blocked under automation — camera drives go through
// cam.rotate, the engine bench's own pattern). __dev_engage / __dev_start_fight are the D166/D169
// interim direct lines to the dungeon flow — self-documented, they retire with the #47 dimension mount.
// Tree-shaken from prod (the caller is inside `if (import.meta.env.DEV)`).

import { context } from './store.js'
import { fight_view } from '@aresrpg/fight/project'
import { HIT_FLASH_TINT } from '../world-shell/voxel_fight_adapter.js'
import { game_log } from '../core/log.js'
import { scan_for_claimable_group } from './dev/world_fight_scan.js'

/**
 * The rig mounts into a CLEAN store — but a reset that discards an EXISTING session deletes the very
 * precondition a drive may be there to test (#1645: a stale boot fight reference surviving into a fresh
 * engage). Every proof drive through these seams was structurally blind to that whole class because this
 * clear ran silently. It never does again: what is thrown away is announced on the console, loudly and
 * unconditionally — game_log is the quiet channel and a driver reading the console must not have to opt in.
 * @param {any} use_dungeon the store module's singleton @param {string} seam which rig hook is clearing
 */
const discard_session_for_dev_mount = (use_dungeon, seam) => {
  const { fight_id, run_pass_id } = use_dungeon.getState()
  if (!fight_id && !run_pass_id) return
  console.warn(
    `[dev] ${seam}: DISCARDING an existing session before mount — fight_id=${fight_id} run_pass_id=${run_pass_id}. ` +
      'This drive can no longer observe a stale-session bug; drive the store directly to keep that precondition.'
  )
  use_dungeon.getState().reset_local()
}

/**
 * @param {{ engine: any, board: any, ctl: any, cam: any, canvas: HTMLCanvasElement, get_avatar: () => any,
 *   trigger_zoom_punch?: () => void, trigger_fight_entry?: () => void }} rig
 */
export function install_dev_rig({
  engine,
  board,
  ctl,
  cam,
  canvas,
  get_avatar,
  trigger_zoom_punch,
  trigger_fight_entry,
  cue_shake,
}) {
  const w = /** @type {any} */ (window)
  w.__voxel_engine = engine
  w.__voxel_board = board
  w.__voxel_cue_shake = cue_shake // [fight-feel] the fight-cam add_shake — dev_probe.__ARES_DEV_CAST_VFX fires the real impact jolt
  // the SAME canvas create_tactical_board/board_picking hold — the fight probes' cell↔pixel hook
  // (dev_probe.__ARES_DEV_CELL_SCREEN) reads its bounding rect to invert board_picking's ndc math.
  w.__voxel_canvas = canvas
  w.__voxel_ctl = ctl
  w.__voxel_avatar = get_avatar // rig introspection (ready/object3d state) — the D191 probe's eyes
  // D195: pointer lock is BLOCKED under automation (camera_rig contract) — qa/probes drive the orbit
  // through cam.rotate(dx, dy) exactly as the engine's own acceptance bench does.
  w.__voxel_cam = cam
  // D166 INTERIM (qa rig): the mob-cluster click died with roam.js — dungeon_dimension.engage() is complete
  // (leader/status/one-toast guards intact) but caller-less on voxel. DungeonsModal's Start button is the
  // human path; this is the rig's direct line. DEV-only. Retires with the #47 voxel dimension mount.
  w.__dev_engage = () =>
    import('../world-shell/dungeon_dimension.js').then((m) => m.use_dungeon_dimension.getState().engage())
  // D169 rig helper (qa): ONE call = create the dungeon AND start room 0 seeded — bypasses the modal's
  // flaky UI clicks using the EXACT production actions (create_dungeon_as_leader → engage/start_when_ready).
  // Source = the store's world (T62_WORLDS[0]) — create_dungeon_as_leader reads the world's own dungeon
  // rooms (S-46), same as the UI create (no arg, honest). DEV-only; retires with the #47 dimension mount.
  w.__dev_start_fight = async () => {
    const { use_dungeon } = await import('../world-shell/dungeon_store.js')
    const store = await import('./store.js')
    const character_id = store.context.get_state().selected_character_id
    if (!character_id) return game_log('dev', 'no selected character')
    // D171(c) FORCE-CLEAN: a character still escrowed in ANY prior dungeon (terminal-unclaimed crash debris
    // included) bricks the create (join MoveAborts: not in kiosk). Abandon the stale escrow first — the rig
    // wants determinism, not that dungeon's rewards. Roster tag = the chain-truth pointer.
    const { load_roster } = await import('../roster/load_roster.js').catch(() => ({ load_roster: null }))
    if (load_roster) await load_roster().catch(() => {})
    const me = store.context.get_state().sui?.characters?.find((c) => c.id === character_id)
    if (me?.in_dungeon && me?.dungeon_id) {
      game_log('dev', 'start_fight: abandoning stale escrow first', me.dungeon_id)
      await use_dungeon.getState().abandon_escrowed(me.dungeon_id)
    }
    await use_dungeon.getState().create_dungeon_as_leader(character_id)
    const { use_dungeon_dimension } = await import('../world-shell/dungeon_dimension.js')
    await use_dungeon_dimension.getState().engage()
    // D169b (qa: chain fight started but the board never mounted for 32s): fold the post-engage status NOW
    // instead of waiting for the 4s poll, and print the derived state so a still-stuck run self-diagnoses.
    await use_dungeon.getState().refresh()
    const s = use_dungeon.getState()
    const g = store.context.get_state()
    game_log('dev', 'start_fight state:', {
      dungeon_id: s.dungeon_id,
      status: s.dungeon?.status,
      phase: s.phase,
      fight_mode: g.fight_mode,
      fighters: fight_view()?.fighters?.size ?? 0,
    })
    return s.dungeon_id
  }

  // WORLD-FIGHT rig helper (qa): ONE call = claim+create a REAL world fight over a live discovered mob group
  // and MOUNT it, using the EXACT production path (create_world_fight → enter_world_fight — the same two calls
  // world_spawns' [R]/click engage fires). It iterates the discovered zones' mob spawns and lets the tx choke's
  // dry-run REFUSE any spawn not in the character's checkpoint zone for FREE (zero-gas over_ceiling/sim_failed),
  // so the first claimable group in reach is the one that actually executes. The refusal POLICY (fail fast on a
  // character-wide strand, skip an out-of-reach zone whole, and report the real cause instead of burning the
  // ceiling) lives in dev/world_fight_scan.js — #1263. DEV-only; retires with the world click being reliably
  // drivable headless.
  w.__dev_start_world_fight = async () => {
    const store = await import('./store.js')
    const character_id = store.context.get_state().selected_character_id
    if (!character_id) return game_log('dev', 'no selected character')
    const [
      { use_dungeon },
      { enter_world_fight },
      { create_world_fight },
      { fetch_world_binding },
      { get_zones },
      { zone_rows_v1 },
    ] = await Promise.all([
      import('../world-shell/dungeon_store.js'),
      import('../world-shell/world_fight.js'),
      import('../world-shell/dungeon_engage_actions.js'),
      import('../world-shell/session_gate.js'),
      import('../rpc/client'),
      import('./zone_rows.js'),
    ])
    discard_session_for_dev_mount(use_dungeon, '__dev_start_world_fight')
    const world_id = (await fetch_world_binding(character_id)) ?? use_dungeon.getState().world_id
    if (!world_id) return game_log('dev', 'start_world_fight: character has no world binding')
    const zdata = await get_zones(world_id).catch(() => null)
    const zones = (zdata?.zones ?? []).filter((z) => z.discovered !== false)
    /** @type {{spawn_id:number|string, template_id:string, zx:number, zy:number}[]} */
    const mobs = []
    for (const z of zones) {
      const rows = (await zone_rows_v1(world_id, z.zx, z.zy).catch(() => null)) ?? []
      // zx/zy ride along: the production engage passes them (world_spawns.js), and a zone-scoped refusal can
      // only skip a zone's remaining groups if each candidate still knows which zone it came from.
      for (const r of rows)
        if (r.kind === 'mob') mobs.push({ spawn_id: r.spawn_id, template_id: r.template_id, zx: z.zx, zy: z.zy })
    }
    game_log(
      'dev',
      `start_world_fight: ${mobs.length} discovered mob groups; trying each (dry-run refuses wrong-zone free)`
    )
    const scan = await scan_for_claimable_group({
      candidates: mobs,
      log: (line) => game_log('dev', `start_world_fight: ${line}`),
      attempt: async ({ spawn_id, template_id, zx, zy }) => {
        const { fight_id } = await create_world_fight({
          world_id,
          spawn_id,
          zx,
          zy,
          mob_template_id: template_id,
          character_id,
        })
        return fight_id
      },
    })
    if (scan.fight_id) {
      enter_world_fight({ fight_id: scan.fight_id, world_id, character_id })
      await use_dungeon.getState().refresh()
      const s = use_dungeon.getState()
      const g = store.context.get_state()
      game_log('dev', 'start_world_fight MOUNTED:', {
        fight_id: scan.fight_id,
        dungeon_id: s.dungeon_id,
        status: s.dungeon?.status,
        phase: s.phase,
        fight_mode: g.fight_mode,
        fighters: fight_view()?.fighters?.size ?? 0,
        mobs: s.dungeon?.mobs?.length ?? 0,
      })
      return scan.fight_id
    }
    // The REAL cause, always — a scan that ran out of candidates is a different fact from a stranded seat, and
    // the counts say which (#1263: both used to surface as the same silent 420s timeout). The verdict is also
    // parked on the window so a headless driver can name the cause it hit (fight_bot/world_surface.mjs); the
    // hook's own return stays `fight_id | null`, the shape every e2e spec binds to.
    w.__dev_last_world_fight_scan = scan
    game_log('dev', 'start_world_fight: no fight claimed', {
      verdict: scan.verdict,
      attempted: scan.attempted,
      of: mobs.length,
      skipped_zones: scan.skipped_zones,
      refusals: scan.tally,
      reason: scan.reason?.slice(0, 160) ?? null,
    })
    return null
  }

  // WORLD-FIGHT RESUME rig helper (qa): ENTER an EXISTING world fight by id — the reconnect path MINUS the RPC
  // discovery (enter_world_fight reads the Fight chain-direct via the store's refresh, so a stale RPC never
  // blocks it). Drives a KNOWN live fight straight through the board-mount fix (origin_of's world-anchor
  // branch). Runs in the app's real module graph (this file is app-loaded) so it hits the live use_dungeon
  // singleton — never the page-side second-instance trap. DEV-only.
  w.__dev_enter_world_fight = async (fight_id, world_id, character_id = null) => {
    const cid = character_id ?? context.get_state().selected_character_id
    const [{ use_dungeon }, { enter_world_fight }] = await Promise.all([
      import('../world-shell/dungeon_store.js'),
      import('../world-shell/world_fight.js'),
    ])
    discard_session_for_dev_mount(use_dungeon, '__dev_enter_world_fight')
    enter_world_fight({ fight_id, world_id, character_id: cid })
    await use_dungeon.getState().refresh()
    const s = use_dungeon.getState()
    const g = context.get_state()
    game_log('dev', 'enter_world_fight MOUNTED:', {
      fight_id,
      status: s.dungeon?.status,
      phase: s.phase,
      fight_mode: g.fight_mode,
      fighters: fight_view()?.fighters?.size ?? 0,
      anchor: s.dungeon?.anchor,
    })
    return { fight_id, status: s.dungeon?.status ?? null, anchor: s.dungeon?.anchor ?? null }
  }

  // ── [W6] FIGHT-FEEL PREVIEW HOOKS — trigger each new W6 beat SYNTHETICALLY on the mounted board (design/
  //    owner A/B, zero fight setup or gas). Each pokes the SAME board API the adapter's play_cast/play_move
  //    fire, so a preview is frame-faithful. Default target = the first living MOB on the board. ──
  const first_fighter_id = () => {
    const fs = fight_view()?.fighters
    if (!fs) return 'mob-0'
    const live = [...fs.values()].filter((f) => !f.dead)
    return (live.find((f) => String(f.id).startsWith('mob-')) ?? live[0])?.id ?? 'mob-0'
  }
  const cell_of = (/** @type {string} */ id) => fight_view()?.fighters?.get(id)?.cell

  // __ARES_DEV_HITFLASH(id?) — a brief struck-body colorize (the exact HIT_FLASH_TINT the adapter fires).
  w.__ARES_DEV_HITFLASH = (/** @type {string=} */ id) => {
    const t = id ?? first_fighter_id()
    board.flash_entity?.(t, HIT_FLASH_TINT)
    return { ok: true, id: t }
  }
  // __ARES_DEV_FLOAT({ id?, text?, kind? }) — spawn a damage/crit float via a real hit beat (scale-punch +
  // crit style). kind:'crit' previews the bigger gold crit label + harder pop.
  w.__ARES_DEV_FLOAT = ({ id, text = '-1234', kind = 'damage' } = /** @type {any} */ ({})) => {
    const t = id ?? first_fighter_id()
    board.entity_beat?.(t, { anim: 'hit', float: { text, kind } })
    return { ok: true, id: t, kind }
  }
  // __ARES_DEV_RIPPLE({ cells?, origin?, speed? }) — the on-impact AoE cell splash (default: a cross at the
  // first fighter). speed 5–15 = the reference extract.
  w.__ARES_DEV_RIPPLE = ({ cells, origin, speed = 11 } = /** @type {any} */ ({})) => {
    let cs = cells
    if (!cs) {
      const c = cell_of(first_fighter_id()) ?? { x: 3, y: 3 }
      cs = [c, { x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }]
    }
    board.ripple?.(cs, { origin: origin ?? cs[0], speed })
    return { ok: true, cells: cs, speed }
  }
  // __ARES_DEV_KNOCKBACK({ id?, path?, dx?, dy?, cells?, collision? }) — a fast displacement slide + a wall
  // shake on collision (numbers mirror the adapter's KNOCKBACK_MS_PER_CELL/WALL_HIT_SHAKE). Default: shove
  // the target 2 cells +x with a wall-hit thud.
  w.__ARES_DEV_KNOCKBACK = ({ id, path, dx = 1, dy = 0, cells = 2, collision = true } = /** @type {any} */ ({})) => {
    const t = id ?? first_fighter_id()
    let p = path
    if (!p) {
      const c = cell_of(t)
      if (!c) return { ok: false, reason: 'target has no cell (no live fight?)' }
      p = []
      for (let i = 1; i <= cells; i += 1) p.push({ x: c.x + dx * i, y: c.y + dy * i })
    }
    if (!p.length) return { ok: false, reason: 'empty path' }
    board
      .entity_move?.(t, p, { cells_per_second: 1000 / 82, knockback: true }) // ≈12 c/s — adapter KNOCKBACK_MS_PER_CELL
      .then(() => {
        if (collision) board.shake?.(0.3) // adapter WALL_HIT_SHAKE
      })
    return { ok: true, id: t, path: p, collision }
  }
  // __ARES_DEV_ZOOM_PUNCH() — fire the your-turn hero zoom-punch beat (embed-scoped; passed in as a closure).
  w.__ARES_DEV_ZOOM_PUNCH = () => {
    trigger_zoom_punch?.()
    return { ok: !!trigger_zoom_punch }
  }
  // __ARES_DEV_FIGHT_ENTRY() — preview the fight-entry cinematic (iso snap + slow orbit + herald sword + sting)
  // around the player, then auto-release. Lets the rotation feel be A/B'd with zero fight setup or gas.
  w.__ARES_DEV_FIGHT_ENTRY = () => {
    trigger_fight_entry?.()
    return { ok: !!trigger_fight_entry }
  }
}
