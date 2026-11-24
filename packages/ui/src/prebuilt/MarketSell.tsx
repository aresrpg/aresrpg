// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The marketplace sell surface: the seller's listings and the sale form.
// Callers own filtering, pricing rules and writes; these views receive text, formatted values and callbacks.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '../components/controls.tsx'
import { SuiLogo } from '../components/SuiLogo.tsx'

import { MarketCurrency, MarketListingIcon, type MarketArt, type MarketGlyph } from './MarketParts.tsx'

export type MarketOwnListing = Readonly<{
  id: string
  name: string
  category: string
  level: string
  /** The formatted lot size, or null for a single unit. */
  amount: string | null
  price: string
  icon: ReactNode
}>
export type MarketWithdraw = Readonly<{ label: string; Icon: MarketGlyph }>

/** A listing picture that opens the caller's item tooltip on hover or focus. */
export const MarketListingHoverIcon = ({ label, art }: Readonly<{ label: string; art: MarketArt }>) => (
  <span className="aui-market-help" tabIndex={0} aria-label={label}>
    <MarketListingIcon art={art} size={30} />
  </span>
)

const MarketOwnListingCard = ({
  listing,
  withdraw,
  delist,
  pending,
}: Readonly<{ listing: MarketOwnListing; withdraw: MarketWithdraw; delist?: () => void; pending: boolean }>) => (
  <div className="market-own-listing" data-marketplace-own-listing={delist && listing.id}>
    {listing.icon}
    <div className="aui-market-own-identity">
      <p className="aui-market-own-name" title={listing.name}>
        {listing.name}
      </p>
      <p className="aui-market-own-category">{listing.category}</p>
    </div>
    <span className="market-listing-badge">{listing.level}</span>
    {listing.amount !== null && <span className="market-listing-badge">×{listing.amount}</span>}
    <span className="aui-market-own-price">
      {listing.price}
      <span className="aui-market-own-currency">
        <SuiLogo size={12} />
      </span>
      <span className="aui-market-sr-only">SUI</span>
    </span>
    {delist && (
      <button
        className="market-delist aui-market-delist"
        aria-label={withdraw.label}
        title={withdraw.label}
        disabled={pending}
        onClick={delist}
        type="button"
      >
        <withdraw.Icon size={14} aria-hidden="true" />
      </button>
    )}
  </div>
)

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

/** Identical listings fold into one card; hovering or opening the stack lists each to withdraw. */
export const MarketOwnListingStack = ({
  listings,
  stack,
  count_title,
  pending,
  withdraw,
  delist,
}: Readonly<{
  listings: readonly MarketOwnListing[]
  stack: string | null
  count_title: string
  pending: boolean
  withdraw: MarketWithdraw
  delist: (id: string) => void
}>) => {
  const [open, set_open] = useState(false)
  const anchor = useRef<HTMLElement>(null)
  const cheapest = listings[0]!
  if (listings.length === 1)
    return (
      <MarketOwnListingCard
        listing={cheapest}
        withdraw={withdraw}
        pending={pending}
        delist={() => delist(cheapest.id)}
      />
    )
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
      data-marketplace-stack={stack ?? undefined}
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
        <MarketOwnListingCard listing={cheapest} withdraw={withdraw} pending={pending} />
        <span className="market-stack-count" title={count_title}>
          {listings.length}
        </span>
      </summary>
      {open && anchor.current && (
        <ListingPopover anchor={anchor.current}>
          {listings.map((listing) => (
            <MarketOwnListingCard
              key={listing.id}
              listing={listing}
              withdraw={withdraw}
              pending={pending}
              delist={() => delist(listing.id)}
            />
          ))}
        </ListingPopover>
      )}
    </details>
  )
}

export type MarketListingSection = Readonly<{
  key: string
  /** Shown only while every category is listed together. */
  title: Readonly<{ glyph: ReactNode; label: string }> | null
  stacks: ReactNode
}>

