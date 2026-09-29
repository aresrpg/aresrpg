// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppCopy } from './i18n/copy.ts'
import type { Locale } from './i18n/locale.ts'
import type { Network } from './env.ts'
import type { Page } from './modules/navigation.ts'
import type { SessionState } from './modules/session.ts'
import type { GameSettings } from './game/core/settings.ts'

export type PlayerShellProps = Readonly<{
  copy: AppCopy
  locale: Locale
  network: Network
  page: Page
  pathname: string
  session: SessionState
  settings: GameSettings
  change_locale: (locale: Locale) => void
  create_character: () => void
  disconnect: () => void
  open_page: (page: Page) => void
  open_path: (pathname: string) => void
  select_character: (character_id: string) => void
}>
