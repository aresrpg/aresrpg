// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Far-shell renderer (§11 NG-LOD phase B) — the DEDICATED far-field draw path. Turns each built far
// Section's smooth-heightfield FarMesh (far_mesher.js) into a CONTINUOUS interpolated terrain surface
// and adds it to the scene as its own indexed `Mesh`. Separate from the near-terrain quad pool by
// design (brief rule #1): the far shell is flat map-color + a self-contained sun-diffuse + distance
// haze/desaturation — natural terrain silhouette that sits soft in the atmosphere, no textures/AO/light
// values, no collision with the sibling terrain-material tint wave. Section counts are ~hundreds, so a
// per-section indexed BufferGeometry pool is the right tool; the 2-bit lod_scale mega-pool unification
// stays a documented future step (quadtree.js phase-B spec §1), not this wave.
//
// GEOMETRY (design pivot — smooth, not box-columns): a section's 33×33 CORNER grid (far_mesher) becomes
// an indexed surface — shared corner vertices → one continuous mesh with SMOOTH normals (computed).
// Per-vertex color (blended map colors) interpolates across the surface. A border SKIRT ring drops the
// section edge to min_height so a 1-level LOD seam between adjacent sections never cracks. World coords
// are baked into the geometry (small section count → no per-section origin uniform).
//
// SHADING (self-contained): colorNode = vertexColor · sun-diffuse, then DESATURATED + HAZED toward the
// sky/fog tint with distance (the reported "field-of-view" softening + "fog/blurriness above" — distant
// terrain never reads crisp). One sun-direction uniform (fed from the sky node). A FADE dither
// (screen-door on a per-vertex spawn time vs a global clock) cross-fades section swaps so a refinement
// or replacement is never a visible pop. Fog on top via the scene fog node. Matte, no shadows.
// NG2 HANDOFF: true depth-of-field BLUR is a post-processing wave (modules shelf-ready); the material
// approximates the soft read with desaturation + extra haze only.

import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Mesh,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
} from 'three'
import { uniform } from 'three/tsl'

import { LOD_MIN_LEVEL } from '../lod/section_builder.js'

import { build_far_material } from './far_material.js'
import { create_far_trees } from './far_trees.js'
// build_section_geometry = the pure CPU mesh→BufferGeometry factory (voxel + smooth), split into
// far_geometry.js for the ≤600-LoC law. Imported for upload_section; re-exported so far_field.test.js's
// `import { build_section_geometry } from './far_field.js'` stays stable.
import { build_section_geometry, build_warm_geometries } from './far_geometry.js'
export { build_section_geometry } from './far_geometry.js'

/** @typedef {import('../lod/far_mesher.js').FarMesh} FarMesh */
/** @typedef {import('../lod/far_mesher.js').FarLayer} FarLayer */
/** @typedef {import('three').Scene} Scene */

/** Default sun direction (unit) until set_sun_direction wires the sky node's tod-driven sun. Roughly
 *  the near renderer's sun so the far shell matches at the seam. */
const DEFAULT_SUN = new Vector3(180, 300, 105).normalize()

/** Fade (dither cross-in) duration in SECONDS — a section screen-doors from sparse→full over this on
 *  upload, so a swap/refinement is never a visible pop (design directive; survey S23 dithered fade). */
const FADE_SECONDS = 0.2

// [S-27 D1/D2] The shader BLOCKY-ILLUSION consts (camera-distance Y-quantize QUANT_*, virtual-cell grid
// FAR_ILLUSION_CELL_*/FAR_CELL_*, GRID_FADE_*) were deleted with the illusion itself: the far shell now
// carries REAL progressive-voxel geometry (far_voxel_mesher, L1/L2/L3), so blockiness is world-anchored
// GEOMETRY, not a per-vertex shader schedule. That killed the camera-anchored terrace RINGS (the quantize
// was keyed on radial camera distance) and the "just a grid" read in one deletion.

