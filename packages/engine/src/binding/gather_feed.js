// SEAM 3 — SPAWN GLOW + GATHER AFFORDANCE FEED (SPEC §5 wayfinding + §6 gathering).
//
// "discovered resources render with a glowing outline; close enough shows 'press F to gather' — or 'equip
// [tool] to gather' if the matching job tool isn't equipped." The app pushes the zone's spawn data into
// this feed (resource nodes + mob groups, each with x/z + a template id); the engine renders a glowing
// ground-ring outline at every node's canonical ground height (the Y-oracle, seam 1), pulses it, and
// reports gather PROXIMITY — the engine emits WHICH resource is in reach + how close; the TWO-state
// tool/no-tool copy is the app's call (the engine has no inventory awareness). Data-driven, no chain
// awareness.
//
// GLOW MATERIAL — house AgX-survival law (mana_barrier.js / title_aura.js / board_vfx.js): the engine
// tone-maps through AgX which crushes ADDITIVE brights to nothing, so glow uses NORMAL blending +
// toneMapped=false + a bright colour, pulsed via opacity/scale. Nothing existing was a drop-in "glow at an
// arbitrary world point" (board_highlights is board-cell-locked; board_vfx is a 0.7 s one-shot), so this
// is the lightest new primitive: a flat ring mesh laid on XZ, added to one Group via engine.add_to_scene.

import { Group, Mesh, RingGeometry, MeshBasicMaterial, Color, DoubleSide } from 'three'

import { ground_height } from './ground_height.js'

/** Blocks within which a resource shows the gather affordance (SPEC §6 "close enough"). */
export const GATHER_RANGE_DEFAULT = 6
const RESOURCE_COLOR = 0x8cf7b0 // gather-green outline
const MOB_COLOR = 0xff6f6f // hostile-red marker (mob groups are a fight-start, not a gather — SPEC §7)
const RING_INNER = 0.9
const RING_OUTER = 1.35
const RING_SEGMENTS = 40
const PULSE_SPEED = 2.4 // rad/s of the glow breathe

/** @typedef {{ id: string, x: number, z: number, template_id?: string|number, kind?: string }} SpawnNode */

/**
 * The nearest node within `range` blocks of (px, pz), or null. Pure — exported for headless proximity
 * tests + reuse. @param {SpawnNode[]} nodes @param {number} px @param {number} pz @param {number} range
 * @returns {{ node: SpawnNode, distance: number } | null}
 */
export function nearest_within(nodes, px, pz, range) {
  let best = null
  let best_d = Infinity
  for (const n of nodes) {
    const d = Math.hypot(n.x - px, n.z - pz)
    if (d <= range && d < best_d) {
      best = n
      best_d = d
    }
  }
  return best ? { node: best, distance: best_d } : null
}

/**
 * Create the spawn-glow + gather-affordance feed bound to an engine.
 * @param {object} args
 * @param {import('../engine.js').EngineApi} args.engine the engine handle (scene seam)
 * @param {import('../config/world_gen_config.js').WorldGenConfig} [args.world_config] the world recipe
 *   (grounds each marker via the Y-oracle). Defaults to the engine's default recipe.
 * @param {() => [number, number] | [number, number, number] | null} [args.get_player_position] pulled
 *   each tick for proximity; falls back to the last `set_player_position`.
 * @param {number} [args.gather_range] affordance range in blocks (default 6).
 */
