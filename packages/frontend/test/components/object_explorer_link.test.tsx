// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { GameWindow } from '@aresrpg/ui'

import { ObjectExplorerLink } from '../../src/components/ObjectExplorerLink.tsx'
import { env } from '../../src/env.ts'
import { explorer_object_url } from '../../src/explorer.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'

const object_id = `0x${'ab'.repeat(32)}`

test('an item action links its exact chain object beside the window close control', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(
    <GameWindow
      title="Item"
      close={() => undefined}
      close_label="Close"
      actions={<ObjectExplorerLink object_id={object_id} copy={copy} />}
    >
      Item details
    </GameWindow>
  )
  expect(html).toContain(`href="${explorer_object_url(env.network, object_id)}"`)
  expect(html).toContain('aria-label="View on SuiVision"')
  expect(html).toContain('target="_blank"')
  expect(html).toContain('rel="noopener noreferrer"')
  expect(html).toContain('size-11')
  expect(html.indexOf('aui-window-actions')).toBeLessThan(html.indexOf('aria-label="Close"'))
})

test('player and agent character menu entries use their own object identity', async () => {
  const copy = await load_app_copy('en')
  for (const id of [object_id, `0x${'cd'.repeat(32)}`]) {
    const html = renderToStaticMarkup(<ObjectExplorerLink object_id={id} copy={copy} menu />)
    expect(html).toContain(`href="${explorer_object_url(env.network, id)}"`)
    expect(html).toContain('role="menuitem"')
    expect(html).toContain('View on SuiVision</a>')
  }
})

test('templates, missing IDs and local demo identities do not link to an explorer', async () => {
  const copy = await load_app_copy('en')
  for (const id of [undefined, '', 'aberrant_edge', 'demo:character', '0xitem'])
    expect(renderToStaticMarkup(<ObjectExplorerLink object_id={id} copy={copy} />)).toBe('')
  expect(renderToStaticMarkup(<ObjectExplorerLink object_id={object_id} copy={copy} hidden />)).toBe('')
})

test('every supported locale names the SuiVision action', async () => {
  for (const locale of ['en', 'fr', 'de', 'es', 'pt', 'ru', 'uk', 'ja', 'ko', 'zh', 'vi'] as const) {
    const copy = await load_app_copy(locale)
    expect(copy.ui.view_on_suivision).toContain('SuiVision')
  }
})
