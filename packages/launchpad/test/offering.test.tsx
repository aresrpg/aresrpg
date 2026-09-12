// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { KARES_UNIT } from '@aresrpg/sdk/kares-economics'
import { load_app_copy } from '@aresrpg/frontend/i18n'
import { initial_finance } from '@aresrpg/frontend/finance'

import { reduce_finance } from '../../frontend/src/kares/model.ts'
import { finance_state, wallet_view } from '../../frontend/test/kares/fixture.ts'
import { ContributionPanel } from '../src/ContributionPanel.tsx'
import { SaleSection } from '../src/SaleSection.tsx'
import { InvestmentCards } from '../src/InvestmentCards.tsx'
import { LaunchView } from '../src/LaunchView.tsx'
import { LaunchPage } from '../src/LaunchPage.tsx'
import { resolve_launch_env } from '../src/env.ts'

const render_offering = async (state: ReturnType<typeof finance_state>) =>
  renderToStaticMarkup(
    <ContributionPanel
      copy={(await load_app_copy('en')).kares_page}
      dispatch={() => undefined}
      locale="en"
      snapshot={state.snapshot!}
      state={state}
    />
  )

test('an unconfigured offering never fabricates progress, balances or contribution controls', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <SaleSection copy={copy} locale="en" state={initial_finance()} dispatch={() => undefined} />
  )
  expect(html).toContain(copy.unavailable)
  expect(html).toContain('role="progressbar"')
  expect(html).toContain('data-funding-known="false"')
  expect(html).not.toContain('aria-valuenow=')
  expect(html).not.toContain('inputMode="decimal"')
})

test('oversubscription displays all deposits while capping the progress and effective price', async () => {
  const state = finance_state()
  const snapshot = state.snapshot!
  const updated = {
    ...state,
    snapshot: { ...snapshot, offering: { ...snapshot.offering, total_contributed: 30n * KARES_UNIT } },
  }
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <>
      <SaleSection locale="en" dispatch={() => undefined} copy={copy} state={updated} />
      <InvestmentCards copy={copy} state={updated} />
    </>
  )
  expect(html).toContain('aria-valuenow="100"')
  expect(html).toContain('>30</strong>')
  expect(html).toContain('0.00005 $SUI')
  expect(html).toContain('1 $KARES')
  expect(html).toContain('data-sui-logo')
  expect(html).toContain('1.50×')
  expect(html).toContain('data-oversubscribed="true"')
})

test('closed sales expose permanent token claims or full refunds according to the minimum', async () => {
  const state = finance_state()
  const snapshot = state.snapshot!
  const settled = await render_offering({
    ...state,
    snapshot: { ...snapshot, clock_ms: snapshot.offering.closes_ms + 300_000_000_000n },
  })
  expect(settled).not.toContain('0xcontribution-one')
  expect(settled).not.toContain('0xcontribution-two')
  expect(settled).toContain('>Claim KARES</button>')
  expect(settled).not.toContain('excess SUI')
  expect(settled).not.toContain('inputMode="decimal"')
  expect(settled).not.toContain('Contribute SUI')
  expect(settled).not.toContain('200,000 KARES + 0 SUI')
  const refunded = await render_offering({
    ...state,
    snapshot: {
      ...snapshot,
      clock_ms: snapshot.offering.closes_ms,
      offering: { ...snapshot.offering, total_contributed: 1n },
    },
  })
  expect(refunded.split('Claim refund').length - 1).toBe(1)
  expect(refunded).not.toContain('data-price-quote')
  expect(refunded).not.toContain('inputMode="decimal"')
})

test('the open sale shows one investment summary without duplicate contribution cards', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <SaleSection copy={copy} locale="en" state={finance_state()} dispatch={() => undefined} />
  )
  expect(html.split(`>${copy.your_investment}<`).length - 1).toBe(1)
  expect(html).not.toContain('0xcontribution-one')
  expect(html).not.toContain(copy.accepted_contribution)
  expect(html).not.toContain(copy.excess_refund)
})

