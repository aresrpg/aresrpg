// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PET FEED — choose one owned resource, preview the Move-projected pet state, then submit one irreversible feed.
// Move owns the UTC-day/60-feed gates and stat curve; this modal only presents projected values and composes it.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'

import { PetPowerCard, pet_feed_is_available } from '../../../components/pet_power_card'
import { PetFoodHoverRow } from '../../../pages/encyclopedia/pet_food_section'
import { load_roster } from '../../../roster/load_roster.js'
import { use_toast } from '../../../toast'
import { feed_pet } from '../../../world-shell/feed_actions.js'
import { game_log } from '../../../core/log.js'
import { ItemCard } from './ItemCard.jsx'
import { ItemIcon } from './ItemIcon.jsx'

// House tokens with hard fallbacks — the modal portals to <body> (outside .game-tab), so a fallback guarantees
// the gothic-terminal gold look even if a scoped var doesn't resolve on the body node.
const T = {
  gold: 'var(--accent, #c8963c)',
  surface: 'var(--surface, #12121a)',
  bg: 'var(--bg, #0a0a0f)',
  fg: 'var(--fg, #e8e4dc)',
  muted: 'var(--fg-faint, #6b7280)',
  hair: 'var(--hair, rgba(255,255,255,0.08))',
  mono: 'var(--font-mono, "JetBrains Mono", ui-monospace, monospace)',
}

/**
 * The no-owned-food box must NAME what the pet eats, never just "you have none" — the
 * SAME global diet display the encyclopedia + inventory hover already show (D757: every pet eats the one
 * configured food set; never a fabricated per-species list). Pulled out of PetFeedModal (which always
 * portals to <body>) so it stays directly render-testable with plain renderToStaticMarkup.
 * @param {{ food_slugs: string[], t: (key: string) => string }} props
 */
export function PetFeedEmptyState({ food_slugs, t }) {
  return (
    <div
      style={{
        width: '100%',
        minHeight: 96,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 8,
        padding: '14px 12px',
        border: `1px dashed ${T.hair}`,
        color: T.muted,
        fontSize: 11,
        lineHeight: 1.5,
        letterSpacing: '0.04em',
      }}
    >
      <PetFoodHoverRow food_slugs={food_slugs} />
      <span style={{ textAlign: 'center' }}>{t('pet.no_food')}</span>
    </div>
  )
}

/**
 * @param {{ pet: any, foods?: any[], food_slugs?: string[], pet_max_stats?: Record<string, number>, character: any, onClose: () => void }} props
 * @returns {import('react').JSX.Element | null}
 */
export function PetFeedModal({ pet, foods = [], food_slugs = [], pet_max_stats, character, onClose }) {
  const { t } = useTranslation()
  const [food_id, set_food_id] = useState(foods[0]?.id ?? '')

  useEffect(() => {
    if (!foods.some((food) => food.id === food_id)) set_food_id(foods[0]?.id ?? '')
  }, [food_id, foods])

  useEffect(() => {
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [onClose])

  if (!pet || !character) return null

  const food = foods.find((candidate) => candidate.id === food_id) ?? null
  const can_feed =
    !!food &&
    !!(pet.template_id ?? pet.template) &&
    !!pet.kiosk_id &&
    !!pet.kiosk_cap_id &&
    pet_feed_is_available(pet)

  const on_confirm = () => {
    if (!can_feed) return
    const p = feed_pet({
      character_id: character.id,
      pet_item_id: pet.id,
      pet_template_id: pet.template_id ?? pet.template,
      food_item_id: food.id,
      kiosk_id: pet.kiosk_id,
      personal_kiosk_cap_id: pet.kiosk_cap_id,
    })
    use_toast
      .getState()
      .promise(p, {
        pending: t('pet.feeding', { pet: pet.name }),
        success: t('pet.fed'),
        error: t('pet.feed_failed'),
      })
      .then(() =>
        load_roster().catch((error) => {
          game_log('pet-feed', 'post-feed roster refresh failed', error)
        })
      )
      // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- toast.promise already surfaced the feed failure; this terminal handler only prevents an unhandled rejection
      .catch(() => {})
    onClose()
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(7,9,13,0.62)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 94vw)',
          background: T.surface,
          border: `1px solid ${T.gold}`,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          color: T.fg,
          fontFamily: T.mono,
        }}
      >
        {/* HEAD */}
        <header
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${T.hair}`,
            fontSize: 12,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: T.gold,
          }}
        >
          {t('pet.feed_title')}
        </header>

        {/* BODY — food → arrow → pet portrait (the cost is unmissable) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '18px 16px',
          }}
        >
          <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
            {food ? (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: T.muted }}>
                  {t('pet.select_food')}
                  <select
                    value={food_id}
                    onChange={(event) => set_food_id(event.target.value)}
                    style={{ background: T.bg, color: T.fg, border: `1px solid ${T.hair}`, padding: '6px 8px' }}
                  >
                    {foods.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} ×{candidate.amount ?? 1}
                      </option>
                    ))}
                  </select>
                </label>
                <ItemCard item={food} />
              </div>
            ) : (
              <PetFeedEmptyState food_slugs={food_slugs} t={t} />
            )}
          </div>

          <ArrowRight size={22} color={T.gold} aria-hidden="true" style={{ flex: 'none' }} />

          {/* PET PORTRAIT */}
          <div
            style={{
              flex: 'none',
              width: 116,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 84,
                height: 84,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: T.bg,
                border: `1px solid ${T.gold}`,
              }}
            >
              <ItemIcon
                item={{ icon: pet.icon ?? pet.item_type, id: pet.id, category: pet.item_category }}
                alt={pet.name}
                hd
                className="item-card__icon"
              />
            </div>
            <span style={{ fontSize: 12, color: T.fg, lineHeight: 1.3 }}>{pet.name}</span>
            {pet.level != null && (
              <span className="hud-num" style={{ fontSize: 10, color: T.muted, letterSpacing: '0.1em' }}>
                {t('entity.level_short', { level: pet.level })}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: '0 16px 14px' }}>
          <PetPowerCard pet={pet} pet_max_stats={pet_max_stats} />
        </div>

        {/* THE ASK + the unmissable burn cost */}
        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: T.fg, lineHeight: 1.5 }}>
            {food ? t('pet.confirm_line', { food: food.name, pet: pet.name }) : t('pet.no_food')}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>{t('pet.burns_warning')}</p>
        </div>

        {/* FOOT */}
        <footer
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '12px 16px',
            borderTop: `1px solid ${T.hair}`,
          }}
        >
          <button type="button" className="hud-btn" onClick={onClose}>
            {t('pet.cancel')}
          </button>
          <button type="button" className="hud-btn hud-btn--accent" onClick={on_confirm} disabled={!can_feed}>
            {t('pet.confirm')}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
