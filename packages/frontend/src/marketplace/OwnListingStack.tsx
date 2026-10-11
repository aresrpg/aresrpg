// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { ListingRow } from '@aresrpg/protocol'

import { ItemDetailHover } from '../components/ItemSnapshotTooltip.tsx'
import { Text } from '../i18n/Text.tsx'
import { SuiLogo } from '../components/SuiLogo.tsx'
import type { CopyText } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

import { useMarketDispatch, useMarketState } from './MarketSource.tsx'
import { CategoryName, listing_name, ListingIcon } from './marketplace_model.tsx'

export const OwnListingStack = ({ listings, text }: Readonly<{ listings: readonly ListingRow[]; text: CopyText }>) => {
  const dispatch_app = useMarketDispatch()
  const { pending } = useMarketState()
  const [open, set_open] = useState(false)
  const anchor = useRef<HTMLElement>(null)
  const delist = (listing: Readonly<ListingRow>) => dispatch_app({ type: 'market/delist_requested', listing })
  const cheapest = listings[0]!
  if (listings.length === 1)
    return <OwnListingCard listing={cheapest} text={text} pending={!!pending} delist={() => delist(cheapest)} />
  return (
    <details
      open={open}
      onToggle={(event) => {
        if (event.target === event.currentTarget) set_open(event.currentTarget.open)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          set_open(false)
        }
      }}
      className="market-listing-stack"
      data-marketplace-stack={cheapest.item_type}
      onMouseEnter={() => {
        set_open(true)
      }}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) set_open(false)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) set_open(false)
      }}
    >
      <summary ref={anchor}>
        <OwnListingCard listing={cheapest} text={text} pending={!!pending} />
        <span className="market-stack-count" title={text('listing_count', { count: listings.length })}>
          {listings.length}
        </span>
      </summary>
      {open && anchor.current && (
        <ListingPopover anchor={anchor.current}>
          {listings.map((listing) => (
            <OwnListingCard
              key={listing.id}
              listing={listing}
              text={text}
              pending={!!pending}
              delist={() => delist(listing)}
            />
          ))}
        </ListingPopover>
      )}
    </details>
  )
}

const OwnListingCard = ({
  listing,
  text,
  delist,
  pending,
}: Readonly<{ listing: ListingRow; text: CopyText; delist?: () => void; pending: boolean }>) => {
  const localized_numbers = useNumbers()
  return (
    <div className="market-own-listing" data-marketplace-own-listing={delist && listing.id}>
      {listing.kind === 'item' ? (
        <ItemDetailHover item={{ ...listing, item_type: listing.item_type ?? '', category: listing.category ?? '' }}>
          <span className="cursor-help" tabIndex={0} aria-label={listing_name(listing)}>
            <ListingIcon listing={listing} size={30} />
          </span>
        </ItemDetailHover>
      ) : (
        <ListingIcon listing={listing} size={30} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-text" title={listing_name(listing)}>
          {listing_name(listing)}
        </p>
        <p className="truncate text-[10px] text-muted">
          <CategoryName category={listing.category} />
        </p>
      </div>
      <span className="market-listing-badge">
        <Text path="encyclopedia_page.level_short" values={{ level: listing.level }} />
      </span>
      {listing.amount > 1 && <span className="market-listing-badge">×{localized_numbers.number(listing.amount)}</span>}
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-gold">
        {localized_numbers.sui(BigInt(listing.price_mist), BigInt(listing.price_mist) % 1_000_000_000n === 0n ? 0 : 2)}
        <span className="text-[#4a9eff]">
          <SuiLogo size={12} />
        </span>
        <span className="sr-only">SUI</span>
      </span>
      {delist && (
        <button
          className="market-delist shrink-0 cursor-pointer text-muted hover:text-[#ff6fa8] disabled:opacity-40"
          aria-label={text('withdraw')}
          title={text('withdraw')}
          disabled={pending}
          onClick={delist}
          type="button"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

const ListingPopover = ({ anchor, children }: Readonly<{ anchor: HTMLElement; children: ReactNode }>) => {
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = panel.current!
    element.showPopover()
    const position = () => {
      const bounds = anchor.getBoundingClientRect()
      const width = Math.min(Math.max(bounds.width, 340), window.innerWidth - 16)
      element.style.setProperty('width', `${width}px`)
      element.style.setProperty('left', `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`)
      element.style.setProperty(
        'top',
        `${Math.max(8, Math.min(bounds.top, window.innerHeight - element.offsetHeight - 8))}px`
      )
    }
    const observer = new ResizeObserver(position)
    observer.observe(element)
    window.addEventListener('resize', position)
    position()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      element.hidePopover()
    }
  }, [anchor])
  return (
    <div ref={panel} popover="manual" className="market-stack-listings" role="group">
      {children}
    </div>
  )
}
