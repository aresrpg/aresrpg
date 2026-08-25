// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { on_error_translate, TOAST_CONTAINER_CLASS, toast, toast_glass_class, type Toast } from '../../src/toast.ts'

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

  test('a registered translator turns a raw chain abort into player copy — errors only', () => {
    const events: unknown[] = []
    const unsubscribe = toast.subscribe((event) => events.push(event))
    on_error_translate((message) => (message.includes('::version::assert_latest') ? 'The game is paused.' : null))
    toast.add(
      new Error(
        "Transaction resolution failed: MoveAbort in 3rd command, abort code: 601, in '0xfed::version::assert_latest' (instruction 8)"
      )
    )
    toast.add('plain info line', 'info')
    on_error_translate(null)
    const [aborted, info] = events as readonly Readonly<{ toast: Toast }>[]
    expect(aborted!.toast.message).toBe('The game is paused.')
    expect(aborted!.toast.type).toBe('error')
    expect(info!.toast.message).toBe('plain info line')
    unsubscribe()
  })

  test('retains the legacy safe-area toast placement and glass recipe', () => {
    expect(TOAST_CONTAINER_CLASS).toContain('top-[max(1rem,var(--safe-top))]')
    expect(TOAST_CONTAINER_CLASS).toContain('right-[max(1rem,var(--safe-right))]')
    expect(toast_glass_class).toContain('animate-[slide-in_0.3s_ease-out]')
  })

  test('a completed pending toast may carry the gathered item icon', () => {
    const events: unknown[] = []
    const unsubscribe = toast.subscribe((event) => events.push(event))
    const pending = toast.loading('Gathering…')
    pending.success('Gathered 2 × Ivory Shrooms', '/item/ivory_shrooms.png')
    const shown = events.at(-1) as Readonly<{ type: 'show'; toast: Toast }>

    expect(shown.toast).toMatchObject({
      message: 'Gathered 2 × Ivory Shrooms',
      icon: '/item/ivory_shrooms.png',
      type: 'success',
    })
    unsubscribe()
  })
})
