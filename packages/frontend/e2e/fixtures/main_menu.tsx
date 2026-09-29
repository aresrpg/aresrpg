// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { Login } from '../../src/components/Login.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initialize_app_store, dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'

initialize_app_store({ quality: 'medium', music_enabled: false, master_volume: 1, render_distance: null })
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
createRoot(document.getElementById('root')!).render(
  <Login
    auth_ready
    wallets={[]}
    copy={copy}
    show_wallets={false}
    set_show_wallets={() => {}}
    login_google={() => {}}
    login_wallet={() => {}}
    gift={false}
  />
)
