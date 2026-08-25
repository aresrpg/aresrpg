// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Temporary seed-signer custody. Persist the signer before funding it, bind the record to the
// authorizing wallet and deployment, and retain it until both its AdminCap and SUI are gone.

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { absorb_receipt, receipt_digest, type Receipt } from './cache.ts'
import type { Sdk } from './client.ts'
import { create_seed_session_authorization_transaction, project_temp_admin_cap } from './seed_admin.ts'

/** What survives a crash: signer, capability (null while authorization is in flight),
 *  and the exact wallet/deployment identity that owns the session. */
export type SeedSessionRecord = Readonly<{
  secret: string
  admin_cap: string | null
  epoch: string
  network: string
  owner: string
  package: string
}>

/** The injected persistence. Every method THROWS on failure — a custody store that can lose
 *  the secret silently is exactly the bug this module exists to kill. `read` throws on a
 *  corrupt record and returns null only for a genuinely absent one. */
export type SeedSessionStore = Readonly<{
  read: () => Promise<SeedSessionRecord | null> | SeedSessionRecord | null
  write: (record: SeedSessionRecord) => Promise<void> | void
  clear: () => Promise<void> | void
}>

export type SeedSession = Readonly<{
  /** The live delegated signer: authorizes on first use (mint + fund), restores after a
   *  reload, refuses expired or half-written sessions with an actionable message. */
  ensure: () => Promise<Readonly<{ sdk: Sdk; admin_cap: string; authorization_receipt: Receipt | null }>>
  /** Delete the capability, sweep remaining SUI, then clear the persisted signer. */
  release: () => Promise<void>
}>

const seed_session_storage_key = (network: string, owner: string): string =>
  `aresrpg_admin_seed_session:${network}:${owner.toLowerCase()}`

/** Seed-session storage failures stop before funding; this record holds a live signer and capability. */
export const browser_seed_session_store = (network: string, owner: string): SeedSessionStore => {
  const key = seed_session_storage_key(network, owner)
  return {
    read: () => {
      const storage = globalThis.localStorage
      if (!storage) return null
      const source = storage.getItem(key)
      if (!source) return null
      const value = JSON.parse(source) as Partial<SeedSessionRecord>
      if (
        typeof value.secret !== 'string' ||
        typeof value.epoch !== 'string' ||
        typeof value.network !== 'string' ||
        typeof value.owner !== 'string' ||
        typeof value.package !== 'string'
      )
        throw new Error(
          `The stored seed session record at "${key}" is corrupt — an earlier session may be orphaned. ` +
            'Recover it manually before authorizing a new one.'
        )
      return Object.freeze({
        secret: value.secret,
        admin_cap: typeof value.admin_cap === 'string' ? value.admin_cap : null,
        epoch: value.epoch,
        network: value.network,
        owner: value.owner,
        package: value.package,
      })
    },
    write: (record) => {
      const storage = globalThis.localStorage
      if (!storage) throw new Error('No browser storage is available to hold the seed session record.')
      storage.setItem(key, JSON.stringify(record))
    },
    clear: () => {
      const storage = globalThis.localStorage
      if (!storage) return
      storage.removeItem(key)
      if (storage.getItem(key) !== null) throw new Error('The temporary signer record remains present')
    },
  }
}

const current_epoch = async (sdk: Sdk): Promise<string> => {
  const { systemState } = await sdk.sui_client.core.getCurrentSystemState()
  return String(systemState.epoch)
}

