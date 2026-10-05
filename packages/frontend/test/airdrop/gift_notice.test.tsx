// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { GiftClaimNoticeView, gift_funding_text } from '../../src/airdrop/GiftClaimNotice.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initial_distribution_state } from '../../src/modules/distribution.ts'
import { initial_session_state } from '../../src/modules/session.ts'

import { TEMPLATE_ID, use_template_fixture } from './fixture.ts'

use_template_fixture()
const card = { id: 'gift', template: TEMPLATE_ID, amount: 1 }
const distribution = { ...initial_distribution_state(), notice: { kind: 'received' as const, giftcards: [card] } }
const session = { ...initial_session_state(), giftcards: [card] }
const noop = () => undefined

test('confirmed redemption retains the reward artwork and inventory confirmation', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(
    <GiftClaimNoticeView
      copy={copy}
      distribution={distribution}
      session={{ ...session, giftcards: [], redeemed_giftcards: [card.id] }}
      close={noop}
      fund={noop}
      redeem={noop}
    />
  )
  expect(html).toContain('You got a gift!')
  expect(html).toContain('Sui Crate')
  expect(html).toContain('Your reward is ready in your inventory.')
  expect(html).not.toContain('Claim rewards')
})

test('gas failure celebrates the held gift and provides funding plus explicit claim retry', async () => {
  const copy = await load_app_copy('en')
  const failed = { ...distribution, error: 'no valid gas coin' }
  const html = renderToStaticMarkup(
    <GiftClaimNoticeView copy={copy} distribution={failed} session={session} close={noop} fund={noop} redeem={noop} />
  )
  expect(html).toContain('Sui Crate')
  expect(html).toContain('Your gift is safe in your wallet.')
  expect(html).toContain(copy.wallet_add_funds)
  expect(html).toContain('Claim rewards')
  expect(gift_funding_text(copy, failed, session)).toContain('You got 1 × Sui Crate!')
  expect(gift_funding_text(copy, failed, { ...session, giftcards: [] })).toBe(copy.out_of_sui_body)
})

test('used cards explain one-time redemption without presenting a new reward', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(
    <GiftClaimNoticeView
      copy={copy}
      distribution={{ ...distribution, notice: { kind: 'unavailable' } }}
      session={session}
      close={noop}
      fund={noop}
      redeem={noop}
    />
  )
  expect(html).toContain('Card already claimed')
  expect(html).toContain('Each card can only be used once.')
  expect(html).not.toContain('You got a gift!')
  expect(html).not.toContain('Claim rewards')
})