test('refund promises disappear at the minimum; excess refunds appear only above the cap', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const state = finance_state()
  for (const total of [4n, 5n, 20n, 21n]) {
    const updated = {
      ...state,
      snapshot: {
        ...state.snapshot!,
        offering: { ...state.snapshot!.offering, total_contributed: total * KARES_UNIT },
      },
    }
    const html = renderToStaticMarkup(
      <SaleSection copy={copy} dispatch={() => undefined} locale="en" state={updated} />
    )
    expect(html.includes(copy.minimum_refund)).toBe(total < 5n)
    expect(html.includes(copy.excess_refund)).toBe(total > 20n)
    expect(html).not.toContain(copy.accepted_contribution)
  }
})

test('claim labels mention excess SUI only when refundable and keep amounts outside the button', async () => {
  const state = finance_state()
  const snapshot = state.snapshot!
  const html = await render_offering({
    ...state,
    snapshot: {
      ...snapshot,
      clock_ms: snapshot.offering.closes_ms,
      contributions: [{ id: 'position', version: '1', amount: 3n * KARES_UNIT }],
      offering: { ...snapshot.offering, total_contributed: 30n * KARES_UNIT },
    },
  })
  expect(html).toContain('>Claim KARES &amp; excess SUI</button>')
  expect(html).not.toContain('40,000 KARES + 1 SUI')
  expect(html).not.toContain('excess SUI · 3 SUI')
  expect(html).not.toContain('inputMode="decimal"')
})

test('disconnected participants get a wallet connection instead of personal allocation cards', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const state = { ...finance_state(), address: null, snapshot: { ...finance_state().snapshot!, address: null } }
  const html = renderToStaticMarkup(<InvestmentCards copy={copy} state={state} />)
  expect(html).toContain(copy.connect)
  expect(html).not.toContain(copy.your_investment)
  expect(html).not.toContain(copy.your_allocation)
  expect(html).toContain(copy.current_price)
})

test('allocation cards show only two decimal places', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const state = finance_state()
  const updated = {
    ...state,
    snapshot: {
      ...state.snapshot!,
      contributions: [{ id: '0xposition', version: '1', amount: 3n * KARES_UNIT }],
      offering: { ...state.snapshot!.offering, total_contributed: 7n * KARES_UNIT },
    },
  }
  const html = renderToStaticMarkup(<InvestmentCards copy={copy} state={updated} />)
  expect(html).toContain('171,428.57 KARES')
  expect(html).not.toContain('171,428.571')
})

test('launch publication is offering-only with disclosed manual liquidity custody', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(<LaunchPage change_locale={() => undefined} copy={copy} locale="en" />)
  expect(html).toContain(copy.join_title)
  expect(html).toContain(copy.liquidity_note)
  expect(html).toContain('/kares.png')
  expect(html).not.toContain(copy.stake)
  expect(html).not.toContain(copy.claim_rewards)
})

test('the independent launch environment binds only to an explicit supported network and HTTPS endpoint', () => {
  expect(resolve_launch_env({}).network).toBe('mainnet')
  expect(resolve_launch_env({ VITE_NETWORK: 'mainnet' }).sui_rpc_url).toBe('https://sui-grpc-web.publicnode.com:443')
  expect(resolve_launch_env({ VITE_NETWORK: 'testnet' }).sui_rpc_url).toBe('https://fullnode.testnet.sui.io:443')
  expect(resolve_launch_env({ VITE_SUI_RPC_URL: 'https://rpc.example.test' }).sui_rpc_url).toBe(
    'https://rpc.example.test'
  )
  expect(() => resolve_launch_env({ VITE_NETWORK: 'localnet' })).toThrow('Unsupported launch network')
  expect(() => resolve_launch_env({ VITE_SUI_RPC_URL: 'http://example.test' })).toThrow('HTTPS')
})

