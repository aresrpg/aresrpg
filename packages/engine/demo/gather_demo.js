// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GATHER-NODE PROCEDURAL PROP DEMO HARNESS (?gather=1) — the acceptance surface for the resource-node
// visual rework ("procedurally generate real wheat like grass textures, same for herbs +
// ores"). Boots the engine, grounds a wall of gather props on REAL terrain grass (the exact context where
// item-icon cards were rejected), and parks the camera at a fixed gather distance for a legibility capture.
// Replicates the frontend prop build (crossed-billboard cluster + the synth_gather_buffer procedural sprite +
// per-family sway/glow) so the ENGINE bench can screenshot it without the frontend package — the frontend's
// exact assembly (golden-angle, depletion thresholds) is unit-tested in spawn_rigs; this proves the PIXELS.
//
// ?gather=1&dist=12|25   — camera horizontal distance to the front row (the two legibility distances)
// ?gather=1&deplete=1    — render the front row DEPLETED (thin+dim+droop) for the A/B
// ?gather=1&focus=wheat  — close-up framing: ONE wheat node + a real op_blades grass reference beside it, for
//                          the "thinner wheat branches" A/B (tune with &dist/&eye/&aim; &square=1 = OLD melted card)
// Exposes window.__capture_ready once the props are mounted + a few frames have run.

import {
  AdditiveBlending,
  BoxGeometry,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { create_engine } from '../src/engine.js'
import { GUST, advance_gust, gather_night_tint, node_glow, synth_gather_buffer } from '../src/render/gather_synth.js'
import { bake_layer } from '../src/render/texture_baker.js'
import { RECIPES } from '../src/render/texture_recipes.js'

// The showcase row: 3 wheat (hue range) · 2 herb (shroom + magical) · 2 ore (mundane + apex). Family drives
// silhouette; the id drives the procedural sprite. Mirrors the frontend FAMILY/resource_visual tables — wheat
// is a TALL-NARROW blade stand (h 2.6, width 1.25, 5 cards, design ruling 2026-07-12), herb/ore square (width defaults to h).
const SHOWCASE = [
  { id: 'wheat', family: 'wheat', h: 2.6, width: 1.25, sway: 0.06, cards: 5, rock: false, apex: false },
  { id: 'wheat_ukraine', family: 'wheat', h: 2.6, width: 1.25, sway: 0.06, cards: 5, rock: false, apex: false },
  { id: 'blood_wheat', family: 'wheat', h: 2.6, width: 1.25, sway: 0.06, cards: 5, rock: false, apex: false },
  { id: 'green_mushroom', family: 'herb', h: 0.8, sway: 0.03, cards: 3, rock: false, apex: false },
  { id: 'arcaneshroom', family: 'herb', h: 0.86, sway: 0.03, cards: 3, rock: false, apex: false },
  { id: 'diamond', family: 'ore', h: 0.78, sway: 0, cards: 3, rock: true, apex: false },
  { id: 'cursed_gem', family: 'ore', h: 0.82, sway: 0, cards: 3, rock: true, apex: true },
]

const ghash = (a, b) => {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 2654435761) ^ Math.imul((b + 1) >>> 0, 40503)
  h ^= h >>> 15
  return (h >>> 0) / 4294967295
}
const _tex = new Map()
const synth_tex = (id) => {
  if (_tex.has(id)) return _tex.get(id)
  const buf = synth_gather_buffer(id)
  if (!buf) return null
  const { data, size } = buf
  const row = size * 4
  const flipped = new Uint8Array(data.length)
  for (let y = 0; y < size; y += 1) flipped.set(data.subarray((size - 1 - y) * row, (size - y) * row), y * row)
  const tex = new DataTexture(flipped, size, size, RGBAFormat, UnsignedByteType)
  tex.colorSpace = SRGBColorSpace
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  _tex.set(id, tex)
  return tex
}
const cross_geo = (w, h) => {
  const a = new PlaneGeometry(w, h)
  const b = new PlaneGeometry(w, h)
  b.rotateY(Math.PI / 2)
  const g = mergeGeometries([a, b], false)
  g.translate(0, h / 2, 0)
  return g
}

