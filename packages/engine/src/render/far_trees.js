// FAR-TREE IMPOSTORS — render half (ENGINE_AAA_PLAN §3.6, Lane B3). Turns the per-section procedural-tree
// instances the far worker derives (far_trees_gen.js) into cylindrical billboard cards drawn from the near
// ring edge to the horizon, so forests reach the vista instead of vanishing at 224 m — and the SAME trees
// you walk to (the placement is the decorator's own, §3.6 seam). Behind `?impostors=1`; OFF ⇒ this whole
// path is never constructed ⇒ the far shell is byte-identical.
//
// ATLAS (bake from A1/A2, §8 B3): one silhouette CARD per species×age (IMPOSTOR_LAYER_COUNT layers). Each
// card is the A2 voxel tree (build_tree, the SAME generator the near ring stamps) ORTHOGRAPHICALLY
// projected side-on and coloured by the far-shell map palette (colors.get_map_color) — canopy (leaf/twig,
// replace_foliage) painted OVER trunk (bark, overwrite) so the card reads green-crown / brown-bole. Baked
// ONCE at construction into a DataArrayTexture (~48²·30·4 B ≈ 276 KB).
//
// BILLBOARD: one InstancedBufferGeometry per far SECTION (its lifecycle mirrors the section's — upload /
// retire / remove / cross-fade), a unit quad stretched per-instance to the tree's world W×H, anchored at
// the ground and rotated only about Y to face the camera (CYLINDRICAL — trees stay upright when you look
// down, unlike a spherical sprite). The material carries, in ONE colorNode Fn (bare discards are dead code
// in TSL — the far-shell phantom-discard law): alpha-clip on the card, a birth/DYING screen-door dither
// (shared far-shell clock + per-instance spawn — a refined-in section fades in, a coarsened-out one fades
// out), a RADIAL near-fade (impostors dither out as the near ring's real trees stream in — the seam
// cross-fade, no pop/double), a radial far-fade (dissolve into the horizon haze, no hard band edge), the
// residency-MASK backstop (never draw over a column the near ring is already drawing), and the far-shell
// distance haze so impostors sit in the same aerial veil as the shell behind them.

