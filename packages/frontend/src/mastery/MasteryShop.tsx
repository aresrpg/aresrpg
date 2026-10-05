// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowUpRight, Gem, Loader2 } from 'lucide-react'
import { Button } from '@aresrpg/ui'
import { useEffect, useRef } from 'react'
import { mastery_kares_price } from '@aresrpg/sdk/kares-economics'

import { useNumbers } from '../i18n/useNumbers.ts'
import { content_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { useInspections } from '../components/useInspections.ts'
import { InspectionWindow } from '../components/ItemDetailView.tsx'
import { CatalogueItemDetails } from '../encyclopedia/CatalogueItemDetails.tsx'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { stat_name } from '../i18n/copy.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'

import { MasteryKaresPurchase } from './MasteryKaresPurchase.tsx'
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
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="text-[9px] font-semibold tracking-[0.24em] text-gold uppercase">{text('shop_title')}</div>
          <p className="mt-1 text-[9px] text-muted">{text('shop_lead')}</p>
        </div>
        <div
          data-mastery-points=""
          aria-label={`${copy.kares_page.points}: ${numbers.number(points)}`}
          className="inline-flex items-center gap-3 border border-gold/40 bg-gold/10 px-4 py-3 shadow-sm"
        >
          <Gem className="shrink-0 text-gold" size={26} />
          <div className="flex flex-col">
            <span className="text-[9px] font-semibold tracking-[0.16em] text-gold uppercase">
              {copy.kares_page.points}
            </span>
            <strong className="text-3xl leading-none font-bold text-gold tabular-nums">{numbers.number(points)}</strong>
          </div>
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
              [
                current_epoch !== null && points >= cost,
                balance !== null && kares_balance >= mastery_kares_price(cost),
              ].some(Boolean)
            const busy = mastery.pending === `redeem:${item.item_type}`
            const icon = item_detail_icon(item.item_type)
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
                  <Button
                    tone="primary"
                    data-mastery-payment="mastery"
                    disabled={offer_redeem_disabled(
                      points >= cost,
                      mastery.pending,
                      connected,
                      current_epoch !== null && !!state
                    )}
                    title={points >= cost ? undefined : text('points_missing', { points: (cost - points).toString() })}
                    onClick={() =>
                      dispatch_app({ type: 'mastery/redeem', item_type: item.item_type, payment: 'mastery' })
                    }
                    type="button"
                  >
                    <Gem size={13} />
                    {text('buy', { cost: state ? cost.toString() : '—' })}
                  </Button>
                  <MasteryKaresPurchase item_type={item.item_type} name={item.name} copy={copy} />
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
