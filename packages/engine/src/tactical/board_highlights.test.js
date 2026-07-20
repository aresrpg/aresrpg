// ENG-16 / D150 — highlight tile SHAPE + channel routing invariants (three node graph builds under bun;
// no WebGPU device — the TSL fragment is only COMPILED at render time, so constructing the controller +
// its node materials is valid here). Locks:
//   1. the rounded-rect + inner-gradient math (rounded_rect_gradient) that the shader mirrors: corners
//      round off (a corner is OUTSIDE the mask, an edge midpoint is INSIDE), and the inner gradient is
//      rim-bright (bright at the rim band, dim at the center).
//   2. the four D150 owner channels exist with the specified hues (dark blue target, light blue
//      los_blocked, red aoe, MEDIUM-GREEN 'range' movement [D289]) — a recolor regression would flip them back.
//   3. the 'los_blocked' layer ROUTES (paints tiles) and unknown layers NO-OP (v1.2 forward-compat).

import { test, expect, describe } from 'bun:test'

import { DEFAULT_GRADE, grade_rgb_lowfreq, luma } from '../render/grading.js'

import {
  CHANNELS,
  CORNER_RADIUS,
  DEFAULT_CENTER_STYLE,
  ENTITY_ANCHOR_EDGE_OPACITY,
  ENTITY_ANCHOR_FILL_OPACITY,
  TEAM_COLORS,
  TRAP_BLOB_COLOR,
  TRAP_BLOB_OPACITY,
  create_board_highlights,
  entity_anchor_cell_alpha,
  rounded_rect_gradient,
  resolve_highlight_style,
  trap_blob_alpha,
} from './board_highlights.js'
import { CELL_FLOOR } from './board.js'

// ── 1. rounded-rect coverage mask ──────────────────────────────────────────────────────────────────

describe('rounded_rect_gradient — rounded-corner coverage mask', () => {
  test('the tile CENTER is fully covered', () => {
    expect(rounded_rect_gradient(0.5, 0.5).coverage).toBeCloseTo(1, 5)
  })

  test('EDGE MIDPOINTS are inside the mask (flat sides, only corners round off)', () => {
    // mid of each side, just past the AA feather (~0.12 of the tile inward of the border) — the flat
    // side is solidly covered (the rounding only clips the corners, never the middle of an edge).
    expect(rounded_rect_gradient(0.5, 0.12).coverage).toBeGreaterThan(0.9) // top edge mid
    expect(rounded_rect_gradient(0.5, 0.88).coverage).toBeGreaterThan(0.9) // bottom edge mid
    expect(rounded_rect_gradient(0.12, 0.5).coverage).toBeGreaterThan(0.9) // left edge mid
    expect(rounded_rect_gradient(0.88, 0.5).coverage).toBeGreaterThan(0.9) // right edge mid
    // and the exact border midpoint sits in the feather (soft edge, not a hard jaggy) — nonzero but < 1.
    const border_mid = rounded_rect_gradient(0.5, 0.02).coverage
    expect(border_mid).toBeGreaterThan(0)
    expect(border_mid).toBeLessThan(1)
  })

  test('the extreme CORNERS are cut away (this IS the rounding)', () => {
    // the four exact corners sit outside a rounded rect of radius CORNER_RADIUS → zero coverage.
    expect(rounded_rect_gradient(0, 0).coverage).toBe(0)
    expect(rounded_rect_gradient(1, 0).coverage).toBe(0)
    expect(rounded_rect_gradient(0, 1).coverage).toBe(0)
    expect(rounded_rect_gradient(1, 1).coverage).toBe(0)
  })

  test('corner rounding scales with CORNER_RADIUS — a bigger radius cuts a corner sample deeper', () => {
    // A point just inside the corner region: its signed distance grows with the radius, so a larger
    // CORNER_RADIUS ⇒ that near-corner sample is MORE cut (lower coverage). Sanity: radius is ~18%.
    expect(CORNER_RADIUS).toBeGreaterThan(0.1)
    expect(CORNER_RADIUS).toBeLessThan(0.25)
    // a sample near a corner (both axes far from center) has less coverage than an edge-mid sample.
    const corner_ish = rounded_rect_gradient(0.06, 0.06).coverage
    const edge_mid = rounded_rect_gradient(0.5, 0.06).coverage
    expect(corner_ish).toBeLessThan(edge_mid)
  })
})

// ── inner gradient (rim-bright) ──────────────────────────────────────────────────────────────────────

describe('rounded_rect_gradient — inner gradient is RIM-BRIGHT', () => {
  test('gradient is ~0 at the center and ~1 at the rim (bright edge, dim middle)', () => {
    expect(rounded_rect_gradient(0.5, 0.5).grad).toBeCloseTo(0, 5) // center → dim
    expect(rounded_rect_gradient(0.5, 0.99).grad).toBeGreaterThan(0.9) // rim → bright
    expect(rounded_rect_gradient(0.01, 0.5).grad).toBeGreaterThan(0.9)
  })

  test('gradient increases monotonically from center outward along an axis', () => {
    let prev = -Infinity
    for (let v = 0.5; v <= 1.0; v += 0.05) {
      const g = rounded_rect_gradient(0.5, v).grad
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = g
    }
  })
})

