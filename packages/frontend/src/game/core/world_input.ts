// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** The world owns unconsumed keys only while browser focus is outside editing/modal UI. */
export const world_keyboard_eligible = (event: Readonly<Event>): boolean =>
  !event.defaultPrevented &&
  !globalThis.document?.querySelector('dialog[open], [aria-modal="true"]') &&
  !event
    .composedPath()
    .some(
      (target) =>
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input, textarea, select, button, a[href], [role="textbox"]'))
    )

export const WORLD_MOVE_KEYS: Readonly<Record<string, Readonly<{ axis: 'forward' | 'strafe'; sign: 1 | -1 }>>> =
  Object.freeze({
    KeyW: { axis: 'forward', sign: 1 },
    ArrowUp: { axis: 'forward', sign: 1 },
    KeyS: { axis: 'forward', sign: -1 },
    ArrowDown: { axis: 'forward', sign: -1 },
    KeyD: { axis: 'strafe', sign: 1 },
    ArrowRight: { axis: 'strafe', sign: 1 },
    KeyA: { axis: 'strafe', sign: -1 },
    ArrowLeft: { axis: 'strafe', sign: -1 },
  })

export const SPAWN_INTERACTION_RANGE_BLOCKS = 15
