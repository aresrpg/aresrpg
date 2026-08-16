// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// IndexedDB edge for the local simulator roster. Combat and board setup remain ephemeral.

import type { SimulatorCharacter } from '../modules/simulator.ts'

const DB_NAME = 'aresrpg_simulator'
const DB_VERSION = 1
const ROSTER_STORE = 'roster'
const LEGACY_STORES = Object.freeze(['setup', 'traces'])

export type SimulatorRosterStorage = Readonly<{
  load: () => Promise<readonly unknown[]>
  save: (characters: readonly SimulatorCharacter[]) => Promise<void>
}>

type PersistenceInstall = Readonly<{
  storage: SimulatorRosterStorage
  signal: AbortSignal
  hydrate: (characters: readonly unknown[]) => void
  read_characters: () => readonly SimulatorCharacter[]
  on_characters_changed: (listener: () => void) => void
  delay_ms?: number
}>

/* eslint-disable functional/immutable-data -- IndexedDB handler assignment is the platform completion channel. */
const open_database = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      ;[ROSTER_STORE, ...LEGACY_STORES].forEach((name) => {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name)
      })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const load_roster = async (factory: IDBFactory): Promise<readonly unknown[]> => {
  const database = await open_database(factory)
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ROSTER_STORE, 'readonly')
    const request = transaction.objectStore(ROSTER_STORE).getAll()
    transaction.oncomplete = () => {
      database.close()
      resolve((request.result as readonly unknown[]) ?? [])
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error)
    }
    transaction.onabort = transaction.onerror
  })
}

const save_roster = async (factory: IDBFactory, characters: readonly SimulatorCharacter[]): Promise<void> => {
  const database = await open_database(factory)
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ROSTER_STORE, 'readwrite')
    const store = transaction.objectStore(ROSTER_STORE)
    store.clear()
    characters.forEach((character) => store.put(character, character.id))
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error)
    }
    transaction.onabort = transaction.onerror
  })
}

export const browser_simulator_roster_storage = (): SimulatorRosterStorage | null => {
  try {
    const factory = globalThis.indexedDB
    if (!factory) return null
    return Object.freeze({
      load: () => load_roster(factory),
      save: (characters) => save_roster(factory, characters),
    })
  } catch (error) {
    console.error('[simulator] IndexedDB is unavailable; local characters will not persist.', error)
    return null
  }
}

export const install_simulator_roster_persistence = ({
  storage,
  signal,
  hydrate,
  read_characters,
  on_characters_changed,
  delay_ms = 400,
}: PersistenceInstall): void => {
  let ready = false
  let changed_while_loading = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    timer = null
    void storage
      .save(read_characters())
      .catch((error) => console.error('[simulator] IndexedDB write failed; roster changes may be lost.', error))
  }
  const schedule = (): void => {
    if (timer === null) timer = setTimeout(flush, delay_ms)
  }
  const flush_pending = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    flush()
  }

  on_characters_changed(() => {
    if (signal.aborted) return
    if (!ready) changed_while_loading = true
    else schedule()
  })

  void storage
    .load()
    .then((characters) => {
      if (signal.aborted) return
      hydrate(characters)
      ready = true
      if (changed_while_loading) schedule()
    })
    .catch((error) => {
      console.error('[simulator] IndexedDB read failed; starting with the in-memory roster.', error)
      ready = true
      if (changed_while_loading) schedule()
    })

  globalThis.window?.addEventListener('pagehide', flush_pending)
  signal.addEventListener(
    'abort',
    () => {
      globalThis.window?.removeEventListener('pagehide', flush_pending)
      flush_pending()
    },
    { once: true }
  )
}
/* eslint-enable functional/immutable-data */
