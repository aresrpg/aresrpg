// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'

import type { JsonValue } from './seed_editor.ts'

export const input_class =
  'h-8 border border-white/12 bg-[#090a10] px-2 text-[10px] text-[#e3dfd7] outline-none focus:border-[#4a9eff]/70 disabled:cursor-not-allowed disabled:opacity-45'

export const button_class =
  'h-7 cursor-pointer border border-white/12 bg-white/[0.025] px-2 text-[8px] tracking-[0.12em] text-[#8c919c] uppercase hover:border-[#c8963c]/50 hover:text-[#efbd45] disabled:cursor-not-allowed disabled:opacity-35'

export const as_record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

export const number_value = (value: JsonValue | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

export const string_value = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '')

export const titleize_field = (value: string): string =>
  value
    .replaceAll('_', ' ')
    .replace(/\b(?:ap|hp|mp|xp)\b/gi, (word) => word.toUpperCase())
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

export const SheetSection = ({
  title,
  note,
  children,
  accent = '#4a9eff',
}: Readonly<{ title: string; note?: string; children: ReactNode; accent?: string }>) => (
  <section className="border-t border-white/9 pt-4">
    <header className="mb-3 border-l-2 pl-3" style={{ borderColor: accent }}>
      <h2 className="text-[9px] font-semibold tracking-[0.18em] uppercase" style={{ color: accent }}>
        {title}
      </h2>
      {note && <p className="mt-1 text-[8px] text-[#686d77]">{note}</p>}
    </header>
    {children}
  </section>
)

export const FieldLabel = ({ label, hint }: Readonly<{ label: string; hint?: string }>) => (
  <span className="mb-1.5 block text-[7px] tracking-[0.13em] text-[#737883] uppercase">
    {label}
    {hint && <span className="ml-2 normal-case tracking-normal text-[#50545d]">{hint}</span>}
  </span>
)

export const TextField = ({
  label,
  value,
  change,
  disabled = false,
  width = 'w-52 max-w-full',
  hint,
}: Readonly<{
  label: string
  value: string
  change: (value: string) => void
  disabled?: boolean
  width?: string
  hint?: string
}>) => (
  <label className="block min-w-0">
    <FieldLabel hint={hint} label={label} />
    <input
      className={`${input_class} ${width}`}
      disabled={disabled}
      onChange={(event) => change(event.target.value)}
      spellCheck={false}
      value={value}
    />
  </label>
)

export const NumberField = ({
  label,
  value,
  change,
  disabled = false,
  width = 'w-20',
  hint,
  step = 1,
}: Readonly<{
  label: string
  value: number
  change: (value: number) => void
  disabled?: boolean
  width?: string
  hint?: string
  step?: number
}>) => (
  <label className="block">
    <FieldLabel hint={hint} label={label} />
    <input
      className={`${input_class} ${width} text-right tabular-nums`}
      disabled={disabled}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (Number.isFinite(next)) change(next)
      }}
      step={step}
      type="number"
      value={value}
    />
  </label>
)

export const SelectField = ({
  label,
  value,
  options,
  change,
  disabled = false,
  width = 'w-44',
}: Readonly<{
  label: string
  value: string
  options: readonly string[]
  change: (value: string) => void
  disabled?: boolean
  width?: string
}>) => (
  <label className="block">
    <FieldLabel label={label} />
    <select
      className={`${input_class} ${width}`}
      disabled={disabled}
      onChange={(event) => change(event.target.value)}
      value={value}
    >
      {!options.includes(value) && <option value={value}>{value || 'None'}</option>}
      {options.map((option) => (
        <option className="bg-[#090a10]" key={option} value={option}>
          {titleize_field(option) || 'None'}
        </option>
      ))}
    </select>
  </label>
)