// GRASS REFERENCE (comparison bar: "the grass looks good, use the same process") — a REAL op_blades
// grass_tuft sprite (the base baker recipe) on tall-narrow cross-billboards, so the wheat A/B has grass beside it.
const grass_ref = () => {
  const rec = RECIPES.find((r) => r.name === 'grass_tuft')
  const raw = bake_layer(rec, 64, 0x51ee, 0) // Float32 RGBA 0..255, alpha-clip dilated
  const row = 64 * 4
  const flipped = new Uint8Array(64 * 64 * 4)
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < row; x += 1) flipped[y * row + x] = raw[(64 - 1 - y) * row + x]
  const tex = new DataTexture(flipped, 64, 64, RGBAFormat, UnsignedByteType)
  tex.colorSpace = SRGBColorSpace
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.42,
    side: DoubleSide,
    toneMapped: false,
  })
  const grp = new Group()
  for (let i = 0; i < 6; i += 1) {
    const m = new Mesh(cross_geo(1, 1.4), mat) // grass_tuft dims: 1 wide × 1.4 tall (the meadow carpet)
    m.position.set((ghash(i, 3) - 0.5) * 1.3, 0, (ghash(i, 7) - 0.5) * 1.3)
    m.rotation.y = ghash(i, 9) * Math.PI
    grp.add(m)
  }
  return grp
}
const ROCK_GEO = new BoxGeometry(0.3, 0.24, 0.3)
const ROCK_MAT = new MeshBasicMaterial({ color: 0x45454d, toneMapped: false })
const ROCK_BASE = [0x45 / 255, 0x45 / 255, 0x4d / 255] // ROCK_MAT's day colour — night-dimmed (× gather_night_tint) in animate
const HALO_MAT = new MeshBasicMaterial({
  color: 0xffd678,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
})
const _glow_mats = new Map()
const glow_mat = (rgb) => {
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

/** Build ONE gather prop (the frontend create_gather_layer.build, replicated for the demo). `square` forces the
 *  OLD melted h×h card (the A/B baseline); otherwise wheat uses its tall-narrow blade width. Returns the group
 *  + its sprite material so the animate loop can night-dim it (× gather_night_tint) exactly like the frontend prop.
 *  @returns {{ grp: Group, mat: MeshBasicMaterial }} */
function build_prop(spec, seed, deplete, square = false) {
  const grp = new Group()
  const mat = new MeshBasicMaterial({ transparent: true, alphaTest: 0.42, side: DoubleSide, toneMapped: false })
  const tex = synth_tex(spec.id)
  if (tex) mat.map = tex
  if (deplete) {
    mat.color.setHex(0x8c8c8c)
    mat.opacity = 0.85
  }
  // WIDTH mirrors the frontend spawn_rigs FAMILY.width: wheat tall-narrow blade (width ≪ h); herb/ore square (=h).
  const geo = cross_geo(square ? spec.h : (spec.width ?? spec.h), spec.h)
  const shown = deplete ? Math.max(1, spec.cards - 2) : spec.cards
  for (let i = 0; i < shown; i += 1) {
    const ang = ghash(seed, 99) * Math.PI * 2 + i * 2.399963
    const rr = 0.16 + 0.3 * ghash(seed, i * 7 + 1)
    const m = new Mesh(geo, mat)
    m.position.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr)
    m.rotation.y = ghash(seed, i * 13 + 3) * Math.PI
    m.scale.setScalar(0.82 + 0.32 * ghash(seed, i * 5 + 2))
    grp.add(m)
  }
  if (spec.rock) {
    const k = 2 + Math.floor(ghash(seed, 71) * 2)
    for (let i = 0; i < k; i += 1) {
      const m = new Mesh(ROCK_GEO, ROCK_MAT)
      m.position.set(
        (ghash(seed, i * 3 + 1) - 0.5) * 0.34,
        0.09 + ghash(seed, i * 3) * 0.05,
        (ghash(seed, i * 3 + 2) - 0.5) * 0.34
      )
      m.rotation.y = ghash(seed, i * 9) * Math.PI
      m.scale.setScalar(0.7 + ghash(seed, i * 4) * 0.6)
      grp.add(m)
    }
  }
  let glow = spec.apex ? new Mesh(new SphereGeometry(0.7, 12, 12), HALO_MAT) : null
  if (!glow) {
    const g = node_glow(spec.id)
    if (g) glow = new Mesh(new SphereGeometry(0.42, 10, 10), glow_mat(g))
  }
  if (glow && !deplete) {
    glow.position.y = spec.h * 0.45
    grp.add(glow)
  }
  if (deplete) grp.scale.y = 0.82
  return { grp, mat }
}

