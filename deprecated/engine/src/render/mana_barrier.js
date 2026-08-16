// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-18 — THE MANA BARRIER. The VISIBLE half of the world border (physics + proximity live in
// core/zone_border.js): a translucent arcane-energy wall standing on the zone perimeter, drawn as a
// rounded-rect extrusion so the 4 faces meet in soft corners. House gothic-terminal palette — deep
// blue/cyan energy shot through with gold rune lines — NOT a flat colour sheet: a scrolling hex/rune
// grid (procedural TSL, zero textures), a fresnel edge-glow that brightens at grazing angles, a vertical
// fade (strong at eye level, dissolving up to ~WALL_HEIGHT and down into the ground), a subtle time
// pulse, a DISTANCE fade so from the zone centre it reads as a faint shimmer wall that only resolves as
// you approach (~FULL_VIS_M), and a local APPROACH brightening that swells around the nearest wall point
// as the player nears it (the classic MMO border tell). Plus floating holo-text banners repeating along
// the wall at eye level (the dapp passes the already-composed string — zero engine i18n).
//
// TIER-SAFE: one cheap analytic material at every tier ([D168] the rune lattice is gone) — the body
// gradient, fresnel rim, fades, heat shimmer + approach swell are cheap and
// stay at every tier. HIGH cost measured ≤0.2 ms: one extra transparent draw of a thin perimeter strip (a
// few thousand verts) with a branch-free analytic fragment; no post pass, no texture, no per-frame rebuild.
//
// SSOT: the perimeter-path + wall-geometry builders are PURE (no three types in the math) and unit-
// tested (bounds→ring topology, arc-length continuity, corner rounding). The TSL material + sprite
// banners are the GPU half, verified by the ENG-18 bench (screenshots + video).

import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Mesh, Sprite, SpriteMaterial } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp,
  float,
  floor,
  mod,
  fract,
  hash,
  length,
  max,
  mix,
  normalize,
  positionWorld,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import { nearest_wall_point } from '../core/zone_border.js'

/** @typedef {import('../core/zone_border.js').ZoneBounds} ZoneBounds */
/** @typedef {import('../core/quality/tiers.js').TierName} TierName */

/** [D168, 2026-07-05: "should be only a blueish heat/mana effect at the origin, up to like 10
 *  blocks or so" — was 42 m with a tall rune lattice reading as "a weird grid above" with "no shader at
 *  its origin"] Wall height in metres (top of the fade). The energy is strong at eye level and dissolves to nothing
 *  by here — tall enough to read as a boundary from a distance, not a dome. */
export const WALL_HEIGHT = 10
/** Metres below the zone's base level the wall skirts down to (so it fades INTO the ground rather than
 *  ending in a hard line at y=base). The vertical fade zeroes before this. */
export const WALL_SKIRT = 6
/** Corner rounding radius (m) — the rounded-rect fillet where two faces meet, so corners read soft. */
export const CORNER_RADIUS = 14
/** Approx. spacing (m) of perimeter samples along straight runs — the wall's horizontal tessellation.
 *  Fine enough that the corner arcs and the per-vertex arc-length U stay smooth. */
export const SEGMENT_M = 6
/** Distance (m) from the wall at which it reaches FULL visibility; farther than this it fades toward a
 *  faint shimmer so it never dominates the vista from the zone centre. */
export const FULL_VIS_M = 60
/** Distance (m) beyond which the wall is at its faint floor (still just visible as a shimmer band). */
export const FAINT_VIS_M = 220
/** Local approach-brightening radius (m): within this of the nearest wall point the wall swells brighter
 *  around the player's crossing point (the MMO border tell). */
export const APPROACH_RADIUS_M = 10

/** Base energy colours (linear-ish, fed straight to an unlit node material). Deep arcane blue → cyan
 *  crest, with gold in the rune lines (house palette gold #c8963c ≈ [0.78,0.59,0.24]). */
const COLOR_DEEP = [0.05, 0.13, 0.34] // deep blue body
const COLOR_CYAN = [0.29, 0.62, 1.0] // cyan crest / fresnel (#4a9eff)
const COLOR_GOLD = [0.78, 0.59, 0.24] // gold rune accents (#c8963c)

