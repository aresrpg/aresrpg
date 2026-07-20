// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPAWN RIG LAYERS — the 3D side of an on-chain zone spawn. TWO rig layers live here (both driven by chain
// rows, both extracted from world_spawns.js under the 600-LoC law):
//   • create_rig_layer  — MOB GROUPS: seed the members around the anchor, load+normalise+mount each GLB rig,
//     drive the per-member cosmetic roam. Lifecycle = the ambient_mobs.js technique (module-cached GLB fetch →
//     SkeletonUtils clone → avatar material → mixer → feet_of grounding), unchanged — just relocated.
//   • create_gather_layer — RESOURCE NODES (ENGINE_AAA_PLAN §5.3): the node prop is a REAL PROCEDURAL sprite of
//     its gatherable — synthesized in the SAME grass idiom the world's flora uses (@aresrpg/engine3/gather → the
//     authored wheat_sheaf/ore_vein/herb_cluster ops, hue-scaled per id off the ΔE-spaced ramps). This REPLACED
//     the rejected item-ICON cards (a flat item icon, not procedurally generated grass-style wheat/herbs/ores).
//     Identity: ResourceSpawn{
//     job:0/1/2, tier:1-11 } → GATHER_RESOURCES[job][tier] (the @aresrpg/sdk/jobs single home) → { id, name } →
//     synth_gather_buffer(id) procedural sprite. Family (wheat/herb/ore) drives silhouette+sway; magical ids
//     carry a capped hued self-glow and the apex tier the sanctioned gold glow (both under the no-white-halo law).
//     PER-NODE STAND × CHAIN FIELD (two independent multiplicities that COMPOSE): (1) each row renders as a
//     small STAND of `v.cards` billboards (wheat 5 tall-narrow blades · herb/ore 3) — a lone single card reads
//     "smaller / floating / alone" (a lone card reads that way), so a node is always a cluster; (2) a "wheat
//     field" is K adjacent `ResourceSpawn` rows the CHAIN grows (foundation/world_math.move::grow_cluster),
//     each its own spawn_id + remaining:1 + exact authored (x,z) — so K stands make the field, the two do not
//     replace each other. A legacy pre-upgrade node (a single row with remaining>1) wilts its stand down as
//     `remaining` drops (apply_state thins the visible card count). One InstancedMesh(count=cards) per node
//     (seated via seat_surface_y) keeps geometry/material on the shared-cache + REMOVE-ONLY teardown.
// world_spawns.js keeps the data poll/reconcile, the card/plate DOM, the claim interaction, and the frame loop.