test('the deployed CSP allows the default RPC for each supported network', async () => {
  const configuration = await Bun.file(new URL('../vercel.json', import.meta.url)).json()
  const policy = configuration.headers[0].headers.find(({ key }: { key: string }) => key === 'Content-Security-Policy')
    .value as string
  const allowed = policy
    .split(';')
    .find((directive) => directive.trim().startsWith('connect-src '))!
    .trim()
    .split(/\s+/)
  for (const network of ['mainnet', 'testnet'])
    expect(allowed).toContain(new URL(resolve_launch_env({ VITE_NETWORK: network }).sui_rpc_url).origin)
})

test('the wallet menu precedes first-content funding and shares the same connected account', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <LaunchView
      wallet={wallet_view('0xparticipant')}
      change_locale={() => undefined}
      copy={copy}
      dispatch={() => undefined}
      locale="en"
      state={finance_state()}
    />
  )
  expect(html.indexOf('data-wallet-menu')).toBeLessThan(html.indexOf('data-funding-progress'))
  expect(html.indexOf('data-funding-progress')).toBeLessThan(html.indexOf('data-investment-cards'))
  expect(html).toContain('data-wallet-accounts')
  expect(html).toContain('value="Test wallet:0xparticipant" selected=""')
  expect(html).toContain(copy.play_game)
  expect(html).toContain('https://aresrpg.world/')
  expect(html).toContain(copy.community_detail)
  expect(html).toContain(copy.emissions_detail)
})

test('below minimum never advertises a whole token allocation or an executable sale price', async () => {
  const state = finance_state()
  const snapshot = state.snapshot!
  const updated = {
    ...state,
    snapshot: {
      ...snapshot,
      contributions: [{ id: '0xtiny', version: '1', amount: KARES_UNIT }],
      offering: { ...snapshot.offering, total_contributed: KARES_UNIT },
    },
  }
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(<InvestmentCards copy={copy} state={updated} />)
  expect(html).toContain(copy.awaiting_minimum)
  expect(html).not.toContain('200,000 KARES')
  expect(html).not.toContain('data-price-quote')
})

test('consumed contribution objects are not presented as zero historical investment', async () => {
  const state = finance_state()
  const snapshot = state.snapshot!
  const updated = {
    ...state,
    snapshot: {
      ...snapshot,
      clock_ms: snapshot.offering.closes_ms,
      contributions: [],
      offering: { ...snapshot.offering, settled: true },
    },
  }
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(<InvestmentCards copy={copy} state={updated} />)
  expect(html).toContain(copy.claimable_tokens)
  expect(html).toContain(copy.refundable_sui)
  expect(html).toContain(copy.final_price)
  expect(html).not.toContain(`>${copy.your_investment}<`)
})

test('benefits identify royalty revenue, existing reward inventory and actual in-game crate utility', async () => {
  const { Benefits, PublicIncentives } = await import('../src/Benefits.tsx')
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <>
      <Benefits copy={copy} />
      <PublicIncentives copy={copy} />
    </>
  )
  expect(html).toContain(copy.revenue_metric)
  expect(html).toContain(copy.revenue_detail)
  expect(html).toContain(copy.baseline_detail)
  expect(html).toContain(copy.crates_detail)
  expect(html).toContain(copy.incentives_detail)
  expect(html).toContain(copy.incentives_clock)
  expect(html).not.toContain('guaranteed APR')
})

test('every navigation anchor resolves to a visible section without adding another wallet runtime', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <LaunchView
      wallet={wallet_view('0xparticipant')}
      change_locale={() => undefined}
      copy={copy}
      dispatch={() => undefined}
      locale="en"
      state={finance_state()}
    />
  )
  for (const id of ['funding', 'benefits', 'tokenomics', 'incentives', 'play']) {
    expect(html).toContain(`href="#${id}"`)
    expect(html).toContain(`id="${id}"`)
  }
  expect(html.split('data-wallet-menu=""').length - 1).toBe(1)
  expect(html).toContain('aria-current="location"')
})

