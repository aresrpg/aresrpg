// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { WalletCards } from 'lucide-react'

import { MainMenu } from '../menu/MainMenu.tsx'
import { demo_played } from '../adventure/visit.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { player_error_text } from '../i18n/player_error.ts'
import { useAppStore } from '../store.ts'

import { GoogleLoginButton } from './GoogleLoginButton.tsx'
import { WalletChoices, WalletPickerModal } from './WalletPickerModal.tsx'

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
  const [played] = useState(demo_played)

  return (
    <MainMenu copy={copy} first_visit={!gift && !played}>
      <section data-player-login className="main-menu-login">
        {gift && <p className="mb-4 text-sm">{login_lead(copy, gift)}</p>}
        <div className="main-menu-actions">
          <GoogleLoginButton copy={copy} ready={auth_ready} loading={loading} login={login_google} />
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