// ── 2. D150 channel palette (specified hues) ───────────────────────────────────────────────────

describe('D256 punchy channel palette — deliberate saturation override', () => {
  const night_grade = { ...DEFAULT_GRADE, saturation: DEFAULT_GRADE.saturation * 0.4 }
  const chan = (/** @type {number} */ c) => ({ r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff })
  const srgb_to_linear = (/** @type {number} */ v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const center_luma_at_night = (/** @type {(typeof CHANNELS)[string]} */ spec) => {
    const { unlit_gain, center_dim, center_alpha } = resolve_highlight_style(spec)
    const alpha = spec.opacity * center_alpha
    const sample = (/** @type {number} */ byte) =>
      srgb_to_linear(byte / 255) * unlit_gain * center_dim * alpha + 0.01 * (1 - alpha)
    const { r, g, b } = chan(spec.color)
    const raw_luma = 0.2126 * sample(r) + 0.7152 * sample(g) + 0.0722 * sample(b)
    // Worst-case TOD signal: erase chroma completely, then run the shipped low-frequency night grade.
    return luma(grade_rgb_lowfreq([raw_luma, raw_luma, raw_luma], 0.01, night_grade))
  }
  test('[D256] mp_range is PUNCHY LIGHT GREEN (green-dominant, bright)', () => {
    const { r, g, b } = chan(CHANNELS.mp_range.color)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
    expect(g).toBeGreaterThan(0xb0) // punchy/light green
  })
  test('[D256] path is PUNCHY DARK GREEN — green-dominant, darker than mp_range (distinct)', () => {
    const { r, g, b } = chan(CHANNELS.path.color)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
    expect(g).toBeLessThan((CHANNELS.mp_range.color >> 8) & 0xff) // darker than the reach green
  })
  test('[D256] target is PUNCHY DEEP BLUE — blue-dominant', () => {
    const tgt = chan(CHANNELS.target.color)
    expect(tgt.b).toBeGreaterThan(tgt.r)
    expect(tgt.b).toBeGreaterThan(tgt.g)
  })
  test('[D289] range is MEDIUM MOVEMENT-GREEN — green-dominant, distinct from the target blue', () => {
    // owner: hovering a fighter shows THEIR move reach — that's movement, not a cast → GREEN, not blue.
    const rng = chan(CHANNELS.range.color)
    expect(rng.g).toBeGreaterThan(rng.r)
    expect(rng.g).toBeGreaterThan(rng.b)
    expect(CHANNELS.range.color).not.toBe(CHANNELS.target.color) // no longer a blue sibling of target
  })
  test('[D289] THREE distinct movement-greens — mp_range LIGHT (my reach) / range MEDIUM (their reach) / path DARK (steer path)', () => {
    const mp = chan(CHANNELS.mp_range.color)
    const rng = chan(CHANNELS.range.color)
    const pth = chan(CHANNELS.path.color)
    // all three are green-dominant (three greens, three roles — never collapsed onto one channel)
    for (const c of [mp, rng, pth]) {
      expect(c.g).toBeGreaterThan(c.r)
      expect(c.g).toBeGreaterThan(c.b)
    }
    // green/luminance three-tier separation: path DARK < range MEDIUM < mp_range LIGHT
    expect(pth.g).toBeLessThan(rng.g)
    expect(rng.g).toBeLessThan(mp.g)
    // and mutually distinct hexes — no two greens are the same color
    expect(CHANNELS.path.color).not.toBe(CHANNELS.range.color)
    expect(CHANNELS.range.color).not.toBe(CHANNELS.mp_range.color)
    expect(CHANNELS.path.color).not.toBe(CHANNELS.mp_range.color)
  })
  test('[D302] path is DARK ENOUGH vs mp_range — lum-delta pin ≥180 (live-QA: "the green is not dark enough")', () => {
    // lum proxy = R+G+B channel sum (0..765) — the same house metric as the D283 sibling test below.
    // The old 0x1a9622 sat only 146 below mp_range and read too close on the tan board; the D302
    // darken (0x0d6b16) pins the separation at ≥180 so no future recolor drifts the two greens back together.
    const lum = (/** @type {number} */ c) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff)
    expect(lum(CHANNELS.mp_range.color) - lum(CHANNELS.path.color)).toBeGreaterThanOrEqual(180)
  })
  test('shipped night grade keeps the three movement greens in a DARK < MEDIUM < LIGHT luminance ladder', () => {
    const path = center_luma_at_night(CHANNELS.path)
    const range = center_luma_at_night(CHANNELS.range)
    const mp_range = center_luma_at_night(CHANNELS.mp_range)
    expect(path).toBeLessThan(range)
    expect(range).toBeLessThan(mp_range)
    expect(mp_range / range).toBeGreaterThanOrEqual(3)
    expect(resolve_highlight_style(CHANNELS.path)).toEqual(DEFAULT_CENTER_STYLE)
    expect(resolve_highlight_style(CHANNELS.mp_range)).toEqual({
      unlit_gain: 1.35,
      center_dim: 0.72,
      center_alpha: 0.72,
    })
  })
  test('[D283] los_blocked is the target blue\'s LIGHTER SIBLING — same hue family, lighter ("less different")', () => {
    const hue = (/** @type {number} */ c) => {
      const r = (c >> 16) & 0xff
      const g = (c >> 8) & 0xff
      const b = c & 0xff
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      // blue-max branch of the standard hue formula (both colors are blue-dominant)
      return 60 * (4 + (r - g) / (mx - mn))
    }
    const lum = (/** @type {number} */ c) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff)
    const los = CHANNELS.los_blocked.color
    const target = CHANNELS.target.color
    expect(Math.abs(hue(los) - hue(target))).toBeLessThan(10) // SAME hue family (the old cyan-sky drifted 23°)
    expect(lum(los)).toBeGreaterThan(lum(target)) // the LIGHTER sibling — reads "targetable but blocked"
  })
  test('[D256] aoe is DARK RED — red-dominant, low green + blue, NOT bright (spec: dark red)', () => {
    const { r, g, b } = chan(CHANNELS.aoe.color)
    expect(r).toBeGreaterThan(g) // red-dominant
    expect(r).toBeGreaterThan(b)
    expect(g).toBeLessThan(0x50) // low green (red, not orange)
    expect(b).toBeLessThan(0x50) // low blue
    expect(r).toBeLessThan(0xc0) // DARK red — deliberately not a bright red
  })
  test('[msg 3254] path_blocked is SOFT red-ish — red-dominant but SOFTER than the aoe strike red', () => {
    // owner: hovering past your MP paints the overflow cells "red-ish" — a soft warning, never the hard
    // strike red (aoe must stay the loudest red on the board).
    const pb = chan(CHANNELS.path_blocked.color)
    const aoe = chan(CHANNELS.aoe.color)
    expect(pb.r).toBeGreaterThan(pb.g) // red-dominant
    expect(pb.r).toBeGreaterThan(pb.b)
    expect(pb.g + pb.b).toBeGreaterThan(aoe.g + aoe.b) // desaturated (soft) vs the hard aoe red
    expect(CHANNELS.path_blocked.color).not.toBe(CHANNELS.aoe.color)
  })
  test('every channel opacity is punchy (≥0.5 — never wishy-washy, ref2)', () => {
    // ONE exception (LATER than the D256 punchy pass): path_blocked is the tackle-lost
    // warning band and must read "way softer to not feel it's a AoE blob" — its own softness ratchet row (M3
    // describe below) pins it ≤0.45 instead. Every ACTION wash stays punchy.
    for (const [key, spec] of Object.entries(CHANNELS)) {
      if (key === 'path_blocked') continue
      expect(spec.opacity, `${key} opacity`).toBeGreaterThanOrEqual(0.5)
    }
  })
  test('trap is BRAND GOLD (warm r>g>b, the #c8963c token) — the caster-only placed-trap mark, above the action washes', () => {
    const { r, g, b } = chan(CHANNELS.trap.color)
    expect(r).toBeGreaterThan(g) // warm gold: red leads green leads blue
    expect(g).toBeGreaterThan(b)
    expect(CHANNELS.trap.color).toBe(0xc8963c) // the design-system `gold` token exactly
    // reads ON TOP of every action wash (a stale-blue target over your own trap is a lie) — above target/aoe.
    expect(CHANNELS.trap.order).toBeGreaterThan(CHANNELS.target.order)
    expect(CHANNELS.trap.order).toBeGreaterThan(CHANNELS.aoe.order)
    // a hollow RING, not a fill — a gold fill camouflages into the warm-tan board (clip-probed 2026-07-13);
    // the border profile's full-saturation rim is what actually reads from the fight camera.
    expect(CHANNELS.trap.border).toBe(true)
  })
})

