// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId } from 'react'

import { Button } from './controls.tsx'
export type FilterOption = Readonly<{ id: string; label: string; count?: number; detail?: string }>
export const FilterMenu = ({
  title,
  options,
  value,
  choose,
  close_label,
}: Readonly<{
  title: string
  options: readonly FilterOption[]
  value?: string | null
  choose: (value: string) => void
  close_label: string
}>) => {
  const id = useId(),
    active = options.find((option) => option.id === value)
  return (
    <>
      <Button popoverTarget={id} aria-pressed={!!active} className="aui-filter-trigger">
        {active?.label ?? title}
        <span aria-hidden="true">⌄</span>
      </Button>
      <div id={id} popover="auto" className="aui-filter-menu">
        <header>
          <strong>{title}</strong>
          <Button popoverTarget={id} popoverTargetAction="hide" aria-label={close_label}>
            ×
          </Button>
        </header>
        <div className="aui-filter-options">
          {options.map((option) => (
            <Button
              key={option.id}
              data-filter-option={option.id}
              aria-pressed={option.id === value}
              onClick={(event) => {
                choose(option.id)
                event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
              }}
            >
              <span>
                {option.label}
                {option.detail && <small>{option.detail}</small>}
              </span>
              {option.count !== undefined && <small>{option.count}</small>}
            </Button>
          ))}
        </div>
      </div>
    </>
  )
}
