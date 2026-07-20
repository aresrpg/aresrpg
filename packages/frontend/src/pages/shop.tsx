import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ItemImage } from '../components/items'
import {
  STAT_COLORS,
  STAT_LABEL_KEYS,
  format_stat_name,
  stat_color_key,
  sort_stat_entries,
} from '../components/entity_display'
import { use_template_t } from '../i18n/template_t'
import { AddFundsModal } from '../components/add_funds_modal'
import { ShopSuccessModal } from '../components/shop_success_modal'
import { ShopAmountModal } from '../components/shop_amount_modal'
import { CreateBrokeCard } from '../game/screens/hud/CreateBrokeCard.jsx'
import { use_auth, type AuthState } from '../auth'
import { use_items_shop_chain, dedupe_shop_sales } from '../stores/items_shop_chain'
import { sale_supply_progress } from '../chain/read_shop_sales'
import { buy_items_sale } from '../world-shell/items_sale_actions'
import { is_lootbox, read_pet_box_claims, claim_pet, resolve_rolled } from '../world-shell/lootbox_actions'
import { begin_claim, end_claim } from '../game/screens/hud/lootbox-retry-guard'
import { hydrate_bought_items } from '../world-shell/store_patch'
import { load_roster } from '../roster/load_roster'
import { use_toast } from '../toast'
import { format_mist_to_sui } from '../utils/sui_mist'

import { use_content } from './encyclopedia/content'
import { pool_with_percent } from './lootbox_pool'
import LOOTBOX_POOLS from './lootbox_pools.json'
import {
  VitrineCard,
  VaultCard,
  ordered_shop_section_keys,
  sort_shop_items_by_price,
  type BuyProps,
} from './shop_vitrine'
import { gem_variant_label, localized_shop_description, localized_shop_name as shop_name } from './shop_gems'
import { STACKABLE_CATS, plan_purchase } from './shop_buy_plan'
import './shop.css'

/** A resolved unclaimed PetBoxClaim — post-D3, the visible face of a claim the AUTO paths (reveal / boot sweep) could not finish: the manual one-click retry. */
type PendingClaim = { claim_id: string; rolled_template: string; slug: string; name: string }
const COSMETIC_CATS = new Set(['HAT', 'CLOAK'])
const EQUIPMENT_CATS = new Set(
  'HELMET CHESTPLATE BELT GAUNTLETS PANTS BOOTS LONGSWORD DAGGERS BOW SPEAR STAFF AXE SPELLBOOK BATTLEAXE SWORD CLUB MACE AMULET RING RELIC'.split(
    ' '
  )
)

