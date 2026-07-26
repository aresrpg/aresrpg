// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-16 Phase B — TACTICAL BOARD HIGHLIGHTS (per-cell gradient tiles, rounded corners, per channel).
//
// The current-prod CPU-flat-tile model (C fight-overlay.js), ported to WebGPU: each cell in a channel
// is a flat PlaneGeometry laid on the floor plane with a translucent NodeMaterial (transparent,
// depthWrite:false, DoubleSide). Channels remain independent render groups, but the frontend projection
// emits exactly ONE base channel per cell; only glyph/trap may layer over it. renderOrder mirrors that law
// defensively and never resolves semantics at draw time. The engine ONLY paints — the dapp computes every
// cell set (BFS/LoS/AoE); the engine gets WHAT, never WHY (contract). Out-of-mask cells are ignored.
//
// ONE DESIGN LANGUAGE for every cell highlight:
//   • INNER GRADIENT per cell — a saturated color at the cell RIM fading toward a darker + more
//     transparent CENTER (rim-bright variant, chosen over the inverse after the ref2 punch A/B). Reads
//     instantly on the warm-tan board; never wishy-washy (his refs = punchy, opaque).
//   • SLIGHTLY ROUNDED CORNERS — each cell's highlight quad gets ~18% rounded corners, computed as a
//     signed-distance rounded-rect alpha mask in the TILE SHADER (cheap, resolution-independent — NOT
//     geometry). SCOPE: BOARD-CELL-HIGHLIGHTS-ONLY — a DELIBERATE, dated override of the zero-border-
//     radius house rule, confined to these overlay tiles (it does NOT relax sharp corners anywhere
//     else in the app). DO NOT "fix" these back to sharp edges — this is a deliberate, requested
//     rounding on cell highlights (cto flagged this in v1.2 review notes too).
//   • FOUR owner-named highlight classes share the construction: movement/mp_range (GREEN),
//     targetable 'target' (DARK BLUE), 'los_blocked' (LIGHT BLUE — LoS required by the spell yet the
//     cell is non-targetable), and AoE-hover 'aoe' (RED — the zone under the spell cursor).
//
// TWO naming faces onto ONE channel table: the §7 CellState vocabulary (highlight/path/aoe/start_a/
// start_b/blocked) and the sealed v1.1 layer names (placement/range/path/target/mp_range) + the
// SEALED v1.2 'los_blocked' layer (additive; the dapp computes LOS legality and calls highlight —
// the engine only renders it). Hover-AoE rides the existing 'aoe' state (the dapp clears+sets it per
// hover; the engine paints it red). 'target' stays the dark-blue TARGETABLE state. Both naming faces
// route through set_channel; the board handle exposes set_cell_state (§7) and highlight(layer,cells,
// on) (v1.1/v1.2) over it. An unknown layer no-ops (a name the dapp sends before the engine ships it
// must not throw). Distinct colors per channel are the acceptance requirement. 2026-07-05.

