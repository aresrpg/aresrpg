// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppContext } from '../../store.ts'
import type { create_world } from './world.ts'

/** The world owns unconsumed keys only while browser focus is outside editing/modal UI. */
export const world_keyboard_eligible = (event: Readonly<Event>, allow_prompt = false): boolean =>
  !event.defaultPrevented &&
  !globalThis.document?.querySelector('dialog[open], [aria-modal="true"]') &&
  !event
    .composedPath()
    .some(
      (target) =>
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          (target.matches('input, textarea, select, button, a[href], [role="textbox"]') &&
            !(allow_prompt && target.matches('[data-world-interaction]'))))
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

/** Lifecycle adapter for the existing world input device; no application state is retained here. */
export const observe_world_controls = ({
  events,
  get_state,
  read_world,
}: Readonly<{
  events: AppContext['events']
  get_state: AppContext['get_state']
  read_world: () => Pick<ReturnType<typeof create_world>, 'set_jump' | 'set_movement'> | null
}>): void => {
  events.on('engine/jump', ({ down }) => {
    if (get_state().navigation.page === 'world') read_world()?.set_jump(down)
  })
  events.on('engine/movement', ({ forward, strafe }) => {
    if (get_state().navigation.page !== 'world') return
    if (!Number.isFinite(forward) || !Number.isFinite(strafe)) return
    read_world()?.set_movement({ forward, strafe })
  })
}
