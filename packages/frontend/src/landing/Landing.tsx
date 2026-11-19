// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Presentation only. It owns no route, store, reader or economics:
// the entry supplies copy, art, public links, on_play and agent_connect_url.
import { useEffect, useRef } from 'react'

import { KaresLogo } from '../components/KaresLogo.tsx'

import { start_landing_motion } from './landing_motion.ts'
import { AgentLink } from './landing_parts.tsx'
import { LandingPage } from './LandingPage.tsx'
import type { LandingProps } from './landing_types.ts'

import './landing.css'

export const Landing = ({ copy, assets, links, on_play, agent_connect_url, account }: LandingProps) => {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => (root.current ? start_landing_motion(root.current) : undefined), [])
  // The token has its own page: its figures and the staking desk. The dock opens it in place.
  const kares_trigger = (
    <AgentLink className="kares-dock" href={links.kares} on_play={on_play}>
      <KaresLogo size={24} />
      <span className="dock-name">{copy.kares.trigger}</span>
      <span className="dock-sub">{copy.kares.trigger_detail}</span>
    </AgentLink>
  )
  return (
    <LandingPage
      copy={copy}
      assets={assets}
      links={links}
      on_play={on_play}
      agent_connect_url={agent_connect_url}
      root_ref={root}
      kares_trigger={kares_trigger}
      account={account}
    />
  )
}
