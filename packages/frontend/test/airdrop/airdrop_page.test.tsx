// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import AirdropPage, { AirdropDropCard } from '../../src/airdrop/AirdropPage.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { rolled_item_types } from '../../src/modules/claims.ts'
import { initial_session_state } from '../../src/modules/session.ts'

test('the airdrop page shows curated pets while holder drops stay claimable data', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(<AirdropPage copy={copy} session={initial_session_state()} />)

  expect(content_catalog.airdrop.drops).toHaveLength(1)
  for (const pet of content_catalog.airdrop.showcase) {
    expect(pet.kind).toBe('pet_glb')
    expect(html).toContain(pet.name)
  }
})

test('an eligible Vaporeon holder sees a live claim button', async () => {
  const copy = await load_app_copy('en')
  const [drop] = content_catalog.airdrop.drops
  if (!drop) throw new Error('the Vaporeon holder drop is missing')
  const html = renderToStaticMarkup(
    <AirdropDropCard
      busy={null}
      drop={drop}
      has_game_wallet
      state={{ drop_id: drop.id, eligible: true, eligible_count: drop.whitelist.length }}
      t={copy_text(copy.airdrop_page)}
    />
  )

  expect(html).toContain('Vaporeon')
  expect(html).toContain('vaporeon holders 318251937')
  expect(html).not.toContain('disabled=""')
})

test('a held voucher resolves its authored item from the template and stays redeemable', async () => {
  const copy = await load_app_copy('en')
  const template = [...rolled_item_types()].find(([, item_type]) => item_type === 'sui_crate')?.[0]
  if (!template) throw new Error('the Sui Crate template is not published')
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
