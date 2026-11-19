// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { OWNER_ADDRESS, type TelegramAccess } from '@aresrpg/protocol/telegram-access'
import type { BotFetch } from '@aresrpg/protocol/hosted-bot-client'

import { cleanup_sender } from './cleanup.ts'
import type { Copy } from './copy.ts'
import type { RecordBackend } from './secure_records.ts'
import { button, card } from './transport.ts'
import type { Input } from './wire.ts'

/** Joining the waitlist is not admission. Only the operator's allowlist admits an owner. */
export const waitlist_card = async (access: TelegramAccess, input: Input, copy: Copy, owner: string) => {
  if (input.text === '/join') await access.join(owner)
  return (await access.joined(owner))
    ? card(copy.on_waitlist, [[button(copy.check_access, '/start')]])
    : card(copy.waiting, [[button(copy.join_waitlist, '/join')]])
}

const listing = async (access: TelegramAccess) => ({
  waiting: (await access.waiting()).map(({ owner, joined_at }) => ({
    owner,
    joined_at: new Date(joined_at).toISOString(),
  })),
  admitted: await access.admitted_owners(),
})
/** The operator's command over the allowlist: `list` (the default), `admit <owner>` or `remove <owner>`.
 * Removing refuses the owner at once, then revokes its Telegram login so nothing it started keeps running. */
export const admission_command = async (
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  access: TelegramAccess,
  backend: RecordBackend,
  http: BotFetch = fetch
) => {
  const [action = 'list', owner = ''] = args
  if (action === 'list' && args.length <= 1) return listing(access)
  if (![args.length === 2, ['admit', 'remove'].includes(action), OWNER_ADDRESS.test(owner)].every(Boolean))
    throw new Error('admission_command_invalid')
  if (action === 'admit') await access.admit(owner)
  else {
    await access.remove(owner)
    await cleanup_sender(['--owner', owner], env, backend, http).catch((error: unknown) => {
      // An owner that never logged in from Telegram has nothing to revoke.
      if (!(error instanceof Error) || error.message !== 'cleanup_owner_not_linked') throw error
    })
  }
  return listing(access)
}
