// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT-FEEL — the on-impact screen grade: a thin element-coloured vignette that pulses over the game viewport the instant a cast
// LANDS (voxel_fight_adapter.impact_package → trigger_fight_flash), plus an optional full-screen GRADE moment:
// 'warm' (a heal glows warm), 'desaturate' (a death blow drains colour), 'element-wash' (a big AoE washes the
// edges). Pure presentation — sibling to ZoneSearchFlash; NO post-process pass (the engine ban stands, all in
// CSS on the .fight-impact-flash layer).
//
// A `key={n}` remount forces a FRESH DOM node per hit (even back-to-back — the ZoneSearchFlash precedent),
// restarting the one-shot CSS animation with no JS timer/cleanup. The element colour + intensity ride CSS vars,
// the grade a data-attr; the store frequency-caps fires so there is zero strobe. n===0 (pre-first-cast) renders
// one idle, fully-transparent node. Reduced-motion flattens to a calm single pulse (CSS `@media`) — no JS branch.

import { useSyncExternalStore } from 'react'

import { fight_flash_store } from '../../../core/toast.js'

/** @returns {import('react').ReactElement} */
export function FightImpactFlash() {
  const f = useSyncExternalStore(fight_flash_store.subscribe, fight_flash_store.get)
  return (
    <div
      key={f.n}
      className="fight-impact-flash"
      data-grade={f.grade || undefined}
      style={/** @type {import('react').CSSProperties} */ ({ '--flash-color': f.color, '--flash-intensity': f.intensity })}
      aria-hidden="true"
    />
  )
}