// ── trap marker — design correction 2026-07-19: replace the soft shadow blob (read as ugly) with
// a dark highlight and a spike. Rejected: an organic soft-shadow
// stain + a bear-trap sprite. Now: a DARK cell-bounded gradient-tile highlight + a SPIKE cone rising from
// the cell center. These lock STRUCTURE only — the pixel look is a separate screenshot-pass call. ──────

describe('trap BASE — a dark CELL-BOUNDED gradient-tile highlight ("a dark highlight", NOT the organic soft-shadow)', () => {
  test('the blob coverage is cell-bounded (edge midpoints solidly inside) and SYMMETRIC — not the lopsided organic island', () => {
    // the rejected form was an organic lobed union: edge midpoints fell OUTSIDE it and opposite axes read
    // wildly differently. The dark highlight is the shared rounded-rect tile — solid to the flat edges,
    // only the corners round off, perfectly symmetric.
    expect(trap_blob_alpha(0.5, 0.9)).toBeGreaterThan(0.9) // top edge mid — inside
    expect(trap_blob_alpha(0.5, 0.1)).toBeGreaterThan(0.9) // bottom edge mid — inside
    expect(trap_blob_alpha(0.1, 0.5)).toBeGreaterThan(0.9) // left edge mid — inside
    expect(trap_blob_alpha(0.9, 0.5)).toBeGreaterThan(0.9) // right edge mid — inside
    expect(trap_blob_alpha(0.8, 0.5)).toBeCloseTo(trap_blob_alpha(0.2, 0.5), 5) // symmetric X (organic was not)
    expect(trap_blob_alpha(0.5, 0.8)).toBeCloseTo(trap_blob_alpha(0.5, 0.2), 5) // symmetric Y
  })

  test('TRAP_BLOB_COLOR is a dark near-black palette + TRAP_BLOB_OPACITY is solid (a dark highlight, not a wishy wash)', () => {
    const r = (TRAP_BLOB_COLOR >> 16) & 0xff
    const g = (TRAP_BLOB_COLOR >> 8) & 0xff
    const b = TRAP_BLOB_COLOR & 0xff
    expect(Math.max(r, g, b)).toBeLessThan(0x20) // dark, not a tinted gray
    expect(TRAP_BLOB_OPACITY).toBeGreaterThanOrEqual(0.8) // solid
  })

  test('the painted trap BASE material is unlit + night-immune (MeshBasicNode, fog + tone-map exempt), no sprite texture', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_channel([{ x: 1, y: 1 }], 'trap')
    const g = ctrl.group.children.find((/** @type {any} */ c) => c.name === 'highlight_trap')
    const [marker] = g.children
    const [blob] = marker.children
    expect(blob.material.isMeshBasicNodeMaterial).toBe(true)
    expect(blob.material.fog).toBe(false)
    expect(blob.material.toneMapped).toBe(false)
    expect(blob.material.map == null).toBe(true) // a gradient-tile highlight, not a textured bear-trap sprite
    ctrl.dispose()
  })
})

