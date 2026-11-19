// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type RawWrite = Readonly<{ id: string; raw: string | null; expires_at: number | null }>
/** One namespace of ciphertext records. commit compares every expected ciphertext (null = absent)
 * and applies every write in one atomic step; it returns false on any mismatch. */
export type RecordBackend = Readonly<{
  get: (ids: readonly string[]) => Promise<readonly (string | null)[]>
  commit: (
    expected: readonly Readonly<{ id: string; raw: string | null }>[],
    writes: readonly RawWrite[]
  ) => Promise<boolean>
  ids: (prefix: string) => Promise<readonly string[]>
}>
/** null deletes; expires_at is an absolute deadline in ms, absent or null keeps the record without expiry. */
export type Writes = Readonly<Record<string, Readonly<{ value: unknown; expires_at?: number | null }> | null>>

export const secure_records = (backend: RecordBackend, key: string) => {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('storage_key_required')
  const secret = Buffer.from(key, 'hex')
  const encode = (id: string, value: unknown) => {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', secret, nonce)
    cipher.setAAD(Buffer.from(id))
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64')
  }
  const decode = <T>(id: string, raw: string | null): T | null => {
    if (raw === null) return null
    const bytes = Buffer.from(raw, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12))
    decipher.setAAD(Buffer.from(id))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()) as T
  }
  const read = async <T>(id: string) => decode<T>(id, (await backend.get([id]))[0] ?? null)
  /** Compare-and-set over every named record. A concurrent change fails closed; the reduce is never replayed. */
  const change = async (ids: readonly string[], reduce: (get: <T>(id: string) => T | null) => Writes) => {
    const raws = await backend.get(ids)
    const locked = new Map(ids.map((id, index) => [id, raws[index] ?? null]))
    const writes = reduce(<T>(id: string) => {
      if (!locked.has(id)) throw new Error('record_not_locked')
      return decode<T>(id, locked.get(id) ?? null)
    })
    if (Object.keys(writes).some((id) => !locked.has(id))) throw new Error('record_not_locked')
    const committed = await backend.commit(
      [...locked].map(([id, raw]) => ({ id, raw })),
      Object.entries(writes).map(([id, write]) => ({
        id,
        raw: write ? encode(id, write.value) : null,
        expires_at: write?.expires_at ?? null,
      }))
    )
    if (!committed) throw new Error('link_changed')
    return writes
  }
  return { read, change, ids: backend.ids }
}
export type Records = ReturnType<typeof secure_records>
