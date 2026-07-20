// ENG-16 Phase B — TACTICAL FIGHTBOARD GEOMETRY (the flat voxel-scale board mesh).
//
// Builds the board substrate as four InstancedMesh classes over the flat cave floor (D142) — the
// current-prod model (C fight-board-render.js), NOT the legacy in-place terrain flatten. Each cell is
// 2×2 blocks = 2 m (ENG-16's one deliberate divergence from L/C's 1 m); every world↔cell conversion
// carries cell_size. The shape_mask is authoritative and NON-RECTANGULAR (D75): holes are first-class
// (a missing cell, never an invisible-but-enforced rectangle — the cardinal sin the study calls out).
//
// The render classes:
//   WALKABLE — [D264b] ONE contiguous merged SLAB (floor + obstacle cells) with a procedurally baked
//              paving texture (thin seams, tonal patches, wear) + darker trim side skirts — the target
//              reference read: an arena slab placed IN the world, zero spacing between cells. Built by
//              board_surface.js (bake_board_surface + build_slab_geometry).
//   OBSTACLE — a raised block ON the paving (blocking terrain, the player SEES the wall).
//   HOLE     — a sunken pit (a gap, rendered as a recessed dark box so the player SEES the void).
//   EDGE     — a permanent count-0 placeholder (curbs deleted, D231).
// Substrate ≠ highlight: BLOCKED cells are geometry here (obstacle box / hole pit), the highlight
// channels (board_highlights.js) only ever paint reachable/range/path washes on top.
//
// GEOMETRY ONLY — no picking, no camera, no entities (siblings own those). Mounted through the engine
// scene handle (engine.add_to_scene / .get_scene). build() is idempotent: a same-args re-call is a
// cheap state-diff no-op (the reconcile-storm guarantee, contract v1.1); different args rebuild.
//
// Cell convention (contract v1.1, SEALED): Cell {x,y}, +x = east (+world X), +y = north (+world Z),
// board WORLD-AXIS-ALIGNED (no yaw). `origin` = world pos of cell (0,0)'s MIN corner; origin.y = the
// flat floor level. Cell center world = origin + ((x+0.5)·cs, 0, (y+0.5)·cs). One mapper, everything
// routes through cell_center_world so nothing disagrees (the study's "one mapper" law). 2026-07-04.

import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

import { bake_board_surface, bake_board_surface_gen, build_slab_geometry } from './board_surface.js'
import { emit_prop, make_prop_arrays, pick_archetype, pick_rotation } from './board_props.js'

/** Cell byte values in a flat mask (mirror of gen/fight_grid.js CELL_*). 0 = walkable floor,
 *  1 = obstacle (raised block), 2 = hole (pit). Any non-listed byte is treated as walkable. */
export const CELL_FLOOR = 0
export const CELL_OBSTACLE = 1
export const CELL_HOLE = 2
/** [D231 owner: "it's a square, which I forbid — deterministically shaped by the move module"] a VOID
 *  cell is OUTSIDE the board's shape entirely: no floor tile, no pit, unpickable — the deterministic
 *  grid encodes its non-rectangular outline as void cells around the playable shape. */
export const CELL_VOID = 3

/** Default world meters per cell edge — ENG-16 2×2 blocks. Carried on every conversion. */
export const DEFAULT_CELL_SIZE = 1.33 // [D231] Reduced cell size by 33% — the squares read too large; was 2 m

// ---- D167-B TERRAIN GROUNDING (the board seats ON the land at the fight site) ---------------------
// The board floor FOLLOWS the sampled terrain per cell, but QUANTIZED to subtle steps and CLAMPED to a
// tight relief band so the arena stays a readable tactical surface (the flat-arena refs) — never a
// hillside. Composed with the obstacle-height law: relief is a per-cell FLOOR offset; obstacle
// blocks / hole pits / curbs all ride their cell's floor. Values judged against the flat classic-arena
// reference bar — gentle undulation the eye reads as "pasted on real ground", not tactical chaos.
/** Height step the sampled terrain snaps to (m). One 2 m cell edge = one step ⇒ chunky, readable tiers. */
export const GROUND_STEP = 1.0
/** Max floor relief from the board's base plane (m), each way — total spread ≤ 2·this. Clamps a slope so
 *  the far side of a big board never towers over the near side (keeps the arena legible + framable). */
