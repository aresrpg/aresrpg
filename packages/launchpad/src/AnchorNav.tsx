// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useReducer } from 'react'
import { ChartNoAxesCombined, Coins, Gamepad2, Gift, Sparkles } from 'lucide-react'
import type { KaresCopy } from '@aresrpg/frontend/finance'

const sections = [
  { id: 'funding', key: 'nav_funding', Icon: ChartNoAxesCombined },
  { id: 'benefits', key: 'nav_benefits', Icon: Sparkles },
  { id: 'tokenomics', key: 'nav_tokenomics', Icon: Coins },
  { id: 'incentives', key: 'nav_incentives', Icon: Gift },
  { id: 'play', key: 'nav_play', Icon: Gamepad2 },
] as const

type Anchor = (typeof sections)[number]['id']
const is_anchor = (id: string): id is Anchor => sections.some((section) => section.id === id)

export const AnchorNav = ({ copy }: Readonly<{ copy: KaresCopy }>) => {
  const [active, dispatch] = useReducer((_active: Anchor, next: Anchor) => next, 'funding')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const [current] = entries
          .filter((entry) => entry.isIntersecting)
          .toSorted((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top))
        if (current && is_anchor(current.target.id)) dispatch(current.target.id)
      },
      { rootMargin: '-15% 0px -65% 0px' }
    )
    sections.forEach(({ id }) => {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    })
    return () => observer.disconnect()
  }, [])
  return (
    <nav
      aria-label={copy.nav_benefits}
      className="launch-anchors sticky top-0 z-30 -mx-5 flex gap-1 overflow-x-auto border-b border-white/10 bg-bg/95 px-5 py-2 backdrop-blur-xl sm:-mx-9 sm:px-9 xl:fixed xl:inset-x-auto xl:left-3 xl:top-1/2 xl:m-0 xl:w-32 xl:-translate-y-1/2 xl:flex-col xl:overflow-visible xl:border xl:border-white/10 xl:bg-surface-low/90 xl:p-1 2xl:left-4 2xl:w-36"
      data-launch-anchors=""
    >
      {sections.map(({ id, key, Icon }) => (
        <a
          aria-current={active === id ? 'location' : undefined}
          aria-label={copy[key]}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 border px-3 py-2 text-[9px] tracking-wider transition xl:justify-start xl:px-2 ${active === id ? 'border-gold/35 bg-gold/10 text-gold' : 'border-transparent text-muted hover:bg-white/5 hover:text-text'}`}
          href={`#${id}`}
          key={id}
          onClick={() => dispatch(id)}
          title={copy[key]}
        >
          <Icon size={14} />
          <span className="text-left">{copy[key]}</span>
        </a>
      ))}
    </nav>
  )
}
