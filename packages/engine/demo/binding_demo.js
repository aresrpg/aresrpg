// S-17a — WORLD BINDING SEAMS demo harness (binding.html). Boots the REAL engine and drives the two
// render-bound seams behind ?seam= flags (defaults-off, engine worker law):
//   ?seam=glow   → create_gather_feed: glowing ground-ring outlines on resource nodes + the gather
//                  proximity affordance (SPEC §5/§6).
//   ?seam=phase  → create_entity_visibility: register a few dummy "remote" entities, then phase a subset
//                  out of the world view WITHOUT despawn (SPEC §7). Press H to toggle.
//   ?seam=all    → both.
// Exposes window.__binding (+ window.__engine) so the bench/screenshot driver reads readiness, drives the
// pose, and toggles the phase-out. This exercises the REAL seam code — not a demo re-implementation.

import { Mesh, BoxGeometry, MeshBasicMaterial, Color } from 'three'

import {
  create_engine,
  DEFAULT_WORLD_GEN_CONFIG,
  create_gather_feed,
  create_entity_visibility,
  ground_height,
} from '../src/engine.js'

/** The demo cluster centre — a dry, flat spawn-area column (ground ≈146, well above sea) the camera
 *  frames so the flat ring markers + phase-out entities sit on clearly-visible land. */
const CENTER = /** @type {[number, number]} */ ([40, -100])
const CFG = DEFAULT_WORLD_GEN_CONFIG

/**
 * @param {HTMLCanvasElement} canvas @param {HTMLDivElement} gate @param {HTMLDivElement} hud
 * @param {URLSearchParams} params
 */
