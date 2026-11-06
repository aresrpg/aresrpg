// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import type { AuthSession } from '../../src/auth.ts'
import { AgentSetupDialog } from '../../src/agents/AgentSetup.tsx'
import { GoogleLoginButton } from '../../src/components/GoogleLoginButton.tsx'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import { dispatch_app, observe_app, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

// Public synthetic Google identity only. No auth, signing, proof submission or transfers.
const session = {
  address: '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f',
  identity: 'zklogin',
  wallet_name: 'Fixture',
  read_agent_pairing_request: (nonce: string) => ({
    version: 1,
    nonce,
    network: 'mainnet',
    owner: '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f',
    zklogin_public_identifier: 'G2h0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
  }),
} as AuthSession
const complete = () => {
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/connected', session })
}
const roster = () => dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
const Fixture = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const state = useAppStore((app) => app.session)
  const dialog = useAppStore((app) => app.navigation.dialog)
  return (
    <main className="min-h-screen bg-bg p-4 text-text">
      <p>Navigation and modal fixture. All authentication and transactions are disabled.</p>
      <output data-current-dialog="">{dialog ?? 'none'}</output>
      {!state.wallet && (
        <GoogleLoginButton
          copy={copy}
          ready={state.auth_ready}
          loading={state.auth_status === 'connecting'}
          login={() => dispatch_app({ type: 'auth/login_google' })}
        />
      )}
      {state.auth_status === 'connecting' && (
        <>
          <button onClick={complete}>Finish simulated login</button>
          <button onClick={() => dispatch_app({ type: 'auth/failed', error: 'Fixture cancelled' })}>
            Cancel simulated login
          </button>
        </>
      )}
      {state.wallet && (
        <button onClick={() => dispatch_app({ type: 'auth/disconnected' })}>Disconnect simulated session</button>
      )}
      <button
        onClick={() => {
          const url = new URL(location.href)
          url.searchParams.set('intent', 'connect-agent')
          history.pushState({ fixture: 'entry' }, '', url)
          dispatchEvent(new PopStateEvent('popstate'))
        }}
      >
        Open agent entry
      </button>
      <AgentSetupDialog copy={copy} />
    </main>
  )
}
void load_app_copy('en')
  .then((copy) => {
    document.documentElement.setAttribute('data-initial-history-length', String(history.length))
    history.replaceState({ fixture: 'initial' }, '', location.href)
    observe_app(['navigation'])
    dispatch_app({ type: 'auth/ready', wallets: [] })
    if (new URLSearchParams(location.search).has('signed_in')) complete()
    addEventListener('fixture/roster', roster)
    createRoot(document.getElementById('root')!).render(<Fixture copy={copy} />)
  })
  .catch(console.error)