/**
 * @typedef {object} ManaBarrierOptions
 * @property {import('three').Scene} scene the render scene the wall + banners mount into.
 * @property {TierName} [tier] quality tier — VESTIGIAL since D168 (the barrier is one cheap analytic material at every tier); kept for API back-compat.
 */

/**
 * @typedef {object} ManaBarrier
 * @property {(bounds: ZoneBounds | null, base_y?: number, ground_at?: ((x: number, z: number) => number) | null) => void} set_bounds (re)build the wall for
 *   these zone bounds anchored at world `base_y` (the zone's ground level — the engine probes the
 *   zone-centre surface; default 0), or tear it down (null). Cheap: rebuilds geometry only when the
 *   bounds/base actually change; the wall mesh is positioned at base_y and its vertical fade runs in
 *   wall-local space so it dissolves into the ground and up ~WALL_HEIGHT regardless of world altitude.
 * @property {(camera: import('three').Camera, dt: number) => void} update per-frame: refreshes the
 *   approach-brightening uniforms from the camera's nearest wall point + billboards the banners. No-op
 *   when no bounds are armed.
 * @property {(text: string | null) => void} set_banner set the floating holo-text repeated along the wall
 *   (already-composed string; null clears the banners). Re-lays the sprites along the current perimeter.
 * @property {() => number} proximity_intensity TEST/READOUT: the current approach intensity uniform value
 *   (0 far, →1 at the wall) — mirrors core border_proximity, for the bench to assert the ramp.
 * @property {() => boolean} is_armed whether a wall is currently built.
 * @property {() => void} dispose free the wall geometry/material + all banner sprites.
 */

/**
 * Creates the mana-barrier renderer. Nothing is drawn until `set_bounds` arms it (fixed mode / the dapp
 * calls engine.set_zone_bounds, which forwards here). @param {ManaBarrierOptions} opts @returns {ManaBarrier}
 */