import {
  AdditiveBlending,
  AnimationMixer,
  BoxGeometry,
  DataTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { create_mob_model, find_open_spawn, ground_surface_y, seat_surface_y } from '@aresrpg/engine3/player'
import { GUST, advance_gust, gather_night_tint, node_glow, synth_gather_buffer } from '@aresrpg/engine3/gather'
import { GATHER_RESOURCES } from '@aresrpg/sdk/jobs'

import { advance_member_wander, feet_of, make_rng } from './ambient_placement.js'
import { get_mob_model } from './data/mobs.js'
import { game_log } from '../core/log.js'

// [reference-faithful-mob-sizes 2026-07-13] sizes now follow the reference-corpus scale — this KILLED the blanket
// 1.3→1.8 block normalisation this file used to apply to every roam mob (a frog, a larva and a dragon all stood
// the same, player-tall). mob_model.js's prepare_mob_render now defaults to INTRINSIC sizing (the GLB's authored
// scale through the engine's unit calibration, clamped only at the boss/broken-export bounds — see
// HYTALE_BLOCKS_PER_GLB_UNIT there) whenever `target_height` is omitted — so this file simply stops passing one.
const RING_BASE = 1.3 // pack ring radius = RING_BASE + 0.22·n (matches ambient/cave snug spacing)
const ROAM_SPEED = 0.9 // blocks/s — the gentle amble pace each member glides at while wandering
const STRIDE_BLOCKS = 0.7 // a run-clip cycle ≈ this much ground travel; timeScale locks leg cadence to ROAM_SPEED (foot-slide kill)
const ARRIVE_EPS = 0.03 // m within which a waypoint counts as reached → the member settles to idle

// ── GROUND SEAT — the ONE place a chain spawn's (x,z) becomes a render Y (pure, headless-testable) ───────────
const SEAT_FIND_MAX_R = 6 // find_open_spawn spiral radius: nudge a mob rig off a bad column, stay near the anchor
const SEAT_SCAN_UP = 64 // blocks above the player's Y the FLOAT fallback scan starts (covers standing in shallows)
const SEAT_SCAN_DOWN = 160 // …and how far below it looks for the water/terrain surface (lake depth + tall cliffs)

/**
 * Resolve where a group/resource actually seats — preference order (a lake group's compass pip used to read 1m
 * with NO rig rendered): (1) a CLEAN column — `nudge` a mob off tree/cliff/water within
 * SEAT_FIND_MAX_R (mobs never seat underwater); a resource keeps its EXACT (x,z) but seats on the topmost SOLID
 * GROUND block beneath it via `seat_surface_y` — the SAME "read the ground under the canopy" reader the world-fight
 * board seat uses (world_board_seat.js), which skips fluid (water id 5, lava id 24 — GROUND_IDS excludes both)
 * exactly like it skips tree canopy, so a node anchored over a lake seats on the LAKEBED, submerged, instead of
 * floating at the water surface — nodes seat at the bottom. (2) FALLBACK — only when NO solid
 * ground exists anywhere in the column (a genuinely bottomless/unstreamed column), the group must NOT silently
 * vanish: FLOAT it on the first surface (water OR topmost solid) found scanning a bounded window DOWN from the
 * player's own Y. Returns `null` ONLY when that window is entirely air/flora (column genuinely unstreamed) → the
 * caller retries next scan (self-corrects as chunks arrive / the player nears). Pure over the block oracle so it
 * unit-tests headless.
 * @param {{ sample:(x:number,y:number,z:number)=>number, x:number, z:number, scan_from_y:number, nudge:boolean }} a
 * @returns {{ x:number, z:number, y:number, mode:'clean'|'float' } | null}
 */
export function resolve_group_seat({ sample, x, z, scan_from_y, nudge }) {
  const fx = Math.floor(x)
  const fz = Math.floor(z)
  if (nudge) {
    const spot = find_open_spawn(sample, fx, fz, SEAT_FIND_MAX_R)
    if (spot) {
      const gy = feet_of(ground_surface_y(sample, Math.floor(spot[0]), Math.floor(spot[2])))
      if (gy !== null) return { x: spot[0], z: spot[2], y: gy, mode: 'clean' }
    }
  } else {
    // a resource is never nudged off its discovered point, but it must never float ON water — seat_surface_y
    // tunnels past fluid (and flora/canopy) to the first real GROUND_ID floor, however deep (lakebed/riverbed).
    const gy = feet_of(seat_surface_y(sample, fx, fz))
    if (gy !== null) return { x, z, y: gy, mode: 'clean' }
  }
  // FLOAT fallback — first surface (water/solid) top-down in a window around the player's Y. Air + pass-through
  // flora ids (0, cross sprites 10-17, mushrooms 20-23 — you stand IN those) are skipped, mirroring the engine's
  // ground_surface_y; the FIRST real block (walkable ground OR water id 5) tops the seat so the rig always renders.
  const top = Math.ceil(scan_from_y) + SEAT_SCAN_UP
  const bottom = Math.max(1, Math.floor(scan_from_y) - SEAT_SCAN_DOWN)
  for (let y = top; y >= bottom; y -= 1) {
    const id = sample(fx, y, fz)
    if (id === 0 || (id >= 10 && id <= 17) || (id >= 20 && id <= 23)) continue
    return { x: fx + 0.5, z: fz + 0.5, y: y + 1, mode: 'float' } // feet on the surface's top face
  }
  return null // column unstreamed in the window — retry next scan
}

// create_mob_model is the ONE cached clone + material factory shared with cave and fight-board mobs.

/**
 * The rig layer, bound to one world_spawns instance's engine + sample oracle + template resolver.
 * @param {{ engine: any, sample: (x:number,y:number,z:number)=>number,
 *   resolve_template: (id:string)=>({name:string,min_level:number,max_level:number}|null|undefined),
 *   is_disposed: () => boolean }} deps
 * @returns {{ place_members: (e:any)=>void, roam_member: (mem:any, dt:number)=>void }}
 */
export function create_rig_layer({ engine, sample, resolve_template, is_disposed, is_veiled = () => false }) {
  const spawn_rig = (/** @type {any} */ e, /** @type {any} */ mem) => {
    const tpl = resolve_template(e.row.template_id) // gated in place() — already settled (success or null) here
    const { url } = get_mob_model({ variant: e.row.template_id, name: tpl?.name })
    create_mob_model(url, { label: tpl?.name ?? e.row.template_id })
      .then((/** @type {any} */ { root, clips, measured, dispose }) => {
        // Orphan guard (P0 leak fix 2026-07-11): a member torn down MID-LOAD (rig still null ⇒ teardown had
        // nothing to remove) whose entry then RE-PLACES flips e.placed back to true — a bare `!e.placed` check
        // would then pass and mount a clone into the scene that NO live member tracks ⇒ never torn down,
        // accumulating skinned rigs (skeleton + mixer, MB each) until the tab OOMs. `e.members.includes(mem)`
        // rejects the stale member: a re-place swaps e.members for a fresh set, so the dropped mem is not in it.
        if (is_disposed() || !e.placed || mem.rig || !e.members.includes(mem)) {
          dispose()
          return
        }
        root.position.set(mem.mx, mem.cy, mem.mz) // live wander pos (mem.mx/mz may already have drifted off anchor)
        root.rotation.y = mem.yaw
        root.userData.__spawn_entry = e // click hit-test walks up to this — moves WITH the rig, so a roamed member stays claimable
        const mixer = new AnimationMixer(root)
        // idle + a walk/run clip, cross-blended by weight while the member ambles (roam_member) so a wandering
        // mob steps instead of ice-skating; a static member just holds idle (move weight stays 0).
        const idle_clip = clips.find((/** @type {any} */ c) => /idle/i.test(c.name)) ?? clips[0]
        const move_clip = clips.find((/** @type {any} */ c) => /run|walk|move|hop|jump/i.test(c.name)) ?? idle_clip
        const idle_action = idle_clip ? mixer.clipAction(idle_clip) : null
        const move_action = move_clip && move_clip !== idle_clip ? mixer.clipAction(move_clip) : null
        idle_action?.play()
        if (move_action) {
          move_action.play()
          move_action.weight = 0
          // [world-mob-size 2026-07-12] foot-slide kill (the run animation read too slow): the reference-corpus run clips
          // are authored at wildly different cycle lengths (~0.4 s–3 s) yet were played at ×1 while every member ambles at
          // a FIXED ROAM_SPEED — legs and ground disagreed (the slow-authored ones read as slow-mo). Normalise each clip's
          // cadence to the amble: a cycle covers ~STRIDE_BLOCKS of travel, so timeScale = duration·ROAM_SPEED/STRIDE_BLOCKS
          // locks the leg rate to ground speed (auto-scales with ROAM_SPEED). Clamped so a pathological clip can't slow-mo/blur.
          const cyc = move_clip.duration
          move_action.timeScale = cyc > 0.01 ? Math.min(4, Math.max(0.3, (cyc * ROAM_SPEED) / STRIDE_BLOCKS)) : 1
        }
        // In-fight veil race guard (shadow 07-15): a GLB promise that STARTED pre-veil can resolve after the
        // veil flipped — the edge-detected veil pass has already run, so a default-visible mount would leak a
        // wandering mob into the fight view until the next flip. Mount honoring the CURRENT veil (and the
        // engaged beat) instead.
        root.visible = !is_veiled() && !e.engaged
        mem.rig = { root, mixer, h: measured.height, idle_action, move_action, move_w: 0, dispose }
        engine.add_to_scene(root)
      })
      .catch((/** @type {any} */ error) => game_log('world-spawns', `GLB load failed (${e.row.template_id}):`, error))
  }

  // Seed the group's members on a snug ring around the anchor (e.cx/e.cz/e.cy) and mount each rig. Every member
  // carries its OWN wander state seeded off (spawn_id, index) so refreshes replay the same amble (no teleport).
  const place_members = (/** @type {any} */ e) => {
    const n = Math.max(1, Math.min(6, Number(e.row.size) || 1)) // SPEC §8 groups of 1–6
    const radius = n === 1 ? 0 : Math.min(2.6, RING_BASE + 0.22 * n)
    const spawn_id = Number(e.row.spawn_id) || 0
    e.members = []
    for (let m = 0; m < n; m += 1) {
      const a = (m / n) * Math.PI * 2 + 0.7
      const ax = e.cx + Math.sin(a) * radius // this member's spawn anchor = the wander leash centre
      const az = e.cz + Math.cos(a) * radius
      const cy = feet_of(ground_surface_y(sample, Math.floor(ax), Math.floor(az))) ?? e.cy
      const mrng = make_rng((Math.imul(spawn_id + 1, 2654435761) ^ Math.imul(m + 1, 2246822519)) >>> 0)
      const mem = {
        ax,
        az,
        mx: ax,
        mz: az,
        tx: ax,
        tz: az,
        cy,
        yaw: a + Math.PI,
        mrng,
        walking: false,
        moving: false,
        decide_t: mrng() * 6,
        cell_key: `${Math.floor(ax)}:${Math.floor(az)}`,
        rig: /** @type {any} */ (null),
      }
      e.members.push(mem)
      spawn_rig(e, mem)
    }
  }

  // Advance ONE member's cosmetic roam: pure wander step (ambient_placement.js) → re-ground on a cell cross →
  // glue the rig to it → ease the facing yaw → blend idle↔walk. The group ANCHOR + the claim logic never move;
  // the click/[R] hit-test rays the rig ROOT, so a roamed member stays claimable at its new spot.
  const roam_member = (/** @type {any} */ mem, /** @type {number} */ dt) => {
    const { dx, dz } = advance_member_wander(mem, dt, ROAM_SPEED, ARRIVE_EPS)
    const ck = `${Math.floor(mem.mx)}:${Math.floor(mem.mz)}`
    if (ck !== mem.cell_key) {
      mem.cell_key = ck
      const gy = feet_of(ground_surface_y(sample, Math.floor(mem.mx), Math.floor(mem.mz)))
      if (gy !== null) mem.cy = gy // stay on the surface as it ambles across columns (skip fluid/unstreamed)
    }
    const r = mem.rig
    if (!r) return // rig still loading — the state kept advancing, so it mounts at the live spot
    r.root.position.set(mem.mx, mem.cy, mem.mz)
    const target_yaw = mem.moving ? Math.atan2(dx, dz) : mem.yaw
    let dyaw = ((target_yaw - r.root.rotation.y + Math.PI) % (2 * Math.PI)) - Math.PI
    if (dyaw < -Math.PI) dyaw += 2 * Math.PI
    r.root.rotation.y += dyaw * Math.min(1, dt * 6)
    if (r.move_action) {
      r.move_w += ((mem.moving ? 1 : 0) - r.move_w) * Math.min(1, dt * 6)
      r.move_action.weight = r.move_w
      if (r.idle_action) r.idle_action.weight = 1 - r.move_w
    }
    r.mixer.update(dt)
  }

  // Fully release one member: stop its mixer, remove it, then let the shared factory free only instance-owned
  // materials/skeleton state (cached geometry/textures remain live for every other clone).
  const dispose_member = (/** @type {any} */ mem) => {
    const r = mem.rig
    if (!r) return
    try {
      r.mixer?.stopAllAction?.()
      r.mixer?.uncacheRoot?.(r.root)
      engine.remove_from_scene(r.root)
      r.dispose?.()
    } catch {
      /* already gone */
    }
    mem.rig = null
  }

  return { place_members, roam_member, dispose_member }
}

// ── RIG BUDGET — the hard ceiling on concurrent resident rigs (P0 OOM fix 2026-07-11) ────────────────────────
// The mob-density dial went 3-8 → 12-24 groups/zone (+ 16-28 nodes) with NO cap: placement was purely
// range-gated, so a dense neighbourhood (or a small admin zone_size) could resident hundreds of SkeletonUtils
// clones (each a heap-heavy skeleton + mixer) and OOM the tab — and the initial ingest could try to mount them
// all in ONE frame. This is the ONE pure arbiter both kinds run each frame: given the in-range candidates and
// the currently-resident set (each {key, d2} = squared distance to the player), it returns which to EVICT and
// which to PLACE so the resident count never exceeds `budget`, NEAREST-FIRST (evict farthest, place nearest),
// capped to `place_limit` placements per call (INCREMENTAL spawn-in — never a single-frame burst), with a swap
// HYSTERESIS so boundary jitter never thrashes: a resident is displaced by an unplaced one only when NEARER by
// more than `swap_margin_sq`. Pure over plain data (no three, no engine) → unit-tested headless.
/**
 * @param {{ placed: {key:string,d2:number}[], candidates: {key:string,d2:number}[], budget:number,
 *   swap_margin_sq:number, place_limit?:number }} a
 * @returns {{ evict: Set<string>, place: string[] }} evict keys + place keys (place is nearest-first order)
 */
export function select_rig_budget({ placed, candidates, budget, swap_margin_sq, place_limit = Infinity }) {
  /** @type {Set<string>} */ const evict = new Set()
  const cap = Math.max(0, budget)
  const placed_sorted = [...placed].sort((a, b) => a.d2 - b.d2) // nearest → farthest
  const keep = placed_sorted.slice(0, cap)
  for (const p of placed_sorted.slice(cap)) evict.add(p.key) // over budget → drop the farthest residents
  const cand_sorted = [...candidates].sort((a, b) => a.d2 - b.d2)
  /** @type {string[]} */ const place = []
  let ci = 0
  for (let free = cap - keep.length; free > 0 && ci < cand_sorted.length && place.length < place_limit; free -= 1)
    place.push(cand_sorted[ci++].key) // fill free slots with the nearest candidates (incremental cap applies)
  // Nearest-first priority under a FULL budget: a still-unplaced candidate displaces the farthest resident only
  // when strictly nearer by the hysteresis margin (candidates sorted ascending → the first that fails ends it).
  for (let ki = keep.length - 1; ci < cand_sorted.length && ki >= 0 && place.length < place_limit; ki -= 1) {
    if (cand_sorted[ci].d2 + swap_margin_sq >= keep[ki].d2) break
    evict.add(keep[ki].key)
    place.push(cand_sorted[ci++].key)
  }
  return { evict, place }
}

// ── GATHER-TARGET HYSTERESIS (client rider, UPGRADE_NOTES2.md §CLIENT RIDER) ──────────────────────────────────
// K adjacent chain ResourceSpawn cells (~1 block apart — foundation/world_math.move::grow_cluster) sit close
// enough that a bare "always the pixel-nearest" pick see-saws the [G] target between two neighbours as the
// player crosses their roughly-equidistant line — the reticle would flicker. Once a target is ARMED, hold it
// unless a DIFFERENT candidate is nearer by more than `margin_m` real blocks (not squared — the margin is the
// same order of magnitude as the inter-node spacing, so a squared-distance shortcut would misfire at this
// range). Pure over plain keys/distances (no three, no engine) → unit-tested headless (spawn_budget.test.js).
/**
 * @param {{ armed_key: string|null, armed_d2: number|null, nearest_key: string|null, nearest_d2: number|null,
 *   margin_m: number }} a
 * @returns {string|null} the key to target this frame
 */
export function pick_gather_target({ armed_key, armed_d2, nearest_key, nearest_d2, margin_m }) {
  if (armed_key == null || armed_d2 == null) return nearest_key // nothing armed yet — just take the nearest
  if (armed_key === nearest_key || nearest_key == null) return armed_key // already agree, or armed is the only one in range
  const armed_d = Math.sqrt(armed_d2)
  const nearest_d = Math.sqrt(nearest_d2)
  return nearest_d < armed_d - margin_m ? nearest_key : armed_key // switch only when MEANINGFULLY closer
}

// ── GATHER-NODE PROCEDURAL PROP (ENGINE_AAA_PLAN §5.3) ─────────────────────────────────────────────────
// A resource node renders as a small per-node STAND of `v.cards` crossed billboards (wheat 5 tall-narrow
// blades · herb/ore 3) textured with a REAL PROCEDURAL sprite of its gatherable (synth_gather_buffer — the
// grass-idiom wheat_sheaf/ore_vein/herb_cluster ops, hue-scaled per id). Three families read distinctly at
// gather distance (§5.4): WHEAT tall grain + strong sway · HERB short leafy + mild sway · ORE crystal facets
// on a rock knuckle + static. A "field" is K adjacent chain rows (zones.move grow_cluster) — each row is its
// own stand, so a field COMPOSES from stands; this module resolves one row's ground seat + builds its stand
// as ONE InstancedMesh(count=cards) — the sprite art is fixed per id (spawn_id jitters placement/yaw/scale).

// Job index → family (SPEC §6 order: 0 FARMER · 1 HERBALIST · 2 MINER).
const JOB_KEYS = /** @type {const} */ (['farmer', 'herbalist', 'miner'])
// Design ruling 2026-07-12: a node must READ as a desirable landmark, distinctly TALLER/punchier than ambient decoration.
// Wheat sheaves clear the tallest ambient grass (tall_grass 2.2, grass_tuft 1.4) so a crop stand towers over the
// meadow; herbs rise above the ground carpet; ore stays a low mineral knuckle (its punch is the crystal colour).
// WIDTH (thinner wheat branches — they read melted together otherwise): wheat cards are TALL-NARROW
// blade billboards (width ≪ height — the grass idiom) so a stand reads as INDIVIDUAL thin stalks, never a wide
// h×h square that melts into a solid rectangle. herb/ore omit `width` → it defaults to the height (their existing
// square cards, byte-unchanged): a shroom/orchid/rock is a compact shape, not a blade.
const FAMILY = {
  farmer: { family: 'wheat', h: 2.6, width: 1.25, sway: 0.06, rock: false, cards: 5 }, // 5 tall-narrow blades = a grain stand ABOVE tall_grass, sways strongest
  herbalist: { family: 'herb', h: 1.2, sway: 0.035, rock: false, cards: 3 }, // 3 leafy plants above the ambient carpet, mild sway
  miner: { family: 'ore', h: 0.95, sway: 0, rock: true, cards: 3 }, // 3 crystal clumps on a rock, static
}
const APEX_TIER = 11 // the level-100 apex of each family gets the sanctioned rare glow (the world's richest nodes)

/**
 * PURE identity+visual resolver for a resource node — the ONE map from a chain ResourceSpawn's (job, tier) to
 * its gatherable identity (via the @aresrpg/sdk/jobs roster — one home) plus the family silhouette params. The
 * cluster height grows modestly with tier (a grander apex node — the 11 tiers differ by height as well as the
 * per-id hue resolved at build). Headless-testable (no three): tests assert every (job 0-2 × tier 1-11) resolves.
 * @param {number} job 0 farmer · 1 herbalist · 2 miner
 * @param {number} tier 1-11 (the resource's level band)
 * @returns {{ id:string, name:string, job_key:string, family:string, h:number, w:number, sway:number, rock:boolean, cards:number, is_apex:boolean }}
 */
export function resource_visual(job, tier) {
  const job_key = JOB_KEYS[Math.max(0, Math.min(2, Number(job) | 0))]
  const t = Math.max(1, Math.min(11, Number(tier) | 0))
  const roster = GATHER_RESOURCES[job_key] ?? []
  const res = roster.find((r) => r.tier === t) ?? roster[0] ?? { id: 'wheat', name: 'Resource' }
  const fam = FAMILY[job_key]
  const h = fam.h * (0.85 + 0.15 * (t / 11)) // taller toward the apex — height is a per-tier signal too, not just hue
  return {
    id: res.id,
    name: res.name,
    job_key,
    family: fam.family,
    h,
    w: fam.width ?? h, // card WIDTH — wheat is a fixed-narrow blade (tall-narrow stand); herb/ore default to h (square, unchanged)
    sway: fam.sway,
    rock: fam.rock,
    cards: fam.cards, // billboards in the per-node stand (wheat 5 · herb/ore 3) — a lone card reads small/alone
    is_apex: t === APEX_TIER,
  }
}

// SHARED, page-lifetime GPU resources — a patch only BORROWS these (REMOVE-ONLY teardown; disposing a shared
// buffer would free geometry live patches still share). Procedural sprite textures are cached per id; the
// crossed geometry per family height; the ore rock, the apex halo + the magical glow halos are one shared each.

/** id → the procedural sprite DataTexture (synthesized ONCE via synth_gather_buffer, shared across every node of
 *  that id). The op paints the ground-anchored base at the LAST row, so a vertical row-flip lands the base on the
 *  quad's bottom edge — done here (robust across WebGPU/WebGL; DataTexture ignores `flipY`). Caches the MISS
 *  (null) too so an unknown id (drifted chain row) logs once, then renders untextured.
 *  @type {Map<string, import('three').DataTexture | null>} */
const _synth_cache = new Map()
const synth_tex = (/** @type {string} */ id) => {
  if (_synth_cache.has(id)) return _synth_cache.get(id) ?? null
  const buf = synth_gather_buffer(id)
  if (!buf) {
    _synth_cache.set(id, null)
    game_log('gather', `no procedural sprite for "${id}" — node renders untextured`)
    return null
  }
  const { data, size } = buf
  const row = size * 4
  const flipped = new Uint8Array(data.length)
  for (let y = 0; y < size; y += 1) flipped.set(data.subarray((size - 1 - y) * row, (size - y) * row), y * row)
  const tex = new DataTexture(flipped, size, size, RGBAFormat, UnsignedByteType)
  tex.colorSpace = SRGBColorSpace // the sprite hues are authored sRGB — decode correctly so they match the ramp
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.generateMipmaps = true // a clean 25 m read (no blade/facet shimmer at distance)
  tex.needsUpdate = true
  _synth_cache.set(id, tex)
  return tex
}

/** @type {Map<string, import('three').BufferGeometry>} */
const _cross_geo = new Map()
const cross_geo = (/** @type {number} */ w, /** @type {number} */ h) => {
  const key = `${Math.round(w * 100) / 100}:${Math.round(h * 100) / 100}` // per-tier w/h are fractional — key on both
  let g = _cross_geo.get(key)
  if (!g) {
    const a = new PlaneGeometry(w, h) // WIDTH ≪ height for wheat = a tall-narrow blade (grass idiom); w=h for herb/ore (square)
    const b = new PlaneGeometry(w, h)
    b.rotateY(Math.PI / 2) // two perpendicular quads = a cross-billboard that reads from every angle
    g = mergeGeometries([a, b], false)
    g.translate(0, h / 2, 0) // base at y=0 so the cluster sits ON the ground (group.y = the seat)
    _cross_geo.set(key, g)
  }
  return g
}
const ROCK_GEO = new BoxGeometry(0.3, 0.24, 0.3)
const ROCK_MAT = new MeshBasicMaterial({ color: 0x45454d, toneMapped: false }) // dark stone (unlit world-prop pattern)
const ROCK_BASE = [0x45 / 255, 0x45 / 255, 0x4d / 255] // ROCK_MAT's day colour — night-dimmed (× gather_night_tint) in tick
const HALO_GEO = new SphereGeometry(0.7, 12, 12)
// sanctioned rare glow: warm gold (GLOW.gold ≈ [255,214,120]), ADDITIVE, opacity capped LOW so albedo+glow stays
// under the 2.05 bloom threshold at MEDIUM (the no-white-halo law) — a soft self-glow, never a bloom bulb.
const HALO_MAT = new MeshBasicMaterial({
  color: 0xffd678,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
})
// Magical (non-apex) self-glow halos — a smaller additive bulb hued by the id's CAPPED glow (node_glow — already
// under the luma ceiling). ONE shared material per distinct hue (mirrors HALO_MAT), pulsed globally, REMOVE-ONLY.
const GLOW_GEO = new SphereGeometry(0.42, 10, 10)
/** @type {Map<string, import('three').MeshBasicMaterial>} */
const _glow_mats = new Map()
const glow_mat = (/** @type {number[]} */ rgb) => {
  const key = `${rgb[0]},${rgb[1]},${rgb[2]}`
  let m = _glow_mats.get(key)
  if (!m) {
    m = new MeshBasicMaterial({
      color: (rgb[0] << 16) | (rgb[1] << 8) | rgb[2],
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    })
    _glow_mats.set(key, m)
  }
  return m
}

// Reusable instance-matrix scratch (three.js's standard InstancedMesh composition idiom: Object3D → set
// transform → updateMatrix → setMatrixAt) — reused synchronously across every build, never held across a frame.
const _dummy = new Object3D()

// deterministic hash in [0,1) from two ints — decorrelated fold, no trig. The retired gather_patch.js's ONE
// surviving fact (grow_patch/cluster_count died with the client-side field growth — see the file banner);
// still needed here for each node's own organic position/yaw/scale jitter (single instance, seeded off spawn_id
// so a refresh/re-poll/second client always renders the IDENTICAL wobble).
const ghash = (/** @type {number} */ a, /** @type {number} */ b) => {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 2654435761) ^ Math.imul((b + 1) >>> 0, 40503)
  h ^= h >>> 15
  return (h >>> 0) / 4294967295
}

