// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Single source of truth for inline SVG icons shared by the vanilla DOM screens
// (character-select.js / character-create.js — consumed via innerHTML) and the one
// React HUD component (Hud.jsx — consumed via dangerouslySetInnerHTML).
//
// Path data is verbatim Lucide (MIT, https://lucide.dev): 24x24 viewBox, stroke-based,
// stroke="currentColor" so existing CSS `color` rules drive the tint with no new tokens.
// This replaces the typographic glyphs ❮ ❯ ✕ with a real icon set per the house design law.

/** @param {string} body */
const svg = (body) =>
  `<svg class="hud-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icon_chevron_left = svg('<path d="m15 18-6-6 6-6"/>')

export const icon_chevron_right = svg('<path d="m9 18 6-6-6-6"/>')

export const icon_x = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')

// ── HUD launcher / panel icons (lifted from the Tactician's Table demo .lbtn set, Lucide) ──
export const icon_inventory = svg(
  '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>'
)

export const icon_character = svg('<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>')

export const icon_quests = svg(
  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'
)

export const icon_spells = svg(
  '<rect x="3" y="5" width="13" height="16" rx="2"/><path d="M8 5V3h10a2 2 0 0 1 2 2v12"/>'
)

export const icon_market = svg(
  '<path d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>'
)

// Jobs / gathering — a sickle over a stalk (Lucide-style, currentColor).
export const icon_jobs = svg(
  '<path d="M2 22 16 8"/><path d="M17 7a5 5 0 0 1 5-5 5 5 0 0 1-5 5z"/><path d="M14 4a6 6 0 0 1 6 6"/>'
)

// Combat toggle — crossed-blade glyph (Lucide swords).
export const icon_fight = svg(
  '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/>'
)

// A small class glyph for the player list (a generic radiant mark — class art comes later).
export const icon_class_glyph = svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')

// Characters — the multi-user roster / switcher glyph.
export const icon_characters = svg(
  '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
)

// Encyclopedia — a book / atlas glyph.
export const icon_encyclopedia = svg(
  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'
)

// Leaderboards — a podium / bar-ranking glyph (Lucide bar-chart).
export const icon_leaderboards = svg(
  '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>'
)

// Simulator — a sliders / build-planner glyph (Lucide sliders-horizontal).
export const icon_simulator = svg(
  '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>'
)

// Map — a folded world-map glyph (Lucide map).
export const icon_map = svg('<path d="M3 6 9 3l6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/>')

// Admin — a shield / owner console glyph (Lucide shield, owner-gated).

// ── Toast state icons (lifted from the demo TOAST_ICONS set) ──
export const icon_toast_info = svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')
export const icon_toast_success = svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>')
export const icon_toast_error = svg('<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>')
