// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { WalletCards } from 'lucide-react'

import { env } from '../env.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { player_error_text } from '../i18n/player_error.ts'
import type { SessionState } from '../modules/session.ts'
import { useAppStore } from '../store.ts'

import { GoogleLoginButton } from './GoogleLoginButton.tsx'
import { WalletChoices, WalletPickerModal } from './WalletPickerModal.tsx'

/**
 * Whether the player is known to be signed out, so the game may ask for sign-in. While a remembered
 * session is being restored the answer is not known yet, and the restore is silent: nothing is asked.
 */
export const sign_in_asked = ({
  wallet,
  auth_status,
  auth_request,
}: Readonly<Pick<SessionState, 'wallet' | 'auth_status' | 'auth_request'>>): boolean =>
  !wallet && !(auth_status === 'connecting' && auth_request === 'restore')

const login_lead = (copy: AppCopy, gift: boolean): string =>
  gift ? copy_text(copy.airdrop_page)('gift_login') : copy.sign_in_to_play

export const Login = ({
  auth_ready,
  wallets,
  copy,
  show_wallets,
  set_show_wallets,
  login_google,
  login_wallet,
  gift,
}: Readonly<{
  auth_ready: boolean
  wallets: readonly string[]
  copy: AppCopy
  show_wallets: boolean
  set_show_wallets: (shown: boolean) => void
  login_google: () => void
  login_wallet: (name: string) => void
  gift: boolean
}>) => {
  const auth_status = useAppStore(({ session }) => session.auth_status)
  const error = useAppStore(({ session }) => session.auth_error)
  const loading = auth_status === 'connecting'

  return (
    <section className="absolute inset-0 z-[140] grid place-items-center bg-bg p-4" data-player-login>
      <div className="aui-panel flex w-full max-w-sm flex-col gap-4 p-5">
        <p className="text-sm leading-relaxed text-soft">{login_lead(copy, gift)}</p>
        <div className="flex flex-col gap-3">
          <GoogleLoginButton copy={copy} ready={auth_ready} loading={loading} login={login_google} />
          <div className="contents" hidden={gift}>
            {env.dev_sign_in && auth_ready && (
              <>
                <button className="aui-button" type="button" disabled={loading} onClick={() => set_show_wallets(true)}>
                  <WalletCards size={17} aria-hidden="true" />
                  <span>{copy.connect_wallet}</span>
                </button>
                {show_wallets && (
                  <WalletPickerModal
                    title={copy.connect_wallet}
                    close_label={copy.kares_page.close}
                    close={() => set_show_wallets(false)}
                  >
                    <WalletChoices
                      choices={wallets.map((name) => ({ name }))}
                      busy={loading}
                      select={(name) => {
                        set_show_wallets(false)
                        login_wallet(name)
                      }}
                      empty_label={copy.no_wallet}
                      select_label={copy.kares_page.select_wallet}
                    />
                  </WalletPickerModal>
                )}
              </>
            )}
          </div>
          {error && (
            <p className="text-center text-xs leading-relaxed text-[#ff7d7d]" role="alert">
              {player_error_text(copy, error)}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
