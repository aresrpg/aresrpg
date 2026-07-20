// FIRST-LOAD "materialization floor" (target: "shader/effects to have a loading feel without blocking
// player movements"). A brand-styled holo grid — near-black fill + gold scanline grid (DESIGN.md:
// bg #0a0a0f, gold #c8963c) — that hugs the generator's ANALYTIC surface, follows the player, and shows
// ONLY over columns the near ring hasn't drawn yet: it sits ~2 m BELOW the true surface so loaded voxel
// terrain occludes it by depth, and the near ring's rendered-column count fades + kills it once the
// player's neighborhood is covered. It exists from frame 1 (under the boot veil) and dies with zero
// steady-state cost (visible=false, no per-frame work) — the loading feel, never a permanent draw.
//
// One mesh at world identity: the plane geometry holds ABSOLUTE world coords (rebuilt only when the
// player crosses a grid cell — no per-frame noise storm), y = analytic surface − DEPTH. The grid lines,
// scanline, radial rim-fade and glow-pulse are procedural in a MeshBasicNodeMaterial colorNode (positionWorld
// XZ = world-locked lines, so the grid never swims). No lighting, no shadow — a pure holo overlay.

import { Mesh, PlaneGeometry, DoubleSide, AdditiveBlending, Vector2 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { Fn, positionWorld, uniform, vec3, vec4, float, sin, fract, abs, max, smoothstep, length } from 'three/tsl'

/** Plane half-extent in chunks (~3-chunk radius = 96 m half → 192 m span). Covers the focus neighborhood. */
const RADIUS_CHUNKS = 3
const CHUNK_M = 32
const SIZE_M = 2 * RADIUS_CHUNKS * CHUNK_M // 192 m
const SEGMENTS = 16 // 12 m/segment — coarse holo grid; 289 verts, re-sampled only on cell crossings
const SEG_M = SIZE_M / SEGMENTS
const DEPTH_BELOW = 2.0 // sit this far under the analytic surface so loaded voxel terrain occludes the plane
const GRID_CELL_M = 4.0 // gold grid-line spacing (world-locked)
/** Rendered-column coverage that kills the floor: the (2r+1)² footprint of the plane radius (nearest-first
 *  streaming fills the disc, so this many drawn columns ≈ the neighborhood is covered). */
const COVER_COLUMNS = (2 * RADIUS_CHUNKS + 1) ** 2 // 49
const FADE_PER_SEC = 2.5 // death fade (≈0.4 s) once covered
const HARD_KILL_MS = 14_000 // safety: never linger past the boot window even if streaming stalls

const GOLD = /** @type {[number, number, number]} */ ([0.78, 0.59, 0.235]) // #c8963c
const BG = /** @type {[number, number, number]} */ ([0.04, 0.04, 0.06]) // #0a0a0f-ish

/**
 * @param {object} opts
 * @param {import('three').Scene} opts.scene render scene (renderer_handle.scene)
 * @param {(x: number, z: number) => number} opts.surface_height analytic surface-y oracle (world_surface_y —
 *   pure gen math, no residency) so the floor hugs the terrain that is about to stream in.
 * @returns {{ update: (px: number, pz: number, rendered_columns: number, dt: number) => void, dispose: () => void }}
 */
export function create_materialization_floor({ scene, surface_height }) {
  const u_center = uniform(new Vector2(0, 0)) // plane centre (player) — radial rim-fade origin
  const u_time = uniform(0) // glow-pulse / scanline clock
  const u_fade = uniform(1) // global fade (1 alive → 0 dead)

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false, // holo overlay: loaded opaque terrain (depthTest) occludes it; never writes depth
    side: DoubleSide,
    blending: AdditiveBlending, // gold-on-dark holo glow
  })
  material.colorNode = Fn(() => {
    const p = positionWorld.xz
    // world-locked grid lines (antialiased-ish via a thin smoothstep band around each cell edge)
    const c = p.div(float(GRID_CELL_M))
    const fx = abs(fract(c.x).sub(float(0.5)))
    const fz = abs(fract(c.y).sub(float(0.5)))
    const line = max(smoothstep(float(0.46), float(0.5), fx), smoothstep(float(0.46), float(0.5), fz))
    // subtle horizontal scanline sweeping in Z (brand CRT grammar) + a slow glow-pulse
    const scan = sin(p.y.mul(float(0.6)).add(u_time.mul(float(2.2))))
      .mul(float(0.5))
      .add(float(0.5))
    const pulse = sin(u_time.mul(float(1.6)))
      .mul(float(0.15))
      .add(float(0.85))
    // radial rim-fade so the holo dissolves into the fog at its edge instead of a hard square lip
    const d = length(p.sub(u_center))
    const radial = smoothstep(float(SIZE_M * 0.5), float(SIZE_M * 0.34), d)
    const grid_glow = line.mul(scan.mul(float(0.6)).add(float(0.4)))
    const color = vec3(BG[0], BG[1], BG[2]).add(vec3(GOLD[0], GOLD[1], GOLD[2]).mul(grid_glow))
    const alpha = grid_glow.mul(float(0.9)).add(float(0.06)).mul(radial).mul(pulse).mul(u_fade)
    return vec4(color, alpha)
  })()

  const geometry = new PlaneGeometry(SIZE_M, SIZE_M, SEGMENTS, SEGMENTS)
  geometry.rotateX(-Math.PI / 2) // XY plane → horizontal XZ
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false // geometry holds absolute world coords (rebuilt on cell crossings)
  mesh.renderOrder = -1 // draw before other transparents (it lives beneath the terrain)
  scene.add(mesh)

  const pos = /** @type {Float32Array} */ (geometry.attributes.position.array)
  const vert_count = pos.length / 3
  // Snapshot the centred base XZ ONCE (PlaneGeometry local coords span [-SIZE/2, SIZE/2]); world coords
  // are always base + centre, so re-centring never accumulates float drift.
  const base_x = new Float32Array(vert_count)
  const base_z = new Float32Array(vert_count)
  for (let i = 0; i < vert_count; i += 1) {
    base_x[i] = pos[i * 3]
    base_z[i] = pos[i * 3 + 2]
  }
  let last_cx = NaN
  let last_cz = NaN
  let alive = true
  let covered = false
  let elapsed = 0

  /** Rebuild absolute world coords for the plane snapped to `cx,cz` — world = base + centre, y = analytic
   *  surface − DEPTH (grid-aligned so the lines never swim; only on a cell crossing). */
  const rebuild = (/** @type {number} */ cx, /** @type {number} */ cz) => {
    for (let i = 0; i < vert_count; i += 1) {
      const wx = base_x[i] + cx
      const wz = base_z[i] + cz
      pos[i * 3] = wx
      pos[i * 3 + 2] = wz
      pos[i * 3 + 1] = surface_height(wx, wz) - DEPTH_BELOW
    }
    geometry.attributes.position.needsUpdate = true
    geometry.computeBoundingSphere()
  }

  return {
    /**
     * Per-frame drive from engine.js: re-centre on the player, fade+die once the ring covers the
     * neighborhood. Zero work once dead.
     * @param {number} px @param {number} pz player world XZ
     * @param {number} rendered_columns ring.rendered_column_count()
     * @param {number} dt seconds
     */
    update(px, pz, rendered_columns, dt) {
      if (!alive) return
      elapsed += dt * 1000
      u_time.value += dt
      // snap the centre to the grid so the world-locked lines don't jitter as the player walks
      const cx = Math.round(px / SEG_M) * SEG_M
      const cz = Math.round(pz / SEG_M) * SEG_M
      if (cx !== last_cx || cz !== last_cz) {
        rebuild(cx, cz)
        last_cx = cx
        last_cz = cz
      }
      u_center.value.set(cx, cz)

      // death: the near ring has drawn enough columns to cover the plane footprint (or the safety window
      // elapsed). Fade out, then stop all work (visible=false) — zero steady-state cost.
      if (!covered && (rendered_columns >= COVER_COLUMNS || elapsed >= HARD_KILL_MS)) covered = true
      if (covered) {
        u_fade.value = Math.max(0, u_fade.value - FADE_PER_SEC * dt)
        if (u_fade.value <= 0) {
          mesh.visible = false
          alive = false
        }
      }
    },
    dispose() {
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
      alive = false
    },
  }
}
