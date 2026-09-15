// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { Plugin } from 'vite'
import type { ManifestOptions } from 'vite-plugin-pwa'
import { parse } from 'yaml'

import { LOCALES } from './src/i18n/locale.ts'
import type { AppCopy } from './src/i18n/copy.ts'

/** Installed-app descriptions use the same authored documents as the visible app. */
export const locale_manifest_plugin = (manifest: Partial<ManifestOptions>): Plugin => ({
  name: 'aresrpg-locale-manifests',
  writeBundle: async ({ dir }) => {
    if (!dir) return
    await Promise.all(
      LOCALES.map(async ({ code }) => {
        const copy = parse(
          await readFile(new URL(`./src/i18n/locales/${code}.yaml`, import.meta.url), 'utf8')
        ) as AppCopy
        await writeFile(
          resolve(dir, `manifest-${code}.webmanifest`),
          JSON.stringify({ ...manifest, lang: code, description: copy.ui.game_description })
        )
      })
    )
  },
})
