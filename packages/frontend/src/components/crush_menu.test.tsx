import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import i18n from '../i18n'

import { explorer_object_url } from './explorer_link'

const crush_calls: any[] = []

mock.module('../world-shell/crush_actions.js', () => ({
  crush_preview: async () => ({ removed: false, rows: [], coeff_milli: 100_000, estimated: false }),
  crush_item: async (args: any) => {
    crush_calls.push(args)
    return { result: {} }
  },
}))

const crush_menu = await import('./crush_menu')

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
      />
    </I18nextProvider>
  )

describe('CrushMenu action wiring', () => {
  test('a non-crushable selection is disabled and visibly explains why', () => {
    const html = render_menu(item(ITEM_CATEGORY.CONSUMABLE))

    expect(html).toContain('disabled=""')
    expect(html).toContain('data-crush-disabled-reason="true"')
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
})