/** @param {HTMLCanvasElement} canvas @param {HTMLDivElement} gate @param {URLSearchParams} params */
export async function boot_gather_demo(canvas, gate, params) {
  gate.dataset.hidden = 'false'
  gate.textContent = 'Booting gather-node demo…'
  const dist = Number(params.get('dist')) || 12
  const deplete = params.has('deplete')
  const with_nodes = params.get('nodes') !== '0' // ?nodes=0 → empty scene (the perf A/B baseline)
  const focus = params.get('focus') // ?focus=wheat → owner-eye close-up: ONE wheat node + grass reference beside it
  const square = params.has('square') // ?square=1 → the OLD melted h×h wheat card (the A/B baseline geometry)

  // EMPTY sky+lights stage (synthetic_chunks:0 — no terrain streaming, always renders) + our own grass ground,
  // so the capture is deterministic and never a black un-streamed frame. The props are the exact frontend build.
  const engine = create_engine({ canvas, tier: 'high', synthetic_chunks: 0 })
  const w = /** @type {any} */ (window)
  w.__engine = engine
  engine.on('boot_error', (error) => {
    gate.dataset.hidden = 'false'
    gate.textContent = `Engine not ready: ${/** @type {Error} */ (error)?.message ?? error}`
  })
  engine.start()
  engine.set_time_of_day(0.32) // late morning — warm, legible

  const ground = new Mesh(new PlaneGeometry(140, 140), new MeshBasicMaterial({ color: 0x4a6a32, toneMapped: false }))
  ground.rotation.x = -Math.PI / 2 // lay flat; props sit at y=0 on it
  engine.add_to_scene(ground)

  // Showcase row centred at origin (front, pristine or depleted) + a back row (opposite depletion → A/B in one
  // frame) + filler so ~20 clusters are resident for the perf read. Spaced 1.9 m along X.
  const SPACING = 1.9
  const N = SHOWCASE.length
  const x0 = -((N - 1) * SPACING) / 2
  /** @type {{ g: Group, spec: any, mat: MeshBasicMaterial, depl: number }[]} */
  const props = []
  const place = (spec, xi, z, dep, salt) => {
    const { grp, mat } = build_prop(spec, (xi + 1) * 131 + salt, dep, square)
    grp.position.set(x0 + xi * SPACING, 0, z)
    engine.add_to_scene(grp)
    props.push({ g: grp, spec, mat, depl: dep ? 0x8c / 0xff : 1 }) // depl gray-multiply mirrors the frontend depletion tint
  }
  if (focus === 'wheat') {
    // OWNER-EYE CLOSE-UP: one ripe-gold wheat node + a real-grass reference beside it, at character height ~5 m —
    // the exact A/B framing (before=?square melted clump · after=tall-narrow thin-stalk blades). ?square baselines it.
    const [wheat] = SHOWCASE // the tier-1 ripe-gold wheat
    const { grp: node, mat } = build_prop(wheat, 131, false, square)
    node.position.set(-0.85, 0, 0)
    engine.add_to_scene(node)
    props.push({ g: node, spec: wheat, mat, depl: 1 })
    const grass = grass_ref()
    grass.position.set(1.15, 0, 0.25)
    engine.add_to_scene(grass)
  } else if (with_nodes) {
    SHOWCASE.forEach((s, i) => place(s, i, 0, deplete, 0)) // front row
    SHOWCASE.forEach((s, i) => place(s, i, -3, !deplete, 777)) // back row (opposite depletion state)
    for (let k = 0; props.length < 20; k += 1)
      place(SHOWCASE[k % N], k % N, -6 - Math.floor(k / N) * 2.4, false, 1500 + k)
  }

  // Frame the front row from the requested gather distance, eye height, aimed at the node mid-height (`aim`). Pushed
  // every frame so a standalone view stays framed; seize_camera (spec-side) neutralizes this to drive directly.
  const eye = Number(params.get('eye')) || 1.7 // camera height — the game's exploration cam is elevated (looks down)
  const aim = Number(params.get('aim')) || 0.7 // look-at height — raise it (≈1.2) to centre a tall wheat stand
  const pose = () => {
    engine.set_camera_position([0, eye, dist]) // stand +Z of the row…
    engine.set_camera_orientation(0, Math.atan2(aim - eye, dist)) // …and look −Z at it (yaw 0 = −Z; π would face away)
  }
  pose()

  let t = 0
  const animate = () => {
    t += 0.016
    advance_gust(0.016)
    const g = GUST.value
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.8)
    HALO_MAT.opacity = 0.12 + 0.07 * pulse
    for (const m of _glow_mats.values()) m.opacity = 0.08 + 0.06 * pulse
    // NIGHT DIM — mirrors the frontend spawn_rigs prop: dim the unlit sprite albedo + shared rock
    // by the SAME sky day/night level (gather_night_tint(engine.day_factor)). Legit glow (apex halo/magical) untouched.
    const tint = gather_night_tint(engine.day_factor?.() ?? 1)
    ROCK_MAT.color.setRGB(ROCK_BASE[0] * tint, ROCK_BASE[1] * tint, ROCK_BASE[2] * tint)
    for (const { g: grp, spec, mat, depl } of props) {
      mat.color.setScalar((depl ?? 1) * tint) // sprite albedo = depletion tint × night dim
      if (!spec.sway) continue
      grp.rotation.z = Math.sin(t * 1.4 + grp.position.x) * spec.sway * g
      grp.rotation.x = Math.sin(t * 1.1 + grp.position.z) * spec.sway * 0.6 * g
    }
    pose()
    requestAnimationFrame(animate)
  }
  animate()

  gate.dataset.hidden = 'true'
  for (let f = 0; f < 20; f += 1) await new Promise((r) => requestAnimationFrame(r)) // settle a few frames
  w.__capture_ready = true
}
