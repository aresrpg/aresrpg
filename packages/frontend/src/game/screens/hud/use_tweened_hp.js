// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HP TWEEN (life updates were too fast on the hud and the nameplate). ONE animation home for
// the DISPLAYED health number — the fight HUD Vitals gem AND the board nameplate (EntityTooltip) both consume
// it, so life never snaps and the two surfaces ease identically. Presentation only: the fight fold sets HP
// instantly (chain parity, project.js) — this is a pure display projection over that truth, never a second
// source. The pace matches the house bar-fill token (--dur-3 = 300ms, tokens.css) so the number and its bar
// finish together.

import { useEffect, useRef, useState } from 'react'

// House presentation pace — the --dur-3 bar-fill duration (tokens.css), so the counted number lands with its bar.
export const HP_TWEEN_MS = 300

/**
 * The eased displayed value `elapsed` ms into a `from → to` count at the house pace (quad ease-out). Pure +
 * deterministic (the tweenable core, unit-tested): `elapsed<=0 → from`, `elapsed>=duration → to`, integer
 * throughout. A non-finite bound snaps to `to` (a fresh read with no prior display never counts up from junk).
 * @param {number} from @param {number} to @param {number} elapsed @param {number} [duration]
 */
export const hp_tween_step = (from, to, elapsed, duration = HP_TWEEN_MS) => {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return to
  const p = duration <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / duration))
  const eased = 1 - (1 - p) * (1 - p)
  return Math.round(from + (to - from) * eased)
}

/**
 * Ease the shown HP toward `target` at the house pace. `key` identifies the SUBJECT (the fighter/character):
 * when it changes the display SNAPS to the new target — never counts between two different entities' HP (a
 * fresh hover, a fight swap). The same subject's HP change eases via rAF. First render shows `target` outright.
 * @param {number} target @param {unknown} [key]
 * @returns {number} the value to render
 */
export function useTweenedHp(target, key) {
  const [display, set_display] = useState(target)
  const from = useRef(target)
  const prev_key = useRef(key)
  const raf = useRef(0)

  useEffect(() => {
    // A new subject snaps — hovering a different fighter must show ITS hp at once, not count up from the last.
    if (prev_key.current !== key) {
      prev_key.current = key
      from.current = target
      set_display(target)
      return undefined
    }
    const start_value = from.current
    if (start_value === target) return undefined
    const start_t = performance.now()
    const tick = (now) => {
      const value = hp_tween_step(start_value, target, now - start_t)
      from.current = value
      set_display(value)
      if (value !== target) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, key])

  return display
}
