// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One sign-in for every interface: it sits in the page header, never inside a single flow.
// Google through Enoki is the only sign-in of the app. A local or edge build also lists the installed
// wallets under the same control, marked as a development tool (DECISIONS: SIGN-IN LIVES ON THE HOME PAGE).
import { ChevronDown, WalletCards } from 'lucide-react'
import { useId, useState } from 'react'
import { useStore } from 'zustand'

import { GoogleIcon } from '../components/GoogleLoginButton.tsx'
import { format_text } from '../i18n/copy.ts'

import type { LandingAccountRuntime } from './landing_account.ts'
import type { LandingCopy } from './landing_types.ts'

const short_address = (address: string): string => `${address.slice(0, 6)}...${address.slice(-4)}`

/** The development sign-in: Google first, then the installed wallets under a hint that they are not for play. */
const SignInMenu = ({
  auth,
  copy,
  names,
}: Readonly<{
  auth: LandingAccountRuntime
  copy: LandingCopy['account']
  names: () => Promise<readonly string[]>
}>) => {
  const id = useId()
  const [wallets, set_wallets] = useState<readonly string[]>([])
  const choose = (wallet: string | null, option: Readonly<HTMLElement>): void => {
    option.closest<HTMLElement>('[popover]')?.hidePopover()
    void auth.login(wallet)
  }
  return (
    <>
      <button
        className="landing-account"
        data-sign-in-menu=""
        onClick={() =>
          void names().then(set_wallets, (error: unknown) => console.error('The wallets could not be listed.', error))
        }
        onFocus={auth.warm}
        onPointerEnter={auth.warm}
        popoverTarget={id}
        type="button"
      >
        {copy.login}
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      <div className="landing-account-menu" id={id} popover="auto">
        <button onClick={(event) => choose(null, event.currentTarget)} type="button">
          <GoogleIcon />
          Google
        </button>
        {wallets.length > 0 && (
          <div>
            {wallets.map((name) => (
              <button key={name} onClick={(event) => choose(name, event.currentTarget)} type="button">
                <WalletCards aria-hidden="true" size={17} />
                {name}
              </button>
            ))}
            <p>{copy.dev_only}</p>
          </div>
        )}
      </div>
    </>
  )
}

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
      {auth.wallet_names && !pending ? (
        <SignInMenu auth={auth} copy={copy} names={auth.wallet_names} />
      ) : (
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
      )}
      {state.failed && (
        <p className="landing-account-error" role="alert">
          {copy.failed}
        </p>
      )}
    </>
  )
}