import {
  BufferAttribute,
  BufferGeometry,
  DataArrayTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  attribute,
  cameraPosition,
  Discard,
  float,
  Fn,
  hash,
  If,
  int,
  mix,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import { CHUNK_SIZE } from '../config/world_config.js'
import { get_map_color } from '../lod/colors.js'
import { for_each_voxel } from '../gen/schematics/loader.js'

import { canonical_impostor_schematic, IMPOSTOR_FLOATS_PER_TREE, IMPOSTOR_LAYER_COUNT } from './far_trees_gen.js'

/** @typedef {import('three').Scene} Scene */
/** @typedef {import('three').DataTexture} DataTexture */
/** @typedef {import('./far_trees_gen.js').SectionTrees} SectionTrees */

/** Silhouette card resolution (px per edge). Small — a billboard subtends few pixels past 224 m; the
 *  shape (alpha coverage) + coarse green/brown split is all that reads at distance. */
const CARD_PX = 48
/** Alpha-clip threshold on the card (below ⇒ discard) — a hard cutout, no translucency sort. */
const ALPHA_CLIP = 0.5
/** Birth/DYING screen-door fade duration (s) — matches far_field.FADE_SECONDS so a section and its
 *  impostors cross-fade in lockstep. */
const FADE_SECONDS = 0.2
/** RADIAL NEAR-FADE band (m): impostors dither out from full at `near_r` to gone at `near_r − band`, so
 *  the near ring's real voxel trees have taken over before the impostor disappears (the seam cross-fade). */
const NEAR_FADE_BAND = 48
/** RADIAL FAR-FADE: impostors dissolve into the horizon haze across the last FAR_FADE_BAND m up to
 *  FAR_MAX_M, so the impostor band has no hard outer edge (past it the far-shell canopy colour carries). */
const FAR_MAX_M = 1200
const FAR_FADE_BAND = 260
/** Distance haze (matches far_field's aerial veil so impostors sit in the same air as the shell). */
const HAZE_START_M = 520
const HAZE_FULL_M = 3800
const HAZE_MAX = 0.26
const HAZE_TINT = /** @type {[number,number,number]} */ ([0.53, 0.62, 0.72])

/**
 * @typedef {object} FarTrees the impostor renderer handle (owned by far_field, lifecycle-mirrors sections).
 * @property {(id: string, trees: SectionTrees, spawn: number) => void} upload_section builds one section's
 *   billboard batch and adds it (cross-fading in from `spawn`). Empty tree sets are a no-op.
 * @property {(id: string) => void} remove_section detaches a hard drop now; geometry frees next reap tick.
 * @property {(id: string) => void} retire_section fades a batch OUT, detaches it, then frees next tick.
 * @property {(seconds: number) => void} reap flushes prior frees, then detaches newly-expired batches.
 * @property {(radius_m: number) => void} set_near_radius the near ring's live load radius (m) — drives the
 *   radial near-fade so impostors hand off to real trees at the ring edge.
 * @property {() => () => void} mount_pipeline_warmers mounts exact-layout birth/dying meshes for prewarm.
 * @property {() => number} count resident impostor trees (HUD/perf stat).
 * @property {() => void} dispose frees every batch, the atlas, and both materials.
 */

/**
 * Bakes the species×age silhouette atlas from the A2 generator. Deterministic (the canonical trees are
 * pure). Each layer: take the CANONICAL (species,age) tree (far_trees_gen owns it — the SAME tree whose
 * W×H sizes the billboard, so silhouette and size match) and project it side-on into a CARD_PX² RGBA card
 * (canopy over bole), base row at v=0 (billboard uv.y=0 = ground). @returns {DataArrayTexture}
 */
function bake_impostor_atlas() {
  const albedo = new Uint8Array(CARD_PX * CARD_PX * 4 * IMPOSTOR_LAYER_COUNT)
  for (let layer = 0; layer < IMPOSTOR_LAYER_COUNT; layer += 1) {
    project_card(albedo, layer, canonical_impostor_schematic(layer))
  }
  const tex = new DataArrayTexture(albedo, CARD_PX, CARD_PX, IMPOSTOR_LAYER_COUNT)
  tex.format = RGBAFormat
  tex.type = UnsignedByteType
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter // no mipmaps — avoids alpha-clip erosion of thin silhouettes at distance
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/** Orthographic side-on projection of one voxel tree into atlas `layer`. Canopy (replace_foliage: leaf/
 *  twig) paints OVER bole (overwrite: bark/cap) so the trunk shows only where no crown is in front; alpha
 *  = covered. Rows written base-first (row 0 = ground). @param {Uint8Array} albedo @param {number} layer
 *  @param {import('../gen/schematics/loader.js').ResolvedSchematic} schematic */
function project_card(albedo, layer, schematic) {
  const { size } = schematic
  let minx = 0
  // for_each_voxel: synthesized trees carry the compact typed-array form (P0 balloon fix), not .voxels.
  for_each_voxel(schematic, (dx) => {
    if (dx < minx) minx = dx
  })
  const w = Math.max(1, size[0])
  const h = Math.max(1, size[1])
  const base = layer * CARD_PX * CARD_PX
  // per-cell canopy rank (-1 empty, 0 bole, 1 canopy) so canopy wins the front of the silhouette.
  const rank = new Int8Array(CARD_PX * CARD_PX).fill(-1)
  for_each_voxel(schematic, (dx, dy, _dz, e) => {
    const col = Math.min(CARD_PX - 1, Math.floor(((dx - minx) / w) * CARD_PX))
    const row = Math.min(CARD_PX - 1, Math.floor((dy / h) * CARD_PX))
    const r = e.mode === 'replace_foliage' ? 1 : 0
    const ci = row * CARD_PX + col
    if (r < rank[ci]) return
    rank[ci] = /** @type {number} */ (r)
    const [cr, cg, cb] = get_map_color(e.block_id)
    const p = (base + ci) * 4
    albedo[p] = cr
    albedo[p + 1] = cg
    albedo[p + 2] = cb
    albedo[p + 3] = 255
  })
}

/**
 * Creates the far-tree impostor renderer. Shares the far shell's fade clock, residency mask, and sun so a
 * section's impostors move/fade/mask exactly as its geometry does. Builds the atlas + two materials (birth
 * / dying) once; each section owns an InstancedBufferGeometry + Mesh.
 * @param {object} o
 * @param {Scene} o.scene
 * @param {*} o.clock `uniform(float)` far-shell fade clock (seconds), ticked by far_field
 * @param {DataTexture} o.mask_texture nonzero = near-drawn column
 * @param {*} o.mask_origin `uniform(Vector2)` mask window min chunk (x,z)
 * @param {number} o.mask_chunks mask window edge in chunks (far_field.MASK_CHUNKS)
 * @param {() => void} [o.on_geometry_disposed] hitch-probe hook at the deferred free site
 * @returns {FarTrees}
 */
export function create_far_trees({ scene, clock, mask_texture, mask_origin, mask_chunks, on_geometry_disposed }) {
  const atlas = bake_impostor_atlas()
  const near_radius = uniform(0)
  const material = build_impostor_material({
    atlas,
    clock,
    mask_texture,
    mask_origin,
    mask_chunks,
    near_radius,
    fade_out: false,
  })
  const material_out = build_impostor_material({
    atlas,
    clock,
    mask_texture,
    mask_origin,
    mask_chunks,
    near_radius,
    fade_out: true,
  })

  /** @typedef {{ mesh: Mesh, count: number }} Batch */
  /** @type {Map<string, Batch>} */
  const resident = new Map()
  /** @type {{ mesh: Mesh, retire_at: number, spawn_attr: InstancedBufferAttribute }[]} */
  const dying = []
  const empty_geometry = new BufferGeometry()
  /** Geometry detached this frame and freed at the start of the next reap tick. Warmers are tagged so
   *  boot cleanup is not attributed as a live LOD free. @type {{geometry: BufferGeometry, count_lod: boolean}[]} */
  const pending_dispose = []
  let total = 0

  function flush_dispose() {
    for (const pending of pending_dispose) {
      pending.geometry.dispose()
      if (pending.count_lod) on_geometry_disposed?.()
    }
    pending_dispose.length = 0
  }

  /** Remove/detach now; retain only the geometry until next tick.
   * @param {Mesh} mesh @param {boolean} [count_lod] */
  function defer_geometry(mesh, count_lod = true) {
    pending_dispose.push({ geometry: mesh.geometry, count_lod })
    mesh.geometry = empty_geometry
  }

  /** @param {string} id */
  function drop(id) {
    const b = resident.get(id)
    if (!b) return
    scene.remove(b.mesh)
    defer_geometry(b.mesh)
    total -= b.count
    resident.delete(id)
  }

  return {
    mount_pipeline_warmers() {
      const trees = { count: 1, data: new Float32Array(IMPOSTOR_FLOATS_PER_TREE) }
      const warmers = [material, material_out].map((warm_material) => {
        const mesh = new Mesh(build_section_geometry(trees, clock.value), warm_material)
        mesh.frustumCulled = false
        mesh.matrixAutoUpdate = false
        scene.add(mesh)
        return mesh
      })
      return () => {
        for (const mesh of warmers) {
          scene.remove(mesh)
          defer_geometry(mesh, false)
        }
      }
    },

    upload_section(id, trees, spawn) {
      drop(id)
      if (trees.count === 0) return
      const geometry = build_section_geometry(trees, spawn)
      const mesh = new Mesh(geometry, material)
      mesh.frustumCulled = false // instances span the section; the far streamer already scoped residency
      mesh.matrixAutoUpdate = false
      mesh.renderOrder = 1 // after the opaque far shell (both write depth; impostors clip so order is cosmetic)
      scene.add(mesh)
      resident.set(id, { mesh, count: trees.count })
      total += trees.count
    },

    remove_section(id) {
      drop(id)
    },

    retire_section(id) {
      const b = resident.get(id)
      if (!b) return
      total -= b.count
      resident.delete(id)
      const spawn_attr = /** @type {InstancedBufferAttribute} */ (b.mesh.geometry.getAttribute('i_spawn'))
      ;/** @type {Float32Array} */ (spawn_attr.array).fill(clock.value) // dying fade starts now
      spawn_attr.needsUpdate = true
      b.mesh.material = material_out
      dying.push({ mesh: b.mesh, retire_at: clock.value, spawn_attr })
    },

    reap(_seconds) {
      flush_dispose()
      for (let i = dying.length - 1; i >= 0; i -= 1) {
        if (clock.value < dying[i].retire_at + FADE_SECONDS) continue
        scene.remove(dying[i].mesh)
        defer_geometry(dying[i].mesh)
        dying.splice(i, 1)
      }
    },

    set_near_radius(radius_m) {
      near_radius.value = radius_m
    },

    count() {
      return total
    },

    dispose() {
      for (const id of [...resident.keys()]) drop(id)
      for (const d of dying) {
        scene.remove(d.mesh)
        defer_geometry(d.mesh)
      }
      dying.length = 0
      flush_dispose() // terminal teardown has no next tick
      empty_geometry.dispose()
      atlas.dispose()
      material.dispose()
      material_out.dispose()
    },
  }
}

/** Builds one section's instanced billboard geometry from its packed tree buffer + a spawn time. Each
 *  section owns its base-quad attributes (4 verts — negligible; NOT shared, so one section's dispose can
 *  never free a buffer another live section is drawing). Corners (cx∈{-0.5,0.5}, cy∈{0,1}) base-anchored.
 *  @param {SectionTrees} trees @param {number} spawn @returns {InstancedBufferGeometry} */
function build_section_geometry(trees, spawn) {
  const g = new InstancedBufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2))
  g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1))
  const n = trees.count
  const i_base = new Float32Array(n * 3)
  const i_wh = new Float32Array(n * 2)
  const i_layer = new Float32Array(n)
  const i_spawn = new Float32Array(n)
  const d = trees.data
  for (let i = 0; i < n; i += 1) {
    const o = i * IMPOSTOR_FLOATS_PER_TREE
    i_base[i * 3] = d[o]
    i_base[i * 3 + 1] = d[o + 1]
    i_base[i * 3 + 2] = d[o + 2]
    i_wh[i * 2] = d[o + 3]
    i_wh[i * 2 + 1] = d[o + 4]
    i_layer[i] = d[o + 5]
    i_spawn[i] = spawn
  }
  g.setAttribute('i_base', new InstancedBufferAttribute(i_base, 3))
  g.setAttribute('i_wh', new InstancedBufferAttribute(i_wh, 2))
  g.setAttribute('i_layer', new InstancedBufferAttribute(i_layer, 1))
  g.setAttribute('i_spawn', new InstancedBufferAttribute(i_spawn, 1))
  g.instanceCount = n
  return g
}