export const GROUND_MAX_RELIEF = 2.0

// ---- Substrate dimensions (world meters, relative to a 2 m cell) ----------------------------------
export const FLOOR_THICKNESS = 0.3 // [D291] the raised slab's height above the floor plane — raised off the land (the ground glitched through at 0.12); highlights clear it via FLOOR_CLEAR 0.37

// ---- BOARD LOOK ("look A" of a 3-option tactical-reference pass over
// board_reference_owner.jpg, plus his edge-softening amendment the same session) — warm limestone
// obstacle tones (OBSTACLE_TONES below), a chunkier 0.58×cell_size block, a subtle ±7% parity checker
// on the paving, and bevelled obstacle edges. The earlier A/B/C/current comparison switch is GONE — a
// shipped board never picks its own look at runtime.
const CHECKER_STRENGTH = 0.07 // parity-tint strength fed to board_surface.js's bake (0 = off)

// [retro 1.29 read: "obstacles are simple blocks half height, not custom masses of
// stones"] the DEFAULT obstacle is ONE clean block (a simple readable mass that blocks movement + LOS).
// (The board_props.js multi-voxel archetypes stay behind obstacle_style:'props' for later dungeon
// theming — a live-fight review found custom stone masses read as clutter on a board.)
const OBSTACLE_HEIGHT_RATIO = 0.58 // [design ruling 2026-07-20, option "A"] chunkier mass — was a half-height 0.5
const TILE_INSET = 0.14 // obstacle block footprint inset — a paving margin shows around the block's base
// [design ruling 2026-07-20: soften the edge of these cubes] the obstacle block is a
// RoundedBoxGeometry, not a sharp BoxGeometry — a small bevel + smooth corner normals kill the hard
// specular edge line a raw box reads as. radius is a FRACTION of cell_size (resolved per build call as
// `edge_radius` below) so the chamfer stays proportional across board sizes; segments stays at the
// addon's minimum — one extra edge loop is enough for the smooth-normal read at board-camera distance,
// and the perf law (ONE InstancedMesh / one draw call) doesn't care about a few hundred extra vertices
// on a geometry SHARED by every instance.
const EDGE_RADIUS_FRACTION = 0.06
const EDGE_SEGMENTS = 1
const HOLE_DEPTH = 1.8 // a hole is a DEEP dark SHAFT (a few blocks), not a shallow lid whose
// top face read as a green square. The shaft opening sits flush with the slab top and drops HOLE_DEPTH; its
// walls/floor are near-black and rendered BackSide so the fight camera sees INTO the recess (depth reads),
// while the closed far walls + bottom OCCLUDE the terrain beneath — the green ground can never show through.
const RIM_HEIGHT = 0.14 // soft earthy rim ringing the playable frame (replaces the hard gold curb)
const HOLE_INSET = 0.05 // pit footprint sits JUST inside the slab's hole-skirt so their faces never z-fight; the
// ~0.025 m rim it leaves at the opening is hidden behind the dark shaft wall from any interior view.
// [D264b] The floor itself has NO inset: it is one contiguous slab (board_surface.js) — the
// reference law: "no space" between cells; the grid reads through baked thin seams, never gaps.

// ---- Palette (props; the slab's paving palette lives in board_surface.js) -------------------------
const COLOR_TRIM = 0x827a60 // slab side skirts — darker worn stone (the raised-edge read at the land seam)
// [pick "A"] the DEFAULT half-block obstacle uses a small DETERMINISTIC warm
// limestone palette (3 tones picked per cell) for subtle non-uniformity WITHOUT breaking the simple
// clean-block silhouette — kin to the slab's own paving palette (board_surface.js); reads as blocking
// mass, never a bright "colored box". Was a cold cave-stone triplet pre-revision.
const OBSTACLE_TONES = [0x847a5e, 0x746c56, 0x94886a] // warm taupe limestone (pick "A")
const COLOR_OBSTACLE = 0x484450 // 'props'-style archetype base tint (board_props.js path; cave-rock gray-purple)
const COLOR_OBSTACLE_JITTER = 0.18 // 'props'-style per-cell tone wobble (archetype path only)
const COLOR_HOLE_RIM = 0x2c2d31 // shaft wall TOP — a shadowed-stone rim at the opening (the depth cue that reads as "looking IN"), NOT green
const COLOR_HOLE_FLOOR = 0x040506 // shaft BOTTOM — near-black void; the walls darken down into it so the recess reads as depth

