// D224 ("There is no mob model in the dungeon cave with me??") + D227 (blocked: "the mob
// has no nameplate… how do i start that damn fight?") — THE CAVE MOB PACK.
// dungeon_dimension replays the group-spawn wire event → mob_groups folds it into
// state.visible_mobs_group — and since D139 deleted roam.js that Map had NO renderer left: the roster
// spawned into the void and every cave was empty (the same orphan class as D211). This is the voxel
// consumer: each group entity (variant = the chain mob_template_id) becomes its REAL creature GLB via
// get_mob_model (the SAME resolver the fight board uses — catalog parity for free), standing in a
// deterministic ring at the room's mob_spawn, IDLE-animated, facing the player spawn.
//
// D227 REWORK: the original design projected ONE pack-chip lifted 2.8 m over the anchor — at a
// natural close-range shoulder-cam pose it left the viewport (on_screen=false) and HID: "no nameplate".
// Owner item 10: the pack shows ONE group tag (legacy convention), NOT one plate per mob (a 2-mob pack
// read as two tags). That single tag rides the pack CENTROID at HEAD HEIGHT — the D227 fix kept (head
// height, never the +2.8 m that fled the viewport; for a solo pack it coincides with the mob's own head)
// — listing EVERY member as a stacked "NAME · LV" line (exact duplicates collapse to "… ×N" — chain
// truth via mob_names/mob_levels, name fallback 'Mob'), with the resurrected dungeons.click_to_fight hint
// shown once the player is inside engage range, and a pointer cursor whenever the aim rests on a mob (the
// target must read clickable). Each mob is still its OWN 3D rig with its OWN click discs.
// A click on any mob inside ENGAGE_RANGE_M dispatches action/dungeon_engage {user:true} — the EXACT wire
// the old roam cluster used, so the tx-provenance law + the leader-only start_when_ready flow are
// UNTOUCHED. The dimension despawns the group the instant the fight goes ACTIVE → plates + rigs drop;
// ROOM_CLEARED publishes the NEXT room's roster → the pack re-appears. Mirrors remote_players.js
// (reconcile-the-Map, own rAF, projected DOM chips); GLBs load through the engine's shared DRACO-wired
// loader (several creature GLBs are KHR_draco_mesh_compression-REQUIRED).
//
// The group's wire `position` is IGNORED on purpose (the dead plane's origin) — the cave anchors the
// pack at its own mob_spawn.

import { AnimationMixer, Raycaster, Vector2, Vector3 } from 'three'

import { create_mob_model } from '@aresrpg/engine3/player'

import i18n from '../i18n'
import { use_prompt_stack } from '../world-shell/prompt_stack.js'

import { get_mob_model } from './data/mobs.js'
import { context } from './store.js'
import { game_log } from '../core/log.js'

const ENGAGE_RANGE_M = 10 // "approach/click" — a click from across the room never starts the fight
const MOB_CLICK_PX = 90 // hit disc around each mob's projected plate point
const RING_BASE = 1.3 // ring radius = RING_BASE + 0.22·n (clamped) — snug pack on the flat combat floor

/**
 * @param {{ engine: any, canvas?: HTMLElement | null, anchor: [number, number, number],
 *   face_toward: [number, number, number], get_player_pos: () => ArrayLike<number> }} args `anchor` = the
 *   room's mob_spawn (feet, world); `face_toward` = player_spawn so the pack stares down the entrance;
 *   `canvas` = the WORLD canvas (D232 — the plate/raycast projection frame; querySelector can hit another).
 * @returns {{ dispose: () => void }}
 */
