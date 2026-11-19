// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The docs entry: public reading, no session, no world. It never imports the game renderer.
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import '@aresrpg/ui/styles.css'

import { LanguageCard } from '../components/AccountControls.tsx'
import { env } from '../env.ts'
import { load_app_copy, type AppCopy } from '../i18n/copy.ts'
import { apply_document_locale } from '../i18n/document.ts'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import { load_locale, save_locale, type Locale } from '../i18n/locale.ts'
import { landing_links } from '../landing/presentation.ts'
import { react_error_handlers } from '../reporting.ts'
import { finish_startup_recovery } from '../startup_recovery.ts'
import { dispatch_app } from '../store.ts'

import { DocsPage, type DocsLinks } from './DocsPage.tsx'
import { DocsNavigation } from './docs_parts.tsx'

const LICENSE_URL = 'https://raw.githubusercontent.com/aresrpg/aresrpg/edge/LICENSE'

const DocsApp = ({
  copy,
  links,
  locale,
  change_locale,
}: Readonly<{ copy: AppCopy; links: DocsLinks; locale: Locale; change_locale: (locale: Locale) => void }>) => {
  const [pathname, set_pathname] = useState(() => location.pathname)
  useEffect(() => {
    const sync = (): void => set_pathname(location.pathname)
    addEventListener('popstate', sync)
    return () => removeEventListener('popstate', sync)
  }, [])
  const navigate = (to: string): void => {
    if (to !== location.pathname) history.pushState(null, '', to)
    set_pathname(to)
  }
  return (
    <DocsNavigation value={navigate}>
      <DocsPage
        copy={copy}
        language={<LanguageCard compact copy={copy} locale={locale} change_locale={change_locale} />}
        links={links}
        navigate={navigate}
        pathname={pathname}
      />
    </DocsNavigation>
  )
}

export const boot_docs = async (): Promise<void> => {
  const host = document.getElementById('root')
  if (!host) throw new Error('Application root is missing')
  const { source, playbook, agent_guide } = landing_links(location.origin, env.discord_url)
  const links: DocsLinks = {
    source,
    playbook,
    agent_guide,
    license: LICENSE_URL,
    home: new URL('/', location.origin).href,
    play: new URL('/world', location.origin).href,
  }
  const root = createRoot(host, react_error_handlers)
  /** Paints the docs in one language. A language change saves it, loads its copy and paints again. */
  const paint = async (locale: Locale): Promise<void> => {
    const copy = await load_app_copy(locale)
    // The encyclopedia views read their copy from the app store; the locale enters through its reducer door.
    dispatch_app({ type: 'locale/changed', locale })
    dispatch_app({ type: 'locale/loaded', locale, copy })
    apply_document_locale(copy, locale)
    document.title = `${copy.docs_page.title} · AresRPG`
    const change_locale = (next: Locale): void => {
      save_locale(next)
      void paint(next).catch((error: unknown) => console.error(`Locale ${next} failed to load.`, error))
    }
    root.render(
      <LocaleScope locale={locale}>
        <DocsApp change_locale={change_locale} copy={copy} links={links} locale={locale} />
      </LocaleScope>
    )
  }
  await paint(load_locale())
  finish_startup_recovery()
}