/**
 * The gather-node rig layer, bound to one world_spawns instance's engine + ground oracle (`sample` — the same
 * one create_rig_layer gets). Mirrors create_rig_layer's shape. Returns { build, sway, apply_state, tick, teardown }.
 * @param {{ engine: any, sample: (x:number,y:number,z:number)=>number }} deps
 */
export function create_gather_layer({ engine, sample }) {
  // NIGHT DIM — the gatherable sprite is an UNLIT MeshBasicMaterial(toneMapped:false) so it never took the
  // day/night term terrain/water take, and used to glow at night. The final sprite albedo multiply = the depletion tint
  // (white / gray) × the shared night dim `_tod_dim` (= gather_night_tint(engine.day_factor) — the ONE home, the same
  // sky_day_factor the near water reflects). Composed in `recolor` so both writers agree: apply_state (on depletion
  // change) and sway (every frame, for the live tod). tick refreshes `_tod_dim` + the shared ore-rock material.
  let _tod_dim = 1
  const recolor = (/** @type {any} */ e) => {
    if (e.mat) e.mat.color.setScalar((e._depl ?? 1) * _tod_dim)
  }
  // Depletion is now a PURE cosmetic wilt (tint/opacity/droop by ratio-vs-max-seen) — the instance-count-per-
  // remaining mechanic is gone (client rider: the chain owns field shape, one row is always one plant). A
  // NEW-model row (remaining pinned at 1 until the whole row vanishes from /v1) never dips below ratio=1, so
  // this never fires for it; a LEGACY multi-charge row still wilts as it's harvested down, same as before.
  // Idempotent; called on build + on remaining-change.
  const apply_state = (/** @type {any} */ e) => {
    const rem = Number(e.row.remaining) || 0
    e.max_seen = Math.max(e.max_seen || 1, rem)
    const ratio = Math.max(0, Math.min(1, rem / (e.max_seen || 1)))
    // Thin the visible cards as a LEGACY multi-charge node is harvested down (a NEW-model remaining:1 row keeps
    // ratio=1 ⇒ full stand, never thins). InstancedMesh.count caps the draw to the first `shown` instances.
    const cap = e.cap || 1
    const shown = ratio > 0.66 ? cap : ratio > 0.33 ? Math.max(2, cap - 1) : Math.max(1, cap - 2)
    if (e.inst) e.inst.count = shown
    if (e.inst_rock) e.inst_rock.count = shown
    const depleted = ratio <= 0.34
    if (e.mat) {
      e._depl = depleted ? 0x8c / 0xff : 1 // depletion gray-multiply (0x8c8c8c) vs full colour — composed with _tod_dim
      e.mat.opacity = depleted ? 0.85 : 1
      recolor(e) // apply depletion × the current night dim
    }
    if (e.glow) e.glow.visible = !depleted // a wilted node stops glowing
    if (e.mesh) e.mesh.scale.y = depleted ? 0.82 : 1 // droop the wilted patch
    e.applied_remaining = rem
  }

  const build = (/** @type {any} */ e) => {
    const v = resource_visual(Number(e.row.job) || 0, Number(e.row.tier) || 1)
    e.visual = v
    e.max_seen = Number(e.row.remaining) || 1
    const seed = Number(e.row.spawn_id) || 0
    const grp = new Group()
    grp.position.set(e.cx, e.cy, e.cz)
    // ONE material per node (so a depleted tint is per-node), mapped with the SHARED cached procedural sprite.
    const mat = new MeshBasicMaterial({ transparent: true, alphaTest: 0.42, side: DoubleSide, toneMapped: false })
    const tex = synth_tex(v.id) // procedural — synchronous, no async icon fetch, no white-quad flash
    if (tex) mat.map = tex
    const geo = cross_geo(v.w, v.h)

    // PER-NODE STAND (acceptance surface — gather_demo.js): a gather node reads as a small
    // cluster of `v.cards` billboards (wheat 5 tall-narrow blades · herb/ore 3), NEVER a lone card — a single
    // blade reads "smaller / floating / alone" on its own. The K-adjacent-chain-cell FIELD
    // (zones.move grow_cluster) COMPOSES with this — each cell is one stand → a lush field; it does not replace
    // the stand. Cards spread golden-angle over a ≤0.46-block radius, each a hashed yaw + scale (seeded off
    // spawn_id → identical across refreshes / a second client). One InstancedMesh(count=cards) keeps geometry/
    // material on the shared-cache + REMOVE-ONLY teardown contract; the anchor is already ground-seated (e.cy).
    const cards = Math.max(1, v.cards | 0)
    const inst = new InstancedMesh(geo, mat, cards)
    const inst_rock = v.rock ? new InstancedMesh(ROCK_GEO, ROCK_MAT, cards) : null // ore: a rock knuckle under each crystal
    for (let i = 0; i < cards; i += 1) {
      const ang = ghash(seed, 99) * Math.PI * 2 + i * 2.399963 // golden-angle even spread + hashed start
      const rr = 0.16 + 0.3 * ghash(seed, i * 7 + 1) // 0.16-0.46 block radius (poisson-ish, no overlap pile)
      _dummy.position.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr)
      _dummy.rotation.set(0, ghash(seed, i * 13 + 3) * Math.PI, 0) // per-card yaw so the crosses never align
      _dummy.scale.setScalar(0.82 + 0.32 * ghash(seed, i * 5 + 2)) // size jitter
      _dummy.updateMatrix()
      inst.setMatrixAt(i, _dummy.matrix)
      if (inst_rock) {
        _dummy.position.set(Math.cos(ang) * rr * 0.6, 0, Math.sin(ang) * rr * 0.6) // rock hugs the crystal base
        _dummy.rotation.set(0, ghash(seed, i * 9 + 31) * Math.PI, 0)
        _dummy.scale.setScalar(0.7 + 0.6 * ghash(seed, i * 4 + 17))
        _dummy.updateMatrix()
        inst_rock.setMatrixAt(i, _dummy.matrix)
      }
    }
    inst.instanceMatrix.needsUpdate = true
    if (inst_rock) inst_rock.instanceMatrix.needsUpdate = true
    e.cap = cards // pristine card ceiling — apply_state thins the shown count as a LEGACY node depletes
    grp.add(inst)
    if (inst_rock) grp.add(inst_rock)

    // self-glow: the apex tier → the sanctioned gold halo; else a magical id → its capped hued halo (or none).
    let glow_node = v.is_apex ? new Mesh(HALO_GEO, HALO_MAT) : null
    if (!glow_node) {
      const g = node_glow(v.id)
      if (g) glow_node = new Mesh(GLOW_GEO, glow_mat(g))
    }
    if (glow_node) {
      glow_node.position.y = v.h * 0.45 // seat the bulb within the plant, not underground
      grp.add(glow_node)
    }
    e.mesh = grp
    e.mat = mat
    e.inst = inst
    e.inst_rock = inst_rock
    e.glow = glow_node
    engine.add_to_scene(grp)
    apply_state(e)
  }

  // Per-node base-anchored breeze (wheat/herb only; ore's sway is 0 so its rock stays put). Leaning the whole
  // cluster from its ground origin is the cheap CPU stand-in for the engine's cross-billboard wind vertex; the
  // amplitude reads the SHARED GUST (advanced in tick) so a field swells + calms together with the world's wind
  // and any GUST-reading motes, never a flat monotonous sine. Reads fine at gather distance.
  const sway = (/** @type {any} */ e, /** @type {number} */ t) => {
    recolor(e) // NIGHT DIM per node, every frame (BEFORE the sway early-return so ore — sway 0 — is dimmed too)
    const s = e.visual?.sway
    if (!s || !e.mesh) return
    const g = GUST.value // shared breathing gust in [0.55, 1.6], mean ≈ 1.0 (×g is neutral at rest)
    e.mesh.rotation.z = Math.sin(t * 1.4 + e.cx) * s * g
    e.mesh.rotation.x = Math.sin(t * 1.1 + e.cz) * s * 0.6 * g
  }

  // Frame driver: advance the SHARED wind gust once (the single-CPU-gust-value seam — particles/motes read the
  // same handle), then pulse the shared apex + magical glow materials (kept well under bloom).
  let _last_t = 0
  const tick = (/** @type {number} */ t) => {
    const dt = _last_t ? Math.min(0.1, t - _last_t) : 0
    _last_t = t
    advance_gust(dt)
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.8)
    HALO_MAT.opacity = 0.12 + 0.07 * pulse
    for (const m of _glow_mats.values()) m.opacity = 0.08 + 0.06 * pulse // gentle magical pulse
    // NIGHT DIM: refresh the shared gather day/night multiply off the engine's live sky level (gather_night_tint —
    // the ONE home, the same sky_day_factor the near water reflects). sway() applies it per node; the SHARED ore-rock
    // material is dimmed here (all rocks share tod). The apex gold halo + magical glow are LEFT at full — legit
    // self-glow reads AT night by design (cf. the lantern, whose local light is not touched by this global dim).
    _tod_dim = gather_night_tint(engine.day_factor?.() ?? 1)
    ROCK_MAT.color.setRGB(ROCK_BASE[0] * _tod_dim, ROCK_BASE[1] * _tod_dim, ROCK_BASE[2] * _tod_dim)
  }

  const teardown = (/** @type {any} */ e) => {
    if (e.mesh) {
      try {
        engine.remove_from_scene(e.mesh) // REMOVE-ONLY — geo/tex/rock/halo/glow are shared, page-owned
      } catch {
        /* already gone */
      }
      e.mesh = null
    }
    e.inst?.dispose() // frees THIS node's own instance buffer only — shared geo/mat untouched (three@0.185.1 verified)
    e.inst_rock?.dispose()
    e.inst = null
    e.inst_rock = null
    if (e.mat) {
      e.mat.dispose() // the per-node material IS ours (the sprite texture it references is the shared cache — untouched)
      e.mat = null
    }
    e.glow = null
  }

  return { build, sway, apply_state, tick, teardown }
}
