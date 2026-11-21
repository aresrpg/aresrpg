// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Integration controller: the presentation and choreography remain Opus-authored.
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@aresrpg/ui/styles.css'

import { agent_connect_url } from '../agents/entry_intent.ts'
import { LanguageCard } from '../components/AccountControls.tsx'
import { show_boot_loading, show_boot_failure, show_light_shell } from '../boot_loading.ts'
import { env } from '../env.ts'
import { load_app_copy } from '../i18n/copy.ts'
import { apply_document_locale } from '../i18n/document.ts'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import { load_locale, save_locale, type Locale } from '../i18n/locale.ts'
import { react_error_handlers, report_error } from '../reporting.ts'
import { finish_startup_recovery, observe_startup_recovery } from '../startup_recovery.ts'

import { Landing } from './Landing.tsx'
import { create_landing_account, play_step } from './landing_account.ts'
import { LandingAccount } from './LandingAccount.tsx'
import { LandingAccountContext } from './LandingChooser.tsx'
import { landing_assets } from './assets.ts'
import { landing_links } from './presentation.ts'

/** The sale reads the chain through the SDK; the home page paints first and loads it apart. */
const BlastSaleBar = lazy(() => import('../kares/BlastSaleBar.tsx'))

/** The mood of each light page the home page opens in place; the agent page is the rest. */
const LIGHT_AURAS: Readonly<Record<string, 'sky' | 'moss'>> = { '/kares': 'sky', '/dapp': 'moss' }

export const boot_landing = async (): Promise<void> => {
  const host = document.getElementById('root')
  if (!host) throw new Error('Application root is missing')
  const links = landing_links(location.origin, env.discord_url)
  const root = createRoot(host, react_error_handlers)
  const auth = create_landing_account()
  const restored = auth.restore()
  let entering = false
  let ready_frame = 0
  const enter_game = async (): Promise<void> => {
    auth.dispose()
    root.unmount()
    show_boot_loading()
    observe_startup_recovery()
    const { boot_game } = await import('../game_entry.tsx')
    boot_game()
  }
  /**
   * A light page (KARES, Connect Your Agent) opens in place: the document is not reloaded, its shell
   * shows at once with skeletons, and the page's own code replaces it. Back reloads the home page.
   */
  const open_light = (url: string): void => {
    if (entering) return
    entering = true
    if (ready_frame) cancelAnimationFrame(ready_frame)
    auth.dispose()
    root.unmount()
    history.pushState(history.state, '', url)
    addEventListener('popstate', () => location.reload(), { once: true })
    show_light_shell(LIGHT_AURAS[new URL(url, location.origin).pathname] ?? 'ember')
    void import('../game_entry.tsx')
      .then(({ boot_game }) => boot_game())
      .catch((error: unknown) => {
        report_error(error, { area: 'landing_light_page' })
        location.assign(url)
      })
  }
  /** Signed in, Play enters the game at once. Signed out, it signs in first. A link with a destination opens that page. */
  const play = (url?: string): void => {
    if (url) return open_light(url)
    if (entering) return
    const step = play_step(auth.store.getState().status)
    // A sign-in in flight settles into signed in or signed out; Play then decides again from that state.
    if (step === 'wait') return void restored.then(() => play_step(auth.store.getState().status) !== 'wait' && play())
    if (step === 'login')
      return void auth.login().then((signed_in) => {
        if (signed_in) play()
      })
    entering = true
    if (ready_frame) cancelAnimationFrame(ready_frame)
    queueMicrotask(() => {
      void enter_game().catch((error: unknown) => {
        report_error(error, { area: 'landing_play' })
        show_boot_failure()
      })
    })
  }
  /** Paints the home page in one language. A language change saves it, loads its copy and paints again. */
  const paint = async (locale: Locale): Promise<void> => {
    const copy = await load_app_copy(locale)
    if (entering) return
    apply_document_locale(copy, locale)
    const change_locale = (next: Locale): void => {
      save_locale(next)
      void paint(next).catch((error: unknown) => report_error(error, { area: 'landing_locale' }))
    }
    root.render(
      <LocaleScope locale={locale}>
        <LandingAccountContext.Provider value={auth}>
          <Landing
            copy={copy.landing_page}
            assets={landing_assets}
            links={links}
            on_play={play}
            agent_connect_url={agent_connect_url(location.origin)}
            notice={
              <Suspense fallback={null}>
                <BlastSaleBar copy={copy} />
              </Suspense>
            }
            account={
              <>
                <LanguageCard compact copy={copy} locale={locale} change_locale={change_locale} />
                <LandingAccount auth={auth} copy={copy.landing_page.account} />
              </>
            }
          />
        </LandingAccountContext.Provider>
      </LocaleScope>
    )
  }
  await paint(load_locale())
  ready_frame = requestAnimationFrame(() => {
    ready_frame = 0
    if (!entering) finish_startup_recovery()
  })
}
