// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { LanguageCard } from './AccountControls.tsx'
import { GoogleLoginButton } from './GoogleLoginButton.tsx'
import { WalletCard } from './WalletCard.tsx'
import './light_page.css'

/** A page's mood: blue for the token, orange for agents, green for expeditions. */
export type LightPageAura = 'sky' | 'ember' | 'moss'

/**
 * The one sign-in card of a light page: it asks for the game account before the page's own content.
 * While a sign-in runs, a restored session included, it says so and asks for nothing: the player
 * never reads a request to sign in that the page is already answering.
 */
export const LightPageGate = ({ copy, title, body }: Readonly<{ copy: AppCopy; title: string; body: string }>) => {
  const ready = useAppStore(({ session }) => session.auth_ready)
  const status = useAppStore(({ session }) => session.auth_status)
  if (status === 'connecting')
    return (
      <section className="aui-panel light-page-card">
        <p className="light-page-status" role="status" aria-busy="true">
          <span className="aui-spinner" aria-hidden="true" />
          {copy.ui.signing_in}
        </p>
      </section>
    )
  return (
    <section className="aui-panel light-page-card">
      <h1>{title}</h1>
      <p>{body}</p>
      <GoogleLoginButton
        copy={copy}
        ready={ready}
        loading={false}
        login={() => dispatch_app({ type: 'auth/login_google' })}
      />
    </section>
  )
}

/**
 * The shell of a page that needs the account but no world: a floating bar with the brand, the page's
 * own controls and the wallet, then the content. It never mounts a canvas or loads the engine.
 * `aura` gives the page its mood: a radiance in that hue, a pixel weave and one small pixel-art scene
 * at the foot of the page, behind glass panels.
 */
export const LightPage = ({
  copy,
  brand,
  controls,
  aura,
  wide,
  children,
}: Readonly<{
  copy: AppCopy
  brand: ReactNode
  controls?: ReactNode
  aura?: LightPageAura
  /** An application surface: the content uses the whole window; the bar keeps its centred width. */
  wide?: boolean
  children: ReactNode
}>) => {
  const session = useAppStore((state) => state.session)
  const locale = useAppStore((state) => state.locale)
  return (
    <div className={aura ? 'light-page aui-aura' : 'light-page'} data-aura={aura} data-wide={wide ? '' : undefined}>
      {aura && <div aria-hidden="true" className="light-page-scene" />}
      <header className="light-page-header">
        <a className="light-page-brand" href="/">
          {brand}
        </a>
        {controls}
        <LanguageCard
          compact
          copy={copy}
          locale={locale}
          change_locale={(next) => dispatch_app({ type: 'locale/changed', locale: next })}
        />
        {session.wallet && (
          <WalletCard
            key={session.wallet.address}
            copy={copy}
            session={session}
            disconnect={() => dispatch_app({ type: 'auth/disconnected' })}
            standalone
          />
        )}
      </header>
      <main className="light-page-main">{children}</main>
    </div>
  )
}
