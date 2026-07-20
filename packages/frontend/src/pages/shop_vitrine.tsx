// SHOP vitrine cards — the Armory Grid card anatomy (option-2 mockup). Pure presentation:
// every mechanic (buy flow, supply math, pool math, catalog mapping) stays in shop.tsx and arrives as props.
//
// WORN-RENDER SLOT: census projects exact shop aliases + published patches into shop_render_catalog.json. Cards
// resolve that small build artifact synchronously, then route every proven still through Walrus shop_render.
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ShoppingBag } from 'lucide-react'
import { walrus_asset_url } from '@aresrpg/sdk/jobs'

import { ItemImage } from '../components/items'
import { format_mist_to_sui } from '../utils/sui_mist'

import SHOP_RENDER_CATALOG from './shop_render_catalog.json'
import { shop_item_icon } from './shop_icon'
import { resolve_shop_render_url } from './shop_render_url'
import './shop_vitrine.css'

/** One shop_assets manifest render entry (worn cosmetics + pet dioramas share the shape). */
export type WornEntry = {
  kind: 'worn' | 'pet'
  png?: string | null
  png_hd?: string | null
  video?: string | null
}

type ShopRenderCatalog = {
  aliases: Record<string, string>
  renders: Record<string, WornEntry>
}

const RENDER_CATALOG = SHOP_RENDER_CATALOG as ShopRenderCatalog

function render_alias_key(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

export type ResolvedShopRender = { identifier: string; entry: WornEntry }

/** Resolve sale slug/name candidates through the census alias map; a non-published render stays null. */
export function resolve_shop_render(...identities: (string | null | undefined)[]): ResolvedShopRender | null {
  for (const identity of identities) {
    if (!identity) continue
    const alias = render_alias_key(identity)
    const identifier = RENDER_CATALOG.aliases[alias] ?? alias
    const entry = RENDER_CATALOG.renders[identifier]
    if (entry) return { identifier, entry }
  }
  return null
}

export function shop_render_entry(...identities: (string | null | undefined)[]): WornEntry | null {
  return resolve_shop_render(...identities)?.entry ?? null
}

/** Resolve a manifest-relative still/video through its published Walrus class. */
export function shop_asset_url(rel_path: string | null | undefined): string | null {
  return resolve_shop_render_url(rel_path, walrus_asset_url)
}

/** The structural slice of a shop.tsx catalog row the cards render. */
export type CardItem = {
  item_id: string
  item_template_id: string
  render_name?: string
  category: string
  price_mist: bigint
  stock: number
  minted: number
  supply_cap: number | null
  percent_minted: number | null
}

/** Page presentation order: owner-prioritized headings first, then the prior remainder order. */
export const SHOP_SECTION_ORDER = [
  'PET_BOX',
  'TITLE',
  'CLOAK',
  'HAT',
  'COMPANION',
  'EQUIPMENT',
  'CONSUMABLE',
  'RESOURCE',
] as const

export function ordered_shop_section_keys(grouped: Record<string, readonly unknown[]>): string[] {
  const known = SHOP_SECTION_ORDER.filter((key) => grouped[key]?.length)
  const extra = Object.keys(grouped)
    .filter((key) => !(SHOP_SECTION_ORDER as readonly string[]).includes(key))
    .sort()
  return [...known, ...extra]
}

export function sort_shop_items_by_price<T extends { price_mist: bigint }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.price_mist < b.price_mist ? -1 : a.price_mist > b.price_mist ? 1 : 0))
}

export type BuyProps = {
  on_buy: () => void
  buying: boolean
  disabled: boolean
  sold_out: boolean
}

/** Mockup mannequin silhouette — the "worn render incoming" stage for cosmetics. */
function Mannequin() {
  const gid = useId()
  const stroke = `url(#${gid})`
  return (
    <svg className="mannequin" viewBox="0 0 160 320" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="80" cy="42" r="30" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" />
      <path
        d="M50 70 L110 70 L124 150 L118 210 L100 210 L96 160 L64 160 L60 210 L42 210 L36 150 Z"
        stroke={stroke}
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <path d="M50 78 L20 100 L14 160" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M110 78 L140 100 L146 160" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M60 210 L54 300 L74 300 L80 220" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M100 210 L106 300 L86 300 L80 220" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" />
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5d0a9" stopOpacity="0.55" />
          <stop offset="1" stopColor="#c8963c" stopOpacity="0.2" />
        </linearGradient>
      </defs>
    </svg>
  )
}

