// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function TemplateUnavailableCard({ item_type }: { item_type: string }) {
  const { t } = useTranslation()
  return (
    <div
      data-marketplace-template-unavailable
      className="flex min-h-48 items-center justify-center border border-gold/25 px-6 py-10 text-center"
      style={{
        background:
          'linear-gradient(145deg, rgba(200,150,60,0.06) 0%, rgba(255,255,255,0.015) 45%, rgba(200,150,60,0.025) 100%)',
      }}
    >
      <div className="flex max-w-md flex-col items-center gap-3">
        <AlertTriangle size={18} className="text-gold/60" aria-hidden="true" />
        <span className="text-[9px] uppercase tracking-[0.14em] text-muted">
          {t('marketplace.template_unavailable', { type: item_type.replace(/[_-]+/g, ' ') })}
        </span>
      </div>
    </div>
  )
}