/**
 * @typedef {object} BoardGeometryParams
 * @property {{ x: number, y: number, z: number }} origin world pos of cell (0,0) min-corner; y = floor level
 * @property {number} width grid width in cells
 * @property {number} height grid height in cells
 * @property {Uint8Array | number[]} mask row-major cell bytes (index = x + y*width); 0 floor / 1 obstacle / 2 hole
 * @property {number} [cell_size] world meters per cell edge (default 2)
 * @property {(cell_x: number, cell_y: number) => (number | null)} [ground_sample_y] D167-B: world-Y of
 *   the terrain surface under a cell centre (null if unstreamed / no ground). When given, the board's
 *   floor FOLLOWS the land per cell in quantized steps (see compute_cell_heights). Omit ⇒ flat at origin.y.
 * @property {'block' | 'props'} [obstacle_style] obstacle render: 'block' (default — a clean retro-style
 *   half-height block) or 'props' (the board_props.js multi-voxel archetypes; opt-in, later dungeon theming).
 */

/**
 * @typedef {object} BoardGeometry
 * @property {Object3D} group the scene node (add via engine.add_to_scene)
 * @property {number} width
 * @property {number} height
 * @property {number} cell_size
 * @property {{ x: number, y: number, z: number }} origin
 * @property {(x: number, y: number) => number} cell_byte mask byte at a cell (out-of-bounds → CELL_HOLE = void)
 * @property {(x: number, y: number) => boolean} is_walkable true only for in-bounds CELL_FLOOR cells
 * @property {(x: number, y: number) => [number, number, number]} cell_center_world THE single cell→world mapper
 * @property {() => [number, number, number]} centroid_world D167-B: the arena mask centroid in world space
 * @property {(next: BoardGeometryParams) => boolean} same_args cheap state-diff: true if next matches current
 * @property {() => boolean} bake_surface_step pump one slice of the deferred paving bake; true once fully
 *   baked (always true for the synchronous, non-deferred path). The fight board.build() pumps it per frame.
 * @property {() => void} dispose frees all instanced geometry/materials
 */

/** Row-major mask index (contract: index = x + y*width). @param {number} x @param {number} y @param {number} w */
export const mask_index = (x, y, w) => x + y * w

/**
 * Reads a mask byte, treating out-of-bounds as void (CELL_HOLE). Centralised so picking + geometry +
 * highlights all agree on the walkability shape (D75 — the mask carves the playable region).
 * @param {Uint8Array | number[]} mask
 * @param {number} x @param {number} y @param {number} width @param {number} height
 * @returns {number}
 */
export function read_cell(mask, x, y, width, height) {
  if (x < 0 || y < 0 || x >= width || y >= height) return CELL_HOLE
  return mask[mask_index(x, y, width)] ?? CELL_HOLE
}

/** Stable signature of a build request — drives the same-args cheap no-op (reconcile storms). The
 *  resolved per-cell RELIEF is folded in (not the sampler fn identity) so a terrain re-sample that
 *  actually MOVES the floor rebuilds, while a reconcile-storm re-call with the same land no-ops.
 *  @param {BoardGeometryParams} p @param {Float32Array} [relief] resolved per-cell relief (compute once) */
function signature(p, relief) {
  const cs = p.cell_size ?? DEFAULT_CELL_SIZE
  const o = p.origin
  const r = relief ?? compute_cell_heights(p.ground_sample_y, p.width, p.height)
  // mask + relief contribute as plain joins — both are small (≤ a few hundred cells) so this is cheap.
  return `${p.width}x${p.height}@${cs}|${o.x},${o.y},${o.z}|${p.obstacle_style ?? 'block'}|${Array.from(p.mask).join('')}|${Array.from(r).join(',')}`
}

