// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowUpRight, Gem } from 'lucide-react'
import { Button } from '@aresrpg/ui'
import { useEffect, useState, type ReactNode } from 'react'
import { mastery_kares_price } from '@aresrpg/sdk/kares-economics'

import { useNumbers } from '../i18n/useNumbers.ts'
import { NewTabLink } from '../components/links.tsx'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { mastery_offers } from '../content/mastery.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'

import { CrateContents } from './CrateContents.tsx'
import { MasteryKaresPurchase } from './MasteryKaresPurchase.tsx'
import { PurchasedOffer } from './PurchasedOffer.tsx'
import { useMasterySource } from './MasterySource.tsx'
import { effective_mastery_points, offer_view } from './model.ts'

const OFFER_FACE = 'group flex min-w-0 flex-1 cursor-pointer flex-col items-center text-center'

/** An offer's face: a crate shows what it holds; any other item opens its docs page in a new tab. */
const OfferFace = ({
  copy,
  item,
  show_crate,
  children,
}: Readonly<{
  copy: AppCopy
  item: Readonly<{ item_type: string; name: string }>
  show_crate: (item_type: string) => void
  children: ReactNode
}>) => {
  const { href, contents } = offer_view(item.item_type)
  return contents ? (
    <button aria-label={item.name} className={OFFER_FACE} onClick={() => show_crate(item.item_type)} type="button">
      {children}
    </button>
  ) : (
    <NewTabLink className={OFFER_FACE} href={href} new_tab={copy.site.new_tab}>
      {children}
    </NewTabLink>
  )
}

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
  const [crate, show_crate] = useState<string | null>(null)
  const points = effective_mastery_points(mastery.row, current_epoch)
  useEffect(() => {
    if (mastery.pending === null) dispatch_app({ type: 'wallet/refresh' })
  }, [mastery.pending, dispatch_app])
  const offers = mastery_offers
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
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className="flex flex-none flex-wrap items-center justify-between gap-4 border-b border-border pb-2.5">
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
            {mastery.loaded ? (
              <strong className="text-3xl leading-none font-bold text-gold tabular-nums">
                {numbers.number(points)}
              </strong>
            ) : (
              <span className="aui-skeleton h-7.5 w-[3ch]" />
            )}
          </div>
        </div>
      </div>

      {offers.length === 0 ? (
        <div className="py-12 text-center text-[9px] tracking-[0.16em] text-muted uppercase">{text('shop_empty')}</div>
      ) : (
        <div
          className="grid min-h-0 grid-cols-[repeat(auto-fit,minmax(190px,1fr))] content-start gap-2.5 overflow-y-auto px-0.5 py-1 [scrollbar-width:thin] @max-[1100px]/aui-window:grid-cols-[repeat(auto-fill,minmax(130px,1fr))] @max-[1100px]/aui-window:gap-1.5"
          data-mastery-shop=""
        >
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
                className="aui-panel flex flex-col gap-2.5 p-3 data-[affordable=true]:border-gold/40 @max-[1100px]/aui-window:gap-[5px] @max-[1100px]/aui-window:p-1.5"
                data-affordable={affordable}
                data-mastery-offer={item.item_type}
                key={item.item_type}
              >
                <OfferFace copy={copy} item={item} show_crate={show_crate}>
                  <div className="flex w-full items-start justify-center gap-4">
                    <div className="grid h-[86px] w-24 shrink-0 place-items-center @max-[1100px]/aui-window:h-12 @max-[1100px]/aui-window:w-[54px]">
                      {icon ? (
                        <img
                          alt=""
                          className="size-[86px] object-contain @max-[1100px]/aui-window:size-12"
                          src={icon}
                        />
                      ) : (
                        <Gem className="text-gold/40" size={28} />
                      )}
                    </div>
                  </div>
                  <div className="mt-4 min-w-0 flex-1 @max-[900px]/aui-window:mt-1">
                    <h3 className="flex items-center justify-center gap-2 font-ui text-[13px] leading-[normal] font-bold tracking-normal text-gold @max-[1100px]/aui-window:text-[11px]">
                      <span className="overflow-hidden text-ellipsis">{item.name}</span>
                      <ArrowUpRight className="shrink-0 opacity-45 group-hover:opacity-100" size={12} />
                    </h3>
                  </div>
                </OfferFace>
                <div className="flex flex-col flex-wrap gap-1.5">
                  <Button
                    className="min-h-9 text-[11px]"
                    tone="primary"
                    data-mastery-payment="mastery"
                    busy={busy}
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
              </article>
            )
          })}
        </div>
      )}
      {crate && <CrateContents copy={copy} item_type={crate} close={() => show_crate(null)} />}
      <PurchasedOffer copy={copy} />
    </section>
  )
}