/** FINER-WINS depth bias (m per LOD level step). During coarse-first refinement a coarse SUBSTITUTE
 *  section and its already-built finer children render together (the DH keep set emits BOTH so a child
 *  isn't pruned before its siblings arrive — quadtree.js). We SINK COARSER sections a hair (level-scaled)
 *  so the finer one always wins the depth test over the coarse fill it replaces; otherwise coplanar far
 *  WATER (parent + child both at sea level) z-fights. Sinking (vs lifting finer) keeps the FINEST level at
 *  its true height and never raises far geometry ABOVE the surface — important because the far heightfield
 *  is a per-cell AVERAGE that already tends to sit high in dips (the poke-through the under-near-ring
 *  discard handles). Tiny: coarsest = FAR_DEPTH_BIAS·(LOD_MAX−LOD_MIN) ≈ a few cm, sub-pixel at the
 *  hundreds-of-metres the far shell occupies and hidden by the section skirt at LOD seams; 0 at the finest. */
const FAR_DEPTH_BIAS = 0.05

/** RESIDENCY-MASK window edge, in CHUNKS (odd → the camera chunk sits at the centre texel). A moving
 *  N×N grid of chunk columns around the camera records which columns the NEAR ring has resident; the far
 *  material discards fragments over a resident column (the near ring draws it) and shows the shell over
 *  everything else — including NOT-YET-LOADED columns inside the ring (coarse-first cover) and columns the
 *  camera just moved past. 41 chunks = ±20 = ±640 m, comfortably past the largest near ring (load_radius
 *  ≤ 8 ⇒ 256 m); beyond the window the far shell always shows (no near terrain that far out). */
const MASK_CHUNKS = 41

/** Shared empty impostor payload for a section the worker derived no trees for (avoids per-call alloc). */
const EMPTY_TREES = new Float32Array(0)

/**
 * @typedef {object} FarField the far-shell renderer handle.
 * @property {(id: string, mesh: FarMesh) => void} upload_section builds (or replaces) one section's
 *   smooth geometry + mesh and adds it to the scene, cross-fading it in.
 * @property {(id: string) => void} remove_section detaches a hard-drop now and frees geometry next tick.
 * @property {(id: string) => void} retire_section fades a section OUT (dying material, reveal 1→0 over
 *   FADE_SECONDS) then frees it — the cross-fade path for a coverage-triggered keep-set drop-out so a
 *   swap is never a bare flash frame. section_count()/bytes() drop immediately; only the GPU free defers.
 * @property {() => () => void} mount_pipeline_warmers mounts exact-layout far + impostor prewarm meshes.
 * @property {(id: string) => boolean} has whether a section id is resident (rendered).
 * @property {() => number} section_count resident far sections (the HUD stat).
 * @property {() => number} bytes total resident far geometry bytes (position+normal+color+index).
 * @property {(sun: import('three').Vector3) => void} set_sun_direction points the far sun-diffuse at a
 *   (world, unit) sun direction — fed from the sky node so the shell tracks time-of-day.
 * @property {(for_each_column: (((cb: (rec: { cx: number, cz: number }) => void) => void) & { epoch?: () => number }), cam_chunk_x: number, cam_chunk_z: number, epoch?: number) => void} set_resident_mask
 *   rebuilds the per-chunk mask window (centred on the camera chunk) from the columns the near ring is
 *   actually DRAWING: fragments over a drawn near column are discarded (the near ring draws them at full
 *   detail), the shell shows everywhere else. Fed ring_manager.for_each_rendered_column each frame (NOT
 *   for_each_resident — generated ⊋ drawn during a stream ⇒ over-discard holes); empty ⇒ full coarse cover.
 * @property {(seconds: number) => void} tick advances the fade clock (call once per frame with the
 *   frame dt) so the dither cross-fades animate.
 * @property {(radius_m: number) => void} set_near_radius [B3] the near ring's live load radius (m),
 *   driving the far-tree impostor radial near-fade (hand-off to real trees at the ring seam). No-op
 *   without ?impostors=1.
 * @property {() => number} impostor_count [B3] resident far-tree impostor count (HUD/perf), 0 without
 *   the impostor layer.
 * @property {(cx: number, cz: number) => number} _mask_value_at TEST-ONLY: the mask byte (0 | 255) for
 *   a world column at the last window origin, or -1 when outside the window. Lets a probe assert the
 *   drawn-column mask pixel-wise without a GPU readback (far_field.test.js + the traverse sheet oracle).
 * @property {(cx: number, cz: number) => boolean} _mask_interior_at TEST-ONLY pre-eroded verdict.
 * @property {() => string[]} _debug_ids TEMP DEBUG (2026-07-04 far-pop diagnosis): resident section ids
 *   for frame-to-frame diffing (detect appear-then-vanish sections).
 * @property {() => void} dispose disposes every section geometry + the shared material.
 */