/** Decreasing supply bar — smooth pill track; <10% remaining keeps the subtle brightness pulse. */
function SupplyBar({ item }: { item: CardItem }) {
  const { t } = useTranslation()
  if (item.supply_cap == null || item.percent_minted == null) return null
  const pct_remaining = Math.max(0, Math.min(100, 100 - item.percent_minted))
  // Bold the remaining count INSIDE the localized sentence (locales order the placeholders differently — JA
  // leads with 残り): render the full string, then wrap the first occurrence of the count in the gold <b>.
  const rem_str = item.stock.toLocaleString()
  const label = t('shop.remaining_of_cap', { remaining: rem_str, cap: item.supply_cap.toLocaleString() })
  const idx = label.indexOf(rem_str)
  return (
    <div>
      <div className="supply-label">
        <span className="rem">
          {idx >= 0 ? (
            <>
              {label.slice(0, idx)}
              <b>{rem_str}</b>
              {label.slice(idx + rem_str.length)}
            </>
          ) : (
            label
          )}
        </span>
        <span className="pct">{Math.round(pct_remaining)}%</span>
      </div>
      <div className={`supply-track${pct_remaining <= 10 ? ' low' : ''}`}>
        <div className="supply-fill" style={{ '--pct': `${pct_remaining}%` } as React.CSSProperties} />
      </div>
    </div>
  )
}

/** Price + Acquire row (mockup buy-row) — sold-out renders the inert SOLD OUT button. */
function BuyRow({ item, buy }: { item: CardItem; buy: BuyProps }) {
  const { t } = useTranslation()
  return (
    <div className="buy-row">
      <span className="price">
        {format_mist_to_sui(item.price_mist, 2)}
        <span>SUI</span>
      </span>
      <button type="button" className="btn-gold" onClick={buy.on_buy} disabled={buy.disabled || buy.sold_out}>
        {buy.buying ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            {t('shop.processing')}
          </>
        ) : buy.sold_out ? (
          t('shop.sold_out')
        ) : (
          <>
            <ShoppingBag size={12} />
            {t('shop.acquire')}
          </>
        )}
      </button>
    </div>
  )
}

function CardName({ display_name, variant }: { display_name: string; variant?: string }) {
  return (
    <h3 className="item-name">
      {display_name}
      {variant && <span className="variant-chip">{variant}</span>}
    </h3>
  )
}

/** The spotlit glass-case stage. Variants: huge icon / cosmetic mannequin+worn render / pet diorama / box glow. */
function CaseStage({
  item,
  stage,
  render_entry,
  display_name,
  on_open_encyclopedia,
}: {
  item: CardItem
  stage: 'icon' | 'mannequin' | 'diorama' | 'box'
  render_entry: WornEntry | null
  display_name: string
  on_open_encyclopedia: () => void
}) {
  const { t } = useTranslation()
  // Worn cosmetic render (full-case cover) — only a census-proven miss or failed media keeps the mannequin.
  // Stills only: the laggy video PREVIEW button died 2026-07-17.
  const [worn_failed, set_worn_failed] = useState(false)
  const worn_url = stage === 'mannequin' ? shop_asset_url(render_entry?.png_hd ?? render_entry?.png) : null
  const worn_live = !!worn_url && !worn_failed
  const title = t('shop.view_in_encyclopedia')
  const icon_asset = shop_item_icon(item, { hd: stage !== 'mannequin' })

  return (
    <div className="case">
      <div className="case-spot" />

      {stage === 'icon' && (
        <>
          {/* ItemImage renders a plain <img>; the case-icon class positions + sizes it (~65% card width). */}
          <ItemImage
            id={icon_asset.id}
            image_url={icon_asset.image_url ?? undefined}
            category={item.category}
            hd
            className="case-icon"
            eager
          />
          <div className="case-pedestal" />
        </>
      )}

      {stage === 'box' && (
        <>
          <ItemImage
            id={icon_asset.id}
            image_url={icon_asset.image_url ?? undefined}
            category={item.category}
            hd
            className="case-box"
            eager
          />
          <div className="case-pedestal" />
        </>
      )}

      {stage === 'diorama' && (
        <>
          <div className="diorama-ground" />
          {/* Pet render by manifest path first (asset lane), the pet's item icon as the fallback chain. */}
          <ItemImage
            id={icon_asset.id}
            image_url={shop_asset_url(render_entry?.png_hd) ?? icon_asset.image_url ?? undefined}
            category={item.category}
            hd
            className="diorama-pet"
            eager
          />
          <div className="diorama-motes">
            <i style={{ left: '30%', top: '40%', animationDelay: '.2s' }} />
            <i style={{ left: '65%', top: '30%', animationDelay: '1.4s' }} />
            <i style={{ left: '50%', top: '55%', animationDelay: '2.6s' }} />
          </div>
        </>
      )}

      {stage === 'mannequin' && (
        <>
          {worn_live && worn_url ? (
            <img
              className="case-worn"
              src={worn_url}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => set_worn_failed(true)}
            />
          ) : (
            <>
              <Mannequin />
              <div className="case-pedestal" />
              <div className="scan-sweep" />
            </>
          )}
          <div className="id-chip" onClick={on_open_encyclopedia} title={title} role="button">
            <ItemImage
              id={icon_asset.id}
              image_url={icon_asset.image_url ?? undefined}
              category={item.category}
              className="id-chip-img"
            />
            <span>
              <b>{display_name}</b>
              {!worn_live && t('shop.worn_render_incoming')}
            </span>
          </div>
        </>
      )}

      {(stage === 'icon' || stage === 'diorama') && (
        // Icon/diorama art doubles as the encyclopedia affordance (live behavior preserved).
        <button
          type="button"
          className="absolute inset-0 cursor-pointer"
          style={{ background: 'transparent', border: 'none' }}
          onClick={on_open_encyclopedia}
          title={title}
          aria-label={title}
        />
      )}
    </div>
  )
}

