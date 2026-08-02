// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Presentation-only clock for lazy character HP. Chain reads keep entering through the reducer; this hook owns no
// HP state and writes no store. Its timer merely asks React to render again, then the pure projection recomputes
// from the unchanged authoritative anchor and the current wall clock.

import { useEffect, useState } from 'react'

import { next_projected_hp_ms, projected_hp } from '../chain/read_character.js'

const noop = () => {}

/**
 * Arm one presentation wake-up at an absolute HP boundary. Dependencies are injectable so lifecycle behavior is
 * proven without a DOM; production uses the platform clock/timers. Returns the cleanup React calls on re-arm or
 * unmount.
 * @param {number | null} next_ms
 * @param {() => void} on_tick
 * @param {{ now?: () => number, set_timeout?: typeof setTimeout, clear_timeout?: typeof clearTimeout }} [deps]
 * @returns {() => void}
 */
export function arm_projection_timer(next_ms, on_tick, deps = {}) {
  if (next_ms == null) return noop
  const now = deps.now ?? Date.now
  const set_timeout = deps.set_timeout ?? globalThis.setTimeout
  const clear_timeout = deps.clear_timeout ?? globalThis.clearTimeout
  const timer = set_timeout(on_tick, Math.max(1, next_ms - now()))
  return () => clear_timeout(timer)
}

/**
 * Project one character's current chain HP and repaint at each exact integer boundary.
 * @param {import('../chain/read_character.js').CharacterFields | null | undefined} character
 * @param {boolean} [enabled]
 * @returns {number | null}
 */
export function useProjectedHp(character, enabled = true) {
  const [revision, set_revision] = useState(0)
  const now_ms = Date.now()
  const live = enabled && character != null
  const health = live ? projected_hp(character, now_ms) : null
  const next_ms = live ? next_projected_hp_ms(character, now_ms) : null

  useEffect(() => {
    return arm_projection_timer(next_ms, () => set_revision((value) => value + 1))
  }, [next_ms, revision])

  return health
}