/**
 * Flat index into the N×N residency mask (`mask_data`) for a world chunk column, given the window's min
 * chunk (ox,oz). Returns -1 when the column is outside the window. The mask DataTexture is `mask_data`
 * read row-major as width=MASK_CHUNKS: index `tz*N+tx` ⇒ buffer ROW tz, COLUMN tx (tz = cz-oz, tx =
 * cx-ox). The shader samples `texture(mask, ((tx,tz)+0.5)/N)`; the WebGPU DataTexture path has NO v-flip
 * (three r185: DataTexture.flipY=false + no upload flip; sampling reads buffer row R at v=(R+0.5)/N —
 * verified empirically on the Studio's Metal adapter across the whole v axis, sub-texel, 2026-07-03). So
 * the CPU write row and the GPU sample row AGREE for every column: higher world-z → higher tz → higher
 * v → same row (unit-pinned in far_field.test.js so a v-flip regression trips fast).
 * @param {number} cx @param {number} cz @param {number} ox @param {number} oz @returns {number}
 */
export function mask_texel_index(cx, cz, ox, oz) {
  const tx = cx - ox
  const tz = cz - oz
  if (tx < 0 || tx >= MASK_CHUNKS || tz < 0 || tz >= MASK_CHUNKS) return -1
  return tz * MASK_CHUNKS + tx
}

/**
 * Creates the far-shell renderer bound to a scene. Builds ONE shared material at construction; each
 * section owns an indexed BufferGeometry + Mesh added straight to the scene.
 * @param {{ scene: Scene, impostors?: boolean, on_lod_dispose?: () => void, on_chunk_uploaded?: (bytes: number) => void }} options `impostors`
 *   (?impostors=1) mounts far trees; `on_lod_dispose` is the hitch hook at deferred geometry frees.
 * @returns {FarField}
 */
