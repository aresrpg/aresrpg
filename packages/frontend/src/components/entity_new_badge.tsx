// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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

export function NewBadge() {
  const { t } = useTranslation()
  return (
    <span
      className="px-1.5 py-0.5 text-[7px] tracking-[0.2em] uppercase font-semibold shrink-0 animate-pulse"
      style={{
        color: '#c8963c',
        background: 'rgba(200,150,60,0.12)',
        border: '1px solid rgba(200,150,60,0.35)',
        textShadow: '0 0 8px rgba(200,150,60,0.4)',
      }}
    >
      {t('entity.new')}
    </span>
  )
}
