// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { load_app_copy } from '../i18n/copy.ts'
import { load_locale } from '../i18n/locale.ts'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import { react_error_handlers } from '../reporting.ts'

import { capture_gift_intent } from './gift_intent.ts'
import { create_gift_runtime } from './gift_runtime.ts'
import { GiftPage } from './GiftPage.tsx'

/** Gift entry deliberately imports neither the app store nor PlayerRuntime/world code. */
export const boot_gift = async (): Promise<void> => {
  const link = capture_gift_intent()
  const locale = load_locale()
  const copy = await load_app_copy(locale)
  const runtime = create_gift_runtime({ link })
  createRoot(document.getElementById('root')!, react_error_handlers).render(
    <StrictMode>
      <LocaleScope locale={locale}>
        <GiftPage runtime={runtime} copy={copy} />
      </LocaleScope>
    </StrictMode>
  )
  // The game registers its offline cache after the player leaves this lightweight flow.
}
