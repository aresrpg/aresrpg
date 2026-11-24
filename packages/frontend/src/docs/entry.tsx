// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The docs: public reading with a design of their own. They start the address and the language. The item sheet's
// recipe section reads the account slices, which start empty and unobserved: no connection, no sign-in.
import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import '@aresrpg/ui/styles.css'

import { LanguageCard } from '../components/AccountControls.tsx'
import { load_game_settings } from '../game/core/settings.ts'
import { SITE_ADDRESSES } from '../site/routes.ts'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import location from '../modules/location.ts'
import locale from '../modules/locale.ts'
import marketplace from '../modules/marketplace.ts'
import session from '../modules/session.ts'
import trade from '../modules/trade.ts'
import { react_error_handlers } from '../reporting.ts'
import { dispatch_app, start_app, useSiteStore, type AppModule } from '../store.ts'

import { DocsPage, type DocsLinks } from './DocsPage.tsx'
import { DocsNavigation } from './docs_parts.tsx'

/** The saved crafting preference, read once. The settings module itself owns the game's audio and is not loaded. */
const saved_settings: AppModule = Object.freeze({
  name: 'settings',
  initial: () => ({ settings: load_game_settings('medium') }),
  reduce: (state) => state,
})

const LICENSE_URL = 'https://raw.githubusercontent.com/aresrpg/aresrpg/edge/LICENSE'

const navigate = (to: string): void => dispatch_app({ type: 'location/open', href: to })

const Docs = ({ links }: Readonly<{ links: DocsLinks }>) => {
  const copy = useSiteStore((state) => state.copy)
  const language = useSiteStore((state) => state.locale)
  const pathname = useSiteStore((state) => state.location.pathname)
  const title = copy?.docs_page.title
  useEffect(() => {
    if (title) document.title = `${title} · AresRPG`
  }, [title])
  if (!copy) return null
  return (
    <LocaleScope locale={language}>
      <DocsNavigation value={navigate}>
        <DocsPage
          copy={copy}
          language={
            <LanguageCard
              compact
              copy={copy}
              locale={language}
              change_locale={(next) => dispatch_app({ type: 'locale/changed', locale: next })}
            />
          }
          links={links}
          navigate={navigate}
          pathname={pathname}
        />
      </DocsNavigation>
    </LocaleScope>
  )
}

export const boot_docs = (): void => {
  const { source, playbook, agent_guide, market: home, world: play } = SITE_ADDRESSES
  const account = [session, marketplace, trade].map(({ name, initial, reduce }) => ({ name, initial, reduce }))
  start_app([location, locale, ...account, saved_settings], { seat: false })
  createRoot(document.getElementById('root')!, react_error_handlers).render(
    <Docs links={{ source, playbook, agent_guide, license: LICENSE_URL, home, play }} />
  )
}
