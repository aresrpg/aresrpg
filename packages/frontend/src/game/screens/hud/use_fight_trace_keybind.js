// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The in-fight EXPORT REPLAY keybind (issue #209) — bare "R", no modifiers. Mounted from FightControls.jsx,
// which only exists while a fight is live (`if (!fight) return null` — the component unmounts with the fight
// on both the world and dungeon paths), so the chord is live for exactly "during a fight". Same is_typing()
// guard DeckCluster/embed_voxel/NpcPrompt each already own (house convention: this check is small enough that
// every scoped keydown listener carries its own copy rather than a shared import).

import { useEffect } from 'react'

import { export_fight_trace } from './fight_trace_export.js'

const is_typing = () => {
  const el = document.activeElement
  return (
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || /** @type {HTMLElement} */ (el).isContentEditable)
  )
}

/** Registers the listener for as long as the caller is mounted. Call unconditionally, alongside a component's
 *  other hooks (Rules of Hooks) — FightControls only mounts during a fight, so that's this chord's whole scope. */
export function use_fight_trace_keybind() {
  useEffect(() => {
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (is_typing()) return
      if (e.key.toLowerCase() !== 'r') return
      // NO SILENT FAILURE (house telemetry law): a keypress that resolved to nothing NAMES why, same as the
      // deck's arm-refusal console line — never a keypress that just vanishes.
      if (!export_fight_trace()) console.info('[fight] export replay refused — nothing captured yet')
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [])
}
