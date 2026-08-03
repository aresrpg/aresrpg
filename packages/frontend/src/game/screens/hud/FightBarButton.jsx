// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2141 — EVERY CONTROL ON THE FIGHT BAR PRESSES ON WHAT THE PLAYER SAW, NOT ON WHAT THE BAR DRIFTED TO.
//
// The bar runs its OWN clock — FightControls owns a 1Hz `setInterval` (200ms while the min-turn floor gates) —
// and reads `busy` from the run store, which flips synchronously the instant a chain write starts. Neither is
// aligned with a human's gesture, so a re-render can land BETWEEN a press's mousedown and its mouseup. When
// that re-render swaps a NATIVE `disabled` onto the control, the platform drops the already-queued click on
// the floor: HTML Standard, `disabled` — a disabled form control "must prevent any click events that are
// queued on the user interaction task source from being dispatched on the element". No handler runs, nothing
// is logged, nothing is reported; the click simply dies on a button that looks enabled again a tick later.
// Proven live on FORFEIT (#2136's leg-2 rig: the click landed on the button, nothing covered it, no modal
// opened); Playwright's re-resolving `.click()` papered over it by landing the second attempt.
//
// THE SEMANTICS (of the two the row offered): THE PRESS IS DECIDED AT PRESS TIME.
//   · the refusal stays live and honest, but on `aria-disabled` — never on the native attribute. The click is
//     therefore always DELIVERED, and the decision is ours to make rather than the platform's to swallow;
//   · the handler fires only if the control was enabled when the player pushed it DOWN.
// SAFETY BOUND: a control the player saw disabled at press can never fire. `armed` is `!disabled` read once,
// at pointerdown, and never re-read — so a mid-gesture flip is ignored in BOTH directions.
//
// The arm lives on the pressed NODE (a WeakMap keyed by the button element), not in component state: a gesture
// belongs to the thing being pressed, it has to survive the very re-renders this bug is made of, and it dies
// with the node — no cleanup, no listener, no timer. That also keeps this component hook-free, so it stays
// callable directly, the way the house tests every action seam (FightEndTurnButton, FightReportBugButton).

/** What the player SAW when they pushed this node down. One live gesture per control, collected with it. */
const press_arm = new WeakMap()

/**
 * @param {{
 *   className?: string,
 *   on_click?: (event: any) => void,
 *   disabled?: boolean,
 *   title?: string,
 *   children?: import('react').ReactNode,
 * }} props
 * @returns {import('react').ReactElement}
 */
export function FightBarButton({ className, on_click, disabled = false, title, children }) {
  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-disabled={disabled}
      onPointerDown={(event) => {
        press_arm.set(event.currentTarget, !disabled)
      }}
      onPointerLeave={(event) => {
        // The pointer left the target mid-gesture: whatever happens next, it is no longer THIS press. Dropping
        // the arm also stops a stale one from being inherited by a later keyboard activation.
        press_arm.delete(event.currentTarget)
      }}
      onClick={(event) => {
        // No arm on record = an activation with no down↔up window to race (Enter/Space, assistive tech): that
        // one reads the live fact. An arm is consumed by exactly one release, hence the delete.
        const armed = press_arm.get(event.currentTarget) ?? !disabled
        press_arm.delete(event.currentTarget)
        if (armed) on_click?.(event)
      }}
    >
      {children}
    </button>
  )
}