test('the final public labels remain team allocation, community staking rewards and initial public sale', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <LaunchView
      wallet={wallet_view('0xparticipant')}
      change_locale={() => undefined}
      copy={copy}
      dispatch={() => undefined}
      locale="en"
      state={finance_state()}
    />
  )
  expect(html).toContain('Team allocation')
  expect(html).toContain('Community staking rewards')
  expect(html).toContain('Initial public sale')
  expect(html).not.toContain('Founder')
  expect(html).not.toContain('Fixed initial supply')
})

test('a confirmed payment with a failed refresh offers no stale contribution form', async () => {
  const loaded = finance_state()
  const pending = reduce_finance(loaded, {
    type: 'request',
    request: { kind: 'execute', action: { kind: 'contribute', amount: KARES_UNIT } },
  })
  const certified = reduce_finance(pending, {
    type: 'receipt',
    sequence: pending.sequence,
    digest: 'confirmed-payment',
  })
  const failed = reduce_finance(certified, { type: 'failed', sequence: pending.sequence, error: 'RPC unavailable' })
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <LaunchView
      wallet={wallet_view('0xparticipant')}
      change_locale={() => undefined}
      copy={copy}
      dispatch={() => undefined}
      locale="en"
      state={failed}
    />
  )
  expect(html).toContain(copy.confirmed_refresh)
  expect(html).toContain('confirmed-payment')
  expect(html).not.toContain('inputMode="decimal"')
  expect(html).not.toContain('9 SUI')
  expect(html).not.toContain(copy.connect_preview)
  expect(html).not.toContain(copy.awaiting_minimum)
})

test('one canonical sale section includes stages and the minimum-refund promise even before configuration', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <LaunchView
      wallet={wallet_view('0xparticipant')}
      change_locale={() => undefined}
      copy={copy}
      dispatch={() => undefined}
      locale="en"
      state={initial_finance()}
    />
  )
  expect(html.split('id="funding"').length - 1).toBe(1)
  expect(html.split('id="contribute"').length - 1).toBe(1)
  expect(
    html.split(`<h1 class="text-xl font-medium tracking-tight text-gold-light">${copy.offering}</h1>`).length - 1
  ).toBe(1)
  expect(html).toContain(copy.stage_minimum)
  expect(html).toContain(copy.stage_maximum)
  expect(html).toContain(copy.minimum_refund)
  expect(html).toContain(copy.refund_claim_note)
  expect(html).toContain('role="progressbar"')
  expect(html).toContain('data-funding-known="false"')
  expect(html).not.toContain('aria-valuenow=')
  expect(html).not.toContain('Community funding')
})

test('funding stages track minimum and maximum crossings but do not stay active after close', async () => {
  const { SaleStages } = await import('../src/SaleStages.tsx')
  const copy = (await load_app_copy('en')).kares_page
  const state = finance_state()
  const snapshot = state.snapshot!
  for (const [deposited, label, reached] of [
    [1n, copy.stage_minimum, 0],
    [5n, copy.stage_maximum, 1],
    [10n, copy.stage_maximum, 1],
    [20n, copy.stage_maximum, 2],
    [30n, copy.oversubscribed, 3],
  ] as const) {
    const html = renderToStaticMarkup(
      <SaleStages
        copy={copy}
        snapshot={{ ...snapshot, offering: { ...snapshot.offering, total_contributed: deposited * KARES_UNIT } }}
      />
    )
    const active = html.match(/<li aria-current="step"[^>]*>(.*?)<\/li>/)?.[1]
    expect(active).toContain(label)
    expect(html.match(/data-reached="true"/g)?.length ?? 0).toBe(reached)
  }
  const closed = renderToStaticMarkup(<SaleStages copy={copy} snapshot={{ ...snapshot, clock_ms: 200n }} />)
  expect(closed).not.toContain('aria-current="step"')
  expect(closed.match(/data-reached="true"/g)?.length).toBe(1)
})