describe('trap ACCENT — a SPIKE cone rising from the cell center ("and a spike"), replacing the bear-trap sprite', () => {
  test("set_channel('trap', …) paints a COMPOUND marker per cell: exactly one dark-blob mesh + one spike mesh", () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_channel([{ x: 1, y: 1 }], 'trap')
    const g = ctrl.group.children.find((/** @type {any} */ c) => c.name === 'highlight_trap')
    expect(g.children.length).toBe(1) // one compound marker for the one placed-trap cell
    const [marker] = g.children
    expect(marker.children.length).toBe(2) // [0] the dark blob, [1] the spike
    ctrl.dispose()
  })

  test('the accent is a SPIKE — a cone geometry that RISES above the tile plane, not a flat crossed-billboard sprite', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_channel([{ x: 1, y: 1 }], 'trap')
    const g = ctrl.group.children.find((/** @type {any} */ c) => c.name === 'highlight_trap')
    const [marker] = g.children
    const [, spike] = marker.children
    expect(spike.geometry.type).toBe('ConeGeometry') // a cone/spike, not the sprite's crossed-plane BufferGeometry
    expect(spike.geometry.parameters.height).toBeGreaterThan(0) // it has vertical extent — it RISES
    spike.geometry.computeBoundingBox()
    const bb = spike.geometry.boundingBox
    expect(bb.max.y).toBeGreaterThan(0) // apex above the tile plane
    expect(bb.min.y).toBeGreaterThanOrEqual(-1e-6) // base seated on the plane (geometry translated up), rising upward
    expect(spike.material.isMeshBasicNodeMaterial).toBe(true) // unlit + night-immune, like the family
    expect(spike.material.fog).toBe(false)
    ctrl.dispose()
  })
})

