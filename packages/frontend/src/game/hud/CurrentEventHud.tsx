// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppCopy } from '../../i18n/copy.ts'
import { PublicSaleCard } from '../../kares/PublicSaleCard.tsx'
import { useAppStore } from '../../store.ts'
import './current_event.css'
export const CurrentEventHud = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const signed_in = useAppStore((state) => !!state.session.wallet)
  if (!signed_in) return null
  return (
    <aside className="current-event-hud">
      <PublicSaleCard copy={copy} />
    </aside>
  )
}