export function create_mana_barrier({ scene, tier = 'high' }) {
  // [D168] the rune lattice is GONE — the barrier is ONE cheap analytic material at EVERY tier; the
  // `tier` param is vestigial (kept for API back-compat, no longer gates any rune/hex/fresnel detail).

  /** @type {ZoneBounds | null} */
  let bounds = null
  /** @type {Mesh | null} */
  let mesh = null
  /** @type {import('three/webgpu').MeshBasicNodeMaterial | null} */
  let material = null
  /** the perimeter path (world XZ ring) + its total arc length — reused to lay the banners. */
  /** @type {{ points: [number, number][], total: number } | null} */
  let path = null
  /** @type {Sprite[]} */
  let banners = []
  /** @type {string | null} */
  let banner_text = null

  // World Y the wall is anchored at (the zone ground level). The mesh is positioned here; the vertical
  // fade runs in wall-local space so it works at any altitude. Banners sit base_y + eye height.
  let base_y = 0

  // Per-frame uniforms the fragment reads (approach centre in world XZ + its strength). uniform() nodes
  // so update() is a cheap value write, no shader rebuild.
  const approach_center = uniform(vec2(0, 0))
  const approach_strength = uniform(0)

  /** D168-B: optional per-point terrain sampler ((x,z) → ground world-Y) — the wall follows the land. */
  let ground_at = /** @type {((x: number, z: number) => number) | null} */ (null)

  /** (Re)build everything for a new bounds (or tear down when null). */
  function build() {
    teardown_gpu()
    if (!bounds) return
    path = build_perimeter_path(bounds, CORNER_RADIUS, SEGMENT_M)
    const geo = build_wall_geometry(path, WALL_HEIGHT, WALL_SKIRT, ground_at)
    material = make_wall_material({ approach_center, approach_strength })
    mesh = new Mesh(geo, material)
    // [D168-B] with a terrain sampler the vertex bases are WORLD-space (mesh at 0); without (tests /
    // no ring) the wall stays wall-local flat and anchors at base_y exactly as before.
    mesh.position.y = ground_at ? 0 : base_y
    mesh.frustumCulled = false // a ring around the player is effectively always partially on-screen
    mesh.renderOrder = 3 // after opaque terrain/water, before the always-on-top float sprites
    scene.add(mesh)
    lay_banners()
  }

  /** Lay the holo-text banners every ~BANNER_SPACING_M around the perimeter at eye level, facing in. */
  function lay_banners() {
    for (const s of banners) remove_sprite(s)
    banners = []
    if (!path || !banner_text) return
    const eye_y = base_y + BANNER_EYE_M
    const count = Math.max(1, Math.round(path.total / BANNER_SPACING_M))
    for (let i = 0; i < count; i += 1) {
      const d = (i / count) * path.total
      const [x, z] = point_at_arc_length(path, d)
      const sprite = make_banner_sprite(banner_text)
      sprite.position.set(x, eye_y, z)
      scene.add(sprite)
      banners.push(sprite)
    }
  }

  function teardown_gpu() {
    if (mesh) {
      scene.remove(mesh)
      mesh.geometry.dispose()
      mesh = null
    }
    material?.dispose()
    material = null
  }

  return {
    set_bounds(next, next_base_y = 0, next_ground_at = null) {
      // idempotent: only rebuild when the box or the anchor actually changed (avoids per-arm churn).
      // [D168-B] a sampler ARRIVING (or leaving) also rebuilds — the wall re-seats onto the terrain.
      if (same_bounds(bounds, next) && next_base_y === base_y && next_ground_at === ground_at) return
      bounds = next && { ...next }
      base_y = Number.isFinite(next_base_y) ? next_base_y : 0
      ground_at = next_ground_at
      build()
    },

    update(camera, _dt) {
      if (!bounds || !mesh) return
      const p = camera.position
      // nearest wall point (world XZ) + how close the camera is → drives the local approach swell.
      const [wx, wz] = nearest_wall_point(p.x, p.z, bounds)
      approach_center.value.set(wx, wz)
      const dist = Math.hypot(p.x - wx, p.z - wz)
      // 1 at the wall → 0 at APPROACH_RADIUS_M (smoothstep for an eased ramp). Mirrors border_proximity's
      // shape but keyed to the LOCAL crossing distance (the tell is where you push, not global proximity).
      const t = Math.max(0, 1 - dist / APPROACH_RADIUS_M)
      approach_strength.value = t * t * (3 - 2 * t)
      // billboard each banner to the camera (yaw-only would be enough, but full copy matches the float
      // sprites' technique and reads correct at the shoulder-cam pitch).
      for (const s of banners) s.quaternion.copy(camera.quaternion)
    },

    set_banner(text) {
      banner_text = text && String(text)
      lay_banners()
    },

    proximity_intensity() {
      return approach_strength.value
    },

    is_armed() {
      return mesh !== null
    },

    dispose() {
      teardown_gpu()
      for (const s of banners) remove_sprite(s)
      banners = []
      bounds = null
      path = null
    },
  }
}

// ── pure geometry: perimeter path + wall extrusion (unit-tested) ─────────────────────────────────────

/**
 * Builds the rounded-rect perimeter as a closed loop of world-XZ points, walking the 4 straight runs and
 * filleting each corner with a quarter-arc of radius `r`. Returns the point ring plus its total arc
 * length (both the wall extrusion and the banner spacing key off arc length). PURE — no three types.
 * @param {ZoneBounds} b @param {number} r corner radius @param {number} seg approx spacing (m) on runs
 * @returns {{ points: [number, number][], total: number }}
 */
