// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId, useState } from 'react'
import { COMBAT_DAILY_BUDGET, KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'

import kares_logo from '../../../../seed/icons/currency/kares.png'
import { env } from '../env.ts'
import { useSuiUsd } from '../funding/useSuiUsd.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useLocale } from '../i18n/LocaleScope.tsx'
import { SITE_ADDRESSES } from '../site/routes.ts'

import type { KaresCopy } from './copy.ts'
import type { FinanceState } from './model.ts'
import { useFinance } from './useFinance.ts'
import { market_reading, tokenomics_reading } from './tokenomics.ts'
/** The ledger paints no frame of its own: its host supplies the surface it sits on. */
export const LEDGER = 'grid w-full grid-cols-1 gap-7 leading-normal text-text'
export const SECTION = 'grid grid-cols-1 gap-3'
export const HEADING = 'font-mono text-[10px]/none font-bold tracking-[0.12em] text-muted uppercase'
/** A figure, a pool or a use: a sunken tile. */
const TILE = 'min-w-0 rounded-ui border border-line bg-surface-low/70 p-4'
/** As many columns as fit the host: three on the staking page, two in the narrower docs column, one on a phone. */
const TILES = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] gap-3'
const METRIC = `${TILE} grid content-start gap-2`
const METRIC_LABEL = 'text-[13px] font-bold text-muted'
const METRIC_VALUE =
  'font-mono text-[length:clamp(22px,2.4vw,30px)]/[1.1] font-semibold tracking-[-0.02em] wrap-anywhere text-text tabular-nums data-empty:text-faint'
const METRIC_NOTE = 'text-[13px]/[1.45] text-muted'
const POOL = `${TILE} grid content-start gap-2.5`
const POOL_TITLE = 'flex items-center gap-2.5 text-[15px]/tight font-bold text-text'
const POOL_LINE = 'text-[13px]/[1.45] text-soft'
const USE = `${TILE} grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1`
const USE_LINE = 'text-[13px]/[1.45] text-soft'
const USE_TITLE = 'text-sm/normal text-text'
const POOL_ICON = 'size-5.5 flex-none'
const USE_ICON = 'row-[1/3] size-6'
/** The status dot's colour for each phase of the read. */
const STATUS_DOT = Object.freeze({
  loading: 'before:bg-gold',
  unavailable: 'before:bg-faint',
  pre_funding: 'before:bg-hue-lilac',
  ready: 'before:bg-success',
  stale: 'before:bg-danger',
  error: 'before:bg-danger',
})

const LedgerAmount = ({ value }: Readonly<{ value: bigint | null | undefined }>) => {
  const { amount } = useNumbers()
  return value == null ? (
    <>—</>
  ) : (
    <>
      <span title={`${amount(value, 9)} KARES`} aria-label={`${amount(value, 9)} KARES`}>
        {amount(value, 0)}
      </span>
      <small className="ml-[0.4em] font-mono text-[11px]/none font-bold tracking-[0.08em] whitespace-nowrap text-hue-gold">
        KARES
      </small>
    </>
  )
}

const LedgerRow = ({
  label,
  value,
  note,
}: Readonly<{
  label: string
  value: bigint | null | undefined
  note?: string
}>) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-t border-line py-2.25">
    <dt className="text-[13px] wrap-anywhere text-muted">{label}</dt>
    <dd
      className="min-w-0 text-right font-mono text-[15px]/[1.2] font-semibold wrap-anywhere text-text tabular-nums data-empty:text-faint"
      data-empty={value == null || undefined}
    >
      <LedgerAmount value={value} />
    </dd>
    {note && <dd className="col-span-full text-left font-ui text-xs/[1.4] text-faint">{note}</dd>}
  </div>
)

const ICONS = {
  stake: [
    '#4a9eff',
    'M5 0h2v1h1v2h1v2h1v2H9v2H8v2H7v1H5v-1H4V9H3V7H2V5h1V3h1V1h1z',
    '#c9ecff',
    'M5 1h1v4H5zM4 3h1v2H4z',
  ],
  community: [
    '#b395dd',
    'M3 1h6v4H8v2H7v1H5V7H4V5H3zM1 2h2v2H1zM9 2h2v2H9zM5 8h2v2H5zM3 10h6v1H3z',
    '#e4d6f5',
    'M4 2h1v2H4z',
  ],
  boss: ['#bd795c', 'M1 1h1v2h1v1h6V3h1V1h1v4h-1v4H9v2H3V9H2V5H1z', '#0c0f15', 'M4 6h1v1H4zM7 6h1v1H7z'],
  crate: ['#8a5a2b', 'M1 2h10v9H1z', '#c27c2c', 'M1 2h10v1H1zM1 10h10v1H1z'],
} as const
const LedgerIcon = ({ kind, className }: Readonly<{ kind: keyof typeof ICONS; className: string }>) => {
  const [fill, path, highlight, detail] = ICONS[kind]
  return (
    <svg className={className} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      <path fill={fill} d={path} />
      <path fill={highlight} d={detail} />
    </svg>
  )
}

