// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

export function DetailLoading() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center gap-2 py-8">
      <Loader2 size={14} className="animate-spin text-gold opacity-40" />
      <span className="text-[9px] tracking-[0.2em] uppercase text-muted animate-pulse">
        {t('encyclopedia.loading_details')}
      </span>
    </div>
  )
}