test('the funding track shows actual success and cap amounts without making unknown data zero', async () => {
  const { FundingTrack, funding_track_view } = await import('../src/FundingTrack.tsx')
  const copy = (await load_app_copy('en')).kares_page
  const snapshot = finance_state().snapshot!
  const half = {
    ...snapshot,
    offering: {
      ...snapshot.offering,
      min_raise: 50_000n * KARES_UNIT,
      max_raise: 200_000n * KARES_UNIT,
      total_contributed: 100_000n * KARES_UNIT,
    },
  }
  expect(funding_track_view(half)).toMatchObject({
    progress: 50,
    position: 50,
    minimum_position: 25,
    minimum_met: true,
    minimum: '50,000 SUI',
    cap: '200,000 SUI',
    percent: '50%',
  })
  const html = renderToStaticMarkup(<FundingTrack copy={copy} snapshot={half} />)
  expect(html).toContain('aria-valuenow="50"')
  expect(html).toContain('left:50%')
  expect(html).toContain('50,000 SUI')
  expect(html).toContain('200,000 SUI')
  const excess = funding_track_view({
    ...half,
    offering: { ...half.offering, total_contributed: 300_000n * KARES_UNIT },
  })
  expect(excess).toMatchObject({
    progress: 100,
    position: 100,
    oversubscribed: true,
    percent: '150%',
    excess: '100,000 SUI',
  })
  const unknown = renderToStaticMarkup(<FundingTrack copy={copy} snapshot={null} />)
  expect(unknown).toContain(copy.funding_unknown)
  expect(unknown).not.toContain('aria-valuenow=')
})

test('the event announcement precedes navigation and the landscape uses decorative CSS layers', async () => {
  const { Atmosphere } = await import('../src/Atmosphere.tsx')
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(
    <>
      <Atmosphere />
      <LaunchView
        wallet={wallet_view('0xparticipant')}
        change_locale={() => undefined}
        copy={copy}
        dispatch={() => undefined}
        locale="en"
        state={initial_finance()}
      />
    </>
  )
  expect(html.indexOf('data-basecamp-announcement')).toBeLessThan(html.indexOf('data-wallet-menu'))
  expect(html).toContain(copy.basecamp_announcement)
  for (const layer of ['image', 'trees', 'water', 'wind', 'star', 'shade', 'grain'])
    expect(html).toContain(`launch-atmosphere-${layer}`)
  expect(html).not.toContain('<canvas')
})

test('a sealed but unstarted offering shows no running timer or contribution action', async () => {
  const state = finance_state()
  const snapshot = state.snapshot!
  const paused = {
    ...state,
    snapshot: {
      ...snapshot,
      contributions: [],
      offering: {
        ...snapshot.offering,
        started: false,
        opens_ms: 0n,
        closes_ms: 0n,
        total_contributed: 0n,
      },
    },
  }
  const copy = (await load_app_copy('en')).kares_page
  const html = renderToStaticMarkup(<SaleSection copy={copy} locale="en" state={paused} dispatch={() => undefined} />)
  expect(html).toContain(copy.upcoming)
  expect(html).not.toContain('role="timer"')
  expect(html).not.toContain('inputMode="decimal"')
  expect(html).not.toContain('1970')
})

test('after closing, a successful sale exposes claims before a separate settlement transaction', async () => {
  const state = finance_state()
  const snapshot = state.snapshot!
  const html = await render_offering({
    ...state,
    snapshot: {
      ...snapshot,
      clock_ms: snapshot.offering.closes_ms,
      offering: { ...snapshot.offering, settled: false, total_contributed: snapshot.offering.max_raise * 2n },
    },
  })
  expect(html.split('Claim KARES &amp; excess SUI').length - 1).toBe(1)
  expect(html).not.toContain('inputMode="decimal"')
})
