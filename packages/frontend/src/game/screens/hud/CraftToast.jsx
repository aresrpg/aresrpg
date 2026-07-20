// Center-top craft-queue toast (Wave CRAFT). Shows the ACTIVE craft (result icon + name), the queue
// length (remaining / total), and a live progress bar for the in-flight craft. The SERVER is the sole
// authority: this only renders the `state.craft` slice the server pushes (per_ms + started_at_ms), and
// extrapolates the current craft's progress locally for a smooth bar (re-synced on every server push).
// House design: glass over the live world, mono tabular nums, ice-blue accent, no pills/rails.

import { useEffect, useRef, useState } from 'react'

import { use_game_state } from '../../store.js'
import ITEMS_DATA from '@aresrpg/sdk/items-data' with { type: 'json' }
import { ItemIcon } from './ItemIcon.jsx'
import './craft-toast.css'

/** Resolve a recipe item's display name from the content seed (falls back to the id). */
const recipe_name = id =>
  /** @type {Record<string, { name?: string }>} */ (ITEMS_DATA)[id]?.name ?? id

/** @returns {import('react').JSX.Element | null} */
export function CraftToast() {
  const craft = use_game_state(s => s.craft)
  // A local clock so the active craft's bar advances smoothly between server pushes (the server is
  // still the authority — every craftProgress push re-bases per_ms + started_at_ms + remaining).
  const [, force] = useState(0)
  const raf = useRef(/** @type {number | null} */ (null))

  useEffect(() => {
    if (!craft?.active) return undefined
    const tick = () => {
      force(n => (n + 1) % 1_000_000)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current)
    }
  }, [craft?.active, craft?.started_at_ms])

  if (!craft?.active) return null

  const { recipe_id, remaining, total, per_ms, started_at_ms } = craft
  // Progress of the CURRENT (in-flight) craft: elapsed since it started over its duration, clamped.
  const elapsed = Date.now() - started_at_ms
  const pct = Math.max(0, Math.min(100, (elapsed / Math.max(1, per_ms)) * 100))
  // crafts already finished in this batch = total - remaining
  const done = total - remaining
  return (
    <div className="craft-toast" role="status" aria-live="polite">
      <span className="craft-toast__icon" aria-hidden="true">
        <ItemIcon item={{ slug: recipe_id }} />
      </span>
      <div className="craft-toast__body">
        <div className="craft-toast__head">
          <span className="craft-toast__name">{recipe_name(recipe_id)}</span>
          <span className="craft-toast__count hud-num">
            {done} / {total}
          </span>
        </div>
        <div className="craft-toast__bar">
          <div className="craft-toast__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="craft-toast__sub">
          Crafting <span className="hud-num">{remaining}</span> left
        </div>
      </div>
    </div>
  )
}