export function create_gather_feed({ engine, world_config, get_player_position, gather_range = GATHER_RANGE_DEFAULT }) {
  const group = new Group()
  group.name = 'gather_feed'
  engine.add_to_scene(group) // silent no-op pre-boot; the engine flushes it on boot

  /** @type {{ id: string, node: SpawnNode, mesh: Mesh }[]} live glow markers (resources + mob groups). */
  let markers = []
  /** @type {SpawnNode[]} */
  let resources = []
  /** @type {SpawnNode[]} */
  let mob_groups = []
  const player_xz = /** @type {[number, number]} */ ([0, 0])
  /** id of the resource currently in gather range (drives enter/leave emission). @type {string | null} */
  let affordance_id = null
  let clock = 0
  let raf = /** @type {number | null} */ (null)
  let last_frame_at = 0

  /** @type {Map<string, Set<(payload: unknown) => void>>} */
  const listeners = new Map()
  const emit = (/** @type {string} */ ev, /** @type {unknown} */ p) => {
    for (const cb of listeners.get(ev) ?? []) cb(p)
  }

  const make_marker = (/** @type {SpawnNode} */ node, /** @type {number} */ color) => {
    const geo = new RingGeometry(RING_INNER, RING_OUTER, RING_SEGMENTS)
    geo.rotateX(-Math.PI / 2) // lie flat on the ground (XZ plane)
    const mat = new MeshBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false, // AgX-survival law — bright, un-tonemapped, NORMAL blend (the default)
    })
    const mesh = new Mesh(geo, mat)
    // ground each marker on the canonical surface (seam 1); +0.06 lifts it off z-fighting the terrain top.
    mesh.position.set(node.x, ground_height(world_config, node.x, node.z) + 0.06, node.z)
    mesh.renderOrder = 970
    return mesh
  }

  const clear_markers = () => {
    for (const m of markers) {
      group.remove(m.mesh)
      m.mesh.geometry.dispose()
      const mat = /** @type {MeshBasicMaterial} */ (m.mesh.material)
      mat.dispose()
    }
    markers = []
  }

  /** Rebuild the glow markers from the pushed spawn set (called on discovery — infrequent). */
  const rebuild = () => {
    clear_markers()
    for (const node of resources) {
      const mesh = make_marker(node, RESOURCE_COLOR)
      group.add(mesh)
      markers.push({ id: node.id, node, mesh })
    }
    for (const node of mob_groups) {
      const mesh = make_marker(node, MOB_COLOR)
      group.add(mesh)
      markers.push({ id: node.id, node, mesh })
    }
  }

  /** Advance the pulse + recompute gather proximity; emit on the in-range resource CHANGING. */
  const tick = (/** @type {number} */ dt) => {
    clock += dt
    const pulse = 0.5 + 0.5 * Math.sin(clock * PULSE_SPEED)
    const opacity = 0.55 + 0.35 * pulse
    const scale = 1 + 0.08 * pulse
    for (const m of markers) {
      const mat = /** @type {MeshBasicMaterial} */ (m.mesh.material)
      mat.opacity = opacity
      m.mesh.scale.setScalar(scale)
    }
    const pos = get_player_position?.()
    if (pos) {
      const [px] = pos
      player_xz[0] = px
      player_xz[1] = pos.length === 3 ? pos[2] : pos[1]
    }
    const near = nearest_within(resources, player_xz[0], player_xz[1], gather_range)
    const next_id = near?.node.id ?? null
    if (next_id !== affordance_id) {
      affordance_id = next_id
      // Engine reports proximity + which node; the app maps to "press F" vs "equip [tool]" (its inventory).
      emit(
        'gather_affordance',
        near ? { node: near.node, distance: near.distance } : { node: null, distance: Infinity }
      )
    }
  }

  const has_animation_work = () => resources.length > 0 || markers.length > 0

  const disarm_animation = () => {
    if (raf !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf)
    raf = null
    last_frame_at = 0
  }

  const loop = (/** @type {number} */ now) => {
    raf = null
    if (!has_animation_work()) {
      last_frame_at = 0
      return
    }
    const dt = last_frame_at ? Math.min(0.1, (now - last_frame_at) / 1000) : 1 / 60
    last_frame_at = now
    tick(dt)
    if (has_animation_work() && raf === null) raf = requestAnimationFrame(loop)
  }

  const sync_animation = () => {
    if (!has_animation_work()) {
      disarm_animation()
      return
    }
    if (raf === null && typeof requestAnimationFrame !== 'undefined') {
      last_frame_at = 0
      raf = requestAnimationFrame(loop)
    }
  }

  return {
    /** Replace the pushed spawn set (call on discovery / refresh). @param {{ resources?: SpawnNode[], mob_groups?: SpawnNode[] }} spawns */
    set_spawns(spawns) {
      resources = spawns?.resources ?? []
      mob_groups = spawns?.mob_groups ?? []
      rebuild()
      affordance_id = null // recompute against the new set on the next tick
      sync_animation()
    },
    /** Push the player's world position for proximity (alternative to the get_player_position callback).
     *  @param {[number, number] | [number, number, number]} p */
    set_player_position(p) {
      const [px] = p
      player_xz[0] = px
      player_xz[1] = p.length === 3 ? p[2] : p[1]
    },
    /** Manually advance one frame (browser drives this internally; tests call it). @param {number} dt seconds */
    tick,
    /** Subscribe to 'gather_affordance' — payload { node: SpawnNode|null, distance }. @returns {() => void} unsubscribe */
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)?.add(cb)
      return () => listeners.get(event)?.delete(cb)
    },
    get_resources: () => resources,
    get_mob_groups: () => mob_groups,
    _marker_count: () => markers.length,
    dispose() {
      disarm_animation()
      clear_markers()
      engine.remove_from_scene(group)
      listeners.clear()
    },
  }
}
