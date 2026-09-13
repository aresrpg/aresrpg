// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { completed_quests_from } from './model.ts'

export type JourneyStorage = Readonly<{
  load: (identity: string) => Promise<readonly string[]>
  save: (identity: string, completed: readonly string[]) => Promise<void>
}>

/* eslint-disable functional/immutable-data -- IndexedDB handler assignment is the browser completion boundary. */
const open_database = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    let blocked = false
    const request = factory.open('aresrpg_journey', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('completion')
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Journey database upgrade is blocked.'))
    }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })

const transact = async (
  factory: IDBFactory | null,
  identity: string,
  completed?: readonly string[]
): Promise<unknown> => {
  if (!factory) throw new Error('IndexedDB is unavailable.')
  const database = await open_database(factory)
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('completion', completed === undefined ? 'readonly' : 'readwrite')
    const store = transaction.objectStore('completion')
    const request = completed === undefined ? store.get(identity) : store.put(completed, identity)
    transaction.oncomplete = () => {
      database.close()
      resolve(request.result)
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error)
    }
    transaction.onerror = transaction.onabort
  })
}
/* eslint-enable functional/immutable-data */

export const browser_journey_storage = (factory: IDBFactory | null = globalThis.indexedDB ?? null): JourneyStorage => ({
  load: async (identity) => completed_quests_from(await transact(factory, identity)),
  save: async (identity, completed) => {
    await transact(factory, identity, completed_quests_from(completed))
  },
})