export const MarketOwnListings = ({
  labels,
  Icons,
  count,
  query,
  filter,
  empty,
  sections,
}: Readonly<{
  labels: Readonly<{ title: string; search: string }>
  Icons: Readonly<{ title: MarketGlyph; search: MarketGlyph }>
  count: string
  query: Readonly<{ value: string; change: (value: string) => void }>
  filter: Readonly<{
    label: string
    all: string
    value: string
    options: readonly Readonly<{ value: string; label: string }>[]
    change: (value: string) => void
  }>
  /** The empty-state text, or null when listings match. */
  empty: string | null
  sections: readonly MarketListingSection[]
}>) => (
  <section className="market-own-listings aui-market-own-listings" aria-label={labels.title}>
    <h3 className="market-panel-title">
      <Icons.title size={16} aria-hidden="true" />
      {labels.title}
      <span className="market-count">{count}</span>
    </h3>
    <div className="aui-market-own-tools">
      <label className="aui-market-own-search">
        <Icons.search size={16} aria-hidden="true" />
        <input
          type="search"
          className="aui-market-own-search-input"
          aria-label={labels.search}
          placeholder={labels.search}
          value={query.value}
          onChange={(event) => query.change(event.target.value)}
        />
      </label>
      <select
        aria-label={filter.label}
        className="aui-market-own-filter"
        value={filter.value}
        onChange={(event) => filter.change(event.target.value)}
      >
        <option value="">{filter.all}</option>
        {filter.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
    <div className="market-own-listings-scroll aui-market-scroll">
      {empty !== null ? (
        <p className="aui-market-own-empty">{empty}</p>
      ) : (
        sections.map((section) => (
          <section key={section.key}>
            {section.title && (
              <h4 className="market-listing-section-title">
                {section.title.glyph}
                <span>{section.title.label}</span>
                <span className="aui-market-rule" aria-hidden="true" />
              </h4>
            )}
            <div className="market-own-listings-grid">{section.stacks}</div>
          </section>
        ))
      )}
    </div>
  </section>
)

export const MarketSaleAmount = ({ amount }: Readonly<{ amount: number }>) => (
  <p className="aui-market-sale-amount">×{amount}</p>
)

/** The compact summary of a character, or of an item without its full sheet. */
export const MarketSaleSummary = ({
  art,
  name,
  category,
  level,
  amount,
}: Readonly<{ art: MarketArt; name: string; category: string; level: string; amount: string }>) => (
  <div className="aui-market-sale-summary">
    <MarketListingIcon art={art} size={42} />
    <div className="aui-market-min">
      <p className="aui-market-sale-name">{name}</p>
      <p className="aui-market-sale-meta">
        {category} · {level}
        {amount}
      </p>
    </div>
  </div>
)

export const MarketFloor = ({ label, message }: Readonly<{ label: string; message: string }>) => (
  <p className="aui-market-floor" role="status">
    <span>{label}</span>
    <span className="aui-market-cyan">{message}</span>
  </p>
)

export const MarketSaleForm = ({
  labels,
  summary,
  floor,
  price,
  lots,
  can_list,
  list,
  close,
}: Readonly<{
  labels: Readonly<{ lot_price: string; lot_size: string; paid_automatically: string; list: string; cancel: string }>
  summary: ReactNode
  floor: ReactNode
  price: Readonly<{ value: string; change: (value: string) => void }>
  /** Lot sizes for stackable items; null for a single item or a character. */
  lots: Readonly<{ sizes: readonly number[]; value: number; select: (size: number) => void }> | null
  can_list: boolean
  list: () => void
  close: () => void
}>) => (
  <div className="aui-market-port market-sale-form aui-market-sale-scroll" data-sale-scroll>
    <div className="aui-market-sale-card">
      {summary}
      {floor}
      <label htmlFor="market-sale-price" className="aui-market-sale-label">
        {labels.lot_price}
      </label>
      <div className="aui-market-sale-price">
        <input
          id="market-sale-price"
          autoFocus
          className="aui-market-sale-input"
          inputMode="decimal"
          onChange={(event) => price.change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && can_list) list()
          }}
          placeholder="0.00"
          value={price.value}
        />
        <span className="aui-market-sale-unit">
          <MarketCurrency size={12} />
        </span>
      </div>
      {lots && (
        <div className="aui-market-sale-lots">
          <p className="aui-market-sale-lots-label">{labels.lot_size}</p>
          <div className="aui-market-sale-lot-grid">
            {lots.sizes.map((amount) => (
              <Button
                aria-pressed={lots.value === amount}
                className="aui-market-lot-choice"
                key={amount}
                onClick={() => lots.select(amount)}
                type="button"
              >
                ×{amount}
              </Button>
            ))}
          </div>
        </div>
      )}
      <p className="aui-market-sale-note">{labels.paid_automatically}</p>
      <div className="aui-market-sale-actions">
        <button className="aui-market-sale-submit" disabled={!can_list} onClick={list} type="button">
          {labels.list}
        </button>
        <button className="aui-market-sale-cancel" onClick={close} type="button">
          {labels.cancel}
        </button>
      </div>
    </div>
  </div>
)
