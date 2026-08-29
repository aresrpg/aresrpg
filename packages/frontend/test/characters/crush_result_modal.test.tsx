// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, mock, test } from 'bun:test'
import type { ItemRow } from '@aresrpg/protocol'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { load_app_copy } from '../../src/i18n/copy.ts'

mock.module('../../src/components/ModalFrame.tsx', () => ({
  ModalFrame: ({
    children,
    close,
    soft,
  }: Readonly<{ children: ReactNode; close: (() => void) | null; soft?: boolean }>) => (
    <div data-dismissible={close ? '' : undefined} data-soft-modal={soft ? '' : undefined}>
      {children}
    </div>
  ),
}))
mock.module('../../src/content/assets.ts', () => ({ item_icon: () => '/rune.png' }))
mock.module('../../src/components/ItemSnapshotTooltip.tsx', () => ({
  ItemSnapshotTooltip: () => <span data-rune-tooltip="" />,
  useItemSnapshotHover: () => ({ close: () => undefined, hover: null, open: () => undefined }),
}))

const { CrushProgressDialog, CrushResultDialog } = await import('../../src/characters/CrushResultModal.tsx')

const rune = Object.freeze({
  id: '0xrune',
  item_type: 'rune_ba_feu',
  amount: 6,
  name: 'Rune Ba Feu',
  category: 'rune',
  level: 1,
  kiosk: '0xkiosk',
}) satisfies ItemRow

test('the rounded crush result is an inventory subset rendered with normal item cells', async () => {
  const copy = await load_app_copy('en')
  const markup = renderToStaticMarkup(
    <CrushResultDialog close={() => undefined} copy={copy} result={{ digest: 'tx', items: [rune] }} />
  )

  expect(markup).toContain('data-soft-modal=""')
  expect(markup).toContain('data-crush-result-inventory=""')
  expect(markup).toContain('class="chr-cell"')
  expect(markup).toContain('×6')
  expect(markup).not.toContain('chr-cell__lvl')
  expect(markup).not.toContain('+6')
  expect(markup).toContain('data-rune-tooltip=""')
})

test('crushing keeps one non-dismissible animated item modal mounted', async () => {
  const copy = await load_app_copy('en')
  const markup = renderToStaticMarkup(<CrushProgressDialog copy={copy} item={{ ...rune, amount: 1, level: 20 }} />)

  expect(markup).toContain('data-crush-progress=""')
  expect(markup).toContain('animate-pulse')
  expect(markup).not.toContain('data-dismissible=""')
})