export function create_far_field({ scene, impostors: enable_impostors = false, on_lod_dispose, on_chunk_uploaded }) {
  const sun_direction = uniform(DEFAULT_SUN.clone())
  const clock = uniform(0) // seconds, advanced by tick() — drives the fade dither
  // 0=undrawn, 128=drawn boundary, 255=drawn with all four orthogonal neighbours drawn.
  const mask_data = new Uint8Array(MASK_CHUNKS * MASK_CHUNKS)
  const mask_texture = new DataTexture(mask_data, MASK_CHUNKS, MASK_CHUNKS, RedFormat, UnsignedByteType)
  mask_texture.magFilter = NearestFilter
  mask_texture.minFilter = NearestFilter
  mask_texture.needsUpdate = true
  const mask_origin = uniform(new Vector2(0, 0))
  /** @type {number | undefined} */ let mask_epoch
  /** @type {number | undefined} */ let mask_cam_x
  /** @type {number | undefined} */ let mask_cam_z
  const material = build_far_material(
    sun_direction,
    clock,
    mask_texture,
    mask_origin,
    /* fade_out */ false,
    MASK_CHUNKS,
    FADE_SECONDS
  )
  // DYING variant — same shading, reveal inverted (1→0). A retired section swaps to this + rebakes its
  // spawn_seconds to the retire clock so it dithers OUT over FADE_SECONDS (cross-fade, never a bare flash).
  const material_out = build_far_material(
    sun_direction,
    clock,
    mask_texture,
    mask_origin,
    /* fade_out */ true,
    MASK_CHUNKS,
    FADE_SECONDS
  )
  // [B3] Far-tree impostors (?impostors=1) — the forest-to-horizon billboard layer. Shares THIS shell's
  // fade clock, residency mask, and window so a section's impostors dither/mask in lockstep with its
  // geometry (upload/retire/remove/tick all delegate below). null ⇒ far shell only (byte-identical).
  const impostors = enable_impostors
    ? create_far_trees({
        scene,
        clock,
        mask_texture,
        mask_origin,
        mask_chunks: MASK_CHUNKS,
        on_geometry_disposed: on_lod_dispose,
      })
    : null

  /** @typedef {{ mesh: Mesh, bytes: number }} Resident */
  /** @type {Map<string, Resident>} */
  const resident = new Map()
  /** Sections mid fade-OUT: still rendered (dying material) until the clock passes their retire time +
   *  FADE_SECONDS, then disposed by tick(). NOT counted by section_count()/bytes() (they're leaving), so
   *  the streamer's accounting stays immediate — only the GPU free is deferred for the cross-fade.
   *  @type {{ mesh: Mesh, retire_at: number }[]} */
  const dying = []
  let total_bytes = 0

  // ── MESH POOL (P0 walk-OOM root fix, 2026-07-12) ──────────────────────────────────────────────────
  // Section Meshes are REUSED, never discarded. three r185's RenderObject registers a `dispose` listener
  // on its MATERIAL and only ever cleans itself up via material disposal or a cache-key miss on a LATER
  // render of the same mesh (renderers/common/RenderObject.js:346, RenderObjects.js:127) — so a one-shot
  // Mesh discarded against this shell's SHARED immortal material leaks its whole RenderObject graph
  // (mesh + geometry + 5 backing stores + bind groups + GPU buffers) into material._listeners forever.
  // Measured on a walk-OOM repro (heap-snapshot census, 5 min sweep): +2,294 Mesh / +12,489
  // JSArrayBufferData / +321 MB, every one retained by `LightsNode→RenderObject` ephemeron entries pinned
  // through the material listener list. Pooling bounds live Meshes to the churn peak ⇒ bounded
  // RenderObjects ⇒ dead geometries actually collect. The near terrain pool learned this same lesson
  // (NG-MEGA: never a per-chunk Mesh); the far shell predated it.
  /** @type {Mesh[]} */
  const mesh_pool = []
  /** Placeholder geometry for pooled (off-scene, never rendered) meshes so a released mesh doesn't pin
   *  its dead section geometry between reuses. */
  const EMPTY_GEOMETRY = new BufferGeometry()
  /** Geometry detached this frame and freed at the start of the next tick. Warmers are tagged so their
   *  boot cleanup never masquerades as a live LOD retirement. @type {{geometry: BufferGeometry, count_lod: boolean}[]} */
  const pending_dispose = []

  function flush_dispose() {
    for (const pending of pending_dispose) {
      pending.geometry.dispose()
      if (pending.count_lod) on_lod_dispose?.()
    }
    pending_dispose.length = 0
  }
  function acquire_mesh() {
    const pooled = mesh_pool.pop()
    if (pooled) return pooled
    const mesh = new Mesh(EMPTY_GEOMETRY, material)
    mesh.frustumCulled = true
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.matrixAutoUpdate = false // world coords baked into the geometry
    return mesh
  }
  /** @param {Mesh} mesh */
  function release_mesh(mesh) {
    mesh.geometry = EMPTY_GEOMETRY
    mesh.material = material // reset a retired mesh's dying material for its next life
    mesh_pool.push(mesh)
  }

  /** @param {Mesh} mesh */
  function defer_mesh(mesh) {
    const { geometry } = mesh
    release_mesh(mesh)
    pending_dispose.push({ geometry, count_lod: true })
  }

  /** Hard-drops a resident section immediately (detaches now, frees next tick). Used by the
   *  re-upload/replace path (a section replacing ITSELF — no cross-fade, the new mesh covers the same
   *  footprint) and dispose. Keep-set drop-outs go through retire() for the cross-fade instead.
   *  @param {string} id */
  function drop(id) {
    const r = resident.get(id)
    if (!r) return
    scene.remove(r.mesh)
    defer_mesh(r.mesh)
    total_bytes -= r.bytes
    resident.delete(id)
  }

  /** Retires a resident section into a fade-OUT: leaves it rendering under the DYING material (reveal
   *  1→0 from now) and disposes it once the clock passes retire+FADE_SECONDS. section_count()/bytes()
   *  drop immediately (it's removed from `resident`); only the mesh lingers for the cross-fade.
   *  @param {string} id */
  function retire(id) {
    const r = resident.get(id)
    if (!r) return
    total_bytes -= r.bytes
    resident.delete(id)
    // Rebake spawn_seconds = now so the dying material's `clock - spawn` starts at 0 (full → empty over FADE).
    const spawn_attr = /** @type {BufferAttribute} */ (r.mesh.geometry.getAttribute('spawn_seconds'))
    const spawn_array = /** @type {Float32Array} */ (spawn_attr.array)
    spawn_array.fill(clock.value)
    spawn_attr.needsUpdate = true
    r.mesh.material = material_out
    dying.push({ mesh: r.mesh, retire_at: clock.value })
  }

  /** Detaches any completed fade; geometry is freed at the start of the next tick. O(dying). */
  function reap_dying() {
    for (let i = dying.length - 1; i >= 0; i -= 1) {
      if (clock.value < dying[i].retire_at + FADE_SECONDS) continue
      scene.remove(dying[i].mesh)
      defer_mesh(dying[i].mesh)
      dying.splice(i, 1)
    }
  }

  return {
    /** [D221-FAR] Mounts 4 invisible one-triangle meshes covering every far-shell pipeline variant
     *  (2 vertex layouts × birth/dying material) so the boot pipeline pre-warm compiles them; returns
     *  a release fn (unmount + dispose). Without this the FIRST far section to appear compiles its
     *  pipeline SYNCHRONOUSLY mid-frame — the reported first-LOD multi-second freeze (2026-07-14). */
    mount_pipeline_warmers() {
      const release_impostor_warmers = impostors?.mount_pipeline_warmers()
      const warmers = build_warm_geometries().flatMap((geometry) =>
        [material, material_out].map((m) => {
          const mesh = new Mesh(geometry, m)
          mesh.matrixAutoUpdate = false
          // [2026-07-14 FAR-WARM regression fix] The warm triangles sit at the ORIGIN (all-zero positions);
          // the boot camera rarely frames (0,0,0), so with the default frustumCulled=true they get CULLED and
          // never compile. This was invisible while D221 warmed via `renderer.compileAsync` (which ignores
          // frustum culling), but the D1 shader-diet change drives the warm through a real `render_frame()` —
          // which culls — so the far pipelines stopped warming and every first far section SYNC-compiled its
          // 24 KB shader mid-walk (the reported "freezes when the LOD loads"). Force the warm meshes visible so
          // render_frame compiles their pipelines behind the boot veil; they're released the same tick.
          mesh.frustumCulled = false
          scene.add(mesh)
          return mesh
        })
      )
      return () => {
        const geometries = new Set(warmers.map((mesh) => mesh.geometry))
        for (const mesh of warmers) {
          scene.remove(mesh)
          mesh.geometry = EMPTY_GEOMETRY
        }
        for (const geometry of geometries) pending_dispose.push({ geometry, count_lod: false })
        release_impostor_warmers?.()
      }
    },

    upload_section(id, mesh) {
      drop(id) // whole-section swap (refinement/replacement)
      const built = build_section_geometry(mesh, clock.value)
      if (!built) return // no participating geometry (e.g. an empty sky layer)
      const section_mesh = acquire_mesh() // pooled — see the MESH POOL note (P0 walk-OOM root fix)
      section_mesh.geometry = built.geometry
      // FINER-WINS depth bias: SINK coarser sections a hair so the finer one wins the depth test over the
      // coarse substitute it refines (both render during the coarse→fine handoff; coplanar far water would
      // otherwise z-fight). Finest sits at true height; coarser sinks below — never raised above surface.
      // World coords are baked into the geometry, so we bake the tiny y offset into the mesh matrix once.
      section_mesh.position.y = -FAR_DEPTH_BIAS * (mesh.level - LOD_MIN_LEVEL)
      section_mesh.updateMatrix()
      scene.add(section_mesh)
      resident.set(id, { mesh: section_mesh, bytes: built.bytes })
      total_bytes += built.bytes
      on_chunk_uploaded?.(built.bytes)
      // [B3] Mirror the section's impostors (derived by the far worker, shipped on the mesh). Spawn = the
      // current fade clock so they dither IN with the section geometry. Empty/absent ⇒ no-op.
      if (impostors)
        impostors.upload_section(id, /** @type {*} */ (mesh).trees ?? { count: 0, data: EMPTY_TREES }, clock.value)
    },

    remove_section(id) {
      drop(id)
      impostors?.remove_section(id)
    },

    retire_section(id) {
      retire(id)
      impostors?.retire_section(id)
    },

    has(id) {
      return resident.has(id)
    },

    section_count() {
      return resident.size
    },

    bytes() {
      return total_bytes
    },

    set_sun_direction(sun) {
      sun_direction.value.copy(sun)
    },

    set_resident_mask(for_each_column, cam_chunk_x, cam_chunk_z, epoch) {
      const next_epoch = epoch ?? for_each_column.epoch?.()
      if (
        next_epoch !== undefined &&
        next_epoch === mask_epoch &&
        cam_chunk_x === mask_cam_x &&
        cam_chunk_z === mask_cam_z
      )
        return
      const radius = (MASK_CHUNKS - 1) / 2
      const ox = cam_chunk_x - radius
      const oz = cam_chunk_z - radius
      mask_data.fill(0)
      for_each_column((rec) => {
        const i = mask_texel_index(rec.cx, rec.cz, ox, oz)
        if (i >= 0) mask_data[i] = 128
      })
      /** @param {number} x @param {number} z */
      const drawn = (x, z) =>
        mask_data[Math.min(MASK_CHUNKS - 1, Math.max(0, z)) * MASK_CHUNKS + Math.min(MASK_CHUNKS - 1, Math.max(0, x))] >
        0
      for (let z = 0; z < MASK_CHUNKS; z += 1) {
        for (let x = 0; x < MASK_CHUNKS; x += 1) {
          const i = z * MASK_CHUNKS + x
          if (mask_data[i] && drawn(x - 1, z) && drawn(x + 1, z) && drawn(x, z - 1) && drawn(x, z + 1))
            mask_data[i] = 255
        }
      }
      mask_origin.value.set(ox, oz)
      mask_texture.needsUpdate = true
      mask_epoch = next_epoch
      mask_cam_x = cam_chunk_x
      mask_cam_z = cam_chunk_z
    },

    /**
     * TEST-ONLY: reads the mask byte for a world column (0 or 255) at the last window origin, -1 outside.
     * @param {number} cx @param {number} cz @returns {number}
     */
    _mask_value_at(cx, cz) {
      const i = mask_texel_index(cx, cz, mask_origin.value.x, mask_origin.value.y)
      return i >= 0 ? (mask_data[i] > 0 ? 255 : 0) : -1
    },

    _mask_interior_at(cx, cz) {
      const i = mask_texel_index(cx, cz, mask_origin.value.x, mask_origin.value.y)
      return i >= 0 && mask_data[i] === 255
    },

    tick(seconds) {
      flush_dispose()
      clock.value += seconds
      reap_dying() // free any section whose fade-OUT completed this frame
      impostors?.reap(seconds) // [B3] free impostor batches whose fade-out completed (shares this clock)
    },

    /** [B3] The near ring's live load radius (m) — drives the impostor radial near-fade so billboards hand
     *  off to the near ring's real voxel trees at the seam (no pop). No-op without the impostor layer.
     *  @param {number} radius_m */
    set_near_radius(radius_m) {
      impostors?.set_near_radius(radius_m)
    },

    /** [B3] Resident impostor tree count (HUD/perf), 0 without the layer. @returns {number} */
    impostor_count() {
      return impostors?.count() ?? 0
    },

    // TEMP DEBUG (2026-07-04 far-pop diagnosis): resident section ids, for the capture rig to diff
    // frame-to-frame and detect sections that appear-then-vanish (the reported under-foot pop).
    _debug_ids() {
      return [...resident.keys()]
    },

    dispose() {
      for (const id of [...resident.keys()]) drop(id)
      for (const d of dying) {
        scene.remove(d.mesh)
        defer_mesh(d.mesh)
      }
      dying.length = 0
      flush_dispose() // terminal teardown has no next tick
      mesh_pool.length = 0
      EMPTY_GEOMETRY.dispose()
      mask_texture.dispose()
      // material.dispose() fires three's onMaterialDispose on every RenderObject registered against the
      // shared materials — the pooled meshes' render state frees here (RenderObject.js:325).
      material.dispose()
      material_out.dispose()
      impostors?.dispose() // [B3]
    },
  }
}
