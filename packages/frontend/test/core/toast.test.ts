// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  on_error_translate,
  on_gas_empty,
  TOAST_CONTAINER_CLASS,
  toast,
  toast_glass_class,
  type Toast,
} from '../../src/toast.ts'

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

  test('a rich toast retains its accessible sentence and colored semantic parts', () => {
    const events: unknown[] = []
    const unsubscribe = toast.subscribe((event) => events.push(event))
    toast.rich(
      'Sold ×1 Rune PA for 2.00 SUI',
      [
        { text: 'Sold ', tone: 'default' },
        { text: '×1', tone: 'gold' },
        { text: ' Rune PA', tone: 'primary' },
        { text: ' for ', tone: 'default' },
        { text: '2.00 SUI', tone: 'sui' },
      ],
      'success'
    )
    const shown = events[0] as Readonly<{ type: 'show'; toast: Toast }>

    expect(shown.toast).toMatchObject({ message: 'Sold ×1 Rune PA for 2.00 SUI', type: 'success' })
    expect(shown.toast.parts?.slice(0, 2)).toEqual([
      { text: 'Sold ', tone: 'default' },
      { text: '×1', tone: 'gold' },
    ])
    unsubscribe()
  })

  test('an empty gas balance opens funding without exposing the SDK refusal', () => {
    const events: unknown[] = []
    let funding_requests = 0
    const unsubscribe = toast.subscribe((event) => events.push(event))
    on_gas_empty(() => {
      funding_requests += 1
    })
    const error = new Error(
      'Unable to perform gas selection due to insufficient SUI balance (in address balance or coins) for account 0x1 to satisfy required budget 200000000.'
    )

    toast.add(error)
    const pending = toast.loading('Submitting…')
    pending.error(error)
    on_gas_empty(null)

    expect(funding_requests).toBe(2)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'show', toast: { message: 'Submitting…', type: 'pending' } })
    expect(events[1]).toMatchObject({ type: 'remove' })
    unsubscribe()
  })
})
