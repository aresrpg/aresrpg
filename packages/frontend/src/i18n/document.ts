// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppCopy } from './copy.ts'
import type { Locale } from './locale.ts'

export const apply_document_locale = (copy: AppCopy, locale: Locale, offering = false): void => {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  const title = offering ? 'KARES · AresRPG' : copy.ui.game_title
  const description = offering ? copy.ui.sale_description : copy.ui.game_description
  document.title = title
  if (!offering) document.querySelector('link[rel="manifest"]')?.setAttribute('href', `/manifest-${locale}.webmanifest`)
  const fields = {
    'meta[name="description"]': description,
    'meta[property="og:title"]': title,
    'meta[name="twitter:title"]': title,
    'meta[property="og:description"]': description,
    'meta[name="twitter:description"]': description,
    'meta[property="og:image:alt"]': copy.ui.world_image,
    'meta[name="twitter:image:alt"]': copy.ui.world_image,
    'meta[property="og:locale"]': new Intl.Locale(locale)
      .maximize()
      .toString()
      .split('-')
      .filter((part) => part.length !== 4)
      .join('_'),
  }
  Object.entries(fields).forEach(([selector, value]) =>
    document.querySelector(selector)?.setAttribute('content', value)
  )
}
