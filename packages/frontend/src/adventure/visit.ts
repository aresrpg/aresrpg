// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const VISIT_KEY = 'aresrpg.demo.played'

export const demo_played = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(VISIT_KEY) === '1'
  } catch (error) {
    console.warn('Could not read demo button preference.', error)
    // Browser storage is optional; a blocked read keeps the first-visit button order.
    return false
  }
}

export const remember_demo_played = (): void => {
  try {
    globalThis.localStorage?.setItem(VISIT_KEY, '1')
  } catch (error) {
    console.warn('Could not save demo button preference.', error)
  }
}
