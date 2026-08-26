// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

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
    <button
      className={`flex w-full items-center justify-between border-l-2 px-3 py-2 text-left text-[8px] uppercase ${
        selected === null
          ? 'border-[#c8963c] bg-[#c8963c]/7 text-[#efbd45]'
          : 'border-transparent text-[#858b98] hover:bg-white/[0.045] hover:text-[#e6e2da]'
      }`}
      onClick={() => on_select(null)}
      type="button"
    >
      <span>{all_label}</span>
      <span className="tabular-nums opacity-55">{total}</span>
    </button>
    {options.map(({ value, label, count, color, section, indent }) => (
      <div key={value}>
        {section && (
          <p className="mt-3 border-t border-white/7 px-3 pt-3 pb-1 text-[6px] tracking-[0.16em] text-[#4f5560] uppercase">
            {section}
          </p>
        )}
        <button
          className={`flex w-full items-center justify-between border-l-2 py-2 pr-3 text-left text-[8px] uppercase ${
            indent ? 'pl-6' : 'pl-3'
          } ${
            selected === value
              ? 'bg-white/[0.035] text-[#e8e4dc]'
              : 'border-transparent text-[#858b98] hover:bg-white/[0.045] hover:text-[#e6e2da]'
          }`}
          data-facet-option={value}
          onClick={() => on_select(value)}
          style={selected === value ? { borderColor: color ?? '#777b86' } : undefined}
          type="button"
        >
          <span className="truncate">{label}</span>
          <span className="tabular-nums opacity-55">{count}</span>
        </button>
      </div>
    ))}
  </aside>
)
