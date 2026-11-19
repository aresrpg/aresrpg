// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useId, type ComponentProps, type ReactNode } from 'react'

type ButtonProps = Readonly<ComponentProps<'button'> & { tone?: 'primary' | 'neutral' | 'danger'; busy?: boolean }>

export const Button = ({
  tone = 'neutral',
  busy = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) => (
  <button
    {...props}
    type={props.type ?? 'button'}
    disabled={disabled || busy}
    aria-busy={busy || undefined}
    className={`aui-button aui-button--${tone} ${className}`}
  >
    {busy && <span className="aui-spinner" aria-hidden="true" />}
    {children}
  </button>
)

export const KeyHint = ({ children }: Readonly<{ children: ReactNode }>) => <kbd className="aui-key">{children}</kbd>

/** Compact navigation keeps native button semantics without action-button chrome. */
export const NavigationRow = ({
  selected = false,
  className = '',
  ...props
}: Readonly<ComponentProps<'button'> & { selected?: boolean }>) => (
  <button
    {...props}
    type={props.type ?? 'button'}
    aria-pressed={selected}
    className={`aui-navigation-row ${className}`}
  />
)

export const IconButton = ({
  label,
  icon,
  hotkey,
  className = '',
  ...props
}: Omit<ButtonProps, 'children'> & Readonly<{ label: string; icon: ReactNode; hotkey?: string }>) => (
  <Button {...props} className={`aui-icon-button ${className}`} aria-label={label} title={props.title ?? label}>
    {icon}
    {hotkey && <KeyHint>{hotkey}</KeyHint>}
  </Button>
)

/** A selection group uses native buttons, so all options work with keyboard and touch. */
export const SegmentedControl = <T extends string>({
  label,
  options,
  value,
  on_change,
}: Readonly<{
  label: string
  options: readonly Readonly<{ value: T; label: string; icon?: ReactNode }>[]
  value: T
  on_change: (value: T) => void
}>) => (
  <div className="aui-segments" role="group" aria-label={label}>
    {options.map((option) => (
      <Button key={option.value} aria-pressed={value === option.value} onClick={() => on_change(option.value)}>
        {option.icon}
        {option.label}
      </Button>
    ))}
  </div>
)

export const Toggle = ({
  label,
  checked,
  on_change,
  disabled = false,
}: Readonly<{
  label: string
  checked: boolean
  on_change: (checked: boolean) => void
  disabled?: boolean
}>) => (
  <label className="aui-toggle" title={label}>
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => on_change(event.target.checked)}
    />
    <span className="aui-toggle-track" aria-hidden="true" />
    <span>{label}</span>
  </label>
)

export const Field = ({ label, error, children }: Readonly<{ label: string; error?: string; children: ReactNode }>) => (
  <label className="aui-field">
    <span>{label}</span>
    {children}
    {error && (
      <span className="aui-error" role="alert">
        {error}
      </span>
    )}
  </label>
)

export const Select = ({
  label,
  options,
  ...props
}: Readonly<
  Omit<ComponentProps<'select'>, 'children'> & {
    label: string
    options: readonly Readonly<{ value: string; label: string }>[]
  }
>) => (
  <Field label={label}>
    <select {...props} className={`aui-input ${props.className ?? ''}`}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </Field>
)

export const Slider = ({
  label,
  value,
  on_change,
  min = 0,
  max = 100,
  step = 1,
}: Readonly<{
  label: string
  value: number
  on_change: (value: number) => void
  min?: number
  max?: number
  step?: number
}>) => {
  const id = useId()
  return (
    <label className="aui-field" htmlFor={id}>
      <span>
        {label}
        <output htmlFor={id}>{value}</output>
      </span>
      <input
        id={id}
        className="aui-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => on_change(Number(event.target.value))}
      />
    </label>
  )
}
