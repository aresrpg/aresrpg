// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { parse_agent_pairing_request, type AgentPairingRequest } from '../src/agent_pairing.ts'
import { prepare_agent_pairing } from '../src/agent_signer.ts'

import { bootstrap_setup_link } from './agent_setup.ts'
import {
  check_agent_directory,
  create_agent_directory,
  create_agent_file,
  read_agent_file,
  replace_agent_file,
  with_agent_lock,
} from './agent_file_storage.ts'

type Identity = Readonly<{
  version: 1
  phase: 'pending' | 'paired'
  request: AgentPairingRequest
  agent_public_key: string
  address: string
}>

const load_key = async (directory: string) => {
  const value = (await read_agent_file(directory, 'key.json')) as { version?: unknown; secret_key?: unknown } | null
  if (!value) throw new Error('AGENT_KEY_MISSING')
  if (value.version !== 1 || typeof value.secret_key !== 'string') throw new Error('INVALID_AGENT_KEY')
  try {
    return Ed25519Keypair.fromSecretKey(value.secret_key)
  } catch {
    throw new Error('INVALID_AGENT_KEY')
  }
}

const member = (key: Ed25519Keypair) => ({
  storage: 'persistent' as const,
  public_key: key.getPublicKey(),
  sign_personal_message: (bytes: Uint8Array) => key.signPersonalMessage(bytes),
  sign_transaction: (bytes: Uint8Array) => key.signTransaction(bytes),
})

/** Call only after the human approves this specific credential creation and file-backed custody.
 * The factory injection is for known synthetic fixtures, never a production fallback. */
export const initialize_agent = async (
  directory: string,
  approved: boolean,
  create_key = () => new Ed25519Keypair()
) => {
  if (!approved) throw new Error('KEY_CREATION_APPROVAL_REQUIRED')
  await create_agent_directory(directory)
  return with_agent_lock(directory, async () => {
    const saved = await read_agent_file(directory, 'key.json')
    if (saved !== null) return { agent_public_key: (await load_key(directory)).getPublicKey().toBase64() }
    if (await read_agent_file(directory, 'identity.json')) throw new Error('AGENT_KEY_MISSING')
    const key = create_key()
    await create_agent_file(directory, 'key.json', { version: 1, secret_key: key.getSecretKey() })
    const restored = await load_key(directory)
    if (restored.getPublicKey().toBase64() !== key.getPublicKey().toBase64()) throw new Error('KEY_PERSISTENCE_FAILED')
    return { agent_public_key: restored.getPublicKey().toBase64() }
  })
}

const restore_identity = async (directory: string) => {
  const key = await load_key(directory)
  const value = (await read_agent_file(directory, 'identity.json')) as Identity | null
  if (!value) throw new Error('AGENT_NOT_PAIRED')
  if (value.version !== 1 || !['pending', 'paired'].includes(value.phase)) throw new Error('INVALID_AGENT_IDENTITY')
  const client = await prepare_agent_pairing(parse_agent_pairing_request(value.request), member(key))
  if (value.address !== client.signer.address || value.agent_public_key !== key.getPublicKey().toBase64())
    throw new Error('AGENT_IDENTITY_MISMATCH')
  return { identity: value, signer: client.signer }
}

/** Reload without the setup token, network access, or a replacement key. */
export const load_agent_signer = async (directory: string) => {
  const restored = await restore_identity(directory)
  if (restored.identity.phase !== 'paired') throw new Error('PAIRING_OUTCOME_UNCONFIRMED')
  return restored.signer
}

export const agent_status = async (directory: string) => {
  const key = await load_key(directory)
  if (!(await read_agent_file(directory, 'identity.json')))
    return { status: 'initialized', agent_public_key: key.getPublicKey().toBase64() }
  const { identity } = await restore_identity(directory)
  return { status: identity.phase, address: identity.address, agent_public_key: identity.agent_public_key }
}

/** No transactions or gameplay. The key exists before the first request; only public metadata is saved. */
export const pair_agent = async (
  directory: string,
  link: string,
  options: Readonly<{ fetch?: typeof fetch; local_preview?: boolean }> = {}
) => {
  await check_agent_directory(directory)
  const key = await load_key(directory)
  return with_agent_lock(directory, async () => {
    const previous = (await read_agent_file(directory, 'identity.json')) as Identity | null
    if (previous) await restore_identity(directory)
    if (previous?.phase === 'paired') throw new Error('ALREADY_PAIRED_USE_STATUS')
    const signer = await bootstrap_setup_link(link, {
      ...options,
      bootstrap: async (input) => {
        const request = parse_agent_pairing_request(input)
        const client = await prepare_agent_pairing(request, member(key))
        if (previous && previous.address !== client.signer.address) throw new Error('AGENT_IDENTITY_MISMATCH')
        await replace_agent_file(directory, 'identity.json', {
          version: 1,
          phase: 'pending',
          request,
          agent_public_key: key.getPublicKey().toBase64(),
          address: client.signer.address,
        } satisfies Identity)
        return client
      },
    })
    const { identity } = await restore_identity(directory)
    await replace_agent_file(directory, 'identity.json', { ...identity, phase: 'paired' } satisfies Identity)
    const reloaded = await load_agent_signer(directory)
    if (reloaded.address !== signer.address) throw new Error('AGENT_IDENTITY_MISMATCH')
    return reloaded
  })
}
