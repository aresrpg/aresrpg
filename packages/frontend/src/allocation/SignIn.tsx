// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'

import type { CopyText } from '../i18n/copy.ts'

import type { AllocationRuntime } from './runtime.ts'

export const SignIn = ({
  runtime,
  text,
  busy,
  wallets,
  google_label,
  wallet_label,
}: Readonly<{
  runtime: AllocationRuntime
  text: CopyText
  busy: boolean
  wallets: readonly string[]
  google_label: string
  wallet_label: string
}>) => {
  const [expanded, set_expanded] = useState(false)
  return (
    <section className="login-gate">
      <h1>{text('login_title')}</h1>
      <p>{text('login_note')}</p>
      <div className="link-buttons">
        <button
          className="btn btn-google"
          disabled={busy}
          onClick={() => runtime.dispatch({ type: 'request', task: { kind: 'google' } })}
        >
          <span className="g">G</span>
          {google_label}
        </button>
        <button
          className="btn btn-ink"
          disabled={busy}
          aria-expanded={expanded}
          onClick={() => set_expanded(!expanded)}
        >
          {wallet_label}
        </button>
      </div>
      {expanded && (
        <div className="choices" role="group" aria-label={wallet_label}>
          {wallets.map((name) => (
            <button
              className="btn"
              key={name}
              disabled={busy}
              onClick={() => runtime.dispatch({ type: 'request', task: { kind: 'wallet', name } })}
            >
              {name}
            </button>
          ))}
          {!wallets.length && <p>{text('no_wallet_app')}</p>}
          <p className="xp-fine">{text('signature_note')}</p>
        </div>
      )}
    </section>
  )
}
