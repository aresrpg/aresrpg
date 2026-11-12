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

// Only the opening choice is a reload checkpoint; later tutorial play stays session-local.
const CHOICE_KEY = 'aresrpg.demo.opening-choice'
export type AdventureChoice = 'play' | 'continue'

export const read_adventure_choice = (): AdventureChoice | null => {
  try {
    const choice = globalThis.localStorage?.getItem(CHOICE_KEY)
    return choice === 'play' || choice === 'continue' ? choice : null
  } catch (error) {
    console.warn('Could not read tutorial checkpoint.', error)
    return null
  }
}

export const remember_adventure_choice = (choice: AdventureChoice): void => {
  try {
    globalThis.localStorage?.setItem(CHOICE_KEY, choice)
  } catch (error) {
    console.warn('Could not save tutorial checkpoint.', error)
  }
}

/** An explicit Replay demo action starts fresh; ordinary reloads retain the choice. */
export const forget_adventure_choice = (): void => {
  try {
    globalThis.localStorage?.removeItem(CHOICE_KEY)
  } catch (error) {
    console.warn('Could not reset tutorial checkpoint.', error)
  }
}
