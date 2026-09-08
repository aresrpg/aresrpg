// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowUpRight, Gem, Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { KARES_UNIT } from '@aresrpg/sdk/kares-economics'

import { content_catalog } from '../content/catalog.ts'
import { KaresLogo } from '../components/KaresLogo.tsx'
import { item_icon } from '../content/assets.ts'
import { encyclopedia_item_path } from '../encyclopedia/routes.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { format_amount } from '../kares/model.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { effective_mastery_points } from './model.ts'

const offer_redeem_disabled = (
  affordable: boolean,
  pending: string | null,
  connected: boolean,
  ready: boolean
): boolean => !affordable || pending !== null || !connected || !ready

export const MasteryShop = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const text = copy_text(copy.mastery_page)
  const balance = useAppStore((state) => state.session.kares_balance)
  const kares_balance = balance ?? 0n
  const mastery = useAppStore((state) => state.mastery)
  const current_epoch = useAppStore((state) => state.session.current_epoch)
  const connected = useAppStore((state) => !!state.session.wallet && state.session.link_status === 'ready')
  const points = effective_mastery_points(mastery.row, current_epoch)
  useEffect(() => {
    if (mastery.pending === null) dispatch_app({ type: 'wallet/refresh' })
  }, [mastery.pending])
  const redemption = {
    mastery: {
      balance: points,
      unit: 1n,
      ready: current_epoch !== null,
      missing: (cost: bigint) => text('points_missing', { points: (cost - points).toString() }),
      buy: (cost: string | number) => text('buy', { cost }),
    },
    kares: {
      balance: kares_balance,
      unit: KARES_UNIT,
      ready: balance !== null,
      missing: (_cost: bigint) => copy.kares_page.kares_missing,
      buy: (cost: string | number) => copy.kares_page.burn_buy.replace('{{cost}}', String(cost)),
    },
  }
  const offers = mastery.offers
    .flatMap((state) => {
      const authored = content_catalog.mastery.offers.find(({ item_type }) => item_type === state.item_type)
      return state.enabled && authored?.item ? [Object.freeze({ state, authored, item: authored.item })] : []
    })
    .toSorted((left, right) => {
      const left_cost = BigInt(left.state.cost)
      const right_cost = BigInt(right.state.cost)
      return left_cost < right_cost ? -1 : left_cost > right_cost ? 1 : 0
    })

  return (
    <section className="mt-5 border border-border bg-surface-low/78 p-4 lg:p-5">
      <div className="border-b border-border pb-4">
        <div className="text-[9px] font-semibold tracking-[0.24em] text-gold uppercase">{text('shop_title')}</div>
        <p className="mt-1 text-[9px] text-muted">{text('shop_lead')}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-muted">
          <span>
            {copy.kares_page.points}: {points.toString()}
          </span>
          <span>KARES: {balance !== null ? format_amount(kares_balance, 9) : '—'}</span>
        </div>
      </div>

      {offers.length === 0 ? (
        <div className="py-12 text-center text-[9px] tracking-[0.16em] text-muted uppercase">{text('shop_empty')}</div>
      ) : (
        <div
          className="mt-5 grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          data-mastery-shop=""
        >
          {offers.map(({ state, item }) => {
            const cost = BigInt(state.cost)
            const affordable = Object.values(redemption).some(
              (option) => option.ready && option.balance >= cost * option.unit
            )
            const busy = mastery.pending === `redeem:${state.item_type}`
            const icon = item_icon(item.item_type)
            return (
              <article
                className={`flex h-full min-h-56 flex-col border p-4 ${
                  affordable
                    ? 'border-gold/28 bg-[radial-gradient(circle_at_85%_0%,rgba(200,150,60,0.13),transparent_38%),linear-gradient(145deg,rgba(200,150,60,0.07),rgba(72,207,207,0.025))] hover:border-gold/50'
                    : 'border-white/7 bg-black/15 opacity-48 grayscale'
                } transition-colors`}
                data-mastery-offer={state.item_type}
                key={state.item_type}
              >
                <button
                  aria-label={item.name}
                  className="group flex min-w-0 flex-1 cursor-pointer flex-col text-left"
                  onClick={() => dispatch_app({ type: 'path/open', pathname: encyclopedia_item_path(state.item_type) })}
                  type="button"
                >
                  <div className="flex w-full items-start justify-between gap-4">
                    <div className="grid size-20 shrink-0 place-items-center border border-white/8 bg-black/20 transition-colors group-hover:border-gold/35 group-hover:bg-gold/5">
                      {icon ? (
                        <img alt="" className="size-16 object-contain" src={icon} />
                      ) : (
                        <Gem className="text-gold/40" size={28} />
                      )}
                    </div>
                  </div>
                  <div className="mt-4 min-w-0 flex-1">
                    <h3 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] text-text uppercase transition-colors group-hover:text-gold">
                      <span className="truncate">{item.name}</span>
                      <ArrowUpRight className="shrink-0 opacity-45 group-hover:opacity-100" size={12} />
                    </h3>
                  </div>
                </button>
                <div className="mt-5 flex flex-wrap gap-2">
                  {(['mastery', 'kares'] as const).map((payment) => {
                    const option = redemption[payment]
                    const can_afford = option.balance >= cost * option.unit
                    return (
                      <button
                        className="flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-2 border border-gold/35 bg-gold/8 px-3 py-2 text-[8px] tracking-[0.1em] text-gold uppercase hover:bg-gold/13 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/3 disabled:text-muted"
                        data-mastery-payment={payment}
                        key={payment}
                        disabled={offer_redeem_disabled(can_afford, mastery.pending, connected, option.ready)}
                        title={can_afford ? undefined : option.missing(cost)}
                        onClick={() => dispatch_app({ type: 'mastery/redeem', item_type: state.item_type, payment })}
                        type="button"
                      >
                        {payment === 'mastery' ? <Gem size={13} /> : <KaresLogo size={16} />}
                        {option.buy(state.cost)}
                      </button>
                    )
                  })}
                </div>
                {busy && (
                  <span className="mt-2 flex items-center gap-2 text-[9px] text-muted" role="status">
                    <Loader2 className="animate-spin" size={11} />
                    {text('buying')}
                  </span>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
