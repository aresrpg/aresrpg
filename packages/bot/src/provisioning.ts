// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_agent_identity } from '@aresrpg/sdk/agent-multisig'
import { prepare_agent_pairing } from '@aresrpg/sdk/agent-signer'
import { parse_agent_pairing_request, type AgentPairingRequest } from '@aresrpg/sdk/agent-pairing'
import { fromBase64 } from '@mysten/sui/utils'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import type { Account, Bot, BotPolicy } from './model.ts'
import type { ControlStore } from './store.ts'
import type { ManagedKey, ManagedProvider } from './managed_signer.ts'

export type ProvisionRequest = Readonly<{
  id: string
  owner: string
  zklogin_public_identifier: string
  policy: BotPolicy
  status: 'requested' | 'ready'
  key: ManagedKey | null
}>
const verify_owner = (owner: string, identifier: string) => {
  parse_agent_pairing_request({
    version: 1,
    nonce: '00000000-0000-4000-8000-000000000000',
    network: 'mainnet',
    owner,
    zklogin_public_identifier: identifier,
  })
  const google = ZkLoginPublicIdentifier.fromBytes(fromBase64(identifier), { address: owner })
  if (google.toSuiAddress() !== owner) throw new Error('CANONICAL_GOOGLE_OWNER_REQUIRED')
  return google
}
export const request_provisioning = async (
  store: ControlStore,
  input: Omit<ProvisionRequest, 'status' | 'key'>
): Promise<ProvisionRequest> => {
  verify_owner(input.owner, input.zklogin_public_identifier)
  const key = `provision:${input.id}`
  return store.transaction([key], async (tx) => {
    const previous = await tx.get<ProvisionRequest>(key)
    if (previous) {
      if (previous.owner !== input.owner || previous.zklogin_public_identifier !== input.zklogin_public_identifier)
        throw new Error('PROVISION_IDENTITY_CONFLICT')
      return previous
    }
    const request: ProvisionRequest = { ...input, status: 'requested', key: null }
    await tx.put(key, request)
    return request
  })
}
/** This fails if an uncertain commit permits replacement of a published wallet. Every
 * creation compares the same request and bot revisions; delayed/competing commits cannot
 * replace the winner. Reconcile the same creation ID before ever exposing a descriptor. */
export const run_provisioning = async (store: ControlStore, provider: ManagedProvider, id: string): Promise<Bot> => {
  const existing = await store.read<Bot>(`bot:${id}`)
  if (existing) return existing
  const request = await store.read<ProvisionRequest>(`provision:${id}`)
  if (!request) throw new Error('PROVISION_REQUEST_MISSING')
  if (request.status !== 'requested') throw new Error('PROVISION_STATE_CONFLICT')
  const { key, sealed } = await provider.prepare(id)
  const member = provider.signer(key, sealed)
  const google = verify_owner(request.owner, request.zklogin_public_identifier)
  const identity = create_agent_identity({ agent_public_key: member.public_key, zklogin_public_identifier: google })
  const challenge = new TextEncoder().encode(`aresrpg managed key verification:${id}:${key.key_id}`)
  const proof = await member.sign_personal_message(challenge)
  if (!(await member.public_key.verifyPersonalMessage(challenge, proof.signature)))
    throw new Error('PROVISION_SIGNER_INVALID')
  const bot: Bot = {
    id,
    owner: request.owner,
    zklogin_public_identifier: request.zklogin_public_identifier,
    network: 'mainnet',
    address: identity.address,
    multisig_public_key: identity.public_key.toBase64(),
    key_id: key.key_id,
    generation: 1,
    status: 'ready',
    policy: request.policy,
  }
  const address_key = `identity:mainnet:${bot.address}`
  try {
    return await store.transaction(
      [`provision:${id}`, `bot:${id}`, `account:${bot.owner}`, address_key, key.key_id],
      async (tx) => {
        const current = await tx.get<ProvisionRequest>(`provision:${id}`)
        const existing = await tx.get<Bot>(`bot:${id}`)
        if (existing) return existing
        if (JSON.stringify(current) !== JSON.stringify(request)) throw new Error('PROVISION_STATE_CONFLICT')
        if (await tx.get(key.key_id)) throw new Error('PROVISION_KEY_CONFLICT')
        const identity_owner = await tx.get<string>(address_key)
        if (identity_owner && identity_owner !== id) throw new Error('PROVISION_ADDRESS_CONFLICT')
        const account = await tx.get<Account>(`account:${bot.owner}`)
        await tx.put(key.key_id, sealed)
        await tx.put(address_key, id)
        await tx.put(`bot:${id}`, bot)
        await tx.put(`account:${bot.owner}`, {
          owner: bot.owner,
          zklogin_public_identifier: bot.zklogin_public_identifier,
          bot_ids: [...new Set([...(account ? account.bot_ids : []), id])],
        })
        await tx.put(`provision:${id}`, { ...request, key, status: 'ready' })
        return bot
      }
    )
  } catch (error) {
    // A transport error is NOT an aborted commit. Never return the uncommitted candidate.
    // A failed read propagates; a missing result leaves the request pending for reconciliation.
    const committed = await store.read<Bot>(`bot:${id}`)
    if (committed) return committed
    throw error
  }
}

