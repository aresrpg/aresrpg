// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { useStore } from 'zustand'
import { submitted_posts } from '@aresrpg/immutable/allocation'

import { Entries } from '../../src/allocation/Entries.tsx'
import { Notices } from '../../src/allocation/Notices.tsx'
import { create_allocation_runtime } from '../../src/allocation/runtime.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import type { AuthSession } from '../../src/auth.ts'
import '../../src/tailwind.css'
import '../../src/allocation/allocation.css'
import '../../src/allocation/layout.css'

const copy = await load_app_copy('en')
const runtime = create_allocation_runtime()
runtime.store.setState({
  session: { address: '0x1', wallet_name: 'Slush' } as AuthSession,
  status: {
    phase: 'registration',
    submissions_open: true,
    wallets: [{ address: '0x1', label: 'Slush' }],
    awards: [],
    user: { id: '42', username: 'tester' },
    submission: null,
  },
})
const actions = {
  ...runtime,
  dispatch: (input: Parameters<typeof runtime.dispatch>[0]): void => {
    runtime.dispatch(input)
    if (input.type !== 'request' || input.task.kind !== 'submit') return
    const state = runtime.store.getState()
    const foreign = input.task.urls.some((url) => url.includes('/other/'))
    const submission = {
      user_id: '42',
      username: 'tester',
      address: input.task.address,
      posts: submitted_posts(input.task.urls),
      submitted_at: new Date(state.sequence * 1000).toISOString(),
    }
    runtime.dispatch({
      type: 'result',
      sequence: state.sequence,
      result: {
        session: state.session,
        status: foreign ? state.status : { ...state.status!, submission },
        share_intent_url: null,
        error: foreign ? 'foreign_post' : null,
      },
    })
  },
}
const Fixture = () => {
  const state = useStore(runtime.store)
  const text = copy_text(copy.allocation_page)
  return (
    <div className="allocation-root">
      <div style={{ height: 1200 }} />
      <main className="page">
        <Entries state={state} runtime={actions} text={text} open />
        <Notices state={state} runtime={actions} copy={copy} text={text} />
        <output aria-label="Saved posts">{state.status?.submission?.posts.join(',')}</output>
      </main>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
