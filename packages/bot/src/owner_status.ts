// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HostedOwnerStatus } from '@aresrpg/protocol'

import { assert_live_grant, public_bot, type Account, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'

/** Commit the lookup only when a code becomes durable connector authority, never for abandoned codes. */
export const index_owner_grant = async (tx: ControlTransaction, grant: Grant) => {
  const account = await tx.get<Account>(`account:${grant.owner}`)
  if (!account || account.owner !== grant.owner) throw new Error('owner_identity_mismatch')
  if (account.grant_ids?.includes(grant.id)) return
  await tx.put(`account:${grant.owner}`, { ...account, grant_ids: [...(account.grant_ids ?? []), grant.id] })
}

/** Legacy lookup backfill is derived metadata. Grants remain the authorization authority. */
const owner_grants = async (store: ControlStore, account: Account): Promise<readonly string[]> => {
  if (account.grants_indexed) return account.grant_ids ?? []
  const matching: string[] = []
  for (const key of await store.scan_keys('grant:', Number.MAX_SAFE_INTEGER)) {
    const grant = await store.read<Grant>(key)
    if (grant?.owner === account.owner && grant.code.used) matching.push(grant.id)
  }
  return store.transaction([`account:${account.owner}`], async (tx) => {
    const current = await tx.get<Account>(`account:${account.owner}`)
    if (!current || current.zklogin_public_identifier !== account.zklogin_public_identifier)
      throw new Error('owner_identity_mismatch')
    const grant_ids = [...new Set([...(current.grant_ids ?? []), ...matching])]
    await tx.put(`account:${account.owner}`, { ...current, grant_ids, grants_indexed: true })
    return grant_ids
  })
}
const usable = (config: BotConfig, grant: Grant, bot: Bot, now: number) => {
  if (!grant.code.used || !grant.family) return false
  try {
    assert_live_grant(config, grant, bot, now)
    return true
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_token') return false
    throw error
  }
}

/** Owner authentication happens before this read. No bearer credential or client-provided branding escapes. */
export const read_owner_status = async (
  store: ControlStore,
  config: BotConfig,
  owner: Readonly<{ owner: string; zklogin_public_identifier: string }>,
  now = Date.now()
): Promise<HostedOwnerStatus> => {
  const account = await store.read<Account>(`account:${owner.owner}`)
  if (!account || account.zklogin_public_identifier !== owner.zklogin_public_identifier)
    throw new Error('owner_identity_mismatch')
  const rows = await Promise.all(account.bot_ids.map((id) => store.read<Bot>(`bot:${id}`)))
  const bots = rows.filter(
    (bot): bot is Bot =>
      !!bot && bot.owner === owner.owner && bot.zklogin_public_identifier === owner.zklogin_public_identifier
  )
  if (bots.length !== 1)
    return {
      owner: owner.owner,
      status: bots.length ? 'ambiguous' : 'disconnected',
      bot: null,
      recovery_bots: bots.map(public_bot),
      expires_at: null,
    }
  const bot = bots[0]!
  const grants = await Promise.all((await owner_grants(store, account)).map((id) => store.read<Grant>(`grant:${id}`)))
  const active = grants.filter(
    (grant): grant is Grant =>
      !!grant && grant.owner === owner.owner && grant.bot_id === bot.id && usable(config, grant, bot, now)
  )
  return {
    owner: owner.owner,
    status: active.length ? 'connected' : 'disconnected',
    bot: public_bot(bot),
    recovery_bots: [],
    expires_at: active.length ? Math.max(...active.map((grant) => grant.family!.expires_at)) : null,
  }
}