export const create_seed_session = ({
  store,
  super_sdk,
  super_admin_cap,
  network,
  owner,
  package_id,
  build_session_sdk,
}: Readonly<{
  store: SeedSessionStore
  super_sdk: Sdk
  super_admin_cap: string
  network: string
  owner: string
  package_id: string
  build_session_sdk: (keypair: Ed25519Keypair) => Sdk
}>): SeedSession => {
  let live_record: SeedSessionRecord | null = null
  let live_sdk: Sdk | null = null

  const read_record = async (): Promise<SeedSessionRecord | null> => live_record ?? (await store.read())

  const assert_identity = (record: SeedSessionRecord): void => {
    if (record.network !== network || record.owner !== owner || record.package !== package_id)
      throw new Error('The stored seed session belongs to another wallet, network, or deployment.')
  }

  return Object.freeze({
    ensure: async () => {
      const stored = await read_record()
      const epoch = await current_epoch(super_sdk)

      if (stored) {
        assert_identity(stored)
        if (stored.epoch !== epoch)
          throw new Error(
            `The admin seed session from epoch ${stored.epoch} has expired (current epoch ${epoch}). ` +
              'Release it — the remaining SUI returns automatically — then authorize a new one.'
          )
        if (!stored.admin_cap)
          throw new Error(
            'A previous seed authorization may have landed without its record completing. ' +
              'Do not authorize another session; recover the owned AdminCap first.'
          )
        const keypair = Ed25519Keypair.fromSecretKey(stored.secret)
        const sdk = build_session_sdk(keypair)
        await sdk.hydrate([stored.admin_cap])
        live_record = stored
        live_sdk = sdk
        return Object.freeze({ sdk, admin_cap: stored.admin_cap, authorization_receipt: null })
      }

      // LAW 1 — prove the store holds the real secret BEFORE any transaction is signed.
      const keypair = new Ed25519Keypair()
      const pending: SeedSessionRecord = Object.freeze({
        secret: keypair.getSecretKey(),
        admin_cap: null,
        epoch,
        network,
        owner,
        package: package_id,
      })
      await store.write(pending)
      const written = await store.read()
      if (
        written?.secret !== pending.secret ||
        written.network !== network ||
        written.owner !== owner ||
        written.package !== package_id
      )
        throw new Error(
          'The seed session store did not retain the signer record — refusing to authorize: ' +
            'a session whose secret cannot be persisted would strand its funds on a crash.'
        )
      live_record = pending

      const transaction = create_seed_session_authorization_transaction({
        sdk: super_sdk,
        admin_cap: super_admin_cap,
        recipient: keypair.toSuiAddress(),
      })
      const authorization_receipt = await super_sdk.execute(transaction, { include: { objectTypes: true } })
      const admin_cap = project_temp_admin_cap(authorization_receipt).objectId
      const complete: SeedSessionRecord = Object.freeze({ ...pending, admin_cap })
      live_record = complete
      await store.write(complete)
      const verified = await store.read()
      if (verified?.admin_cap !== admin_cap || verified.secret !== complete.secret)
        throw new Error(
          `The authorization landed (${receipt_digest(authorization_receipt)}) but its record did not persist. ` +
            'Do NOT close this session — call release() now to recover the capability and funds.'
        )

      const sdk = build_session_sdk(keypair)
      absorb_receipt(sdk.cache, authorization_receipt)
      live_sdk = sdk
      return Object.freeze({ sdk, admin_cap, authorization_receipt })
    },

    release: async () => {
      const stored = await read_record()
      if (!stored) return
      assert_identity(stored)
      const keypair = Ed25519Keypair.fromSecretKey(stored.secret)
      const sdk = live_sdk ?? build_session_sdk(keypair)
      if (!live_sdk && stored.admin_cap) await sdk.hydrate([stored.admin_cap])
      live_sdk = sdk
      const cap_exists = !!stored.admin_cap && !!sdk.ref(stored.admin_cap)
      const session_address = keypair.toSuiAddress()
      const { balance } = await sdk.sui_client.core.getBalance({ owner: session_address })
      const has_sui = BigInt(balance.balance) > 0n
      if (!stored.admin_cap && has_sui)
        throw new Error(
          `The seed session at ${session_address} is funded but its AdminCap ID was not persisted. ` +
            'Recover the owned AdminCap before clearing this record.'
        )
      if (!cap_exists && !has_sui) {
        await store.clear()
        live_record = null
        live_sdk = null
        return
      }
      if (cap_exists && !has_sui)
        throw new Error(
          `The temporary AdminCap still exists at ${stored.admin_cap}, but its signer has no cleanup gas.`
        )
      const transaction = sdk.tx()
      if (cap_exists)
        transaction.moveCall({
          target: `${package_id}::admin::delete_admin_cap`,
          arguments: [sdk.door_context.obj(transaction, stored.admin_cap!, true)],
        })
      transaction.transferObjects([transaction.gas], owner)
      await sdk.execute(transaction)
      if (stored.admin_cap && sdk.ref(stored.admin_cap))
        throw new Error(`The temporary AdminCap ${stored.admin_cap} remains after release.`)
      await store.clear()
      live_record = null
      live_sdk = null
    },
  })
}
