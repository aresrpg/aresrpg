// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { TOAST_CONTAINER_CLASS, toast, toast_glass_class, type Toast } from '../../src/toast.ts'

describe('app toast effects', () => {
  test('a persistent toast is a show/remove event pair with no second store', () => {
    const events: unknown[] = []
    const unsubscribe = toast.subscribe((event) => events.push(event))
    const dismiss = toast.persistent('Loading the universe', 'pending')
    const shown = events[0] as Readonly<{ type: 'show'; toast: Toast }>

    expect(shown.type).toBe('show')
    expect(shown.toast).toMatchObject({ message: 'Loading the universe', type: 'pending', persistent: true })
    dismiss()
    expect(events[1]).toEqual({ type: 'remove', id: shown.toast.id })
    unsubscribe()
  })

  test('retains the legacy safe-area toast placement and glass recipe', () => {
    expect(TOAST_CONTAINER_CLASS).toContain('top-[max(1rem,var(--safe-top))]')
    expect(TOAST_CONTAINER_CLASS).toContain('right-[max(1rem,var(--safe-right))]')
    expect(toast_glass_class).toContain('animate-[slide-in_0.3s_ease-out]')
  })
})
