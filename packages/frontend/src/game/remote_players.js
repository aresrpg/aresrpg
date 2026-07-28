// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D206 — REMOTE PLAYERS in the voxel world (feature #19's render half; replaces roam.js's dead
// foreign-player sprites). ONE home for BOTH modes: the walk session AND the logged-out spectate
// diorama create this layer; it renders every presence entry (visible_characters — fed by the courier
// presence fold plus locally-driven owned followers; the active id is never inserted) as a real engine avatar
// (class rig + hair + equipped pet companion), eases position → target_position (presence retargets, we
// lerp — roam's contract), stands the body on the terrain via ground_surface_y (presence packets
// carry CELLS, no y), derives yaw/anim from motion, and cleans up on despawn. Self-contained rAF;
// dispose() tears everything down. NO game logic here.

import { create_character_avatar, create_worn_cosmetics, ground_surface_y } from '@aresrpg/engine3/player'
import { fight_store } from '@aresrpg/fight/store'

import { use_dungeon } from '../world-shell/dungeon_store.js'
import { use_party } from '../world-shell/party_store.js'
import { world_fight_active } from '../world-shell/fight_session_scope.js'
import { presence_character } from '../world-shell/presence_adapter.js'

import { feet_of } from './ambient_placement.js'
import { same_render_instance } from './remote_visibility_scope.js'
import { plate_occluded, project_plate } from './nameplate_occlusion.js'
import { peer_display_name } from './remote_player_name.js'
import { open_player_menu } from './screens/hud/world/player_menu_store.js'
import { create_pet_companion_rig } from './pet_companion.js'
import { step_pet_follow, empty_pet_motion } from './pet_follow.js'
import { PLACEHOLDER_RIG_CLASS, character_model_urls, character_rig_of } from './screens/character-glb.js'
import { read_worn_templates } from './cosmetic_glb.js'
import { create_remote_character_cache } from './remote_character_cache.js'
import { context } from './store.js'
import { game_log } from '../core/log.js'
import { instrument_cpu_callback } from './cpu_span.js'

const LERP_LAMBDA = 8 // position ease (matches the roam feel — arrive fast, never snap)
const SPEED_EPS = 0.3 // m/s under which the rig idles
const FALLBACK_Y = 132 // pre-ground-resolve stand-in (near the world's shore line)
const ANIM_CULL_M = 50 // D218 v1 — no mixer ticks beyond this camera distance (frozen pose)
const OCCLUDED_OPACITY = 0.18 // faded target when a plate sits behind world geometry (soft-faded via CSS)
// NAMEPLATE HIERARCHY ("not from that far") — the plate itself gets a TIGHTER show
// radius than the rig's own existence range (OVERWORLD_RANGE_M above) or the anim-cull (D218), mirroring
// the exact pattern world_spawns.js already proved for mob cards (NAMETAG_CULL_M/FADE_M): a fixed cull
// with a fade band near the edge, never a pop. Shorter than the mob card's 40 m — players are the more
// PROMINENT signal up close (see the chip style below), not a further-draw-distance one.
const PLATE_CULL_M = 34 // the plate is fully gone past this many blocks from the camera
const PLATE_FADE_M = 28 // …and fades in over the last few blocks approaching PLATE_CULL_M

// FIGHT-VIEW CULL (a screenshot showed the other player model still appearing in the middle of the
// board, as if in the world and not removed properly — a peer's WORLD rig stood mid-board
// like a ghost). Keys on VIEW MODE, not on who's fighting: ANY live fight/dungeon session hides EVERY remote
// rig's RENDER (body + nameplate) — the frame loop's presence/position bookkeeping keeps
// folding regardless (so a post-fight rig is instantly correct, no pop-in); this is the ONLY thing that
// decides what actually gets DRAWN. Reuses the scoped WORLD fight predicate that veils world spawns, so the
// simulator's `sim:` session never culls the resident world's remote rigs.
/** @param {boolean} fight_active */
export const remote_rig_visible = (fight_active) => !fight_active

/**
 * @param {any} engine the live engine facade (add_to_scene / remove_from_scene / sample_block)
 * @param {HTMLElement | null} [world_canvas] D232 — the WORLD canvas whose rect frames plate projection
 *   (a bare querySelector('canvas') can grab a DIFFERENT canvas — pedestal/drawer — and shift every plate).
 * @returns {{ dispose: () => void }}
 */
