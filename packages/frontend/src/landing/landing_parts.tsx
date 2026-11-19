// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Small pieces shared by every landing section.
import type { ReactNode } from 'react'

import { is_plain_click } from '../components/links.tsx'

import type { InterfaceId, LandingCopy } from './landing_types.ts'

export type Copy = Readonly<{ copy: LandingCopy }>
export type Play = (url?: string) => void

/** The shared @aresrpg/ui button material by class: this presentation is also rendered by the build config,
 * which cannot load the package's stylesheet entry. */
export const CTA = 'aui-button cta'
export const CTA_PRIMARY = 'aui-button aui-button--primary cta'
export const CHOOSER_ID = 'landing-interfaces'

export const PlayIcon = () => (
  <svg aria-hidden="true" height="18" viewBox="0 0 20 20" width="18">
    <path d="M5 3h3v2h3v2h3v2h2v2h-2v2h-3v2H8v2H5z" fill="currentColor" />
  </svg>
)
export const EyeIcon = () => (
  <svg aria-hidden="true" height="20" viewBox="0 0 20 20" width="20">
    <path d="M1 9h2V7h2V5h10v2h2v2h2v2h-2v2h-2v2H5v-2H3v-2H1z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 8h4v4H8z" fill="currentColor" />
  </svg>
)

const AGENT_RAYS = [
  '22.2 12',
  '18.03 16.62',
  '14.66 21.85',
  '12 19.6',
  '5.8 20.1',
  '4.66 13.98',
  '1.8 12',
  '5.97 7.38',
  '9.34 2.15',
  '12 4.4',
  '18.2 3.9',
  '19.34 10.02',
] as const

/** One mark per interface; the colour comes from the nearest `--hue`. */
export const InterfaceIcon = ({ id }: Readonly<{ id: InterfaceId }>) => {
  switch (id) {
    case 'world':
      return (
        <svg fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M3 2.5 21.5 8 8.5 21.5z" />
          <path d="M12.2 5.2 15 14.8 5.8 12z" />
          <path
            d="M7.6 3.9 8.9 8.6 4.4 7.3zM16.7 6.6 18.2 11.4 13.6 10zM10.4 13.4 11.8 18.1 7.2 16.7z"
            strokeWidth="1"
          />
        </svg>
      )
    case 'dapp':
      return (
        <svg fill="currentColor" shapeRendering="crispEdges" viewBox="0 0 24 24">
          <path d="M3 4h18v4H3zM3 10h10v4H3zM15 10h6v10h-6zM3 16h10v4H3z" />
        </svg>
      )
    case 'agent':
      return (
        <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
          {AGENT_RAYS.map((end) => (
            <path d={`M12 12L${end}`} key={end} />
          ))}
        </svg>
      )
    case 'telegram':
      return (
        <svg fill="currentColor" viewBox="0 0 24 24">
          <path d="M21.6 3.6 2.9 10.9c-1 .4-1 1.1-.1 1.4l4.7 1.5 1.8 5.6c.2.6.5.8 1 .8.4 0 .6-.2.9-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8L23 5.2c.3-1.3-.5-1.9-1.4-1.6zM8.6 13.6l9.5-6c.4-.3.8-.1.5.2l-7.8 7.1-.3 3.3z" />
        </svg>
      )
    case 'sdk':
      return (
        <svg fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="2.2" viewBox="0 0 24 24">
          <path d="M8 6 2.5 12 8 18M16 6l5.5 6-5.5 6M13.8 4.5l-3.6 15" />
        </svg>
      )
  }
}

/** Who makes the moves. The SDK is whatever its builder makes of it, so it carries no badge. */
export const INTERFACE_PLAY: Readonly<Record<InterfaceId, 'manual' | 'automated' | null>> = {
  world: 'manual',
  dapp: 'automated',
  agent: 'automated',
  telegram: 'automated',
  sdk: null,
}

/** Open interfaces glow green; announced ones carry the bone dot. */
export const INTERFACE_STATE: Readonly<Record<InterfaceId, 'open' | 'soon' | 'plain'>> = {
  world: 'open',
  dapp: 'soon',
  agent: 'soon',
  telegram: 'soon',
  sdk: 'plain',
}

export const SectionRule = ({ index, label }: Readonly<{ index: string; label: string }>) => (
  <div aria-hidden="true" className="rule">
    <span className="rule-n">{index}</span>
    <span>{label}</span>
    <span className="rule-l" />
  </div>
)

/** Play on the agent path enters the game with the connect intent; modified clicks keep native link behaviour. */
export const AgentLink = ({
  href,
  on_play,
  className,
  data_hue,
  children,
}: Readonly<{ href: string; on_play: Play; className: string; data_hue?: string; children: ReactNode }>) => (
  <a
    className={className}
    data-hue={data_hue}
    href={href}
    onClick={(event) => {
      if (!is_plain_click(event)) return
      event.preventDefault()
      on_play(href)
    }}
  >
    {children}
  </a>
)
