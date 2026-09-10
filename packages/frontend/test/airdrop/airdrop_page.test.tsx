// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { wallet_view } from '../kares/fixture.ts'
import AirdropPage, { HolderWalletConnect, group_giftcards } from '../../src/airdrop/AirdropPage.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { initial_session_state } from '../../src/modules/session.ts'

import { TEMPLATE_ID, use_template_fixture } from './fixture.ts'

use_template_fixture()

test('claim cards group identical rewards without changing voucher quantities', () => {
  const cards = [
    { id: 'a', template: 'crate', amount: 3 },
    { id: 'b', template: 'crate', amount: 2 },
    { id: 'c', template: 'pet', amount: 1 },
  ]
  expect(group_giftcards(cards)).toEqual([
    { template: 'crate', amount: 5 },
    { template: 'pet', amount: 1 },
  ])
  expect(cards).toHaveLength(3)
})

test('every supported campaign explains eligibility, including wallet drops, physical cards and Hytale tiers', async () => {
  const copy = await load_app_copy('en')
  const t = copy_text(copy.airdrop_page)
  const html = renderToStaticMarkup(<AirdropPage copy={copy} session={initial_session_state()} />)
  for (const campaign of content_catalog.airdrop.campaigns) {
    expect(html).toContain(`data-airdrop="${campaign.id}"`)
    expect(t(`campaigns.${campaign.id}.title`)).not.toBe(`campaigns.${campaign.id}.title`)
    expect(t(`campaigns.${campaign.id}.description`).length).toBeGreaterThan(30)
  }
  expect(html).toContain('Vaporeon')
  expect(html).toContain('Singapore')
  expect(html).toContain('Mark of the Unbroken')
  expect(html).toContain('more than 100 SUI')
  expect(html).not.toContain('September')
  expect(html).toContain('Ranks 1–10: 3 of each crate')
  expect(html).toContain('Ranks 11–50: 2 of each crate')
  expect(html).toContain('Ranks 51–100: 1 of each crate')
  expect(html).not.toContain('showcase')
  expect(html).not.toContain('Reserved items')
  expect(html).not.toContain('temporary_test')
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
  expect(html).toContain('Claim rewards')
  expect(html).toContain('max-w-3xl')
  expect(html).not.toContain('>Redeem</button>')
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