/**
 * Builds the board substrate geometry for a mask. Pure geometry construction — the caller mounts
 * `group` into the scene. Counts each class, allocates exactly-sized InstancedMeshes, and writes one
 * instance matrix (+ checker color for the floor) per cell.
 * @param {BoardGeometryParams} params
 * @param {{ defer_surface?: boolean }} [opts] defer_surface (fight board): bake the paving texture in
 *   frame-sliced bands via `bake_surface_step()` instead of one ~10-27ms synchronous call — the material
 *   binds the blank texture now and it fills across frames (the fight-start freeze fix).
 * @returns {BoardGeometry}
 */
export function build_board_geometry(params, { defer_surface = false } = {}) {
  const { origin, width, height, mask } = params
  const cell_size = params.cell_size ?? DEFAULT_CELL_SIZE
  // D167-B: per-cell floor relief (quantized terrain-following offset off origin.y). All-zero when no
  // sampler / open sky, so the flat-board path is byte-identical to pre-D167-B.
  const relief = compute_cell_heights(params.ground_sample_y, width, height)
  const relief_at = (/** @type {number} */ x, /** @type {number} */ y) =>
    x >= 0 && y >= 0 && x < width && y < height ? relief[x + y * width] : 0
  const sig = signature(params, relief)

  const group = new Object3D()
  group.name = 'tactical_board'

  // THE single cell→world-center mapper (study §2 "one mapper" law). y is this cell's FLOOR PLANE —
  // origin.y PLUS the D167-B per-cell terrain relief, so highlights + entities that route through this
  // mapper follow the stepped land for free (they add their own micro-lifts on top). A void/out-of-mask
  // cell returns the base plane (relief 0). Callers wanting the raw base plane still use origin.y.
  const cell_center_world = (/** @type {number} */ x, /** @type {number} */ y) =>
    /** @type {[number, number, number]} */ ([
      origin.x + (x + 0.5) * cell_size,
      origin.y + relief_at(x, y),
      origin.z + (y + 0.5) * cell_size,
    ])

  // Count instances per class in one pass (exact-size InstancedMesh allocation).
  let n_floor = 0
  let n_obstacle = 0
  let n_hole = 0
  for (let i = 0; i < width * height; i += 1) {
    const b = mask[i] ?? CELL_VOID
    if (b === CELL_OBSTACLE) n_obstacle += 1
    else if (b === CELL_HOLE) n_hole += 1
    else if (b === CELL_VOID)
      continue // [D231] outside the shape — renders NOTHING
    else n_floor += 1
  }
  // [D231] the edge curbs are deleted ("dark half borders, not needed") — the edge mesh is a
  // permanent count-0 placeholder so downstream mesh/dispose plumbing stays untouched.
  const n_edge = 0

  // [D264b] THE SLAB — one contiguous merged surface (floor + obstacle cells) with the whole-board
  // baked paving texture on top and darker trim stone on the side skirts. Replaces the per-cell
  // instanced floor tiles (which read as separate blocks with gaps — the reference forbids that).
  const slab_geo = build_slab_geometry({
    mask,
    width,
    height,
    cell_size,
    origin,
    relief_at,
    thickness: FLOOR_THICKNESS,
  })
  // [fight-start freeze fix] the paving bake is ~10-27ms of synchronous texel work — the
  // dominant fight-start hitch (bench: fight_start_board_cost.spec.js). defer_surface (the live fight
  // board) runs it as a generator so board.build() can pump it in ≤8ms slices across frames behind the
  // intro hold; the slab material binds the blank texture NOW and it fills in. The synchronous default
  // path is byte-identical to before (Infinity band ⇒ one step).
  const surface_gen = defer_surface
    ? bake_board_surface_gen({ mask, width, height, checker_strength: CHECKER_STRENGTH })
    : null
  const slab_map = surface_gen
    ? /** @type {import('three').DataTexture} */ (surface_gen.next().value) // blank handle; bands fill it
    : bake_board_surface({ mask, width, height, checker_strength: CHECKER_STRENGTH })
  // OBSTACLE STYLE — default 'block' = a clean retro-style HALF-height block (a simple
  // readable blocking mass). 'props' opts into the board_props.js multi-voxel archetypes (kept for later
  // dungeon theming; a live-fight review found custom stone masses read as clutter on a normal board).
  const use_props = (params.obstacle_style ?? 'block') === 'props'
  const obstacle_h = cell_size * OBSTACLE_HEIGHT_RATIO
  const edge_radius = cell_size * EDGE_RADIUS_FRACTION
  const prop_arrays = make_prop_arrays() // filled in the fill loop only when use_props
  // DEFAULT half-block geometry (base translated to y=0 → base sits on the slab top at instancing) —
  // bevelled per EDGE_RADIUS_FRACTION/EDGE_SEGMENTS above (the edge-softening amendment).
  const block_geo = use_props
    ? null
    : new RoundedBoxGeometry(cell_size - TILE_INSET, obstacle_h, cell_size - TILE_INSET, EDGE_SEGMENTS, edge_radius)
  block_geo?.translate(0, obstacle_h / 2, 0)
  // HOLE — a DEEP dark SHAFT: its opening sits flush with the slab top and drops HOLE_DEPTH; near-black walls
  // rendered BackSide (below) so the camera sees INTO the recess (depth reads) and the ground never shows through.
  // 4 height segments give the shaft walls intermediate vertex rows so the baked vertical gradient renders
  // as a CURVE (bright rim → fast falloff to black), not a flat 2-row lerp — that curve is the depth read.
  const hole_geo = new BoxGeometry(cell_size - HOLE_INSET, HOLE_DEPTH, cell_size - HOLE_INSET, 1, 4, 1)
  paint_pit_gradient(hole_geo) // bakes a shadowed-stone rim at the opening fading down the walls into near-black void
  const edge_geo = new BoxGeometry(1, RIM_HEIGHT, 1) // per-face scaled below (soft rim along one edge)

  // vertexColors carry per-instance tint on the obstacle props (stone tone variation); the slab's look
  // is entirely its baked map + trim sides. The hole gradient is baked into its geometry above.
  // [D291] polygonOffset depth-bias (three's WebGPU backend maps it to pipeline depthBias) — belt-and-braces vs residual coplanar shimmer with the land beneath the raised slab.
  const slab_top_mat = new MeshStandardMaterial({
    map: slab_map,
    roughness: 0.96,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  const slab_side_mat = new MeshStandardMaterial({
    color: COLOR_TRIM,
    roughness: 0.95,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  const obstacle_mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 })
  // side: BackSide — render the shaft's INNER faces: the near wall stops occluding the view in, the far walls
  // + closed bottom always face the camera (near-black) and OCCLUDE the terrain behind → never a green show-through.
  const hole_mat = new MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0, side: BackSide })
  const edge_mat = new MeshStandardMaterial({ color: COLOR_TRIM, roughness: 1.0, metalness: 0.0 })

  const floor_mesh = new Mesh(slab_geo, [slab_top_mat, slab_side_mat])
  floor_mesh.userData.top_cell_count = n_floor + n_obstacle // slab covers floor + obstacle cells (props ON paving)
  const hole_mesh = new InstancedMesh(hole_geo, hole_mat, Math.max(1, n_hole))
  const edge_mesh = new InstancedMesh(edge_geo, edge_mat, Math.max(1, n_edge))
  // obstacle_mesh (board_obstacle) is built AFTER the fill loop (default: an InstancedMesh of the half-block;
  // 'props': a merged archetype Mesh). Collect the per-cell block placements while we walk the mask.
  /** @type {InstancedMesh | Mesh} */
  let obstacle_mesh
  /** @type {[number, number, number, number][]} */
  const block_instances = [] // [cx, base_y, cz, tone_index] per obstacle cell (default block mode)
  for (const m of [hole_mesh, edge_mesh]) m.instanceMatrix.setUsage(DynamicDrawUsage)
  for (const m of [floor_mesh, hole_mesh, edge_mesh]) {
    m.receiveShadow = true
    m.frustumCulled = false // the board is small + always framed by the iso cam; skip cull churn
    m.castShadow = false
  }
  floor_mesh.name = 'board_floor'
  hole_mesh.name = 'board_hole'
  edge_mesh.name = 'board_edge'

  const scratch = new Object3D() // hole instancing scratch
  const tmp_color = new Color() // per-cell obstacle stone tint
  const stone = new Color(COLOR_OBSTACLE)

  let hi = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const b = mask[mask_index(x, y, width)] ?? CELL_HOLE
      // D167-B: this cell's FLOOR PLANE Y = origin.y + terrain relief (from the mapper); every class'
      // vertical offset below is measured off `floor_y`, so obstacles/holes/checker all ride the land.
      const [cx, floor_y, cz] = cell_center_world(x, y)
      const h = cell_hash(x, y) // deterministic per-cell noise ∈ [0,1) (stable across rebuilds)
      if (b === CELL_OBSTACLE) {
        if (use_props) {
          // [opt-in, later dungeon theming] a multi-voxel archetype + 90° variant, deterministic per cell.
          const arch = pick_archetype(h)
          const rot = pick_rotation(cell_hash(y * 3 + 11, x * 5 + 7))
          tmp_color.copy(stone).offsetHSL((h - 0.5) * 0.05, 0, (h - 0.5) * 2 * COLOR_OBSTACLE_JITTER)
          emit_prop(prop_arrays, arch, rot, cx, cz, floor_y + FLOOR_THICKNESS, cell_size, tmp_color)
        } else {
          // DEFAULT — a clean half-block on the slab top; deterministic warm-limestone tone (3-tone palette).
          block_instances.push([
            cx,
            floor_y + FLOOR_THICKNESS,
            cz,
            Math.floor(h * OBSTACLE_TONES.length) % OBSTACLE_TONES.length,
          ])
        }
      } else if (b === CELL_HOLE) {
        // dark shaft: box TOP flush with the slab top (floor_y + FLOOR_THICKNESS), dropping HOLE_DEPTH downward.
        scratch.position.set(cx, floor_y + FLOOR_THICKNESS - HOLE_DEPTH / 2, cz)
        scratch.rotation.set(0, 0, 0)
        scratch.scale.set(1, 1, 1)
        scratch.updateMatrix()
        hole_mesh.setMatrixAt(hi++, scratch.matrix)
      }
      // [D264b] floor cells write NOTHING here — the contiguous slab (built above) IS the floor.
    }
  }

  // BUILD board_obstacle. DEFAULT: an InstancedMesh of the half-block (one draw call, deterministic tone per
  // cell). 'props': merge the collected archetypes into one Mesh. Either way n_obstacle==0 → an empty mesh
  // that draws nothing but keeps the name/dispose plumbing (like the count-0 edge placeholder).
  if (use_props) {
    const obstacle_geo = new BufferGeometry()
    obstacle_geo.setAttribute('position', new BufferAttribute(new Float32Array(prop_arrays.positions), 3))
    obstacle_geo.setAttribute('normal', new BufferAttribute(new Float32Array(prop_arrays.normals), 3))
    obstacle_geo.setAttribute('color', new BufferAttribute(new Float32Array(prop_arrays.colors), 3))
    obstacle_geo.setIndex(prop_arrays.indices)
    obstacle_mesh = new Mesh(obstacle_geo, obstacle_mat)
    obstacle_mesh.userData.obstacle_count = n_obstacle // merged Mesh has no InstancedMesh .count — expose the tally
  } else {
    const obm = new InstancedMesh(/** @type {RoundedBoxGeometry} */ (block_geo), obstacle_mat, Math.max(1, n_obstacle))
    obm.instanceMatrix.setUsage(DynamicDrawUsage)
    for (let i = 0; i < block_instances.length; i += 1) {
      const [bx, by, bz, ti] = block_instances[i]
      scratch.position.set(bx, by, bz)
      scratch.rotation.set(0, 0, 0)
      scratch.scale.set(1, 1, 1)
      scratch.updateMatrix()
      obm.setMatrixAt(i, scratch.matrix)
      obm.setColorAt(i, tmp_color.set(OBSTACLE_TONES[ti]))
    }
    obm.instanceMatrix.needsUpdate = true
    if (obm.instanceColor) obm.instanceColor.needsUpdate = true
    obm.count = n_obstacle
    obstacle_mesh = obm
  }
  obstacle_mesh.name = 'board_obstacle'
  obstacle_mesh.receiveShadow = true
  obstacle_mesh.castShadow = true // the obstacle casts a soft shadow onto the tan floor → reads as raised
  obstacle_mesh.frustumCulled = false

  // [D231] The D167-B/D179 dark half-border edge curbs read as unnecessary clutter and are
  // DELETED — the board's silhouette is carried by the floor tiles themselves; no rim ring. The
  // edge_mesh stays allocated (count 0) so the mesh plumbing/dispose paths are untouched.

  hole_mesh.instanceMatrix.needsUpdate = true
  edge_mesh.instanceMatrix.needsUpdate = true
  // Hide any degenerate (count-0) instanced mesh so its 1-slot placeholder never draws at the origin.
  hole_mesh.count = n_hole
  edge_mesh.count = n_edge

  group.add(floor_mesh, obstacle_mesh, hole_mesh, edge_mesh)

  return {
    group,
    width,
    height,
    cell_size,
    origin,
    cell_byte: (x, y) => read_cell(mask, x, y, width, height),
    is_walkable: (x, y) => read_cell(mask, x, y, width, height) === CELL_FLOOR,
    cell_center_world,
    // D167-B: the arena's mask centroid in WORLD space (floor plane at the centroid), the anchor the iso
    // camera frames + the occlusion prism casts onto. Fractional-cell centroid → interpolated floor Y.
    centroid_world() {
      const { cx, cy } = mask_centroid(mask, width, height)
      const bx = Math.max(0, Math.min(width - 1, Math.floor(cx)))
      const by = Math.max(0, Math.min(height - 1, Math.floor(cy)))
      return /** @type {[number, number, number]} */ ([
        origin.x + (cx + 0.5) * cell_size,
        origin.y + relief_at(bx, by),
        origin.z + (cy + 0.5) * cell_size,
      ])
    },
    /** Pump ONE slice of the deferred paving bake (defer_surface only); returns true once fully baked.
     *  Always true for the synchronous path (already baked). The fight board.build() calls this per frame. */
    bake_surface_step: () => (surface_gen ? Boolean(surface_gen.next().done) : true),
    same_args: (next) => signature(next) === sig,
    dispose() {
      for (const geo of [slab_geo, obstacle_mesh.geometry, hole_geo, edge_geo]) geo.dispose()
      for (const mat of [slab_top_mat, slab_side_mat, obstacle_mat, hole_mat, edge_mat]) mat.dispose()
      slab_map.dispose()
      group.clear()
    },
  }
}

