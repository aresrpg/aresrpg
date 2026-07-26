// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The spell bar's GRID GEOMETRY — the one home of "how many sockets the bar draws and how many columns it
// takes to draw them" (#1044). Split out of DeckCluster.jsx because two elements need the same answer and CSS
// custom properties only flow DOWN: the socket grid uses it as its column count, and `.hud-spellbar`'s own
// centering anchor uses it to compensate for the extra width (hud.css) — one rule, one derivation, two readers.
//
// THE THREE-ROW LAW: the bar now carries the whole spell book (the socket count grows with every unlocked
// spell), and at a fixed 6 columns a 20-spell book wrapped to FOUR rows — a wall of sockets eating the board.
// The bar caps at MAX_SOCKET_ROWS and grows WIDER instead; socket size never changes (the tray widens, the
// icons do not shrink).
//
// The capacity math, straight off the CSS placement (hud.css `.hud-socketgrid`): the weapon anchor is
// explicitly placed at `grid-row: 1 / span 2` in column 1, so it costs TWO cells of the row budget and the
// spells flow into the remaining `rows * columns - 2`. Solving `rows * columns - 2 >= slots` for columns at
// rows = 3 gives the ceil below. MIN_SOCKET_COLUMNS keeps the default (weapon + 9) bar at exactly the
// measured 5-over-4 shape it ships today — the floor is a look, the ceil is the law.

// FIXED spell-socket floor: the bar does not SHRINK with how many spells are learned. SPEC.md §7 rejects a
// deck concept outright ("a class's spells ARE the minted spell templates... there is no deck concept",
// SPEC.md:337), so there is no authored cap to ground a maximum in — a character with more real spells than
// this still renders every one of them (never hides a castable spell). Grounded in the 1-9 keybind span
// (arm_spell's number-key handler only hotkeys hand[0..8]).
export const SPELL_SLOTS = 9

// The owner's rule, verbatim: at most 3 rows; the HUD grows wider to fit.
export const MAX_SOCKET_ROWS = 3

// The bar's default width — weapon + 9 slots as 5-over-4. Mirrored by hud.css's anchor math, which was
// MEASURED against a 6-column bar (see the CHAT-POSITION INVARIANT comment there).
export const MIN_SOCKET_COLUMNS = 6

/**
 * How many spell sockets the bar draws for a hand — the learned spells, never fewer than the fixed floor.
 * @param {number} hand_length
 * @returns {number}
 */
export const socket_slots = (hand_length) => Math.max(hand_length, SPELL_SLOTS)

/**
 * The socket grid's column count: the narrowest grid that fits every socket within MAX_SOCKET_ROWS rows
 * (the weapon anchor spends two of them), floored at the default bar width.
 * @param {number} hand_length
 * @returns {number}
 */
export const socket_columns = (hand_length) =>
  Math.max(MIN_SOCKET_COLUMNS, Math.ceil((socket_slots(hand_length) + 2) / MAX_SOCKET_ROWS))