export function create_remote_players(engine, world_canvas = null) {
  const sample = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
    engine.sample_block?.(x, y, z) ?? 0
  /** @type {Map<string, any>} id → { avatar, x, z, gy, yaw, cell_key } */
  const rigs = new Map()
  // TRANSPORT RULING: worn cosmetics and equipped pets load from the rpc directly. A peer's worn hat/cloak AND
  // equipped pet resolve from /v1 (chain truth, unspoofable). `worn_templates` is the SAME
  // /v1/encyclopedia join catalog embed_voxel_player.js loads for the LOCAL player's own cosmetics
  // (read_worn_templates — one fetch home, two consumers); `peer_cache` batches every stale peer id into ONE
  // /v1/characters read per refresh wave and derives BOTH worn cosmetics and pet companion from it (#553 —
  // never a second batched-fetch cache for the same doc).
  let worn_templates = new Map()
  void read_worn_templates()
    .then((templates) => {
      worn_templates = templates
    })
    .catch((error) => game_log('worn', 'template identity join failed — remote worn GLBs stay unmounted', error))
  const peer_cache = create_remote_character_cache({ templates: () => worn_templates })
  let raf = 0
  let last_t = performance.now()
  let anim_ticks = 0 // D218 — DEV telemetry (ticked rigs per window)
  let frame_count = 0
  const fallback_rect = { left: 0, top: 0, width: 0, height: 0 }
  const fallback_position = { x: 0, z: 0 }
  const identity_scratch = { classe: 'senshi', male: true, declared: false }
  const projected_plate = { left: 0, top: 0 }

  // D206-visibility (other players were hard to see — the rig RENDERS but at the diorama's ~53 m iso
  // range a 2 m character is a speck): NAMEPLATES. A tiny house-style DOM chip per rig, world→screen
  // projected every frame off the engine camera — players are findable at ANY range, both modes.
  // Z-STACK LAW: the SESSION canvas sits at z-11 (GameWorldHost) — z-7 rendered these plates UNDER the
  // world in walk mode (spectate's stack differs, which is where D206 was validated). 11 + body-append
  // = over the canvas (DOM order breaks the tie), under the z-12 HUD.
  const chip_layer = document.createElement('div')
  chip_layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:11'
  document.body.appendChild(chip_layer)

  // Identity comes from the normal chain read requested by the courier presence fold.
  const identity_of = (/** @type {string} */ _id, /** @type {any} */ entry) => {
    const classe = character_rig_of(entry.classe, PLACEHOLDER_RIG_CLASS)
    const male = entry.male !== false
    identity_scratch.classe = classe
    identity_scratch.male = male
    identity_scratch.declared = !!entry.classe
    return identity_scratch
  }

  const spawn_rig = (/** @type {string} */ id, /** @type {any} */ entry) => {
    const { classe, male, declared } = identity_of(id, entry)
    if (!declared && classe === 'senshi')
      game_log(
        'remote',
        `identity UNRESOLVED for ${id.slice(0, 10)} — senshi fallback until the chain read lands`
      )
    // ONE home for the rig rule — the same door the roam avatar, the fight board and the simulator read.
    const urls = character_model_urls(classe, male)
    const colors = entry
    const avatar = create_character_avatar({
      glb_url: urls.body, // asset-host-first, bundled /sprites fallback (character_model_urls)
      hair_url: urls.hair,
      colors:
        colors && (colors.color_1 || colors.color_2 || colors.color_3)
          ? [colors.color_1, colors.color_2, colors.color_3]
          : undefined,
    })
    const p = entry.position ?? { x: 150, z: 150 }
    const chip = document.createElement('div')
    // NAMEPLATE HIERARCHY: player plates look different and more prominent than mob
    // ones — bigger/bolder than the mob card's compact 10px/rgba-border chip (world_spawns.js): a wider
    // solid gold #c8963c border (the design system's primary-accent token, not the mob's 50%-translucent
    // one) plus an ambient gold-glow box-shadow (the house `.gold-glow`/hover-glow language) reads as the
    // louder, social signal at a glance. Same treatment as local_nameplate.js's own plate — one visual
    // language for "this is a player" regardless of local/remote.
    chip.style.cssText =
      'position:absolute;transform:translate(-50%,-100%);padding:5px 11px;white-space:nowrap;' +
      'font:700 12px/1.2 "JetBrains Mono",monospace;letter-spacing:.16em;text-transform:uppercase;' +
      'color:#f5d0a9;background:rgba(10,10,15,.85);border:1.5px solid #c8963c;' +
      'text-shadow:0 0 8px rgba(200,150,60,.8),0 1px 2px rgba(0,0,0,.9);box-shadow:0 0 16px rgba(200,150,60,.35);' +
      'display:none;transition:opacity .18s ease' // + occlusion/range fade
    chip.textContent = peer_display_name({ resolved_name: entry.name, address: id })
    // S-67 — the nameplate IS the in-world "click a player" seam (additive; the render/grounding loop is
    // untouched). Only THIS chip becomes interactive (chip_layer itself stays pointer-events:none); a click
    // opens the shared PlayerActionMenu with the server-observed wallet identity (add friend / invite).
    chip.className = 'gw-nameplate'
    chip.style.pointerEvents = 'auto'
    chip.style.cursor = 'pointer'
    chip.addEventListener('click', (event) => {
      event.stopPropagation()
      const presence = presence_character(id)
      open_player_menu({
        id,
        address: presence?.address ?? null,
        name: peer_display_name({ resolved_name: entry.name, address: id }),
        x: event.clientX,
        y: event.clientY,
      })
    })
    chip_layer.appendChild(chip)
    // WORN COSMETICS (other players weren't seeing worn cosmetics) — the SAME rig create_worn_cosmetics
    // mounts on the LOCAL player's Head/cape bones (embed_voxel_player.js), keyed off the peer's /v1-resolved
    // worn set (peer_cache — see the reconcile call below).
    // Safe to create before avatar.ready: it only sets up closures until set_slots() first fires (the
    // board_entities.js precedent).
    rigs.set(id, {
      avatar,
      worn: create_worn_cosmetics({ avatar }),
      chip,
      classe,
      male,
      x: p.x,
      z: p.z,
      y: 0,
      gy: FALLBACK_Y,
      yaw: 0,
      cell_key: '',
    })
    game_log('remote', `rig spawned for ${id.slice(0, 10)} (${classe}) at [${p.x}, ${p.z}]`) // loud-pipeline law
  }

  const drop_rig = (/** @type {string} */ id, /** @type {any} */ r) => {
    try {
      engine.remove_from_scene(r.avatar.object3d)
    } catch {
      /* already gone */
    }
    try {
      r.avatar.dispose()
    } catch {
      /* best-effort */
    }
    r.pet?.dispose() // #553 — the remote pet companion dies with the player (REMOVE-ONLY; cache owns the GLB)
    r.worn?.dispose() // worn hat/cloak GLBs die with the player (REMOVE-ONLY — the cache owns the GPU buffers)
    peer_cache.drop(id) // forget the /v1 resolution too — bounds cache growth across a long session's peer churn
    r.chip?.remove()
    rigs.delete(id)
  }

  // D237 INSTANCE SCOPE (#333 CORRECTED — see remote_visibility_scope.js): the client only shows players from
  // the dungeon when in a dungeon, and players in a dungeon don't render for players not in a dungeon — it's like
  // an instance; drop them. Every dungeon cave uses the SAME deterministic room coords (cave_session seeds
  // visuals off world_id — "co-op consistent, same world, same room"), and presence broadcasts keep flowing
  // in-cave — so WITHOUT this filter a peer in ANOTHER dungeon (or the overworld) renders as a ghost standing in
  // mine. The match used to compare each side's OWN dungeon_id — each character's PERSONAL run_pass_id
  // (dungeon_run_store.js "session identity") — never equal between two different players, not even two co-op
  // partners standing in the exact same room, so co-op players never rendered for each other inside a shared
  // dungeon (#333 — same disease PR #330 cured in the chat scope, world_chat_scope.js). same_render_instance
  // compares the genuinely SHARED identity instead: accepted on-chain party membership from party_store,
  // while still refusing a stranger running the identical dungeon template who isn't in my party.
  //
  // D237 AMENDMENT (players shouldn't announce themselves to far-away peers — drop players not in range): for
  // TWO OVERWORLD peers (scope null == null) add a receiver-side RANGE bound off the camera (the viewer's eye) —
  // a peer beyond OVERWORLD_RANGE_M gets no rig/chip. SAME-DUNGEON peers ALWAYS render regardless of range (the
  // cave room is small, co-op must see each other). The whole gate is RECEIVER-side + topology-independent.
  //
  const OVERWORLD_RANGE_M = 100 // generous ~streaming-ring radius; comfortably past ANIM_CULL_M (50) so a merely
  //                               anim-culled (frozen-pose) rig is never also range-dropped.
  const logged_drops = new Set()
  /** The instance-scope inputs for one peer, read fresh every call — the ONE place should_show and drop_reason
   * source them from (never a second, competing read). @param {string} id */
  const peer_scope = (/** @type {string} */ id) => {
    const dungeon = use_dungeon.getState()
    const party = use_party.getState()
    const mine_dungeon_id = dungeon.in_session ? (dungeon.dungeon_id ?? null) : null
    const mine_party_id = party.party_id ?? null
    const accepted_member = !!party.party?.members?.some((member) => member.character === id)
    return {
      mine_dungeon_id,
      peer_dungeon_id: mine_dungeon_id && accepted_member ? mine_dungeon_id : null,
      mine_party_id,
      peer_party_id: accepted_member ? mine_party_id : null,
    }
  }
  /** Should this peer have a rig THIS frame? instance scope must match; two overworld peers additionally
   * range-bound off the camera. @param {string} id @param {number} px @param {number} pz @param {any} cam */
  const should_show = (id, px, pz, cam) => {
    const scope = peer_scope(id)
    if (!same_render_instance(scope)) return false // INSTANCE MISMATCH — never render across instances.
    if (scope.mine_dungeon_id !== null) return true // same DUNGEON → always render (co-op, small room, no range gate).
    if (!cam) return true // both overworld but camera not booted yet → fail-open (scope already held).
    return (cam.position.x - px) ** 2 + (cam.position.z - pz) ** 2 <= OVERWORLD_RANGE_M * OVERWORLD_RANGE_M
  }
  /** DEV-only human reason for a drop/skip (instance mismatch vs overworld out-of-range). */
  const drop_reason = (
    /** @type {string} */ id,
    /** @type {number} */ px,
    /** @type {number} */ pz,
    /** @type {any} */ cam
  ) => {
    const scope = peer_scope(id)
    if (!same_render_instance(scope))
      return (
        `instance mismatch — mine dungeon=${scope.mine_dungeon_id?.slice(0, 10) ?? 'overworld'} ` +
        `party=${scope.mine_party_id?.slice(0, 10) ?? 'none'}, theirs dungeon=` +
        `${scope.peer_dungeon_id?.slice(0, 10) ?? 'overworld'} party=${scope.peer_party_id?.slice(0, 10) ?? 'none'}`
      )
    const d = cam ? Math.round(Math.hypot(cam.position.x - px, cam.position.z - pz)) : -1
    return `overworld out of range (${d}m > ${OVERWORLD_RANGE_M}m)`
  }

  const frame_body = (/** @type {number} */ now) => {
    raf = requestAnimationFrame(frame)
    frame_count += 1
    if (import.meta.env.DEV && frame_count % 300 === 0 && rigs.size)
      (game_log('remote', `D218 anim window: ${anim_ticks} ticks / ${rigs.size * 300} rig-frames`), (anim_ticks = 0))
    const dt = Math.min(0.1, (now - last_t) / 1000)
    last_t = now
    const visible = context.get_state().visible_characters
    const cam = engine.get_camera?.() // viewer eye — the D237 overworld range reference (read once per frame)
    // FIGHT-VIEW CULL signal — read once per frame (same idiom as `cam` above); see remote_rig_visible.
    const fight_active = world_fight_active(fight_store.getState())
    // D237: gate SPAWNS on instance scope + overworld range — an out-of-instance or too-far peer never gets a
    // rig (one-time DEV log per peer; cleared on spawn so a later drop re-logs).
    for (const [id, entry] of visible) {
      if (rigs.has(id)) continue
      const p = entry.target_position ?? entry.position ?? fallback_position
      if (should_show(id, p.x, p.z, cam)) {
        logged_drops.delete(id)
        spawn_rig(id, entry)
      } else if (import.meta.env.DEV && !logged_drops.has(id)) {
        logged_drops.add(id)
        game_log('remote', `D237 skip ${id.slice(0, 10)}: ${drop_reason(id, p.x, p.z, cam)} — NOT rendering`)
      }
    }
    // D237: DROP a rig that left visibility OR fell out of my instance scope / overworld range (peer entered a
    // dungeon, or roamed too far away). Uses the rig's own eased position for the range test.
    for (const [id, r] of rigs) {
      const entry = visible.get(id)
      // D237 churn fix: range-test against the peer's REAL broadcast position (target_position — the SAME
      // source the spawn loop gates on), NOT the lagging eased rig position (r.x/r.z). A rig is planted at the
      // peer's OLD position (entry.position) then eases toward target; testing r.x here dropped a rig whose
      // fresh target is already in range before it could ease in → spawn↔drop churn every presence tick. One
      // predicate (should_show), one position source, so spawn and drop can never disagree at the boundary.
      const px = entry?.target_position?.x ?? entry?.position?.x ?? r.x
      const pz = entry?.target_position?.z ?? entry?.position?.z ?? r.z
      if (!entry || !should_show(id, px, pz, cam)) {
        if (import.meta.env.DEV && !entry)
          logged_drops.delete(id) // real despawn → allow a fresh log on re-entry
        else if (import.meta.env.DEV && !logged_drops.has(id)) {
          logged_drops.add(id)
          game_log('remote', `D237 drop ${id.slice(0, 10)}: ${drop_reason(id, px, pz, cam)} — dropping rig + chip`)
        }
        drop_rig(id, r)
      }
    }
    // TRANSPORT RULING — batch-refresh every currently-rigged peer's /v1 worn + pet resolution ONCE per frame
    // (cheap: a Map-timestamp scan; only fires network for ids that are missing/stale/not already in flight —
    // see remote_character_cache.js). A rig spawned THIS frame has no cache row yet, so it's picked up
    // immediately (no separate "identity change" trigger needed); re-equips/unequips heal within the ~60s TTL.
    if (rigs.size) void peer_cache.refresh(rigs.keys())
    const plate_canvas = rigs.size ? (world_canvas ?? document.querySelector('canvas')) : null
    let plate_rect = plate_canvas?.getBoundingClientRect() ?? null
    if (!plate_rect && rigs.size) {
      fallback_rect.width = window.innerWidth
      fallback_rect.height = window.innerHeight
      plate_rect = fallback_rect
    }
    for (const [id, r] of rigs) {
      const entry = visible.get(id)
      if (!entry) continue
      try {
        // D219: the read-model resolves classe/male ASYNC after the first pos packet — a rig spawned on
        // the fallback identity RESPAWNS once (and only once) when the truth lands. Colors re-apply via
        // the peerStateUpdated listener below; hair rides the respawn's hair_url.
        const { classe: true_classe, male: true_male } = identity_of(id, entry)
        if (true_classe !== r.classe || true_male !== r.male) {
          game_log(
            'remote',
            `identity resolved for ${id.slice(0, 10)} (${true_classe}/${true_male ? 'm' : 'f'}) — re-rigging (D219)`
          )
          drop_rig(id, r)
          spawn_rig(id, entry)
          continue
        }
        // add_to_scene pre-boot is a silent drop (engine.js:783, the D191 class) — retry until taken.
        if (!r.avatar.object3d.parent) {
          engine.add_to_scene(r.avatar.object3d)
          if (r.avatar.object3d.parent) game_log('remote', `rig in scene: ${id.slice(0, 10)} (D206)`)
        }
        // Chain-backed colors land asynchronously on the presence entry. Apply once (set_colors queues pre-ready).
        if (!r.colored) {
          const colors = entry
          if (colors && (colors.color_1 || colors.color_2 || colors.color_3)) {
            r.avatar.set_colors?.([colors.color_1, colors.color_2, colors.color_3])
            r.colored = true
          }
        }
        // #613 — a with_you follower is a FREE-RUN companion: it steers ITSELF toward the leader anchor through
        // the SAME pet_follow core the pet companions use (dead zone + catch-up + roam + snap-when-genuinely-far),
        // NOT gated on the leader standing still and never range-despawned — the field bug was a follower that
        // popped on stop and vanished on move. An in_transit / peer rig keeps the #509 lerp toward its
        // timer-projected target (no teleport-snap: beyond the visible range the reducer despawns the row and a
        // respawn plants a fresh rig at the projection).
        const free_run = !!entry.free_run && !!entry.follow_anchor
        const k = 1 - Math.exp(-LERP_LAMBDA * dt)
        let dx
        let dz
        let speed
        let steer_yaw = null // set by the free-run steering; the lerp path derives yaw from the broadcast/motion
        if (free_run) {
          // seed the rig's OWN motion at its current spot so a near companion ambles in rather than teleporting.
          if (!r.follow_motion) r.follow_motion = { ...empty_pet_motion(), x: r.x, z: r.z, yaw: r.yaw }
          const prev_x = r.x
          const prev_z = r.z
          r.follow_motion = step_pet_follow(r.follow_motion, entry.follow_anchor, dt)
          r.x = r.follow_motion.x
          r.z = r.follow_motion.z
          dx = r.x - prev_x
          dz = r.z - prev_z
          speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0
          steer_yaw = r.follow_motion.yaw
        } else {
          r.follow_motion = null // left with_you (e.g. re-entered a transit leg) → drop the stale steering state
          const t = entry.target_position ?? entry.position ?? r
          dx = t.x - r.x
          dz = t.z - r.z
          r.x += dx * k
          r.z += dz * k
          speed = Math.hypot(dx, dz) * LERP_LAMBDA
        }
        // D217: the payload's WORLD height wins (position.y > 1 = a real broadcast height — hills and
        // jumps track exactly); 0/absent OR a free-run companion (no broadcast y — it trails the leader's
        // ground) → the ground-scan fallback (re-scan on cell change only; null = forest/water keeps last).
        const th = free_run ? 0 : Number((entry.target_position ?? entry.position ?? r).y ?? 0)
        if (th > 1) {
          r.gy += (th - r.gy) * k
        } else {
          const cell_key = `${Math.floor(r.x)}:${Math.floor(r.z)}`
          if (cell_key !== r.cell_key) {
            r.cell_key = cell_key
            // FEET convention: the D217 broadcast carries the controller's FEET y, so the
            // scan fallback must produce the SAME semantic — ground top face (+1), or payload-style changes
            // made the avatar pop a block and old-payload rigs stood knee-deep.
            const gy = feet_of(ground_surface_y(sample, Math.floor(r.x), Math.floor(r.z)))
            if (gy !== null && gy !== undefined) r.gy = gy
          }
        }
        // A free-run companion faces its OWN steering heading; else the TRUE broadcast heading wins (D222,
        // shortest-arc lerp); movement-derived = old-payload fallback.
        if (steer_yaw !== null) {
          r.yaw = steer_yaw
        } else if (typeof entry.target_yaw === 'number') {
          let dyaw = entry.target_yaw - r.yaw
          dyaw = ((dyaw + Math.PI) % (2 * Math.PI)) - Math.PI
          if (dyaw < -Math.PI) dyaw += 2 * Math.PI
          r.yaw += dyaw * k
        } else if (speed > SPEED_EPS) r.yaw = Math.atan2(dx, dz)
        // #553 — PUBLIC PETS: a peer's equipped pet resolves from /v1 chain truth (peer_cache.pet_of, the SAME
        // batched read + resolver worn cosmetics above joins),
        // through the SAME rig factory (pet_companion.js) and reconcile shape embed_voxel_player.js's own
        // desired_pet uses: recreate only when the glb identity actually changes, steer it toward the peer rig
        // every frame (#593 — its own dead-zone follow, not welded), hide it with the fight-view cull like
        // everything else this rig owns. Independent of riding — the local path
        // never gates a companion on the mount slot either, so this is a pure mirror, not a new rule.
        const desired_pet = peer_cache.pet_of(id)
        if (desired_pet.spawn && desired_pet.glb_url) {
          if (!r.pet || r.pet_glb !== desired_pet.glb_url) {
            r.pet?.dispose()
            r.pet = create_pet_companion_rig({ engine, glb_url: desired_pet.glb_url, slug: desired_pet.key })
            r.pet_glb = desired_pet.glb_url
          }
          r.pet.set_visible(remote_rig_visible(fight_active))
          r.pet.update(r.x, r.gy, r.z, dt) // #593 — the pet steers itself toward the peer rig (dead zone + roam)
        } else if (r.pet) {
          r.pet.dispose()
          r.pet = null
          r.pet_glb = null
        }
        // WORN COSMETICS (other players weren't seeing worn cosmetics; COSMETICS TRANSPORT RULING —
        // cosmetics load from the rpc directly) — the peer's hat/cloak resolves from
        // /v1 chain truth (peer_cache, refreshed in the batch above): a player can't
        // spoof cosmetics they don't own. Reconcile is idempotent (set_slots diffs internally, mount.js), so
        // calling it every frame is cheap; gated on avatar.ready (a bone lookup needs the skeleton parsed —
        // the same gate embed_voxel_player.js applies locally).
        if (r.avatar.ready) r.worn?.set_slots(peer_cache.worn_of(id))
        r.avatar.object3d.position.set(r.x, r.gy, r.z)
        r.avatar.object3d.visible = remote_rig_visible(fight_active)
        // D218 v1 (heavy concurrency): beyond ANIM_CULL_M from the CAMERA the mixer never ticks —
        // frozen pose (frustum culling already skips off-screen draw); position/chip still track.
        const far = cam && (cam.position.x - r.x) ** 2 + (cam.position.z - r.z) ** 2 > ANIM_CULL_M * ANIM_CULL_M
        if (!far) {
          r.avatar.update(speed > SPEED_EPS ? 'RUN' : 'IDLE', r.yaw, dt)
          anim_ticks += 1
        } else {
          // D222 (distance must not affect rotation): the cull freezes the MIXER only —
          // facing is a single rotation write, applied at ANY range (update() owns it when near).
          r.avatar.object3d.rotation.y = r.yaw
        }
        // nameplate: project head-height world → screen through the ONE shared plate projector (null pre-boot
        // → hidden). project_plate owns the world-lock (head-bob cancelled at source, fixed 2026-07-10 —
        // plates stay locked to the camera) + the behind-camera cull; this path owns the range-fade band
        // (PLATE_CULL/FADE_M — "not from that far", never a pop) + the terrain-occlusion fade.
        // D227: map through the CANVAS rect — the world panel is sidebar-offset, window dims shift left.
        if (cam) {
          const anchor_y = r.gy + (r.avatar.eye_height ?? 1.6) + 0.6
          const dist = Math.hypot(r.x - cam.position.x, anchor_y - cam.position.y, r.z - cam.position.z)
          const dfade = Math.max(0, Math.min(1, (PLATE_CULL_M - dist) / (PLATE_CULL_M - PLATE_FADE_M)))
          const px = dfade > 0 ? project_plate(cam, plate_rect, r.x, anchor_y, r.z, projected_plate) : null
          r.chip.style.display = remote_rig_visible(fight_active) && px ? 'block' : 'none'
          if (px) {
            r.chip.style.left = `${px.left}px`
            r.chip.style.top = `${px.top}px`
            // occlusion + range fade: terrain between the head anchor and the camera, or past the show radius.
            const occ = plate_occluded(engine, r.x, anchor_y, r.z, cam) ? OCCLUDED_OPACITY : 1
            r.chip.style.opacity = `${(occ * dfade).toFixed(3)}`
          }
        }
        // presence name resolves async (read-model) — keep the chip label fresh
        const live_name = peer_display_name({ resolved_name: entry.name, address: id })
        if (live_name && r.chip.textContent !== live_name) r.chip.textContent = live_name
      } catch (error) {
        // a rotten remote rig never poisons the layer — drop it, presence will respawn it clean.
        game_log('remote-players', 'rig ejected:', id, error)
        drop_rig(id, r)
      }
    }
  }
  const frame = instrument_cpu_callback('scene', frame_body)
  raf = requestAnimationFrame(frame)

  if (import.meta.env.DEV)
    /** @type {any} */ (window).__voxel_remotes = () =>
      [...rigs.entries()].map(([id, r]) => ({
        id: id.slice(0, 10),
        classe: r.classe,
        male: r.male,
        pos: [Math.round(r.x), Math.round(r.gy), Math.round(r.z)],
        parented: !!r.avatar.object3d.parent,
        ready: r.avatar.ready,
      }))

  return {
    // TR-1 v2 — hide/show every remote nameplate for cinematic recording (the 3D rigs stay in scene; only
    // the DOM chip layer toggles). display:none on the parent hides all chips; '' resumes per-chip logic.
    set_hidden(h) {
      chip_layer.style.display = h ? 'none' : ''
    },
    // RENDER-PAUSE (pause the webgpu stuff off the game-world route): this rig's own rAF loop is
    // independent of the engine's frame_loop, so engine.stop() alone never stopped remote-rig ticking/DOM-
    // chip projection while browsing a meta page. Cancel/re-arm in lockstep (embed_voxel.js's set_paused).
    set_paused(p) {
      if (p) {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
      } else if (!raf) {
        last_t = performance.now()
        raf = requestAnimationFrame(frame)
      }
    },
    dispose() {
      cancelAnimationFrame(raf)
      for (const [id, r] of rigs) drop_rig(id, r)
      chip_layer.remove()
    },
  }
}
