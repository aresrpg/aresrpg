// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useLayoutEffect, useRef, useState } from 'react'

import { BADGE_COLORS } from './presentation.ts'

type BadgeData = Readonly<{ key: string; identity: string; label: string; level: number; title: string }>

const Badge = ({ identity, label, level, title }: Omit<BadgeData, 'key'>) => {
  const [dark, light] = BADGE_COLORS[identity] ?? ['#7F8C8D', '#95A5A6']
  return (
    <span
      className="inline-flex shrink-0 items-center px-1.5 py-0.5 text-[9px] tracking-wide whitespace-nowrap uppercase"
      style={{
        background: `linear-gradient(135deg, ${dark}30, ${light}18)`,
        border: `1px solid ${light}40`,
        color: light,
      }}
      title={title}
    >
      <span className="opacity-70">{label}</span>
      <span className="mx-0.5 opacity-30">·</span>
      <b>{level}</b>
    </span>
  )
}

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
    <div className="relative flex min-w-0 items-center gap-1 overflow-hidden" ref={row} title={title} data-badge-row>
      {badges.slice(0, visible).map(({ key, ...badge }) => (
        <Badge {...badge} key={key} />
      ))}
      {total > visible && (
        <span className="shrink-0 text-[9px] text-muted" data-badge-overflow>
          +{total - visible}
        </span>
      )}
      <div className="pointer-events-none invisible absolute flex w-max gap-1" ref={measure_row} aria-hidden="true">
        {badges.map(({ key, ...badge }) => (
          <span className="inline-flex" data-badge key={key}>
            <Badge {...badge} />
          </span>
        ))}
        {Array.from({ length: badges.length + 1 }, (_, index) => (
          <span className="text-[9px]" data-count key={index}>
            +{total - index}
          </span>
        ))}
      </div>
    </div>
  )
}
