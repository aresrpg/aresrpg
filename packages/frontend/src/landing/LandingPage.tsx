// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode, Ref } from 'react'

import { LandingAgent, LandingEarn, LandingEnd, LandingHero, LandingWorld } from './LandingSections.tsx'
import { LandingSurface } from './LandingSurface.tsx'
import type { LandingProps } from './landing_types.ts'

/** The same accepted presentation is rendered at build time and by the interactive entry. */
export const LandingPage = ({
  copy,
  assets,
  links,
  on_play,
  agent_connect_url,
  root_ref,
  kares_trigger,
  children,
}: Omit<LandingProps, 'tokenomics'> &
  Readonly<{
    root_ref?: Ref<HTMLDivElement>
    kares_trigger?: ReactNode
    children?: ReactNode
  }>) => (
  <div className="landing" ref={root_ref}>
    <LandingSurface assets={assets} />
    <div className="landing-flow" data-landing="flow">
      <LandingHero
        agent_connect_url={agent_connect_url}
        assets={assets}
        copy={copy}
        kares_trigger={kares_trigger}
        links={links}
        on_play={on_play}
      />
      <main>
        <LandingEarn assets={assets} copy={copy} links={links} />
        <LandingWorld assets={assets} copy={copy} />
        <LandingAgent assets={assets} copy={copy} />
        <LandingEnd copy={copy} links={links} on_play={on_play} />
      </main>
    </div>
    {children}
  </div>
)