export function create_cave_mobs({ engine, canvas = null, anchor, face_toward, get_player_pos }) {
  /** @type {Map<string, any>} entity id → { root, mixer, size, x, y, z, sx, sy, bx, by, on, group_id } */
  const rigs = new Map()
  /** @type {Map<string, any>} group id → { chip, lines, hint, sig } — ONE tag per pack */
  const groups = new Map()
  let raf = 0
  let last_t = performance.now()
  let disposed = false
  const proj = new Vector3()
  const hint_text = i18n.t('dungeons.click_to_fight')
  // D227-sharpened ("clicking doesn't work"): the PRIMARY engage affordance is a 3D RAYCAST on the
  // mob MESH itself — clicking anywhere on the model counts. The plate/body screen-discs stay as generous
  // secondary paths. NDC comes through the CANVAS rect (never window — the house convention).
  const raycaster = new Raycaster()
  const ndc = new Vector2()
  const canvas_rect = () => {
    const cv = canvas ?? /** @type {HTMLElement | null} */ (document.querySelector('canvas'))
    return cv?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
  }
  /** Raycast the aim point against every loaded mob root. @returns {boolean} */
  const aim_hits_mob = (/** @type {number} */ px, /** @type {number} */ py) => {
    const cam = engine.get_camera?.()
    if (!cam) return false
    const roots = [...rigs.values()].map((r) => r.root).filter(Boolean)
    if (!roots.length) return false
    const rect = canvas_rect()
    ndc.set(((px - rect.left) / rect.width) * 2 - 1, -(((py - rect.top) / rect.height) * 2 - 1))
    raycaster.setFromCamera(ndc, cam)
    return raycaster.intersectObjects(roots, true).length > 0
  }

  // one fixed layer for all plates. Z LAW (D227 pixel-caught): the SESSION canvas sits at z-11
  // (GameWorldHost lifts it over the z-10 route spacer) — a z-7 layer renders UNDER the world and the
  // plates are invisible in-session (they only ever showed in spectate's different stack). z-11 +
  // body-appended = DOM-later paints OVER the canvas at equal z, still under every z-12 HUD panel.
  const layer = document.createElement('div')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:11'
  document.body.appendChild(layer)

  // aim point: real cursor when free, screen centre under pointer lock (walk mode)
  let mouse_x = window.innerWidth / 2
  let mouse_y = window.innerHeight / 2
  const on_move = (/** @type {MouseEvent} */ e) => {
    mouse_x = e.clientX
    mouse_y = e.clientY
  }
  window.addEventListener('mousemove', on_move)
  const aim_point = () =>
    document.pointerLockElement ? { x: window.innerWidth / 2, y: window.innerHeight / 2 } : { x: mouse_x, y: mouse_y }

  /** Flat member list across every live group, each tagged with its group_id — the global index drives the
   *  shared ring placement (unchanged); the group_id routes each rig to its pack's ONE tag. (The ONLY writer
   *  is dungeon_dimension — one pack at a time.) */
  const live_entity_list = () => {
    /** @type {{ e: any, group_id: string }[]} */ const out = []
    for (const g of context.get_state().visible_mobs_group.values())
      for (const e of g.entities ?? []) out.push({ e, group_id: g.id })
    return out
  }

  const spawn_rig = (
    /** @type {any} */ e,
    /** @type {number} */ i,
    /** @type {number} */ n,
    /** @type {string} */ group_id
  ) => {
    const { url, size } = get_mob_model({ variant: e.variant, name: e.name })
    const radius = n === 1 ? 0 : Math.min(2.6, RING_BASE + 0.22 * n)
    const angle = (i / Math.max(1, n)) * Math.PI * 2 + 0.7
    const x = anchor[0] + Math.sin(angle) * radius
    const z = anchor[2] + Math.cos(angle) * radius
    // NO ground-scan in the cave (a top-down scan reads the ROOF as ground): mob_spawn sits on the flat
    // combat floor, the whole snug ring shares its y.
    const y = anchor[1]
    // A rig is the 3D model + its click discs ONLY — the nametag is the pack's ONE group tag (see the
    // groups Map / spawn_group_tag): placement + discs are per-mob, the tag is per-pack.
    const rig = {
      root: /** @type {any} */ (null),
      mixer: /** @type {any} */ (null),
      size,
      x,
      y,
      z,
      sx: 0, // last projected HEAD screen point (click/cursor hit tests)
      sy: 0,
      bx: 0, // last projected TORSO screen point (the second generous disc, D227-sharpened)
      by: 0,
      on: false, // on-screen this frame
      group_id, // routes this rig to its pack's ONE tag
      dispose: null,
    }
    rigs.set(e.id, rig)
    create_mob_model(url, { label: e.name })
      .then((/** @type {any} */ { root, clips, measured, dispose: dispose_model }) => {
        if (disposed || !rigs.has(e.id)) {
          dispose_model()
          return
        }
        rig.size = measured.height // the REAL rendered height (not the chain's nominal size) — the click-disc
        // lift + pack-tag centroid lift below both read rig.size, so this keeps them glued to the actual body.
        root.position.set(x, y, z)
        root.rotation.y = Math.atan2(face_toward[0] - x, face_toward[2] - z) // stare down the entrance
        const idle = clips.find((/** @type {any} */ c) => /idle/i.test(c.name)) ?? clips[0]
        if (idle) {
          rig.mixer = new AnimationMixer(root)
          rig.mixer.clipAction(idle).play()
        }
        rig.root = root
        rig.dispose = dispose_model
        engine.add_to_scene(root)
        game_log(
          'cave-mobs',
          `mob ready: ${e.name} (${url.split('/').pop()}) at [${x.toFixed(1)}, ${z.toFixed(1)}] (D224)`
        )
      })
      .catch((/** @type {any} */ error) =>
        game_log('cave-mobs', `GLB load failed for ${e.name} — plate stays, model empty:`, error)
      )
  }

  const drop_rig = (/** @type {string} */ id, /** @type {any} */ r) => {
    if (r.root) {
      // The factory owns per-instance material/skeleton disposal; cached geometry/textures remain shared.
      try {
        r.mixer?.stopAllAction?.()
        r.mixer?.uncacheRoot?.(r.root)
        engine.remove_from_scene(r.root)
        r.dispose?.()
      } catch {
        /* already gone */
      }
    }
    rigs.delete(id)
  }

  // ── ONE tag per pack — created per group id, positioned at the pack centroid each frame.
  const member_label = (/** @type {any} */ e) => `${e.name || 'Mob'} · LV ${e.level ?? 1}`
  const group_sig = (/** @type {any[]} */ entities) => entities.map(member_label).join('\n')

  const spawn_group_tag = (/** @type {string} */ group_id) => {
    const chip = document.createElement('div')
    // pointer-events:auto — the NAMETAG itself is a literal click target ("can't click on IT"); its
    // click rides the same try_engage (the _engaging single-flight dedupes any double path). SAME visual
    // style as the retired per-mob plate — content-only restructure.
    chip.style.cssText =
      'position:absolute;transform:translate(-50%,-100%);padding:3px 8px;white-space:nowrap;text-align:center;' +
      'font:600 10px/1.5 "JetBrains Mono",monospace;letter-spacing:.18em;text-transform:uppercase;' +
      'color:#f5d0a9;background:rgba(10,10,15,.78);border:1px solid rgba(200,150,60,.5);' +
      'text-shadow:0 0 6px rgba(200,150,60,.6);display:none;pointer-events:auto;cursor:pointer'
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation()
      try_engage(ev.clientX, ev.clientY) // lands in a member disc — same single engage path
    })
    const lines = document.createElement('div') // one "NAME · LV" line per member (duplicates collapse)
    const hint = document.createElement('div')
    hint.style.cssText = 'color:#c8963c;font-size:9px;letter-spacing:.24em;display:none'
    hint.textContent = hint_text
    chip.append(lines, hint)
    layer.appendChild(chip)
    const gui = { chip, lines, hint, sig: '' }
    groups.set(group_id, gui)
    return gui
  }

  // rebuild the stacked member lines only when the roster/labels change (names/levels resolve async): exact
  // duplicates (same name AND level) collapse to "NAME · LV ×N", first-seen order preserved.
  const refresh_group_lines = (/** @type {any} */ gui, /** @type {any[]} */ entities) => {
    const sig = group_sig(entities)
    if (gui.sig === sig) return
    gui.sig = sig
    /** @type {Map<string, number>} */ const counts = new Map()
    for (const e of entities) {
      const label = member_label(e)
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    gui.lines.replaceChildren()
    for (const [label, n] of counts) {
      const line = document.createElement('div')
      line.textContent = n > 1 ? `${label} ×${n}` : label
      gui.lines.appendChild(line)
    }
  }

  const drop_group_tag = (/** @type {string} */ id, /** @type {any} */ gui) => {
    gui.chip.remove()
    groups.delete(id)
  }

  const in_engage_range = () => {
    const p = get_player_pos()
    return Math.hypot(Number(p[0]) - anchor[0], Number(p[2]) - anchor[2]) <= ENGAGE_RANGE_M
  }

  // D2 — the [R] ENGAGE prompt (dungeon mobs get the SAME press-R popup as the open world). Mirrors
  // world_spawns' register_prompt: armed while the player is within engage range of the pack, cleared when they
  // step out or the pack leaves (fight started / roster advanced → rigs drop). Reuses the id 'attack' + copy the
  // world [R] uses (world_spawns suppresses ITS attack prompt in-cave, so the slot is free — one [R] pill ever).
  // The existing click-to-engage path (try_engage) is untouched; [R] shares the SAME single engage dispatch.
  let prompt_armed = false
  const set_engage_prompt = (/** @type {boolean} */ on) => {
    if (on === prompt_armed) return
    prompt_armed = on
    const { register_prompt, clear_prompt } = use_prompt_stack.getState()
    if (on)
      register_prompt({
        id: 'attack',
        key: 'R', // AZERTY-safe (PromptStack matches KeyR) — the SAME key the world [R] attack prompt uses
        label: i18n.t('discovery.attack'),
        priority: 90,
        on_trigger: () => {
          game_log('cave-mobs', '[R] engage → action/dungeon_engage (leader starts, members watch) (D2)')
          context.dispatch('action/dungeon_engage', { user: true }) // the EXACT wire the click path fires
        },
      })
    else clear_prompt('attack')
  }

  const frame = (/** @type {number} */ now) => {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - last_t) / 1000)
    last_t = now
    const list = live_entity_list()
    // reconcile RIGS: spawn newcomers (roster landed / next room), drop the departed (fight went ACTIVE).
    // Placement uses the GLOBAL flat index (unchanged shared ring); each rig remembers its pack.
    const seen = new Set()
    list.forEach(({ e, group_id }, i) => {
      seen.add(e.id)
      if (!rigs.has(e.id)) {
        if (rigs.size === 0 && i === 0)
          game_log('cave-mobs', `pack spawning: ${list.length} mob(s) — ${list.map((m) => m.e.name).join(', ')} (D224)`)
        spawn_rig(e, i, list.length, group_id)
      } else rigs.get(e.id).group_id = group_id // roster can re-home a mob; keep the tag routing fresh
    })
    for (const [id, r] of rigs) if (!seen.has(id)) drop_rig(id, r)
    // reconcile GROUP TAGS: one chip per live group, dropped when its pack leaves; lines rebuilt on change.
    const state_groups = context.get_state().visible_mobs_group
    for (const [gid, gui] of groups) if (!state_groups.has(gid)) drop_group_tag(gid, gui)
    for (const g of state_groups.values())
      refresh_group_lines(groups.get(g.id) ?? spawn_group_tag(g.id), g.entities ?? [])
    if (rigs.size === 0) {
      set_engage_prompt(false) // pack gone (fight started / roster advanced) — drop the [R] prompt (D2)
      return
    }
    const cam = engine.get_camera?.()
    const near = in_engage_range()
    set_engage_prompt(near) // D2 — arm the [R] engage popup within range, clear it out of range (rigs.size > 0 here)
    const aim = aim_point()
    // D227 pixel-caught: NDC must map through the CANVAS rect, not the window — the world renders in a
    // panel offset by the sidebar (~225px), so window-dim mapping shifted every plate ~100px left.
    const rect = canvas_rect() // D232 — the passed WORLD canvas frames every projection
    let hovering = false
    for (const r of rigs.values()) {
      r.mixer?.update(dt) // always near in a 56 m room — no anim cull
      if (!cam) continue
      // head-height projection — [faithful-mob-sizes 2026-07-13] r.size is now the MEASURED rendered
      // height (the chain nominal only until the GLB lands), so the head IS at +size: anchor at size + a small
      // margin, floored so a tiny critter's disc doesn't sit in the dirt. The old 1.3·size·cap-2.2 formula
      // assumed size was a nominal ~1.4 scale — its cap sat BELOW the tallest intrinsic mobs (up to 3.2).
      const lift = Math.max(1.4, r.size + 0.35)
      proj.set(r.x, r.y + lift, r.z).project(cam)
      r.on = proj.z < 1 && proj.x > -1.05 && proj.x < 1.05 && proj.y > -1.05 && proj.y < 1.05
      if (!r.on) continue
      r.sx = rect.left + ((proj.x + 1) / 2) * rect.width
      r.sy = rect.top + ((1 - proj.y) / 2) * rect.height
      // body point (torso, ~55% of the lift) — the second generous screen-disc beside the head one
      proj.set(r.x, r.y + lift * 0.55, r.z).project(cam)
      r.bx = rect.left + ((proj.x + 1) / 2) * rect.width
      r.by = rect.top + ((1 - proj.y) / 2) * rect.height
      if (
        Math.hypot(aim.x - r.sx, aim.y - r.sy) < MOB_CLICK_PX ||
        Math.hypot(aim.x - r.bx, aim.y - r.by) < MOB_CLICK_PX
      )
        hovering = true
    }
    // position each pack's ONE tag at the CENTROID of its members, head height (clears the tallest). The
    // D227 fix is kept — head height, never the +2.8 m that fled the close-range viewport; for a solo pack
    // the centroid IS the mob's own head point (no regression). World-space centroid tracks any wander.
    for (const [gid, gui] of groups) {
      let n = 0
      let wx = 0
      let wy = 0
      let wz = 0
      let msize = 0
      for (const r of rigs.values()) {
        if (r.group_id !== gid) continue
        wx += r.x
        wy += r.y
        wz += r.z
        n += 1
        if (r.size > msize) msize = r.size
      }
      if (!n || !cam) {
        gui.chip.style.display = 'none'
        continue
      }
      // same measured-height anchor as the per-rig discs — the tag clears the tallest member's real head.
      const lift = Math.max(1.4, msize + 0.35)
      proj.set(wx / n, wy / n + lift, wz / n).project(cam)
      const on = proj.z < 1 && proj.x > -1.05 && proj.x < 1.05 && proj.y > -1.05 && proj.y < 1.05
      gui.chip.style.display = on ? 'block' : 'none'
      if (!on) continue
      gui.chip.style.left = `${rect.left + ((proj.x + 1) / 2) * rect.width}px`
      gui.chip.style.top = `${rect.top + ((1 - proj.y) / 2) * rect.height}px`
      gui.hint.style.display = near ? 'block' : 'none' // the affordance appears once the click would work
    }
    if (!hovering) hovering = aim_hits_mob(aim.x, aim.y) // primary: the aim rests on the MESH itself
    // The target reads clickable — pointer cursor while the aim rests on a mob (free cursor only;
    // under pointer lock the cursor is hidden anyway).
    const cursor_el = /** @type {HTMLElement | null} */ (canvas ?? document.querySelector('canvas'))
    if (cursor_el) cursor_el.style.cursor = hovering && !document.pointerLockElement ? 'pointer' : ''
  }
  raf = requestAnimationFrame(frame)

  // ── engage: a click on any mob (plate disc) inside range → the old roam wire. ─────────────────────────
  const try_engage = (/** @type {number} */ cx, /** @type {number} */ cy) => {
    if (rigs.size === 0) return
    // PRIMARY: raycast on the mob MESH (click the model anywhere — D227-sharpened). SECONDARY: the plate
    // and torso screen-discs (generous targets; also cover the pre-GLB window where only the plate exists).
    let hit = aim_hits_mob(cx, cy)
    if (!hit)
      for (const r of rigs.values())
        if (
          r.on &&
          (Math.hypot(cx - r.sx, cy - r.sy) < MOB_CLICK_PX || Math.hypot(cx - r.bx, cy - r.by) < MOB_CLICK_PX)
        )
          hit = true
    if (!hit) return
    if (!in_engage_range())
      return game_log('cave-mobs', `mob clicked out of range — walk closer (≤${ENGAGE_RANGE_M}m) (D224)`)
    game_log('cave-mobs', 'pack clicked → action/dungeon_engage (leader starts, members watch the flip) (D224)')
    context.dispatch('action/dungeon_engage', { user: true })
  }
  // D227-owner ("I see the nametag but can't click on it"): the shoulder cam is HOLD-LMB-rotate — a human
  // press always drifts a few px, the browser calls that a DRAG and SUPPRESSES the 'click' event entirely
  // (synthetic probe clicks have zero movement, which is why every gate passed while his hand failed).
  // Own the gesture: pointerdown records the press (pre-lock coords); pointerup within 6px/500ms IS the
  // click, tested at the DOWN point. Capture phase so no canvas handler can swallow it.
  /** @type {{ x: number, y: number, t: number } | null} */ let press = null
  const on_down = (/** @type {PointerEvent} */ ev) => {
    if (ev.button === 0) press = { x: ev.clientX, y: ev.clientY, t: performance.now() }
  }
  const on_up = (/** @type {PointerEvent} */ ev) => {
    if (ev.button !== 0 || !press) return
    const p0 = press
    press = null
    if (performance.now() - p0.t > 500) return // a hold-rotate, not a click
    const moved = document.pointerLockElement
      ? false // locked mid-press: movement went into the camera, the press point is the intent
      : Math.hypot(ev.clientX - p0.x, ev.clientY - p0.y) > 6
    if (!moved) try_engage(p0.x, p0.y)
  }
  window.addEventListener('pointerdown', on_down, true)
  window.addEventListener('pointerup', on_up, true)

  return {
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      set_engage_prompt(false) // D2 — the [R] prompt dies with the cave (the frame loop won't run again to clear it)
      window.removeEventListener('pointerdown', on_down, true)
      window.removeEventListener('pointerup', on_up, true)
      window.removeEventListener('mousemove', on_move)
      const cursor_el = /** @type {HTMLElement | null} */ (canvas ?? document.querySelector('canvas'))
      if (cursor_el) cursor_el.style.cursor = ''
      for (const [id, r] of rigs) drop_rig(id, r)
      for (const [id, gui] of groups) drop_group_tag(id, gui)
      layer.remove()
    },
  }
}
