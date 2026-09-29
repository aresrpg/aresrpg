// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowUpRight, Gem, Loader2 } from 'lucide-react'
import { Button } from '@aresrpg/ui'
import { useEffect, useRef } from 'react'
import { KARES_UNIT } from '@aresrpg/sdk/kares-economics'

import { useNumbers } from '../i18n/useNumbers.ts'
import { content_catalog } from '../content/catalog.ts'
import { KaresLogo } from '../components/KaresLogo.tsx'
import { item_icon } from '../content/assets.ts'
import { useInspections } from '../components/useInspections.ts'
import { InspectionWindow } from '../components/ItemDetailView.tsx'
import { CatalogueItemDetails } from '../encyclopedia/CatalogueItemDetails.tsx'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { stat_name } from '../i18n/copy.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'

import { useMasterySource } from './MasterySource.tsx'
import { effective_mastery_points } from './model.ts'

const offer_redeem_disabled = (
  affordable: boolean,
  pending: string | null,
  connected: boolean,
  ready: boolean
): boolean => !affordable || pending !== null || !connected || !ready

export const MasteryShop = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const numbers = useNumbers()
  const text = copy_text(copy.mastery_page)
  const { balance, mastery, current_epoch, connected, dispatch: dispatch_app } = useMasterySource()
  const kares_balance = balance ?? 0n
  const root = useRef<HTMLElement>(null)
  const { inspections, open, close } = useInspections(root)
  const encyclopedia = encyclopedia_text(copy)
  const points = effective_mastery_points(mastery.row, current_epoch)
  useEffect(() => {
    if (mastery.pending === null) dispatch_app({ type: 'wallet/refresh' })
  }, [mastery.pending, dispatch_app])
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
  const offers = content_catalog.mastery.offers
    .flatMap((authored) => {
      const state = mastery.offers.find((offer) => offer.item_type === authored.item_type)
      return authored.item && (state?.enabled || !mastery.loaded) ? [{ state, item: authored.item }] : []
    })
    .toSorted((left, right) => {
      const a = BigInt(left.state?.cost ?? 0),
        b = BigInt(right.state?.cost ?? 0)
      return a < b ? -1 : a > b ? 1 : 0
    })

  return (
    <section ref={root} className="mastery-shop">
      <div className="border-b border-border pb-4">
        <div className="text-[9px] font-semibold tracking-[0.24em] text-gold uppercase">{text('shop_title')}</div>
        <p className="mt-1 text-[9px] text-muted">{text('shop_lead')}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-muted">
          <span>
            {copy.kares_page.points}: {points.toString()}
          </span>
          <span>KARES: {balance !== null ? numbers.amount(kares_balance, 9) : '—'}</span>
        </div>
      </div>

      {offers.length === 0 ? (
        <div className="py-12 text-center text-[9px] tracking-[0.16em] text-muted uppercase">{text('shop_empty')}</div>
      ) : (
        <div className="mastery-offers" data-mastery-shop="">
          {offers.map(({ state, item }) => {
            const cost = BigInt(state?.cost ?? 0)
            const affordable =
              !!state &&
              Object.values(redemption).some((option) => option.ready && option.balance >= cost * option.unit)
            const busy = mastery.pending === `redeem:${item.item_type}`
            const icon = item_icon(item.item_type)
            return (
              <article
                className="mastery-offer aui-panel"
                data-affordable={affordable}
                data-mastery-offer={item.item_type}
                key={item.item_type}
              >
                <button
                  aria-label={item.name}
                  className="group flex min-w-0 flex-1 cursor-pointer flex-col text-left"
                  onClick={() => open('item')(item.item_type)}
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
                      <Button
                        tone={payment === 'mastery' ? 'primary' : 'neutral'}
                        data-mastery-payment={payment}
                        key={payment}
                        disabled={offer_redeem_disabled(
                          can_afford,
                          mastery.pending,
                          connected,
                          option.ready && !!state
                        )}
                        title={can_afford ? undefined : option.missing(cost)}
                        onClick={() => dispatch_app({ type: 'mastery/redeem', item_type: item.item_type, payment })}
                        type="button"
                      >
                        {payment === 'mastery' ? <Gem size={13} /> : <KaresLogo size={16} />}
                        {option.buy(state?.cost ?? '—')}
                      </Button>
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
      {inspections.map((entry) => (
        <InspectionWindow
          key={`${entry.kind}:${entry.id}`}
          entry={entry}
          open={open}
          close={() => close(entry)}
          props={{
            labels: {
              characteristics: encyclopedia('characteristics'),
              damages: encyclopedia('damages'),
              level_short: '',
              range_to: encyclopedia('range_to'),
            },
          }}
          render_item={(item_type) => (
            <CatalogueItemDetails
              item_type={item_type}
              select_item={open('item')}
              select_mob={open('mob')}
              select_world={open('world')}
              text={encyclopedia}
              stat_name={(stat) => stat_name(copy, stat)}
            />
          )}
        />
      ))}
    </section>
  )
}
