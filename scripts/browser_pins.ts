// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT_PINS = fileURLToPath(new URL('../pins.json', import.meta.url))

/** Both direct and SDK-relative imports resolve to the same explicit deployment. */
export const browser_pins_plugin = (pins_path = process.env.ARES_PINS_FILE ?? ROOT_PINS, expected_network?: string) => {
  const canonical_path = realpathSync(ROOT_PINS)
  const selected_path = realpathSync(pins_path)
  return {
    name: 'aresrpg-browser-pins',
    enforce: 'pre' as const,
    load: async (id: string): Promise<string | null> => {
      if (id !== canonical_path && id !== selected_path) return null
      const { seed_ledger: _ledger, ...pins } = JSON.parse(await readFile(selected_path, 'utf8')) as Record<
        string,
        unknown
      >
      if (pins.network !== 'mainnet' && pins.network !== 'testnet')
        throw new Error('Deployment pins need one explicit network')
      if (expected_network && pins.network !== expected_network)
        throw new Error(`Deployment pins do not match ${expected_network}`)
      return JSON.stringify(pins)
    },
  }
}
