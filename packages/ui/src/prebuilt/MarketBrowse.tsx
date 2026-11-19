// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The marketplace browse surface: category rails, item templates, offers and paging.
// Callers own filters, selection and purchases; these views receive text, formatted prices and callbacks.

import type { ReactNode } from 'react'

import { Button } from '../components/controls.tsx'

import { MarketCurrency, MarketListingIcon, type MarketArt, type MarketGlyph } from './MarketParts.tsx'

export type MarketFilter = Readonly<{
  key: string
  label: ReactNode
  glyph: ReactNode
  count: ReactNode
  pressed: boolean
  select: () => void
}>

const MarketFilterButton = ({ filter }: Readonly<{ filter: MarketFilter }>) => (
  <Button className="market-filter" aria-pressed={filter.pressed} onClick={filter.select} type="button">
    {filter.glyph}
    <span className="aui-market-filter-label">{filter.label}</span>
    {filter.count}
  </Button>
)

export type MarketPagerProps = Readonly<{
  label: string
  previous: Readonly<{ label: string; disabled: boolean; go: () => void }>
  next: Readonly<{ label: string; disabled: boolean; go: () => void }>
}>

const MarketPager = ({ label, previous, next }: MarketPagerProps) => (
  <nav className="aui-market-pager" aria-label={label}>
    <button type="button" className="aui-market-page-button" disabled={previous.disabled} onClick={previous.go}>
      {previous.label}
    </button>
    <button type="button" className="aui-market-page-button" disabled={next.disabled} onClick={next.go}>
      {next.label}
    </button>
  </nav>
)

/** The browse frame: the general category rail, the active view and the optional pager. */
export const MarketBrowse = ({
  label,
  groups,
  children,
  pager,
}: Readonly<{
  label: string
  groups: readonly MarketFilter[]
  children: ReactNode
  pager: MarketPagerProps | null
}>) => (
  <div className="aui-market-browse-frame">
    <div className="market-browse aui-market-browse">
      <aside className="market-groups aui-market-groups">
        <h3 className="aui-market-groups-title">{label}</h3>
        <nav aria-label={label} className="aui-market-groups-list" data-marketplace-general-categories>
          {groups.map((group) => (
            <MarketFilterButton filter={group} key={group.key} />
          ))}
        </nav>
      </aside>
      {children}
    </div>
    {pager && <MarketPager {...pager} />}
  </div>
)

export type MarketLevelInput = Readonly<{ placeholder: string; value: string; change: (value: string) => void }>
export type MarketChoice = Readonly<{ key: string; label: string; pressed: boolean; toggle: () => void }>

const MarketLevelField = ({ input }: Readonly<{ input: MarketLevelInput }>) => (
  <input
    className="aui-market-level-input"
    inputMode="numeric"
    onChange={(event) => input.change(event.target.value)}
    placeholder={input.placeholder}
    value={input.value}
  />
)

