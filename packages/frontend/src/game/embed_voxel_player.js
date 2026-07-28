// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The LOCAL PLAYER — split from embed_voxel.js at the 600-LoC law. Everything about the player's own body and
// its control: the engine shoulder camera + input (WASD/arrows, the mouse-or-keys law), the on-chain avatar
// (+ hair, #20 recolor, senshi fallback), the veteran-title aura, the local nameplate, the TR-97 mount ride,
// the TR-1 cinematic/creative-fly modes, the per-frame controller feed, the courier presence broadcast, and the
// walk follow-camera. The host owns the session/engine/board; this owns the man in it.
//
// D154: ONE input gate — a focused text field makes ALL game keys inert (text_focused below).
// D195: the MOUSE belongs to the ENGINE's shoulder rig (hold-LMB pointer-lock rotate + wheel dolly); keys
// just mutate state and the frame feed hands the controller the RIG's azimuth as the movement basis.
// The fight camera is a SEPARATE writer (embed_voxel_fight_camera.js); `is_fight()` is how this stands down.

import {
  create_character_avatar,
  create_shoulder_camera,
  create_title_aura,
  create_worn_cosmetics,
  ground_surface_y,
} from '@aresrpg/engine3/player'
import { attach_status_overlay, STATUS_OVERLAY, create_vfx_preset, PRESETS } from '@aresrpg/engine3/vfx'

import { resolve_movement_key } from './embed_voxel_movement_keys.js'
import { create_auto_run } from './auto_run.js'
import { create_cursor_lock_toggle } from './embed_voxel_cursor_lock.js'
import { resolve_cosmetic_aura } from './cosmetic_aura.js'
import { tick_environment_audio, dispose_environment_audio } from './core/audio/environment_audio.js'
import { broadcast_position } from '../courier/world.js'
import { create_local_nameplate } from './local_nameplate.js'
import { PLACEHOLDER_RIG_CLASS, character_model_urls } from './screens/character-glb.js'
import { push_event_toast } from './core/toast.js'
import { set_local_beat } from './core/local_beat.js'
import { walk_fov_pulse } from './core/camera_juice.js'
import { MOUNT_SPEED_MULTIPLIER } from './mount_speed.js'
import {
  has_veteran_title,
  read_worn_templates,
  resolve_mount,
  resolve_worn_cosmetics,
  resolve_avatar_override,
  pet_mount_hint_visible,
} from './cosmetic_glb.js'
import { create_mount_rig, ft_dragon_glb_url } from './mount_rig.js'
import { create_pet_companion_rig, resolve_pet_companion } from './pet_companion.js'
import { create_fast_travel_pilot } from './fast_travel_pilot.js'
import { mount_is_moving } from './fast_travel_flight.js'
import { fast_travel_store, ft_flight_target, ft_for } from '../world-shell/fast_travel_store.js'
import { use_prompt_stack } from '../world-shell/prompt_stack.js'
import { context } from './store.js'
import i18n from '../i18n'
import { game_log } from '../core/log.js'
import { create_mobile_session_input } from './touch/mobile_session_input.js'

/** D154 — the ONE focus gate: any focused text surface makes game input inert. */
const text_focused = () => {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || /** @type {HTMLElement} */ (el).isContentEditable
}

/**
 * Build the local player: avatar + aura + plate + shoulder camera + input + mount, wired to the live
 * controller. The host drives it each frame: `feed(dt, physics_live)` (input → controller), then
 * `frame2(t, dt)` (broadcast + pose + walk camera). The fight camera is external — `is_fight()` gates it.
 * @param {{
 *   engine: any, canvas: HTMLCanvasElement, character: any, ctl: any,
 *   env: { solid_at: (x:number,y:number,z:number)=>boolean, block_id_at: (x:number,y:number,z:number)=>number },
 *   world_id: string|null,
 *   initial_yaw?: number, is_fight: () => boolean, is_ready: () => boolean, on_cinematic_change: (on: boolean) => void
 * }} deps
 */
