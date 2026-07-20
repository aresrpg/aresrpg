// Onboarding persistence — PREFERENCES ONLY (the in-progress character draft + the zkLogin
// preference), in IndexedDB so the choice survives reload and the OAuth popup round-trip. Never
// gameplay: the character roster comes from the server (FalkorDB read-model, written by the
// indexer from chain) via sui_get_characters — never localStorage.

const DB_NAME = 'aresrpg'
const DB_STORE = 'onboarding'
const DRAFT_KEY = 'character_draft'
const PREF_KEY = 'prefers_zklogin'
const LAST_CHARACTER_KEY = 'last_character_id'

/** @returns {Promise<IDBDatabase>} */
const open_db = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

/**
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} run
 * @returns {Promise<any>}
 */
const idb = async (mode, run) => {
  const db = await open_db()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode)
    const req = run(tx.objectStore(DB_STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

/** @typedef {{ name: string, class_id: string, hue: number }} CharacterDraft */

/** @param {CharacterDraft} draft @returns {Promise<any>} */
export const save_draft = draft =>
  idb('readwrite', s => s.put(draft, DRAFT_KEY)).catch(() => {})
/** @returns {Promise<CharacterDraft | null>} */
export const load_draft = () =>
  idb('readonly', s => s.get(DRAFT_KEY))
    .then(v => v ?? null)
    .catch(() => null)
/** @returns {Promise<any>} */
export const clear_draft = () =>
  idb('readwrite', s => s.delete(DRAFT_KEY)).catch(() => {})
/** @param {boolean} v @returns {Promise<any>} */
export const set_pref_zklogin = v =>
  idb('readwrite', s => s.put(v, PREF_KEY)).catch(() => {})
/** @returns {Promise<boolean>} */
export const get_pref_zklogin = () =>
  idb('readonly', s => s.get(PREF_KEY))
    .then(v => Boolean(v))
    .catch(() => false)

// Last-played character — a PREFERENCE (which of your own on-chain characters to auto-enter the world
// with on boot, and to keep selected across the character switcher). NOT gameplay: the roster itself is
// always the server's on-chain read-model; this only remembers which of those to spawn first. The id is
// re-validated against the live roster before use, so a stale/deleted id falls back to the first.
/** @param {string} id @returns {Promise<any>} */
export const set_last_character = id =>
  idb('readwrite', s => s.put(id, LAST_CHARACTER_KEY)).catch(() => {})
/** @returns {Promise<string | null>} */
export const get_last_character = () =>
  idb('readonly', s => s.get(LAST_CHARACTER_KEY))
    .then(v => (typeof v === 'string' ? v : null))
    .catch(() => null)