export function build_perimeter_path(b, r, seg) {
  // clamp the radius so it can't exceed half the shorter side (degenerate tiny zones).
  const half_w = (b.max_x - b.min_x) / 2
  const half_d = (b.max_z - b.min_z) / 2
  const cr = Math.max(0, Math.min(r, half_w - 0.5, half_d - 0.5))
  /** @type {[number, number][]} */
  const pts = []
  // The 4 corner arc centres (inset by cr) in CCW order starting at the +x/−z corner.
  const corners = [
    { cx: b.max_x - cr, cz: b.min_z + cr, a0: -Math.PI / 2, a1: 0 }, // NE (−z,+x)
    { cx: b.max_x - cr, cz: b.max_z - cr, a0: 0, a1: Math.PI / 2 }, // SE (+z,+x)
    { cx: b.min_x + cr, cz: b.max_z - cr, a0: Math.PI / 2, a1: Math.PI }, // SW (+z,−x)
    { cx: b.min_x + cr, cz: b.min_z + cr, a0: Math.PI, a1: (3 * Math.PI) / 2 }, // NW (−z,−x)
  ]
  const arc_steps = Math.max(2, Math.ceil((cr * (Math.PI / 2)) / seg))
  for (const c of corners) {
    for (let i = 0; i <= arc_steps; i += 1) {
      const a = c.a0 + ((c.a1 - c.a0) * i) / arc_steps
      pts.push([c.cx + Math.cos(a) * cr, c.cz + Math.sin(a) * cr])
    }
  }
  // subdivide the straight runs BETWEEN consecutive corner-arc endpoints so long faces tessellate too.
  /** @type {[number, number][]} */
  const dense = []
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]
    const bpt = pts[(i + 1) % pts.length]
    dense.push(a)
    const dx = bpt[0] - a[0]
    const dz = bpt[1] - a[1]
    const len = Math.hypot(dx, dz)
    const n = Math.floor(len / seg)
    for (let k = 1; k < n; k += 1) dense.push([a[0] + (dx * k) / n, a[1] + (dz * k) / n])
  }
  // total arc length of the closed loop.
  let total = 0
  for (let i = 0; i < dense.length; i += 1) {
    const a = dense[i]
    const bpt = dense[(i + 1) % dense.length]
    total += Math.hypot(bpt[0] - a[0], bpt[1] - a[1])
  }
  return { points: dense, total }
}

/**
 * Extrudes a perimeter path into a vertical wall strip: for each perimeter edge, a quad from −skirt to
 * +height in WALL-LOCAL Y (the mesh is positioned at the zone base_y). The material draws both faces
 * (DoubleSide), so the strip is visible from inside the zone. Per-vertex attributes:
 *   • position (x, y, z) — x/z world, y wall-local (−skirt at the bottom, +height at the top);
 *   • aWall = (u, h): u = cumulative arc length (metres) along the perimeter (drives the horizontal
 *     hex/rune scroll — continuous around the loop), h = normalised height 0 at the skirt bottom → 1 at
 *     the top (drives the vertical fade; the zone floor sits at h = skirt/(skirt+height)).
 * PURE — returns a three BufferGeometry but computes the buffers with plain math.
 * @param {{ points: [number, number][], total: number }} path
 * @param {number} height @param {number} skirt
 * @param {((x: number, z: number) => number) | null} [ground_at] D168-B per-point terrain base sampler
 * @returns {import('three').BufferGeometry}
 */