const descriptor_revision = (bot: Bot) => JSON.stringify([bot.id, bot.address, bot.multisig_public_key, bot.generation])
type PairingProof = Readonly<{
  descriptor_revision: string
  owner: string
  bot_id: string
  request: AgentPairingRequest
  status: 'pending' | 'ready'
  proof?: Awaited<ReturnType<typeof prepare_agent_pairing>>['response']
}>
export const request_pairing_proof = async (
  store: ControlStore,
  input: Readonly<{
    authorization_id: string
    bot_id: string
    request: AgentPairingRequest
    owner: string
  }>
) => {
  const request = parse_agent_pairing_request(input.request)
  if (request.owner !== input.owner) throw new Error('PAIRING_OWNER_MISMATCH')
  verify_owner(input.owner, request.zklogin_public_identifier)
  const key = `proof:${input.authorization_id}:${request.nonce}`
  return store.transaction([key, `bot:${input.bot_id}`], async (tx) => {
    const bot = await tx.get<Bot>(`bot:${input.bot_id}`)
    if (!bot) throw new Error('PAIRING_BOT_MISSING')
    if (
      ![
        bot.status === 'ready',
        bot.owner === input.owner,
        bot.zklogin_public_identifier === request.zklogin_public_identifier,
      ].every(Boolean)
    )
      throw new Error('PAIRING_BOT_MISMATCH')
    const previous = await tx.get<PairingProof>(key)
    if (
      previous &&
      (previous.bot_id !== input.bot_id ||
        previous.descriptor_revision !== descriptor_revision(bot) ||
        !Object.entries(request).every(([name, value]) => Reflect.get(previous.request, name) === value))
    )
      throw new Error('PAIRING_REQUEST_CONFLICT')
    const record: PairingProof = previous ?? {
      descriptor_revision: descriptor_revision(bot),
      owner: input.owner,
      bot_id: input.bot_id,
      request,
      status: 'pending',
    }
    await tx.put(key, record)
    return record
  })
}
export const run_pairing_proof = async (store: ControlStore, provider: ManagedProvider, key: string) => {
  const record = await store.read<PairingProof>(key)
  if (!record) throw new Error('PAIRING_REQUEST_MISSING')
  // The lock prevents concurrent revocation/key replacement across this bounded signing effect.
  return store.transaction([key, `bot:${record.bot_id}`, `provision:${record.bot_id}`], async (tx) => {
    const current = await tx.get<PairingProof>(key)
    const bot = await tx.get<Bot>(`bot:${record.bot_id}`)
    const provision = await tx.get<ProvisionRequest>(`provision:${record.bot_id}`)
    if (!current || !bot || !provision?.key) throw new Error('PAIRING_BOT_MISSING')
    if (
      ![
        bot.status === 'ready',
        provision.status === 'ready',
        bot.key_id === provision.key.key_id,
        bot.owner === current.owner,
        current.descriptor_revision === descriptor_revision(bot),
      ].every(Boolean)
    )
      throw new Error('PAIRING_BOT_UNAVAILABLE')
    const pairing = await prepare_agent_pairing(current.request, provider.signer(provision.key))
    if (pairing.signer.address !== bot.address || pairing.signer.public_key.toBase64() !== bot.multisig_public_key)
      throw new Error('PAIRING_DESCRIPTOR_MISMATCH')
    const result = { ...current, status: 'ready' as const, proof: pairing.response }
    await tx.put(key, result)
    return result
  })
}
