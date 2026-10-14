// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { NavigationRow } from '@aresrpg/ui'

export type FacetOption = Readonly<{
  value: string
  label: string
  count: number
  color?: string
  section?: string
  indent?: boolean
}>

export const FacetRail = ({
  all_label,
  options,
  selected,
  total,
  on_select,
  class_name = '',
}: Readonly<{
  all_label: string
  options: readonly FacetOption[]
  selected: string | null
  total: number
  on_select: (value: string | null) => void
  class_name?: string
}>) => (
  <aside
    className={`${class_name} min-h-0 overflow-y-auto border-r border-white/10 bg-surface py-3`}
    data-facet-rail=""
  >
    <NavigationRow
      className="aui-navigation-row--compact"
      selected={selected === null}
      onClick={() => on_select(null)}
      type="button"
    >
      <span>{all_label}</span>
      <span className="ml-auto tabular-nums opacity-55">{total}</span>
    </NavigationRow>
    {options.map(({ value, label, count, section, indent }) => (
      <div key={value}>
        {section && (
          <p className="mt-3 border-t border-white/7 px-3 pt-3 pb-1 text-[6px] tracking-[0.16em] text-[#4f5560] uppercase">
            {section}
          </p>
        )}
        <NavigationRow
          className={`aui-navigation-row--compact ${indent ? 'aui-navigation-row--nested' : ''}`}
          selected={selected === value}
          data-facet-option={value}
          onClick={() => on_select(value)}
          type="button"
        >
          <span className="truncate">{label}</span>
          <span className="ml-auto tabular-nums opacity-55">{count}</span>
        </NavigationRow>
      </div>
    ))}
  </aside>
)
