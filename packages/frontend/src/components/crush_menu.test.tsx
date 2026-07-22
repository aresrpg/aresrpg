// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import i18n from '../i18n'

import { explorer_object_url } from './explorer_link'

const crush_calls: any[] = []

mock.module('virtual:item_catalog', () => ({ slugs: {} }))

mock.module('../world-shell/crush_actions.js', () => ({
  crush_preview: async () => ({ removed: false, rows: [], coeff_milli: 100_000, estimated: false }),
  crush_item: async (args: any) => {
    crush_calls.push(args)
    return { result: {} }
  },
}))

const crush_menu = await import('./crush_menu')
const crush_menu_source = readFileSync(new URL('./crush_menu.tsx', import.meta.url), 'utf8')

const item = (item_category: string) => ({
  id: '0xitem',
  template_id: '0xtemplate',
  item_type: 'shared-slug',
  item_category,
  name: 'Test Item',
  amount: 1,
})

const render_menu = (target: any) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <crush_menu.CrushMenu
        menu={{ x: 12, y: 24, item: target }}
        on_close={() => {}}
        confirm={null}
        set_confirm={() => {}}
        on_send={() => {}}
      />
    </I18nextProvider>
  )

describe('CrushMenu action wiring', () => {
  // No item selected is the ONLY remaining disabled case post-#270 (defensive — the menu never opens without a
  // concrete item in practice). is_crushable is universal now, so a real item never disables the button.
  test('no item selected is disabled and visibly explains why', () => {
    const html = render_menu(null)

    expect(html).toContain('disabled=""')
    expect(html).toContain('data-crush-disabled-reason="true"')
  })

  // ISSUE #270 (RED before the fix — a CONSUMABLE was previously excluded by GEAR_CATEGORIES and rendered
  // disabled): crushing is universal, so a plain non-gear item is now an ENABLED affordance.
  test('a previously-excluded category (consumable) is now enabled — universal crush', () => {
    const html = render_menu(item(ITEM_CATEGORY.CONSUMABLE))

    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('data-crush-disabled-reason="true"')
  })

  test('a crushable item dispatches the crush action exactly once', async () => {
    crush_calls.length = 0
    const gear = item(ITEM_CATEGORY.HAT)

    await crush_menu.dispatch_crush_action?.({
      item: gear,
      character_id: '0xcharacter',
      toast: async (promise: Promise<any>) => promise,
    })

    expect(crush_calls).toEqual([{ item: gear, character_id: '0xcharacter' }])
  })

  test('four concurrent confirms share one refused crush attempt and one toast, then re-arm', async () => {
    const refusal = new Error('refused before signing')
    let reject_refusal: (error: Error) => void = () => {}
    const refused = new Promise((_resolve, reject) => {
      reject_refusal = reject
    })
    let crush_attempts = 0
    let toast_attempts = 0
    const gear = item(ITEM_CATEGORY.HAT)
    const dispatch = () =>
      crush_menu.dispatch_crush_action?.({
        item: gear,
        character_id: '0xcharacter',
        crush: async () => {
          crush_attempts += 1
          return refused
        },
        toast: (promise: Promise<any>) => {
          toast_attempts += 1
          return promise
        },
      }) as Promise<any>

    const concurrent = [dispatch(), dispatch(), dispatch(), dispatch()]
    await Promise.resolve()
    reject_refusal(refusal)
    const outcomes = await Promise.allSettled(concurrent)

    expect(concurrent.every((attempt) => attempt === concurrent[0])).toBe(true)
    expect(crush_attempts).toBe(1)
    expect(toast_attempts).toBe(1)
    expect(outcomes.every((outcome) => outcome.status === 'rejected' && outcome.reason === refusal)).toBe(true)

    await dispatch().catch(() => {})
    expect(crush_attempts).toBe(2)
    expect(toast_attempts).toBe(2)
  })

  // ISSUE #270 (RED before the fix — this threw "This item cannot be crushed into runes." before ever
  // reaching crush(), so crush_calls stayed empty): a zero-rune, non-gear item composes the SAME PTB.
  test('a zero-rune (non-gear) item ALSO dispatches the crush action exactly once', async () => {
    crush_calls.length = 0
    const resource = item(ITEM_CATEGORY.RESOURCE)

    await crush_menu.dispatch_crush_action?.({
      item: resource,
      character_id: '0xcharacter',
      toast: async (promise: Promise<any>) => promise,
    })

    expect(crush_calls).toEqual([{ item: resource, character_id: '0xcharacter' }])
  })

  test('preview loading never deadlocks a valid crush button', () => {
    expect(crush_menu.crush_confirm_disabled?.({ item: item(ITEM_CATEGORY.HAT), busy: false, preview: null })).toBe(
      false
    )
  })

  test('the popover carries a See on Explorer row wired to the item object id', () => {
    // a REAL hex id on purpose ('0xitem' — the shared fixture's dummy id — isn't valid hex, so
    // explorer_object_url correctly nulls it; the row must key off the item's actual on-chain id).
    const gear = { ...item(ITEM_CATEGORY.HAT), id: '0xabc123' }
    const html = render_menu(gear)
    const url = explorer_object_url('0xabc123')
    expect(url).not.toBeNull()
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('target="_blank"')
  })

  test('the popover carries the localized SEND action for every item shape', () => {
    expect(render_menu(item(ITEM_CATEGORY.CONSUMABLE))).toContain(i18n.t('gift.send.send_items'))
    expect(render_menu(item(ITEM_CATEGORY.HAT))).toContain(i18n.t('gift.send.send_items'))
  })
})

