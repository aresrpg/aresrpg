// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'

import type { KaresCopy } from './copy.ts'

/** One selection authorizes one transaction. Continuation always needs another explicit click. */
export const FinanceBatch = ({
  copy,
  count,
  index,
  select,
  disabled,
  selected,
  remaining,
}: Readonly<{
  copy: KaresCopy
  count: number
  index: number
  select: (index: number) => void
  disabled: boolean
  selected: ReactNode
  remaining: ReactNode
}>) =>
  count > 1 ? (
    <div className="space-y-2 text-[11px] leading-5" data-finance-batch="">
      <label className="flex items-center justify-between gap-3">
        <span>{copy.batch}</span>
        <select
          className="border border-white/10 bg-bg p-2"
          value={index}
          disabled={disabled}
          onChange={(event) => select(Number(event.target.value))}
        >
          {Array.from({ length: count }, (_, batch) => (
            <option key={batch} value={batch}>
              {batch + 1} / {count}
            </option>
          ))}
        </select>
      </label>
      <p>{copy.batch_note}</p>
      <p>
        {copy.batch_selected}: {selected}
      </p>
      <p>
        {copy.batch_remaining}: {remaining}
      </p>
    </div>
  ) : null