export async function boot_binding_demo(canvas, gate, hud, params) {
  gate.dataset.hidden = 'false'
  const seam = params.get('seam') || 'none'
  const want_glow = seam === 'glow' || seam === 'all'
  const want_phase = seam === 'phase' || seam === 'all'

  const tier = /** @type {any} */ (params.get('tier') || 'high')
  const engine = create_engine({
    canvas,
    tier: tier === 'auto' ? undefined : tier,
    zone_origin: CENTER,
    zone_size_m: 260,
    load_radius: 5,
  })
  const w = /** @type {any} */ (window)
  w.__engine = engine
  engine.on('boot_error', (error) => {
    gate.dataset.hidden = 'false'
    gate.textContent = `Engine not ready: ${/** @type {Error} */ (error)?.message ?? error}`
  })

  const player = /** @type {[number, number]} */ ([CENTER[0], CENTER[1]])
  let gather = /** @type {ReturnType<typeof create_gather_feed> | null} */ (null)
  const visibility = create_entity_visibility()
  /** @type {Mesh[]} */
  const peers = []
  const fight_ids = new Set(['peer-1', 'peer-2']) // the subset that phases out of the world view
  let last_affordance = /** @type {any} */ (null)

  engine.start()
  engine.set_time_of_day(0.3)

  // Wait for the spawn neighbourhood to stream in (focus_ready), with a timeout fallback so the demo
  // always proceeds even on a slow cold boot.
  await new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve(undefined)
    }
    engine.on('load_progress', (/** @type {{ phase: string }} */ p) => {
      if (p.phase === 'focus_ready' || p.phase === 'done') finish()
    })
    setTimeout(finish, 12000)
  })

  const ground = ground_height(CFG, CENTER[0], CENTER[1])

  // ── camera: a fixed vista behind + above the cluster, tilted down so the flat ring markers read as
  //    ellipses on the ground (real zoom, ~22 m back). ──
  const cam_pos = /** @type {[number, number, number]} */ ([CENTER[0] + 2, ground + 18, CENTER[1] - 22])
  const target = /** @type {[number, number, number]} */ ([CENTER[0] + 1, ground, CENTER[1] + 5])
  const { yaw, pitch } = look_at(cam_pos, target)
  const set_pose = (/** @type {[number,number,number]} */ p, /** @type {number} */ y, /** @type {number} */ pi) => {
    engine.set_camera_position(p)
    engine.set_camera_orientation(y, pi)
    engine.set_camera_fov(60)
  }

  // ── seam 3: gather glow + affordance ──
  if (want_glow) {
    gather = create_gather_feed({ engine, world_config: CFG, get_player_position: () => player })
    const resources = [
      { id: 'iron', kind: 'resource', template_id: 'iron_ore', x: CENTER[0] - 10, z: CENTER[1] + 2 },
      { id: 'copper', kind: 'resource', template_id: 'copper_ore', x: CENTER[0] - 3, z: CENTER[1] + 6 },
      { id: 'oak', kind: 'resource', template_id: 'oak_log', x: CENTER[0] + 4, z: CENTER[1] + 3 },
      { id: 'flax', kind: 'resource', template_id: 'flax', x: CENTER[0] + 11, z: CENTER[1] + 7 },
      { id: 'stone', kind: 'resource', template_id: 'granite', x: CENTER[0] + 2, z: CENTER[1] + 10 },
    ]
    const mob_groups = [
      { id: 'wolves', kind: 'mob_group', template_id: 'wolf_pack', x: CENTER[0] - 8, z: CENTER[1] + 12 },
    ]
    gather.set_spawns({ resources, mob_groups })
    gather.on('gather_affordance', (/** @type {any} */ p) => {
      last_affordance = p
    })
    // stand near the copper node so the affordance fires (proximity proof).
    player[0] = CENTER[0] - 3
    player[1] = CENTER[1] + 4
    w.__gather = gather
  }

  // ── seam 4: phase-out visibility ──
  if (want_phase) {
    const cols = [0x4a9eff, 0xff6f6f, 0xffd060, 0x8cf7b0]
    for (let i = 0; i < 4; i += 1) {
      const geo = new BoxGeometry(2, 3.4, 2)
      const mat = new MeshBasicMaterial({ color: new Color(cols[i]), toneMapped: false })
      const mesh = new Mesh(geo, mat)
      const px = CENTER[0] - 9 + i * 6
      const pz = CENTER[1] + 3
      mesh.position.set(px, ground_height(CFG, px, pz) + 1.7, pz)
      engine.add_to_scene(mesh)
      visibility.register(`peer-${i}`, mesh)
      peers.push(mesh)
    }
    w.__visibility = visibility
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') phase_out()
      if (e.code === 'KeyS') phase_in()
    })
  }

  const phase_out = () => visibility.set_visibility_filter((/** @type {string} */ id) => !fight_ids.has(id))
  const phase_in = () => visibility.clear_filter()

  gate.dataset.hidden = 'true'

  // Continuous pose hold + HUD (the fly camera re-applies the pushed pose each frame).
  let last = performance.now()
  requestAnimationFrame(function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    set_pose(cam_pos, yaw, pitch)
    if (gather) gather.tick(dt) // browser rAF also drives it; an extra tick is idempotent (state-change only)
    const phased = want_phase ? peers.filter((m) => !m.visible).length : 0
    hud.textContent = [
      `seam: ${seam}`,
      want_glow ? `gather: ${gather?._marker_count() ?? 0} markers` : null,
      want_glow
        ? `affordance: ${last_affordance?.node ? `${last_affordance.node.id} @ ${last_affordance.distance.toFixed(1)}m` : 'none'}`
        : null,
      want_phase ? `peers hidden: ${phased}/${peers.length} (H phase-out · S phase-in)` : null,
    ]
      .filter(Boolean)
      .join('\n')
    requestAnimationFrame(loop)
  })

  w.__binding = {
    get ready() {
      return true
    },
    seam,
    engine,
    gather: () => gather,
    visibility,
    peers,
    fight_ids: [...fight_ids],
    affordance: () => last_affordance,
    phase_out,
    phase_in,
    set_pose,
    ground,
  }
}

/** yaw/pitch for the fly camera to look from `from` at `to`. Fly forward = [-sin y, 0, -cos y]; pitch>0
 *  looks up. @param {[number,number,number]} from @param {[number,number,number]} to */
function look_at(from, to) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const horiz = Math.hypot(dx, dz)
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, horiz) }
}