/** Standard vitrine card: spotlit case + name/variant + optional info children + supply + buy. */
export function VitrineCard({
  item,
  stage,
  display_name,
  variant,
  description,
  on_open_encyclopedia,
  buy,
  children,
}: {
  item: CardItem
  stage: 'icon' | 'mannequin' | 'diorama' | 'box'
  display_name: string
  variant?: string
  description?: string
  on_open_encyclopedia: () => void
  buy: BuyProps
  children?: ReactNode
}) {
  const render_entry = shop_render_entry(item.item_template_id, item.render_name)
  return (
    <article className={`vitrine${buy.sold_out ? ' soldout' : ''}`}>
      <CaseStage
        item={item}
        stage={stage}
        render_entry={render_entry}
        display_name={display_name}
        on_open_encyclopedia={on_open_encyclopedia}
      />
      <div className="info">
        <CardName display_name={display_name} variant={variant} />
        {description && <p className="item-desc">{description}</p>}
        {children}
        <SupplyBar item={item} />
        <BuyRow item={item} buy={buy} />
      </div>
    </article>
  )
}

export type PoolDisplayRow = { pet: string; percent: number; name: string }

/** Loot-box vault card — purchase case with an icon-forward pet odds ledger stacked below. */
export function VaultCard({
  item,
  display_name,
  description,
  pool_rows,
  on_open_encyclopedia,
  on_open_pool_entry,
  buy,
}: {
  item: CardItem
  display_name: string
  description?: string
  pool_rows: PoolDisplayRow[]
  on_open_encyclopedia: () => void
  on_open_pool_entry: (slug: string) => void
  buy: BuyProps
}) {
  const { t } = useTranslation()
  return (
    <article className={`vitrine vitrine--vault${buy.sold_out ? ' soldout' : ''}`}>
      <div className="vault-left">
        <CaseStage
          item={item}
          stage="box"
          render_entry={shop_render_entry(item.item_template_id, item.render_name)}
          display_name={display_name}
          on_open_encyclopedia={on_open_encyclopedia}
        />
        <div className="info">
          <CardName display_name={display_name} />
          {description && <p className="item-desc">{description}</p>}
          <SupplyBar item={item} />
          <BuyRow item={item} buy={buy} />
        </div>
      </div>
      <div className="vault-right">
        <div className="vault-title-row">
          <h3>{t('lootbox.drop_rates')}</h3>
        </div>
        <div className="vault-sub">{t('lootbox.pool_sub')}</div>
        <div className="pool-head">
          <span />
          <span>{t('entity.category.pet')}</span>
          <span>{t('lootbox.pool_odds')}</span>
        </div>
        {pool_rows.map((row) => (
          <button
            type="button"
            className="pool-row"
            key={row.pet}
            data-encyclopedia-item={row.pet}
            onClick={() => on_open_pool_entry(row.pet)}
          >
            <ItemImage id={row.pet} category="PET" className="pool-icon" />
            <span className="pool-name">{row.name}</span>
            <span className="pool-pct">{row.percent.toFixed(1)}%</span>
          </button>
        ))}
      </div>
    </article>
  )
}
