// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Tactical highlight visual SSOT. The frontend adapter selects semantic channel names; this module owns
// every channel's color, opacity, stack order, and lighting-independent center/output dials.

/** Default filled-tile profile. Individual channels override only the dials that carry semantic contrast. */
export const DEFAULT_CENTER_STYLE = Object.freeze({
  unlit_gain: 1,
  center_dim: 0.45,
  center_alpha: 0.55,
})

/**
 * Resolve a channel onto the shared center/output defaults consumed by both the shader and unit oracle.
 * @param {{ unlit_gain?: number, center_dim?: number, center_alpha?: number }} spec
 */
export function resolve_highlight_style(spec) {
  return {
    unlit_gain: spec.unlit_gain ?? DEFAULT_CENTER_STYLE.unlit_gain,
    center_dim: spec.center_dim ?? DEFAULT_CENTER_STYLE.center_dim,
    center_alpha: spec.center_alpha ?? DEFAULT_CENTER_STYLE.center_alpha,
  }
}

/** Ally/enemy palette shared by seat glows and entity outlines. */
export const TEAM_COLORS = { ally: 0x5db4ff, enemy: 0xff6b6b }

// ── CELL-PAINT FADE CLOCKS — the ONE home (M3 rider, 2026-07-18). The retro-1.29 reference corpus carries NO
// cell-paint fade/tint rows (D_PACING_RESEARCH beat table: movement/hit/damage-number clocks only — the 1.29
// grid tint was an instant frame swap at 20 fps), so these are OUR parametric grammar, never extracted numbers. Defaults =
// the shared fade-envelope default (fade in 0.15 s / out 0.25 s); any channel may override via `fade_in_s` /
// `fade_out_s` on its CHANNELS row. TUNABLE: both defaults + every per-channel override await live A/B. ──
export const FADE_DEFAULTS = Object.freeze({ fade_in_s: 0.15, fade_out_s: 0.25 })

/** Resolve a channel's fade envelope clocks onto the shared defaults (same shape as resolve_highlight_style).
 * @param {{ fade_in_s?: number, fade_out_s?: number }} spec */
export function resolve_fade(spec) {
  return {
    fade_in_s: spec.fade_in_s ?? FADE_DEFAULTS.fade_in_s,
    fade_out_s: spec.fade_out_s ?? FADE_DEFAULTS.fade_out_s,
  }
}

/**
 * Every paintable tactical channel. `unlit_gain` and the center dials are material-output values, not
 * scene-light inputs: they establish the light/medium/dark ladder before the shared whole-scene post grade.
 * @type {Record<string, { color: number, opacity: number, order: number, outline?: boolean,
 *   border?: boolean, unlit_gain?: number, center_dim?: number, center_alpha?: number }>}
 */
export const CHANNELS = {
  // §7 CellState vocabulary
  highlight: { color: 0x2f7bf5, opacity: 0.8, order: 1 },
  path: { color: 0x0b4712, opacity: 0.94, order: 4 }, // [#212] DARK movement path — darkened again, see mp_range
  aoe: { color: 0xa01414, opacity: 0.86, order: 3 },
  start_a: { color: 0x2f6bd8, opacity: 0.8, order: 2 },
  start_b: { color: 0xff7a2c, opacity: 0.8, order: 2 },
  blocked: { color: 0x556070, opacity: 0.55, order: 1 },

  // Dapp-facing layer names
  placement: { color: 0x2f6bd8, opacity: 0.78, order: 2 },
  // PLACEMENT GHOST (board #.. — uncommitted pre-start picks must be visible so teammates can SEE where
  // others intend to stand) — a PEER's uncommitted pick, p2p cosmetic hint only. Cyan (house secondary accent, never
  // used elsewhere in this table), distinct from the solid 'placement' blue (a clickable cell) and 'trap' gold
  // (MY own hazard) it may sit beside. RULE: every channel opacity is PUNCHY ≥0.5, no
  // wishy-washy exception for this one — the rim stays bright; center_dim/center_alpha alone soften the fill so
  // it still reads as a lighter hint than a solid wash. Order 3: above the placement wash (2) it's painted over,
  // below target/trap (5-6) it never coexists with during placement.
  ghost: { color: 0x4a9eff, opacity: 0.55, order: 3, center_alpha: 0.4, center_dim: 0.62 },
  range: { color: 0x35b34a, opacity: 0.8, order: 1 }, // MEDIUM hovered-fighter movement range
  target: { color: 0x3358f5, opacity: 0.92, order: 5 },
  mp_range: {
    color: 0x6ee85c,
    opacity: 0.72,
    order: 1,
    unlit_gain: 1.35,
    center_dim: 0.72,
    center_alpha: 0.72,
  }, // [#212] LIGHT local-player movement range; raised center survives a dark floor. Owner 2026-07-21
  // live-QA on v1.12.39: the D302 mp_range/path pair still read "too little difference" — this recolor
  // (0x5ed82e → 0x6ee85c here, path 0x0d6b16 → 0x0b4712) widens the lum-delta floor 180 → 300 (see the
  // [#212] test below) so "clear light green" vs "clear dark green" is unmistakable at fight-camera
  // distance, not just on paper.
  los_blocked: { color: 0x7a95f8, opacity: 0.82, order: 5 },
  // The TACKLE-LOST band (project.move_wash tackle_lost — the at-risk cells while actually tackled). WAY
  // SOFTER than every strike red — soft enough to not feel
  // like a AoE blob: desaturated rosy tint at low opacity + a quieter center, so the hard aoe strike red
  // stays the loudest red on the board by a wide margin. TUNABLE: color/opacity/center dials await live A/B.
  path_blocked: { color: 0xcf9a8c, opacity: 0.34, order: 4, center_alpha: 0.32, center_dim: 0.5 },

  // GLYPH ZONE (a warm pumpkin-orange ground wash, persistent, covering the whole placed AoE) — the
  // caster's OWN glyph. [#164, owner restated 2026-07-21] "one blob per cell, reads too faint" — TWO
  // fixes: `merge: true` (board_highlights.js/board_highlight_shapes.js) makes a contiguous run of
  // glyph cells render as ONE union-outlined shape — rounded + rim-bright only at the zone's true outer
  // perimeter, flat through every interior seam — instead of N separately-rimmed cell blobs; the
  // opacity/center dials below are raised off the old "atmospheric, not flashy" floor to the
  // `mp_range`-grade punch (still inside the established token range — nothing here exceeds any
  // existing channel's ceiling) so the zone reads as clearly present at fight-camera distance, not
  // just distinctly-shaped. Sits at order 2 so transient hovers (aoe/path=3-4), targets (5) and trap
  // markers (6) still layer above it.
  glyph: {
    color: 0xe0791e,
    opacity: 0.78,
    order: 2,
    center_alpha: 0.66,
    center_dim: 0.72,
    unlit_gain: 1.2,
    fade_in_s: 0.45,
    fade_out_s: 0.55,
    merge: true,
  },
  // The live trap renderer is the compound black blob + gold sprite; these values retain its channel contract.
  trap: { color: 0xc8963c, opacity: 0.95, order: 6, border: true },
  selection: { color: 0xdff0ff, opacity: 0.95, order: 6, outline: true },
  ally_seat: { color: TEAM_COLORS.ally, opacity: 0.9, order: 7, border: true },
  enemy_seat: { color: TEAM_COLORS.enemy, opacity: 0.9, order: 7, border: true },
}

/** All channel keys — teardown and clear-all iterate this stable table. */
export const CHANNEL_KEYS = Object.keys(CHANNELS)
