// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useRef } from 'react'

import type { AdminLogEntry } from './admin_state.ts'

const tone_class: Readonly<Record<AdminLogEntry['tone'], string>> = Object.freeze({
  info: 'text-[#7f8793]',
  success: 'text-[#62ce91]',
  error: 'text-[#ff789e]',
})

export const DeploymentTerminal = ({ entries }: Readonly<{ entries: readonly AdminLogEntry[] }>) => {
  const output = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = output.current
    if (element) element.scroll({ top: element.scrollHeight })
  }, [entries])

  return (
    <section className="mx-auto mt-6 max-w-6xl border border-white/9 bg-[#07080b]/85 shadow-[inset_0_1px_rgba(255,255,255,0.025)]">
      <header className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <span className="text-[8px] tracking-[0.2em] text-[#8d939d] uppercase">Deployment log</span>
        <span className="h-1.5 w-1.5 bg-[#62ce91] shadow-[0_0_9px_rgba(98,206,145,0.7)]" />
      </header>
      <div ref={output} className="h-44 overflow-y-auto px-4 py-3 font-mono text-[8px] leading-5">
        {entries.length ? (
          entries.map((entry) => (
            <div className={tone_class[entry.tone]} key={entry.id}>
              <span className="mr-3 text-white/18">{String(entry.id).padStart(3, '0')}</span>
              {entry.message}
            </div>
          ))
        ) : (
          <span className="text-white/22">Waiting for deployment activity.</span>
        )}
      </div>
    </section>
  )
}