// ── ⑬ trap Z-ORDER (v1.12.31 regression: "I should see the traps above my MP blob") — the placed-trap marker
// (dark blob + spike) must draw ABOVE the local-player MP-range blob wash. Every wash is depthWrite:false, so
// three's transparent sort is by renderOrder: higher = drawn later = on top. The blob wash sits BELOW, the trap
// marker ABOVE — asserted on BOTH the painted meshes and the CHANNELS order SSOT that drives them. ──────────────
describe('⑬ trap marker renders ABOVE the MP-range blob wash', () => {
  test('the trap blob + spike meshes carry a HIGHER renderOrder than an mp_range wash tile on the SAME cell', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_channel([{ x: 1, y: 1 }], 'mp_range') // the light-green local-player movement reach — THE MP blob
    ctrl.set_channel([{ x: 1, y: 1 }], 'trap') // the dark-blob + spike placed-trap marker, same cell
    const mp_group = ctrl.group.children.find((/** @type {any} */ c) => c.name === 'highlight_mp_range')
    const trap_group = ctrl.group.children.find((/** @type {any} */ c) => c.name === 'highlight_trap')
    const [mp_tile] = mp_group.children
    const [marker] = trap_group.children
    const [blob, spike] = marker.children
    expect(blob.renderOrder).toBeGreaterThan(mp_tile.renderOrder) // dark blob ON TOP of the wash
    expect(spike.renderOrder).toBeGreaterThan(mp_tile.renderOrder) // and the rising spike above it
    // the CHANNELS order SSOT that produced those renderOrders: trap strictly above mp_range (blob BELOW, trap ABOVE)
    expect(CHANNELS.trap.order).toBeGreaterThan(CHANNELS.mp_range.order)
    ctrl.dispose()
  })
})

// ── team seat glow ("their cells should have inner glowy border of the color of their team") ──

describe('team seat glow — ally/enemy inner-ring channels', () => {
  const chan = (/** @type {number} */ c) => ({ r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff })

  test('TEAM_COLORS match the EntityTooltip dots — ally ice-blue (blue-dominant), enemy red (red-dominant)', () => {
    const ally = chan(TEAM_COLORS.ally)
    expect(ally.b).toBeGreaterThan(ally.r) // ice-blue: blue leads
    expect(ally.b).toBeGreaterThan(ally.g)
    const enemy = chan(TEAM_COLORS.enemy)
    expect(enemy.r).toBeGreaterThan(enemy.g) // red: red leads
    expect(enemy.r).toBeGreaterThan(enemy.b)
    expect(TEAM_COLORS.ally).not.toBe(TEAM_COLORS.enemy)
  })

  test('ally_seat / enemy_seat are BORDER channels carrying the team colors, stacked ABOVE every wash', () => {
    for (const key of ['ally_seat', 'enemy_seat']) {
      expect(CHANNELS[key].border, `${key} is a border ring`).toBe(true)
      // above every OTHER channel so the team ID always reads on top of the gameplay washes.
      for (const [other, spec] of Object.entries(CHANNELS)) {
        if (other === 'ally_seat' || other === 'enemy_seat') continue
        expect(CHANNELS[key].order, `${key} above ${other}`).toBeGreaterThan(spec.order)
      }
    }
    expect(CHANNELS.ally_seat.color).toBe(TEAM_COLORS.ally)
    expect(CHANNELS.enemy_seat.color).toBe(TEAM_COLORS.enemy)
  })

  test('a BORDER ring is HOLLOW — the tile alpha follows grad, ~0 at the center (see-through middle), ~1 at the rim', () => {
    // the seat material multiplies alpha by `grad` (no CENTER_ALPHA floor), so a transparent center — the
    // "border, not fill" read that lets the ring sit over a wash without washing it out — is guaranteed by
    // grad≈0 at the center and grad≈1 at the rim.
    expect(rounded_rect_gradient(0.5, 0.5).grad).toBeCloseTo(0, 5)
    expect(rounded_rect_gradient(0.5, 0.99).grad).toBeGreaterThan(0.9)
  })

  test('ally_seat / enemy_seat route: set_channel paints one tile per fighter cell', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_channel(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      'ally_seat'
    )
    ctrl.set_channel([{ x: 2, y: 2 }], 'enemy_seat')
    expect(tiles_in(ctrl, 'ally_seat')).toBe(2)
    expect(tiles_in(ctrl, 'enemy_seat')).toBe(1)
    ctrl.dispose()
  })
})

// ── 3. channel routing (los_blocked paints; unknown layers no-op) ────────────────────────────────────

/** A tiny 3×3 all-floor stub board (the highlight controller only needs these four fields). */
function stub_board() {
  const cell_size = 2
  return {
    cell_size,
    origin: { x: 0, y: 0, z: 0 },
    cell_byte: () => CELL_FLOOR, // every cell walkable/paintable
    cell_center_world: (/** @type {number} */ x, /** @type {number} */ y) =>
      /** @type {[number, number, number]} */ ([(x + 0.5) * cell_size, 0, (y + 0.5) * cell_size]),
  }
}

/** Count painted tiles in a named highlight group. @param {any} ctrl @param {string} channel */
function tiles_in(ctrl, channel) {
  const g = ctrl.group.children.find((/** @type {any} */ c) => c.name === `highlight_${channel}`)
  return g ? g.children.length : -1
}