// CONFIRM-COPY REFRAME (issue #270): the confirm dialog's headline + the result toast share ONE zero-yield
// signal off the preview's deterministic rune SET — pure functions, no DOM needed (crush_menu.tsx wires them
// into CrushConfirmModal's JSX + do_crush()'s success_key).
describe('crush confirm-copy reframe (crush_is_zero_yield / crush_line_key / crush_success_key)', () => {
  test('a definitive zero-yield preview reframes to the honest destroy copy', () => {
    const zero_preview = { removed: false, rows: [], estimated: false }
    expect(crush_menu.crush_is_zero_yield?.(zero_preview)).toBe(true)
    expect(crush_menu.crush_line_key?.(zero_preview)).toBe('crush.destroy_line')
    expect(crush_menu.crush_success_key?.(zero_preview)).toBe('crush.success_destroyed')
  })

  test('a non-empty yield set keeps the rune-yield copy', () => {
    const yield_preview = { removed: false, rows: [{ stat_key: 'vit', min: 1, max: 3 }], estimated: false }
    expect(crush_menu.crush_is_zero_yield?.(yield_preview)).toBe(false)
    expect(crush_menu.crush_line_key?.(yield_preview)).toBe('crush.line')
    expect(crush_menu.crush_success_key?.(yield_preview)).toBe('crush.success')
  })

  test('loading / failed / removed previews never claim a zero yield (never mislabels an unknown outcome)', () => {
    expect(crush_menu.crush_line_key?.(null)).toBe('crush.line') // still loading
    expect(crush_menu.crush_line_key?.({ removed: false, rows: [], estimated: true, failed: true })).toBe('crush.line')
    expect(crush_menu.crush_line_key?.({ removed: true, rows: [], estimated: false })).toBe('crush.line')
  })
})

describe('crush dialog art and house controls (#486)', () => {
  test('the dialog resolves authored art through the inventory grid icon home', () => {
    const gear = item(ITEM_CATEGORY.HAT)
    const authored_slugs = { [gear.name]: 'authored_hat_art' }

    expect(crush_menu.crush_dialog_item_icon?.(gear, authored_slugs)).toBe('authored_hat_art')
    expect(crush_menu_source).toContain('slug: crush_dialog_item_icon(item)')
  })

  test('cancel wears the gold outline and crush wears the destructive outline', () => {
    expect(crush_menu.crush_cancel_button_class).toContain('btn-outline')
    expect(crush_menu.crush_cancel_button_class).not.toContain('btn-outline--danger')
    expect(crush_menu.crush_confirm_button_class).toContain('btn-outline--danger')
    expect(crush_menu_source).toContain('className={crush_cancel_button_class}')
    expect(crush_menu_source).toContain('className={crush_confirm_button_class}')
  })
})
