// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import type { AuthSession } from '../../src/auth.ts'
import { AutomationPanel } from '../../src/components/AutomationPanel.tsx'
import { FriendsPanel } from '../../src/components/FriendsPanel.tsx'
import { HackZoneUnlock } from '../../src/components/HackZoneUnlock.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app } from '../../src/store.ts'
import { character } from '../../test/modules/automation_fixture.ts'
import '../../src/tailwind.css'

const boot = async (): Promise<void> => {
  const copy = await load_app_copy('en')
  // UI/reducer fixture: there is no signer, chain transport, or armed transaction observer.
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/connected', session: { address: 'owner' } as AuthSession })
  dispatch_app({
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [character(), { ...character(), id: 'bob' }] },
  })
  dispatch_app({ type: 'character/select', character_id: 'alice' })
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/game_state', frozen: false } })
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/server_info',
      online: 1,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: Date.now(),
      chain_sample_age_ms: 0,
    },
  })
  createRoot(document.getElementById('root')!).render(
    <main className="fixed inset-0 bg-bg p-6 font-mono text-white">
      <nav className="absolute top-8 right-8 z-10 flex gap-4">
        <button onClick={() => dispatch_app({ type: 'page/open', page: 'leaderboard' })}>Leaderboard</button>
        <button onClick={() => dispatch_app({ type: 'page/open', page: 'world' })}>World</button>
        <button onClick={() => dispatch_app({ type: 'character/select', character_id: 'alice' })}>Alice</button>
        <button onClick={() => dispatch_app({ type: 'character/select', character_id: 'bob' })}>Bob</button>
      </nav>
      <div
        data-world-frame=""
        className="relative h-full overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(ellipse_at_70%_60%,#20493a,#141122_70%)] p-6"
      >
        <HackZoneUnlock copy={copy} enabled />
        <div className="flex w-fit flex-col items-start gap-2">
          <FriendsPanel copy={copy} />
          <AutomationPanel copy={copy} enabled />
        </div>
        <input aria-label="Chat" className="absolute bottom-6 left-6 border border-white/20 p-2" />
      </div>
    </main>
  )
}
void boot().catch(console.error)
