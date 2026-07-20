import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Store, Loader2 } from 'lucide-react'
import { slugs } from 'virtual:item_catalog'

import { get_sales_history } from '../../rpc/client'
import { use_rpc_view } from '../../rpc/use_view'
import { use_address_names } from '../../rpc/use_address_names'
import { RpcStale } from '../../rpc/RpcStale'
import { use_auth } from '../../auth'
import { use_marketplace_chain } from '../../stores/marketplace_chain'
import { use_template_t } from '../../i18n/template_t'
import { format_mist_to_sui } from '../../utils/sui_mist'
import { truncate_address } from '../../utils/address'
import { quality_color } from '../../game/screens/hud/quality'
import { cosmetic_icon_of } from '../../game/cosmetic_icons.js'
import { ItemImage } from '../items'
import { AddressName } from '../address_name'

// HISTORY tab — a seller's REALISED marketplace sales, read keyless off /v1/sales-history?seller=<me>
// (SPEC §14). The trailing-30d revenue tile leads (house "big number first" law), then a newest-first
// ledger: item (shared ItemImage + template-resolved name) · when · price SUI · buyer (D52 AddressName).
// MONEY is BigInt off the string wire (never Number). The row's `category` is the item_type SLUG — the
// ItemImage `id` AND the templates_item lookup key (browse's exact convention); `template_id` (object id)
// and `category` are both null for a character/burned sale, so the name honestly falls back. Date is
// localized-relative (Intl.RelativeTimeFormat — i18n for all 6 locales for free). Pagination is a GROWING
// WINDOW: `limit` bumps by PAGE and the short-poll refetches; realised sales are immutable so a wider
// window can never disagree with itself (no cursor-accumulation dedup). `next_cursor` != null ⇒ more exist.

const PAGE = 30
const DAY = 86_400_000

function format_ago(ms: number, lang: string): string {
  const diff = ms - Date.now() // negative → in the past
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), 'hour')
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / DAY), 'day')
  return rtf.format(Math.round(diff / (30 * DAY)), 'month')
}