const TokenIdentity = ({ copy, token }: Readonly<{ copy: KaresCopy; token: string | null }>) => {
  const id = useId()
  const [result, set_result] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy_token = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      set_result('copied')
    } catch (error) {
      console.error('Token type copy failed.', error)
      set_result('failed')
    }
  }
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2">
      <h3 className={HEADING} id={id}>
        {copy.token_type}
      </h3>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <output
          className="min-w-0 font-mono text-[13px]/[1.4] font-semibold wrap-anywhere text-text"
          aria-labelledby={id}
        >
          {token ?? copy.token_pending}
        </output>
        <button className="aui-button" type="button" disabled={!token} onClick={() => void copy_token()}>
          {copy.copy_token}
        </button>
      </div>
      <small className="max-w-[60ch] text-xs/normal text-muted" role="status">
        {result === 'copied' ? copy.token_copied : result === 'failed' ? copy.error_generic : copy.token_hint}
      </small>
    </section>
  )
}

/** The token's live ledger: its supply, its pools and its uses, as the chain reports them. */
const TokenomicsPanel = ({
  copy,
  state,
  refresh,
}: Readonly<{
  copy: KaresCopy
  state: FinanceState
  refresh: () => void
}>) => {
  const title_id = useId()
  const locale = useLocale()
  const { amount, number } = useNumbers()
  const reading = tokenomics_reading(state)
  const { phase, snapshot, burned, circulating } = reading
  const market = market_reading(reading, useSuiUsd(env.network === 'mainnet'))
  const status = {
    loading: copy.loading,
    unavailable: copy.figures_unconfigured,
    pre_funding: copy.figures_unfunded,
    ready: copy.figures_ready,
    stale: copy.figures_stale,
    error: copy.figures_unavailable,
  }
  const time = snapshot ? new Date(Number(snapshot.clock_ms)).toLocaleString(locale) : null
  const values = snapshot ?? {
    total_supply: null,
    coin_type: null,
    pool: { kares_rewards: null, daily_kares: null, total_staked: null },
    community: { remaining: null, claimable: null },
    combat_pot: { balance: null },
  }
  return (
    <div className={LEDGER} role="region" aria-labelledby={title_id}>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 max-[599px]:grid-cols-[auto_minmax(0,1fr)]">
        <img
          className="col-1 row-1 size-11 object-contain"
          data-kares-logo
          src={kares_logo}
          width={52}
          height={52}
          alt=""
        />
        <h2
          className="col-2 row-1 font-title text-[length:clamp(28px,3.4vw,40px)]/none font-bold tracking-[-0.01em] text-text"
          id={title_id}
        >
          $KARES
        </h2>
        <p className="col-[1/3] row-2 max-w-[60ch] text-[15px] text-soft">{copy.ledger_intro}</p>
        <div className="col-3 row-[1/3] grid justify-items-end gap-2 self-center text-right max-[599px]:col-span-full max-[599px]:row-3 max-[599px]:justify-items-start max-[599px]:text-left">
          <a
            className="aui-button aui-button--primary min-h-10.5 px-4.5 no-underline"
            href={SITE_ADDRESSES.aftermath}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.buy_aftermath}
          </a>
          <small className="max-w-[30ch] text-xs/[1.4] text-muted">{copy.swap_note}</small>
        </div>
      </header>
      <div
        className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-y border-line py-2.5 text-[13px] text-muted"
        data-state={phase}
        role="status"
      >
        <b
          className={`inline-flex items-center gap-2.25 font-bold text-text before:size-1.5 before:flex-none before:rounded-full ${STATUS_DOT[phase]}`}
        >
          {status[phase]}
        </b>
        {time && <span>{copy.read_at.replace('{{time}}', time)}</span>}
        <button className="aui-button ml-auto" type="button" disabled={phase === 'loading'} onClick={refresh}>
          {copy.refresh}
        </button>
      </div>
      <section className={SECTION}>
        <h3 className={HEADING}>{copy.supply_heading}</h3>
        <div className={TILES}>
          <div className={METRIC}>
            <span className={METRIC_LABEL}>{copy.current_supply}</span>
            <b className={METRIC_VALUE} data-empty={values.total_supply === null || undefined}>
              <LedgerAmount value={values.total_supply} />
            </b>
            <small className={METRIC_NOTE}>{copy.supply_cap.replace('{{cap}}', amount(KARES_SUPPLY))}</small>
          </div>
          <div className={METRIC}>
            <span className={METRIC_LABEL}>{copy.burned}</span>
            <b className={METRIC_VALUE} data-empty={burned === null || undefined}>
              <LedgerAmount value={burned} />
            </b>
            <small className={METRIC_NOTE}>{copy.mastery_note}</small>
          </div>
          <div className={METRIC}>
            <span className={METRIC_LABEL}>{copy.circulating_supply}</span>
            <b className={METRIC_VALUE} data-empty={circulating === null || undefined}>
              <LedgerAmount value={circulating} />
            </b>
            <small className={METRIC_NOTE}>{copy.circulating_note}</small>
          </div>
        </div>
      </section>
      <section className={SECTION}>
        <h3 className={HEADING}>{copy.market_heading}</h3>
        <div className={TILES}>
          {(
            [
              [copy.price, market.price, { maximumSignificantDigits: 3 }, copy.price_note],
              [copy.fdv, market.fdv, { maximumFractionDigits: 0 }, copy.fdv_note],
              [copy.market_cap, market.market_cap, { maximumFractionDigits: 0 }, copy.market_cap_note],
            ] as const
          ).map(([label, value, digits, note]) => (
            <div className={METRIC} key={label}>
              <span className={METRIC_LABEL}>{label}</span>
              <b className={METRIC_VALUE} data-empty={value === null || undefined}>
                {value === null ? '—' : number(value, { style: 'currency', currency: 'USD', ...digits })}
              </b>
              <small className={METRIC_NOTE}>{note}</small>
            </div>
          ))}
        </div>
      </section>
      <section className={SECTION}>
        <h3 className={HEADING}>{copy.pools_heading}</h3>
        <div className={`${TILES} max-[899px]:grid-cols-1`}>
          <article className={POOL}>
            <h4 className={POOL_TITLE}>
              <LedgerIcon className={POOL_ICON} kind="stake" />
              {copy.five_years}
            </h4>
            <p className={POOL_LINE}>{copy.staking_summary}</p>
            <dl>
              <LedgerRow label={copy.pool_held} value={values.pool.kares_rewards} note={copy.pool_held_note} />
              <LedgerRow label={copy.pool_forecast} value={values.pool.daily_kares} note={copy.pool_forecast_note} />
              <LedgerRow label={copy.total_staked} value={values.pool.total_staked} />
            </dl>
          </article>
          <article className={POOL}>
            <h4 className={POOL_TITLE}>
              <LedgerIcon className={POOL_ICON} kind="community" />
              {copy.community}
            </h4>
            <p className={POOL_LINE}>{copy.community_release_note}</p>
            <dl>
              <LedgerRow label={copy.pool_held} value={values.community.remaining} />
              <LedgerRow
                label={copy.treasury_claimable}
                value={values.community.claimable}
                note={copy.community_detail}
              />
            </dl>
          </article>
          <article className={POOL}>
            <h4 className={POOL_TITLE}>
              <LedgerIcon className={POOL_ICON} kind="boss" />
              {copy.combat_rewards}
            </h4>
            <p className={POOL_LINE}>{copy.boss_summary}</p>
            <dl>
              <LedgerRow label={copy.pool_held} value={values.combat_pot.balance} />
              <LedgerRow label={copy.daily_cap} value={COMBAT_DAILY_BUDGET} note={copy.daily_cap_note} />
            </dl>
          </article>
        </div>
      </section>
      <section className={SECTION}>
        <h3 className={HEADING}>{copy.uses_heading}</h3>
        <ul className={`${TILES} max-[899px]:grid-cols-1`}>
          <li className={USE}>
            <LedgerIcon className={USE_ICON} kind="crate" />
            <b className={USE_TITLE}>{copy.mastery_title}</b>
            <span className={USE_LINE}>{copy.mastery_note}</span>
          </li>
          <li className={USE}>
            <LedgerIcon className={USE_ICON} kind="stake" />
            <b className={USE_TITLE}>{copy.stake}</b>
            <span className={USE_LINE}>{copy.staking_revenue}</span>
          </li>
          <li className={USE}>
            <LedgerIcon className={USE_ICON} kind="community" />
            <b className={USE_TITLE}>{copy.compete}</b>
            <span className={USE_LINE}>{copy.compete_note}</span>
          </li>
        </ul>
      </section>
      <TokenIdentity key={values.coin_type} copy={copy} token={values.coin_type} />
    </div>
  )
}

/** Mount only while visible. No wallet, game store or signing session is required. */
export const Tokenomics = ({ copy }: Readonly<{ copy: KaresCopy }>) => {
  const { state, dispatch } = useFinance({ network: env.network, rpc_url: env.sui_rpc_url })
  return (
    <TokenomicsPanel
      copy={copy}
      state={state}
      refresh={() => dispatch({ type: 'request', request: { kind: 'refresh' } })}
    />
  )
}