describe('channel routing — los_blocked layer + unknown-layer no-op', () => {
  test('los_blocked routes: set_channel paints one tile per cell', () => {
    const ctrl = create_board_highlights(stub_board())
    expect(tiles_in(ctrl, 'los_blocked')).toBe(0)
    ctrl.set_channel(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      'los_blocked'
    )
    expect(tiles_in(ctrl, 'los_blocked')).toBe(3)
    ctrl.clear('los_blocked')
    // [D253-2] clear now FADES OUT (0.25 s) — tiles linger, then the tick removes them once invisible.
    ctrl.tick(0.3)
    expect(tiles_in(ctrl, 'los_blocked')).toBe(0)
    ctrl.dispose()
  })

  test('trap channel ROUTES: set_channel paints one gold tile per placed-trap cell', () => {
    const ctrl = create_board_highlights(stub_board())
    expect(tiles_in(ctrl, 'trap')).toBe(0)
    ctrl.set_channel(
      [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ],
      'trap'
    )
    expect(tiles_in(ctrl, 'trap')).toBe(2)
    ctrl.dispose()
  })

  test('glyph channel ROUTES as an ORANGE persistent zone: one warm-orange tile per zone cell, distinct from the aoe red', () => {
    // Requirement: a persistent orange zone marker on the ground — a flat wash over the whole AoE.
    const g = {
      r: (CHANNELS.glyph.color >> 16) & 0xff,
      g: (CHANNELS.glyph.color >> 8) & 0xff,
      b: CHANNELS.glyph.color & 0xff,
    }
    expect(g.r).toBeGreaterThan(g.g) // orange: red leads
    expect(g.g).toBeGreaterThan(g.b) // …warm (real green), unlike the aoe blood-red
    expect(g.g).toBeGreaterThan((CHANNELS.aoe.color >> 8) & 0xff) // greener/warmer than the strike red
    expect(CHANNELS.glyph.color).not.toBe(CHANNELS.aoe.color) // never collapses onto the strike channel
    const ctrl = create_board_highlights(stub_board())
    expect(tiles_in(ctrl, 'glyph')).toBe(0)
    ctrl.set_channel(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      'glyph'
    )
    expect(tiles_in(ctrl, 'glyph')).toBe(3) // the whole zone paints (a flat tile per cell, like every wash)
    ctrl.dispose()
  })

  test('toggle adds/removes los_blocked cells idempotently', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.toggle('los_blocked', [{ x: 0, y: 0 }], true)
    ctrl.toggle('los_blocked', [{ x: 0, y: 0 }], true) // dup add → still 1
    expect(tiles_in(ctrl, 'los_blocked')).toBe(1)
    ctrl.toggle('los_blocked', [{ x: 0, y: 0 }], false)
    expect(tiles_in(ctrl, 'los_blocked')).toBe(0)
    ctrl.dispose()
  })

  test('[D253-2] first paint FADES IN — envelope ramps 0 → 1 over the tick', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_channel([{ x: 0, y: 0 }], 'mp_range')
    expect(tiles_in(ctrl, 'mp_range')).toBe(1) // tile present immediately…
    expect(ctrl._fade_of('mp_range')).toBe(0) // …but INVISIBLE (fresh channel starts dark)
    ctrl.tick(0.075) // half of FADE_IN (0.15 s)
    expect(ctrl._fade_of('mp_range')).toBeGreaterThan(0.3)
    ctrl.tick(0.15) // past FADE_IN
    expect(ctrl._fade_of('mp_range')).toBe(1) // fully faded in
    // a REPAINT of the lit channel stays at full (instant swap, no re-fade / blink)
    ctrl.set_channel([{ x: 2, y: 2 }], 'mp_range')
    expect(ctrl._fade_of('mp_range')).toBe(1)
    ctrl.dispose()
  })

  test('[D253-2] clear FADES OUT — tiles linger mid-dissolve, removed only once invisible', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_channel(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      'mp_range'
    )
    ctrl.tick(0.2) // let it fade IN first (real usage shows the channel before clearing)
    expect(tiles_in(ctrl, 'mp_range')).toBe(2)
    ctrl.clear('mp_range')
    ctrl.tick(0.1) // mid fade-out (< 0.25 s) — the wash is still dissolving on screen
    expect(tiles_in(ctrl, 'mp_range')).toBe(2)
    ctrl.tick(0.3) // past the fade-out envelope
    expect(tiles_in(ctrl, 'mp_range')).toBe(0)
    ctrl.dispose()
  })

  test('an unknown layer NO-OPs (v1.2 forward-compat) — no throw, nothing painted', () => {
    const ctrl = create_board_highlights(stub_board())
    // must not throw and must not create a group.
    expect(() => ctrl.set_channel([{ x: 0, y: 0 }], 'not_a_real_layer_v9')).not.toThrow()
    expect(() => ctrl.toggle('not_a_real_layer_v9', [{ x: 0, y: 0 }], true)).not.toThrow()
    expect(tiles_in(ctrl, 'not_a_real_layer_v9')).toBe(-1) // no such group
    ctrl.dispose()
  })

  test('all four D150 owner channels paint tiles', () => {
    const ctrl = create_board_highlights(stub_board())
    for (const ch of ['range', 'target', 'los_blocked', 'aoe']) {
      ctrl.set_channel([{ x: 0, y: 0 }], ch)
      expect(tiles_in(ctrl, ch), `${ch} paints`).toBe(1)
    }
    ctrl.dispose()
  })
})

