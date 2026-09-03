// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SeedEditorState } from './editor_state.ts'

export type ValidationKind = 'reds' | 'warns' | null
type ValidationReport = NonNullable<SeedEditorState['validation']>

const Counter = ({
  active,
  count,
  kind,
  select,
}: Readonly<{
  active: ValidationKind
  count: number
  kind: Exclude<ValidationKind, null>
  select: (kind: ValidationKind) => void
}>) => {
  if (count === 0) return null
  const red = kind === 'reds'
  return (
    <button
      aria-expanded={active === kind}
      className={`${red ? 'text-[#ff8caa]' : 'text-[#ffca57]'} cursor-pointer border-b border-current/35 pb-0.5 hover:brightness-125`}
      data-validation-toggle={kind}
      onClick={() => select(active === kind ? null : kind)}
      title={`Show ${red ? 'errors' : 'warnings'}`}
      type="button"
    >
      {count} {red ? 'red' : 'warn'}
    </button>
  )
}

export const ValidationCounters = ({
  active,
  report,
  select,
}: Readonly<{
  active: ValidationKind
  report: ValidationReport | null
  select: (kind: ValidationKind) => void
}>) => {
  if (!report || (report.reds.length === 0 && report.warns.length === 0)) return null
  return (
    <div className="flex items-center gap-2 text-[8px] tracking-[0.12em] uppercase">
      <Counter active={active} count={report.reds.length} kind="reds" select={select} />
      <Counter active={active} count={report.warns.length} kind="warns" select={select} />
    </div>
  )
}

export const ValidationPanel = ({
  active,
  error,
  report,
}: Readonly<{ active: ValidationKind; error: string | null; report: ValidationReport | null }>) => {
  if (error)
    return (
      <div className="h-full overflow-y-auto whitespace-pre-wrap border border-[#ff5a8b]/30 bg-[#ff5a8b]/6 p-3 text-[9px] leading-5 text-[#ff8caa]">
        {error}
      </div>
    )
  if (!active || !report) return null
  const red = active === 'reds'
  return (
    <div
      className={`${red ? 'border-[#ff5a8b]/30 bg-[#ff5a8b]/6 text-[#ff8caa]' : 'border-[#ffca57]/25 bg-[#ffca57]/5 text-[#e5be68]'} h-full overflow-y-auto border px-3 py-2 text-[8px] leading-4`}
      data-validation-panel={active}
    >
      {report[active].map((message) => (
        <p className="whitespace-pre-wrap" key={message}>
          {message}
        </p>
      ))}
    </div>
  )
}