/** Character offers, filtered by level range and class. */
export const MarketCharacterBrowse = ({
  labels,
  minimum,
  maximum,
  classes,
  children,
}: Readonly<{
  labels: Readonly<{ level: string; class: string }>
  minimum: MarketLevelInput
  maximum: MarketLevelInput
  classes: readonly MarketChoice[]
  children: ReactNode
}>) => (
  <section className="market-characters aui-market-characters">
    <div className="aui-market-character-filters">
      <label className="aui-market-level">
        {labels.level}
        <span className="aui-market-level-range">
          <MarketLevelField input={minimum} />
          <span>–</span>
          <MarketLevelField input={maximum} />
        </span>
      </label>
      <div className="aui-market-classes">
        <span className="aui-market-classes-label">{labels.class}</span>
        <div className="aui-market-class-list">
          {classes.map((choice) => (
            <button
              className={`aui-market-class ${choice.pressed ? 'aui-market-class-on' : 'aui-market-class-off'}`}
              key={choice.key}
              onClick={choice.toggle}
              type="button"
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
    <div className="aui-market-scroll">{children}</div>
  </section>
)

export type MarketTemplate = Readonly<{
  key: string
  name: string
  art: MarketArt
  pressed: boolean
  select: () => void
}>

/** Item offers: subcategory rail, searchable item templates and the selected item's detail. */
export const MarketItemBrowse = ({
  subcategories,
  search,
  pet_food,
  templates,
  children,
}: Readonly<{
  subcategories: readonly MarketFilter[]
  search: Readonly<{ Icon: MarketGlyph; placeholder: string; value: string; change: (value: string) => void }>
  pet_food: Readonly<{ hidden: boolean; label: string; pressed: boolean; toggle: () => void }>
  templates: readonly MarketTemplate[]
  children: ReactNode
}>) => (
  <>
    {subcategories.length > 1 && (
      <nav className="market-subcategories aui-market-subcategories" data-marketplace-item-types>
        {subcategories.map((filter) => (
          <MarketFilterButton filter={filter} key={filter.key} />
        ))}
      </nav>
    )}
    <section className="market-templates aui-market-templates" data-marketplace-item-type-column>
      <label className="aui-market-search">
        <search.Icon size={12} className="aui-market-search-icon" />
        <input
          className="aui-market-search-input"
          onChange={(event) => search.change(event.target.value)}
          placeholder={search.placeholder}
          value={search.value}
        />
      </label>
      <div hidden={pet_food.hidden}>
        <Button className="market-filter" aria-pressed={pet_food.pressed} type="button" onClick={pet_food.toggle}>
          {pet_food.label}
        </Button>
      </div>
      <div className="aui-market-template-options" data-marketplace-template-options>
        {templates.map((template) => (
          <Button
            className="market-template"
            aria-pressed={template.pressed}
            key={template.key}
            onClick={template.select}
            type="button"
          >
            <MarketListingIcon art={template.art} size={42} />
            <span className="aui-market-template-name">{template.name}</span>
          </Button>
        ))}
      </div>
    </section>
    <section className="market-detail aui-market-detail">{children}</section>
  </>
)

export type MarketSelection = Readonly<{ art: MarketArt; name: string; level: string | null; price: string | null }>

/** The selected item's heading above its scrollable sheet and offers. */
export const MarketItemDetail = ({
  selection,
  children,
}: Readonly<{ selection: MarketSelection; children: ReactNode }>) => (
  <div className="aui-market-detail-view">
    <div className="aui-market-detail-head">
      <MarketListingIcon art={selection.art} size={28} />
      <div className="aui-market-detail-identity">
        <h3 className="aui-market-detail-name">{selection.name}</h3>
      </div>
      {selection.level !== null && <span className="aui-market-detail-level">{selection.level}</span>}
      {selection.price !== null && (
        <span className="aui-market-detail-price">
          {selection.price} <MarketCurrency />
        </span>
      )}
    </div>
    <div className="market-detail-body aui-market-detail-body">
      <div className="aui-market-detail-stack">{children}</div>
    </div>
  </div>
)

export const MarketItemSummary = ({ sheet, aside }: Readonly<{ sheet: ReactNode; aside: ReactNode }>) => (
  <div className="market-item-summary">
    <div className="aui-market-summary-sheet">{sheet}</div>
    {aside}
  </div>
)

/** Stackable items: one cheapest offer per lot size beside the price history. */
export const MarketLotColumns = ({
  ready,
  lots,
  chart,
}: Readonly<{ ready: boolean; lots: ReactNode; chart: ReactNode }>) => (
  <div className="market-item-columns">
    <div className="aui-market-lot-column" data-marketplace-listings aria-busy={!ready}>
      {lots}
    </div>
    {chart}
  </div>
)

/** Unique items and characters: every offer on its own row. */
export const MarketAskList = ({ ready, children }: Readonly<{ ready: boolean; children: ReactNode }>) => (
  <div className="aui-market-ask-list" data-marketplace-listings aria-busy={!ready}>
    {children}
  </div>
)

export type MarketLot = Readonly<{
  key: string
  size: number
  /** The formatted buyer total, or null when no offer exists for this size. */
  total: string | null
  action: string
  disabled: boolean
  buy: () => void
}>

export const MarketLotTable = ({
  labels,
  lots,
}: Readonly<{ labels: Readonly<{ lot_size: string; price: string; buy: string }>; lots: readonly MarketLot[] }>) => (
  <div className="aui-market-lot-table" data-marketplace-lot-market>
    <div className="market-lot-row aui-market-lot-heading">
      <span>{labels.lot_size}</span>
      <span>{labels.price}</span>
      <span className="aui-market-centered">{labels.buy}</span>
    </div>
    <div className="aui-market-lot-rows">
      {lots.map((lot, index) => (
        <div
          className={`market-lot-row aui-market-lot${index % 2 ? ' aui-market-stripe' : ''}`}
          data-marketplace-cheapest-lot={lot.size}
          data-marketplace-listing-row
          key={lot.key}
        >
          <div className="aui-market-lot-size-cell">
            <span className="aui-market-lot-size">×{lot.size}</span>
          </div>
          <div className="aui-market-lot-price-cell">
            <span className={`aui-market-lot-price ${lot.total === null ? 'aui-market-faint' : 'aui-market-ink'}`}>
              {lot.total === null ? (
                '—'
              ) : (
                <span className="aui-market-lot-total">
                  {lot.total} <MarketCurrency size={12} />
                </span>
              )}
            </span>
          </div>
          <button className="aui-market-lot-buy" disabled={lot.disabled} onClick={lot.buy} type="button">
            {lot.action}
          </button>
        </div>
      ))}
    </div>
  </div>
)

export type MarketSeller = Readonly<{ label: string; name: string; level: string; classe: string; address: string }>

export const MarketAskRow = ({
  index,
  icon,
  seller,
  price,
  action,
}: Readonly<{
  index: number
  icon: ReactNode
  seller: MarketSeller | null
  price: Readonly<{ label: string; value: string }>
  action: Readonly<{ label: string; disabled: boolean; buy: () => void }>
}>) => (
  <div className={`market-ask aui-market-ask${index % 2 ? ' aui-market-stripe' : ''}`} data-marketplace-listing-row>
    {icon}
    {seller && (
      <div className="aui-market-seller">
        <span className="aui-market-seller-label">{seller.label}</span>
        <span className="aui-market-seller-name">{seller.name}</span>
        <span className="aui-market-seller-detail">
          {seller.level} · {seller.classe} · {seller.address}
        </span>
      </div>
    )}
    <div className="aui-market-ask-price">
      <span className="aui-market-ask-price-label">{price.label}</span>
      <span className="aui-market-ask-price-value">
        {price.value} <MarketCurrency />
      </span>
    </div>
    <button
      className="aui-market-ask-buy"
      disabled={action.disabled}
      onClick={(event) => {
        event.stopPropagation()
        action.buy()
      }}
      type="button"
    >
      {action.label}
    </button>
  </div>
)

/** An item offer's picture; hovering or focusing it opens the caller's item tooltip. */
export const MarketAskItem = ({
  id,
  label,
  art,
  open,
  close,
  tooltip,
}: Readonly<{
  id: string
  label: string
  art: MarketArt
  open: (anchor: Readonly<HTMLElement>) => void
  close: () => void
  tooltip: ReactNode
}>) => (
  <>
    <button
      aria-label={label}
      className="aui-market-ask-item"
      data-marketplace-item={id}
      onBlur={close}
      onFocus={(event) => open(event.currentTarget)}
      onMouseEnter={(event) => open(event.currentTarget)}
      onMouseLeave={close}
      type="button"
    >
      <MarketListingIcon art={art} size={42} />
    </button>
    {tooltip}
  </>
)