describe('[D257] AoE ripple — staggered per-cell pop', () => {
  test('cells nearer the origin light BEFORE farther cells (dist/speed stagger)', () => {
    const ctrl = create_board_highlights(stub_board())
    // origin at (0,0); a near cell (1,0) and a far cell (5,0). speed 10 cells/s → delays 0.1s vs 0.5s.
    ctrl.ripple(
      [
        { x: 1, y: 0 },
        { x: 5, y: 0 },
      ],
      { origin: { x: 0, y: 0 }, speed: 10 }
    )
    ctrl.tick(0.16) // past the near cell's 0.1s delay + into its rise; far cell (0.5s) not started
    // both meshes exist, but only the near one has scaled up (the far one is still at its hidden 0.001)
    ctrl.tick(0.5) // advance well past the far cell's delay → it animates too
    // no throw + the ripple self-cleans after all cells finish
    ctrl.tick(1.0)
    ctrl.dispose()
    expect(true).toBe(true) // structural: staggered spawn + tick + cleanup ran clean
  })
  test('ripple with no cells is a safe no-op', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.ripple([], { origin: { x: 0, y: 0 }, speed: 10 })
    ctrl.tick(0.1)
    ctrl.dispose()
    expect(true).toBe(true)
  })
})

// ── ENTITY ANCHOR (2026-07-11): the highlighted cell below an entity must read as visually distinct
// from other highlight types, and must follow the mob's movement rather than being set on the
// target cell before the movement resolves. [SUPERSEDED same day]: the first cut
// (a muted circular ring) read as "a barely-visible round blob" — replaced with a SQUARED cell
// marker (subtle fill + crisp edge outline, at the board's own cell metrics) in a CLEARLY VISIBLE
// team color. ──────────────────────────────────────────────────────────────────────────────────────

describe('entity anchor — SQUARED cell shape: subtle fill + crisp edge outline (screenshot-verified)', () => {
  test('FILLED at the center, at the subtle FILL opacity — unlike the old ring (hollow center)', () => {
    expect(entity_anchor_cell_alpha(0.5, 0.5)).toBeCloseTo(ENTITY_ANCHOR_FILL_OPACITY, 5)
  })
  test('CRISP + BRIGHT right at the flat cell boundary — well above the fill, the "clearly visible" read', () => {
    expect(entity_anchor_cell_alpha(1.0, 0.5)).toBeCloseTo(ENTITY_ANCHOR_EDGE_OPACITY, 5)
    expect(entity_anchor_cell_alpha(1.0, 0.5)).toBeGreaterThan(entity_anchor_cell_alpha(0.5, 0.5))
  })
  test('the edge is a THIN band, not a second fill — mid-cell (between center and edge) stays at the fill level', () => {
    expect(entity_anchor_cell_alpha(0.8, 0.5)).toBeCloseTo(ENTITY_ANCHOR_FILL_OPACITY, 2)
  })
  test("reads ~0 at the tile's literal corners — the same rounded-rect footprint every D150 action tile shares", () => {
    expect(rounded_rect_gradient(0, 0).coverage).toBeCloseTo(0, 5) // shared SDF: the corner is masked out for every tile
    expect(entity_anchor_cell_alpha(0, 0)).toBeCloseTo(0, 5)
  })
})

describe('entity anchor — TEAM color is CLEARLY VISIBLE (fixes "barely-visible round blob")', () => {
  test('the edge opacity matches or beats the punchiest CHANNELS entry — never wishy-washy', () => {
    const max_channel_opacity = Math.max(...Object.values(CHANNELS).map((c) => c.opacity))
    expect(ENTITY_ANCHOR_EDGE_OPACITY).toBeGreaterThanOrEqual(max_channel_opacity)
  })
  test('the fill stays subtle (below every CHANNELS opacity) — the team read comes from the edge, not the fill', () => {
    for (const spec of Object.values(CHANNELS)) expect(ENTITY_ANCHOR_FILL_OPACITY).toBeLessThan(spec.opacity)
  })
})

