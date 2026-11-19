// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, type ReactNode, type Ref } from 'react'

import { LandingChooser } from './LandingChooser.tsx'
import { LandingBackdrop, LandingControl, LandingEarn, LandingEnd, LandingHero } from './LandingSections.tsx'
import type { InterfaceId, LandingProps } from './landing_types.ts'

/** The same presentation is rendered at build time and by the interactive entry. One selection drives the page. */
export const LandingPage = ({
  copy,
  assets,
  links,
  on_play,
  agent_connect_url,
  root_ref,
  kares_trigger,
  account,
  children,
}: LandingProps &
  Readonly<{
    root_ref?: Ref<HTMLDivElement>
    kares_trigger?: ReactNode
    children?: ReactNode
  }>) => {
  const [selected, on_select] = useState<InterfaceId>('world')
  return (
    <div className="landing" ref={root_ref}>
      <div className="landing-flow">
        <LandingBackdrop assets={assets} />
        <LandingHero
          assets={assets}
          copy={copy}
          account={account}
          kares_trigger={kares_trigger}
          links={links}
          on_play={on_play}
          on_select={on_select}
          selected={selected}
        />
        <main>
          <LandingChooser
            agent_connect_url={agent_connect_url}
            assets={assets}
            copy={copy}
            links={links}
            on_play={on_play}
            on_select={on_select}
            selected={selected}
          />
          <LandingEarn assets={assets} copy={copy} links={links} />
          <LandingControl copy={copy} />
          <LandingEnd
            agent_connect_url={agent_connect_url}
            copy={copy}
            links={links}
            on_play={on_play}
            selected={selected}
          />
        </main>
      </div>
      {children}
    </div>
  )
}
