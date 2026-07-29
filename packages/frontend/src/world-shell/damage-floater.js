// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure view-model for a queued damage/heal beat. Keeping this outside voxel_fight_adapter's runtime graph lets
// the draft-preview unit prove the exact renderer input: `kind: crit` is the engine's house amber/orange number.

/**
 * @param {{ damage?: number, heal?: number, is_critical?: boolean }} event
 * @returns {{ amount: number, kind: 'damage'|'heal'|'crit', text: string }}
 */
export const damage_floater = (event) => {
  const amount = Math.max(0, Number(event.damage ?? event.heal ?? 0))
  const kind = event.heal != null ? 'heal' : event.is_critical ? 'crit' : 'damage'
  return { amount, kind, text: `${kind === 'heal' ? '+' : '-'}${amount}` }
}

/** The ONLY float classes the board ever renders: damage, heal, and the AP/MP pool deltas ('crit' is the
 *  amber damage variant, not a fifth class). A float is a NUMBER — nothing else earns one. */
const NUMERIC_FLOAT_KINDS = new Set(['damage', 'crit', 'heal', 'ap', 'mp'])

/** A fully-composed float text is a bare signed integer ('-7', '+12') — the engine parses the magnitude back
 *  out of it for sizing (board_entities.make_float_sprite), so anything else is not a number to begin with. */
const NUMERIC_FLOAT_TEXT = /^[+-]?\d+$/

/**
 * THE FLOAT DOOR. Every payload heading for a board float passes through here; one that is not a numeric class
 * or whose text is not a bare number is DROPPED. A raw effect slug ("STAT_BUFF") rendered as a floating combat
 * number is the bug this door makes unreachable — no matter what a future producer composes. Status visibility
 * is the projection-owned badge surface, never a float. Dropping is silent by design (presentation, not an
 * error path); the dev-only warn keeps a mistaken producer visible while building.
 * @param {{ text?: unknown, kind?: unknown } | null | undefined} float
 * @returns {{ text: string, kind: string } | null}
 */
export const numeric_float = (float) => {
  if (!float) return null
  const { text, kind } = /** @type {{ text?: unknown, kind?: unknown }} */ (float)
  if (NUMERIC_FLOAT_KINDS.has(/** @type {string} */ (kind)) && NUMERIC_FLOAT_TEXT.test(String(text)))
    return /** @type {{ text: string, kind: string }} */ (float)
  if (import.meta.env?.DEV) console.warn('[float] dropped a non-numeric float payload', { text, kind })
  return null
}
