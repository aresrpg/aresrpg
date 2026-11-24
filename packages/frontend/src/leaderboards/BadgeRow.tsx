// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useLayoutEffect, useRef, useState } from 'react'

type BadgeData = Readonly<{ key: string; label: string; level: number; title: string }>

/** A class or a profession and its level, in a hairline frame. */
const Badge = ({ label, level, title }: Omit<BadgeData, 'key'>) => (
  <span
    className="inline-flex h-5 shrink-0 items-center gap-1.25 rounded-[3px] border border-hair px-1.5 text-[11px] font-semibold whitespace-nowrap text-muted capitalize"
    title={title}
  >
    {label}
    <b className="font-mono font-medium text-soft">{level}</b>
  </span>
)

/** Measure the actual translated badges and reserve exactly the space needed by +X. */
export const BadgeRow = ({
  badges,
  total,
  title,
}: Readonly<{ badges: readonly BadgeData[]; total: number; title: string }>) => {
  const row = useRef<HTMLDivElement>(null)
  const measure_row = useRef<HTMLDivElement>(null)
  const [visible, set_visible] = useState(0)
  useLayoutEffect(() => {
    const container = row.current!
    const measures = measure_row.current!
    const measure = () => {
      const widths = Array.from(
        measures.querySelectorAll('[data-badge]'),
        (element) => element.getBoundingClientRect().width
      )
      const counters = Array.from(
        measures.querySelectorAll('[data-count]'),
        (element) => element.getBoundingClientRect().width
      )
      const gap = parseFloat(getComputedStyle(container).columnGap)
      let used = 0
      let count = 0
      widths.forEach((width, index) => {
        used += width + (index > 0 ? gap : 0)
        const remaining = total > index + 1 ? gap + counters[index + 1]! : 0
        if (used + remaining <= container.clientWidth) count = index + 1
      })
      set_visible(count)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(measures)
    measure()
    return () => observer.disconnect()
  }, [badges, total])
  return (
    <div
      className="relative flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
      ref={row}
      title={title}
      data-badge-row
    >
      {badges.slice(0, visible).map(({ key, ...badge }) => (
        <Badge {...badge} key={key} />
      ))}
      {total > visible && (
        <span className="shrink-0 font-mono text-[11px] text-faint" data-badge-overflow>
          +{total - visible}
        </span>
      )}
      <div className="pointer-events-none invisible absolute flex w-max gap-1.5" ref={measure_row} aria-hidden="true">
        {badges.map(({ key, ...badge }) => (
          <span className="inline-flex" data-badge key={key}>
            <Badge {...badge} />
          </span>
        ))}
        {Array.from({ length: badges.length + 1 }, (_, index) => (
          <span className="font-mono text-[11px]" data-count key={index}>
            +{total - index}
          </span>
        ))}
      </div>
    </div>
  )
}
