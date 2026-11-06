// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId, useState } from 'react'
import { COMBAT_DAILY_BUDGET, KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'

import kares_logo from '../../../../seed/icons/currency/kares.png'
import { env } from '../env.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useLocale } from '../i18n/LocaleScope.tsx'

import type { KaresCopy } from './copy.ts'
import type { FinanceState } from './model.ts'
import { useFinance } from './useFinance.ts'
import { tokenomics_reading } from './tokenomics.ts'
import './tokenomics.css'

const LedgerAmount = ({ value }: Readonly<{ value: bigint | null | undefined }>) => {
  const { amount } = useNumbers()
  return value == null ? (
    <>—</>
  ) : (
    <>
      <span title={`${amount(value, 9)} KARES`} aria-label={`${amount(value, 9)} KARES`}>
        {amount(value, 2)}
      </span>
      <small>KARES</small>
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
  <div>
    <dt>{label}</dt>
    <dd data-empty={value == null || undefined}>
      <LedgerAmount value={value} />
    </dd>
    {note && <dd className="pool-note">{note}</dd>}
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
const LedgerIcon = ({ kind }: Readonly<{ kind: keyof typeof ICONS }>) => {
  const [fill, path, highlight, detail] = ICONS[kind]
  return (
    <svg viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
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
    <div className="token">
      <div className="token-id">
        <span id={id}>{copy.token_type}</span>
        <div className="token-row">
          <output aria-labelledby={id}>{token ?? copy.token_pending}</output>
          <button className="copy" type="button" disabled={!token} onClick={() => void copy_token()}>
            {copy.copy_token}
          </button>
        </div>
        <small role="status">
          {result === 'copied' ? copy.token_copied : result === 'failed' ? copy.error_generic : copy.token_hint}
        </small>
      </div>
    </div>
  )
}

/** The same accepted ledger is mounted inline in the encyclopedia and inside the landing dialog. */
export const TokenomicsPanel = ({
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
  const { amount } = useNumbers()
  const { phase, snapshot, burned, circulating } = tokenomics_reading(state)
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
    <section className="kares-ledger" aria-labelledby={title_id}>
      <div className="ledger-in n">
        <header className="tk-head">
          <img className="tk-coin" data-kares-logo src={kares_logo} width={52} height={52} alt="" />
          <h2 id={title_id}>$KARES</h2>
          <p>{copy.ledger_intro}</p>
          <div className="buy">
            <span className="slab">
              <a
                className="btn btn-rune btn-sm n"
                href="https://aftermath.finance/trade"
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.buy_aftermath}
              </a>
            </span>
            <small>{copy.swap_note}</small>
          </div>
        </header>
        <div className="tk-status" data-state={phase} role="status">
          <b>{status[phase]}</b>
          {time && <span>{copy.read_at.replace('{{time}}', time)}</span>}
          <button className="tk-retry" type="button" disabled={phase === 'loading'} onClick={refresh}>
            {copy.refresh}
          </button>
        </div>
        <h3 className="tk-h">{copy.supply_heading}</h3>
        <div className="supply-row">
          <div className="metric">
            <span>{copy.current_supply}</span>
            <b data-empty={values.total_supply === null || undefined}>
              <LedgerAmount value={values.total_supply} />
            </b>
            <small>{copy.supply_cap.replace('{{cap}}', amount(KARES_SUPPLY))}</small>
          </div>
          <div className="metric">
            <span>{copy.burned}</span>
            <b data-empty={burned === null || undefined}>
              <LedgerAmount value={burned} />
            </b>
            <small>{copy.mastery_note}</small>
          </div>
          <div className="metric">
            <span>{copy.circulating_supply}</span>
            <b data-empty>
              <LedgerAmount value={circulating} />
            </b>
            <small>{copy.circulating_unknown}</small>
          </div>
        </div>
        <h3 className="tk-h">{copy.pools_heading}</h3>
        <div className="pools">
          <article className="pool pool-staking">
            <h4>
              <LedgerIcon kind="stake" />
              {copy.five_years}
            </h4>
            <p>{copy.staking_summary}</p>
            <dl>
              <LedgerRow label={copy.pool_held} value={values.pool.kares_rewards} note={copy.pool_held_note} />
              <LedgerRow label={copy.pool_forecast} value={values.pool.daily_kares} note={copy.pool_forecast_note} />
              <LedgerRow label={copy.total_staked} value={values.pool.total_staked} />
            </dl>
          </article>
          <article className="pool pool-community">
            <h4>
              <LedgerIcon kind="community" />
              {copy.community}
            </h4>
            <p>{copy.community_release_note}</p>
            <dl>
              <LedgerRow label={copy.pool_held} value={values.community.remaining} />
              <LedgerRow
                label={copy.treasury_claimable}
                value={values.community.claimable}
                note={copy.community_detail}
              />
            </dl>
          </article>
          <article className="pool pool-boss">
            <h4>
              <LedgerIcon kind="boss" />
              {copy.combat_rewards}
            </h4>
            <p>{copy.boss_summary}</p>
            <dl>
              <LedgerRow label={copy.pool_held} value={values.combat_pot.balance} />
              <LedgerRow label={copy.daily_cap} value={COMBAT_DAILY_BUDGET} note={copy.daily_cap_note} />
            </dl>
          </article>
        </div>
        <h3 className="tk-h">{copy.uses_heading}</h3>
        <ul className="uses">
          <li>
            <LedgerIcon kind="crate" />
            <b>{copy.mastery_title}</b>
            <span>{copy.mastery_note}</span>
          </li>
          <li>
            <LedgerIcon kind="stake" />
            <b>{copy.stake}</b>
            <span>{copy.staking_revenue}</span>
          </li>
          <li>
            <LedgerIcon kind="community" />
            <b>{copy.compete}</b>
            <span>{copy.compete_note}</span>
          </li>
        </ul>
        <TokenIdentity key={values.coin_type} copy={copy} token={values.coin_type} />
      </div>
    </section>
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
