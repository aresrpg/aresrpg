// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// --- Helpers: New badge ---

const LS_KEY = 'templates_last_visit'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

// Stamp: read previous visit time, then immediately write current time
const last_visit = (() => {
  try {
    const v = localStorage.getItem(LS_KEY)
    localStorage.setItem(LS_KEY, String(Date.now()))
    return v ? Number(v) : 0
  } catch {
    return 0
  }
})()

export function is_new_template(created_at: number | string | undefined): boolean {
  if (!created_at) return false
  const ts = Number(created_at)
  const now = Date.now()
  // Only "new" if created less than 24h ago AND after user's last visit
  return now - ts < ONE_DAY_MS && ts > last_visit
}

export function EntityBadge({
  children,
  pulse = false,
  mob_tier,
}: Readonly<{
  children: ReactNode
  pulse?: boolean
  mob_tier?: string
}>) {
  return (
    <span className={`entity-badge${pulse ? ' animate-pulse' : ''}`} data-mob-tier={mob_tier}>
      {children}
    </span>
  )
}

export function NewBadge() {
  const { t } = useTranslation()
  return <EntityBadge pulse>{t('entity.new')}</EntityBadge>
}

export function ArchiBadge() {
  const { t } = useTranslation()
  return <EntityBadge mob_tier="archi">{t('encyclopedia.archi_badge')}</EntityBadge>
}
