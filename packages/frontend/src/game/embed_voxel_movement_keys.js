// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure WASD/arrow movement-key resolver — split out of embed_voxel_player.js's on_key SPECIFICALLY so the
// "arrows alias WASD" contract is unit-testable without mounting the player (embed_voxel_player.js pulls in
// the engine + p2p/lobby-room + store.js, which touch `window`/zkLogin at import time — the same bun:test
// wall deck-key-arm.js's header documents for the HUD side).
//
// witness-r4 (2026-07-11): "arrow keys don't move (WASD works)". The switch in embed_voxel_player.js already
// mapped ArrowUp/Down/Left/Right onto the same keys.forward/strafe fields as KeyW/A/S/D — so the two were
// NEVER actually different actions. The observable defect was the browser's OWN default action: nothing ever
// called e.preventDefault() for the arrow keys, and body/html carry no `overflow:hidden` (index.css has no
// such rule) — so held arrows scroll the PAGE instead of (visually, on top of) moving the character. is_movement_key
// below is the exact set on_key now preventDefault()s on, so the "stop page-scroll" gate can never drift from
// the "what moves the body" gate — one list, two call sites.

/** @typedef {{ axis: 'forward' | 'strafe', sign: 1 | -1 }} MovementKey */

/**
 * Resolve a KeyboardEvent.code to the movement axis/sign it drives, or null for a non-movement key. WASD and
 * arrows are DELIBERATELY the same output for their paired code — that identity is the whole point (the
 * "arrows alias WASD" contract witness-r4 expects) and is what the test below asserts key-by-key.
 * @param {string} code KeyboardEvent.code (physical key, layout-independent — AZERTY-safe unlike .key)
 * @returns {MovementKey | null}
 */
export function resolve_movement_key(code) {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      return { axis: 'forward', sign: 1 }
    case 'KeyS':
    case 'ArrowDown':
      return { axis: 'forward', sign: -1 }
    case 'KeyA':
    case 'ArrowLeft':
      return { axis: 'strafe', sign: -1 }
    case 'KeyD':
    case 'ArrowRight':
      return { axis: 'strafe', sign: 1 }
    default:
      return null
  }
}

/** True for any code the map above moves on — on_key's preventDefault gate (stops the arrow-key page-scroll;
 *  harmless on WASD, which has no browser default to suppress). @param {string} code @returns {boolean} */
export function is_movement_key(code) {
  return resolve_movement_key(code) !== null
}