/** Pull a cosmetic's parenthesized variant suffix into a chip beside the base name. PURE. */
function split_variant(name: string): { base: string; variant?: string } {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  return m ? { base: m[1], variant: m[2] } : { base: name }
}
export function shop_hydration_metadata(
  item: { item_template_id: string; template_id: string; name: string },
  templates: ReadonlyArray<{ id: string; name: string; level: number }>
) {
  const exact = templates.find(({ id }) => id === item.item_template_id)
  const named = templates.filter(({ name }) => name === item.name)
  const template = exact ?? (named.length === 1 ? named[0] : undefined)
  return { item_type: item.item_template_id, template_id: item.template_id, level: template?.level ?? 1 }
}
export function ShopPage() {
  const { t } = useTranslation()
  const tt = use_template_t()
  const router_navigate = useNavigate()
  const { templates } = use_content()

  const address = use_auth((s: AuthState) => s.address)
  const balance_mist = use_auth((s: AuthState) => s.sui_balance_mist)
  const refresh_sui_balance = use_auth((s: AuthState) => s.refresh_sui_balance)
  const [show_add_funds, set_show_add_funds] = useState(false)
  // Shared /v1 shop data keeps its last-known catalog while load reconciles.
  const { sales, loaded_once, load, apply_purchase } = use_items_shop_chain()
  const [buying_id, set_buying_id] = useState<string | null>(null)
  const [purchased, set_purchased] = useState<{ name: string; id: string; appearance?: string } | null>(null)
  // Interrupted pet-box opens remain collectable from the PET BOXES section.
  const [claims, set_claims] = useState<PendingClaim[]>([])
  const [collecting_claim, set_collecting_claim] = useState<string | null>(null)
  // null means every kind; one key narrows to that section.
  const [active_kind, set_active_kind] = useState<string | null>(null)

  useEffect(() => {
    load() // revalidate on mount — the store keeps last-known sales visible instantly while this reconciles
  }, [load])

  // Resolve unclaimed boxes on connect and after each collect.
  const reload_claims = useCallback(async () => {
    if (!address) {
      set_claims([])
      return
    }
    const raw = await read_pet_box_claims(address)
    const resolved = await Promise.all(
      raw.map(async (c) => {
        const { slug } = await resolve_rolled({ rolled_template: c.rolled_template })
        const tmpl = (templates.item || []).find((it: any) => it.id === slug || it.item_type === slug)
        return {
          claim_id: c.claim_id,
          rolled_template: c.rolled_template,
          slug: slug || c.rolled_template,
          name: tmpl ? tt(tmpl, 'name') : String(slug || c.rolled_template).replace(/_/g, ' '),
        }
      })
    )
    set_claims(resolved)
  }, [address, templates.item, tt])

  // Subscribe on stable address while calling the latest translation-sensitive closure.
  const reload_claims_ref = useRef(reload_claims)
  reload_claims_ref.current = reload_claims

  useEffect(() => {
    reload_claims_ref.current()
  }, [address])

  const handle_collect = useCallback(
    async (claim: PendingClaim) => {
      if (collecting_claim) return
      // ONE flight per claim across surfaces (reveal auto-claim / boot sweep / this chip) — the guard is the
      // single arbiter; executed transactions are never auto-retried (this click IS the manual retry).
      if (!begin_claim(claim.claim_id)) return
      set_collecting_claim(claim.claim_id)
      try {
        await use_toast
          .getState()
          .promise(claim_pet({ claim_id: claim.claim_id, rolled_template: claim.rolled_template }), {
            pending: t('lootbox.collecting'),
            success: t('lootbox.collected', { name: claim.name }),
          })
        end_claim(claim.claim_id, {})
        set_claims((cs) => cs.filter((c) => c.claim_id !== claim.claim_id))
        load_roster().catch(() => {})
        reload_claims()
      } catch (error) {
        end_claim(claim.claim_id, { error }) // toast.promise surfaced the humanized failure; the chip remains for a manual retry
      } finally {
        set_collecting_claim(null)
      }
    },
    [collecting_claim, t, reload_claims]
  )

  // Refresh the shared balance when the shop opens.
  useEffect(() => {
    refresh_sui_balance()
  }, [refresh_sui_balance])

  // Dedupe paused-round siblings, then map on-chain sales into card data; raw store rows stay untouched.
  const shop_catalog = useMemo(
    () =>
      dedupe_shop_sales(sales).map((s) => {
        const slug = s.template?.item_type || s.template_id
        return {
          item_id: s.id,
          sale_id: s.id,
          template_id: s.template_id,
          item_template_id: slug,
          render_name: s.template?.display?.name || s.template?.name || '',
          appearance: '',
          name: s.template?.display?.name || s.template?.name || '',
          description: s.template?.display?.description || '',
          // Localized description key; uncovered entries retain Display English.
          desc_key: slug,
          price_mist: BigInt(s.price_mist),
          category: (s.template?.category || 'CONSUMABLE').toUpperCase(),
          stock: s.infinite ? -1 : s.supply,
          // Infinite sales receive null progress and render no supply bar.
          ...sale_supply_progress(s),
        }
      }),
    [sales]
  )

  // Purchase overlays: stack quantity and the attempted unit price when funds are short.
  const [amount_item, set_amount_item] = useState<{
    item: (typeof shop_catalog)[number]
    max_qty: number
    display_name: string
  } | null>(null)
  const [broke, set_broke] = useState<number | null>(null)

  const handle_buy = useCallback(
    async (item: (typeof shop_catalog)[number], quantity = 1) => {
      if (!address || buying_id) return
      set_buying_id(item.item_id)
      try {
        // The SDK buy returns real object ids; paint them immediately, then reconcile through load_roster.
        const buy_p = buy_items_sale({
          sale_id: item.sale_id,
          template_id: item.template_id,
          price_mist: item.price_mist,
          quantity,
        })
        await use_toast.getState().promise(buy_p, {
          pending: t('shop.buy_pending'),
          success: t('shop.buy_success'),
        })
        const { created_item_ids, kiosk_id, kiosk_cap_id } = await buy_p
        // Stackables mint one quantity-N object; non-stackables mint one object per unit.
        const paint_amount = STACKABLE_CATS.has(item.category) ? quantity : 1
        hydrate_bought_items(
          created_item_ids.map((id) => ({
            id,
            name: shop_name(tt(item, 'name') || item.name, t),
            ...shop_hydration_metadata(item, templates.item),
            item_category: item.category.toLowerCase(),
            item_set: '',
            amount: paint_amount,
            kiosk_id,
            kiosk_cap_id,
          }))
        )
        if (item.stock !== -1) apply_purchase(item.sale_id)
        load_roster().catch(() => {})
        set_purchased({
          name: shop_name(tt(item, 'name') || item.name, t),
          id: item.item_template_id,
          appearance: item.appearance || undefined,
        })
        load()
      } catch {
        /* toast already surfaced the failure */
      } finally {
        set_buying_id(null)
      }
    },
    [address, buying_id, load, apply_purchase, tt, t, templates.item]
  )

  // The pure plan chooses the broke card or the quantity modal — the modal is the UNIVERSAL gate before the buy
  // PTB (2026-07-18: every category asks, not just lootboxes); handle_buy fires only from its confirm.
  const request_buy = (item: (typeof shop_catalog)[number]) => {
    if (!address || buying_id) return
    const plan = plan_purchase({
      price_mist: item.price_mist,
      category: item.category,
      stock: item.stock,
      balance_mist,
    })
    if (plan.kind === 'broke') {
      set_broke(plan.unit_price_sui)
      // Refresh the one balance source at the decision point.
      refresh_sui_balance()
      return
    }
    const display_name = shop_name(tt(item, 'name') || item.name || item.item_template_id.replace(/_/g, ' '), t)
    set_amount_item({ item, max_qty: plan.max_qty, display_name })
  }

  // template slug → encyclopedia pet data
  const pet_data_map = useMemo(() => {
    const map = new Map<string, { stats: [string, number][]; food_ids: string[] }>()
    const items = templates.item || []
    for (const t of items) {
      if (t.category !== 'PET') continue
      try {
        const stats_raw = JSON.parse((t as any).petStatsJson || '{}')
        const food_raw = JSON.parse((t as any).petFoodJson || '{}')
        const stats = sort_stat_entries(Object.entries(stats_raw).filter(([, v]) => v !== 0)) as [string, number][]
        const food_ids = Object.keys(food_raw)
        map.set(t.id, { stats, food_ids })
      } catch {
        /* skip malformed */
      }
    }
    return map
  }, [templates.item])

  // Every on-chain kind gets its own section and filter chip.
  const KIND_LABELS: Record<string, string> = {
    PET_BOX: t('shop.pet_boxes'),
    HAT: t('shop.hats'),
    CLOAK: t('shop.cloaks'),
    TITLE: t('shop.titles'),
    COMPANION: t('shop.companions'),
    EQUIPMENT: t('shop.equipment'),
    CONSUMABLE: t('shop.consumables'),
    RESOURCE: t('shop.resources'),
  }
  function get_kind(item: (typeof shop_catalog)[number]) {
    if (is_lootbox(item.item_template_id)) return 'PET_BOX' // a box's on-chain category is consumable — checked first
    switch (item.category) {
      case 'HAT':
        return 'HAT'
      case 'CLOAK':
        return 'CLOAK'
      case 'TITLE':
        return 'TITLE'
      case 'PET':
      case 'MOUNT':
        return 'COMPANION'
      case 'RESOURCE':
        return 'RESOURCE'
      case 'CONSUMABLE':
        return 'CONSUMABLE'
      default:
        return EQUIPMENT_CATS.has(item.category) ? 'EQUIPMENT' : item.category || 'CONSUMABLE'
    }
  }

  const sections = useMemo(() => {
    const grouped: Record<string, typeof shop_catalog> = {}
    for (const item of shop_catalog) (grouped[get_kind(item)] ??= []).push(item)
    return ordered_shop_section_keys(grouped).map((k) => ({
      key: k,
      label: KIND_LABELS[k] ?? t(`entity.category.${k.toLowerCase()}`, k),
      items: sort_shop_items_by_price(grouped[k]),
    }))
  }, [shop_catalog, t])

  const visible_sections = active_kind ? sections.filter((s) => s.key === active_kind) : sections

  /** Compact purchase-decision blocks for a PET card (newborn → max stats, accepted food). */
  const pet_info_blocks = (item: (typeof shop_catalog)[number]) => {
    const pet = pet_data_map.get(item.item_template_id)
    if (!pet) return null
    return (
      <>
        {pet.stats.length > 0 && (
          <div className="pet-stats">
            <span className="pet-stats-head">
              {t('shop.newborn')} → {t('shop.max_power')}
            </span>
            {pet.stats.map(([key, val]) => {
              const color = STAT_COLORS[stat_color_key(key)] || '#e8e4dc'
              return (
                <div key={key} className="pet-stat-line">
                  <span style={{ color: '#6b7280' }}>0 →</span>
                  <span style={{ color }}>{val}</span>
                  <span style={{ color }}>
                    {t(STAT_LABEL_KEYS[key] ?? '', { defaultValue: format_stat_name(key) })}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {pet.food_ids.length > 0 && (
          <div className="pet-stats">
            <span className="pet-stats-head">{t('shop.food_sources')}</span>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {pet.food_ids.map((id) => {
                const tmpl = (templates.item || []).find((it: any) => it.id === id)
                return (
                  <span key={id} className="text-[9px] tracking-[0.1em] uppercase" style={{ color: '#4ade80' }}>
                    {tmpl ? tt(tmpl, 'name') : id.replace(/_/g, ' ')}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="p-3 lg:p-8 shop-armory">
      <header className="mb-2">
        <div className="shop-eyebrow">{t('shop.subtitle')}</div>
        <div className="mast-row">
          <h1 className="mast-title text-gradient">{t('shop.title')}</h1>
          {address && balance_mist !== null && (
            <div className="mast-balance">
              <span className="mast-balance-label">{t('shop.wallet')}</span>
              <span className="mast-balance-value">{format_mist_to_sui(balance_mist, 2)} SUI</span>
            </div>
          )}
        </div>
        <div className="subtitle-strip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M6 3h12l-1 6-5 3 5 3-1 6H6l-1-6 5-3-5-3 1-6Z" />
          </svg>
          <span className="subtitle-text">{t('shop.limited_edition_notice')}</span>
        </div>
        {balance_mist !== null && balance_mist < 10_000_000n && (
          <div
            className="mt-3 px-4 py-3 border-l-2 border-cyan/40 text-[10px] tracking-wide leading-relaxed text-text/80 flex items-center gap-2"
            style={{
              background:
                'linear-gradient(90deg, rgba(74,158,255,0.12) 0%, rgba(74,158,255,0.04) 60%, transparent 100%)',
            }}
          >
            <span className="text-cyan uppercase tracking-[0.15em] font-semibold">{t('shop.wallet_empty')}</span>
            <span className="text-muted">-</span>
            <button
              type="button"
              onClick={() => set_show_add_funds(true)}
              className="text-cyan hover:text-gold transition-colors cursor-pointer uppercase tracking-[0.15em] font-semibold underline underline-offset-2"
            >
              {t('purchase.add_funds')}
            </button>
            <span className="text-text/60">{t('shop.add_funds_prompt')}</span>
          </div>
        )}
        {sections.length > 0 && (
          <div className="shop-tabs">
            <button
              type="button"
              className={`shop-tab${active_kind === null ? ' active' : ''}`}
              onClick={() => set_active_kind(null)}
            >
              {t('shop.filter_all')}
            </button>
            {sections.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`shop-tab${active_kind === key ? ' active' : ''}`}
                onClick={() => set_active_kind(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {!loaded_once && shop_catalog.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted text-[10px] tracking-wide uppercase animate-pulse">{t('shop.loading')}</div>
        </div>
      ) : shop_catalog.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted text-[10px] tracking-wide uppercase">{t('shop.empty')}</div>
        </div>
      ) : (
        visible_sections.map((section) => (
          <div key={section.key}>
            <div className="section-head">
              <span>{section.label}</span>
              <div className="ln" />
            </div>
            {section.key === 'PET_BOX' && claims.length > 0 && (
              <div
                className="flex flex-col gap-2 p-4 mb-5 border border-gold/25"
                style={{ background: 'rgba(200,150,60,0.05)' }}
              >
                <span className="text-[9px] tracking-[0.3em] uppercase text-gold/80 font-semibold">
                  {t('lootbox.awaiting_collection')}
                </span>
                <div className="flex flex-col gap-2">
                  {claims.map((claim) => (
                    <div key={claim.claim_id} className="flex items-center gap-3">
                      <div className="shrink-0 p-1">
                        <ItemImage id={claim.slug} category="PET" className="w-8 h-8 object-contain" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[11px] tracking-[0.15em] uppercase text-text truncate">{claim.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handle_collect(claim)}
                        disabled={!!collecting_claim}
                        className="btn-gold px-5 py-2 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {collecting_claim === claim.claim_id ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            {t('lootbox.collecting')}
                          </>
                        ) : (
                          t('lootbox.collect')
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="shop-grid">
              {section.items.map((item) => {
                const raw_name = shop_name(tt(item, 'name') || item.name || item.item_template_id.replace(/_/g, ' '), t)
                const { base: display_name, variant: raw_variant } = split_variant(raw_name)
                // Elemental variants display the authored gem label.
                const variant = gem_variant_label(raw_variant, t)
                const description = localized_shop_description(tt(item, 'description') || '', t) || undefined
                const open_encyclopedia = () => router_navigate(`/encyclopedia/items/${item.item_template_id}`)
                const buy: BuyProps = {
                  on_buy: () => request_buy(item),
                  buying: buying_id === item.item_id,
                  disabled: !address || !!buying_id,
                  sold_out: item.stock === 0,
                }
                const is_box = is_lootbox(item.item_template_id)
                const pool = LOOTBOX_POOLS[item.item_template_id as keyof typeof LOOTBOX_POOLS]

                // A known loot-box pool gets the icon-forward odds ledger; every row deep-links by pet slug.
                if (is_box && pool && pool.length > 0) {
                  const pool_rows = pool_with_percent(pool).map((row) => {
                    const tmpl = (templates.item || []).find((it: any) => it.id === row.pet || it.item_type === row.pet)
                    return { ...row, name: tmpl ? tt(tmpl, 'name') : row.pet.replace(/_/g, ' ') }
                  })
                  return (
                    <VaultCard
                      key={item.item_id}
                      item={item}
                      display_name={display_name}
                      description={description}
                      pool_rows={pool_rows}
                      on_open_encyclopedia={open_encyclopedia}
                      on_open_pool_entry={(slug) => router_navigate(`/encyclopedia/items/${slug}`)}
                      buy={buy}
                    />
                  )
                }

                const stage = COSMETIC_CATS.has(item.category)
                  ? 'mannequin'
                  : item.category === 'PET' || item.category === 'MOUNT'
                    ? 'diorama'
                    : is_box
                      ? 'box'
                      : 'icon'
                const has_trail = !!((templates.item || []).find((tm) => tm.id === item.item_template_id) as any)
                  ?.particleTrailJson

                return (
                  <VitrineCard
                    key={item.item_id}
                    item={item}
                    stage={stage}
                    display_name={display_name}
                    variant={variant}
                    description={description}
                    on_open_encyclopedia={open_encyclopedia}
                    buy={buy}
                  >
                    {has_trail && (
                      <div className="py-2 px-3 border border-gold/20" style={{ background: 'rgba(200,150,60,0.04)' }}>
                        <span className="text-[10px] tracking-wide" style={{ color: '#c8963c', fontStyle: 'italic' }}>
                          ✦ {t('entity.particle_trail_effect')}
                        </span>
                      </div>
                    )}
                    {item.category === 'PET' && pet_info_blocks(item)}
                  </VitrineCard>
                )
              })}
            </div>
          </div>
        ))
      )}

      {purchased && (
        <ShopSuccessModal
          item_name={purchased.name}
          item_id={purchased.id}
          appearance={purchased.appearance}
          on_view_inventory={() => {
            set_purchased(null)
            router_navigate('/characters')
          }}
          on_close={() => set_purchased(null)}
        />
      )}

      {amount_item && (
        <ShopAmountModal
          item={amount_item.item}
          display_name={amount_item.display_name}
          max_qty={amount_item.max_qty}
          on_close={() => set_amount_item(null)}
          on_confirm={(qty) => {
            const picked = amount_item.item
            set_amount_item(null)
            handle_buy(picked, qty)
          }}
        />
      )}

      {/* The shop owns this funding modal because the global wallet gate is not mounted here. */}
      {broke != null && (
        <CreateBrokeCard
          price_sui={broke}
          balance_mist={balance_mist}
          address={address ?? null}
          message_key="shop.broke_message"
          on_add_funds={() => set_show_add_funds(true)}
          on_close={() => set_broke(null)}
        />
      )}

      {show_add_funds && address && (
        <AddFundsModal
          address={address}
          on_close={() => {
            set_show_add_funds(false)
            refresh_sui_balance()
          }}
        />
      )}
    </div>
  )
}