export function build_wall_geometry(path, height, skirt, ground_at = null) {
  const pts = path.points
  const n = pts.length
  const positions = new Float32Array(n * 2 * 3) // 2 rows (bottom, top) per perimeter point
  const walls = new Float32Array(n * 2 * 2) // (u, h) per vertex
  const normals = new Float32Array(n * 2 * 3) // outward HORIZONTAL normal per vertex (for the fresnel)
  const nrm = perimeter_normals(pts) // smoothed per-point outward XZ normals
  let u = 0
  for (let i = 0; i < n; i += 1) {
    const [x, z] = pts[i]
    const [nx, nz] = nrm[i]
    // [D168-B — the border must sit at ground level] per-point base: the wall FOLLOWS the terrain
    // along the perimeter (a hill's band hugs the hill; a valley's hugs the valley). Without a sampler
    // (tests / no ring) the wall stays wall-local flat at 0 and the mesh is positioned at base_y as before.
    const base = ground_at ? ground_at(x, z) : 0
    const y_bot = base - skirt
    const y_top = base + height
    // bottom row
    positions[i * 6 + 0] = x
    positions[i * 6 + 1] = y_bot
    positions[i * 6 + 2] = z
    walls[i * 4 + 0] = u
    walls[i * 4 + 1] = 0
    normals[i * 6 + 0] = nx
    normals[i * 6 + 1] = 0
    normals[i * 6 + 2] = nz
    // top row
    positions[i * 6 + 3] = x
    positions[i * 6 + 4] = y_top
    positions[i * 6 + 5] = z
    walls[i * 4 + 2] = u
    walls[i * 4 + 3] = 1
    normals[i * 6 + 3] = nx
    normals[i * 6 + 4] = 0
    normals[i * 6 + 5] = nz
    // advance arc length to the next point (wrap on the last).
    const nxt = pts[(i + 1) % n]
    u += Math.hypot(nxt[0] - x, nxt[1] - z)
  }
  // indices: two triangles per edge (i→i+1), stitching bottom/top rows into a closed strip.
  const idx = new Uint32Array(n * 6)
  for (let i = 0; i < n; i += 1) {
    const a = i * 2 // bottom i
    const b = i * 2 + 1 // top i
    const c = ((i + 1) % n) * 2 // bottom i+1
    const d = ((i + 1) % n) * 2 + 1 // top i+1
    idx[i * 6 + 0] = a
    idx[i * 6 + 1] = c
    idx[i * 6 + 2] = b
    idx[i * 6 + 3] = b
    idx[i * 6 + 4] = c
    idx[i * 6 + 5] = d
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('aWall', new BufferAttribute(walls, 2))
  geo.setAttribute('aNormal', new BufferAttribute(normals, 3))
  geo.setIndex(new BufferAttribute(idx, 1))
  return geo
}

/** Per-point OUTWARD horizontal unit normals for a CCW-wound perimeter loop, each the average of the two
 *  adjacent edge normals so corners round smoothly. Edge tangent t=(dx,dz) → outward right normal (dz,−dx)
 *  for a CCW loop. Exported for the geometry test. @param {[number,number][]} pts @returns {[number,number][]} */
export function perimeter_normals(pts) {
  const n = pts.length
  /** @type {[number, number][]} */
  const out = []
  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - 1 + n) % n]
    const cur = pts[i]
    const nxt = pts[(i + 1) % n]
    // outward normal of an edge (dx,dz) is (dz,−dx) for a CCW loop; sum the incoming + outgoing edges'
    // normals so the per-point normal bisects the corner (smooth rounding).
    const in_dx = cur[0] - prev[0]
    const in_dz = cur[1] - prev[1]
    const out_dx = nxt[0] - cur[0]
    const out_dz = nxt[1] - cur[1]
    const nx = in_dz + out_dz
    const nz = -in_dx - out_dx
    const len = Math.hypot(nx, nz)
    out.push(len > 1e-6 ? [nx / len, nz / len] : [1, 0])
  }
  return out
}

/** World-XZ point at a given arc length `d` (metres) along the closed perimeter path (wraps). Used to
 *  space the banners evenly around the wall. @param {{points:[number,number][],total:number}} path
 *  @param {number} d @returns {[number, number]} */
export function point_at_arc_length(path, d) {
  const pts = path.points
  let acc = ((d % path.total) + path.total) % path.total
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (acc <= seg || i === pts.length - 1) {
      const t = seg > 1e-6 ? acc / seg : 0
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    acc -= seg
  }
  return pts[0]
}

// ── TSL material (the arcane-energy shader) ──────────────────────────────────────────────────────────

/**
 * Builds the wall's node material. Unlit (MeshBasicNodeMaterial) — the energy is emissive, not lit. The
 * fragment composes: a base-anchored blue mana haze ([D168] bright at the origin, gone by ~10 m)
 * tier only), a fresnel grazing brighten, a vertical fade (eye-level strong → 0 up/down), a subtle time
 * pulse, a distance fade (faint far → full near), and the local approach swell. Alpha carries all of it
 * so the wall is translucent and additive-reading over the world.
 * @param {{ approach_center: any, approach_strength: any }} o
 * @returns {import('three/webgpu').MeshBasicNodeMaterial}
 */

/** [D168-B] 2-D value noise in [0,1) over an integer lattice (the terrain_tint idiom: PCG hash per
 *  lattice corner + smoothstep bilinear) — the liquid-electric churn field. Pure TSL, zero textures.
 *  @param {*} px pre-scaled coord node @param {*} py pre-scaled coord node @param {number} salt */
