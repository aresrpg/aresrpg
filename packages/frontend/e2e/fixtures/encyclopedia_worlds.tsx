// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import { EncyclopediaPage } from '../../src/encyclopedia/EncyclopediaPage.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { dispatch_app, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

const requested = new URLSearchParams(location.search).get('locale')
const locale = LOCALES.find(({ code }) => code === requested)?.code ?? 'en'
const copy = await load_app_copy(locale)
dispatch_app({ type: 'locale/loaded', locale, copy })
dispatch_app({
  type: 'path/open',
  pathname: `/encyclopedia/worlds/nauvis${new URLSearchParams(location.search).has('place') ? `/${new URLSearchParams(location.search).get('place')!.split(':').map(encodeURIComponent).join('/')}` : ''}`,
})
const Fixture = () => {
  const pathname = useAppStore(({ navigation }) => navigation.pathname)
  return (
    <main
      className="flex min-h-0 min-w-0 flex-1 bg-bg text-text"
      style={{ containerType: 'inline-size', containerName: 'app-content' }}
      data-path={pathname}
    >
      <EncyclopediaPage
        copy={copy}
        pathname={pathname}
        navigate={(pathname) => dispatch_app({ type: 'path/open', pathname })}
      />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
