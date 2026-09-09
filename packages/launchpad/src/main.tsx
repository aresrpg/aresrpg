// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import { FinanceLocale } from '@aresrpg/frontend/finance'
import { init_reporting, react_error_handlers } from '@aresrpg/frontend/reporting'
import { inject } from '@vercel/analytics'

import favicon from '../../frontend/public/logo.png'

import { LaunchPage } from './LaunchPage.tsx'
import './launch.css'

init_reporting()

if (import.meta.env.MODE === 'production') {
  inject({
    mode: 'production',
    beforeSend: (event) => ({ ...event, url: event.url.split(/[?#]/, 1)[0]! }),
  })
}

document.querySelector('link[rel="icon"]')!.setAttribute('href', favicon)

const root = createRoot(document.getElementById('root')!, react_error_handlers)
root.render(
  <FinanceLocale
    render={(copy, locale, change_locale) => (
      <LaunchPage copy={copy.kares_page} locale={locale} change_locale={change_locale} />
    )}
  />
)
import.meta.hot?.dispose(() => root.unmount())
