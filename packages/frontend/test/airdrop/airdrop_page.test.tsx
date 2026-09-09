// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { wallet_view } from '../kares/fixture.ts'
import AirdropPage, { HolderWalletConnect } from '../../src/airdrop/AirdropPage.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { initial_session_state } from '../../src/modules/session.ts'

import { TEMPLATE_ID, use_template_fixture } from './fixture.ts'

use_template_fixture()

test('the airdrop page shows curated pets while holder drops stay claimable data', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(<AirdropPage copy={copy} session={initial_session_state()} />)

  for (const pet of content_catalog.airdrop.showcase) {
    expect(pet.kind).toBe('pet_glb')
    expect(html).toContain(pet.name)
  }
})

test('a held voucher resolves its authored item from the template and stays redeemable', async () => {
  const copy = await load_app_copy('en')
  const template = TEMPLATE_ID
  const session = {
    ...initial_session_state(),
    wallet: { address: '0xgame' } as never,
    giftcards: [{ id: '0xgift', template, amount: 1 }],
  }
  const html = renderToStaticMarkup(<AirdropPage copy={copy} session={session} />)

  expect(html).toContain('Sui Crate')
  expect(html).toContain('Giftcards awaiting redemption')
  expect(html).toContain('type="button">Redeem</button>')
})

test('holder connection uses the same wallet control and exposes its shared address', async () => {
  const copy = await load_app_copy('en')
  const t = copy_text(copy.airdrop_page)
  const closed = renderToStaticMarkup(<HolderWalletConnect wallet={wallet_view()} copy={copy} t={t} />)
  const connected = renderToStaticMarkup(<HolderWalletConnect wallet={wallet_view('0xholder')} copy={copy} t={t} />)
  expect(closed).toContain(copy.kares_page.connect)
  expect(closed).toContain('data-wallet-menu')
  expect(connected).toContain('0xholder')
})
