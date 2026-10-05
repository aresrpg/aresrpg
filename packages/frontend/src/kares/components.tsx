// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { error_text } from '../i18n/error_text.ts'

import type { KaresCopy } from './copy.ts'
import type { FinanceState } from './model.ts'

export const finance_label = 'text-[9px] tracking-[0.18em] text-muted uppercase'

export const finance_empty_message = (state: FinanceState, copy: KaresCopy): string =>
  state.request ? copy.loading : copy.staking_unavailable

const FinanceError = ({ state, copy }: Readonly<{ state: FinanceState; copy: KaresCopy }>) => (
  <>
    {state.error && !state.error.includes('is not configured') && (
      <p
        className="break-words border border-rose-400/25 bg-rose-400/5 p-3 text-[10px] leading-5 text-rose-200"
        role="alert"
      >
        {state.error === 'same_account' ? copy.same_account : error_text(copy, state.error)}
      </p>
    )}
  </>
)

export const FinanceStatus = ({ state, copy }: Readonly<{ state: FinanceState; copy: KaresCopy }>) => (
  <div aria-live="polite" className="space-y-3">
    <FinanceError state={state} copy={copy} />
  </div>
)
