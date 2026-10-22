// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { load_app_copy } from '../i18n/copy.ts'
import { load_locale } from '../i18n/locale.ts'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import { load_game_settings } from '../game/core/settings.ts'
import { master_volume_from, set_master_audio_volume } from '../game/core/audio_volume.ts'
import { react_error_handlers } from '../reporting.ts'

import { AllocationPage } from './AllocationPage.tsx'
import { create_allocation_runtime } from './runtime.ts'

export const boot_allocation = async (): Promise<void> => {
  set_master_audio_volume(master_volume_from(load_game_settings('medium').master_volume))
  const locale = load_locale()
  const copy = await load_app_copy(locale)
  const runtime = create_allocation_runtime()
  createRoot(document.getElementById('root')!, react_error_handlers).render(
    <LocaleScope locale={locale}>
      <AllocationPage runtime={runtime} copy={copy} locale={locale} />
    </LocaleScope>
  )
}