export function HistoryPanel() {
  const { t, i18n } = useTranslation()
  const tt = use_template_t()
  const address = use_auth((s) => s.address)
  const templates_item = use_marketplace_chain((s) => s.templates_item)
  const [limit, set_limit] = useState(PAGE)

  // Short-poll the live view (UI-DATA LAW), gated until the wallet address resolves. `limit` in deps so
  // "Load more" re-subscribes with a wider window; the api clamps limit to 1..200.
  const view = use_rpc_view((signal) => get_sales_history({ seller: address as string, limit }, signal), {
    deps: [address, limit],
    enabled: !!address,
  })
  const { data } = view
  const rows = data?.sales ?? []
  const has_more = data?.next_cursor != null && limit < 200
  const lang = i18n.resolvedLanguage || i18n.language?.split('-')[0] || 'en'

  // D52 — one batched /v1/names round trip for every buyer in the visible rows.
  const buyer_names = use_address_names(rows.map((r) => r.buyer))

  const revenue = useMemo(() => {
    try {
      return format_mist_to_sui(BigInt(data?.revenue_30d_mist ?? '0'), 2)
    } catch {
      return '0.00'
    }
  }, [data?.revenue_30d_mist])

  // Resolve an item's display name + rarity color from the shared template catalog (browse's `name_of`),
  // keyed by the item_type slug the sales row carries as `category`. No template (or a character/burned
  // sale) → the humanized slug, else the shortened item id — the gap is rendered, never faked.
  function present(template_id: string | null, item_type: string | null, item_id: string) {
    const exact = template_id ? templates_item.find((tp: any) => tp.template_id === template_id) : null
    const candidates = exact || !item_type ? [] : templates_item.filter((tp: any) => tp.id === item_type)
    const tmpl = exact ?? (candidates.length === 1 ? candidates[0] : null)
    const authored_name = String(tmpl?.name ?? '')
    const template_slug = authored_name ? slugs[authored_name] : undefined
    const icon = cosmetic_icon_of({ slug: template_slug, name: authored_name }) ?? template_slug ?? ''
    const name =
      (tmpl ? tt(tmpl, 'name') : '') || (item_type ? item_type.replace(/_/g, ' ') : truncate_address(item_id))
    return {
      name,
      icon,
      category: tmpl?.category ?? null,
      color: quality_color(tmpl?.quality || tmpl?.rarity || 'common'),
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto w-full max-w-[1200px] mx-auto">
      {/* Trailing-30d revenue tile — the big number leads (house law) */}
      <div className="flex items-center justify-between gap-4 px-4 pt-4 pb-3 shrink-0">
        <div
          className="flex flex-col gap-1 px-5 py-4 border"
          style={{
            borderColor: 'rgba(255,255,255,0.09)',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
            minWidth: 260,
          }}
        >
          <span className="text-[8px] tracking-[0.22em] uppercase text-muted">
            {t('marketplace.history_revenue_30d')}
          </span>
          <span
            className="text-[30px] font-semibold leading-none tabular-nums"
            style={{
              background: 'linear-gradient(100deg, var(--color-gold-light), var(--color-gold) 45%, var(--color-cyan))',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {revenue} <span className="text-[14px]">SUI</span>
          </span>
          <span className="text-[9px] tracking-[0.12em] uppercase text-muted">
            {t('marketplace.history_sales', { count: data?.total ?? 0 })}
          </span>
        </div>
        <RpcStale stale={view.stale} offline={view.error != null && view.data == null} />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted">
          <Store size={18} style={{ opacity: 0.15 }} />
          <span className="text-[9px] tracking-[0.2em] uppercase">
            {view.loading ? t('common.loading') : t('marketplace.no_sales_history')}
          </span>
        </div>
      ) : (
        <div className="flex flex-col border-t border-border">
          {/* Column header (house data-table language) */}
          <div className="grid grid-cols-[1.6fr_100px_120px_1fr] items-center gap-3 px-3 py-2 text-[8px] tracking-[0.16em] uppercase text-muted/70 shrink-0">
            <span>{t('marketplace.history_col_item')}</span>
            <span>{t('marketplace.history_col_date')}</span>
            <span className="text-right">{t('marketplace.history_col_price')}</span>
            <span>{t('marketplace.history_col_buyer')}</span>
          </div>
          {rows.map((r, idx) => {
            const p = present(r.template_id, r.category, r.item_id)
            return (
              <div
                key={`${r.item_id}-${r.sold_at_ms}`}
                className="grid grid-cols-[1.6fr_100px_120px_1fr] items-center gap-3 px-3 py-2 border-b border-border"
                style={{ background: idx % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <ItemImage id={p.icon} category={p.category} className="w-8 h-8 shrink-0" />
                  <span className="text-[11px] tracking-[0.06em] truncate" style={{ color: p.color }}>
                    {p.name}
                  </span>
                </div>
                <span className="text-[9px] tracking-[0.08em] uppercase text-muted">
                  {format_ago(r.sold_at_ms, lang)}
                </span>
                <span className="text-[11px] text-text text-right tabular-nums">
                  {format_mist_to_sui(BigInt(r.price_mist), 2)} SUI
                </span>
                <AddressName
                  address={r.buyer}
                  name={buyer_names[r.buyer]}
                  className="text-[10px] tracking-[0.06em] text-cyan truncate"
                />
              </div>
            )
          })}
          {has_more && (
            <button
              type="button"
              onClick={() => set_limit((l) => Math.min(l + PAGE, 200))}
              className="admin-tab mx-auto my-3 flex items-center gap-2"
            >
              {view.loading ? <Loader2 size={11} className="animate-spin" /> : t('marketplace.history_load_more')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