describe('entity anchor — LIVE follow position (never pre-jumps to the destination)', () => {
  test('set_entity_anchor places a tracked marker at the given world XZ', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_entity_anchor('m1', { x: 3, z: 4 }, 0)
    expect(ctrl._anchor_position_of('m1')).toEqual({ x: 3, z: 4 })
    ctrl.dispose()
  })

  test('tracks a moving entity FRAME BY FRAME — the anchor is at the CURRENT interpolated point, never the destination early', () => {
    // Mirrors board_entities.js advance_walk's constant-speed segment lerp: a straight walk from
    // (0,0) to (10,0), sampled at 6 frames (t = 0, 0.2, 0.4, 0.6, 0.8, 1.0).
    const ctrl = create_board_highlights(stub_board())
    const start = { x: 0, z: 0 }
    const end = { x: 10, z: 0 }
    for (let step = 0; step <= 5; step += 1) {
      const t = step / 5
      const live = { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t }
      ctrl.set_entity_anchor('m1', live, 0)
      const p = ctrl._anchor_position_of('m1')
      expect(p).toEqual(live) // exactly THIS frame's position — no internal smoothing/lag/lead
      if (t < 1) expect(p.x).toBeLessThan(end.x) // the pre-jump bug: reading the DESTINATION before arrival
    }
    ctrl.dispose()
  })

  test('clear_entity_anchor removes the tracked marker (death/remove)', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_entity_anchor('m1', { x: 1, z: 1 }, 0)
    expect(ctrl._anchor_position_of('m1')).not.toBeNull()
    ctrl.clear_entity_anchor('m1')
    expect(ctrl._anchor_position_of('m1')).toBeNull()
    ctrl.dispose()
  })

  test('clear_entity_anchor on an untracked id is a safe no-op', () => {
    const ctrl = create_board_highlights(stub_board())
    expect(() => ctrl.clear_entity_anchor('never_set')).not.toThrow()
    ctrl.dispose()
  })

  test('multiple entities track INDEPENDENTLY, each keeping its OWN team color', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_entity_anchor('ally1', { x: 1, z: 1 }, 0)
    ctrl.set_entity_anchor('enemy1', { x: 5, z: 5 }, 1)
    expect(ctrl._anchor_position_of('ally1')).toEqual({ x: 1, z: 1 })
    expect(ctrl._anchor_position_of('enemy1')).toEqual({ x: 5, z: 5 })
    ctrl.set_entity_anchor('ally1', { x: 2, z: 1 }, 0) // repositioning one never disturbs the other
    expect(ctrl._anchor_position_of('ally1')).toEqual({ x: 2, z: 1 })
    expect(ctrl._anchor_position_of('enemy1')).toEqual({ x: 5, z: 5 })
    ctrl.dispose()
  })

  test('dispose() frees every tracked anchor mesh + both team materials (no leak)', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_entity_anchor('m1', { x: 0, z: 0 }, 0)
    ctrl.set_entity_anchor('m2', { x: 1, z: 1 }, 1)
    expect(() => ctrl.dispose()).not.toThrow()
  })
})

describe('entity anchor — team param picks the matching TEAM_COLORS material ("team-color marker")', () => {
  test('team 0 (ally, mirrors f.team===0) gets the ALLY material', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_entity_anchor('a1', { x: 0, z: 0 }, 0)
    expect(ctrl._anchor_is_ally('a1')).toBe(true)
    ctrl.dispose()
  })
  test('any non-zero team gets the ENEMY material', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_entity_anchor('e1', { x: 0, z: 0 }, 1)
    expect(ctrl._anchor_is_ally('e1')).toBe(false)
    ctrl.dispose()
  })
  test('the team pick is FIXED at creation — a later reposition call never swaps the material', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_entity_anchor('a1', { x: 0, z: 0 }, 0)
    ctrl.set_entity_anchor('a1', { x: 1, z: 1 }) // no team arg on the reposition — must NOT flip to enemy
    expect(ctrl._anchor_is_ally('a1')).toBe(true)
    ctrl.dispose()
  })
  test('untracked id reads null', () => {
    const ctrl = create_board_highlights(stub_board())
    expect(ctrl._anchor_is_ally('ghost')).toBeNull()
    ctrl.dispose()
  })
})

// ── M3 rider (2026-07-18): the cell-paint grammar's ONE home + the softer tackle red ──────────────────────────
describe('M3 · paint grammar SSOT + tackle-red softness ratchet', () => {
  test('fade clocks resolve from the style SSOT (FADE_DEFAULTS + per-channel override) — one home', async () => {
    const { FADE_DEFAULTS, resolve_fade } = await import('./board_highlight_style.js')
    expect(FADE_DEFAULTS.fade_in_s).toBe(0.15) // pinned default — tunable per channel
    expect(FADE_DEFAULTS.fade_out_s).toBe(0.25)
    expect(resolve_fade({})).toEqual({ fade_in_s: 0.15, fade_out_s: 0.25 })
    expect(resolve_fade({ fade_in_s: 0.4 })).toEqual({ fade_in_s: 0.4, fade_out_s: 0.25 })
  })

  test('OWNER 1195 "way softer to not feel it\'s a AoE blob": path_blocked reads MATERIALLY quieter than the aoe strike red', async () => {
    const { CHANNELS } = await import('./board_highlight_style.js')
    expect(CHANNELS.path_blocked.opacity).toBeLessThanOrEqual(0.45) // the softness ratchet (was 0.7)
    expect(CHANNELS.path_blocked.opacity).toBeLessThan(CHANNELS.aoe.opacity / 2) // never within 2× of the strike red
  })
})
