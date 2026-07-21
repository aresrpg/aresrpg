// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ItemSendMenuRow({
  on_send,
  disabled = false,
  title,
}: {
  on_send?: () => void
  disabled?: boolean
  title?: string
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="hud-btn"
      disabled={disabled}
      title={title}
      style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start' }}
      onClick={on_send}
    >
      <Send size={12} style={{ color: 'var(--accent, #c8963c)' }} />
      {t('gift.send.send_items')}
    </button>
  )
}