/** A solid (floor OR obstacle) cell is "solid"; a hole/out-of-bounds is void. Curbs sit on solid↔void seams. */
const is_solid_byte = (/** @type {number} */ b) => b === CELL_FLOOR || b === CELL_OBSTACLE

/**
 * Bakes a vertical gradient into the pit BoxGeometry: a faint dark-slate EDGE LINE at the very top rim
 * (COLOR_HOLE_RIM) fading to near-black (COLOR_HOLE_FLOOR) down the shaft, so the recess reads as depth
 * (the rim line catches the eye, the walls go to void) — never a green square. Adds a `color` attr.
 * @param {import('three').BufferGeometry} geo a BoxGeometry of height HOLE_DEPTH centred on the origin
 */
function paint_pit_gradient(geo) {
  const pos = geo.getAttribute('position')
  const top = new Color(COLOR_HOLE_RIM)
  const bottom = new Color(COLOR_HOLE_FLOOR)
  const c = new Color()
  const colors = new Float32Array(pos.count * 3)
  const half = HOLE_DEPTH / 2
  for (let v = 0; v < pos.count; v += 1) {
    const t = Math.pow((pos.getY(v) + half) / HOLE_DEPTH, 2.4) // 0 bottom → 1 top; the rim tone lives near the opening and falls off fast down the shaft (curve = depth read)
    c.copy(bottom).lerp(top, Math.max(0, Math.min(1, t)))
    colors[v * 3] = c.r
    colors[v * 3 + 1] = c.g
    colors[v * 3 + 2] = c.b
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3))
}

