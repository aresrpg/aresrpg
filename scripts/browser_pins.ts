// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Browser builds consume deployment identities, never historical publication records. */
export const browser_pins_plugin = (pins_path = fileURLToPath(new URL('../pins.json', import.meta.url))) => {
  const canonical_path = realpathSync(pins_path)
  return {
    name: 'aresrpg-browser-pins',
    enforce: 'pre' as const,
    load: async (id: string): Promise<string | null> => {
      if (id !== canonical_path) return null
      const pins = JSON.parse(await readFile(canonical_path, 'utf8')) as Record<string, Record<string, unknown>>
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(pins).map(([network, fields]) => [
            network,
            Object.fromEntries(
              Object.entries(fields).filter(([key]) => key !== 'seed_ledgers' && key !== 'seed_addresses')
            ),
          ])
        )
      )
    },
  }
}
