// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Bot } from 'lucide-react'

import { useSiteStore } from '../store.ts'

/** The mark of a hosted bot beside its name: the robot and the word the site uses for its AI page. */
export const AgentBadge = () => {
  const label = useSiteStore(({ copy }) => copy?.site.agent)
  return (
    <span className="mr-2 inline-flex h-5 items-center gap-1 rounded-[3px] border border-orange/45 bg-orange/10 px-1.5 align-[0.1em] font-mono text-[10px] leading-none font-bold tracking-[0.08em] text-orange uppercase">
      <Bot aria-hidden size={12} strokeWidth={2} />
      {label}
    </span>
  )
}
