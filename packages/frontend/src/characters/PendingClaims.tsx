// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { claim_is_settleable } from '../modules/claims.ts'
import { dispatch_app, useAppStore } from '../store.ts'

export const PendingClaims = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const claims = useAppStore(({ session }) => session.claims)
  const ready = useAppStore(({ session }) => session.link_status === 'ready')
  const t = copy_text(copy.characters_page)
  if (!claims.length) return null
  return (
    <section className="flex flex-col gap-2 border border-border p-3" aria-label={t('claims_title')}>
      <p className="chr-eyebrow">{t('claims_title')}</p>
      {claims.map((claim) => (
        <div className="flex items-center justify-between gap-3 text-xs" key={claim.id}>
          <span>{t(claim.kind === 'box' ? 'claim_box' : 'claim_crush')}</span>
          <button
            className="btn-outline chr-btn"
            disabled={!ready || !claim_is_settleable(claim)}
            onClick={() => dispatch_app({ type: 'claims/redeem', claim_id: claim.id })}
            type="button"
          >
            {t('claim_collect')}
          </button>
        </div>
      ))}
    </section>
  )
}
