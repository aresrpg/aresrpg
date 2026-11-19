// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One sign-in for every interface: it sits in the page header, never inside a single flow.
// Google through Enoki is the only sign-in of the app; no wallet connection is offered here.
import { useStore } from 'zustand'

import { format_text } from '../i18n/copy.ts'

import type { LandingAccountRuntime } from './landing_account.ts'
import type { LandingCopy } from './landing_types.ts'

const short_address = (address: string): string => `${address.slice(0, 6)}...${address.slice(-4)}`

export const LandingAccount = ({
  auth,
  copy,
}: Readonly<{ auth: LandingAccountRuntime; copy: LandingCopy['account'] }>) => {
  const state = useStore(auth.store)
  if (state.status === 'signed_in' && state.address)
    return (
      <>
        <span
          className="landing-account"
          data-signed-in=""
          title={format_text(copy.signed_in, { address: state.address })}
        >
          <i aria-hidden="true" />
          <span className="aui-sr">{format_text(copy.signed_in, { address: short_address(state.address) })}</span>
          <span aria-hidden="true">{short_address(state.address)}</span>
        </span>
        <button className="landing-account" onClick={() => void auth.logout()} type="button">
          {copy.logout}
        </button>
      </>
    )
  const pending = state.status !== 'signed_out'
  return (
    <>
      <button
        aria-busy={pending || undefined}
        className="landing-account"
        disabled={pending}
        onClick={() => void auth.login()}
        onFocus={auth.warm}
        onPointerEnter={auth.warm}
        type="button"
      >
        {pending ? copy.logging_in : copy.login}
      </button>
      {state.failed && (
        <p className="landing-account-error" role="alert">
          {copy.failed}
        </p>
      )}
    </>
  )
}