function wall_noise(px, py, salt) {
  const x0 = floor(px)
  const y0 = floor(py)
  const ux = smoothstep(float(0), float(1), px.sub(x0))
  const uy = smoothstep(float(0), float(1), py.sub(y0))
  const hs = /** @param {*} x @param {*} y */ (x, y) =>
    // [D197] lattice coords wrap at 289 BEFORE the big hash multipliers — u spans ~1400 m of arc
    // length and f32 loses the low bits past ~16M, which froze the churn into flat regions.
    hash(
      mod(float(x), float(289))
        .mul(float(3746.1393))
        .add(mod(float(y), float(289)).mul(float(6682.65263)))
        .add(float(salt * 1013.904223 + 71))
    )
  return mix(mix(hs(x0, y0), hs(x0.add(1), y0), ux), mix(hs(x0, y0.add(1)), hs(x0.add(1), y0.add(1)), ux), uy)
}

/** Builds the D168 liquid-electric wall material. @param {{ approach_center: *, approach_strength: * }} o */
export function make_wall_material({ approach_center, approach_strength }) {
  // [D197] exported for the barrier bench (rig_wall bisect)
  const mat = new MeshBasicNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide // visible from inside the zone (and outside, at the border)
  mat.toneMapped = false // keep the neon energy from being crushed by the tonemap

  // Custom vertex attributes build_wall_geometry writes: aWall=(u arc-length, h∈[0,1] height), aNormal=
  // the outward horizontal wall normal (for the fresnel). Pulled through TSL attribute nodes (far_field
  // idiom).
  const wall = /** @type {any} */ (attribute('aWall', 'vec2'))
  const u = wall.x
  const h = wall.y
  const wnormal = /** @type {any} */ (attribute('aNormal', 'vec3'))

  const color = Fn(() => {
    // vertical body gradient: deep arcane blue at the base → cyan toward the crest (dim — the body is the
    // translucent field; the rune lines + fresnel carry the brightness so nothing clips to white).
    const body = mix(vec3(...COLOR_CYAN), vec3(...COLOR_DEEP), smoothstep(0.0, 0.8, h)).mul(BODY_DIM) // [D168] bright blue at the ORIGIN, deepening as it rises

    // [D168] BASE-ANCHORED profile: the energy lives at the ORIGIN (ground line) and rises like heat —
    // strongest in the first ~2 m, dissolving to nothing by the 10 m crest. A short skirt rise keeps the
    // ground junction soft (no hard line where the wall meets terrain).
    const rise = smoothstep(0.0, 0.06, h)
    // [D197-B — the wall must never show a visible end; it should fade] full presence through the
    // lower body, then a TRUE dissolve: alpha reaches exactly zero before the crest — the wall has
    // no visible top edge, it just breathes out into the sky.
    const fall = float(1)
      .sub(smoothstep(0.45, 0.92, h))
      .mul(float(1).sub(h.mul(0.25)))
    // [D168-B — target: a far more visible heat wave, almost liquid electricity] LIQUID-ELECTRIC field:
    // two octaves of scrolling value noise on (u, h·height − t·rise-speed) DEEPLY modulate the fade
    // (the visible liquid heat churn), and a RIDGE of the second octave (|n−0.5| thin band) draws
    // crawling bright electric filaments, added to colour AND alpha. All analytic — zero textures.
    const wall_m = h.mul(float(WALL_HEIGHT))
    // [D197-B — target: more chaotic than a simple upward scroll, should feel like a heat wave] DOMAIN WARP:
    // a slow third noise field bends the sampling coordinates of the churn, so the energy BOILS —
    // swirls, sideways licks, collapsing cells — instead of scrolling up in laminar lanes.
    const warp = wall_noise(
      u.mul(float(0.09)).add(time.mul(float(0.55))),
      wall_m.mul(float(0.13)).sub(time.mul(float(0.4))),
      2
    )
    const wu = u.add(warp.sub(float(0.5)).mul(float(9)))
    const wm = wall_m.add(warp.sub(float(0.5)).mul(float(4)))
    const n1 = wall_noise(wu.mul(float(ELEC_FREQ)), wm.mul(float(ELEC_FREQ)).sub(time.mul(float(ELEC_RISE))), 0)
    const n2 = wall_noise(
      wu.mul(float(ELEC_FREQ * 2.7)).add(time.mul(float(0.7))),
      wm.mul(float(ELEC_FREQ * 2.3)).sub(time.mul(float(ELEC_RISE * 1.4))),
      1
    )
    const churn = n1.mul(float(0.65)).add(n2.mul(float(0.35)))
    const v_fade = rise.mul(fall).mul(churn.mul(float(HEAT_AMP)).add(float(1 - HEAT_AMP / 2)))
    const ridge = n2.sub(float(0.5)).abs()
    const filament = smoothstep(float(FILAMENT_W), float(0), ridge).mul(rise).mul(fall)

    // distance fade (fragment world XZ vs camera XZ): faint far → full near, so from the centre it reads
    // as a shimmer band and only resolves as you approach (~FULL_VIS_M).
    const cam_d = length(vec2(positionWorld.x, positionWorld.z).sub(vec2(cameraPosition.x, cameraPosition.z)))
    const near = float(1).sub(smoothstep(float(FULL_VIS_M), float(FAINT_VIS_M), cam_d))
    const dist_fade = mix(float(FAINT_FLOOR), float(1), near)

    // subtle time pulse (whole-wall breathing) — small so it never strobes.
    const pulse = float(1).add(time.mul(PULSE_RATE).sin().mul(PULSE_AMP))

    // TRUE FRESNEL: 1 − |dot(viewDir, wallNormal)| → ~0 head-on, →1 at grazing (the ray skims the wall).
    // viewDir = fragment→camera (world), normalised; wallNormal is the outward horizontal attribute.
    const view_dir = normalize(cameraPosition.sub(positionWorld))
    const facing = abs(view_dir.dot(normalize(wnormal))).clamp(0, 1)
    const fresnel = float(1).sub(facing).pow(FRESNEL_POWER) // grazing brighten

    // base field = dim body + a cyan fresnel rim glow (brighter at grazing angles). `any`-typed: the TSL
    // node method chains widen/narrow types loosely, which tsc's .d.ts can't track across reassignment
    // (the file-standing idiom for three node-graph friction — same as water_material's `*` casts).
    let rgb = /** @type {any} */ (
      body.add(
        vec3(...COLOR_CYAN)
          .mul(fresnel)
          .mul(FRESNEL_GLOW)
      )
    )
    let alpha = /** @type {any} */ (float(BASE_ALPHA).add(fresnel.mul(FRESNEL_ALPHA)))

    // [D168] the rune lattice is DELETED — the tall hex grid read as "a weird grid above";
    // the barrier is now a pure base-anchored blue mana haze (body + fresnel + approach swell only).

    // local approach swell: brighten around the nearest wall point (world XZ) within APPROACH_RADIUS_M —
    // the classic MMO "the wall lights up where you push on it" tell.
    const to_center = length(vec2(positionWorld.x, positionWorld.z).sub(approach_center))
    const swell = float(1)
      .sub(smoothstep(float(0), float(APPROACH_RADIUS_M), to_center))
      .mul(approach_strength)
    rgb = rgb.add(
      vec3(...COLOR_CYAN)
        .mul(swell)
        .mul(APPROACH_GLOW)
    )
    alpha = alpha.add(swell.mul(0.4))
    // [D168-B] electric filaments: bright cold-white crawling lines, strongest near the ground line.
    rgb = rgb.add(
      vec3(...COLOR_FILAMENT)
        .mul(filament)
        .mul(float(FILAMENT_GLOW))
    )
    alpha = alpha.add(filament.mul(float(FILAMENT_ALPHA)))

    // fold the fades + pulse into alpha; clamp so stacked terms stay translucent (never a solid wall).
    alpha = alpha.mul(v_fade).mul(dist_fade).mul(pulse)
    return vec4(rgb, clamp(alpha, float(0), float(MAX_ALPHA)))
  })

  mat.colorNode = color()
  return mat
}