import { Color, DoubleSide, Mesh, Object3D, PlaneGeometry } from 'three'
import { Fn, float, max, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl'

// NIGHT-WASH FIX: route every highlight mesh onto the POST-AgX overlay layer (board_highlight_overlay_pass.js)
// so its colour is composited at a FIXED exposure AFTER the tonemap, immune to the day↔night exposure swing.
import { route_board_highlight_overlay } from '../render/board_highlight_overlay_pass.js'

import { CELL_HOLE } from './board.js'
import {
  TRAP_SPIKE_HEIGHT,
  TRAP_SPIKE_RADIUS,
  make_diamond_texture,
  make_entity_anchor_material,
  make_gradient_tile_material,
  make_merge_aware_channel,
  make_outline_material,
  make_trap_blob_material,
  make_trap_spike_geometry,
  make_trap_spike_material,
  make_unlit_overlay_material,
} from './board_highlight_materials.js'
import { CORNER_RADIUS, EDGE_SOFTNESS, ENTITY_ANCHOR_RENDER_ORDER, neighbor_mask } from './board_highlight_shapes.js'
import { CHANNEL_KEYS, CHANNELS, TEAM_COLORS, resolve_fade } from './board_highlight_style.js'

export { TRAP_BLOB_COLOR, TRAP_BLOB_OPACITY, trap_blob_alpha } from './board_highlight_materials.js'
export {
  CORNER_RADIUS,
  ENTITY_ANCHOR_EDGE_OPACITY,
  ENTITY_ANCHOR_EDGE_WIDTH,
  ENTITY_ANCHOR_FILL_OPACITY,
  ENTITY_ANCHOR_RENDER_ORDER,
  edges_of_mask,
  entity_anchor_cell_alpha,
  merged_rect_gradient,
  neighbor_mask,
  rounded_rect_gradient,
} from './board_highlight_shapes.js'
export {
  CHANNEL_KEYS,
  CHANNELS,
  CELL_LAYER_ORDER,
  DEFAULT_CENTER_STYLE,
  FADE_DEFAULTS,
  GLYPH_TICK_FLARE,
  TEAM_COLORS,
  resolve_fade,
  resolve_highlight_style,
} from './board_highlight_style.js'

/** [D241 cto pixel-root] BASE clearance so EVERY wash clears the slab TOP. [D291] the merged slab top
 *  sits at origin.y + FLOOR_THICKNESS (0.3, raised off the land); the old lift `WASH_LIFT*(order+1)`
 *  buried the LOW orders (mp_range=order1 → 0.06) UNDER the slab on the voxel cave board — the
 *  light-green MP-reach never rendered. FLOOR_CLEAR (0.37) lifts the whole stack above the slab top
 *  (0.07 headroom); WASH_LIFT then separates channels by paint order (renderOrder does the real
 *  transparency ordering — this micro-step only separates sanctioned glyph/trap overlays from the base).
 *  Kept tight so the top channel never visibly floats. */
const FLOOR_CLEAR = 0.37
const WASH_LIFT = 0.012
// Tile edge as a fraction of the cell — the highlight quad slightly overfills grout so the rounded
// corners of neighbouring in-channel cells kiss into a continuous rounded field (a zone reads as ONE
// shape, ref2), not a grid of isolated pills. The SDF corner rounding lives inside this quad.
const TILE_FRACTION = 1.0

/**
 * Default per-cell tile factory shared by every wash/outline channel: ONE flat Mesh at the given world
 * position (add_tile positions/orders it). The 'trap' channel overrides this with build_trap_marker (a
 * compound blob+sprite Group) — see the channel-construction loop in create_board_highlights.
 * @param {import('three').BufferGeometry} geo @param {import('three').Material} mat
 * @param {(order: number) => number} render_order_of
 * @returns {(cx: number, cy: number, cz: number, order: number) => Mesh}
 */
function make_flat_build(geo, mat, render_order_of) {
  return (cx, cy, cz, order) => {
    const tile = new Mesh(geo, mat)
    tile.position.set(cx, cy, cz)
    tile.renderOrder = render_order_of(order)
    tile.frustumCulled = false
    return tile
  }
}

/** Stable string key for a cell, for Map/Set membership. MUST match board_highlight_shapes.js's
 *  neighbor_mask contract ("a Set of 'x,y' keys") — the two modules don't share a binding (shapes.js
 *  stays a pure leaf with zero deps on this controller), just this trivial, stable string format. */
const cell_key = (/** @type {number} */ x, /** @type {number} */ y) => `${x},${y}`

/** [#164] Per-cell tile factory for a MERGE-AWARE channel (currently 'glyph' + 'glyph_hover', [#238] its
 *  hover-preview sibling — any CHANNELS.<x>.merge:true row):
 *  picks the pre-built material variant matching this tile's neighbor mask (`mat_of` — a lazy ≤16-entry
 *  cache, see board_highlight_materials.js's make_merge_aware_channel) instead of one fixed material.
 *  Otherwise identical to make_flat_build. The grid→mask computation itself (neighbor_mask) is pure
 *  shape-adjacency math and lives in board_highlight_shapes.js, next to merged_rect_gradient.
 * @param {import('three').BufferGeometry} geo @param {(mask: number) => import('three').Material} mat_of
 * @param {(order: number) => number} render_order_of
 * @returns {(cx: number, cy: number, cz: number, order: number, mask?: number) => Mesh} */
function make_merged_flat_build(geo, mat_of, render_order_of) {
  return (cx, cy, cz, order, mask = 0) => {
    const tile = new Mesh(geo, mat_of(mask))
    tile.position.set(cx, cy, cz)
    tile.renderOrder = render_order_of(order)
    tile.frustumCulled = false
    return tile
  }
}

/**
 * @typedef {object} HighlightController
 * @property {Object3D} group scene node holding every channel group (add via engine.add_to_scene)
 * @property {(cells: { x: number, y: number }[], channel: string) => void} set_channel replace a channel's cells
 * @property {(channel: string, cells: { x: number, y: number }[], on: boolean) => void} toggle add/remove cells in a channel
 * @property {(channel?: string) => void} clear clear one channel, or all when omitted
 * @property {(cells: { x: number, y: number }[], opts?: { color?: number, peak?: number }) => void} pulse_cells [D242] scale-pop emphasis
 * @property {(cell: { x: number, y: number }) => void} flash_cell [D242] your-turn ground flash on one cell
 * @property {(cells?: { x: number, y: number }[]) => void} flash [D242] broad turn-start flash (whole footprint default)
 * @property {(cells: { x: number, y: number }[], opts?: { origin?: {x:number,y:number}, speed?: number, color?: number, peak?: number }) => void} ripple [D257] AoE ripple (staggered per-cell pop)
 * @property {(dt: number) => void} tick [D242] advance the feel-cue animations
 * @property {(id: string, world_xz: { x: number, z: number }, team?: number) => void} set_entity_anchor
 *   [entity-anchor] create/reposition an entity's LIVE follow marker — call every frame with its
 *   CURRENT render XZ (never the destination cell) so the marker is physically unable to pre-jump
 *   ahead of the walk. `team` (0 = ally, else enemy — mirrors board_entities' outline color pick)
 *   selects the marker's color ONCE at first creation for this id (a fighter never changes team, so
 *   later calls ignore it); omitted defaults to the enemy material
 * @property {(id: string) => void} clear_entity_anchor [entity-anchor] remove an entity's follow marker (death/remove)
 * @property {(channel: string) => number} _fade_of TEST/BENCH — a channel's fade envelope value (0..1)
 * @property {(id: string) => ({ x: number, z: number } | null)} _anchor_position_of TEST/BENCH — an
 *   entity anchor's current world XZ, or null if untracked
 * @property {(id: string) => (boolean | null)} _anchor_is_ally TEST/BENCH — true if the tracked anchor
 *   is using the ALLY material (TEAM_COLORS.ally), false if ENEMY, null if untracked
 * @property {() => void} dispose frees every tile geometry/material
 */

/**
 * Creates the highlight controller for a board. Pre-builds one shared PlaneGeometry (all tiles reuse
 * it) and one gradient/rounded NodeMaterial per channel; cells are painted by adding/removing
 * lightweight Meshes into the channel's group. Idempotent per channel: set_channel replaces, toggle
 * adds/removes by cell key. Unknown channels no-op (v1.2 forward-compat: a future layer name the dapp
 * sends before the engine ships it must not throw — it silently paints nothing).
 *
 * @param {object} board
 * @param {(x: number, y: number) => [number, number, number]} board.cell_center_world THE cell→world mapper
 * @param {(x: number, y: number) => number} board.cell_byte mask byte at a cell (out-of-bounds → void)
 * @param {number} [board.width] board cell width (for flash() default). @param {number} [board.height] board cell height.
 * @param {{ x: number, y: number, z: number }} board.origin floor plane = origin.y
 * @param {number} board.cell_size
 * @param {{ reversed_depth?: boolean }} [options] renderer depth mode; Three reverses transparent lists in reversed-Z
 * @returns {HighlightController}
 */
export function create_board_highlights(board, { reversed_depth = false } = {}) {
  const { cell_center_world, cell_byte, origin, cell_size } = board
  // Three reverses the whole transparent render list for reversed-Z cameras. Mirror semantic orders before that
  // reversal so both renderer modes draw low washes first, then traps, then fighter anchors.
  const render_order_of = (/** @type {number} */ order) => (reversed_depth ? -order : order)
  const group = new Object3D()
  group.name = 'board_highlights'

  // one shared tile geometry, rotated flat (XZ plane). PlaneGeometry is in XY; rotate −90° about X.
  // uv() runs 0..1 across this quad — the material's rounded-rect SDF + inner gradient key off it.
  const tile_geo = new PlaneGeometry(cell_size * TILE_FRACTION, cell_size * TILE_FRACTION)
  tile_geo.rotateX(-Math.PI / 2)
  // the selection diamond fills (nearly) the whole cell — a separate full-size geo + a frame texture.
  const diamond_geo = new PlaneGeometry(cell_size * 0.98, cell_size * 0.98)
  diamond_geo.rotateX(-Math.PI / 2)
  const diamond_tex = make_diamond_texture()

  // [entity-anchor] TWO pre-built materials, one per TEAM_COLORS entry — a fighter never changes
  // team, so set_entity_anchor picks once at CREATE and never swaps. Both share tile_geo: the cell
  // marker is a fragment-mask within the same cell-sized quad the action tiles use, just a different
  // mask shape (entity_anchor_cell_alpha) and a team-specific color.
  const anchor_mat_ally = make_entity_anchor_material(TEAM_COLORS.ally)
  const anchor_mat_enemy = make_entity_anchor_material(TEAM_COLORS.enemy)
  /** @type {Map<string, { mesh: Mesh }>} */
  const anchors = new Map()
  // [seat-on-ground] fixes the team-color blob floating too high — it should sit on
  // the ground. The Y-lift was FLOOR_CLEAR + WASH_LIFT*ENTITY_ANCHOR_RENDER_ORDER (0.466) — 0.166 above the
  // slab top (0.3), so under an idle fighter with no wash beneath it the team quad visibly floated at ankle
  // height on the faux-iso cam. Y no longer needs to clear the whole wash stack: the anchor's on-top read is
  // owned by renderOrder ENTITY_ANCHOR_RENDER_ORDER (8, set on the mesh below — LessEqualDepth lets the
  // last-drawn transparent win over a co-planar wash), NOT by sitting physically higher. Seat it on the
  // ground-wash plane (FLOOR_CLEAR + one WASH_LIFT micro-step, the same 0.07 headroom every action wash the
  // owner is happy with uses) so it reads as painted ON the tile, while depthTest (ON — see the material)
  // still lets the avatar's legs occlude it correctly.
  const ANCHOR_LIFT = FLOOR_CLEAR + WASH_LIFT

  // [trap marker — design correction 2026-07-19: the soft shadow blob read as ugly; use a cell highlight
  // and a spike instead]. SUPERSEDES the organic-stain +
  // bear-trap-sprite form (that soft organic blob read as an ugly shadow). NOW a compound TWO-LAYER marker:
  //   1. BASE — [#1043] a DARK, cell-bounded gradient-tile HIGHLIGHT (make_trap_blob_material — the shared
  //      wash idiom): the cell reads as punched out of the pale paving, at noon and at midnight alike.
  //   2. ACCENT — a small SPIKE (an upright cone, make_trap_spike_*) rising from the cell center, in the
  //      identity gold — the contrasted mark ON that dark base, and what makes the cell a TRAP and not a hole.
  // Routes through the SAME set_channel/add_tile path as every wash (zero adapter/visibility change — the
  // caster-only trap_overlay logic is untouched); add_tile calls the channel's `build` factory, which for
  // 'trap' is build_trap_marker below — a tiny Group [blob mesh, spike mesh] instead of the single flat
  // Mesh every other channel's build (make_flat_build) returns.
  const trap_spike_geo = make_trap_spike_geometry(cell_size * TRAP_SPIKE_RADIUS, cell_size * TRAP_SPIKE_HEIGHT)
  const trap_spike_mat = make_trap_spike_material()
  const trap_blob_mat = make_trap_blob_material()
  /** [trap marker] per-cell factory: a Group holding the dark blob (drawn first) + the spike (drawn just
   *  after, `order + 0.1`, so it never sinks under the blob within the shared 'trap' render bucket). Both
   *  meshes share ONE geo/mat pair each across every trap cell, exactly like every other channel. */
  const build_trap_marker = (
    /** @type {number} */ cx,
    /** @type {number} */ cy,
    /** @type {number} */ cz,
    /** @type {number} */ order
  ) => {
    const g = new Object3D()
    const blob = new Mesh(tile_geo, trap_blob_mat)
    blob.renderOrder = render_order_of(order)
    blob.frustumCulled = false
    const spike = new Mesh(trap_spike_geo, trap_spike_mat)
    spike.renderOrder = render_order_of(order + 0.1)
    spike.frustumCulled = false
    g.add(blob, spike)
    g.position.set(cx, cy, cz)
    return g
  }

  /** @type {Map<string, { group: Object3D, mat: { dispose(): void }, u_fade: * | null, fade: { cur: number, target: number, clearing: boolean, fade_in_s: number, fade_out_s: number }, build: (cx: number, cy: number, cz: number, order: number, mask?: number) => Object3D, cells: Map<string, Object3D> }>} */
  const channels = new Map()
  for (const key of CHANNEL_KEYS) {
    const spec = CHANNELS[key]
    const cg = new Object3D()
    cg.name = `highlight_${key}`
    cg.renderOrder = render_order_of(spec.order)
    const built =
      /** @type {{ mat: { dispose(): void }, u_fade: * | null, mat_of?: (mask: number) => import('three').Material }} */ (
        key === 'trap'
          ? { mat: trap_spike_mat, u_fade: null } // [trap marker] dark blob + spike — no wash fade
          : spec.outline
            ? { mat: make_outline_material(spec, diamond_tex), u_fade: null } // selection frame — no fade
            : spec.merge
              ? make_merge_aware_channel(spec) // [#164] lazy ≤16 neighbor-mask material variants, one shared fade
              : make_gradient_tile_material(spec) // D150 gradient + rounded-corner tile (+ [D253-2] fade uniform)
      )
    // `build(cx,cy,cz,order[,mask])` returns the ONE Object3D add_tile adds per cell — a flat Mesh for
    // every wash/outline channel (merge-aware channels' Mesh picks its material by neighbor mask instead
    // of a fixed material); for 'trap' the compound blob+sprite Group (build_trap_marker) instead. The
    // special case lives HERE (one factory pick), not sprinkled through add_tile/remove_tile/clear_channel.
    const build =
      key === 'trap'
        ? build_trap_marker
        : spec.merge
          ? make_merged_flat_build(
              tile_geo,
              /** @type {(mask: number) => import('three').Material} */ (built.mat_of),
              render_order_of
            )
          : make_flat_build(
              spec.outline ? diamond_geo : tile_geo,
              /** @type {import('three').Material} */ (built.mat),
              render_order_of
            )
    channels.set(key, {
      group: cg,
      mat: built.mat,
      u_fade: built.u_fade,
      // per-channel envelope CLOCKS resolved ONCE from the style SSOT (M3: paint grammar constants live in
      // board_highlight_style — FADE_DEFAULTS + optional per-channel fade_in_s/fade_out_s, all OWNER-TUNE).
      fade: { cur: 1, target: 1, clearing: false, ...resolve_fade(spec) },
      build,
      cells: new Map(),
    })
    group.add(cg)
  }

  /** True if a cell is in-bounds and NOT void (paintable). cell_byte already maps out-of-bounds → void. */
  const paintable = (/** @type {number} */ x, /** @type {number} */ y) => cell_byte(x, y) !== CELL_HOLE
  /** [D242] every paintable cell (flash() default target). @returns {{x:number,y:number}[]} */
  const all_paintable_cells = () => {
    const out = []
    const w = board.width ?? 0,
      h = board.height ?? 0
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (paintable(x, y)) out.push({ x, y })
    return out
  }

  const add_tile = (
    /** @type {any} */ ch,
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {number} */ order,
    /** @type {number} */ mask = 0 // [#164] neighbor mask — only consumed by a merge-aware channel's build
  ) => {
    const k = cell_key(x, y)
    if (ch.cells.has(k)) return
    if (!paintable(x, y)) return // silently ignore out-of-mask cells (contract)
    const [cx, , cz] = cell_center_world(x, y)
    // [D241] base clearance + per-order stack; `build` is the channel's tile factory (flat Mesh for every
    // wash/outline channel, the compound blob+sprite Group for 'trap' — make_flat_build/build_trap_marker;
    // [#164] a merge-aware channel's make_merged_flat_build reads `mask` to pick its material variant).
    const tile = ch.build(cx, origin.y + FLOOR_CLEAR + WASH_LIFT * order, cz, order, mask)
    route_board_highlight_overlay(tile) // POST-AgX overlay: layer 11 + depth flags (night-wash fix; traverses trap groups)
    ch.group.add(tile)
    ch.cells.set(k, tile)
  }

  const remove_tile = (/** @type {any} */ ch, /** @type {number} */ x, /** @type {number} */ y) => {
    const k = cell_key(x, y)
    const tile = ch.cells.get(k)
    if (!tile) return
    ch.group.remove(tile)
    ch.cells.delete(k)
  }

  const clear_channel = (/** @type {any} */ ch) => {
    for (const tile of ch.cells.values()) ch.group.remove(tile)
    ch.cells.clear()
  }

  // ── [D253-2] CHANNEL FADE — a per-channel u_fade envelope the tick ramps; fade-OUT DEFERS tile removal
  //    until fully faded. The CLOCKS live in the style SSOT (board_highlight_style FADE_DEFAULTS 0.15 s in /
  //    0.25 s out + per-channel overrides — M3 one-home law; every value OWNER-TUNE). ──
  /** Cells just landed on a channel: cancel any pending fade-out and ramp toward full. `fresh` (the
   *  channel was EMPTY before this paint) restarts the envelope at 0 so it visibly fades IN; a repaint
   *  of an already-lit channel keeps its current opacity (instant cell swap, no re-fade / no blink). */
  const fade_in = (/** @type {any} */ ch, /** @type {boolean} */ fresh) => {
    if (!ch.u_fade) return // outline (selection) never fades
    if (fresh) {
      const start = ch.fade.fade_in_s === 0 ? 1 : 0
      ch.fade.cur = start
      ch.u_fade.value = start
    }
    ch.fade.clearing = false
    ch.fade.target = 1
  }
  /** Fade a channel OUT then remove its tiles (deferred by the tick). No-op for outline (clears instantly). */
  const fade_out = (/** @type {any} */ ch) => {
    if (!ch.u_fade) {
      clear_channel(ch)
      return
    }
    if (ch.cells.size === 0) return // nothing showing
    ch.fade.target = 0
    ch.fade.clearing = true
  }
  const tick_fades = (/** @type {number} */ dt) => {
    for (const ch of channels.values()) {
      if (!ch.u_fade) continue
      const f = ch.fade
      if (f.cur === f.target && !f.clearing) continue
      const rate = f.target > f.cur ? dt / f.fade_in_s : dt / f.fade_out_s
      if (f.cur < f.target) f.cur = Math.min(f.target, f.cur + rate)
      else if (f.cur > f.target) f.cur = Math.max(f.target, f.cur - rate)
      ch.u_fade.value = f.cur
      if (f.clearing && f.cur <= 0.001) {
        clear_channel(ch) // tiles removed only now that they're invisible
        f.clearing = false
      }
    }
  }

  // ── [D242] BOARD FEEL-CUES — transient scale-pop + fade EMPHASIS (brand-clean). pulse_cells() snaps
  //    the eye to legal cells on a mis-click; flash() is the your-turn cue. 0.15 s in / 0.25 s out. ──
  const EMPH_IN = 0.15
  const EMPH_OUT = 0.25
  const EMPH_LIFE = EMPH_IN + EMPH_OUT
  const EMPH_POP = 0.35 // extra scale at the peak (1.0 → 1.35 → 1.0)
  const EMPH_LIFT = FLOOR_CLEAR + 0.06 // above every wash so a pulse always reads on top
  const PULSE_COLOR = 0x9fd0ff // bright ally-blue — spawn-zone emphasis on a wrong placement
  const FLASH_COLOR = 0xfff2cc // warm gold-white — the your-turn ground flash
  /** @type {{ meshes: import('three').Mesh[], mat: any, u_alpha: any, t: number, peak: number, start_delay: number }[]} */
  const emphasis = []

  const make_emph_material = (/** @type {number} */ color_int) => {
    const u_alpha = uniform(0)
    const em = make_unlit_overlay_material()
    em.transparent = true
    em.depthWrite = false
    em.depthTest = false
    em.side = DoubleSide
    const col = new Color(color_int)
    em.colorNode = /** @type {any} */ (
      Fn(() => {
        const px = uv().x.sub(0.5).abs()
        const py = uv().y.sub(0.5).abs()
        const qx = max(px.sub(float(0.5).sub(CORNER_RADIUS)), float(0))
        const qy = max(py.sub(float(0.5).sub(CORNER_RADIUS)), float(0))
        const d = qx.mul(qx).add(qy.mul(qy)).sqrt().sub(CORNER_RADIUS)
        const coverage = smoothstep(float(0), float(-EDGE_SOFTNESS), d)
        const glow = float(1).sub(max(px, py).div(float(0.5)).mul(float(0.4))) // brighter toward centre
        return vec4(vec3(col.r, col.g, col.b).mul(glow), coverage.mul(u_alpha))
      })()
    )
    return { mat: em, u_alpha }
  }

  /** @param {{x:number,y:number}[]} cells @param {{ color?: number, peak?: number }} [opts] */
  const spawn_emphasis = (
    /** @type {{x:number,y:number}[]} */ cells,
    /** @type {{ color?: number, peak?: number, start_delay?: number }} */ {
      color = PULSE_COLOR,
      peak = 0.9,
      start_delay = 0,
    } = {}
  ) => {
    const { mat: em, u_alpha } = make_emph_material(color)
    /** @type {import('three').Mesh[]} */
    const meshes = []
    for (const c of cells) {
      if (!paintable(c.x, c.y)) continue
      const [cx, , cz] = cell_center_world(c.x, c.y)
      const m = new Mesh(tile_geo, em)
      m.position.set(cx, origin.y + EMPH_LIFT, cz)
      m.renderOrder = render_order_of(30)
      m.frustumCulled = false
      m.scale.setScalar(0.001) // [D257] hidden until its delayed beat begins (ripple stagger)
      route_board_highlight_overlay(m) // POST-AgX overlay layer (feel-cue emphasis rides the same night-wash fix)
      group.add(m)
      meshes.push(m)
    }
    if (meshes.length === 0) {
      em.dispose()
      return
    }
    emphasis.push({ meshes, mat: em, u_alpha, t: 0, peak, start_delay })
  }

  const tick_emphasis = (/** @type {number} */ dt) => {
    for (let i = emphasis.length - 1; i >= 0; i -= 1) {
      const e = emphasis[i]
      e.t += dt
      const at = e.t - e.start_delay // [D257] local time — <0 while the ripple beat hasn't reached this cell
      if (at >= EMPH_LIFE) {
        for (const m of e.meshes) group.remove(m)
        e.mat.dispose()
        emphasis.splice(i, 1)
        continue
      }
      if (at < 0) {
        e.u_alpha.value = 0
        continue
      } // not started — invisible
      const raw = at < EMPH_IN ? at / EMPH_IN : 1 - (at - EMPH_IN) / EMPH_OUT
      const env = raw * raw * (3 - 2 * raw) // smoothstep ease
      e.u_alpha.value = env * e.peak
      const sc = 1 + EMPH_POP * env
      for (const m of e.meshes) m.scale.set(sc, sc, sc)
    }
  }

  // [D257 AoE ripple] pop each cell with delay = dist_from_origin / speed → the cast SPLASHES outward
  // (reference AoE telegraph) instead of every cell popping at once. speed in cells/s (5–15 = the extract).
  const ripple = (
    /** @type {{x:number,y:number}[]} */ cells,
    /** @type {{ origin?: {x:number,y:number}, speed?: number, color?: number, peak?: number }} */ opts = {}
  ) => {
    const { origin, speed = 10, color = FLASH_COLOR, peak = 0.85 } = opts
    const o = origin ?? cells[0]
    if (!o) return
    for (const c of cells) {
      const d = Math.hypot(c.x - o.x, c.y - o.y)
      spawn_emphasis([c], { color, peak, start_delay: d / Math.max(1, speed) })
    }
  }

  return {
    group,
    /** [D242] pulse-emphasise cells (scale-pop + fade) — the wrong-placement snap-to-legal cue.
     *  @param {{x:number,y:number}[]} cells @param {{ color?: number, peak?: number }} [opts] */
    pulse_cells(cells, opts) {
      spawn_emphasis(cells ?? [], opts)
    },
    /** [D242] quick ground flash under one cell — the your-turn cue. */
    flash_cell(/** @type {{x:number,y:number}} */ cell) {
      if (cell) spawn_emphasis([cell], { color: FLASH_COLOR, peak: 0.95 })
    },
    /** [D242] flash the whole board footprint (or a given set) — a broad turn-start pulse.
     *  @param {{x:number,y:number}[]} [cells] */
    flash(cells) {
      spawn_emphasis(cells ?? all_paintable_cells(), { color: FLASH_COLOR, peak: 0.7 })
    },
    /** [D257] AoE ripple — pop cells outward from an origin (delay = dist/speed). @param {{x:number,y:number}[]} cells
     *  @param {{ origin?: {x:number,y:number}, speed?: number, color?: number, peak?: number }} [opts] */
    ripple(cells, opts) {
      ripple(cells ?? [], opts)
    },
    /** [D242] advance the feel-cue animations — the board tick loop calls this each frame. */
    tick(/** @type {number} */ dt) {
      tick_emphasis(dt)
      tick_fades(dt) // [D253-2] ramp the channel fade envelopes + deferred clears
    },
    /** TEST/BENCH — current fade envelope value of a channel (0 hidden … 1 full), or 1 if it doesn't fade. */
    _fade_of(/** @type {string} */ channel) {
      const ch = channels.get(channel)
      return ch?.u_fade ? ch.fade.cur : 1
    },
    set_channel(cells, channel) {
      const ch = channels.get(channel)
      if (!ch) return warn_unknown(channel) // v1.2 forward-compat: unknown layer paints nothing
      if (!cells || cells.length === 0) {
        fade_out(ch)
        return
      } // [D253-2] empty write = fade out
      const was_empty = ch.cells.size === 0 // capture BEFORE the swap (drives fade-in vs instant repaint)
      clear_channel(ch) // instant REPLACE — kills cumulation (no stale cells survive a repaint)
      const { order, merge } = CHANNELS[channel]
      // [#164] merge-aware channel: compute each cell's neighbor mask against THIS paint's own cell set
      // (never cross-channel — a glyph zone merges with other glyph cells only) before adding any tile.
      const cell_set = merge ? new Set(cells.map((c) => cell_key(c.x, c.y))) : null
      for (const c of cells) add_tile(ch, c.x, c.y, order, cell_set ? neighbor_mask(cell_set, c.x, c.y) : 0)
      fade_in(ch, was_empty) // [D253-2] first paint fades in; repaint swaps under the steady envelope
    },
    toggle(channel, cells, on) {
      const ch = channels.get(channel)
      if (!ch) return warn_unknown(channel) // v1.2 forward-compat: unknown layer paints nothing
      const { order } = CHANNELS[channel]
      if (on) {
        const was_empty = ch.cells.size === 0
        for (const c of cells) add_tile(ch, c.x, c.y, order)
        fade_in(ch, was_empty) // [D253-2] first paint fades IN; incremental add stays lit
      } else {
        // [D253-2] toggle-off is INSTANT (incremental edits, e.g. path un-hover) — the animated fade-out
        // is reserved for clear()/empty-write. If the channel empties, reset the envelope to dark so the
        // next paint fades IN cleanly.
        for (const c of cells) remove_tile(ch, c.x, c.y)
        if (ch.cells.size === 0 && ch.u_fade) {
          ch.fade.cur = 0
          ch.fade.target = 0
          ch.fade.clearing = false
          ch.u_fade.value = 0
        }
      }
    },
    clear(channel) {
      if (channel === undefined) {
        for (const ch of channels.values()) fade_out(ch) // [D253-2] fade every channel out
        return
      }
      const ch = channels.get(channel)
      if (ch) fade_out(ch)
    },
    // [entity-anchor] the LIVE "cell/spot under a fighter" marker — see the design note above
    // CHANNELS. Deliberately NOT routed through set_channel/toggle (those are cell-KEYED/discrete;
    // this tracks an arbitrary continuous world XZ per entity id, repainted every caller frame).
    set_entity_anchor(id, world_xz, team) {
      let a = anchors.get(id)
      if (!a) {
        // team picked ONCE at create — mirrors board_entities' outline color (fixed at CREATE, "a
        // fighter never changes team"); 0 = ally (the adapter's f.team===0 convention), else enemy.
        const mat = team === 0 ? anchor_mat_ally : anchor_mat_enemy
        const mesh = new Mesh(tile_geo, mat)
        mesh.renderOrder = render_order_of(ENTITY_ANCHOR_RENDER_ORDER)
        mesh.frustumCulled = false
        route_board_highlight_overlay(mesh) // POST-AgX overlay layer (entity anchor rides the same night-wash fix)
        group.add(mesh)
        a = { mesh }
        anchors.set(id, a)
      }
      a.mesh.position.set(world_xz.x, origin.y + ANCHOR_LIFT, world_xz.z)
    },
    clear_entity_anchor(id) {
      const a = anchors.get(id)
      if (!a) return
      group.remove(a.mesh)
      anchors.delete(id)
    },
    /** TEST/BENCH — an entity anchor's current world XZ, or null if untracked. */
    _anchor_position_of(id) {
      const a = anchors.get(id)
      return a ? { x: a.mesh.position.x, z: a.mesh.position.z } : null
    },
    /** TEST/BENCH — true if this tracked anchor is using the ALLY material (TEAM_COLORS.ally), false
     *  if ENEMY, null if untracked — proves the `team` argument actually picked the right color. */
    _anchor_is_ally(id) {
      const a = anchors.get(id)
      return a ? a.mesh.material === anchor_mat_ally : null
    },
    dispose() {
      for (const e of emphasis) {
        for (const m of e.meshes) group.remove(m)
        e.mat.dispose()
      }
      emphasis.length = 0
      for (const ch of channels.values()) {
        clear_channel(ch)
        ch.mat.dispose()
      }
      for (const a of anchors.values()) group.remove(a.mesh)
      anchors.clear()
      anchor_mat_ally.dispose()
      anchor_mat_enemy.dispose()
      tile_geo.dispose()
      diamond_geo.dispose()
      diamond_tex?.dispose()
      trap_spike_geo.dispose() // [trap marker] the channel loop above already disposed trap_spike_mat (it is the 'trap' ch.mat)
      trap_blob_mat.dispose() // [trap marker] the blob layer's material — NOT captured by any ch.mat (trap's ch.mat is trap_spike_mat)
      group.clear()
    },
  }
}

/** Unknown-layer handler: a single console.warn (not error — a v1.2 layer the dapp sends before the
 *  engine ships it is EXPECTED to no-op forward, not a fault). @param {string} channel */
function warn_unknown(channel) {
  console.warn(`[board_highlights] unknown channel "${channel}" — no-op (known: ${CHANNEL_KEYS.join('/')})`)
}
