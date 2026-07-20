import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { CheckCircle2 } from 'lucide-react'
import { slugs } from 'virtual:item_catalog'

import { play_fight_sfx } from '../game/core/audio/sfx.js'
import { cosmetic_icon_of } from '../game/cosmetic_icons.js'

import { ItemImage } from './items'

// Celebration modal shown after a SUCCESSFUL shop purchase. Restores the pre-#50 shop's bought-modal shape
// (green checkmark + gradient title + item preview + CTA), plays the app's existing success cue, and offers a
// jump straight to the player's inventory. Player copy only — no chain jargon here.
export function ShopSuccessModal({
  item_name,
  item_id,
  appearance,
  on_view_inventory,
  on_close,
}: {
  item_name: string
  item_id: string
  appearance?: string
  on_view_inventory: () => void
  on_close: () => void
}) {
  const { t } = useTranslation()
  const template_slug = slugs[item_name]
  const icon_slug = cosmetic_icon_of({ slug: template_slug, name: item_name }) ?? template_slug ?? ''

  // The app's existing success sfx (ascending arpeggio — same cue as a won fight). See core/audio/sfx.js.
  useEffect(() => {
    play_fight_sfx('win')
  }, [])

  // Escape-to-close + lock body scroll while open (mirrors the original modal's Backdrop behaviour).
  useEffect(() => {
    const on_key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', on_key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', on_key)
      document.body.style.overflow = prev
    }
  }, [on_close])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) on_close()
      }}
    >
      <div
        className="bg-surface w-full max-w-md mx-4"
        style={{
          animation: 'modal-enter 0.3s ease-out',
          border: '1px solid var(--color-border)',
          borderImage: 'linear-gradient(135deg, #34d399, #059669, #6ee7b7) 1',
          boxShadow: '0 0 30px rgba(52,211,153,0.12), inset 0 0 30px rgba(52,211,153,0.03)',
        }}
      >
        <div className="flex flex-col items-center px-8 py-8 gap-5">
          <CheckCircle2
            size={36}
            style={{
              filter: 'drop-shadow(0 0 12px rgba(52,211,153,0.5))',
              animation: 'glow-pulse 3s ease-in-out infinite',
              color: '#34d399',
            }}
          />
          <div
            className="text-[13px] font-semibold tracking-[0.3em] uppercase text-center"
            style={{
              background: 'linear-gradient(135deg, #6ee7b7 0%, #34d399 50%, #a7f3d0 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {t('purchase.acquisition_complete')}
          </div>

          <div className="w-full h-px bg-border" />

          <div className="flex items-center gap-3" data-item-template={item_id}>
            <ItemImage id={icon_slug} appearance={appearance} className="w-12 h-12 object-contain shrink-0" />
            <span className="text-gradient text-[12px] tracking-[0.2em] uppercase font-semibold">{item_name}</span>
          </div>

          <div className="text-text/70 text-[10px] tracking-wide text-center leading-relaxed">
            {t('shop.purchase_success_body')}
          </div>

          <div className="flex gap-3 w-full mt-2">
            <button
              type="button"
              className="btn-gold flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
              onClick={on_view_inventory}
            >
              {t('shop.see_inventory')}
            </button>
            <button
              type="button"
              className="btn-outline flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
              onClick={on_close}
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