/** Triangular wave in [0,1], period 1, peaking (→1) at the half-integer cell boundary and 0 at the
 *  integers: 1 − 2·|frac(t) − 0.5|. Drives the hex cell-edge glow. @param {any} t @returns {any} */
function tri_wave(t) {
  return float(1).sub(abs(fract(t).sub(0.5)).mul(2))
}

// ── shader tuning constants ──────────────────────────────────────────────────────────────────────────
const FAINT_FLOOR = 0.5 // [D197 — target: a solid-reading energy barrier] alpha multiplier at max distance — the wall must READ from anywhere, not whisper
const BASE_ALPHA = 0.3 // [D197] baseline field presence (was 0.12 ⇒ ~2-5% effective = the 'invisible wall')
const MAX_ALPHA = 0.72 // clamp so stacked terms stay translucent (never a solid wall)
const BODY_DIM = 1.1 // [D197] the body carries the energy read now (runes are gone; fresnel+filaments ride on top)
const FRESNEL_POWER = 2.2 // grazing falloff exponent (higher = tighter rim)
const FRESNEL_GLOW = 1.4 // [D197] stronger grazing rim — the classic force-field edge light
const FRESNEL_ALPHA = 0.45 // [D197]
const PULSE_RATE = 0.7 // rad/s of the breathing pulse
const PULSE_AMP = 0.06 // ±6% intensity breathing
const HEAT_AMP = 0.8 // [D168-B] churn modulation depth of the vertical fade (0..1) — the LIQUID look
const ELEC_FREQ = 0.22 // base noise frequency (cells per metre) of the electric churn field
const ELEC_RISE = 1.1 // upward scroll speed (m/s) — the energy visibly RISES off the ground line
const FILAMENT_W = 0.045 // ridge half-width → thin crawling electric lines
const FILAMENT_GLOW = 3.4 // [D197] filaments must read in daylight
const FILAMENT_ALPHA = 0.8 // [D197]
const COLOR_FILAMENT = [0.62, 0.86, 1.35] // cold electric white-cyan (slightly HDR so it pops)
const APPROACH_GLOW = 1.4 // local approach-swell intensity
const BANNER_SPACING_M = 40 // holo-text banner spacing around the perimeter
const BANNER_EYE_M = 2.2 // banner height above the zone base (eye level)

