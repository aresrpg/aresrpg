// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { load_app_copy } from '../../src/i18n/copy.ts'
import KaresPage, { KaresPageView } from '../../src/kares/KaresPage.tsx'
import { StakingContent } from '../../src/kares/StakingAccount.tsx'
import { TokenomicsTab } from '../../src/kares/TokenomicsTab.tsx'
import { AmountForm, FinanceStatus } from '../../src/kares/components.tsx'
import { WalletChoices } from '../../src/components/WalletPickerModal.tsx'
import { initial_finance } from '../../src/kares/model.ts'

import { finance_state, wallet_view } from './fixture.ts'

const occurrences = (source: string, text: string): number => source.split(text).length - 1

test('staking combines every position into one stake and one accrued-rewards section', async () => {
  const copy = await load_app_copy('en')
  const state = finance_state()
  const html = renderToStaticMarkup(
    <StakingContent
      balance={7_000_000_000n}
      copy={copy}
      dispatch={() => undefined}
      snapshot={state.snapshot!}
      state={state}
    />
  )
  expect(html).not.toContain('0xstake-one')
  expect(html).not.toContain('0xstake-two')
  expect(html).toContain('4 KARES')
  expect(html).toContain('6 SUI')
  expect(html).toContain('staking-claim')
  expect(occurrences(html, copy.kares_page.claim_rewards)).toBe(1)
  expect(occurrences(html, copy.kares_page.withdraw)).toBe(1)
  expect(html).toContain('>30 <small')
  expect(html).toContain('>1.500</strong>')
  expect(html).toContain('>0.750</strong>')
  expect(html).not.toContain(copy.kares_page.fund_note)
  expect(html).not.toContain(copy.kares_page.rewards_note)
  expect(html).not.toContain(copy.kares_page.combat_rewards)
  expect(html).not.toContain(copy.kares_page.staking_lead)
  expect(html).not.toContain('<select')
})

test('unconfigured staking renders an honest unavailable state and independent wallet controls', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(<KaresPage copy={copy} />)
  expect(html).toContain(copy.kares_page.staking_unavailable)
  expect(html).toContain(copy.kares_page.connect)
  expect(html).not.toContain('0 KARES')
  expect(html).not.toContain('Google')
})

test('tokenomics derives all six allocations and explains burns and variable rewards', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(<TokenomicsTab copy={copy} />)
  for (const amount of ['1,000,000', '110,000', '400,000', '200,000', '160,000', '100,000', '30,000'])
    expect(html).toContain(amount)
  expect(html).toContain('11%')
  expect(html).toContain('3%')
  expect(html).toContain(copy.mastery_note)
  expect(html).toContain(copy.revenue_note)
  expect(html).not.toContain('APR')
})

test('forms reject unavailable writes and clearly identify irrevocable donation assets', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <AmountForm
      asset="SUI"
      balance={0n}
      busy={false}
      copy={copy}
      disabled
      label={copy.donate}
      submit={() => {
        throw new Error('render must not submit')
      }}
    />
  )
  expect(html).toContain('disabled=""')
  expect(html).toContain('inputMode="decimal"')
  expect(html).toContain(copy.gas_note)
})

test('wallet selection shows each authorized account explicitly', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const wallet = {
    name: 'Test wallet',
    authorize: async () => ['0xone', '0xtwo'],
    connect: async () => {
      throw new Error('render must not connect')
    },
    disconnect: async () => undefined,
  }
  const accounts = await wallet.authorize()
  const html = renderToStaticMarkup(
    <WalletChoices
      choices={accounts}
      busy={false}
      select={() => undefined}
      empty_label={copy.no_wallet}
      select_label={copy.choose_account}
    />
  )
  expect(html).toContain(copy.choose_account)
  expect(html).toContain('0xone')
  expect(html).toContain('0xtwo')
})

test('receipts link the requested network and unavailable configuration stays out of public errors', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const hidden = renderToStaticMarkup(
    <FinanceStatus
      copy={copy}
      network="mainnet"
      state={{ ...initial_finance(), error: 'KARES package is not configured' }}
    />
  )
  expect(hidden).not.toContain('not configured')
  const receipt = renderToStaticMarkup(
    <FinanceStatus copy={copy} network="mainnet" state={{ ...initial_finance(), digest: 'receipt-digest' }} />
  )
  expect(receipt).toContain('https://suiscan.xyz/mainnet/tx/receipt-digest')
  expect(receipt).toContain(copy.confirmed)
})

test('multiple wallet accounts use the shared picker rows with full accessible addresses', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const addresses = [`0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`]
  const wallet = {
    name: 'Test wallet',
    authorize: async () => addresses,
    connect: async () => {
      throw new Error('render must not connect')
    },
    disconnect: async () => undefined,
  }
  const accounts = await wallet.authorize()
  const html = renderToStaticMarkup(
    <WalletChoices
      choices={accounts}
      busy={false}
      select={() => undefined}
      empty_label={copy.no_wallet}
      select_label={copy.choose_account}
    />
  )
  expect(html).toContain('data-wallet-choices=""')
  expect(html).toContain(`aria-label="${addresses[0]}"`)
  expect(html).toContain(`title="${addresses[0]}"`)
  expect(html).toContain(`>${addresses[0]}</`)
})

test('staking always shows both panels and keeps external signing separate', async () => {
  const copy = await load_app_copy('en')
  const account = { state: finance_state(), dispatch: () => undefined }
  const disconnected = { state: initial_finance(), dispatch: () => undefined }
  const hidden = renderToStaticMarkup(
    <KaresPageView
      account_balance={7_000_000_000n}
      copy={copy}
      account={account}
      wallet={wallet_view()}
      external={disconnected}
    />
  )
  expect(hidden).toContain(copy.kares_page.game_account)
  expect(hidden).toContain(copy.kares_page.external_wallet)
  expect(hidden).toContain(copy.kares_page.staking_revenue)
  expect(hidden).toContain(copy.kares_page.daily_estimate_note)
  expect(occurrences(hidden, 'data-staking-account=')).toBe(2)

  const external = {
    state: finance_state({ ...account.state.snapshot!, address: '0xexternal' }),
    dispatch: () => undefined,
  }
  const shown = renderToStaticMarkup(
    <KaresPageView
      account_balance={7_000_000_000n}
      copy={copy}
      account={account}
      wallet={wallet_view('0xexternal')}
      external={external}
    />
  )
  expect(shown).toContain('data-staking-account="0xparticipant"')
  expect(shown).toContain('data-staking-account="0xexternal"')
  expect(shown).toContain(copy.kares_page.external_wallet)
  expect(occurrences(shown, copy.kares_page.daily_kares)).toBe(2)
  expect(occurrences(shown, copy.kares_page.daily_sui)).toBe(2)

  const duplicate = renderToStaticMarkup(
    <KaresPageView
      account_balance={7_000_000_000n}
      copy={copy}
      account={account}
      wallet={wallet_view('0xparticipant')}
      external={account}
    />
  )
  expect(occurrences(duplicate, 'data-staking-account=')).toBe(2)
  expect(duplicate).toContain(copy.kares_page.same_account)
})
