import type { MouseEventHandler, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AddressName } from '../address_name'
import { ConfirmDialog } from '../../game/screens/hud/world/ConfirmDialog'

export function MarketplaceListingRow({
  seller_address,
  seller_name,
  item_name,
  price_label,
  quantity = 1,
  visual,
  own,
  armed,
  alternate = false,
  on_arm,
  on_confirm,
  on_cancel,
  on_mouse_enter,
  on_mouse_leave,
}: {
  seller_address: string
  seller_name?: string | null
  item_name: string
  price_label: string
  quantity?: number
  visual?: ReactNode
  own: boolean
  armed: boolean
  busy?: boolean
  alternate?: boolean
  on_arm: () => void
  on_confirm: () => void
  on_cancel: () => void
  on_mouse_enter?: MouseEventHandler<HTMLDivElement>
  on_mouse_leave?: MouseEventHandler<HTMLDivElement>
}) {
  const { t } = useTranslation()

  return (
    <div
      data-marketplace-listing-row
      className="border-b border-border transition-all"
      style={{ background: armed ? 'rgba(200,150,60,0.08)' : alternate ? 'rgba(255,255,255,0.018)' : 'transparent' }}
      onMouseEnter={on_mouse_enter}
      onMouseLeave={on_mouse_leave}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{ cursor: own ? 'default' : 'pointer' }}
        onClick={() => {
          if (!own) on_arm()
        }}
      >
        {visual}
        <div className="flex flex-col min-w-0 w-28 sm:w-36">
          <span className="text-[7px] tracking-[0.16em] uppercase text-muted/50">
            {t('marketplace.purchase.seller')}
          </span>
          <AddressName
            address={seller_address}
            name={seller_name}
            className="text-[9px] tracking-[0.08em] text-muted truncate"
          />
        </div>
        {quantity > 1 && <span className="text-[9px] text-muted tracking-widest shrink-0">×{quantity}</span>}
        <span className="flex-1 min-w-2" />
        <div className="flex flex-col items-end shrink-0">
          <span className="text-[7px] tracking-[0.16em] uppercase text-muted/50">
            {t('marketplace.purchase.price')}
          </span>
          <span className="text-cyan text-[10px] tracking-[0.08em] tabular-nums whitespace-nowrap">{price_label}</span>
        </div>
        <button
          data-marketplace-buy-button
          type="button"
          disabled={own}
          aria-expanded={armed}
          title={own ? (t('marketplace_sui.purchase.own_listing') as string) : undefined}
          onClick={(event) => {
            event.stopPropagation()
            if (!own) on_arm()
          }}
          className="btn-gold min-w-20 px-3 py-1.5 text-[9px] tracking-[0.18em] uppercase disabled:cursor-not-allowed disabled:opacity-35 shrink-0"
        >
          {t('marketplace.sui.buy')}
        </button>
      </div>

      {/* Clicking BUY opens the house confirm modal ("are you sure you want to buy X for X SUI"),
          never an inline strip. Reuses the shared ConfirmDialog — one modal system, gothic-terminal DNA. The
          tx target is untouched: on_confirm still fires the SAME buy handler the caller wired. */}
      <ConfirmDialog
        open={armed && !own}
        title={t('marketplace.purchase.confirm_title')}
        message={t('marketplace.purchase.confirm_message', { name: item_name, price: price_label })}
        confirm_label={`${t('marketplace.sui.buy')} · ${price_label}`}
        cancel_label={t('common.cancel')}
        on_confirm={on_confirm}
        on_cancel={on_cancel}
      />
    </div>
  )
}
