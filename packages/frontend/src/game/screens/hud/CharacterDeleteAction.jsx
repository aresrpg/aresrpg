// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useTranslation } from 'react-i18next'

import { Tooltip } from './Tooltip.jsx'

/**
 * Delete affordance for the Characters tab. The wrapper is intentional: native disabled buttons do not
 * reliably receive pointer or focus events, so a blocked action needs a separate accessible tooltip trigger
 * to expose its reason.
 * @param {{ busy: boolean, block_reason: string | null, on_delete: () => void }} props
 */
export function CharacterDeleteAction({ busy, block_reason, on_delete }) {
  const { t } = useTranslation()
  const label = block_reason ?? t('characters.delete.title', 'Delete character')

  return (
    <Tooltip text={label}>
      <span
        className="chrx-row__del-trigger"
        tabIndex={block_reason != null ? 0 : undefined}
        aria-label={block_reason ?? undefined}
      >
        <button
          type="button"
          className="chrx-row__del"
          aria-label={label}
          disabled={busy || block_reason != null}
          onClick={(event) => {
            event.stopPropagation()
            on_delete()
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
      </span>
    </Tooltip>
  )
}
