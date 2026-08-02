// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PROMPT STACK renderer (S-18 discovery — DECISIONS 07-09 pick option 1 + addendum). Renders every live
// world prompt from the prompt_stack registry in the shipped [E]-pill language: the highest-priority
// (closest / most-actionable) prompt sits at the bottom-center ANCHOR — the exact spot the single dungeon
// pill occupied — and the rest stack UPWARD (column-reverse), so the anchor never jumps as prompts come
// and go. ONE keydown listener triggers whichever registered prompt owns the pressed key (D154: typing in
// an input never fires world keys); fight_mode hides the whole stack (no world prompts mid-fight).
// EXCEPTION: 'search' stays REGISTERED here (still routes its F key through the one listener
// below) but is excluded from the rendered pills — its pill now lives directly under CompassStrip.jsx.

import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { use_prompt_stack, visible_prompts } from '../../../../world-shell/prompt_stack.js'
import { play_sfx } from '../../../core/audio/sfx.js'
import { useGameState } from '../../../store.js'
import { InteractionChip } from '../../../touch/InteractionChip.jsx'

/** @returns {import('react').ReactElement | null} */
export function PromptStack() {
  // visible = registered AND not pending: a pressed tx-prompt vanishes instantly and stays gone until its
  // promise settles (the store's optimistic-pending law) — re-appearance is chain truth, never a double-press.
  const prompts = use_prompt_stack(useShallow(visible_prompts))
  const fight_mode = useGameState((s) => s.fight_mode)
  const active = prompts.length > 0 && !fight_mode

  // S-71 §2.11: this is the ONE choke every [F]/[G]/[E]/[R] world prompt press funnels through (key or
  // click) — sfx.js's 'button' cue ships on disk with zero callers; this is its single obvious wire point.
  // The press itself routes through the store's `trigger_prompt` (the pending/single-flight seam).
  const trigger = (/** @type {string} */ id) => {
    play_sfx('button')
    use_prompt_stack.getState().trigger_prompt(id)
  }

  useEffect(() => {
    if (!active) return
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      const el = document.activeElement
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || /** @type {HTMLElement} */ (el).isContentEditable)
      )
        return // D154
      const hit = prompts.find((p) => e.code === `Key${p.key}`)
      if (hit) {
        e.preventDefault()
        trigger(hit.id)
      }
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [active, prompts])

  if (!active) return null

  // column-reverse: array[0] renders at the BOTTOM anchor → sort priority DESC. EXCLUDES 'search' (relocated —
  // its pill now renders directly under CompassStrip.jsx, house .btn-outline idiom) — it
  // stays in the unfiltered `prompts` above for the keydown match, so [F] keeps firing from this ONE listener.
  const ordered = [...prompts].filter((p) => p.id !== 'search').sort((a, b) => b.priority - a.priority)

  return (
    <div className="gw-prompt-stack">
      {ordered.map((p) => (
        <InteractionChip
          key={p.id}
          prompt={p}
          on_trigger={() => trigger(p.id)}
          class_name={`gw-npc-prompt gw-npc-prompt--stacked gw-panel${p.busy ? ' gw-npc-prompt--busy' : ''}`}
        />
      ))}
    </div>
  )
}