/**
 * D167-B — CENTROID of the ARENA (center of mass of walkable + obstacle cells). The masks are
 * irregular orthogonally-convex shapes (holes/notches), so the bbox center can sit off the arena or in
 * a pit; the centroid tracks where the tiles actually ARE, which is what the iso camera must frame.
 * Pure over the mask: averages the CELL-INDEX coords of every non-void cell (floor OR obstacle — both
 * are standable/occupied surface; holes are void and excluded). Returns { cx, cy } in CELL space (not
 * world) — the caller maps it through cell_center_world. Falls back to the bbox center for an all-void
 * mask (degenerate; never happens for a real board). @param {Uint8Array|number[]} mask @param {number}
 * width @param {number} height @returns {{ cx: number, cy: number }}
 */
export function mask_centroid(mask, width, height) {
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (is_solid_byte(read_cell(mask, x, y, width, height))) {
        sx += x
        sy += y
        n += 1
      }
    }
  }
  if (n === 0) return { cx: (width - 1) / 2, cy: (height - 1) / 2 }
  return { cx: sx / n, cy: sy / n }
}

/**
 * D167-B — per-cell FLOOR RELIEF (world-meter Y offset from the board's base plane, origin.y). Samples
 * the real terrain surface under each cell via `ground_sample_y`, then QUANTIZES to GROUND_STEP and
 * CLAMPS to ±GROUND_MAX_RELIEF so the board's floor FOLLOWS the land in subtle readable steps without
 * ever becoming a hillside (the flat-arena refs). The base plane is the MEDIAN sampled height (robust to
 * an outlier peak/pit under one cell) so the board sits centred on the site; relief is measured off it.
 * Returns a Float32Array of length width·height (row-major) of relief offsets in metres. When no sampler
 * is supplied, or NO cell resolves a surface, every offset is 0 (a flat board at origin.y — the demo's
 * open-sky pose + the pre-D167-B behaviour, so grounding is purely additive).
 * @param {((cell_x: number, cell_y: number) => (number | null)) | undefined} ground_sample_y world-Y of
 *   the terrain surface at a cell centre, or null if unstreamed / no ground (skip canopy — spawn.js
 *   discipline). Pass undefined for a flat board.
 * @param {number} width @param {number} height
 * @returns {Float32Array}
 */
