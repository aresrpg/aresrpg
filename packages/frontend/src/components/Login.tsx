// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { ArrowRight, WalletCards } from 'lucide-react'

import { MainMenu } from '../menu/MainMenu.tsx'
import { demo_played } from '../adventure/visit.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { player_error_text } from '../i18n/player_error.ts'
import { useAppStore } from '../store.ts'

import { WalletChoices, WalletPickerModal } from './WalletPickerModal.tsx'

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285f4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34a853"
    />
    <path
      d="M5.84 14.09a6.5 6.5 0 0 1 0-4.18V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#fbbc05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      fill="#ea4335"
    />
  </svg>
)

const returned_from_adventure = (): boolean =>
  new URLSearchParams(globalThis.location?.search ?? '').get('from') === 'gobadoc'

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
  const [played] = useState(() => demo_played() || returned_from_adventure())

  return (
    <MainMenu copy={copy} first_visit={!gift && !played}>
      <section data-player-login className="main-menu-login">
        {gift && <p className="mb-4 text-sm">{login_lead(copy, gift)}</p>}
        <div className="main-menu-actions">
          <button className="main-menu-google" disabled={!auth_ready || loading} onClick={login_google}>
            <GoogleIcon />
            <span>{loading ? copy.loading_universe : copy.continue_google}</span>
            <ArrowRight size={17} aria-hidden="true" />
          </button>
          <div className="contents" hidden={gift}>
            {import.meta.env.DEV && auth_ready && (
              <>
                <button
                  className="main-menu-wallet"
                  type="button"
                  disabled={loading}
                  onClick={() => set_show_wallets(true)}
                >
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
                      choices={wallets}
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
            {played && !gift && (
              <a className="main-menu-replay" href="/play-demo">
                {copy.replay_demo}
              </a>
            )}
          </div>
          {error && (
            <div className="text-center text-[10px] leading-6 text-[#ff7d7d]">{player_error_text(copy, error)}</div>
          )}
        </div>
      </section>
    </MainMenu>
  )
}