export function create_player({
  engine,
  canvas,
  character,
  ctl,
  env,
  world_id,
  initial_yaw = 0, // session-position restore seeds the shoulder cam's look direction too (embed_voxel.js boot_yaw)
  is_fight,
  is_ready,
  on_cinematic_change,
}) {
  // Avatar (D191/D192/D193 — THE SWAP): the ENGINE's own create_character_avatar replaces the hand mount
  // that re-implemented it (shape validator + metalness clamp + Box3 feet bake + raw mixer + hair attach)
  // and still shipped black + floating. The engine handle owns lighting, feet-at-origin, scale, crossfaded
  // anim machine, HAIR mounting and the #20 on-chain RECOLOR (D193 CPU compositor, WebGPU-safe) — loading
  // stays OUR assets (CHARACTER_MODELS SSOT urls, /draco/ served by the app), mounting is the engine's.
  // Colors: the read-model's color_1/2/3 are u32 rgb — three's Color takes numbers natively; ALL-ZERO =
  // never customized → omit (base texture), the fight-folds convention. The handle is SYNCHRONOUS (empty
  // Group fills on load; update() no-ops until ready) — a load failure warns and stays camera-only.
  /** @type {ReturnType<typeof create_character_avatar> | null} */ let avatar = null
  let beat_end = 0 // ENG-16: perf-clock ms until a one-shot beat (e.g. gather ATTACK) finishes — locomotion paused
  /** @type {ReturnType<typeof create_title_aura> | null} */ let aura = null // TR-5 — veteran-title flame aura
  /** @type {ReturnType<typeof attach_status_overlay> | null} */ let cosmetic_overlay = null // worn-cosmetic body glow
  /** @type {string | null} */ let overlay_key = null // the STATUS_OVERLAY key currently mounted (re-mount on change)
  /** @type {ReturnType<typeof create_worn_cosmetics> | null} */ let worn = null // equipped hat/cloak GLBs (legacy mechanism)
  /** @type {Map<string, any>} */ let worn_templates = new Map() // /v1 template-id → Display identity join
  /** @type {ReturnType<typeof create_local_nameplate> | null} */ let my_plate = null // D227
  // `||` (not `??`) — an EMPTY-STRING classe must fall through, and a raw RPC row carries `class`.
  // [P1 2026-07-09: a broken hydrate merged classe='' over the card; `?? class_id` kept the '' and BOTH
  // branches below skipped silently — a fresh character entered the world invisible.]
  const class_id = character?.classe || character?.class_id || character?.class
  const male = character?.male ?? true
  if (character) {
    // [P0-WORLD-UNPLAYABLE] Rig resolution mirrors remote_players.js:64 (the established, working pattern):
    // a class with its OWN body GLB uses it; a class with none falls back to the gender-matched senshi
    // placeholder so the LOCAL player is ALWAYS visible + walkable. The old `else if` camera-only branch
    // shipped fresh characters INVISIBLE + mute — while the fight board (engine's default rig) and every
    // REMOTE player already fell back to senshi, so only the local roam avatar was broken.
    // ASSET GAP: only senshi/shugo/tomoda/yajin ship a GLB (CHARACTER_MODELS); the other 8 classes
    // (yogen/iyashi/ikari/mori/tokei/rojin/shusen/asobi) reuse the senshi rig until their own art lands.
    // ONE home for the rig rule (character_model_urls) — the same door remote players, the fight board and
    // the simulator board resolve through; only the placeholder POLICY is this surface's argument.
    const urls = character_model_urls(class_id, male, { fallback: PLACEHOLDER_RIG_CLASS })
    if (urls.rig !== class_id)
      // LOUD (no silent failure): the placeholder is honest in the console — the player is visible + walkable,
      // NOT the old invisible camera-only. A null character (decorative/spectate world) stays quiet above.
      game_log(
        'voxel',
        `no rig for class '${class_id ?? ''}' (character ${character?.id ?? '?'}) — senshi placeholder (visible + walkable)`
      )
    // DEV SCREENSHOT TOOL: `?avatar=<key>` (e.g. `primemachin`) replaces ONLY this
    // local body — read once at boot, resolve_avatar_override (cosmetic_glb.js) is the guarded allowlist
    // (unknown key → null + one console.warn, never a crash). Other players keep seeing chain state.
    const avatar_override = resolve_avatar_override()
    avatar = create_character_avatar({
      glb_url: avatar_override ?? urls.body, // asset-host-first, bundled /sprites fallback (character_model_urls)
      // hair/recolor are keyed to the CLASS rig's own texture atlas — skip both under an override (a
      // foreign preview GLB has no matching Head bone convention or _base/_colorN mask layers to wear them).
      hair_url: avatar_override ? undefined : urls.hair,
      colors:
        !avatar_override && (character.color_1 || character.color_2 || character.color_3)
          ? [character.color_1, character.color_2, character.color_3]
          : undefined,
    })
    const t0 = ctl.get_transform()
    avatar.object3d.position.set(t0.position[0], t0.visual_y, t0.position[2])
    // NO add_to_scene here: pre-boot it's a SILENT no-op (engine.js:783 `renderer_handle?.` — the same
    // class as D177's set_time_of_day; the probe caught the rig ready+tracking with parent=null). The
    // frame loop below re-adds until the scene exists and actually takes it.
    game_log(
      'voxel',
      `avatar mounted (${class_id} → ${urls.rig} rig) — engine create_character_avatar (D191/D192/D193)`
    )
    // ENG-16 beat seam (the attack animation should play once when gathering resolves successfully).
    // Register the live avatar's one-shot trigger: fire play_beat AND hold locomotion for its duration
    // (the frame loop ticks the mixer instead of update()-ing, which would fade the swing back instantly).
    set_local_beat((clip) => {
      const dur = avatar?.play_beat?.(clip) ?? null
      if (dur) beat_end = performance.now() + dur * 1000
      return dur
    })
    // WORN COSMETICS — the equipped hat/cloak GLBs mount as CHILDREN of this avatar's Head/cape bones (engine
    // create_worn_cosmetics — the aresrpg-legacy equip_hat/equip_cape mechanism transcribed), so they ride the
    // skeleton, the body yaw and the fight/first-person hide for free. Slots are fed per frame from the live
    // equip read (resolve_worn_cosmetics) — forward-compatible + DEV `__force_equip`, exactly like mount/aura.
    worn = create_worn_cosmetics({ avatar })
    // `/v1/characters` correctly projects equipped cosmetics but its `template_id` is the canonical 0x object
    // id, not a quilt slug. Join it once against the app-cached `/v1/encyclopedia` catalog; a late result is fine
    // because feed resolves every frame and set_slots edge-diffs the first non-null model spec.
    void read_worn_templates()
      .then((templates) => {
        worn_templates = templates
      })
      .catch((error) => game_log('worn', 'template identity join failed — worn GLBs stay unmounted', error))
    // TR-5 — the veteran-title flame aura rings this body (gated ON per frame by the title slot / DEV
    // override below). Created hidden; add_to_scene rides the same post-boot retry the avatar does.
    aura = create_title_aura() // height defaults to CHARACTER_HEIGHT (the engine's avatar-height constant)
    // D227 — the local plate (D206 chips were remote-only; legacy had the own-name overhead plate). Pass the
    // character ROW (not a frozen label): the plate tracks the live roster level itself, so a post-fight
    // level-up repaints "LV N" (a nametag stuck showing lvl 1 after REACHED LEVEL 2).
    my_plate = create_local_nameplate({ engine, canvas, character }) // D232
  }

  // ── input (mouse-or-keys law): WASD/arrows move, Space jump, Shift walk. ─────────────────────────────────
  // D195 (the camera must be the engine's own): the MOUSE belongs to the ENGINE's shoulder rig
  // (hold-LMB pointer-lock rotate + wheel dolly — the demo's exact feel; my hand-rolled drag-yaw follow-cam
  // is DELETED with its D178/D187 +π basis). Keys just mutate state; the frame loop feeds the controller
  // every frame with the RIG's azimuth as the movement basis (walk_mode.js:87 verbatim — yaw RAW, no +π).
  const keys = { forward: 0, strafe: 0, jump: false, walk: false }
  const cam = create_shoulder_camera({ yaw: initial_yaw })
  cam.attach(canvas)
  // AUTO-RUN (map-click steer-to-target + auto-interact): the big-map lane emits `map/auto_run` on a marker
  // click ({ type:'mob'|'resource', id, position }); the steerer (auto_run.js) beelines the body there and,
  // on arrival, fires the SAME [R]/[G] prompt a manual press does. Input-level only — the controller physics
  // and the player's camera are untouched. The player ALWAYS wins: any move key/stick/jump or Esc cancels
  // (feed() + on_key below). Fed each frame in feed(); disposed with the session.
  const auto_run = create_auto_run({ get_pos: () => ctl.get_transform().position })
  const on_auto_run = (/** @type {any} */ ev) => auto_run.start(ev)
  context.events.on('map/auto_run', on_auto_run)
  // DOUBLE-CLICK CURSOR LOCK (comfortable exploration) — a sticky companion to the rig's hold-drag
  // lock above; embed_voxel_cursor_lock.js free-feeds the SAME apply_rotate path while locked (no new camera
  // code), gated off world/exploration mode (is_fight) exactly like every other roam-only control here.
  const cursor_lock = create_cursor_lock_toggle({
    canvas,
    is_fight,
    on_change: (locked) =>
      push_event_toast({ state: 'info', title: i18n.t(locked ? 'world.cursor_locked' : 'world.cursor_unlocked') }),
  })
  // TR-1 — CINEMATIC (trailer-recording) camera: press C to toggle the engine rig into a heavily-damped,
  // slower "smooth recording" feel (eased look + trailing follow + ~0.5× look/move speed). Deliberately
  // NO on-screen indicator (it would appear in the recording) — a single 2s toast on toggle (one-toast
  // law) is the only tell. Roam only; the frozen tactical-board camera never routes through this rig.
  let cinematic = false
  // GHOST-PLATE FIX (a screenshot showed the self nametag chip stuck on-screen over the Equipment/Encyclopedia
  // pages) — `my_plate` is a document.body-appended DOM node whose visibility is only ever WRITTEN by
  // update()/set_hidden(), which the session's frame loop stops calling the instant the route leaves the world
  // (embed_voxel.js's set_frame_paused cancels its own rAF). It froze at its last "block" state instead of
  // hiding, so it kept rendering over whatever page came next. Mirrors the SAME `set_hidden` toggle cinematic
  // recording already uses on this exact chip — combined so either condition hides it.
  let world_paused = false
  const sync_plate_hidden = () => my_plate?.set_hidden(world_paused || cinematic)
  // TR-1 v2 — app-side creative FLY (cinematic ONLY): freezes the walk physics and hard-places a
  // camera-relative velocity each frame via ctl.teleport (no engine-physics change). On exit the very next
  // ctl.tick re-applies gravity, so the body settles to the ground on its own. Double-tap SPACE toggles it.
  const FLY_SPEED = 12 // m/s creative flight (Minecraft-ish); space = up, shift = down, WASD = camera-relative
  let fly = false
  const fly_pos = [0, 0, 0]
  let last_space_ms = 0 // double-tap SPACE window detector
  const set_fly = (on) => {
    if (!!on === fly) return
    fly = !!on
    if (fly) {
      const p = ctl.get_transform().position // snapshot the launch point so integration is drift-free
      fly_pos[0] = p[0]
      fly_pos[1] = p[1]
      fly_pos[2] = p[2]
    }
  }
  const toggle_cinematic = () => {
    cinematic = !cinematic
    cam.set_cinematic(cinematic)
    if (!cinematic) set_fly(false) // fly ends with cinematic → next tick's gravity settles the body to ground
    // CLEAN FOOTAGE: hide EVERY nameplate while recording — self, remote players, and chain world
    // spawns. The 3D rigs stay in scene; only the DOM plate layers toggle.
    sync_plate_hidden()
    on_cinematic_change?.(cinematic) // host hides the OTHER DOM plate layers (remote players / world spawns)
    push_event_toast({ state: 'info', title: i18n.t(cinematic ? 'world.cinematic_on' : 'world.cinematic_off') })
  }
  // TR-97 MOUNT (KeyX spawns the mount and makes the character ride it, with the 50% speed boost, visible
  // in multiplayer): press X to TOGGLE riding. On mount-on we resolve the character's ride (dev `?mount=<glb>`
  // trailer override, else the equipped `.mount` slot post-republish, else — #594 — the active PET: the pet
  // is BOTH a walking companion AND a mountable ride), spawn the GLB under the body, ride it (×1.5 roam via
  // the speed_scale knob below). Roam only — a fight ignores the key. The rig-load discipline lives in
  // mount_rig.js; this local ride state is never propagated as a cosmetic fast path.
  let riding = false
  /** @type {ReturnType<typeof create_mount_rig> | null} */ let mount_ctl = null
  /** @type {'dev' | 'equip' | 'pet' | 'dragon' | null} */ let mount_source = null // what riding=true IS right now
  // PET COMPANION (an equipped pet wasn't showing in the world, and couldn't be mounted) —
  // receipt-driven, NOT a toggle: resolve_pet_companion (fed every frame below) decides spawn/despawn off
  // the live character.pet/pet_equipped read, mirroring desired_worn's reconcile shape exactly.
  /** @type {ReturnType<typeof create_pet_companion_rig> | null} */ let pet_ctl = null
  /** @type {string | null} */ let pet_glb_url = null // last-spawned URL — recreate the rig only on a real change
  let mount_hint_armed = false // #594 — the [X] "Mount the pet" world-hint registration, edge-triggered
  const mount_up = () => {
    if (is_fight()) return // no mounting mid-fight (the board owns the body)
    const live = context.get_state().sui?.characters?.find((c) => c.id === character?.id) ?? null
    const { available, glb_url, source } = resolve_mount(live)
    if (!available || !glb_url) {
      push_event_toast({ state: 'info', title: i18n.t('world.mount_none') })
      return
    }
    mount_ctl?.dispose()
    mount_ctl = create_mount_rig({ engine, glb_url })
    riding = true
    mount_source = source
    push_event_toast({
      state: 'success',
      title: i18n.t(mobile_input.mobile() ? 'world.mount_on_touch' : 'world.mount_on'),
    })
  }
  const mount_down = () => {
    if (!riding) return
    riding = false
    mount_source = null
    mount_ctl?.dispose()
    mount_ctl = null
    push_event_toast({ state: 'info', title: i18n.t('world.mount_off') })
  }
  // This local avatar's own flight slice — the store is keyed by traveler now (tranche F), so every read/drive
  // of MY flight names my character id (a follower's catch-up flight lives under its own key, untouched here).
  const ft_me = () => character?.id ?? null
  const toggle_mount = () => {
    // the mount key is inert mid-flight — the dragon is the pilot's, not the toggle's
    if (ft_flight_target(ft_for(fast_travel_store.getState(), ft_me()))) return
    return riding ? mount_down() : mount_up()
  }
  // FAST-TRAVEL DRAGON — a rideable dragon flown by the autopilot at RUN speed, seen by peers like any mount
  // (§5). Reuses the SAME local riding/mount_ctl rig + pose as the equipped mount, MINUS the
  // equipped-slot gate (the pilot spawns it programmatically). Skin resolution (fire by default; `?ftdragon=`
  // DEV preview) lives in mount_rig.js's ft_dragon_glb_url — ONE home shared with the #175 preload
  // (PlayerActionMenu.jsx warms the same URL the moment the travel menu opens). Its own unmount (no
  // 'mount_off' toast — the pilot's arrival/cancel toasts own that surface).
  const mount_dragon = () => {
    const glb_url = ft_dragon_glb_url()
    mount_ctl?.dispose()
    mount_ctl = create_mount_rig({ engine, glb_url })
    riding = true
    mount_source = 'dragon'
  }
  const unmount_dragon = () => {
    if (!riding) return
    riding = false
    mount_source = null
    mount_ctl?.dispose()
    mount_ctl = null
  }
  // The pilot drives the dragon flight (pure math = fast_travel_flight.js). Ground sample = the engine's
  // canonical rule (the SAME ground_surface_y remote_players + the boot scan use); live retarget reads the
  // peer's broadcast position off the game state (visible_characters). can_fly bars takeoff mid-fight.
  const sample_ft_ground = (/** @type {number} */ x, /** @type {number} */ z) => {
    const g = ground_surface_y((sx, sy, sz) => engine.sample_block?.(sx, sy, sz) ?? 0, Math.floor(x), Math.floor(z))
    return g == null ? null : g
  }
  const ft_live_pos_of = (/** @type {string | null} */ id) => {
    if (!id) return null
    const e = context.get_state().visible_characters?.get(id)
    const p = e?.position ?? e?.target_position
    return p && Number.isFinite(p.x) ? { x: p.x, z: p.z } : null
  }
  const ft_pilot = create_fast_travel_pilot({
    get_ft: () => ft_for(fast_travel_store.getState(), ft_me()),
    dispatch: (input) => fast_travel_store.getState().input({ ...input, traveler_id: ft_me() }),
    get_pos: () => ctl.get_transform().position,
    sample_ground: sample_ft_ground,
    mount_dragon,
    unmount_dragon,
    teleport: (pos) => ctl.teleport(pos),
    live_pos_of: ft_live_pos_of,
    can_fly: () => !is_fight(),
  })
  const ft_is_flying = () => !!ft_flight_target(ft_for(fast_travel_store.getState(), ft_me()))
  // Mobile stays app-owned: the adapter writes the same movement/jump shape as keys and calls only the
  // shoulder rig's public rotate/dolly methods. The engine controller remains an unchanged consumer.
  const mobile_input = create_mobile_session_input({
    canvas,
    camera: cam,
    on_mount_toggle: toggle_mount,
  })
  const on_key = (/** @type {KeyboardEvent} */ e, /** @type {boolean} */ down) => {
    if (text_focused()) return // never intercept typing (D154)
    // witness-r4 (2026-07-11): "arrow keys don't move, WASD works". The map below was ALREADY identical for
    // both (embed_voxel_movement_keys.js — extracted so the alias is unit-tested key-by-key); the real bug was
    // the browser's own default: nothing ever preventDefault()'d the arrow keys, and the page carries no
    // `overflow:hidden` (index.css), so a held arrow scrolls the DOCUMENT instead of just steering the body.
    // preventDefault() here kills that (harmless on WASD — they have no browser default to suppress).
    const move = resolve_movement_key(e.code)
    if (move) {
      keys[move.axis] = down ? move.sign : 0
      e.preventDefault()
      return
    }
    switch (e.code) {
      case 'KeyC':
        if (down && !e.repeat) toggle_cinematic() // one-shot on press (ignore auto-repeat)
        break
      case 'KeyX':
        // TR-97/#594 — mount ride toggle (roam only; guarded inside). NOT Digit1: that key is the fast-slot
        // row's (FastSlots.jsx) — X is AZERTY-safe (same physical key/glyph as QWERTY, like C/V above).
        if (down && !e.repeat) toggle_mount()
        break
      case 'Space':
        keys.jump = down
        // TR-1 v2 — double-tap SPACE toggles creative fly while cinematic is ON (Minecraft convention).
        if (down && !e.repeat && cinematic) {
          const now = performance.now()
          if (now - last_space_ms < 300) set_fly(!fly)
          last_space_ms = now
        }
        e.preventDefault()
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.walk = down
        break
      case 'Escape':
        // AUTO-RUN cancel (the player always wins). No preventDefault — other Esc handlers (modals) still run.
        if (down && auto_run.active()) auto_run.cancel()
        if (down && ft_is_flying()) fast_travel_store.getState().input({ type: 'cancel', traveler_id: ft_me() }) // cancel a flight
        break
      default:
    }
  }
  const kd = (/** @type {KeyboardEvent} */ e) => on_key(e, true)
  const ku = (/** @type {KeyboardEvent} */ e) => on_key(e, false)
  window.addEventListener('keydown', kd)
  window.addEventListener('keyup', ku)

  let aura_active = false // TR-5 — set per frame from the live title slot / DEV override (consumed in the avatar block)
  /** @type {string | null} */ let desired_overlay_key = null // worn-cosmetic aura key (set in feed, consumed in frame2)
  /** @type {{ head: {url:string,variant:string|null}|null, back: {url:string,variant:string|null}|null }} */
  let desired_worn = { head: null, back: null } // equipped hat/cloak GLBs (set in feed, consumed in frame2)
  /** @type {{ spawn: boolean, glb_url: string | null, key: string | null }} */
  let desired_pet = { spawn: false, glb_url: null, key: null } // equipped-pet companion (set in feed, consumed in frame2)
  let frame_n = 0
  let last_bcast_x = NaN // D206 — last announced cell (broadcast only on change)
  let last_bcast_z = NaN
  let last_bcast_y = NaN // D217 — vertical cell changes broadcast too
  let last_bcast_yaw = 0 // D222 — facing changes broadcast too
  let last_cell_x = NaN // S-57 QA fix — last STORE-published block cell (action/player_cell fires on crossings only)
  let last_cell_z = NaN

  // DOUBLE-JUMP dust puff (a proper bounce smoke effect on double jump). The controller
  // flags `t.air_jumped` for the ONE frame a mid-air second jump fires (input-agnostic — keyboard today, mobile
  // later, same seam); spawn a one-shot dust burst at the feet and drive it to self-dispose. REUSE — the exact
  // PRESETS + create_vfx_preset one-shot runtime the fight bursts use (fight_sword.js idiom), no new machinery.
  /** @type {{ handle: any, age: number }[]} */
  const puffs = []
  const spawn_dust_puff = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    const preset = PRESETS.dust_puff
    if (!preset) return
    const handle = create_vfx_preset(preset, { position: [x, y, z] })
    try {
      engine.add_to_scene(handle.object3d)
      handle.age.value = 0.001 // nudge past birth so the first frame submits (world_fixture_group idiom)
      puffs.push({ handle, age: 0 })
    } catch {
      handle.dispose() // pre-boot / no scene — never leak
    }
  }
  const tick_dust_puffs = (/** @type {number} */ dt) => {
    for (let i = puffs.length - 1; i >= 0; i -= 1) {
      const p = puffs[i]
      p.age += dt
      p.handle.age.value = p.age
      if (p.age >= p.handle.duration) {
        try {
          engine.remove_from_scene(p.handle.object3d)
        } catch {
          /* already gone */
        }
        p.handle.dispose()
        puffs.splice(i, 1)
      }
    }
  }

  // D195: feed the controller EVERY frame — the rig's azimuth is the movement basis and it changes
  // while orbiting mid-walk (event-time pushes would go stale); the D154 + D161 inert gate rides the
  // same write (one gate, one home). `physics_live` (D188) gates the tick until the spawn ground is real.
  const feed = (/** @type {number} */ dt, /** @type {boolean} */ physics_live) => {
    const inert = text_focused() || !is_ready() || is_fight() // D230 — no walking mid-fight
    // M-04 TOUCH — one place owns the gate + the camera apply (single home). The scheme ARMS on coarse-pointer
    // roam (a real character, ready, not mid-fight — fights are M-06); the D154 text gate mirrors the same
    // focus signal `inert` reads. On a change the state module resets its transient input, so a fight/chat
    // opening under a held thumb never leaves a ghost stick vector. Look/pinch/mount accumulators are drained
    // here and applied to the rig BEFORE set_input reads cam.get_yaw() (so the movement basis is this-frame
    // fresh). Every call is a no-op when its accumulator is empty; the whole block is skipped on desktop.
    mobile_input.feed({
      text_has_focus: text_focused(),
      roam_armed: !!character && is_ready() && !is_fight(),
    })
    // CF-B MOUNT: a character with a mount equipped roams ×1.5. Read the LIVE selected character from the
    // store each frame (the same roster the inventory paper-doll reads) so equip/unequip applies instantly
    // — the captured `character` closure is stale after a mid-session equip. The scale rides set_input to
    // the controller's ONE speed home; get_state() is a cached read + the roster is tiny (negligible cost).
    const live = context.get_state().sui?.characters?.find((c) => c.id === character?.id) ?? null
    // CF-B / TR-97 MOUNT SPEED: ×1.5 WHILE RIDING (press X), not merely while a mount is equipped — the
    // ride is the boost. `__force_mount` (DEV) forces the ride so QA can prove the ×1.5 ratio without a rig.
    const ride = riding || (import.meta.env.DEV && !!(/** @type {any} */ (window).__force_mount))
    const speed_scale = ride ? MOUNT_SPEED_MULTIPLIER : 1
    // TR-5 — the veteran-title aura gate, off the SAME live-character read: ON when the title slot holds
    // the veteran title, OR forced via the DEV `__force_aura` override (the tested path until the
    // crowdfund mints the title item). Tree-shaken from prod like `__force_mount`.
    aura_active = has_veteran_title(live) || (import.meta.env.DEV && !!(/** @type {any} */ (window).__force_aura))
    // WORN-COSMETIC BODY AURA (cosmetic_aura.js): a mapped equipped cosmetic (sui_helmet→water, suicunio→purple,
    // …) glows the avatar's OWN silhouette with the pack colour. DEV `__force_cosmetic_aura` = a STATUS_OVERLAY key
    // forces it (the QA path until a mapped cosmetic is minted+equipped on chain), tree-shaken from prod like above.
    desired_overlay_key =
      resolve_cosmetic_aura(live) ||
      (import.meta.env.DEV ? /** @type {any} */ (window).__force_cosmetic_aura || null : null)
    // WORN COSMETICS — live /v1 worn slots joined to the cosmetic quilt appearance through the template catalog;
    // nested character.worn is authoritative, rpc_to_card's flat hat/cloak spread remains compatible. LOCAL
    // rendering only (worn.set_slots below): peers resolve MY worn cosmetics off /v1 themselves
    // (remote_players.js), so nothing here sends this.
    desired_worn = resolve_worn_cosmetics(live, worn_templates)
    // PET COMPANION — same receipt-driven shape as desired_worn: character.pet/pet_equipped decides
    // spawn/despawn + appearance; frame2 reconciles the rig against this verdict. LOCAL rendering only
    // (peers render MY pet themselves off their own /v1 read — remote_players.js, #553 — same TRANSPORT
    // RULING as worn cosmetics above; this path is untouched by that landing).
    desired_pet = resolve_pet_companion(live)
    // MOUNT HINT (#594) — the "[X] Mount the pet" world pill: armed exactly when pressing the mount key
    // would resolve to the PET (pet_mount_hint_visible mirrors resolve_mount's own dev > equip > pet
    // precedence), cleared the instant riding starts, a fight begins, or the pet itself despawns. Edge-
    // triggered register/clear — the SAME idiom world_fights_discovery.js's [V] pill uses.
    const mountable = pet_mount_hint_visible(live, riding, is_fight())
    if (mountable !== mount_hint_armed) {
      mount_hint_armed = mountable
      if (mountable)
        use_prompt_stack.getState().register_prompt({
          id: 'mount',
          key: 'X',
          label: i18n.t('world.mount_hint'),
          priority: 50,
          on_trigger: toggle_mount,
        })
      else use_prompt_stack.getState().clear_prompt('mount')
    }
    // FAST-TRAVEL flight — the dragon autopilot owns the transform while flying/landing (teleport per frame,
    // exactly like creative fly below). The store is a module singleton, so a PENDING intent survives the
    // cross-world session swap; the moment physics is live in the new world we release it into flight (leg F,
    // the a0070b64 receipt-seeded boot). Movement/jump cancels mid-flight (the player always wins, like auto-run).
    if (physics_live && ft_for(fast_travel_store.getState(), ft_me()).phase === 'awaiting_boot')
      fast_travel_store.getState().input({ type: 'boot_ready', world_id, traveler_id: ft_me() })
    if (ft_is_flying() && !is_fight() && !inert && (keys.forward || keys.strafe || keys.jump))
      fast_travel_store.getState().input({ type: 'cancel', traveler_id: ft_me() })
    ft_pilot.update(dt)
    if (ft_is_flying() && !is_fight()) return // the pilot hard-placed the body this frame — skip walk/gravity
    // TR-1 v2 — FLY branch: while cinematic-fly is engaged, bypass walk physics and hard-place a
    // camera-relative velocity (space=up, shift=down, WASD on the rig yaw). Otherwise the normal walk
    // path runs, now with RUNNING allowed in cinematic (the forced-walk gait is gone; run is the default).
    if (fly && cinematic && !is_fight()) {
      const yaw = cam.get_yaw()
      const f = inert ? 0 : keys.forward
      const s = inert ? 0 : keys.strafe
      const up = inert ? 0 : (keys.jump ? 1 : 0) - (keys.walk ? 1 : 0)
      fly_pos[0] += (f * -Math.sin(yaw) + s * Math.cos(yaw)) * FLY_SPEED * dt
      fly_pos[1] += up * FLY_SPEED * dt
      fly_pos[2] += (f * -Math.cos(yaw) - s * Math.sin(yaw)) * FLY_SPEED * dt
      ctl.teleport([fly_pos[0], fly_pos[1], fly_pos[2]])
    } else {
      if (fly) set_fly(false) // cinematic dropped or a fight began → reground (the tick below re-applies gravity)
      // TOUCH COMPOSE (M-04): merge the stick/jump into the keyboard sinks, max-magnitude per axis (a BT
      // keyboard on a tablet still works; byte-identical to keyboard-only when no touch is active). The engine
      // normalizes DIRECTION (controller.js:185) and reads gait off `walk` ONLY, so the stick's analog throw
      // maps to run/walk here — near-full push runs, gentle push walks (§2.1 outer-run / inner-walk = Shift).
      const movement = mobile_input.movement(keys)
      const { forward: m_forward, strafe: m_strafe, jump: m_jump, walk: m_walk } = movement
      // AUTO-RUN (map-click steer): the player ALWAYS wins — any directional key/stick, a jump, or the
      // inert/cinematic gates (fight-start, death→defeat, teleport, not-ready) cancel instantly; otherwise the
      // steerer drives THIS frame's input toward the marker and fires the same [R]/[G] prompt on arrival. The
      // camera is never touched (mouse orbit keeps working mid-run, and does NOT cancel — only movement does).
      if (auto_run.active()) {
        const manual = m_forward !== 0 || m_strafe !== 0 || m_jump
        if (manual || inert || cinematic) auto_run.cancel()
        else {
          const steer = auto_run.update(dt)
          if (steer) {
            // walk:false — auto-run RUNS; speed_scale carries the mount ×1.5; yaw is the steerer's (points the
            // forward axis at the target), NOT the camera's, so the body heads to the marker regardless of view.
            ctl.set_input({
              forward: steer.forward,
              strafe: steer.strafe,
              jump: steer.jump,
              walk: false,
              speed_scale,
              yaw: steer.yaw,
            })
            if (physics_live) ctl.tick(dt)
            return // auto-run drove this frame — skip the manual set_input below
          }
        }
      }
      ctl.set_input({
        forward: inert ? 0 : m_forward,
        strafe: inert ? 0 : m_strafe,
        jump: inert ? false : m_jump,
        walk: m_walk, // TR-1 v2 — run is the default gait even while recording (running stays allowed)
        speed_scale, // CF-B — mount ×1.5 (1 when no mount); ONE knob, applied at controller ground-speed
        yaw: cam.get_yaw(), // walk_mode.js:87 verbatim — RAW rig azimuth (the D187 +π died with the hand-cam)
      })
      if (physics_live) ctl.tick(dt)
    }
  }

  // Second per-frame pass (after the host reads the transform + runs the floor net): broadcast our pose,
  // pose the avatar/mount/plate + aura, then drive the WALK camera (a fight hands the camera to
  // embed_voxel_fight_camera.js — here we only hide the walk body).
  const frame2 = (/** @type {any} */ t, /** @type {number} */ dt) => {
    frame_n += 1
    // DOUBLE-JUMP puff: fire one at the feet the frame the controller reports an air-jump, then advance + retire
    // any live puffs. BEFORE the fight early-return below so a puff mid-flight when a fight starts still finishes.
    if (t.air_jumped) spawn_dust_puff(t.position[0], t.visual_y, t.position[2])
    tick_dust_puffs(dt)
    if (frame_n % 10 === 0) {
      // D188(b)/D199 relocation — position + CAMERA yaw (rig azimuth, the compass heading basis) + fps
      // publish as ONE throttled pose; the CompassStrip (3A top-strip) renders all three from the store.
      // #496 — ALSO carry the avatar's TRUE heading (facing_yaw, derived from motion): the group-loop
      // follow formation anchors to it, never the camera azimuth. Anchoring followers to cam yaw swung the
      // whole formation around a STANDING avatar the moment the camera orbited — "chases the camera".
      context.dispatch('action/player_pose', {
        x: t.position[0],
        y: t.position[1],
        z: t.position[2],
        yaw: cam.get_yaw(),
        facing_yaw: t.facing_yaw,
        fps: Math.round(engine.get_stats?.().fps ?? 0),
      })
      // D206: announce our cell to the courier on ACTUAL change only; its edge coalesces to the hard rate cap.
      // D217: the payload carries the WORLD height too — a VERTICAL cell change (hills/jumps/falls) also
      // broadcasts, so peers track y exactly instead of inferring ground.
      if (character?.id) {
        const bx = Math.floor(t.position[0])
        const bz = Math.floor(t.position[2])
        const by = Math.floor(t.position[1])
        // S-57 QA fix (the dead [F] root): the voxel scene never published the avatar's cell into the engine
        // store — modules/player.js's `action/player_cell` fold had ZERO dispatchers, so DiscoveryPrompts /
        // MapDrawer / fight.js all read a forever-null position. Publish {x, y:z} BLOCK coords on ACTUAL
        // cell crossings only (never per-frame; the %10 frame gate above already throttles the read).
        if (bx !== last_cell_x || bz !== last_cell_z) {
          last_cell_x = bx
          last_cell_z = bz
          context.dispatch('action/player_cell', { x: bx, y: bz })
        }
        // D222: a facing change alone (turning while walking a curve) also announces — remote rigs show
        // the TRUE heading, not a lerp-derived guess.
        const yaw_moved = Math.abs(t.facing_yaw - (last_bcast_yaw || 0)) > 0.2
        if (bx !== last_bcast_x || bz !== last_bcast_z || by !== last_bcast_y || yaw_moved) {
          last_bcast_x = bx
          last_bcast_z = bz
          last_bcast_y = by
          last_bcast_yaw = t.facing_yaw
          broadcast_position(world_id, character.id, bx, bz, Math.round(t.facing_yaw * 100) / 100)
        }
      }
    }
    if (avatar) {
      try {
        if (!avatar.object3d.parent) {
          // add_to_scene pre-boot = silent drop (engine.js:783) — retry until the live scene takes it.
          engine.add_to_scene(avatar.object3d)
          if (avatar.object3d.parent) game_log('voxel', 'avatar in scene (post-boot add — D191)')
        }
        // TR-97 — while RIDING, pose the mount at the feet and SEAT the rider on its back (lift by the
        // mount's seat height); the plate rides up with the rider. A fight hides the mount (branch above).
        // [S-75] while the OWN mesh is hidden (the rig's pose set avatar.visible=false last frame —
        // first-person zoom or a close-wall squeeze, distance ≤ 1.0), the nameplate + mount hide WITH it:
        // a floating plate / a mount body in front of the first-person eye were the defects. (Fights park
        // all three separately in the fight_cam branch — this gate is redundant-safe there.)
        const own_hidden = !avatar.object3d.visible
        let seat = 0
        if (riding && mount_ctl) {
          mount_ctl.set_visible(!own_hidden)
          // #175 root cause: fast-travel drives the body via ctl.teleport() (never ctl.tick()), and teleport()
          // zeroes the controller's velocity — so t.speed is frozen at whatever it was the instant before
          // takeoff (typically 0) for the WHOLE flight. A raw speed check alone reads the dragon as motionless
          // mid-air; mount_is_moving also counts an active fast-travel flight as motion (fast_travel_flight.js).
          // v2 (#370): teleport() ALSO freezes t.facing_yaw (only step_controller, inside tick(), ever advances
          // it — never called mid-flight) — the reported sideways/backwards dragon. ft_pilot tracks its own
          // heading from the flight path itself (fast_travel_pilot.js); use it in place of the frozen transform.
          const dragon_yaw = ft_is_flying() ? ft_pilot.yaw() : t.facing_yaw
          mount_ctl.update(t.position[0], t.visual_y, t.position[2], dragon_yaw, mount_is_moving(t.speed, ft_is_flying()), dt)
          seat = mount_ctl.seat_height
        }
        avatar.object3d.position.set(t.position[0], t.visual_y + seat, t.position[2])
        if (own_hidden)
          my_plate?.update(0, -9999, 0) // off-screen (the fight branch's own pattern)
        else my_plate?.update(t.position[0], t.visual_y + seat + (avatar.eye_height ?? 1.6) + 0.6, t.position[2]) // D227
        // update() crossfades the anim state machine AND faces the heading — the engine convention is yaw
        // RAW (rotation.y = facing_yaw; the +π variant was the documented owner bug in character_avatar.js).
        // Riding plays the looped SIT clip (avatar-side IDLE fallback for the SIT-less rigs), never the
        // standing/running gait — the "standing in mid-air over the mount" defect.
        // [pro-feel pass] dt × gait_scale = the D303 no-foot-slide dt-scaling on the roam path: the
        // loco clip's cadence tracks the ACTUAL speed through accel ramps (1 for non-loco states).
        // ENG-16: while a one-shot beat plays (gather ATTACK), DRIVE the mixer via tick() — update() would
        // crossfade straight back to a locomotion loop and cut the swing. Riding always keeps the SIT loop.
        if (!riding && performance.now() < beat_end) avatar.tick(dt)
        else avatar.update(riding ? 'SIT' : t.anim, t.facing_yaw, dt * (riding ? 1 : (t.gait_scale ?? 1)))
        // WORN-COSMETIC BODY AURA — re-mount only on an equip CHANGE (desired_overlay_key set in feed); unequip
        // disposes. The shell rides the avatar's OWN skinned mesh, so it follows the anim, hides with the body
        // (first-person / fight — avatar.visible=false hides its children too), and needs no separate placement.
        if (avatar.ready && desired_overlay_key !== overlay_key) {
          cosmetic_overlay?.dispose()
          cosmetic_overlay = null
          overlay_key = desired_overlay_key
          if (desired_overlay_key && STATUS_OVERLAY[desired_overlay_key])
            cosmetic_overlay = attach_status_overlay(avatar.object3d, STATUS_OVERLAY[desired_overlay_key])
        }
        cosmetic_overlay?.update(dt) // advance the noise scroll (no-op when nothing is mounted)
        // WORN COSMETICS — reconcile the equipped hat/cloak (idempotent; diffs internally — the legacy
        // player_equipment change-gate transcribed). Bone children need NO per-frame pose: they ride the
        // skeleton, and first-person/fight hide with the avatar tree. A missing GLB loud-fails at load.
        if (avatar.ready && worn) worn.set_slots(desired_worn)
        // PET COMPANION — reconcile against desired_pet (set in feed): recreate the rig only when the GLB
        // identity actually changes (an equip re-read of the SAME pet must not thrash the loaded model),
        // steer it toward the player each frame (#593 — its own dead-zone follow, not welded), and hide it
        // with the walk body exactly like the mount.
        // #594 — while RIDING the pet itself (mount_source 'pet'), the steered rig IS the same creature
        // mount_ctl already poses under the rider; spawning both would double it visibly.
        const riding_the_pet = riding && mount_source === 'pet'
        if (desired_pet.spawn && desired_pet.glb_url && !riding_the_pet) {
          if (!pet_ctl || pet_glb_url !== desired_pet.glb_url) {
            pet_ctl?.dispose()
            pet_ctl = create_pet_companion_rig({ engine, glb_url: desired_pet.glb_url, slug: desired_pet.key })
            pet_glb_url = desired_pet.glb_url
          }
          pet_ctl.set_visible(!own_hidden)
          pet_ctl.update(t.position[0], t.visual_y, t.position[2], dt) // #593 — independent dead-zone follow, not welded
        } else if (pet_ctl) {
          pet_ctl.dispose()
          pet_ctl = null
          pet_glb_url = null
        }
      } catch (error) {
        // D160-HARDENING: a rotten avatar can NEVER poison the frame loop — eject it, keep the world.
        game_log('voxel', 'avatar ejected mid-frame (camera-only from here):', error)
        try {
          engine.remove_from_scene(avatar.object3d)
        } catch {
          /* already gone */
        }
        try {
          avatar.dispose()
        } catch {
          /* best-effort */
        }
        try {
          cosmetic_overlay?.dispose() // free the body-aura shells with the ejected avatar (materials)
        } catch {
          /* best-effort */
        }
        try {
          worn?.dispose() // detach the worn GLBs with the ejected avatar (REMOVE-ONLY — cache owns the GPU)
        } catch {
          /* best-effort */
        }
        try {
          pet_ctl?.dispose() // detach the companion with the ejected avatar (REMOVE-ONLY — cache owns the GPU)
        } catch {
          /* best-effort */
        }
        cosmetic_overlay = null
        overlay_key = null
        worn = null
        pet_ctl = null
        pet_glb_url = null
        avatar = null
      }
    }
    // TR-5 — the veteran-title flame aura: its OWN guarded block (a cosmetic failure never ejects the
    // avatar). Rings the feet like the avatar; hidden unless the title gate is ON and we're roaming (a
    // fight freezes the walk body, so the aura hides with it). Yaw-billboards to the live engine camera.
    if (aura) {
      try {
        if (!aura.object3d.parent) engine.add_to_scene(aura.object3d) // post-boot retry (silent pre-boot)
        const show = aura_active && !is_fight()
        aura.set_active(show)
        if (show) {
          aura.object3d.position.set(t.position[0], t.visual_y, t.position[2])
          aura.update(engine.get_camera?.())
        }
      } catch (error) {
        game_log('voxel', 'title aura ejected (cosmetic — world unaffected):', error)
        try {
          engine.remove_from_scene(aura.object3d)
        } catch {
          /* already gone */
        }
        try {
          aura.dispose()
        } catch {
          /* best-effort */
        }
        aura = null
      }
    }
    // D230 — ONE CAMERA WRITER. While a fight owns the scene the fight camera (embed_voxel_fight_camera.js)
    // drives; the BOARD owns the player's body (entity_upsert kind:'player') — hide the walk avatar/mount/
    // plate or a frozen clone stands beside the board.
    if (is_fight()) {
      if (avatar) avatar.object3d.visible = false
      if (mount_ctl) mount_ctl.set_visible(false) // TR-97 — hide the mount with the walk body during a fight
      if (pet_ctl) pet_ctl.set_visible(false) // companion hides with the walk body during a fight
      my_plate?.update(0, -9999, 0) // plate off-screen with the hidden body
      const rc = engine.get_camera?.()
      if (rc) rc.userData.plate_bob = 0 // fight cam doesn't bob — clear the stale walk bob for any live plates
      return
    }
    // AUDIO (subtle procedural sounds for steps) — ONE movement-tick hook, roam-only (this
    // branch never runs mid-fight — the board has its own play_fight_sfx('move') cue). Ambient water
    // audio was removed (noisy for nothing) — footsteps (incl. the wading class) are unaffected.
    tick_environment_audio(
      { x: t.position[0], y: t.visual_y, z: t.position[2], on_ground: t.on_ground, block_id_at: env.block_id_at },
      dt
    )
    // D195 — the ENGINE's shoulder rig owns the walk camera (the demo's exact feel: spring-damped follow,
    // shoulder bias, collision arm, speed-FOV rush; pose pushed exactly as walk_mode.js:96-108 — the same
    // set_camera_* path the demo's motion blur rides). My D178-era hand follow-cam + its +π basis are
    // DELETED. The spectate diorama pan above legitimately stays app-driven (the designed standdown use).
    const pose = cam.update({
      feet: [t.position[0], t.visual_y, t.position[2]],
      eye_height: avatar?.eye_height ?? 1.6,
      speed: t.speed,
      solid_at: env.solid_at,
      dt,
      on_ground: t.on_ground, // S-73 — gate the engine rig's head-bob (zeroed while airborne)
    })
    if (avatar) avatar.object3d.visible = pose.distance > 1.0 // close-dolly clip guard (demo parity)
    engine.set_camera_position?.(pose.position)
    engine.set_camera_orientation?.(pose.yaw, pose.pitch)
    // [ENG camera-feel] thread the SAME speed the shoulder rig just used (speed-FOV above) to the post
    // stack's motion-blur run-speed trigger (vignette blur while running).
    engine.set_camera_speed?.(t.speed)
    // Publish the shoulder rig's synthetic head-bob alongside the camera so overhead plates (local/remote/mob)
    // can add it to their anchor Y and stay world-locked — the bob is cancelled at projection, not smoothed.
    const rc = engine.get_camera?.()
    if (rc) rc.userData.plate_bob = cam.get_bob_offset()
    // SEARCH-ZONE JUICE: a seam (discovery_actions) fires a one-shot FOV punch on a search reveal; the pulse
    // is 0 when idle, so this is a no-op cost every other frame. Additive over the shoulder-rig fov.
    engine.set_camera_fov?.(pose.fov + walk_fov_pulse(dt))
  }

  /** The shoulder camera handle — the DEV qa rig drives orbit through cam.rotate (D195). */
  const get_cam = () => cam
  /** The live avatar handle (null before load / after a mid-frame eject) — the D191 probe's eyes. */
  const get_avatar = () => avatar

  const dispose = () => {
    window.removeEventListener('keydown', kd)
    window.removeEventListener('keyup', ku)
    set_local_beat(null) // ENG-16 — drop the beat trigger so a stale avatar handle can't be fired post-teardown
    context.events.off('map/auto_run', on_auto_run) // AUTO-RUN — stop consuming marker clicks
    auto_run.dispose() // cancels any in-flight run + removes its indicator chip
    ft_pilot.dispose() // FAST-TRAVEL — tear down any live dragon rig with the session
    cam.dispose() // detaches the rig's pointer-lock/wheel listeners (D195)
    mobile_input.dispose() // detach touch-camera/mobile-mode listeners and clear held intents
    cursor_lock.dispose() // detaches the dblclick/pointerlockchange listeners + releases an engaged sticky lock
    dispose_environment_audio() // footstep loop nodes + timers die with the session
    cosmetic_overlay?.dispose() // worn-cosmetic body-aura shells (materials); no-op when nothing is mounted
    worn?.dispose() // worn visible-slot GLBs (REMOVE-ONLY detach; the cache owns the GPU resources)
    if (avatar) {
      engine.remove_from_scene(avatar.object3d)
      avatar.dispose() // stops the mixer + frees geometry/materials (engine handle contract)
    }
    if (aura) {
      engine.remove_from_scene(aura.object3d)
      aura.dispose() // TR-5 — frees the wisp geometries + the shared flame material
    }
    mount_ctl?.dispose() // TR-97 — the mount rig dies with the session (REMOVE-ONLY; cache owns the GLB)
    pet_ctl?.dispose() // companion rig dies with the session (REMOVE-ONLY; cache owns the GLB)
    if (mount_hint_armed) use_prompt_stack.getState().clear_prompt('mount') // #594 — the [X] pill dies with the session
    my_plate?.dispose() // D227 — the local plate dies with the session
    for (const p of puffs) {
      try {
        engine.remove_from_scene(p.handle.object3d)
      } catch {
        /* already gone */
      }
      p.handle.dispose() // double-jump puffs in flight at teardown — free their geo/materials
    }
    puffs.length = 0
  }

  // GHOST-PLATE FIX: the host's set_frame_paused already cancels this session's own rAF (which drives frame2
  // → my_plate.update()) in lockstep with remotes/world_spawns' own set_paused; this hooks the SAME call so
  // the self plate is explicitly hidden rather than left frozen at its last on-screen state (see world_paused
  // above). Un-pausing re-shows it unless cinematic recording is still independently hiding it.
  const set_paused = (/** @type {boolean} */ paused) => {
    world_paused = !!paused
    sync_plate_hidden()
  }

  return { feed, frame2, get_cam, get_avatar, set_paused, dispose }
}
