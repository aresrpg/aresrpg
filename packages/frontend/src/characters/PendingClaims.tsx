// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { claim_is_settleable } from '../modules/claims.ts'
import { dispatch_app, useAppStore } from '../store.ts'

export const PendingClaims = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const claims = useAppStore(({ session }) => session.claims)
  const failures = useAppStore(({ claim_failures }) => claim_failures)
  const ready = useAppStore(({ session }) => session.link_status === 'ready')
  const t = copy_text(copy.characters_page)
  const failed = claims.filter(({ id }) => failures.includes(id))
  if (!failed.length) return null
  return (
    <section className="flex flex-col gap-2 border border-border p-3" aria-label={t('claims_title')}>
      <p className="chr-eyebrow">{t('claims_title')}</p>
      {(['box', 'crush'] as const).flatMap((kind) => {
        const group = failed.filter((claim) => claim.kind === kind)
        const [claim] = group
        return claim
          ? [
              <div className="flex items-center justify-between gap-3 text-xs" key={kind}>
                <span>
                  {t(kind === 'box' ? 'claim_box' : 'claim_crush')} ×{group.length}
                </span>
                <button
                  className="btn-outline chr-btn"
                  disabled={!ready || !claim_is_settleable(claim)}
                  onClick={() => dispatch_app({ type: 'claims/redeem', claim_id: claim.id })}
                  type="button"
                >
                  {t('claim_collect')}
                </button>
              </div>,
            ]
          : []
      })}
    </section>
  )
}