export function compute_cell_heights(ground_sample_y, width, height) {
  const relief = new Float32Array(width * height) // default 0 = flat at origin.y
  if (!ground_sample_y) return relief
  const samples = /** @type {(number | null)[]} */ (new Array(width * height).fill(null))
  const present = /** @type {number[]} */ ([])
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s = ground_sample_y(x, y)
      if (s !== null && Number.isFinite(s)) {
        samples[x + y * width] = s
        present.push(s)
      }
    }
  }
  if (present.length === 0) return relief // nothing resolved (open sky / unstreamed) → flat
  const base = median(present) // robust reference plane — the board seats centred on the site
  for (let i = 0; i < relief.length; i += 1) {
    const s = samples[i]
    // A cell with no surface (a gap under the board) inherits the base plane (relief 0) rather than
    // punching a random hole — the mask, not the terrain, decides where the board's own holes are.
    const raw = s === null ? 0 : s - base
    const stepped = Math.round(raw / GROUND_STEP) * GROUND_STEP
    relief[i] = Math.max(-GROUND_MAX_RELIEF, Math.min(GROUND_MAX_RELIEF, stepped))
  }
  return relief
}

/** Median of a numeric list (mutates a copy). @param {number[]} xs @returns {number} */
function median(xs) {
  const a = [...xs].sort((p, q) => p - q)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/**
 * Deterministic per-cell noise ∈ [0,1) — a cheap integer hash so per-tile jitter (height/tone/rim) is
 * STABLE across rebuilds (a same-args rebuild reproduces the identical board; the reconcile-storm
 * guarantee). @param {number} x @param {number} y @returns {number}
 */
function cell_hash(x, y) {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263 // two large primes
  n = (n ^ (n >>> 13)) * 1274126177
  n = n ^ (n >>> 16)
  return ((n >>> 0) % 100000) / 100000
}
