// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SeedAdminConfig } from '@aresrpg/sdk/seed-admin'

import type { AdminState } from './admin_state.ts'

const STORAGE_KEY = 'aresrpg:seed-admin'

export const read_admin_storage = (): Readonly<{ config: SeedAdminConfig }> => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    const config = parsed.config as Partial<SeedAdminConfig> | undefined
    return Object.freeze({
      config: Object.freeze({
        publisher: typeof config?.publisher === 'string' ? config.publisher : '',
        worlds: Object.freeze(
          Object.fromEntries(
            Object.entries(config?.worlds ?? {}).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          )
        ),
      }),
    })
  } catch (error) {
    console.warn('Saved seed publishing progress is invalid.', error)
    return Object.freeze({ config: Object.freeze({ publisher: '', worlds: Object.freeze({}) }) })
  }
}

export const save_admin_storage = (state: AdminState): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ config: state.config }))
  } catch (error) {
    console.warn('Seed publishing progress could not be saved.', error)
  }
}