// ── holo-text banner sprite (camera-facing, same technique as the board floats) ──────────────────────

/**
 * Renders a fully-composed banner string to a canvas texture and wraps it in a camera-facing Sprite in
 * the house gothic-terminal style (gold uppercase, dark plate, cyan hairline). The dapp composes the
 * text (i18n stays dapp-side); the engine only rasterises + billboards it. @param {string} text
 * @returns {Sprite} */
function make_banner_sprite(text) {
  const canvas = document.createElement('canvas')
  const scale = 4
  canvas.width = 512 * scale
  canvas.height = 96 * scale
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  ctx.scale(scale, scale)
  // dark translucent plate with a cyan/gold border (holo panel)
  ctx.fillStyle = 'rgba(10,12,22,0.5)'
  ctx.fillRect(6, 20, 500, 56)
  ctx.strokeStyle = 'rgba(74,158,255,0.7)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(6, 20, 500, 56)
  ctx.font = '600 30px "JetBrains Mono", ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const upper = String(text).toUpperCase()
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(upper, 256, 49)
  ctx.fillStyle = '#c8963c' // house gold
  ctx.fillText(upper, 256, 49)
  const texture = new CanvasTexture(canvas)
  const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: true })
  const sprite = new Sprite(material)
  sprite.scale.set(16, 3, 1) // world-metres footprint of the banner
  sprite.renderOrder = 4
  return sprite
}

/** Scene-remove + free a banner sprite. @param {Sprite} s */
function remove_sprite(s) {
  s.removeFromParent()
  const mat = /** @type {SpriteMaterial} */ (s.material)
  mat.map?.dispose()
  mat.dispose()
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────

/** @param {ZoneBounds | null} a @param {ZoneBounds | null} b @returns {boolean} */
function same_bounds(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return a.min_x === b.min_x && a.min_z === b.min_z && a.max_x === b.max_x && a.max_z === b.max_z
}