/**
 * Builds an impostor material variant (birth: reveal 0→1; dying: reveal 1→0). Cylindrical billboard
 * vertex + a single colorNode Fn carrying every discard (alpha-clip, fade dither, radial near/far fades,
 * residency-mask backstop) so they compile (bare TSL discards are dead code — the far-shell law).
 * @param {*} o @returns {MeshBasicNodeMaterial}
 */
function build_impostor_material({ atlas, clock, mask_texture, mask_origin, mask_chunks, near_radius, fade_out }) {
  const material = new MeshBasicNodeMaterial()
  material.side = 2 // DoubleSide — the card has no back
  material.transparent = false // hard alpha-clip via Discard, opaque draw (no sort), like the far cutout

  const corner = /** @type {*} */ (attribute('position', 'vec3')) // (cx, cy, 0)
  const i_base = /** @type {*} */ (attribute('i_base', 'vec3'))
  const i_wh = /** @type {*} */ (attribute('i_wh', 'vec2'))

  // CYLINDRICAL billboard: rotate about world-Y only so the card stays upright. `right` is the horizontal
  // vector perpendicular to the camera→tree direction; up is world-Y. base at i_base (ground), height up.
  // Divide by a CLAMPED length (never by 0) so a tree at the camera's exact XZ can never compute 0/0 = NaN
  // — NaN vertices are a Metal device crash, and the vertex runs even for near-faded impostors (the fade is
  // in the fragment). At dir_len≈0 the card collapses to zero width (invisible), which is correct: that
  // impostor is inside the near ring, handed off to the real tree.
  const dir = vec2(i_base.x.sub(cameraPosition.x), i_base.z.sub(cameraPosition.z))
  const right = vec2(dir.y.negate(), dir.x).div(dir.length().max(float(0.001)))
  const world = vec3(
    i_base.x.add(right.x.mul(corner.x).mul(i_wh.x)),
    i_base.y.add(corner.y.mul(i_wh.y)),
    i_base.z.add(right.y.mul(corner.x).mul(i_wh.x))
  )
  material.positionNode = world

  const uv = /** @type {*} */ (attribute('uv', 'vec2'))
  const i_layer = /** @type {*} */ (attribute('i_layer', 'float'))
  const i_spawn = /** @type {*} */ (attribute('i_spawn', 'float'))

  const tex = texture(atlas, uv).depth(int(i_layer.max(float(0))))
  const dist = i_base.sub(cameraPosition).length()

  // RADIAL near-fade (hand off to real trees): 0 inside the near ring, 1 beyond its band.
  const reveal_near = smoothstep(near_radius.sub(float(NEAR_FADE_BAND)), near_radius, dist)
  // RADIAL far-fade (dissolve into haze): 1 near, 0 past FAR_MAX_M.
  const reveal_far = float(1).sub(smoothstep(float(FAR_MAX_M - FAR_FADE_BAND), float(FAR_MAX_M), dist))
  // Birth (age 0→1) / DYING (1→age) screen-door.
  const age = smoothstep(float(0), float(FADE_SECONDS), clock.sub(i_spawn))
  const reveal_life = fade_out ? float(1).sub(age) : age
  const reveal = reveal_near.mul(reveal_far).mul(reveal_life)
  const dither = hash(positionWorld.x.mul(3.11).add(positionWorld.z.mul(7.53)).add(positionWorld.y.mul(1.7)))

  // Residency-MASK backstop: never draw where the near ring is already DRAWING this column (sampled at the
  // instance base so the whole card shares one decision — no half-masked tree). Matches the far-shell mask.
  const frag_chunk = vec2(i_base.x, i_base.z).div(float(CHUNK_SIZE)).floor()
  const texel = frag_chunk.sub(mask_origin)
  const in_window = texel.x
    .greaterThanEqual(float(0))
    .and(texel.x.lessThan(float(mask_chunks)))
    .and(texel.y.greaterThanEqual(float(0)))
    .and(texel.y.lessThan(float(mask_chunks)))
  const mask_uv = texel.add(float(0.5)).div(float(mask_chunks))
  const drawn = texture(mask_texture, mask_uv).r.greaterThan(float(0.5))

  // Distance haze toward the sky tint (the far-shell aerial veil) so impostors and the shell match.
  const t_haze = smoothstep(float(HAZE_START_M), float(HAZE_FULL_M), dist)
  const hazed = mix(tex.rgb, vec3(HAZE_TINT[0], HAZE_TINT[1], HAZE_TINT[2]), t_haze.mul(float(HAZE_MAX)))

  material.colorNode = Fn(() => {
    If(tex.a.lessThan(float(ALPHA_CLIP)), () => Discard()) // card alpha-clip
    If(reveal.lessThan(dither), () => Discard()) // fade + radial dither cross-fade
    If(in_window.and(drawn), () => Discard()) // mask: near ring covers this column
    return vec4(hazed, 1)
  })()
  material.alphaTest = 0 // clip is in the Fn (the material alphaTest path double-discards otherwise)
  return material
}
