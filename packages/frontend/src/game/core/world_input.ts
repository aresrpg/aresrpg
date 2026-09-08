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
